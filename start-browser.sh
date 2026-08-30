#!/usr/bin/env bash
# Launches a SEPARATE Brave profile with the CDP debug port open.
# Your normal Brave windows/profile are untouched.
set -euo pipefail
PROFILE="$HOME/.fantasy-draft-profile"
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
mkdir -p "$PROFILE"
echo "Launching Brave (debug profile) on port 9222..."
"$BRAVE" \
  --remote-debugging-port=9222 \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check \
  "https://football.fantasysports.yahoo.com/" >/dev/null 2>&1 &
sleep 2
until curl -sf http://localhost:9222/json/version >/dev/null; do sleep 0.5; done
echo "✅ CDP is live. Now, in THAT window:"
echo "   1. Log into Yahoo"
echo "   2. Open your league → start a MOCK draft"
echo "   3. Come back and tell Claude 'draft room is open'"
