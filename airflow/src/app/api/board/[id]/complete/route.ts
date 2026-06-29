// POST /api/board/{id}/complete → move task to archive.json, remove from board (§5)

import { guard, json, notFound } from "@/lib/http";
import { transact } from "@/lib/storage";
import { applyPatch } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const g = guard(req);
  if (!g.ok) return g.res;

  return transact(async ({ board, archive }) => {
    const idx = board.findIndex((t) => t.id === params.id);
    if (idx === -1) return { result: notFound(`task ${params.id} not found`) };
    const completed = applyPatch(
      board[idx],
      { status: "done", action: "completed → archived" },
      g.auth.actor!,
    );
    const nextBoard = board.filter((_, i) => i !== idx);
    return {
      board: nextBoard,
      archive: [...archive, completed],
      result: json(completed),
    };
  });
}
