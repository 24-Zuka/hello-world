use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::json;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

use super::artifacts;
use super::now_string;
use super::prompt_builder;
use super::quality;
use super::repository::TaskRepository;
use super::router;
use super::workers::{AiWorker, CodexWorker, LmStudioWorker, MockWorker, WorkManualWorker};
use crate::exec::{run_capture, EventSink};
use crate::models::*;

pub struct Orchestrator {
    repository: Arc<TaskRepository>,
    status: Mutex<OrchestratorStatus>,
    cancellations: Mutex<HashMap<String, CancellationToken>>,
    loop_active: AtomicBool,
    codex_gate: Arc<Semaphore>,
    lmstudio_gate: Arc<Semaphore>,
}

struct RunningGuard<'a>(&'a Orchestrator);

impl Drop for RunningGuard<'_> {
    fn drop(&mut self) {
        self.0.update_running(-1);
    }
}

struct LeaseRecovery {
    repository: Arc<TaskRepository>,
    task_id: String,
}

impl Drop for LeaseRecovery {
    fn drop(&mut self) {
        let Ok(Some(mut task)) = self.repository.get(&self.task_id) else {
            return;
        };
        if task.status != TaskStatus::Running {
            return;
        }
        task.status = TaskStatus::Failed;
        task.legacy_status = "Waiting".into();
        task.auto_run = false;
        task.lease_owner = None;
        task.lease_expires_at = None;
        task.error_message.get_or_insert_with(|| {
            "orchestrator aborted before the task reached a terminal state".into()
        });
        task.last_updated = now_string();
        let _ = self.repository.update(&task);
    }
}

struct RecordingSink {
    inner: Arc<dyn EventSink>,
    lines: Mutex<Vec<String>>,
}

impl RecordingSink {
    const MAX_LINES: usize = 2_000;

    fn new(inner: Arc<dyn EventSink>) -> Self {
        Self {
            inner,
            lines: Mutex::new(Vec::new()),
        }
    }

    fn contents(&self) -> String {
        self.lines
            .lock()
            .map(|lines| lines.join("\n"))
            .unwrap_or_default()
    }
}

impl EventSink for RecordingSink {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        if matches!(event, "task:log" | "task:event") {
            if let Ok(mut lines) = self.lines.lock() {
                if lines.len() == Self::MAX_LINES {
                    lines.remove(0);
                }
                lines.push(json!({ "event": event, "payload": payload.clone() }).to_string());
            }
        }
        self.inner.emit(event, payload);
    }
}

impl Orchestrator {
    pub fn new(repository: Arc<TaskRepository>) -> Self {
        Self {
            repository,
            status: Mutex::new(OrchestratorStatus {
                mode: OrchestratorMode::Stopped,
                enabled: true,
                poll_interval_seconds: 5,
                running_tasks: 0,
                last_tick_at: None,
                last_error: None,
            }),
            cancellations: Mutex::new(HashMap::new()),
            loop_active: AtomicBool::new(false),
            codex_gate: Arc::new(Semaphore::new(2)),
            lmstudio_gate: Arc::new(Semaphore::new(2)),
        }
    }

    pub fn repository(&self) -> Arc<TaskRepository> {
        self.repository.clone()
    }

    pub fn status(&self) -> OrchestratorStatus {
        self.status
            .lock()
            .map(|s| s.clone())
            .unwrap_or(OrchestratorStatus {
                mode: OrchestratorMode::Stopped,
                enabled: false,
                poll_interval_seconds: 5,
                running_tasks: 0,
                last_tick_at: None,
                last_error: Some("orchestrator lock poisoned".into()),
            })
    }

    pub fn pause(&self) -> Result<OrchestratorStatus, String> {
        let mut status = self
            .status
            .lock()
            .map_err(|_| "orchestrator lock poisoned")?;
        if status.mode == OrchestratorMode::Stopped {
            return Err("orchestrator is stopped".into());
        }
        status.mode = OrchestratorMode::Paused;
        Ok(status.clone())
    }

    pub fn resume(&self) -> Result<OrchestratorStatus, String> {
        let mut status = self
            .status
            .lock()
            .map_err(|_| "orchestrator lock poisoned")?;
        if status.mode == OrchestratorMode::Stopped {
            return Err("orchestrator is stopped".into());
        }
        status.mode = OrchestratorMode::Running;
        Ok(status.clone())
    }

