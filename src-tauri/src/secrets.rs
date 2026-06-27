//! トークン保管 (§9): macOS Keychain のみ。画面・ログ・設定ファイルに平文を出さない。
//! 値はフロントに残さない（secret_set は鍵名のみ受け取り、値は OS のセキュアプロンプト/別経路で）。
//!
//! 非 macOS（このLinuxのCI/開発環境）では Keychain が無いため「未対応」を返し、
//! 平文ファイルへのフォールバックは**しない**（課金/秘匿事故防止）。

/// Keychain サービス名。
const SERVICE: &str = "org.jarvis.cockpit";

/// 鍵に対応するトークンが保管済みかを返す（値そのものは返さない）。
pub fn has(key: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        keychain_find(key).is_some()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = key;
        false
    }
}

/// バックエンド内部でのみ使用（例: Obsidian Bearer 取得）。フロントには渡さない。
pub fn get(key: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        keychain_find(key)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = key;
        None
    }
}

/// `security` CLI 経由で Keychain に保存。値は引数経由ではなく stdin で渡す方が望ましいが、
/// ここでは OS の `security add-generic-password` を用いる最小実装。
pub fn set(key: &str, value: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("security")
            .args([
                "add-generic-password",
                "-U", // 既存があれば更新
                "-s",
                SERVICE,
                "-a",
                key,
                "-w",
                value,
            ])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Keychain への保存に失敗しました".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (key, value);
        Err("Keychain は macOS でのみ利用可能です（平文保存はしません）".into())
    }
}

#[cfg(target_os = "macos")]
fn keychain_find(key: &str) -> Option<String> {
    let out = std::process::Command::new("security")
        .args(["find-generic-password", "-s", SERVICE, "-a", key, "-w"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}
