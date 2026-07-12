# AIRFLOW AI Automation Implementation Plan

## Problem

JARVIS Cockpit currently displays AirFlow tickets but cannot persist automation state, route work, execute Codex or LM Studio tasks, retain artifacts, or enforce approval gates across restarts.

## Success criteria

- The approved acceptance criteria in `docs/AUTOMATION_AUDIT.md` are implemented and verified.
- Tauri, Bridge, and browserMock expose the same task/orchestrator contract.
- Codex uses the logged-in CLI route; no OpenAI API key is required.
- Local destructive or externally visible actions stop at human approval.

## Scope

1. Extend the shared TypeScript/Rust task contract without dropping legacy ticket fields.
2. Add SQLite persistence, migrations, transactions, leases, runs, artifacts, approvals, and events.
3. Add an orchestrator with Mock, LM Studio, Codex CLI, and Work manual workers.
4. Add routing, context packs, deterministic quality checks, retry/escalation, and cancellation.
5. Extend all three transports and add the Tasks UI, settings, logs, artifacts, and import flow.
6. Add Bridge background execution, launchd templates/scripts, documentation, and examples.

## Out of scope

- Automatic social posting, email, messages, GitHub merge/push, purchases, or paid API enablement.
- Browser automation of ChatGPT Work.
- Production deployment or merging to `main`.

## Constraints and dependencies

- Preserve the existing approval modal, dcg, Keychain policy, and Tauri/Bridge/Mock ordering.
- Use the installed Codex CLI flags discovered from `codex exec --help`.
- Treat task text, URLs, model output, and artifact paths as untrusted input.
- Keep automatic execution bounded by concurrency, timeout, attempt, size, and approval limits.

## Sequence

1. Audit and baseline.
2. Schema, repository, state machine, leases.
3. Workers, orchestrator, routing, quality, artifacts.
4. Three transport commands and SSE events.
5. Tasks UI and settings.
6. Background/launchd integration.
7. Tests, real smoke checks, documentation, commit, and draft PR if authentication permits.

## Verification

- `npm run typecheck`
- `npm run build`
- `cargo fmt --all -- --check`
- `cargo check --workspace`
- `cargo test --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
- Mock end-to-end task lifecycle.
- Local LM Studio and Codex CLI smoke tasks when available.
- Bridge HTTP/SSE smoke test on a free loopback port.

## Rollback

All changes stay on `codex/airflow-automation-orchestrator`. SQLite uses additive migrations; the legacy Markdown ticket reader remains available for import. No existing user data is deleted.
