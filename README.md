# Ozark Draft Board

Live draft board built from `DraftSheets_2026_ozark.xlsx`. 10-team, 0.5 PPR.

## Run

    ./start.sh          # builds + serves + opens the board

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
- **VONA** — not in the sheet. Value Over Next Available: with `N` picks between
  your turn and your next one, assume the market takes the top `N` by ECR, then
  compare the best available at each position now vs. then. High VONA = take that
  position now; low VONA = it will still be there.

Set your **slot** and league **size** in the header — VONA depends on the snake gap.

## Files

- `data/draftsheet.csv` — export of the DraftSheet tab
- `src/parse.mjs` — CSV → `data/players.json` (handles the 4-block side-by-side layout)
- `src/board.template.html` — the app; `src/build.mjs` inlines the data into `board.html`
- `start-browser.sh` — Brave on a separate profile with CDP port 9222 open
- `src/recon.mjs` — attaches to the Yahoo draft tab, dumps ws/xhr traffic to `recon/`
