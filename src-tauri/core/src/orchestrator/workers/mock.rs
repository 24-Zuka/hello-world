use std::sync::Arc;

use async_trait::async_trait;
use serde_json::json;
use tokio_util::sync::CancellationToken;

use super::{AiWorker, WorkerError, WorkerOutput};
use crate::exec::EventSink;
use crate::models::{Status, TaskCard, WorkerHealth, WorkerType};

pub struct MockWorker;

#[async_trait]
impl AiWorker for MockWorker {
    fn worker_type(&self) -> WorkerType {
        WorkerType::Mock
    }

    async fn health(&self) -> WorkerHealth {
        WorkerHealth {
            worker_type: WorkerType::Mock,
            status: Status::Ok,
            models: vec!["deterministic-mock".into()],
            note: None,
        }
    }

    async fn execute(
        &self,
        task: &TaskCard,
        _prompt: &str,
        sink: Arc<dyn EventSink>,
        cancel: CancellationToken,
    ) -> Result<WorkerOutput, WorkerError> {
        if cancel.is_cancelled() {
            return Err(WorkerError::Cancelled);
        }
        sink.emit(
            "task:log",
            json!({"task_id": task.task_id, "stream": "stdout", "line": "mock worker started"}),
        );
        let content = format!(
            "# 実施したこと\n{} を決定論的モックで処理しました。\n\n# 決定したこと\n実ワーカー未接続でも状態遷移と成果物保存を検証できます。\n\n# 未確認事項\n実モデルの品質はこの結果では評価していません。\n\n# 次の工程\n必要に応じてCodexまたはLM Studioで再実行してください。",
            task.title
        );
        Ok(WorkerOutput {
            content,
            summary: "deterministic mock completed".into(),
            suggested_artifact: "output.md".into(),
        })
    }
}
