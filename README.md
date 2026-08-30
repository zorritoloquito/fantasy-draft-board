# Ozark Draft Board

Live draft board built from `DraftSheets_2026_ozark.xlsx`. 10-team, 0.5 PPR.

## Run (auction — 10 team, $200, 0.5 PPR, 15 roster spots)

    ./start-browser.sh   # 1. Brave on a separate profile, CDP port 9222
                         #    log into Yahoo THERE, open the draft room
    ./watch.sh           # 2. polls the draft room -> data/live.json
    ./start.sh           # 3. serves + opens the board

## Keys

| key | does |
|---|---|
| type a name | fuzzy search (first name, last name, or initials — `jgib` → Jahmyr Gibbs) |
| `Enter` | mark drafted **by someone else** (the sheet's `x`) |
| `Shift+Enter` | mark drafted **by you** (the sheet's `o`) |
| `↑` `↓` | move selection |
| `⌘Z` | undo last pick |
| `Esc` | clear search |

State persists in localStorage — a refresh mid-draft won't lose anything.

## What the numbers mean

Ported directly from the xlsx formulas, verified to the rounded percent:

- **VALUE** — auction dollars. A *static* VLOOKUP in the sheet (`Aggregate` col 10).
  So is VOR, PTS, TIER and ECR. None of them move when a player is drafted.
- **PS / "% below"** — the *only* dynamic cell in the sheet:
  `SUMIFS(VOR below this row, DRAFT<>"x", DRAFT<>"o", VOR>0) / total positional VOR`.
  The share of that position's value still sitting **below** this player, undrafted.
  It is a remaining-depth gauge, **not** a probability that he gets taken.
- **Inflation** — not in the sheet, and the whole point in an auction:

      (league money left) / (sheet value of players left)

  Below 1.0 = the room overspent early and everyone left is a bargain.
  Above 1.0 = money is chasing too few players; expect to overpay.
  Your **target price** for any player is `sheet value x inflation`.
- **Max bid** — `budget - (empty roster spots - 1)`. Verified against Yahoo's own
  "Max Offer" figure to the dollar.

The sheet's own value scale is calibrated correctly ($2102 across 237 players vs
$2000 of league money) but it is *flatter* than Yahoo's: it prices Nacua at $42
where Yahoo says $59. The edge is letting the room overpay at the top and buying
the middle once inflation drops.

## Files

- `data/draftsheet.csv` — export of the DraftSheet tab
- `src/parse.mjs` — CSV → `data/players.json` (handles the 4-block side-by-side layout)
- `src/board.template.html` — the app; `src/build.mjs` inlines the data into `board.html`
- `start-browser.sh` — Brave on a separate profile with CDP port 9222 open
- `src/recon.mjs` — attaches to the Yahoo draft tab, dumps ws/xhr traffic to `recon/`
