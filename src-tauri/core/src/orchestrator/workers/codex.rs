use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::{AiWorker, WorkerError, WorkerOutput};
use crate::exec::{guard, run_capture, EventSink};
use crate::models::{ReasoningLevel, Status, TaskCard, WorkerHealth, WorkerType};

pub struct CodexWorker;

async fn write_prompt_and_close<W>(mut stdin: W, prompt: &str) -> Result<(), std::io::Error>
where
    W: AsyncWrite + Unpin,
{
    stdin.write_all(prompt.as_bytes()).await?;
    stdin.shutdown().await?;
    // `shutdown` flushes the writer; dropping it closes the pipe so Codex can
    // finish its read_to_end before it starts the turn.
    drop(stdin);
    Ok(())
}

fn reasoning_arg(level: ReasoningLevel) -> &'static str {
    match level {
        ReasoningLevel::Low => "low",
        ReasoningLevel::Medium => "medium",
        ReasoningLevel::High => "high",
        ReasoningLevel::VeryHigh => "xhigh",
        ReasoningLevel::Max => "max",
        ReasoningLevel::Ultra => "ultra",
    }
}

fn catalog() -> Vec<(String, Vec<String>)> {
    let argv = vec!["codex".into(), "debug".into(), "models".into()];
    let Ok(raw) = run_capture(&argv, None) else {
        return Vec::new();
    };
    parse_catalog(&raw)
}

fn parse_catalog(raw: &str) -> Vec<(String, Vec<String>)> {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    value
        .as_array()
        .or_else(|| value.get("models").and_then(Value::as_array))
        .or_else(|| value.get("data").and_then(Value::as_array))
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let slug = model.get("slug")?.as_str()?.to_string();
            let levels = model
                .get("supported_reasoning_levels")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|item| {
                    item.get("effort")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .collect();
            Some((slug, levels))
        })
        .collect()
}

#[async_trait]
impl AiWorker for CodexWorker {
    fn worker_type(&self) -> WorkerType {
        WorkerType::Codex
    }

    async fn health(&self) -> WorkerHealth {
        let logged_in = run_capture(&["codex".into(), "login".into(), "status".into()], None)
            .is_ok_and(|out| out.to_lowercase().contains("logged in"));
        WorkerHealth {
            worker_type: WorkerType::Codex,
            status: if logged_in { Status::Ok } else { Status::Down },
            models: catalog().into_iter().map(|(model, _)| model).collect(),
            note: (!logged_in).then(|| "Codex CLI is not logged in with ChatGPT".into()),
        }
    }

