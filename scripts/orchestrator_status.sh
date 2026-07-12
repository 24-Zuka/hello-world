#!/bin/bash
set -euo pipefail

LABEL="com.24zuka.jarvis-orchestrator"
TOKEN_FILE="$HOME/Library/Application Support/JARVIS Cockpit/bridge.token"
if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
  echo "status: loaded"
  launchctl print "gui/$UID/$LABEL" | sed -n '1,80p'
else
  echo "status: not loaded"
fi
if [[ -f "$TOKEN_FILE" ]]; then
  echo "token_file: $TOKEN_FILE"
else
  echo "token_file: missing"
fi
