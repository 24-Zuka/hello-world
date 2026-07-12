#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.24zuka.jarvis-orchestrator.plist"
BINARY="${JARVIS_BRIDGE_BINARY:-$ROOT/src-tauri/target/release/jarvis-bridge}"
TEMPLATE="$ROOT/scripts/com.24zuka.jarvis-orchestrator.plist.template"
ADDR="${JARVIS_BRIDGE_ADDR:-127.0.0.1:8787}"

if [[ ! -x "$BINARY" ]]; then
  PATH="$HOME/.cargo/bin:$PATH" cargo build --manifest-path "$ROOT/src-tauri/Cargo.toml" -p jarvis-bridge --release
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/JARVIS Cockpit" "$HOME/Library/Application Support/JARVIS Cockpit"
if lsof -nP -iTCP:"${ADDR##*:}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${ADDR##*:} is already in use. Set JARVIS_BRIDGE_ADDR=127.0.0.1:<free-port> and retry." >&2
  exit 1
fi
sed -e "s|__BINARY__|$BINARY|g" -e "s|__HOME__|$HOME|g" -e "s|__ADDR__|$ADDR|g" "$TEMPLATE" > "$PLIST"
plutil -lint "$PLIST"
launchctl bootout "gui/$UID/com.24zuka.jarvis-orchestrator" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl enable "gui/$UID/com.24zuka.jarvis-orchestrator"
echo "Installed: $PLIST"
echo "Bridge token: $HOME/Library/Application Support/JARVIS Cockpit/bridge.token"