    async fn execute(
        &self,
        task: &TaskCard,
        prompt: &str,
        sink: Arc<dyn EventSink>,
        cancel: CancellationToken,
    ) -> Result<WorkerOutput, WorkerError> {
        let workspace = std::path::PathBuf::from(task.context.trim())
            .canonicalize()
            .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| ".".into()));
        let output_path = workspace.join(format!(".jarvis-{}-last-message.md", task.task_id));
        let model = task
            .selected_model
            .clone()
            .or_else(|| task.requested_model.clone());
        let reasoning = task
            .selected_reasoning
            .or(task.requested_reasoning)
            .unwrap_or(ReasoningLevel::Medium);
        let available = catalog();
        if let Some(requested) = &task.requested_model {
            if !available.iter().any(|(model, _)| model == requested) {
                return Err(WorkerError::Unavailable(format!(
                    "requested Codex model is unavailable: {requested}"
                )));
            }
        }
        if let Some(selected) = &model {
            if let Some((_, levels)) = available
                .iter()
                .find(|(candidate, _)| candidate == selected)
            {
                let effort = reasoning_arg(reasoning);
                if !levels.is_empty() && !levels.iter().any(|level| level == effort) {
                    return Err(WorkerError::Unavailable(format!(
                        "reasoning level {effort} is unavailable for {selected}"
                    )));
                }
            }
        }

        let mut argv = vec![
            "codex".into(),
            "--ask-for-approval".into(),
            "never".into(),
            "exec".into(),
            "--json".into(),
            "--ephemeral".into(),
            "--sandbox".into(),
            "workspace-write".into(),
            "--skip-git-repo-check".into(),
            "-C".into(),
            workspace.to_string_lossy().into_owned(),
            "-c".into(),
            format!("model_reasoning_effort=\"{}\"", reasoning_arg(reasoning)),
            "--output-last-message".into(),
            output_path.to_string_lossy().into_owned(),
        ];
        if let Some(model) = &model {
            argv.extend(["--model".into(), model.clone()]);
        }
        argv.push("-".into());
        guard(&argv).map_err(|e| WorkerError::Failed(e.to_string()))?;
        let mut command = Command::new(&argv[0]);
        command
            .args(&argv[1..])
            .current_dir(&workspace)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|e| WorkerError::Failed(e.to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| WorkerError::Failed("missing Codex stdin".into()))?;
        write_prompt_and_close(stdin, prompt)
            .await
            .map_err(|e| WorkerError::Failed(e.to_string()))?;

        let (tx, mut rx) = mpsc::unbounded_channel::<(&'static str, String)>();
        if let Some(stdout) = child.stdout.take() {
            let tx = tx.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx.send(("stdout", line));
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let tx = tx.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx.send(("stderr", line));
                }
            });
        }
        drop(tx);
        let started = Instant::now();
        let timeout = Duration::from_secs(task.timeout_seconds.max(1));
        let mut stderr_tail = Vec::new();
        let exit = loop {
            tokio::select! {
                _ = cancel.cancelled() => { let _ = child.kill().await; let _ = std::fs::remove_file(&output_path); return Err(WorkerError::Cancelled); }
                line = rx.recv() => if let Some((stream, line)) = line {
                    let masked = mask_secrets(&line);
                    if stream == "stderr" {
                        stderr_tail.push(masked.clone());
                        if stderr_tail.len() > 8 { stderr_tail.remove(0); }
                    }
                    sink.emit("task:log", json!({"task_id":task.task_id,"stream":stream,"line":masked,"model":model,"reasoning":reasoning_arg(reasoning)}));
                    if stream == "stdout" {
                        if let Ok(value) = serde_json::from_str::<Value>(&line) {
                            if matches!(value.get("type").and_then(Value::as_str), Some("error" | "turn.failed")) {
                                let message = value.get("message").and_then(Value::as_str)
                                    .or_else(|| value.pointer("/error/message").and_then(Value::as_str));
                                if let Some(message) = message {
                                    stderr_tail.push(mask_secrets(message));
                                    if stderr_tail.len() > 8 { stderr_tail.remove(0); }
                                }
                            }
                            sink.emit("task:event", json!({"task_id":task.task_id,"payload":value}));
                        }
                    }
                },
                _ = tokio::time::sleep(Duration::from_millis(100)) => {}
            }
            if started.elapsed() > timeout {
                let _ = child.kill().await;
                let _ = std::fs::remove_file(&output_path);
                return Err(WorkerError::Timeout);
            }
            if let Some(status) = child
                .try_wait()
                .map_err(|e| WorkerError::Failed(e.to_string()))?
            {
                break status.code();
            }
        };
        while let Ok((stream, line)) = rx.try_recv() {
            sink.emit(
                "task:log",
                json!({"task_id":task.task_id,"stream":stream,"line":mask_secrets(&line)}),
            );
        }
        if exit != Some(0) {
            let _ = std::fs::remove_file(&output_path);
            return Err(WorkerError::Failed(format!(
                "Codex exited with code {}: {}",
                exit.unwrap_or(-1),
                stderr_tail.join(" | ")
            )));
        }
        let content = std::fs::read_to_string(&output_path)
            .map_err(|e| WorkerError::Failed(e.to_string()))?;
        let _ = std::fs::remove_file(&output_path);
        if content.trim().is_empty() {
            return Err(WorkerError::Failed(
                "Codex returned an empty final message".into(),
            ));
        }
        Ok(WorkerOutput {
            summary: "Codex CLI completed through ChatGPT login".into(),
            content,
            suggested_artifact: "output.md".into(),
        })
    }
}

fn mask_secrets(line: &str) -> String {
    let mut result = line.to_string();
    for marker in ["Bearer ", "sk-"] {
        while let Some(index) = result.find(marker) {
            let start = index + marker.len();
            let end = result[start..]
                .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ',' | '}'))
                .map(|v| start + v)
                .unwrap_or(result.len());
            if end <= start {
                break;
            }
            result.replace_range(index..end, "[REDACTED]");
        }
    }
    if result.len() > 16_384 {
        result.truncate(16_384);
        result.push_str("...[truncated]");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;

    #[tokio::test]
    async fn prompt_writer_closes_the_stream_after_writing() {
        let (writer, mut reader) = tokio::io::duplex(128);
        write_prompt_and_close(writer, "EOF test").await.unwrap();

        let mut received = String::new();
        reader.read_to_string(&mut received).await.unwrap();
        assert_eq!(received, "EOF test");
    }

    #[test]
    fn masks_bearer_and_api_style_tokens() {
        let masked = mask_secrets("Authorization: Bearer abc123 and sk-secret");
        assert!(!masked.contains("abc123"));
        assert!(!masked.contains("sk-secret"));
    }

    #[test]
    fn parses_object_wrapped_model_catalog() {
        let models = parse_catalog(
            r#"{"models":[{"slug":"gpt-test","supported_reasoning_levels":[{"effort":"low"}]}]}"#,
        );
        assert_eq!(models, vec![("gpt-test".into(), vec!["low".into()])]);
    }
}
