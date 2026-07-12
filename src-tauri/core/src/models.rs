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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskStatus {
    #[default]
    Draft,
    Ready,
    Queued,
    Routing,
    Running,
    AiReview,
    AwaitingInput,
    AwaitingApproval,
    Completed,
    Failed,
    Cancelled,
    Archived,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskPriority {
    Low,
    #[default]
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkerType {
    LocalLlm,
    Codex,
    WorkManual,
    Human,
    Mock,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ReasoningLevel {
    Low,
    #[default]
    Medium,
    High,
    VeryHigh,
    Max,
    Ultra,
}

fn default_max_attempts() -> u32 {
    3
}

fn default_timeout_seconds() -> u64 {
    900
}

/// Durable automation task. Legacy AirFlow ticket fields remain during migration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TaskCard {
    // Legacy compatibility fields.
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub category: String,
    pub legacy_status: String,
    pub priority: u8,
    pub assignee: String,
    pub risk_score: f32,
    pub created: String,
    pub updated: String,
    pub due: Option<String>,
    pub source: String,
    pub tier: u8,
    pub decision_required: bool,
    pub dependencies: Vec<String>,
    pub links: Vec<String>,
    pub log: Vec<String>,

    // Automation schema.
    pub parent_task_id: Option<String>,
    pub description: String,
    pub objective: String,
    pub task_type: String,
    pub status: TaskStatus,
    pub task_priority: TaskPriority,
    pub worker_type: Option<WorkerType>,
    pub requested_model: Option<String>,
    pub selected_model: Option<String>,
    pub requested_reasoning: Option<ReasoningLevel>,
    pub selected_reasoning: Option<ReasoningLevel>,
    pub routing_reason: Option<String>,
    pub auto_run: bool,
    pub requires_human_approval: bool,
    pub instructions: String,
    pub context: String,
    pub input_refs: Vec<String>,
    pub source_urls: Vec<String>,
    pub output_format: String,
    pub acceptance_criteria: Vec<String>,
    pub max_attempts: u32,
    pub attempt_count: u32,
    pub timeout_seconds: u64,
    pub created_at: String,
    pub last_updated: String,
    pub queued_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub result_summary: Option<String>,
    pub artifact_paths: Vec<String>,
    pub error_message: Option<String>,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<String>,
}

impl Default for TaskCard {
    fn default() -> Self {
        Self {
            id: String::new(),
            task_id: String::new(),
            title: String::new(),
            category: "Business".into(),
            legacy_status: "Inbox".into(),
            priority: 2,
            assignee: "human".into(),
            risk_score: 1.0,
            created: String::new(),
            updated: String::new(),
            due: None,
            source: "manual".into(),
            tier: 1,
            decision_required: false,
            dependencies: Vec::new(),
            links: Vec::new(),
            log: Vec::new(),
            parent_task_id: None,
            description: String::new(),
            objective: String::new(),
            task_type: "general".into(),
            status: TaskStatus::Draft,
            task_priority: TaskPriority::Medium,
            worker_type: None,
            requested_model: None,
            selected_model: None,
            requested_reasoning: None,
            selected_reasoning: None,
            routing_reason: None,
            auto_run: false,
            requires_human_approval: false,
            instructions: String::new(),
            context: String::new(),
            input_refs: Vec::new(),
            source_urls: Vec::new(),
            output_format: "markdown".into(),
            acceptance_criteria: Vec::new(),
            max_attempts: default_max_attempts(),
            attempt_count: 0,
            timeout_seconds: default_timeout_seconds(),
            created_at: String::new(),
            last_updated: String::new(),
            queued_at: None,
            started_at: None,
            completed_at: None,
            result_summary: None,
            artifact_paths: Vec::new(),
            error_message: None,
            lease_owner: None,
            lease_expires_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRun {
    pub run_id: String,
    pub task_id: String,
    pub worker_type: WorkerType,
    pub model: Option<String>,
    pub reasoning: Option<ReasoningLevel>,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub exit_code: Option<i32>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskArtifact {
    pub artifact_id: String,
    pub task_id: String,
    pub kind: String,
    pub path: String,
    pub media_type: String,
    pub size_bytes: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingDecision {
    pub worker_type: WorkerType,
    pub model: Option<String>,
    pub reasoning: ReasoningLevel,
    pub reason: String,
    pub estimated_size: String,
    pub escalation_condition: String,
    pub requires_human_approval: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerHealth {
    pub worker_type: WorkerType,
    pub status: Status,
    pub models: Vec<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OrchestratorMode {
    Stopped,
    Running,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorStatus {
    pub mode: OrchestratorMode,
    pub enabled: bool,
    pub poll_interval_seconds: u64,
    pub running_tasks: usize,
    pub last_tick_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityReview {
    pub score: u8,
    pub factuality: u8,
    pub objective: u8,
    pub structure: u8,
    pub originality: u8,
    pub medium_fit: u8,
    pub readability: u8,
    pub warnings: Vec<String>,
    pub decision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCapability {
    pub worker_type: WorkerType,
    pub model: String,
    pub reasoning_levels: Vec<ReasoningLevel>,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskEvent {
    pub event_id: String,
    pub task_id: String,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalDecision {
    pub approval_id: String,
    pub task_id: String,
    pub decision: String,
    pub feedback: Option<String>,
    pub actor: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub airflow_store_path: String,
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
    /// 課金事故防止: 従量課金系APIキーがあるか（§9）。
    pub openai_api_key_present: bool,
    pub detected_api_keys: Vec<String>,
    pub database_path: String,
    pub database_error: Option<String>,
    pub orchestrator_enabled: bool,
    pub orchestrator_auto_start: bool,
    pub poll_interval_seconds: u64,
    pub max_concurrency: usize,
    pub codex_concurrency: usize,
    pub lmstudio_concurrency: usize,
    pub codex_default_reasoning: ReasoningLevel,
    pub luna_model: String,
    pub terra_model: String,
    pub sol_model: String,
    pub lmstudio_default_model: String,
    pub auto_escalation: bool,
    pub quality_threshold: u8,
    pub max_retries: u32,
    pub artifact_root: String,
    pub log_retention_days: u32,
}
