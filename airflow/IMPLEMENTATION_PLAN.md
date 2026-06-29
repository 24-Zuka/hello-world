# AIRFLOW — Implementation Plan

> Required by PRD §0 / AGENTS.md before building. This documents the Phase-1
> implementation that ships in this directory.

## Problem & why
An Obsidian-based "handoff log" grew like a log file and bloated the AI context
window — every session restarted from zero. AIRFLOW separates **moving info**
(today's tasks, progress, deadlines) onto a shared task board that both humans
and (scheduled, non-realtime) AIs read and update, so handoffs are async and the
board itself is the briefing document. Static info stays in Obsidian.

## Success criteria (§17)
- `X-Board-Token` mismatch → **403**.
- `POST /api/board` auto-numbers `T0001…` uniquely across board+archive.
- `PATCH` updates `updated_at` and appends exactly one `activity` entry.
- `POST /api/board/{id}/complete` moves a task to archive and removes it from board.
- Dispatcher processes exactly **one** `needs-ai` & `owner=ai-batch` task (not
  `dispatcher-lock`) in priority order; errors → `blocked` + `blocked_reason`.
- Tasks untouched >72h auto-flip to `blocked`.
- `STOP` file halts the dispatcher.
- Deny list documented in AGENTS.md; irreversible ops are deferred to a human.
- Cloud deploy must not expose `board.json` without a token.

## Scope (this pass — Phase 1, localhost)
- Next.js App Router + TypeScript API (6 endpoints, §5) with JSON file storage.
- Status transitions + 72h auto-blocked (§7).
- Dispatcher (`dispatcher/run.js`) with STOP, deny list, lock, dup prevention (§8, §11).
- Kanban board UI with handoff/activity detail (§15 step 5).
- `AGENTS.md` (§12), morning standup prompt (§13.2), launchd template (§8.5).
- Smoke test for the acceptance criteria.

## Out of scope (later)
- Vercel + Blob deployment (Phase 2, §16) — documented, not deployed.
- Live `codex exec` (needs macOS + ChatGPT login) — dispatcher stubs it when the
  `codex` binary is absent so it runs end-to-end locally.
- Calendar connectors for the standup (§13.1.1) — prompt ships; wiring deferred.

## Contracts & dependencies
- Node 20+ / Next 14. No DB. State in `data/board.json` + `data/archive.json`.
- Tokens via env (`.env.local`, §18); per-actor so activity is attributable.
- Dispatcher talks to the API over HTTP using `DISPATCHER_TOKEN`.

## Open questions
- Real Codex output parsing (when to mark `done` vs `needs-human`) — current
  policy always returns `needs-human`; a human confirms via `/complete`.
- Whether the UI should allow status edits (currently read + detail only; status
  is owned by the API/dispatcher to keep the audit trail clean).
