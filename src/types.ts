// §8 データモデル（フロント状態）。Rust の models.rs と命名を一致させる。

export type Status = "ok" | "warn" | "down" | "unknown";

export interface Health {
  codex: Status;
  lmstudio: Status;
  obsidian: Status;
  note?: string | null;
}

export type AuthMethod = "chatgpt" | "api" | "none";
export interface AuthStatus {
  logged_in: boolean;
  method: AuthMethod;
}

export type QuotaSource = "parsed" | "unknown";
export interface Quota {
  window_used: number;
  window_limit: number;
  resets_at?: string | null;
  weekly?: { used: number; limit: number } | null;
  source: QuotaSource;
}

export interface McpServer {
  name: string;
  enabled: boolean;
  transport: string;
}

// 組織図ノード（§4.2）。authority: solo=単独可 / approval=要承認。
export interface Agent {
  id: string;
  name: string;
  role: string;
  model?: string;
  authority: "solo" | "approval";
  status: "idle" | "running";
  mdPath: string;
  parent?: string;
}

export interface Worktree {
  repo: string;
  path: string;
  branch: string;
  dirty: boolean;
}

export interface Job {
  id: string;
  kind: "build" | "review" | "research" | "morning";
  worktree?: string;
  status: "queued" | "running" | "done" | "error";
  logs: string[];
}

export interface VaultNode {
  path: string;
  type: "dir" | "note";
  children?: VaultNode[];
}

export interface SearchHit {
  path: string;
  snippet: string;
}

export interface ScheduleJob {
  label: string;
  next_run?: string | null;
  loaded: boolean;
  last_result?: string | null;
}

export type AirFlowStatus = "Inbox" | "Today" | "Doing" | "Waiting" | "Done";
export type AirFlowCategory = "Business" | "Engineering" | "Content";
export type AirFlowAssignee = "codex" | "lmstudio" | "gemini" | "human";
export type TaskStatus = "DRAFT" | "READY" | "QUEUED" | "ROUTING" | "RUNNING" | "AI_REVIEW" | "AWAITING_INPUT" | "AWAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED" | "ARCHIVED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type WorkerType = "local_llm" | "codex" | "work_manual" | "human" | "mock";
export type ReasoningLevel = "low" | "medium" | "high" | "very_high" | "max" | "ultra";

// AirFlow完全版 §4.3: Markdown/YAML と GUI JSON ビューの共通 TaskCard。
export interface TaskCard {
  id: string;
  task_id: string;
  title: string;
  category: AirFlowCategory;
  legacy_status: AirFlowStatus;
  priority: 1 | 2 | 3;
  risk_score: number;
  created: string;
  updated: string;
  due?: string | null;
  source: "email" | "manual" | "obsidian-inbox" | "ai";
  assignee: AirFlowAssignee;
  tier: 1 | 2 | 3;
  decision_required: boolean;
  dependencies: string[];
  links: string[];
  log: string[];
  parent_task_id?: string | null;
  description: string;
  objective: string;
  task_type: string;
  status: TaskStatus;
  task_priority: TaskPriority;
  worker_type?: WorkerType | null;
  requested_model?: string | null;
  selected_model?: string | null;
  requested_reasoning?: ReasoningLevel | null;
  selected_reasoning?: ReasoningLevel | null;
  routing_reason?: string | null;
  auto_run: boolean;
  requires_human_approval: boolean;
  instructions: string;
  context: string;
  input_refs: string[];
  source_urls: string[];
  output_format: string;
  acceptance_criteria: string[];
  max_attempts: number;
  attempt_count: number;
  timeout_seconds: number;
  created_at: string;
  last_updated: string;
  queued_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  result_summary?: string | null;
  artifact_paths: string[];
  error_message?: string | null;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
}

export interface RoutingDecision {
  worker_type: WorkerType;
  model?: string | null;
  reasoning: ReasoningLevel;
  reason: string;
  estimated_size: string;
  escalation_condition: string;
  requires_human_approval: boolean;
}

export interface TaskArtifact {
  artifact_id: string;
  task_id: string;
  kind: string;
  path: string;
  media_type: string;
  size_bytes: number;
  created_at: string;
}

export interface OrchestratorStatus {
  mode: "stopped" | "running" | "paused";
  enabled: boolean;
  poll_interval_seconds: number;
  running_tasks: number;
  last_tick_at?: string | null;
  last_error?: string | null;
}

export interface WorkerHealth {
  worker_type: WorkerType;
  status: Status;
  models: string[];
  note?: string | null;
}

export interface ModelCapability {
  worker_type: WorkerType;
  model: string;
  reasoning_levels: ReasoningLevel[];
  available: boolean;
}

export interface AppSettings {
  airflow_store_path: string;
  vault_path: string;
  repos_parent: string;
  scripts_path: string;
  workspace_root: string;
  lmstudio_endpoint: string;
  obsidian_endpoint: string;
  default_model: string;
  retreat_mode: boolean;
  openai_api_key_present: boolean;
  detected_api_keys: string[];
  database_path: string;
  database_error?: string | null;
  orchestrator_enabled: boolean;
  orchestrator_auto_start: boolean;
  poll_interval_seconds: number;
  max_concurrency: number;
  codex_concurrency: number;
  lmstudio_concurrency: number;
  codex_default_reasoning: ReasoningLevel;
  luna_model: string;
  terra_model: string;
  sol_model: string;
  lmstudio_default_model: string;
  auto_escalation: boolean;
  quality_threshold: number;
  max_retries: number;
  artifact_root: string;
  log_retention_days: number;
}

// 承認モーダル（§5, §14.3）。risk_score>=3.0 か §9 権限表で必須。
export interface ApprovalRequest {
  title: string;
  description: string;
  target: string;
  riskScore: number;
  onApprove: () => void | Promise<void>;
  onReject?: () => void;
  onFeedback?: (note: string) => void;
}

export type ReviewSeverity = "HIGH" | "MEDIUM" | "LOW";
export interface ReviewFinding {
  severity: ReviewSeverity;
  file: string;
  line?: number;
  message: string;
}

export type ScreenId =
  | "dashboard"
  | "tasks"
  | "agents"
  | "build"
  | "memory"
  | "schedule"
  | "research"
  | "quota"
  | "settings";