    pub fn stop(&self) -> OrchestratorStatus {
        if let Ok(mut status) = self.status.lock() {
            status.mode = OrchestratorMode::Stopped;
        }
        if let Ok(cancellations) = self.cancellations.lock() {
            for token in cancellations.values() {
                token.cancel();
            }
        }
        self.status()
    }

    pub fn cancel(&self, task_id: &str) -> bool {
        self.cancellations
            .lock()
            .ok()
            .and_then(|map| map.get(task_id).cloned())
            .is_some_and(|token| {
                token.cancel();
                true
            })
    }

    pub fn start(
        self: &Arc<Self>,
        settings: AppSettings,
        sink: Arc<dyn EventSink>,
    ) -> OrchestratorStatus {
        {
            let mut status = self.status.lock().expect("orchestrator status lock");
            status.enabled = settings.orchestrator_enabled;
            status.poll_interval_seconds = settings.poll_interval_seconds.clamp(1, 300);
            status.mode = if settings.orchestrator_enabled {
                OrchestratorMode::Running
            } else {
                OrchestratorMode::Stopped
            };
        }
        if !settings.orchestrator_enabled || self.loop_active.swap(true, Ordering::SeqCst) {
            return self.status();
        }
        let service = self.clone();
        tokio::spawn(async move {
            loop {
                let current = service.status();
                if current.mode == OrchestratorMode::Stopped {
                    break;
                }
                if current.mode == OrchestratorMode::Running {
                    let count = settings.max_concurrency.clamp(1, 4);
                    let mut handles = Vec::new();
                    for _ in 0..count {
                        let service = service.clone();
                        let settings = settings.clone();
                        let sink = sink.clone();
                        handles.push(tokio::spawn(async move {
                            service.run_once(settings, sink, None).await
                        }));
                    }
                    for handle in handles {
                        let _ = handle.await;
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(
                    current.poll_interval_seconds,
                ))
                .await;
            }
            service.loop_active.store(false, Ordering::SeqCst);
        });
        self.status()
    }

    pub async fn run_once(
        &self,
        settings: AppSettings,
        sink: Arc<dyn EventSink>,
        task_id: Option<String>,
    ) -> Result<Option<TaskCard>, String> {
        let _ = self.repository.release_expired_leases();
        let owner = format!("jarvis-{}", std::process::id());
        let task = match task_id {
            Some(task_id) => Some(self.repository.claim_task(&task_id, &owner, 120)?),
            None => self.repository.claim_next(&owner, 120)?,
        };
        let Some(mut task) = task else {
            return Ok(None);
        };
        self.update_running(1);
        let _running_guard = RunningGuard(self);
        let _lease_recovery = LeaseRecovery {
            repository: self.repository.clone(),
            task_id: task.task_id.clone(),
        };
        self.tick(None);
        let decision = router::route(&task, &settings);
        task.worker_type = Some(decision.worker_type);
        task.selected_model = decision.model.clone();
        task.selected_reasoning = Some(decision.reasoning);
        task.routing_reason = Some(decision.reason.clone());
        self.repository.update(&task)?;
        self.emit(&sink, "task:routed", &task.task_id, json!(decision));
        if decision.requires_human_approval || decision.worker_type == WorkerType::Human {
            task.status = TaskStatus::AwaitingApproval;
            task.legacy_status = "Waiting".into();
            task.auto_run = false;
            task.lease_owner = None;
            task.lease_expires_at = None;
            self.repository.update(&task)?;
            self.emit(&sink, "task:updated", &task.task_id, json!(task));
            return Ok(Some(task));
        }

        let prompt = prompt_builder::build(&task);
        let root = PathBuf::from(&settings.artifact_root);
        let workdir = artifacts::prepare(&root, &task, &prompt)?;
        let mut execution_task = task.clone();
        execution_task.context = workdir.to_string_lossy().into_owned();
        let cancel = CancellationToken::new();
        self.cancellations
            .lock()
            .map_err(|_| "cancellation lock poisoned")?
            .insert(task.task_id.clone(), cancel.clone());
        let run_id = uuid::Uuid::new_v4().to_string();
        let mut run = TaskRun {
            run_id,
            task_id: task.task_id.clone(),
            worker_type: decision.worker_type,
            model: decision.model.clone(),
            reasoning: Some(decision.reasoning),
            status: "RUNNING".into(),
            started_at: now_string(),
            completed_at: None,
            exit_code: None,
            error_message: None,
        };
        self.repository.add_run(&run)?;
        self.emit(&sink, "task:started", &task.task_id, json!(run));

        let recording_sink = Arc::new(RecordingSink::new(sink.clone()));
        let worker_sink: Arc<dyn EventSink> = recording_sink.clone();
        let output = match decision.worker_type {
            WorkerType::Codex => {
                let permits = if settings.codex_concurrency.clamp(1, 2) == 1 {
                    2
                } else {
                    1
                };
                let _permit = self
                    .codex_gate
                    .acquire_many(permits)
                    .await
                    .map_err(|e| e.to_string())?;
                CodexWorker
                    .execute(&execution_task, &prompt, worker_sink.clone(), cancel)
                    .await
            }
            WorkerType::LocalLlm => {
                let permits = if settings.lmstudio_concurrency.clamp(1, 2) == 1 {
                    2
                } else {
                    1
                };
                let _permit = self
                    .lmstudio_gate
                    .acquire_many(permits)
                    .await
                    .map_err(|e| e.to_string())?;
                LmStudioWorker::new(
                    settings.lmstudio_endpoint.clone(),
                    settings.lmstudio_default_model.clone(),
                )
                .execute(&execution_task, &prompt, worker_sink.clone(), cancel)
                .await
            }
            WorkerType::WorkManual => {
                WorkManualWorker
                    .execute(&execution_task, &prompt, worker_sink.clone(), cancel)
                    .await
            }
            WorkerType::Mock => {
                MockWorker
                    .execute(&execution_task, &prompt, worker_sink, cancel)
                    .await
            }
            WorkerType::Human => unreachable!(),
        };

        self.cancellations
            .lock()
            .ok()
            .map(|mut map| map.remove(&task.task_id));
        let run_log = artifacts::save(
            &root,
            &task.task_id,
            "run.jsonl",
            "run-log",
            &recording_sink.contents(),
        )?;
        self.repository.add_artifact(&run_log)?;
        task.artifact_paths.push(run_log.path.clone());
        self.emit(&sink, "task:artifact", &task.task_id, json!(run_log));
        match output {
            Ok(output) => {
                run.status = "COMPLETED".into();
                run.completed_at = Some(now_string());
                run.exit_code = Some(0);
                self.repository.add_run(&run)?;
                let artifact = artifacts::save(
                    &root,
                    &task.task_id,
                    &output.suggested_artifact,
                    "output",
                    &output.content,
                )?;
                self.repository.add_artifact(&artifact)?;
                task.artifact_paths.push(artifact.path.clone());
                task.result_summary = Some(output.summary);
                task.status = TaskStatus::AiReview;
                task.legacy_status = "Waiting".into();
                self.repository.update(&task)?;
                self.emit(&sink, "task:artifact", &task.task_id, json!(artifact));

                let review = quality::review(&task, &output.content);
                let review_json =
                    serde_json::to_string_pretty(&review).map_err(|e| e.to_string())?;
                let review_artifact =
                    artifacts::save(&root, &task.task_id, "review.json", "review", &review_json)?;
                self.repository.add_artifact(&review_artifact)?;
                task.artifact_paths.push(review_artifact.path.clone());
                self.emit(&sink, "task:review", &task.task_id, json!(review));

                if decision.worker_type == WorkerType::WorkManual {
                    task.status = TaskStatus::AwaitingInput;
                } else if review.score >= settings.quality_threshold {
                    task.status = TaskStatus::Completed;
                    task.legacy_status = "Done".into();
                    task.completed_at = Some(now_string());
                } else if review.score >= 75 && task.attempt_count < task.max_attempts {
                    task.status = TaskStatus::Queued;
                    task.legacy_status = "Today".into();
                } else if review.score >= 60
                    && settings.auto_escalation
                    && task.attempt_count < task.max_attempts
                {
                    task.requested_reasoning = Some(escalate(decision.reasoning));
                    task.status = TaskStatus::Queued;
                    task.legacy_status = "Today".into();
                } else {
                    task.status = TaskStatus::AwaitingInput;
                    task.legacy_status = "Waiting".into();
                }
                let package = final_review_package(&task, &decision, &review, &output.content);
                let package_artifact = artifacts::save(
                    &root,
                    &task.task_id,
                    "final-review-package.md",
                    "final-review",
                    &package,
                )?;
                self.repository.add_artifact(&package_artifact)?;
                task.artifact_paths.push(package_artifact.path);
                task.lease_owner = None;
                task.lease_expires_at = None;
                task.last_updated = now_string();
                self.repository.update(&task)?;
                let event = if task.status == TaskStatus::Completed {
                    "task:completed"
                } else {
                    "task:updated"
                };
                self.emit(&sink, event, &task.task_id, json!(task));
                Ok(Some(task.clone()))
            }
            Err(error) => {
                run.status = if error.to_string().contains("cancelled") {
                    "CANCELLED"
                } else {
                    "FAILED"
                }
                .into();
                run.completed_at = Some(now_string());
                run.exit_code = Some(-1);
                run.error_message = Some(error.to_string());
                self.repository.add_run(&run)?;
                task.status = if run.status == "CANCELLED" {
                    TaskStatus::Cancelled
                } else {
                    TaskStatus::Failed
                };
                task.legacy_status = "Waiting".into();
                task.error_message = Some(error.to_string());
                task.lease_owner = None;
                task.lease_expires_at = None;
                task.auto_run = false;
                self.repository.update(&task)?;
                let event = if task.status == TaskStatus::Cancelled {
                    "task:cancelled"
                } else {
                    "task:failed"
                };
                self.emit(&sink, event, &task.task_id, json!(task));
                self.tick(Some(error.to_string()));
                Ok(Some(task.clone()))
            }
        }
    }

    pub async fn worker_health(&self, settings: &AppSettings) -> Vec<WorkerHealth> {
        vec![
            CodexWorker.health().await,
            LmStudioWorker::new(
                settings.lmstudio_endpoint.clone(),
                settings.lmstudio_default_model.clone(),
            )
            .health()
            .await,
            WorkManualWorker.health().await,
            MockWorker.health().await,
        ]
    }

    pub async fn model_capabilities(&self, settings: &AppSettings) -> Vec<ModelCapability> {
        let mut capabilities = Vec::new();
        if let Ok(raw) = run_capture(&["codex".into(), "debug".into(), "models".into()], None) {
            if let Ok(models) = serde_json::from_str::<serde_json::Value>(&raw) {
                let entries = models
                    .as_array()
                    .or_else(|| models.get("models").and_then(|value| value.as_array()))
                    .or_else(|| models.get("data").and_then(|value| value.as_array()));
                for model in entries.into_iter().flatten() {
                    let Some(name) = model.get("slug").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    let levels = model
                        .get("supported_reasoning_levels")
                        .and_then(|v| v.as_array())
                        .into_iter()
                        .flatten()
                        .filter_map(|item| {
                            item.get("effort")
                                .and_then(|v| v.as_str())
                                .and_then(parse_reasoning)
                        })
                        .collect();
                    capabilities.push(ModelCapability {
                        worker_type: WorkerType::Codex,
                        model: name.into(),
                        reasoning_levels: levels,
                        available: true,
                    });
                }
            }
        }
        let health = LmStudioWorker::new(
            settings.lmstudio_endpoint.clone(),
            settings.lmstudio_default_model.clone(),
        )
        .health()
        .await;
        capabilities.extend(health.models.into_iter().map(|model| ModelCapability {
            worker_type: WorkerType::LocalLlm,
            model,
            reasoning_levels: vec![ReasoningLevel::Low],
            available: health.status == Status::Ok,
        }));
        capabilities
    }

    fn emit(
        &self,
        sink: &Arc<dyn EventSink>,
        event_type: &str,
        task_id: &str,
        payload: serde_json::Value,
    ) {
        sink.emit(event_type, payload.clone());
        let _ = self.repository.add_event(&TaskEvent {
            event_id: uuid::Uuid::new_v4().to_string(),
            task_id: task_id.into(),
            event_type: event_type.into(),
            payload,
            created_at: now_string(),
        });
    }

    fn update_running(&self, delta: isize) {
        if let Ok(mut status) = self.status.lock() {
            status.running_tasks = status.running_tasks.saturating_add_signed(delta);
        }
    }

    fn tick(&self, error: Option<String>) {
        if let Ok(mut status) = self.status.lock() {
            status.last_tick_at = Some(now_string());
            status.last_error = error;
        }
    }
}

fn escalate(level: ReasoningLevel) -> ReasoningLevel {
    match level {
        ReasoningLevel::Low => ReasoningLevel::Medium,
        ReasoningLevel::Medium => ReasoningLevel::High,
        ReasoningLevel::High => ReasoningLevel::VeryHigh,
        other => other,
    }
}

fn parse_reasoning(value: &str) -> Option<ReasoningLevel> {
    match value {
        "low" => Some(ReasoningLevel::Low),
        "medium" => Some(ReasoningLevel::Medium),
        "high" => Some(ReasoningLevel::High),
        "xhigh" => Some(ReasoningLevel::VeryHigh),
        _ => None,
    }
}

fn final_review_package(
    task: &TaskCard,
    route: &RoutingDecision,
    review: &QualityReview,
    output: &str,
) -> String {
    format!(
        "# ChatGPT最終確認パッケージ\n\n## タスクの目的\n{}\n\n## 元情報\n{}\n\n## 情報源\n{}\n\n## ルーティング結果\n- Worker: {:?}\n- Model: {}\n- Reasoning: {:?}\n- Reason: {}\n\n## 成果物\n{}\n\n## AIレビュー\n- Score: {}\n- Decision: {}\n- Warnings: {}\n\n## 未確認事項\n{}\n\n## 西塚さんに判断してほしい項目\n外部公開・送信・マージ・削除が必要な場合は、内容を確認して承認してください。\n\n## 次に実施する操作\nAIRFLOW上で承認、差し戻し、またはアーカイブを選択してください。",
        task.objective, task.context, task.source_urls.join("\n"), route.worker_type,
        route.model.as_deref().unwrap_or("none"), route.reasoning, route.reason, output,
        review.score, review.decision, review.warnings.join(" / "),
        if review.warnings.is_empty() { "なし".into() } else { review.warnings.join("\n") },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestSink;
    impl EventSink for TestSink {
        fn emit(&self, _event: &str, _payload: serde_json::Value) {}
    }

    #[tokio::test]
    async fn mock_task_runs_end_to_end() {
        let repository = Arc::new(TaskRepository::memory().unwrap());
        let orchestrator = Orchestrator::new(repository.clone());
        let mut settings = crate::state::Cockpit::memory().settings();
        settings.artifact_root = std::env::temp_dir()
            .join(format!("jarvis-artifacts-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        let task = TaskCard {
            task_id: "mock-task".into(),
            title: "mock lifecycle".into(),
            objective: "verify lifecycle".into(),
            task_type: "test".into(),
            status: TaskStatus::Ready,
            auto_run: true,
            worker_type: Some(WorkerType::Mock),
            acceptance_criteria: vec!["artifact exists".into()],
            ..TaskCard::default()
        };
        repository.create(task).unwrap();
        let completed = orchestrator
            .run_once(settings.clone(), Arc::new(TestSink), None)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(completed.status, TaskStatus::Completed);
        assert!(!repository.artifacts("mock-task").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(settings.artifact_root);
    }

    #[tokio::test]
    async fn early_artifact_failure_recovers_claim_and_counter() {
        let repository = Arc::new(TaskRepository::memory().unwrap());
        let orchestrator = Orchestrator::new(repository.clone());
        let mut settings = crate::state::Cockpit::memory().settings();
        let invalid_root =
            std::env::temp_dir().join(format!("jarvis-artifact-file-{}", uuid::Uuid::new_v4()));
        std::fs::write(&invalid_root, b"not a directory").unwrap();
        settings.artifact_root = invalid_root.to_string_lossy().into_owned();
        repository
            .create(TaskCard {
                task_id: "artifact-failure".into(),
                title: "recover failed setup".into(),
                status: TaskStatus::Ready,
                auto_run: true,
                worker_type: Some(WorkerType::Mock),
                ..TaskCard::default()
            })
            .unwrap();

        assert!(orchestrator
            .run_once(settings, Arc::new(TestSink), None)
            .await
            .is_err());
        let recovered = repository.get("artifact-failure").unwrap().unwrap();
        assert_eq!(recovered.status, TaskStatus::Failed);
        assert!(recovered.lease_owner.is_none());
        assert_eq!(orchestrator.status().running_tasks, 0);

        let _ = std::fs::remove_file(invalid_root);
    }
}
