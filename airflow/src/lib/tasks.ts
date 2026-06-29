// Task domain logic (§5, §6, §7, §11). Pure helpers operate on in-memory arrays
// so the API routes and the dispatcher share one source of truth.

import type {
  ActivityEntry,
  CreateTaskInput,
  PatchTaskInput,
  Owner,
  Priority,
  Task,
} from "@/types";
import { PRIORITIES, STATUSES } from "@/types";

export function nowIso(): string {
  return new Date().toISOString();
}

/** Next unique id across board + archive: max numeric suffix + 1, "T%04d". */
export function nextId(board: Task[], archive: Task[]): string {
  let max = 0;
  for (const t of [...board, ...archive]) {
    const n = parseInt(String(t.id).replace(/^T/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return "T" + String(max + 1).padStart(4, "0");
}

/** §11.5 duplicate prevention: same title already on the board (case-insensitive). */
export function findDuplicate(board: Task[], title: string): Task | undefined {
  const norm = title.trim().toLowerCase();
  return board.find((t) => t.title.trim().toLowerCase() === norm);
}

export function buildTask(
  input: CreateTaskInput,
  id: string,
  actor: Owner,
): Task {
  const ts = nowIso();
  const status = input.status ?? "needs-ai";
  return {
    id,
    title: input.title,
    status,
    owner: input.owner ?? "ai-batch",
    priority: input.priority ?? "P2",
    action_type: input.action_type ?? "other",
    handoff_note: input.handoff_note ?? "",
    blocked_reason: status === "blocked" ? input.blocked_reason ?? null : null,
    tags: input.tags ?? [],
    created_at: ts,
    updated_at: ts,
    activity: [{ timestamp: ts, actor, action: "created" }],
  };
}

/**
 * Apply a partial update (§5 PATCH semantics): merge only provided fields,
 * always bump updated_at and append exactly one activity entry.
 */
export function applyPatch(
  task: Task,
  patch: PatchTaskInput,
  actor: Owner | string,
): Task {
  const next: Task = { ...task };
  const changed: string[] = [];

  const assign = <K extends keyof Task>(key: K, value: Task[K]) => {
    next[key] = value;
    changed.push(String(key));
  };

  if (patch.title !== undefined) assign("title", patch.title);
  if (patch.status !== undefined) assign("status", patch.status);
  if (patch.owner !== undefined) assign("owner", patch.owner);
  if (patch.priority !== undefined) assign("priority", patch.priority);
  if (patch.action_type !== undefined) assign("action_type", patch.action_type);
  if (patch.handoff_note !== undefined) assign("handoff_note", patch.handoff_note);
  if (patch.blocked_reason !== undefined)
    assign("blocked_reason", patch.blocked_reason);
  if (patch.tags !== undefined) assign("tags", patch.tags);

  // Keep blocked_reason consistent with status.
  if (next.status !== "blocked") next.blocked_reason = null;

  const ts = nowIso();
  next.updated_at = ts;
  const action =
    patch.action ??
    (changed.length ? `updated ${changed.join(", ")}` : "touched");
  const entry: ActivityEntry = { timestamp: ts, actor, action };
  next.activity = [...task.activity, entry];
  return next;
}

/** §7.1 — flip tasks untouched for >72h to blocked. Returns the mutated array
 *  plus the list of ids that changed. Pure: operates on a copy. */
export function sweepBlocked(
  board: Task[],
  thresholdHours = 72,
  now: Date = new Date(),
): { board: Task[]; blockedIds: string[] } {
  const cutoff = now.getTime() - thresholdHours * 3600 * 1000;
  const blockedIds: string[] = [];
  const out = board.map((t) => {
    if (t.status === "done" || t.status === "blocked") return t;
    const updated = Date.parse(t.updated_at);
    if (Number.isFinite(updated) && updated < cutoff) {
      blockedIds.push(t.id);
      return applyPatch(
        t,
        { status: "blocked", blocked_reason: "72時間変化なし", action: "auto-blocked: 72時間変化なし" },
        "dispatcher",
      );
    }
    return t;
  });
  return { board: out, blockedIds };
}

// ---- validation helpers (used by routes) ----

export function isValidStatus(v: unknown): v is Task["status"] {
  return typeof v === "string" && (STATUSES as string[]).includes(v);
}

export function isValidPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as string[]).includes(v);
}

const OWNERS: Owner[] = ["human", "ai-batch", "ai-interactive"];
export function isValidOwner(v: unknown): v is Owner {
  return typeof v === "string" && (OWNERS as string[]).includes(v);
}
