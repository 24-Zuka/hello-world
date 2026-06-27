//! Tauri commands (§7.1) — `core::commands` への薄いラッパ。
//!
//! 実体は GUI 非依存の `jarvis_cockpit_core` にある。ここでは Tauri の
//! `State<Cockpit>` / `AppHandle` を core の `&Cockpit` / `Arc<dyn EventSink>` に
//! 橋渡しするだけ（§1 薄いラッパー）。

use std::sync::Arc;

use jarvis_cockpit_core as core;
use jarvis_cockpit_core::models::*;
use jarvis_cockpit_core::{Cockpit, EventSink};
use tauri::{AppHandle, Emitter, State};

/// Tauri 向け EventSink。core の job:* / notify を `app.emit` へ中継する。
pub struct TauriSink(pub AppHandle);

impl EventSink for TauriSink {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = Emitter::emit(&self.0, event, payload);
    }
}

fn sink(app: AppHandle) -> Arc<dyn EventSink> {
    Arc::new(TauriSink(app))
}

// ── ヘルス / 認証 / クォータ ────────────────────────────────────────────────

#[tauri::command]
pub async fn health_check(state: State<'_, Cockpit>) -> Result<Health, String> {
    core::commands::health_check(state.inner()).await
}

#[tauri::command]
pub fn codex_auth_status() -> Result<AuthStatus, String> {
    core::commands::codex_auth_status()
}

#[tauri::command]
pub async fn codex_login(app: AppHandle) -> Result<String, String> {
    core::commands::codex_login(sink(app)).await
}

#[tauri::command]
pub fn quota_status(state: State<'_, Cockpit>) -> Result<Quota, String> {
    core::commands::quota_status(state.inner())
}

// ── MCP ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn mcp_list() -> Result<Vec<McpServer>, String> {
    core::commands::mcp_list()
}

#[tauri::command]
pub fn mcp_toggle(name: String, enabled: bool) -> Result<(), String> {
    core::commands::mcp_toggle(name, enabled)
}

// ── Build / Worktree / git ──────────────────────────────────────────────────

#[tauri::command]
pub fn worktree_list(state: State<'_, Cockpit>, repo: String) -> Result<Vec<Worktree>, String> {
    core::commands::worktree_list(state.inner(), repo)
}

#[tauri::command]
pub fn worktree_create(state: State<'_, Cockpit>, repo: String, feature: String) -> Result<Worktree, String> {
    core::commands::worktree_create(state.inner(), repo, feature)
}

#[tauri::command]
pub async fn codex_build(
    app: AppHandle,
    state: State<'_, Cockpit>,
    worktree: String,
    prompt: String,
    profile: Option<String>,
) -> Result<String, String> {
    core::commands::codex_build(sink(app), state.inner(), worktree, prompt, profile).await
}

#[tauri::command]
pub async fn local_review(
    app: AppHandle,
    state: State<'_, Cockpit>,
    worktree: String,
    base: String,
) -> Result<String, String> {
    core::commands::local_review(sink(app), state.inner(), worktree, base).await
}

#[tauri::command]
pub fn git_diff(worktree: String, base: String) -> Result<String, String> {
    core::commands::git_diff(worktree, base)
}

#[tauri::command]
pub fn git_merge(worktree: String, base: String) -> Result<(), String> {
    core::commands::git_merge(worktree, base)
}

// ── Memory / Vault ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_tree(state: State<'_, Cockpit>) -> Result<Vec<VaultNode>, String> {
    core::commands::vault_tree(state.inner()).await
}

#[tauri::command]
pub async fn vault_read(state: State<'_, Cockpit>, path: String) -> Result<String, String> {
    core::commands::vault_read(state.inner(), path).await
}

#[tauri::command]
pub async fn vault_write(
    state: State<'_, Cockpit>,
    path: String,
    content: String,
    mode: String,
    heading: Option<String>,
) -> Result<(), String> {
    core::commands::vault_write(state.inner(), path, content, mode, heading).await
}

#[tauri::command]
pub async fn vault_delete(state: State<'_, Cockpit>, path: String) -> Result<(), String> {
    core::commands::vault_delete(state.inner(), path).await
}

#[tauri::command]
pub async fn vault_search(state: State<'_, Cockpit>, query: String) -> Result<Vec<SearchHit>, String> {
    core::commands::vault_search(state.inner(), query).await
}

// ── Schedule / launchd ──────────────────────────────────────────────────────

#[tauri::command]
pub fn launchd_list() -> Result<Vec<ScheduleJob>, String> {
    core::commands::launchd_list()
}

#[tauri::command]
pub fn launchd_toggle(label: String, on: bool) -> Result<(), String> {
    core::commands::launchd_toggle(label, on)
}

#[tauri::command]
pub async fn launchd_run_now(app: AppHandle, state: State<'_, Cockpit>, label: String) -> Result<String, String> {
    core::commands::launchd_run_now(sink(app), state.inner(), label).await
}

#[tauri::command]
pub fn launchd_set_time(label: String, hour: u8, minute: u8) -> Result<(), String> {
    core::commands::launchd_set_time(label, hour, minute)
}

// ── Research ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn research_scan(app: AppHandle, state: State<'_, Cockpit>, topic: String) -> Result<String, String> {
    core::commands::research_scan(sink(app), state.inner(), topic).await
}

// ── Config / Settings / Secrets ─────────────────────────────────────────────

#[tauri::command]
pub fn config_get_model(state: State<'_, Cockpit>) -> Result<String, String> {
    core::commands::config_get_model(state.inner())
}

#[tauri::command]
pub fn config_set_model(state: State<'_, Cockpit>, model: String) -> Result<(), String> {
    core::commands::config_set_model(state.inner(), model)
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    core::commands::secret_set(key, value)
}

#[tauri::command]
pub fn settings_get(state: State<'_, Cockpit>) -> Result<AppSettings, String> {
    core::commands::settings_get(state.inner())
}

#[tauri::command]
pub fn settings_set(state: State<'_, Cockpit>, patch: serde_json::Value) -> Result<AppSettings, String> {
    core::commands::settings_set(state.inner(), patch)
}
