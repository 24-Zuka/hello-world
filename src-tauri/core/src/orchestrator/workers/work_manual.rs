use std::sync::Arc;

use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

use super::{AiWorker, WorkerError, WorkerOutput};
use crate::exec::EventSink;
use crate::models::{Status, TaskCard, WorkerHealth, WorkerType};

pub struct WorkManualWorker;

#[async_trait]
impl AiWorker for WorkManualWorker {
    fn worker_type(&self) -> WorkerType {
        WorkerType::WorkManual
    }

    async fn health(&self) -> WorkerHealth {
        WorkerHealth {
            worker_type: WorkerType::WorkManual,
            status: Status::Ok,
            models: Vec::new(),
            note: Some("Workは手動引き継ぎパッケージを生成します".into()),
        }
    }

    async fn execute(
        &self,
        task: &TaskCard,
        prompt: &str,
        _sink: Arc<dyn EventSink>,
        cancel: CancellationToken,
    ) -> Result<WorkerOutput, WorkerError> {
        if cancel.is_cancelled() {
            return Err(WorkerError::Cancelled);
        }
        let content = format!(
            "# Work用作業パケット\n\n## 目的\n{}\n\n## 入力情報\n{}\n\n## 参照ファイル\n{}\n\n## 指示\n{}\n\n## 出力形式\n{}\n\n## 完了条件\n{}\n\n## AIRFLOWへ戻す形式\n- 実施したこと\n- 決定したこと\n- 未確認事項\n- 次の工程\n\n## Context Pack\n{}",
            task.objective,
            task.context,
            task.input_refs.join("\n"),
            task.instructions,
            task.output_format,
            task.acceptance_criteria.join("\n"),
            prompt,
        );
        Ok(WorkerOutput {
            content,
            summary: "Work manual package generated".into(),
            suggested_artifact: "work-package.md".into(),
        })
    }
}
