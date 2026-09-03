# Known Issues

Every bug below was hit live during the 2026 Ozark auction on Aug 30. They are
ordered by how much damage they did, not by how hard they are to fix.

> **Status as of Sep 3, 2026:** P0-1, P0-2, P0-4, P1-1, P1-2, P1-3, P2-1, P2-2
> and P3-3 are fixed and covered by `src/test-model.mjs` (31 tests). The
> underlying root cause below is *not* fixed — the watcher still infers sales
> from disappearance. What changed is that it now refuses to believe
> implausible readings and says so loudly instead of writing confident nonsense.

---

## P0-4 — A finished draft was committed to the repo (FIXED)

**Severity: critical, and it would have fired on the very next draft.**

`data/live.json` and `data/seed.json` were committed holding the *completed*
Aug 30 draft. Opening `board.html` in a clean browser with empty localStorage
replayed that draft from scratch: 158 players pre-marked sold, best available a
$6 Denzel Boston, a four-day-old nomination rendered as a live green **BID**,
inflation 1.03. Nothing on screen said any of it was stale.

This is the P0-2 failure class — stale data indistinguishable from live — except
it was the *default state on first open*, before the watcher ever ran.

**Fixed** three ways:
- both files moved to `data/drafts/2026-08-30-ozark/` and added to `.gitignore`
- `./new-draft.sh` archives and clears all watcher state between drafts
- a **✦ New draft** button on the board clears its localStorage, and `start.sh`
  warns if `data/live.json` is more than an hour old

localStorage is now namespaced per league (`draftboard:<league>`), so switching
leagues can't inherit the previous draft's picks either.

The unifying root cause: **`src/extract.js` scrapes `document.body.innerText` of
whatever the Yahoo draft client happens to be rendering.** The watcher has no way
to tell "this player is gone because someone bought him" apart from "this player
is gone because the UI isn't showing him right now." Nearly every failure below
is a variation on that theme.

---

## P0-1 — Position filter silently corrupts the sold list

**Severity: critical. This one produces confidently wrong prices rather than an
obvious failure.**

Filtering the Yahoo player list by position (e.g. clicking "TE") removes every
other position from the DOM. `watch.mjs` diffs the visible player list against
the previous tick and treats anything that disappeared as sold, so it concluded
the room had bought all 98 non-TE players in a single tick.

Observed: `soldIds` hit 128 while only 30 roster spots were actually filled.
`valueLeft` collapsed 2102 → 274, so `inflation = moneyLeft / valueLeft` shot to
**2.96**, and the board advised a **$92 target on Chase Brown**, who sold for $40.

Worse, it is not self-healing. `watch.mjs` self-calibrates `goneList` against
Yahoo's authoritative `filled` count, which would have recovered on its own — but
then unconditionally re-adds everything in `soldOrder` on top (see P1-1). One bad
tick poisons every subsequent tick until the process restarts.

**Repro:** `node src/simulate.mjs --filter --fast`, or start the watcher against
a real room and click any position filter.

**FIXED** by two guards in `src/model.mjs:checkGuards()`, neither of which needs
to understand Yahoo's markup:

1. **Shape check** — if fewer than 3 positions are rendering while plenty of
   players remain unsold, a filter is on.
2. **Rate check** — an auction sells one player at a time. More than
   `maxSalesPerTick` (default 3) vanishing inside a single 2s tick is a
   re-render, not sales. This alone would have caught "98 sold in one tick".

The guard returns one of three actions, and the distinction matters:

- **refuse** (the shape is wrong — a filter, the wrong tab): don't diff, and
  critically don't advance the baseline. The next healthy tick recovers by itself.
- **resync** (the shape is fine but too much moved at once — a re-sort, a scroll,
  or a view just restored after being filtered): adopt the new list as the
  baseline *without* crediting any of it as sales, and let `filled`-driven
  self-calibration work out who actually went.
- **ok**: diff normally.

`resync` exists because refusing in that case **deadlocks**. Filter the list for
thirty seconds while four players sell, then unfilter: four vanish in one tick
against the stale baseline, the rate guard trips, the baseline never advances,
and it trips forever — the board freezes for the rest of the draft. Adopting the
baseline is safe precisely because `reconcileGone` caps the sold list at Yahoo's
own `filled` count, so a resync cannot invent a sale. It writes `stale: true` with the reason, and the board
shows a red banner naming the fix. Verified: with `--filter`, inflation goes
0.74 → (guard) → 0.71 with no corruption. The pre-patch code reached 6.70.

