#!/usr/bin/env bash
# Wipes all state from the previous draft. Run this BEFORE every new draft.
#
# Why this exists: the finished 2026 Ozark state was committed to the repo, so a
# cold open of board.html replayed that draft — 158 players pre-marked sold, a
# four-day-old nomination rendered as a live BID, inflation 1.03. Nothing on
# screen said it was stale. See docs/KNOWN-ISSUES.md P0-4.
set -euo pipefail
cd "$(dirname "$0")"

STAMP=$(date +%Y-%m-%d-%H%M)
ARCHIVE="data/drafts/$STAMP"

if [ -f data/live.json ] || [ -f data/seed.json ] || compgen -G "data/picks-*.ndjson" >/dev/null; then
  mkdir -p "$ARCHIVE"
  for f in data/live.json data/seed.json; do
    [ -f "$f" ] && mv "$f" "$ARCHIVE/" && echo "archived $f → $ARCHIVE/"
  done
  for f in data/picks-*.ndjson; do
    [ -e "$f" ] && mv "$f" "$ARCHIVE/" && echo "archived $f → $ARCHIVE/"
  done
else
  echo "no previous draft state to archive"
fi

if [ -f .watch.pid ]; then
  PID=$(cat .watch.pid)
  if kill -0 "$PID" 2>/dev/null; then
    echo "⚠ a watcher is still running (pid $PID). Kill it before drafting:  kill $PID"
  else
    rm -f .watch.pid
  fi
fi

cat <<'MSG'

✅ Watcher state cleared.

One more step — the board keeps its own copy in the browser:
   open the board and click  ✦ New draft   (top right)

Then check config.json matches this league:
MSG
node -e "const c=require('./config.json');console.log('   '+c.league+': '+c.teams+' teams × \$'+c.budget+', '+c.rosterSlots+' roster spots, you = '+JSON.stringify(c.myTeamName))"
echo ""
