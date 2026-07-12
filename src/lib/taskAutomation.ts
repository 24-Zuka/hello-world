import type { TaskCard, TaskStatus } from "../types";

export const TASK_COLUMNS: { label: string; statuses: TaskStatus[] }[] = [
  { label: "下書き", statuses: ["DRAFT"] },
  { label: "実行待ち", statuses: ["READY", "QUEUED", "ROUTING"] },
  { label: "実行中", statuses: ["RUNNING"] },
  { label: "AI確認", statuses: ["AI_REVIEW"] },
  { label: "人間確認", statuses: ["AWAITING_INPUT", "AWAITING_APPROVAL"] },
  { label: "完了", statuses: ["COMPLETED", "ARCHIVED"] },
  { label: "失敗", statuses: ["FAILED", "CANCELLED"] },
];

export function createTaskDraft(): TaskCard {
  return {
    id: "",
    task_id: "",
    title: "",
    category: "Business",
    legacy_status: "Inbox",
    priority: 2,
    assignee: "human",
    risk_score: 1,
    created: "",
    updated: "",
    due: null,
    source: "manual",
    tier: 1,
    decision_required: false,
    dependencies: [],
    links: [],
    log: [],
    parent_task_id: null,
    description: "",
    objective: "",
    task_type: "general",
    status: "DRAFT",
    task_priority: "MEDIUM",
    worker_type: null,
    requested_model: null,
    selected_model: null,
    requested_reasoning: null,
    selected_reasoning: null,
    routing_reason: null,
    auto_run: false,
    requires_human_approval: false,
    instructions: "",
    context: "",
    input_refs: [],
    source_urls: [],
    output_format: "markdown",
    acceptance_criteria: [],
    max_attempts: 3,
    attempt_count: 0,
    timeout_seconds: 900,
    created_at: "",
    last_updated: "",
    queued_at: null,
    started_at: null,
    completed_at: null,
    result_summary: null,
    artifact_paths: [],
    error_message: null,
    lease_owner: null,
    lease_expires_at: null,
  };
}

export function tasksForColumn(tasks: TaskCard[], statuses: TaskStatus[]): TaskCard[] {
  return tasks.filter((task) => statuses.includes(task.status));
}

export function validateImportPayload(payload: string): string | null {
  if (!payload.trim()) return "取込内容を貼り付けてください。";
  if (new TextEncoder().encode(payload).length > 2 * 1024 * 1024) return "取込内容は2 MiB以下にしてください。";
  return null;
}

export function previewImportPayload(payload: string): { count: number; titles: string[]; format: "JSON" | "Markdown" } | null {
  if (validateImportPayload(payload)) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const titles = rows
      .map((row) => row && typeof row === "object" && "title" in row ? String(row.title) : "Untitled")
      .slice(0, 5);
    return { count: rows.length, titles, format: "JSON" };
  } catch {
    const heading = payload.split("\n").find((line) => line.startsWith("# "))?.slice(2).trim();
    return { count: 1, titles: [heading || "Imported task"], format: "Markdown" };
  }
}
