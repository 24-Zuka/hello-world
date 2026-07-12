mod codex;
mod lmstudio;
mod mock;
mod work_manual;

use std::sync::Arc;

use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

use crate::exec::EventSink;
use crate::models::{TaskCard, WorkerHealth, WorkerType};

pub use codex::CodexWorker;
pub use lmstudio::LmStudioWorker;
pub use mock::MockWorker;
pub use work_manual::WorkManualWorker;

#[derive(Debug, Clone)]
pub struct WorkerOutput {
    pub content: String,
    pub summary: String,
    pub suggested_artifact: String,
}

#[derive(Debug, thiserror::Error)]
pub enum WorkerError {
    #[error("worker unavailable: {0}")]
    Unavailable(String),
    #[error("worker timed out")]
    Timeout,
    #[error("worker cancelled")]
    Cancelled,
    #[error("worker failed: {0}")]
    Failed(String),
}

#[async_trait]
pub trait AiWorker: Send + Sync {
    fn worker_type(&self) -> WorkerType;
    async fn health(&self) -> WorkerHealth;
    async fn execute(
        &self,
        task: &TaskCard,
        prompt: &str,
        sink: Arc<dyn EventSink>,
        cancel: CancellationToken,
    ) -> Result<WorkerOutput, WorkerError>;
}
