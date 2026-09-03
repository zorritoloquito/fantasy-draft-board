# Where this is, as of Sep 3, 2026

Written as a handoff. If you're picking this up in a new session, read this
file and `docs/KNOWN-ISSUES.md` and you'll have the whole picture.

## One-paragraph summary

A live auction-draft assistant for Yahoo. It watches the real draft room over
CDP, prices every remaining player against Luis's valuation spreadsheet, and
says what to pay. It survived one real draft (Aug 30, best value-per-dollar in
the league) but broke three times doing it. Everything that broke is now fixed
and covered by 72 tests. Since then it has gained positional scarcity, a
stars-and-scrubs budget plan calibrated against what the room actually paid,
and draft-session identity. It was re-verified against a live Yahoo mock on
Sep 3, which found three more bugs, all fixed.

## Run it

```bash
./new-draft.sh                    # archive + clear the last draft's state
$EDITOR config.json               # teams, budget, roster, your team name
./start-browser.sh                # CDP browser — log into Yahoo, enter the room
./watch.sh                        # terminal 2, leave running
./start.sh                        # terminal 3, serves + opens the board
```

Then click **✦ New draft** on the board once. Windows: `docs/SETUP-WINDOWS.md`.

Dry run with no Yahoo at all: `node src/simulate.mjs --fast`
(`--filter` and `--freeze` reproduce the two P0 failure modes on demand.)

## Current config

```
2026 Draft (Sep 3) · 10 teams × $200 · 15 spots
myTeamName: cucamongakrakakillas
strategy:   2 stars / $135, starTier 2, marketBias null (uses the measured curve)
            → 13 other slots on $65 = $5.0/slot
```

`teams × budget` is the numerator of every price on the board. **Check the
header readout against the draft room before the first nomination.**

## What was learned, and where the numbers come from

Everything below is measured, not assumed. Source data is
`data/drafts/2026-08-30-ozark/picks.csv` (110 picks with prices, transcribed
from Yahoo's results page); regenerate the analysis with
`node src/analyze-picks.mjs`.

**1. The sheet is not wrong, it's timid.** The room paid ~1.84× the board's own
target across the whole draft. Once inflation is accounted for, that gap is
almost identical at every tier (1.85 / 1.87 / 1.85 / 1.84 / 1.57), so it isn't
a "bad at stars" problem — the model is uniformly low.

**2. But not by a constant.** Bucketed by draft phase, the room was most
irrational in the *middle*: 1.56× on picks 1–10, peaking at 2.11× on picks
21–30, back to ~1.70× at the end. Stars go early, at 1.56×. The board
interpolates this curve (`marketBiasAt()` in `src/model.mjs`).

**3. Inflation collapses monotonically** 0.95 → 0.19. The flat-value thesis
(let the room overpay early, buy the middle) is correct about *where* the
bargains are. Its flaw was having no mechanism to ever buy a star.

**4. A 3-star / $140 plan does not survive contact with real prices.** Stars
clear at $60–75. 2 stars / $135 does.

## Architecture

```
config.json                league + strategy. The one file that must be right.
src/model.mjs              ALL decision logic, pure, no I/O. Imported by the
                           watcher AND inlined into the board at build time, so
                           they cannot drift. This is where to make changes.
src/watch.mjs              CDP poller: matching, guards, inflation, live.json
src/extract.js             injected into the page; scrapes innerText
src/board.template.html    the UI; build.mjs inlines data + config + model
src/simulate.mjs           fake draft → live.json. No Yahoo needed.
src/test-model.mjs         72 tests, one per real failure
src/analyze-picks.mjs      recorded draft → market vs sheet
src/serve.mjs              dependency-free static server
```

## What is solid, and what isn't

**Verified against a live Yahoo room (Sep 3):** team/budget/roster parsing,
available-player parsing, nomination and bid parsing, the filter-state read
(`pos=TE`), the guards (refuse and resync both fired and recovered), sale
detection, buyer attribution, and price derivation.

**Verified only in simulation:** the board's rendering under a full 15-round
draft. The mock was three rounds.

**Not verified live at all:**
- **Custom team names.** The mock used "Team 1".."Team 10". The real league has
  names like `TEA👊🏽BAGGERS`. The code handles them and it worked in August, but
  this is the piece with the least evidence. **If the roster panel looks wrong,
  look here first.**
- `marketBias` on any league other than Ozark 2026.

**Known-imperfect:**
- The watcher still infers sales from disappearance. The guards make it *safe*
  (it refuses to believe implausible readings and says so) but not *correct*.
  Polling `/f1/<league>/draftresults` as the authoritative source is the real
  fix and remains the top item.
- `extract.js` returns occasional junk rows (one parsed as `{"name":"CEL"}`).
  Harmless — `matchPlayer` drops them — but the regex is loose.
- No K or DEF in the sheet, so those picks can't be valued.

## The next three things

1. **Make Yahoo's draft-results page the source of truth** for sales, rather
   than the disappearance diff. Removes the entire P0 class.
2. **Re-measure `marketBias` per league.** It's one draft. Better still, learn
   it live from the current draft rather than carrying 2026 forward.
3. **Replay a recorded draft.** `data/picks-<date>.ndjson` now captures the raw
   material, so the next live draft produces a replayable trace for free.

## Draft archives

```
data/drafts/2026-08-30-ozark/   the real 2026 draft: state + picks.csv w/ prices
data/drafts/2026-09-03-mock/    the Sep 3 mock: pick log + watcher log
```

`data/live.json`, `data/seed.json` and `data/picks-*.ndjson` are gitignored on
purpose — shipping a finished draft's state made the board cold-start as that
draft (KNOWN-ISSUES P0-4).
