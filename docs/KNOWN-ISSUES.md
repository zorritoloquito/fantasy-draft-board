# Known Issues

Every bug below was hit live during the 2026 Ozark auction on Aug 30. They are
ordered by how much damage they did, not by how hard they are to fix.

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

**Repro:** start the watcher, click any position filter, wait 2s, read
`data/live.json`.

**Suggested fix:** don't infer sales from disappearance alone. Yahoo's draft
results page (`/f1/<league>/draftresults`) is authoritative and carries pick,
player, price, and buyer. Poll that instead of, or as a cross-check against, the
disappearance diff. At minimum, detect the filter state (`pos_type=All` appears
in the DOM) and refuse to diff when it isn't `All`.

---

## P0-2 — Any non-Players view freezes the board with no error

Switching to the Team, Queue, or Chat tab drops the available-player list from
the DOM. `avail` parses as 0, `watch.mjs` early-returns on `!s.avail?.length`,
and `live.json` simply stops being written.

The board keeps polling and keeps rendering the last file it got, so **stale data
is visually indistinguishable from live data.** We lost ~4 minutes mid-auction to
this before noticing, and again later when the watcher wasn't running at all.

**Suggested fix:** two parts. (1) On an empty parse, still write `live.json` with
`stale: true` and a reason, rather than writing nothing. (2) Have the board show
a loud banner when `Date.now() - ts` exceeds ~10s. The `ts` field already exists
and is currently unused by the UI.

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

**Suggested fix:** treat `filled` as ground truth. If `soldOrder.length` exceeds
it, the extra entries are provably phantom — drop them, or reconcile against the
draft-results page.

---

## P1-2 — Multiple watcher instances silently fight

Two `watch.mjs` processes both write `data/live.json` on their own 2s timers.
Whichever writes last wins, so a stale or buggy instance can overwrite a correct
one and the symptom looks like "the fix didn't work." We hit this after patching
`extract.js` — the old pre-patch process was still running and kept stomping the
corrected output with 1-team data.

**Suggested fix:** pidfile or a port lock on startup; refuse to start (or offer
to kill the incumbent) if another instance is live.

---

## P1-3 — No local record of picks

The only pick-by-pick record (price + buyer) lived in Yahoo's results page and in
a scratch file. Once the browser closed, the post-draft analysis could not be
regenerated. The overspend-by-team numbers in `DEBRIEF-2026.md` survive only
because they were computed during the session.

**Suggested fix:** append every detected sale to `data/picks-<date>.ndjson` as it
happens. Cheap, and it makes the whole draft replayable for testing.

---

## P2-1 — `mineIds` never populates

Roster detection keys off the live banner reading `by === 'You'`. When state is
seeded from the results page (or the banner scrolls past), buys are attributed to
the real team name — `PRotect Ya Neck` — so `mineIds` stayed `[]` all draft and
"which players are mine" had to be recovered from `boughtBy` by hand.

**Suggested fix:** resolve the user's real team name once at startup and match on
both it and `'You'`.

---

## P2-2 — Watcher attaches to the first matching tab

`tabs.find(t => /draftclient/.test(t.url))` takes whichever tab comes first. With
two draft-room tabs open (easy to do by re-entering the room), it can attach to a
dead one and stall.

**Suggested fix:** prefer the most recently active tab, or verify the chosen tab
actually parses before committing to it.

---

## P3-1 — Team names truncate inconsistently

`boughtBy` ended up with both `⚡️El Borracho ⚡️` and `⚡️El Borracho...`, counted
as two separate managers. Cosmetic for pricing, wrong for per-team analysis.

## P3-2 — No K or DEF in the sheet

`data/draftsheet.csv` has no kicker or defense rows, so those picks can't be
matched or valued. Harmless during the draft (nobody paid more than $2) but it
silently understates every team's spending in post-draft analysis.

## P3-3 — Errors are swallowed

`try { s = await evaluate(); } catch { return; }` hides every failure — CDP drop,
page navigation, parse error — behind an identical silent no-op. Log the reason.
