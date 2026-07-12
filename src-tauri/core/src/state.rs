//! アプリ状態。設定はメモリ保持し、秘匿値（トークン）は含めない（§9）。

use std::sync::{Arc, Mutex};

use crate::models::AppSettings;
use crate::orchestrator::{Orchestrator, TaskRepository};

pub struct Cockpit {
    settings: Mutex<AppSettings>,
    repository: Arc<TaskRepository>,
    orchestrator: Arc<Orchestrator>,
}

impl Default for Cockpit {
    fn default() -> Self {
        Self::new()
    }
}

impl Cockpit {
    pub fn new() -> Self {
        Self::build(false)
    }

    #[cfg(test)]
    pub fn memory() -> Self {
        Self::build(true)
    }

    fn build(in_memory: bool) -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        let airflow_store_path = format!("{home}/Library/Application Support/AirFlow");
        let app_support = format!("{home}/Library/Application Support/JARVIS Cockpit");
        let detected_api_keys = ["OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]
            .iter()
            .filter(|name| std::env::var(name).ok().filter(|v| !v.is_empty()).is_some())
            .map(|name| (*name).to_string())
            .collect::<Vec<_>>();
        let database_path = std::env::var("JARVIS_DATABASE_PATH")
            .unwrap_or_else(|_| format!("{app_support}/jarvis.sqlite3"));
        let artifact_root = std::env::var("JARVIS_ARTIFACT_ROOT")
            .unwrap_or_else(|_| format!("{app_support}/workspace/tasks"));
        let mut settings = AppSettings {
            airflow_store_path,
            vault_path: format!("{home}/Obsidian/Vault"),
            repos_parent: format!("{home}/dev"),
            scripts_path: format!("{home}/.codex/scripts"),
            workspace_root: format!("{home}/jarvis-workspace"),
            lmstudio_endpoint: "http://localhost:1234".into(),
            obsidian_endpoint: "http://127.0.0.1:27123".into(),
            default_model: "gpt-5.4-mini".into(),
            retreat_mode: false,
            openai_api_key_present: !detected_api_keys.is_empty(),
            detected_api_keys,
            database_path,
            database_error: None,
            orchestrator_enabled: true,
            orchestrator_auto_start: false,
            poll_interval_seconds: 5,
            max_concurrency: 2,
            codex_concurrency: 1,
            lmstudio_concurrency: 1,
            codex_default_reasoning: crate::models::ReasoningLevel::Medium,
            luna_model: String::new(),
            terra_model: String::new(),
            sol_model: String::new(),
            lmstudio_default_model: std::env::var("JARVIS_LMSTUDIO_MODEL").unwrap_or_default(),
            auto_escalation: true,
            quality_threshold: 85,
            max_retries: 3,
            artifact_root,
            log_retention_days: 30,
        };
        let repository = Arc::new(if in_memory {
            TaskRepository::memory().expect("in-memory task repository")
        } else {
            match TaskRepository::open(&settings.database_path) {
                Ok(repository) => repository,
                Err(error) => {
                    settings.database_error = Some(format!(
                        "SQLiteを開けないため一時メモリDBで起動しました: {error}"
                    ));
                    TaskRepository::memory().expect("in-memory task repository")
                }
            }
        });
        let orchestrator = Arc::new(Orchestrator::new(repository.clone()));
        Self {
            settings: Mutex::new(settings),
            repository,
            orchestrator,
        }
    }

    pub fn settings(&self) -> AppSettings {
        self.settings.lock().unwrap().clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut AppSettings)) {
        let mut s = self.settings.lock().unwrap();
        f(&mut s);
    }

    pub fn repository(&self) -> Arc<TaskRepository> {
        self.repository.clone()
    }

    pub fn orchestrator(&self) -> Arc<Orchestrator> {
        self.orchestrator.clone()
    }
}
