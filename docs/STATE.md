# AIRFLOW Automation State

Last updated: 2026-07-12 (Asia/Tokyo)

## Current state

- Branch: `codex/airflow-automation-orchestrator`
- SQLite-backed orchestration, workers, Tasks UI, three transport adapters, and launchd templates are implemented.
- Mock and LM Studio end-to-end execution completed through the Bridge, including restart persistence and artifacts.
- Codex CLI completed an end-to-end Bridge task through the ChatGPT-authenticated route. The verification saved `run.jsonl`, output, review, and final-review artifacts.
- The release binary, macOS `.app`, and a mount-verified `JARVIS Cockpit_1.0.0_aarch64.dmg` build successfully. The DMG uses a non-interactive image creation step because Finder AppleScript packaging was unreliable in this environment.
- The macOS startup crash caused by the obsolete `plugins.shell.scope` Tauri setting is fixed. The release app remained running after launch and the rebuilt DMG contains the verified executable.
- No production deployment, external posting, push/merge automation, paid API route, or data deletion is enabled.

## Known environment constraints

- Port `8787` is occupied by an unrelated local service; use `JARVIS_BRIDGE_ADDR=127.0.0.1:8797` until it is free.
- Obsidian Local REST API was unavailable on `127.0.0.1:27123` and its Keychain credential was absent during the audit.
- `npm audit` reports one high and one moderate development-tool finding whose automated fix requires a Vite major upgrade.

## Next verification

Upgrade Vite in a separate dependency-focused change after compatibility testing. A Draft PR still needs GitHub CLI authentication (or manual creation from the pushed branch).
