use std::sync::Arc;

use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::{AiWorker, WorkerError, WorkerOutput};
use crate::exec::EventSink;
use crate::models::{Status, TaskCard, WorkerHealth, WorkerType};

pub struct LmStudioWorker {
    endpoint: String,
    default_model: String,
    client: reqwest::Client,
}

impl LmStudioWorker {
    pub fn new(endpoint: String, default_model: String) -> Self {
        Self {
            endpoint: endpoint.trim_end_matches('/').into(),
            default_model,
            client: reqwest::Client::new(),
        }
    }

    fn assert_local(&self) -> Result<(), WorkerError> {
        let url = reqwest::Url::parse(&self.endpoint)
            .map_err(|e| WorkerError::Unavailable(e.to_string()))?;
        let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
        if !local {
            return Err(WorkerError::Unavailable(
                "LM Studio endpoint is not loopback; explicit approval is required".into(),
            ));
        }
        Ok(())
    }

    async fn models(&self) -> Result<Vec<String>, WorkerError> {
        self.assert_local()?;
        let response = self
            .client
            .get(format!("{}/v1/models", self.endpoint))
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| WorkerError::Unavailable(e.to_string()))?;
        if !response.status().is_success() {
            return Err(WorkerError::Unavailable(format!(
                "HTTP {}",
                response.status()
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|e| WorkerError::Failed(e.to_string()))?;
        Ok(body
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_string))
            .collect())
    }
}

#[async_trait]
impl AiWorker for LmStudioWorker {
    fn worker_type(&self) -> WorkerType {
        WorkerType::LocalLlm
    }

    async fn health(&self) -> WorkerHealth {
        match self.models().await {
            Ok(models) => WorkerHealth {
                worker_type: WorkerType::LocalLlm,
                status: if models.is_empty() {
                    Status::Warn
                } else {
                    Status::Ok
                },
                models,
                note: None,
            },
            Err(error) => WorkerHealth {
                worker_type: WorkerType::LocalLlm,
                status: Status::Down,
                models: Vec::new(),
                note: Some(error.to_string()),
            },
        }
    }

    async fn execute(
        &self,
        task: &TaskCard,
        prompt: &str,
        sink: Arc<dyn EventSink>,
        cancel: CancellationToken,
    ) -> Result<WorkerOutput, WorkerError> {
        self.assert_local()?;
        if prompt.len() > 200_000 {
            return Err(WorkerError::Failed(
                "prompt exceeds the local worker input limit".into(),
            ));
        }
        let models = self.models().await?;
        let model = task
            .selected_model
            .clone()
            .or_else(|| (!self.default_model.is_empty()).then(|| self.default_model.clone()))
            .or_else(|| models.first().cloned())
            .ok_or_else(|| WorkerError::Unavailable("no LM Studio model available".into()))?;
        if task.requested_model.is_some() && !models.contains(&model) {
            return Err(WorkerError::Unavailable(format!(
                "requested LM Studio model is unavailable: {model}"
            )));
        }
        let response = self.client.post(format!("{}/v1/chat/completions", self.endpoint))
            .timeout(std::time::Duration::from_secs(task.timeout_seconds.max(1)))
            .json(&json!({"model": model, "messages": [{"role":"user","content":prompt}], "stream": true, "temperature": 0, "max_tokens": 512, "reasoning_effort": "none"}))
            .send().await.map_err(|e| if e.is_timeout() { WorkerError::Timeout } else { WorkerError::Failed(e.to_string()) })?;
        if !response.status().is_success() {
            return Err(WorkerError::Failed(format!(
                "LM Studio HTTP {}",
                response.status()
            )));
        }
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut content = String::new();
        loop {
            tokio::select! {
                _ = cancel.cancelled() => return Err(WorkerError::Cancelled),
                next = stream.next() => match next {
                    Some(Ok(bytes)) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                        while let Some(index) = buffer.find('\n') {
                            let line = buffer[..index].trim().to_string();
                            buffer.drain(..=index);
                            let data = line.strip_prefix("data: ").unwrap_or(&line);
                            if data.is_empty() || data == "[DONE]" { continue; }
                            if let Ok(value) = serde_json::from_str::<Value>(data) {
                                let delta = value.pointer("/choices/0/delta/content").and_then(Value::as_str)
                                    .or_else(|| value.pointer("/choices/0/delta/reasoning").and_then(Value::as_str));
                                if let Some(text) = delta {
                                    content.push_str(text);
                                    sink.emit("task:log", json!({"task_id": task.task_id, "stream":"stdout", "line": text, "model": model}));
                                }
                            }
                        }
                    }
                    Some(Err(error)) => return Err(WorkerError::Failed(error.to_string())),
                    None => break,
                }
            }
        }
        if content.trim().is_empty() {
            return Err(WorkerError::Failed(
                "LM Studio returned an empty response".into(),
            ));
        }
        Ok(WorkerOutput {
            summary: format!("LM Studio {model} completed"),
            content,
            suggested_artifact: "output.md".into(),
        })
    }
}