The root cause is untouched: sales are still inferred from disappearance.
Polling `/f1/<league>/draftresults` as the authoritative source remains the
right long-term fix (ROADMAP).

---

## P0-2 — Any non-Players view freezes the board with no error

Switching to the Team, Queue, or Chat tab drops the available-player list from
the DOM. `avail` parses as 0, `watch.mjs` early-returns on `!s.avail?.length`,
and `live.json` simply stops being written.

The board keeps polling and keeps rendering the last file it got, so **stale data
is visually indistinguishable from live data.** We lost ~4 minutes mid-auction to
this before noticing, and again later when the watcher wasn't running at all.

**FIXED**, both parts. (1) `watch.mjs` now writes `live.json` on *every* tick,
including empty parses and CDP errors, marked `stale: true` with a reason.
(2) The board renders a full-width banner whenever it is not confidently live —
watcher missing, watcher self-flagged, or `ts` older than `staleAfterMs`
(default 10s) — naming the likely cause and the fix. The board also refuses to
copy picks out of a tick flagged `stale`, so one bad read can no longer become
permanent localStorage state.

**Repro:** `node src/simulate.mjs --freeze --fast` and watch the board.

---

## P0-3 — Team-name regex was hardcoded to mock-draft names (FIXED)

`extract.js` matched team rows with `/(You|Team \d+)\s*\$(\d+)\s+(\d+)\/(\d+)/`.
That worked in the mock draft, where Yahoo assigns "Team 1".."Team 10". The real
league has custom names ("Kupp My Balz", "TEA👊🏽BAGGERS", "⚡️El Borracho ⚡️"),
so **9 of 10 teams never parsed.** `spent` and `moneyLeft` are summed over that
array, so the league would have looked like it had $2000 unspent all draft and
inflation would have been wrong from the first pick.

Caught in pre-flight ~15 minutes before the draft, purely by luck.

**Fixed** in `src/extract.js:6` — the label group is now `([^\n$]{1,28}?)`,
matching any team name on a `$N  N/15` line. Backup at `src/extract.js.bak`.

**Remaining risk:** the pattern is still positional text-scraping. A team name
containing a `$`, or longer than 28 chars, still breaks it.

---

## P1-1 — `soldOrder` is append-only and never reconciled

`watch.mjs` builds `goneList` by walking the sheet best-first until it accounts
for exactly `filled` sales — a good self-calibrating design — and then does:

```js
for (const id of soldOrder) { ... goneList.push(p) }
```

Anything ever observed vanishing is re-added permanently, with no check against
`filled`. This is what turned P0-1 from a transient glitch into unrecoverable
state. Note the mismatch was visible in the data the whole time: `soldIds: 128`
against `filled: 30`.

**FIXED** in `src/model.mjs:reconcileGone()`. Yahoo's `filled` is now a hard
ceiling, not just a calibration target. When the observed list exceeds it the
extras are provably phantom and get dropped, keeping the sales we have a named
buyer for over the unattributed ones. The count is surfaced as `phantoms` in
`live.json` and shown on the board.

Regression test: the real incident (soldOrder 128 / filled 30) now reconciles to
30. `src/test-model.mjs` keeps a copy of the pre-patch implementation and asserts
that it *does* blow up, so the test can never pass vacuously.

---

## P1-2 — Multiple watcher instances silently fight

Two `watch.mjs` processes both write `data/live.json` on their own 2s timers.
Whichever writes last wins, so a stale or buggy instance can overwrite a correct
one and the symptom looks like "the fix didn't work." We hit this after patching
`extract.js` — the old pre-patch process was still running and kept stomping the
corrected output with 1-team data.

**FIXED.** `watch.mjs` writes `.watch.pid` on startup and refuses to start if
that pid is still alive, printing the `kill` command. A pidfile left behind by a
dead process is cleared automatically.

---

## P1-3 — No local record of picks

The only pick-by-pick record (price + buyer) lived in Yahoo's results page and in
a scratch file. Once the browser closed, the post-draft analysis could not be
regenerated. The overspend-by-team numbers in `DEBRIEF-2026.md` survive only
because they were computed during the session.

**FIXED.** Every detected sale is appended to `data/picks-<date>.ndjson` as it
happens, with timestamp, player, buyer and price. `extract.js` now also pulls the
sale price off the "Last:" banner, and `live.json` carries a `priceOf` map.

