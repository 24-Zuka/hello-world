//! アプリ状態。設定はメモリ保持し、秘匿値（トークン）は含めない（§9）。

use std::sync::Mutex;

use crate::models::AppSettings;

pub struct Cockpit {
    settings: Mutex<AppSettings>,
}

impl Cockpit {
    pub fn new() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        Self {
            settings: Mutex::new(AppSettings {
                vault_path: format!("{home}/Obsidian/Vault"),
                repos_parent: format!("{home}/dev"),
                scripts_path: format!("{home}/.codex/scripts"),
                workspace_root: format!("{home}/jarvis-workspace"),
                lmstudio_endpoint: "http://localhost:1234".into(),
                obsidian_endpoint: "http://127.0.0.1:27123".into(),
                default_model: "gpt-5.4-mini".into(),
                retreat_mode: false,
                // §9: 環境に OPENAI_API_KEY があれば赤旗。起動時に検出。
                openai_api_key_present: std::env::var("OPENAI_API_KEY")
                    .ok()
                    .filter(|v| !v.is_empty())
                    .is_some(),
            }),
        }
    }

    pub fn settings(&self) -> AppSettings {
        self.settings.lock().unwrap().clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut AppSettings)) {
        let mut s = self.settings.lock().unwrap();
        f(&mut s);
    }
}
