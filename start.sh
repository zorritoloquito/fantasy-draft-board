#!/usr/bin/env bash
# Serves the board (localStorage needs a real origin) and opens it.
set -euo pipefail
cd "$(dirname "$0")"
node src/parse.mjs data/draftsheet.csv data/players.json >/dev/null
node src/build.mjs src/board.template.html data/players.json board.html >/dev/null
lsof -ti:8777 | xargs kill -9 2>/dev/null || true
python3 -m http.server 8777 --bind 127.0.0.1 >/dev/null 2>&1 &
sleep 1
open "http://localhost:8777/board.html"
echo "Board → http://localhost:8777/board.html   (Ctrl-C to stop serving)"
wait
