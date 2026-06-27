//! 共有データモデル (§8)。フロントの `src/types.ts` と命名を一致させる。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Warn,
    Down,
    Unknown,
}

/// §7.1 health_check の戻り値。
#[derive(Debug, Clone, Serialize)]
pub struct Health {
    pub codex: Status,
    pub lmstudio: Status,
    pub obsidian: Status,
    /// 赤がある場合の一言（§4.1 ヘルスバー）。
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Chatgpt,
    Api,
    None,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthStatus {
    pub logged_in: bool,
    pub method: AuthMethod,
}

/// §12: Plus制限は公式APIなし。取得不能時は source=unknown で「不明」表示。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum QuotaSource {
    Parsed,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct Quota {
    pub window_used: i64,
    pub window_limit: i64,
    pub resets_at: Option<String>,
    pub weekly: Option<WeeklyQuota>,
    pub source: QuotaSource,
}

#[derive(Debug, Clone, Serialize)]
pub struct WeeklyQuota {
    pub used: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpServer {
    pub name: String,
    pub enabled: bool,
    pub transport: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Worktree {
    pub repo: String,
    pub path: String,
    pub branch: String,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct VaultNode {
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String, // "dir" | "note"
    pub children: Option<Vec<VaultNode>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub path: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScheduleJob {
    pub label: String,
    pub next_run: Option<String>,
    pub loaded: bool,
    pub last_result: Option<String>,
}

/// §14.4 タスクカード JSON スキーマ。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskCard {
    pub task_id: String,
    pub title: String,
    pub assignee: String,
    pub status: String,
    pub priority: String,
    pub risk_score: f32,
    pub dependencies: Vec<String>,
    pub last_updated: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub vault_path: String,
    pub repos_parent: String,
    pub scripts_path: String,
    pub workspace_root: String,
    pub lmstudio_endpoint: String,
    pub obsidian_endpoint: String,
    /// 既定モデル（gpt-5.5 / gpt-5.4 / gpt-5.4-mini）。
    pub default_model: String,
    /// 退避モード（§4.7）。ON時は全実行を local_review へ。
    pub retreat_mode: bool,
    /// 課金事故防止: 環境に OPENAI_API_KEY があるか（§9）。
    pub openai_api_key_present: bool,
}
