//! dcg — Destructive Command Guard (§14.2)
//!
//! すべての `codex` / `git` / scripts 実行は、Rust allowlist 通過後・プロセス起動前に
//! `dcg` を必ず通す。`dcg` 自体も同梱 Rust モジュールとして実装し、外部依存にしない。
//!
//! 解析ステップ:
//!   ① Quick Reject       — キーワード非該当は高速通過
//!   ② Context Classification — コミットメッセージ等のテキストデータは誤検知除外
//!   ③ 遮断時 exit code 2 ＋ 標準エラーへ理由出力（呼び出し側が notify を emit）

use serde::Serialize;

/// 遮断の強度。`HardBlock` は代替不可（実行を許さない）、`Block` は代替提案つき。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Block,
    HardBlock,
}

/// dcg の判定結果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "decision", rename_all = "snake_case")]
pub enum Verdict {
    /// 通過。プロセス起動を許可。
    Allow,
    /// 遮断。`exit code 2` 相当。`reason` と `suggestion` を stderr / notify に出す。
    Blocked {
        rule_id: String,
        severity: Severity,
        reason: String,
        suggestion: Option<String>,
    },
}

impl Verdict {
    pub fn is_blocked(&self) -> bool {
        matches!(self, Verdict::Blocked { .. })
    }
}

/// コマンドを引数ベクタとして検査する。`argv[0]` は実行ファイル名。
///
/// 注意: ②Context Classification のため、引数のうち「データとして渡されるテキスト」
/// （例: `git commit -m "..."` のメッセージ）は遮断対象から除外する。
pub fn inspect(argv: &[String]) -> Verdict {
    if argv.is_empty() {
        return Verdict::Allow;
    }

    // ② Context Classification: データテキストを除いた「実効トークン」を作る。
    let effective = strip_data_tokens(argv);
    let exe = basename(&argv[0]);

    // ① Quick Reject: 危険キーワードが実効トークンに無ければ即通過。
    let joined = effective.join(" ");
    let lower = joined.to_lowercase();
    let suspicious = ["rm", "reset", "push", "dd", "mkfs", "fdisk", "--force", "-rf"]
        .iter()
        .any(|k| lower.contains(k));
    if !suspicious {
        return Verdict::Allow;
    }

    // ③ ルールパック評価。
    if let Some(v) = rule_filesystem(&exe, &effective) {
        return v;
    }
    if let Some(v) = rule_disk(&exe, &effective) {
        return v;
    }
    if let Some(v) = rule_git(&exe, &effective) {
        return v;
    }

    Verdict::Allow
}

/// `core.filesystem` — `rm -rf` がシステムルート / プロジェクト管理外を対象にする場合に遮断。
/// `${WORKSPACE_ROOT}/tmp` 下のみ許可。
fn rule_filesystem(exe: &str, tokens: &[String]) -> Option<Verdict> {
    if exe != "rm" {
        return None;
    }
    let has_recursive_force = tokens.iter().any(|t| is_rm_recursive_force(t))
        || (tokens.iter().any(|t| flag_has(t, 'r')) && tokens.iter().any(|t| flag_has(t, 'f')));
    if !has_recursive_force {
        return None;
    }

    // 対象パス（フラグでないトークン）を検査。
    for path in tokens.iter().skip(1).filter(|t| !t.starts_with('-')) {
        if is_dangerous_path(path) {
            return Some(Verdict::Blocked {
                rule_id: "core.filesystem".into(),
                severity: Severity::Block,
                reason: format!(
                    "`rm -rf {path}` はシステムルート/プロジェクト管理外を対象にしています。許可されるのは ${{WORKSPACE_ROOT}}/tmp 配下のみです。"
                ),
                suggestion: Some("削除対象を ${WORKSPACE_ROOT}/tmp 配下に限定してください。".into()),
            });
        }
    }
    None
}

/// `system.disk` — `dd` / `mkfs` / `fdisk` が物理デバイスを対象にする場合はハードブロック。
fn rule_disk(exe: &str, _tokens: &[String]) -> Option<Verdict> {
    if matches!(exe, "dd" | "mkfs" | "fdisk") || exe.starts_with("mkfs.") {
        return Some(Verdict::Blocked {
            rule_id: "system.disk".into(),
            severity: Severity::HardBlock,
            reason: format!("`{exe}` は物理デバイスを破壊しうるため実行できません。"),
            suggestion: None,
        });
    }
    None
}

/// `core.git` / `core.git:force-push` — 破壊的 git 操作。
fn rule_git(exe: &str, tokens: &[String]) -> Option<Verdict> {
    if exe != "git" {
        return None;
    }
    let sub = tokens.get(1).map(|s| s.as_str()).unwrap_or("");

    // core.git: `git reset --hard` は未コミット変更の喪失リスク。
    if sub == "reset" && tokens.iter().any(|t| t == "--hard") {
        return Some(Verdict::Blocked {
            rule_id: "core.git".into(),
            severity: Severity::Block,
            reason: "`git reset --hard` は未コミットの変更を失う可能性があります。".into(),
            suggestion: Some("先に `git stash` で退避してください。".into()),
        });
    }

    // core.git:force-push: main/master への強制上書き。
    if sub == "push" {
        let forced = tokens
            .iter()
            .any(|t| t == "--force" || t == "-f" || t.starts_with("--force="));
        // --force-with-lease は比較的安全なので対象外。
        let lease = tokens.iter().any(|t| t.starts_with("--force-with-lease"));
        if forced && !lease {
            let targets_protected = tokens
                .iter()
                .any(|t| t == "main" || t == "master")
                || !tokens.iter().any(|t| t == "main" || t == "master"); // 明示ブランチ無し=現在ブランチがmainの可能性
            if targets_protected {
                return Some(Verdict::Blocked {
                    rule_id: "core.git:force-push".into(),
                    severity: Severity::Block,
                    reason: "main/master への `git push --force` は履歴を破壊します。".into(),
                    suggestion: Some("`--force-with-lease` への置換を検討してください。".into()),
                });
            }
        }
    }
    None
}