⚠ The price scrape is **unverified against a live Yahoo room** — the banner's
exact text was never captured. It is written defensively (wrapped in try/catch,
`null` when it fails) so it cannot break anything, but do not assume prices will
be there until you've seen one draft's worth. Buyer attribution is unaffected.

---

## P2-1 — `mineIds` never populates

Roster detection keys off the live banner reading `by === 'You'`. When state is
seeded from the results page (or the banner scrolls past), buys are attributed to
the real team name — `PRotect Ya Neck` — so `mineIds` stayed `[]` all draft and
"which players are mine" had to be recovered from `boughtBy` by hand.

**FIXED.** `config.json` carries `myTeamName`, and the watcher matches on both
that and `'You'` everywhere it attributes a buy or looks up your own budget.
Verified in simulation: the roster panel populates correctly.

---

## P2-2 — Watcher attaches to the first matching tab

`tabs.find(t => /draftclient/.test(t.url))` takes whichever tab comes first. With
two draft-room tabs open (easy to do by re-entering the room), it can attach to a
dead one and stall.

**FIXED.** The watcher now probes every `draftclient` tab and commits to the
first one that actually parses a player list, logging the ones that don't.

---

## P3-1 — Team names truncate inconsistently

`boughtBy` ended up with both `⚡️El Borracho ⚡️` and `⚡️El Borracho...`, counted
as two separate managers. Cosmetic for pricing, wrong for per-team analysis.

## P3-2 — No K or DEF in the sheet

`data/draftsheet.csv` has no kicker or defense rows, so those picks can't be
matched or valued. Harmless during the draft (nobody paid more than $2) but it
silently understates every team's spending in post-draft analysis.

## P3-3 — Errors are swallowed (FIXED)

`try { s = await evaluate(); } catch { return; }` hid every failure — CDP drop,
page navigation, parse error — behind an identical silent no-op.

