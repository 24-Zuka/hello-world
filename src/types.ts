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

// §14.4 タスクカード JSON スキーマ。
export interface TaskCard {
  task_id: string;
  title: string;
  assignee: string;
  status: "TODO" | "IN_PROGRESS" | "AWAITING_DECISION" | "PENDING_REVIEW" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  risk_score: number;
  dependencies: string[];
  last_updated: string;
}

export interface AppSettings {
  vault_path: string;
  repos_parent: string;
  scripts_path: string;
  workspace_root: string;
  lmstudio_endpoint: string;
  obsidian_endpoint: string;
  default_model: string;
  retreat_mode: boolean;
  openai_api_key_present: boolean;
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
  | "agents"
  | "build"
  | "memory"
  | "schedule"
  | "research"
  | "quota"
  | "settings";
