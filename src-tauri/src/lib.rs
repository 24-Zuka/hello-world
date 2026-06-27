//! JARVIS Cockpit — Tauri バックエンド（デスクトップ・トランスポート）。
//! GUI は薄いラッパー(§1)。頭脳は GUI 非依存の `jarvis_cockpit_core` に置き、
//! 本層は core コマンドを Tauri の invoke/emit に橋渡しするだけ。

mod commands;

use std::time::Duration;

use jarvis_cockpit_core::Cockpit;
use tauri::{Emitter, Manager};

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
                    if let Ok(h) = jarvis_cockpit_core::commands::health_check(state.inner()).await {
                        let _ = handle.emit("health:tick", h);
                    }
                    if let Ok(q) = jarvis_cockpit_core::commands::quota_status(state.inner()) {
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