// ── helpers ────────────────────────────────────────────────────────────────

fn basename(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

/// `-rf` / `-fr` / `-Rf` のような結合フラグに文字 `c` が含まれるか。
fn flag_has(token: &str, c: char) -> bool {
    token.starts_with('-')
        && !token.starts_with("--")
        && token[1..].chars().any(|ch| ch.eq_ignore_ascii_case(&c))
}

fn is_rm_recursive_force(token: &str) -> bool {
    flag_has(token, 'r') && flag_has(token, 'f')
}

/// システムルートやワークスペース外を指す危険パスか。
fn is_dangerous_path(path: &str) -> bool {
    let p = path.trim();
    if p == "/" || p == "/*" || p == "~" || p == "~/" || p == "$HOME" || p == "." || p == "*" {
        return true;
    }
    // 絶対パスでワークスペース tmp 以外、またはホーム直下の広域削除。
    if p.starts_with('/') {
        // /workspace_root/tmp/... のような tmp 配下のみ許可（ヒューリスティック）。
        return !p.contains("/tmp/") && !p.ends_with("/tmp");
    }
    // 親ディレクトリへ遡るパスは管理外の可能性。
    if p.starts_with("../") || p.contains("/../") {
        return true;
    }
    false
}

/// ② Context Classification:
/// `-m "msg"` / `--message=...` / `-F file` のようにデータとして渡される値を実効トークンから除く。
/// これにより `git commit -m "rm -rf old build"` のようなテキストを誤遮断しない。
fn strip_data_tokens(argv: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(argv.len());
    let mut skip_next = false;
    for (i, tok) in argv.iter().enumerate() {
        if skip_next {
            skip_next = false;
            continue;
        }
        // `-m`, `--message`, `-F`, `--file` の次トークンは値（データ）。
        if i > 0 && matches!(tok.as_str(), "-m" | "--message" | "-F" | "--file" | "-c") {
            skip_next = true;
            out.push(tok.clone());
            continue;
        }
        // `--message=...` 形式は値を落とす。
        if tok.starts_with("--message=") || tok.starts_with("--file=") {
            out.push(tok.split('=').next().unwrap_or(tok).to_string());
            continue;
        }
        out.push(tok.clone());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }

    // §14.7: rm -rf / がexit 2相当で遮断される。
    #[test]
    fn blocks_rm_rf_root() {
        assert!(inspect(&argv(&["rm", "-rf", "/"])).is_blocked());
        assert!(inspect(&argv(&["rm", "-r", "-f", "/"])).is_blocked());
        assert!(inspect(&argv(&["/bin/rm", "-rf", "/usr"])).is_blocked());
    }

    // §14.7: git reset --hard が遮断される。
    #[test]
    fn blocks_git_reset_hard() {
        let v = inspect(&argv(&["git", "reset", "--hard"]));
        assert!(v.is_blocked());
        if let Verdict::Blocked { suggestion, .. } = v {
            assert!(suggestion.unwrap().contains("stash"));
        }
    }

    // §14.7: main への git push --force が遮断される。
    #[test]
    fn blocks_force_push_main() {
        assert!(inspect(&argv(&["git", "push", "origin", "main", "--force"])).is_blocked());
        assert!(inspect(&argv(&["git", "push", "--force"])).is_blocked());
    }

    // §14.7: --force-with-lease は許可。
    #[test]
    fn allows_force_with_lease() {
        assert!(!inspect(&argv(&["git", "push", "--force-with-lease", "origin", "feature"])).is_blocked());
    }

    // §14.7: コミットメッセージ内の "rm -rf" は誤遮断しない（False Positive ゼロ）。
    #[test]
    fn no_false_positive_in_commit_message() {
        assert!(!inspect(&argv(&["git", "commit", "-m", "remove rm -rf from docs"])).is_blocked());
        assert!(!inspect(&argv(&["git", "commit", "--message=cleanup rm -rf example"])).is_blocked());
    }

    // 物理デバイス操作はハードブロック。
    #[test]
    fn hard_blocks_disk_ops() {
        let v = inspect(&argv(&["dd", "if=/dev/zero", "of=/dev/disk0"]));
        match v {
            Verdict::Blocked { severity, .. } => assert_eq!(severity, Severity::HardBlock),
            _ => panic!("expected hard block"),
        }
    }

    // tmp 配下の rm -rf は許可。
    #[test]
    fn allows_rm_in_tmp() {
        assert!(!inspect(&argv(&["rm", "-rf", "/Users/kai/workspace/tmp/build"])).is_blocked());
    }

    // 無害なコマンドは高速通過。
    #[test]
    fn allows_benign() {
        assert!(!inspect(&argv(&["git", "status"])).is_blocked());
        assert!(!inspect(&argv(&["codex", "exec", "--json", "build"])).is_blocked());
        assert!(!inspect(&argv(&["ls", "-la"])).is_blocked());
    }
}