**Fixed.** Every failure is logged once (de-duplicated so a persistent fault
doesn't spam the terminal) and written into `live.json` as a `stale` reason, so
the board surfaces it too. `Runtime.evaluate` now also rejects on page
exceptions and after a 5s timeout instead of hanging forever. Startup failures
print a plain-English cause and remedy rather than a stack trace.

---

# Found in a live mock draft — Sep 3, 2026

Three rounds of a Yahoo mock, driven deliberately: position filters on and off,
tab switches, re-sorts, scrolling, and a filter left on while players sold.

## What held up

- **`posFilter` is directly readable.** `extract.js` reads Yahoo's own filter
  state off a `<select>`. The live room reports `pos=TE`; an earlier probe saw
  `pos_type=All`. Both forms are handled, and this is now the primary signal for
  P0-1 with the shape/rate heuristics as fallback.
- **The resync path prevented the deadlock.** Filters and scrolls produced
  disappearances of 27, 142 and 90 players in a single tick. Each one re-synced,
  and normal sale detection resumed immediately afterwards. Under the
  refuse-only version this would have frozen the board for the rest of the draft.
- **No phantom inflation.** `filled` and `soldIds` stayed exactly equal the whole
  session; `phantoms` never left 0.
- Team, budget, roster, nomination and bid parsing were all correct throughout.

## P1-4 — Sale prices were scraped from the wrong place (FIXED)

Yahoo does **not** print the sale price in the "Last:" banner. The live DOM is:

```
Last:
K. MONANGAI
(RB · CHI)
Team 9
J. Cook III      <- the NEXT nomination starts here
RB
Buf
Bye 7
Proj $52
$56
Team 3
Offer $57
Max Offer $186
Budget $200
```

The first `$N` after "Last:" therefore belongs to the *next* player. Taking it
recorded **CeeDee Lamb at $186** — Yahoo's Max Offer field. Four of eight prices
in the first half of the mock were wrong this way.

**Fixed** by deriving the price instead of scraping it: when a player sells, the
winning team's budget drops by exactly the sale price. If precisely one team's
budget fell this tick, that's the buyer and that's the price. Exact, needs no
regex, and cross-checks the banner's own attribution for free.

Measured over the same session: 4 of 8 wrong before, 5 of 7 correct after (the
two misses were the phantom sales below, which had no price because nothing
was bought).

## P1-5 — Disappearance was still enough to record a sale (FIXED)

Immediately after a resync adopted a fresh baseline mid-scroll, two players left
the rendered list and the watcher logged:

```
SOLD ▸ Aaron Rodgers
SOLD ▸ Cooper Kupp
```

Neither had been nominated. Both had a null buyer *and* a null price, because no
team's budget had moved — the tell that nothing had been sold. The `filled`
ceiling stopped this from corrupting inflation, but the phantoms still entered
`soldOrder`, where `reconcileGone` ranks observed sales ahead of self-calibrated
ones.

**Fixed.** Yahoo's `filled` count is the authority on whether anyone was bought:
a tick may record at most `filled - lastFilled` sales, and zero if `filled`
didn't move. `salesAllowed()` in `src/model.mjs`, covered by tests.

## P0-5 — A stale tick blanked the board instead of freezing it (FIXED)

A `refuse`/`resync` write carried only `{stale, reason, teams, filled, spent}`,
so the board lost `me`, `nominated` and `block` and rendered "watcher not
running" — the same thing it shows when the watcher is genuinely dead. Those are
very different situations.

**Fixed.** The watcher keeps the last fully-trusted payload and replays it on a
stale write, so the board shows the last good numbers clearly labelled frozen.

## P0-6 — Board state accumulated silently across drafts (FIXED)

**Severity: critical, and it produced a wrong roster with nothing on screen to
suggest it.**

After the mock, the board showed **seven players in "My roster" that had never
been drafted by anyone** — De'Von Achane, Nico Collins, Omarion Hampton, Garrett
Wilson, Emeka Egbuka, D'Andre Swift, Joe Burrow.

They came from a `src/simulate.mjs` regression run: the simulator names its
first team `You`, the board tab was still polling `data/live.json`, and it
merged the simulator's picks into the real mock's localStorage. The watcher was
innocent — its log shows zero `⭐ YOURS` lines and every mock pick attributed to
`Team N`.

The underlying hole was that **nothing identified which draft the saved picks
belonged to**. Any live.json from any source — a previous draft, a mock, a test
run — was merged into whatever the board already had.

**Fixed** with session identity. Every watcher or simulator run stamps
`live.json` with `session: { id, startedAt, league, source }`. The board records
the session its localStorage belongs to and, on seeing a different one:

- **known previous session → wipe.** Merging two drafts is never wanted.
- **no recorded session but saved picks → warn, don't destroy.** Those picks
  might be a hand-marked draft in progress. A red banner says how many there
  are and points at ✦ New draft.
- **same session, or no watcher → leave alone.** A hand-driven draft with no
  watcher is never touched.

`sessionAction()` in `src/model.mjs`, covered by tests. Both paths verified in
the browser: the warning fires on orphaned state, and a genuine session change
clears it.

## P1-6 — marketBias was one number when the room used several (FIXED)

The first cut of stars-and-scrubs applied a flat **1.84×** everywhere, from the
aggregate over the 2026 draft. That is right on average and wrong exactly where
it matters. Bias by draft phase:

| picks | bias | avg inflation |
|---|---|---|
| 1–10 | **1.56×** | 0.91 |
| 11–20 | 1.92× | 0.82 |
| 21–30 | **2.11×** | 0.68 |
| 31–45 | 2.01× | 0.55 |
| 46–60 | 1.90× | 0.45 |
| 61–80 | 1.72× | 0.35 |
| 81–110 | 1.68× | 0.25 |

The room was most irrational in the **middle**, not at the top. Stars go in the
first ten picks, where the real figure is 1.56×. Using 1.84× priced Gibbs at $85
when he sold for $73, and wrongly reported that a $135 star budget could only
buy one star.

**Fixed.** `marketBiasAt(inflation)` interpolates the measured curve, keyed on
inflation as the phase proxy. Backtested: Gibbs now estimates $75 against an
actual $73. `strategy.marketBias` set to a number still overrides the curve with
a constant; `null` uses the curve.

**Caveat that belongs on this number: one draft, 98 players, seven buckets.**
It is the shape of one room's behaviour, not a calibrated coefficient.

## Still open

- **`extract.js` returns junk rows.** One parsed entry was `{"name":"CEL",
  "pos":"RB","team":"GB"}`. Harmless — `matchPlayer` returns null and it's
  ignored — but the avail regex is looser than it should be.
- **K/DEF still absent from the sheet** (P3-2), so those picks can't be valued.
- The mock used generic "Team N" names, so the custom-team-name path (P0-3) was
  *not* re-exercised live. It was fixed and verified against the 2026 draft, but
  it remains the piece with the least live evidence behind it.
