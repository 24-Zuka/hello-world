// GET   /api/board/{id} → single task (404 if missing) (§5)
// PATCH /api/board/{id} → partial update; auto updated_at + activity (§5)

import { guard, json, notFound, badRequest } from "@/lib/http";
import { transact } from "@/lib/storage";
import {
  applyPatch,
  isValidOwner,
  isValidPriority,
  isValidStatus,
} from "@/lib/tasks";
import type { PatchTaskInput } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const g = guard(req);
  if (!g.ok) return g.res;
  return transact(async ({ board }) => {
    const task = board.find((t) => t.id === params.id);
    return { result: task ? json(task) : notFound(`task ${params.id} not found`) };
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const g = guard(req);
  if (!g.ok) return g.res;

  let patch: PatchTaskInput;
  try {
    patch = (await req.json()) as PatchTaskInput;
  } catch {
    return badRequest("invalid JSON body");
  }
  if (patch.status !== undefined && !isValidStatus(patch.status))
    return badRequest("invalid status");
  if (patch.owner !== undefined && !isValidOwner(patch.owner))
    return badRequest("invalid owner");
  if (patch.priority !== undefined && !isValidPriority(patch.priority))
    return badRequest("invalid priority");

  return transact(async ({ board }) => {
    const idx = board.findIndex((t) => t.id === params.id);
    if (idx === -1) return { result: notFound(`task ${params.id} not found`) };
    const updated = applyPatch(board[idx], patch, g.auth.actor!);
    const nextBoard = [...board];
    nextBoard[idx] = updated;
    return { board: nextBoard, result: json(updated) };
  });
}
