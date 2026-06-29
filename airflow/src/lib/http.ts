// Shared response helpers + auth guard for API routes.

import { NextResponse } from "next/server";
import { authenticate, type AuthResult } from "@/lib/auth";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function forbidden(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export function notFound(message = "not found"): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function conflict(message: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status: 409 });
}

/** Authenticate or return a 403 response. Callers: `const a = guard(req); if (!a.ok) return a.res;` */
export function guard(
  req: Request,
): { ok: true; auth: AuthResult } | { ok: false; res: NextResponse } {
  const auth = authenticate(req);
  if (!auth.ok) return { ok: false, res: forbidden() };
  return { ok: true, auth };
}
