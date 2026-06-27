//! JARVIS Cockpit — Tauri バックエンド。
//! GUI は薄いラッパー(§1)。頭脳は Codex / ローカルモデルに置き、本層は
//! 「状態の表示」と「操作の発火」に徹する。

mod commands;
mod exec;
mod mock;
mod models;
mod obsidian;
mod secrets;
mod state;

use std::time::Duration;

use tauri::{Emitter, Manager};

use state::Cockpit;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Cockpit::new())
        .setup(|app| {
            // health:tick / quota:tick の定期 emit（§7.2, §10 5秒間隔）。
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_secs(5));
                loop {
                    ticker.tick().await;
                    let state = handle.state::<Cockpit>();
                    if let Ok(h) = commands::health_check(state.clone()).await {
                        let _ = handle.emit("health:tick", h);
                    }
                    if let Ok(q) = commands::quota_status(state) {
                        let _ = handle.emit("quota:tick", q);
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health_check,
            commands::codex_auth_status,
            commands::codex_login,
            commands::quota_status,
            commands::mcp_list,
            commands::mcp_toggle,
            commands::worktree_list,
            commands::worktree_create,
            commands::codex_build,
            commands::local_review,
            commands::git_diff,
            commands::git_merge,
            commands::vault_tree,
            commands::vault_read,
            commands::vault_write,
            commands::vault_delete,
            commands::vault_search,
            commands::launchd_list,
            commands::launchd_toggle,
            commands::launchd_run_now,
            commands::launchd_set_time,
            commands::research_scan,
            commands::config_get_model,
            commands::config_set_model,
            commands::secret_set,
            commands::settings_get,
            commands::settings_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JARVIS Cockpit");
}
