// GET  /api/board      → all active tasks (§5)
// POST /api/board      → create a task (auto id T0001…, dup-prevented §11.5)

import { guard, json, badRequest, conflict } from "@/lib/http";
import { transact } from "@/lib/storage";
import {
  buildTask,
  findDuplicate,
  isValidOwner,
  isValidPriority,
  isValidStatus,
  nextId,
} from "@/lib/tasks";
import type { CreateTaskInput } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = guard(req);
  if (!g.ok) return g.res;
  return transact(async ({ board }) => ({ result: json(board) }));
}

export async function POST(req: Request) {
  const g = guard(req);
  if (!g.ok) return g.res;

  let body: CreateTaskInput;
  try {
    body = (await req.json()) as CreateTaskInput;
  } catch {
    return badRequest("invalid JSON body");
  }

  if (!body || typeof body.title !== "string" || body.title.trim() === "") {
    return badRequest("title is required");
  }
  if (body.status !== undefined && !isValidStatus(body.status))
    return badRequest("invalid status");
  if (body.owner !== undefined && !isValidOwner(body.owner))
    return badRequest("invalid owner");
  if (body.priority !== undefined && !isValidPriority(body.priority))
    return badRequest("invalid priority");

  return transact(async ({ board, archive }) => {
    const dup = findDuplicate(board, body.title);
    if (dup) {
      // §11.5: do not regenerate an identical task.
      return { result: conflict("duplicate title already on board", { id: dup.id }) };
    }
    const id = nextId(board, archive);
    const task = buildTask(body, id, g.auth.actor!);
    return { board: [...board, task], result: json(task, 201) };
  });
}
