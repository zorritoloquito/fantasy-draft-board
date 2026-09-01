# Ozark Draft Board

A live auction-draft assistant for Yahoo Fantasy Football. It watches your actual
Yahoo draft room over the Chrome DevTools Protocol, prices every remaining player
against your own valuation spreadsheet, and tells you what to pay.

Built for and used in the 2026 Ozark league (10-team, $200 auction, 0.5 PPR, 15
roster spots). It finished with the best value-per-dollar in the league —
see [`docs/DEBRIEF-2026.md`](docs/DEBRIEF-2026.md).

> **Status: working prototype, survived one live draft.** It also broke three
> times during that draft, twice silently. Read
> [`docs/KNOWN-ISSUES.md`](docs/KNOWN-ISSUES.md) before trusting it, and
> [`docs/ROADMAP.md`](docs/ROADMAP.md) for where it should go next.

## The idea

In an auction, a player's list price is nearly meaningless — what matters is what
the room has left to spend. The core number is:

```
inflation = (league money left) / (sheet value of players left)
target price = sheet value × inflation
```

Below 1.0, the room overspent early and everyone remaining is on sale. In the
2026 draft inflation fell from 0.95 to **0.39** by mid-draft, because the room
put 95% of its money into the first third of the player pool. Buying almost
exclusively in that window is what produced the edge.

The spreadsheet's value scale is deliberately **flatter** than Yahoo's — it
prices Nacua at $42 where Yahoo says $59. The strategy is to let the room overpay
at the top and buy the middle once inflation drops.

## Run of show

Three steps, two terminals. Order matters.

**1. Launch the browser** (own profile, CDP on port 9222 — your normal browser is
untouched):

```bash
./start-browser.sh
```

In *that* window: log into Yahoo, open your league, enter the draft room. Leave it
on the **Players** tab with **no position filter** — see the warning below.

**2. Start the watcher** (leave running):

```bash
./watch.sh
```

Prints `SOLD ▸ ...` as picks land and writes `data/live.json` every 2s. If
`data/seed.json` exists it loads it first, so a mid-draft restart resumes from
Yahoo's authoritative pick list.

**3. Serve the board** (leave running, separate terminal):

```bash
./start.sh
```

Rebuilds from the CSV and opens `http://localhost:8777/board.html`.

Open the board in your **normal** browser, not the CDP one — keep that window on
the draft room. All actual bidding happens in Yahoo; the board is read-only
advice and cannot place a bid.

> ### ⚠️ Keep the draft room on the unfiltered Players tab
>
> The watcher infers "sold" from players disappearing off the visible list. Any
> view where the full list isn't rendered — the Team/Queue/Chat tabs, or a
> position filter — makes it think the missing players were bought. The filter
> case silently corrupts pricing rather than failing loudly: it once produced a
> $92 target on a player who sold for $40. Sorting is safe. Filtering is not.
> This is the top item in KNOWN-ISSUES.

## Board keys

| key | does |
|---|---|
| type a name | fuzzy search (`jgib` → Jahmyr Gibbs) |
| `Enter` | mark drafted by someone else (the sheet's `x`) |
| `Shift+Enter` | mark drafted by you (the sheet's `o`) |
| `↑` `↓` | move selection |
| `⌘Z` | undo last pick |
| `Esc` | clear search |

Marking is a **fallback** — the watcher detects picks automatically. State
persists in localStorage, so a refresh won't lose anything.

## What the numbers mean

Ported from the xlsx formulas, verified to the rounded percent.

- **VALUE** — auction dollars. A *static* VLOOKUP in the sheet. So are VOR, PTS,
  TIER and ECR. None of them move when a player is drafted.
- **PS / "% below"** — the only dynamic cell in the sheet:
  `SUMIFS(VOR below this row, DRAFT<>"x", DRAFT<>"o", VOR>0) / total positional VOR`.
  The share of that position's value still sitting below this player, undrafted.
  A remaining-depth gauge, **not** a probability he gets taken.
- **Inflation** — not in the sheet, and the whole point in an auction. See above.
- **Max bid** — `budget − (empty roster spots − 1)`. Matches Yahoo's own "Max
  Offer" to the dollar. It's a roster-filling ceiling, not a value judgment —
  bid to *target*, not to max.

## Recovery

If the board freezes or shows absurd numbers mid-draft:

1. Check the draft room is on the unfiltered Players tab.
2. Check exactly one `watch.mjs` is running — two instances fight over
   `live.json` and the stale one can win.
3. Compare `soldIds` against `filled` in `data/live.json`. If `soldIds` is much
   larger, the sold list is corrupted — reseed.

**Reseeding** scrapes Yahoo's own draft-results page
(`/f1/<league>/draftresults`), which is authoritative and includes price and
buyer for every pick, rebuilds `data/seed.json`, and restarts the watcher. This
is currently a manual process; automating it is ROADMAP item 4.

## Layout

```
data/draftsheet.csv        export of the DraftSheet tab (the source of truth)
data/DraftSheets_2026_ozark.xlsx   original workbook
data/players.json          parsed sheet, built by src/parse.mjs
data/live.json             written by the watcher every 2s; read by the board
data/seed.json             recovery state from Yahoo's results page
src/parse.mjs              CSV → players.json (handles the 4-block layout)
src/board.template.html    the app; src/build.mjs inlines data into board.html
src/watch.mjs              CDP poller, matching, inflation model
src/extract.js             the in-page scraper (injected via Runtime.evaluate)
src/recon.mjs              dumps the draft room's ws/xhr traffic to recon/
src/test-match.mjs         name-matching round-trip test
docs/                      debrief, known issues, roadmap
```

## Where to start if you're picking this up

The highest-leverage work, in order:

1. **Stop inferring sales from disappearance** (KNOWN-ISSUES P0-1/P0-2). Yahoo's
   draft-results page is authoritative and already parseable — `watch.mjs` reads
   it during reseeding. Making it the primary source, or a continuous
   cross-check, eliminates most of the failure modes at once.
2. **Tier-break / positional-scarcity display** (ROADMAP 1). The data is already
   in `players.json`; it's a presentation problem, and it's what the drafter most
   wanted and didn't have.
3. **Stars-and-scrubs mode** (ROADMAP 2). The tool can currently only play one
   strategy, and it plays it well — but that means the top tier is always ceded.

`src/test-match.mjs` covers name matching. There is no test coverage of the
watcher's state machine, which is where every real bug has been; a replay harness
(ROADMAP 5) would be the right first investment.
