// Authentication (§4). Every API endpoint requires the `X-Board-Token` header.
// Each actor gets its own token so the activity log can attribute changes.

import type { Owner } from "@/types";

const HEADER = "x-board-token";

// Build the {token -> actor} map from environment variables at call time
// (not module load) so tests / different runtimes pick up fresh env.
function tokenMap(): Map<string, Owner> {
  const map = new Map<string, Owner>();
  const add = (value: string | undefined, actor: Owner) => {
    if (value && value.trim().length > 0) map.set(value, actor);
  };
  add(process.env.TOKEN_HUMAN, "human");
  add(process.env.TOKEN_CODEX_BATCH, "ai-batch");
  add(process.env.TOKEN_CHATGPT, "ai-interactive");
  add(process.env.TOKEN_GEMINI, "ai-interactive");
  return map;
}

export interface AuthResult {
  ok: boolean;
  actor: Owner | null;
}

/**
 * Resolve the actor for a request. Returns ok:false when the token is missing
 * or unknown — callers must return 403 in that case.
 */
export function authenticate(req: Request): AuthResult {
  const token = req.headers.get(HEADER);
  if (!token) return { ok: false, actor: null };
  const actor = tokenMap().get(token) ?? null;
  return { ok: actor !== null, actor };
}
