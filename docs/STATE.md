# AIRFLOW Automation State

Last updated: 2026-07-12 (Asia/Tokyo)

## Current state

- Branch: `codex/airflow-automation-orchestrator`
- SQLite-backed orchestration, workers, Tasks UI, three transport adapters, and launchd templates are implemented.
- Mock and LM Studio end-to-end execution completed through the Bridge, including restart persistence and artifacts.
- Codex CLI starts through the ChatGPT-authenticated route, but the final output smoke test is currently blocked by the account usage limit.
- The release binary and macOS `.app` bundle build successfully. DMG packaging stalled in Finder AppleScript and was stopped without producing a DMG.
- No production deployment, external posting, push/merge automation, paid API route, or data deletion is enabled.

## Known environment constraints

- Port `8787` is occupied by an unrelated local service; use `JARVIS_BRIDGE_ADDR=127.0.0.1:8797` until it is free.
- Obsidian Local REST API was unavailable on `127.0.0.1:27123` and its Keychain credential was absent during the audit.
- `npm audit` reports one high and one moderate development-tool finding whose automated fix requires a Vite major upgrade.

## Next verification

After the Codex usage window resets, run one low-risk Codex task and confirm `run.jsonl`, output, review, and final-review artifacts. Upgrade Vite in a separate dependency-focused change after compatibility testing.
