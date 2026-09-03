# Ozark Draft Board

A live auction-draft assistant for Yahoo Fantasy Football. It watches your actual
Yahoo draft room over the Chrome DevTools Protocol, prices every remaining player
against your own valuation spreadsheet, and tells you what to pay.

Built for and used in the 2026 Ozark league (10-team, $200 auction, 0.5 PPR, 15
roster spots). It finished with the best value-per-dollar in the league —
see [`docs/DEBRIEF-2026.md`](docs/DEBRIEF-2026.md).

> **Status: working prototype, survived one live draft.** It broke three times
> during that draft, twice silently. Those failures are now fixed and covered by
> tests — see [`docs/KNOWN-ISSUES.md`](docs/KNOWN-ISSUES.md) for what changed and
> what is still fragile, and [`docs/ROADMAP.md`](docs/ROADMAP.md) for what's next.

## Before every draft

Three things, in this order. Skipping the first is how you end up drafting
against last month's data.

```bash
./new-draft.sh                    # archive + clear the previous draft's state
$EDITOR config.json               # teams, budget, roster spots, your team name
node src/simulate.mjs --fast      # dry run: watch the board move, no Yahoo needed
```

On Windows, see [`docs/SETUP-WINDOWS.md`](docs/SETUP-WINDOWS.md) — a from-scratch
guide for someone with no developer tools installed.

`config.json` is the one file that must be right. `teams × budget` is the
numerator of every price on the board, so a wrong value there corrupts
everything quietly. The board prints it back in the header — check it against
the draft room before the first nomination.

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

## Reading the board

Beyond the price columns, two things drive auction decisions:

- **Positional scarcity** (centre panel) — for each position: how many players
  are left, how much sheet value is left, what share of that position's value
  is already gone, the best available, and how far the drop is to the next
  tier. The bar is value remaining, and it turns amber past 50% and red past
  75%.
- **Tier badges** on player rows — `LAST T2 · −$9` means he is the final player
  at his position in tier 2 and the next tier's best is $9 cheaper. The dollar
  figure is the point: last-in-tier with $1 behind it is noise, last-in-tier
  with $9 behind it is a reason to break your target price. A softer
  `2 LEFT T3` marks a tier about to empty.

## Board keys

| key | does |
|---|---|
| type a name | fuzzy search (`jgib` → Jahmyr Gibbs) |
| `Enter` | mark drafted by someone else (the sheet's `x`) |
| `Shift+Enter` | mark drafted by you (the sheet's `o`) |
| `↑` `↓` | move selection |
| `⌘Z` | undo last pick |
| `Esc` | clear search |

Plus **✦ New draft** (top right), which wipes the browser's memory of the
current draft. The board also shows a full-width banner whenever it is not
confidently live — see below.

### The staleness banner

If anything is wrong, it is across the top of the screen in red or amber:

| banner | meaning |
|---|---|
| WATCHER NOT RUNNING | no `live.json` at all — prices are raw sheet values, no inflation |
| STALE — no update for Ns | the watcher stopped writing; prices are frozen |
| WILL NOT TRUST IT | the watcher can see the page but a guard tripped (usually a position filter) |
| N phantom sales dropped | the sold list disagreed with Yahoo and self-corrected |

Silence means live. This is the fix for the failure that cost four minutes
mid-auction on Aug 30, when a frozen board looked exactly like a working one.

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

## What the market actually pays

`docs/MARKET-2026-OZARK.md` measures the 2026 draft against the sheet, from
Yahoo's own results page. The headline:

| tier | paid ÷ sheet value |
|---|---|
| 1 | **1.59×** |
| 2 | 1.31× |
| 3 | 1.13× |
| 4 | 0.75× |
| 5+ | **0.48×** |

Sheet value is not what a player costs — it's what he costs *relative to his
tier*. A board pricing Gibbs at $48 × inflation will never win Gibbs; he cleared
at $73. This is the quantified version of "the entire top tier went unbid", and
it's the input stars-and-scrubs pricing has to clear (ROADMAP 2).

Regenerate with `node src/analyze-picks.mjs`.

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
config.json                league settings — CHECK THIS BEFORE EVERY DRAFT
new-draft.sh               archive + clear state between drafts
data/draftsheet.csv        export of the DraftSheet tab (the source of truth)
data/DraftSheets_2026_ozark.xlsx   original workbook
data/players.json          parsed sheet, built by src/parse.mjs
data/live.json             written by the watcher every 2s; read by the board
data/seed.json             recovery state from Yahoo's results page
src/parse.mjs              CSV → players.json (handles the 4-block layout)
src/model.mjs              shared decision logic: guards, reconciliation,
                           inflation, positional scarcity. Pure, no I/O.
                           Inlined into the board AND imported by the watcher,
                           so the two can never drift apart.
src/board.template.html    the app; src/build.mjs inlines data + config + model
src/watch.mjs              CDP poller, matching, inflation model
src/simulate.mjs           fake draft → live.json; the pre-flight check
src/test-model.mjs         31 regression tests, one per real draft-day failure
src/serve.mjs              dependency-free static server for the board
src/analyze-picks.mjs      recorded draft → market vs sheet, by tier
data/drafts/               archived drafts: state + picks.csv with prices
src/extract.js             the in-page scraper (injected via Runtime.evaluate)
src/recon.mjs              dumps the draft room's ws/xhr traffic to recon/
src/test-match.mjs         name-matching round-trip test
docs/                      debrief, known issues, roadmap
```

## Where to start if you're picking this up

Run the tests first — they double as a description of every way this has
actually failed:

```bash
node src/test-model.mjs     # 31 tests, one per real draft-day failure
node src/test-match.mjs     # name matching, 237/237
node src/simulate.mjs --fast   # end-to-end, no Yahoo required
```

The highest-leverage work remaining, in order:

1. **Stop inferring sales from disappearance** (the root cause under P0-1/P0-2).
   The guards make it safe, not correct — the watcher still can't tell "sold"
   from "not rendered", it just refuses to guess. Yahoo's draft-results page is
   authoritative and already parseable. Making it the primary source, or a
   continuous cross-check, removes the whole class.
2. **Stars-and-scrubs mode** (ROADMAP 2). Still the biggest strategic gap: the
   tool can only play flat value, so the top tier is always ceded.
3. **Verify the price scrape.** `extract.js` now reads a sale price off the
   "Last:" banner, but that regex has never seen a live Yahoo room. Confirm it
   against one draft before trusting `priceOf`.

Positional scarcity (ROADMAP 1) is **done** — `tierScarcity()` in
`src/model.mjs`, rendered as the scarcity panel and the tier badges.
