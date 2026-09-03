#!/usr/bin/env bash
# Serves the board (localStorage needs a real origin) and opens it.
set -euo pipefail
cd "$(dirname "$0")"
node src/parse.mjs data/draftsheet.csv data/players.json >/dev/null
node src/build.mjs src/board.template.html data/players.json config.json src/model.mjs board.html
node src/test-model.mjs >/dev/null 2>&1 || { echo "⚠ src/test-model.mjs FAILED — the pricing guards are broken. Run it to see why."; }

if [ -f data/live.json ]; then
  AGE=$(( $(date +%s) - $(stat -f %m data/live.json) ))
  if [ "$AGE" -gt 3600 ]; then
    echo ""
    echo "⚠ data/live.json is $((AGE/3600))h old — that is a PREVIOUS draft."
    echo "  The board will cold-start as that draft. Run ./new-draft.sh first."
    echo ""
  fi
fi

lsof -ti:8777 | xargs kill -9 2>/dev/null || true
node src/serve.mjs 8777 &
sleep 1
open "http://localhost:8777/board.html"
wait
