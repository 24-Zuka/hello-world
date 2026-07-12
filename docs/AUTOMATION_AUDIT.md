# AIRFLOW / JARVIS Cockpit Automation Audit

Last checked: 2026-07-12 (Asia/Tokyo)

## Conclusion

The baseline was a functional JARVIS Cockpit whose AirFlow task board was read-only. This branch extends the existing three-transport architecture with durable SQLite orchestration, guarded Codex/LM Studio/manual workers, task-centric artifacts, and a Tasks control surface without replacing the established Rust core.

## Baseline environment

- Source branch inspected: `codex/airflow-full-integration` at `2d8d0c2`.
- Implementation branch: `codex/airflow-automation-orchestrator`.
- Node `v24.16.0`, npm `11.13.0`.
- Rust `1.96.0`; rustfmt and clippy components were initially absent and installed for the approved verification work.
- Codex CLI `0.141.0`, authenticated with ChatGPT; `OPENAI_API_KEY` was not present.
- `codex exec` supports stdin (`-`), `--json` JSONL, `-C`, `--model`, `--output-schema`, `--ephemeral`, sandbox selection, and non-interactive approval policy.
- `codex debug models` reported `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, and `codex-auto-review`; reasoning capabilities are available in the model catalog.

## Working now

- React 18 / TypeScript / Vite production build.
- Rust workspace compilation and existing unit tests.
- Tauri -> core and Bridge -> core command forwarding.
- Bridge loopback binding, bearer token, Origin allowlist, CORS/PNA, and SSE event bus.
- dcg allowlist/destructive-command checks.
- Codex ChatGPT login status detection.
- LM Studio `GET /v1/models` on `127.0.0.1:1234`; five local models were visible.
- Obsidian REST client and Keychain integration code paths exist.
- Legacy Markdown/YAML ticket parsing.

## Remaining mock or placeholder areas outside this scope

- `codex_build.sh`, `local_review.sh`, `research_scan.sh`, `worktree_new.sh`, and `morning_meeting.sh` are placeholders.
- Browser mode intentionally simulates local worker execution because a public browser cannot directly reach local processes.
- Plus quota parsing and launchd schedule editing are placeholders.

## Broken or unavailable during audit

- Obsidian Local REST API was not listening on `127.0.0.1:27123` and no JARVIS Obsidian Keychain entry was present.
- Port `8787` was occupied by an unrelated local Node service, so Bridge validation must use another loopback port.
- `cargo fmt --check` failed on pre-existing unformatted Rust files.
- `npm audit` reported one high and one moderate development-tool vulnerability in Vite/esbuild. The available automated fix is a semver-major Vite upgrade and is not applied implicitly.
- The official Codex manual helper failed because its response lacked the expected content-signature header; local CLI help and model catalog are used as environment truth.

## Implemented automation capabilities

- SQLite persistence for tasks, runs, artifacts, approvals, events, leases, and restart recovery.
- Task create/update/import/archive, dependency gates, bounded retries, cancellation, and background polling.
- Codex CLI, LM Studio, Mock, and Work/manual workers with rule-based model and reasoning routing.
- Context packs, deterministic quality review, escalation, JSONL run logs, and final-review packages.
- Matching Tauri, Bridge, and browserMock command contracts plus the Tasks Kanban/control surface.
- launchd install/status/uninstall scripts with a mode-0600 token file and no token embedded in plist.

## Security risks and controls

- Task content and model output could become command or path injection if passed through shell strings. The implementation must use argument arrays/stdin and safe task IDs only.
- User-configurable model endpoints create SSRF risk. Automatic execution will accept loopback LM Studio endpoints; non-loopback endpoints require a visible warning and cannot be silently selected.
- Bridge bearer comparison is constant-time. SSE retains the token query parameter for browser `EventSource` compatibility and must not be logged; a future protocol revision should prefer a one-time session token.
- External posting, messaging, merge, push, deletion, purchases, API-key use, and system changes must transition to `AWAITING_APPROVAL` and never execute automatically.

## Implementation decision

Extend the existing Rust core instead of introducing a separate agent framework. Use SQLite for durable orchestration state, keep Markdown tickets import-compatible, run the orchestrator in `jarvis-bridge` for GUI-independent operation, and expose the same contract through Tauri and browserMock.
