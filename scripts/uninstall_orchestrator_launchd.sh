#!/bin/bash
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/com.24zuka.jarvis-orchestrator.plist"
launchctl bootout "gui/$UID/com.24zuka.jarvis-orchestrator" >/dev/null 2>&1 || true
if [[ -f "$PLIST" ]]; then
  rm "$PLIST"
fi
echo "Uninstalled com.24zuka.jarvis-orchestrator. Database and artifacts were preserved."
