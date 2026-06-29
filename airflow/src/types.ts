// AIRFLOW data model (§6).

export type Status =
  | "needs-ai"
  | "needs-human"
  | "in-progress"
  | "done"
  | "blocked";

export type Owner = "human" | "ai-batch" | "ai-interactive";

export type Priority = "P0" | "P1" | "P2" | "P3";

export type ActionType =
  | "content"
  | "research"
  | "review"
  | "publish"
  | "setup"
  | "other";

export interface ActivityEntry {
  timestamp: string; // UTC ISO8601
  actor: string; // human | ai-batch | ai-interactive (resolved from token)
  action: string; // free-text description of what happened
}

export interface Task {
  id: string; // "T0001"…
  title: string;
  status: Status;
  owner: Owner;
  priority: Priority;
  action_type: ActionType;
  handoff_note: string;
  blocked_reason: string | null;
  tags: string[];
  created_at: string; // UTC ISO8601
  updated_at: string; // UTC ISO8601
  activity: ActivityEntry[];
}

export const STATUSES: Status[] = [
  "needs-ai",
  "in-progress",
  "needs-human",
  "blocked",
  "done",
];

export const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];

// Fields a client is allowed to send when creating a task. `id`, timestamps and
// `activity` are server-owned and never accepted from the client.
export interface CreateTaskInput {
  title: string;
  status?: Status;
  owner?: Owner;
  priority?: Priority;
  action_type?: ActionType;
  handoff_note?: string;
  blocked_reason?: string | null;
  tags?: string[];
}

// Fields a client may PATCH. Server always overrides updated_at/activity.
export type PatchTaskInput = Partial<
  Pick<
    Task,
    | "title"
    | "status"
    | "owner"
    | "priority"
    | "action_type"
    | "handoff_note"
    | "blocked_reason"
    | "tags"
  >
> & {
  // optional human-readable note for the activity log entry this PATCH produces
  action?: string;
};
