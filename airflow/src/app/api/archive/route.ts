// GET /api/archive → all completed tasks (§5)

import { guard, json } from "@/lib/http";
import { readArchive } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = guard(req);
  if (!g.ok) return g.res;
  const archive = await readArchive();
  return json(archive);
}
