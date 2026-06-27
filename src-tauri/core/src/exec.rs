//! 実行共通層 (§9): allowlist → dcg → プロセス起動 → job:* を [`EventSink`] へ emit。
//!
//! すべての外部プロセス起動はこの層を通す。任意コマンド実行はしない（§9 シェル実行）。
//! イベント配信先はトランスポート非依存の [`EventSink`]（Tauri=app.emit / Bridge=SSE）。

use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::json;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// イベント配信の抽象。`event` 名 + JSON ペイロードを fire-and-forget で送る。
/// 実装: Tauri = `AppHandle::emit` ラッパ / Bridge = tokio broadcast → SSE。
pub trait EventSink: Send + Sync {
    fn emit(&self, event: &str, payload: serde_json::Value);
}

/// allowlist。Tauri の shell scope と整合（§9: codex / git / launchctl / 同梱scripts）。
const ALLOWED: &[&str] = &["codex", "git", "launchctl", "bash", "sh"];

static JOB_SEQ: AtomicU64 = AtomicU64::new(1);

pub fn next_job_id() -> String {
    let n = JOB_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("job-{n:04}")
}

#[derive(Debug, thiserror::Error)]
pub enum ExecError {
    #[error("コマンド `{0}` は許可リストにありません")]
    NotAllowed(String),
    #[error("dcg により遮断されました: {0}")]
    Blocked(String),
    #[error("プロセス起動に失敗: {0}")]
    Spawn(String),
}

/// 同期実行して stdout を取得（guard 通過必須）。worktree 一覧・login status 等の即時取得用。
/// 失敗時は Err を返し、呼び出し側は mock にフォールバックする。
pub fn run_capture(argv: &[String], cwd: Option<&str>) -> Result<String, ExecError> {
    guard(argv)?;
    let mut cmd = std::process::Command::new(&argv[0]);
    cmd.args(&argv[1..]);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let out = cmd.output().map_err(|e| ExecError::Spawn(e.to_string()))?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// allowlist 検査 + dcg 検査。起動前のゲート（§14.2）。
pub fn guard(argv: &[String]) -> Result<(), ExecError> {
    let Some(exe) = argv.first() else {
        return Err(ExecError::NotAllowed(String::new()));
    };
    let base = exe.rsplit('/').next().unwrap_or(exe);
    if !ALLOWED.contains(&base) {
        return Err(ExecError::NotAllowed(base.to_string()));
    }
    if let dcg::Verdict::Blocked { reason, .. } = dcg::inspect(argv) {
        return Err(ExecError::Blocked(reason));
    }
    Ok(())
}

/// 非同期にコマンドを起動し、stdout/stderr を行単位で job:log として emit。
/// JSON 行として解釈できれば job:event も emit（codex --json 対応）。
/// 完了時に job:done を emit。spawn 前に必ず guard を通す（allowlist + dcg）。
pub async fn spawn_streamed(
    sink: Arc<dyn EventSink>,
    job_id: String,
    argv: Vec<String>,
    cwd: Option<String>,
) -> Result<(), ExecError> {
    // ① allowlist + ② dcg
    if let Err(e) = guard(&argv) {
        // ③ 遮断は notify で画面通知（§14.2）。
        sink.emit(
            "notify",
            json!({ "level": "error", "title": "コマンド遮断 (dcg)", "body": e.to_string() }),
        );
        return Err(e);
    }

    let started = std::time::Instant::now();
    let mut cmd = Command::new(&argv[0]);
    cmd.args(&argv[1..]);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| ExecError::Spawn(e.to_string()))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(out) = stdout {
        let sink = sink.clone();
        let jid = job_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                // codex exec --json の各行は JSON。解釈できれば job:event も出す。
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                    let kind = val
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("event")
                        .to_string();
                    sink.emit("job:event", json!({ "jobId": jid, "type": kind, "payload": val }));
                }
                sink.emit("job:log", json!({ "jobId": jid, "line": line, "stream": "stdout" }));
            }
        });
    }

    if let Some(err) = stderr {
        let sink = sink.clone();
        let jid = job_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                sink.emit("job:log", json!({ "jobId": jid, "line": line, "stream": "stderr" }));
            }
        });
    }

    let sink2 = sink.clone();
    let jid = job_id.clone();
    tokio::spawn(async move {
        let code = child.wait().await.ok().and_then(|s| s.code()).unwrap_or(-1);
        sink2.emit(
            "job:done",
            json!({ "jobId": jid, "exitCode": code, "durationMs": started.elapsed().as_millis() as u64 }),
        );
    });

    Ok(())
}
