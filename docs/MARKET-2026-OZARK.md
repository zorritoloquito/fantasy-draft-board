# What the room actually paid — 2026 Ozark, Aug 30

Transcribed from Yahoo's draft-results page (`/f1/129772/draftresults`) into
`data/drafts/2026-08-30-ozark/picks.csv`. 110 picks, $1,933, 98 of them matched
to the sheet (K and DEF have no rows — KNOWN-ISSUES P3-2).

Regenerate with `node src/analyze-picks.mjs`.

Until now no prices survived the draft at all (P1-3) — `boughtBy` recorded who
won each player but never what they paid. This file is the first real market
data the system has, and it is what stars-and-scrubs pricing has to clear.

## The finding

**The room paid 1.59× book for tier 1 and 0.48× for tier 5+.** Sheet value is
not what players cost; it is what they cost *relative to their tier*.

| tier | n | sheet $ | paid $ | ratio |
|---|---|---|---|---|
| 1 | 9 | $314 | $500 | **1.59×** |
| 2 | 16 | $360 | $472 | **1.31×** |
| 3 | 27 | $533 | $602 | 1.13× |
| 4 | 24 | $314 | $235 | 0.75× |
| 5+ | 22 | $215 | $103 | **0.48×** |

This is the quantified version of the debrief's "the entire top tier went
unbid". A board that prices Gibbs at $48 × inflation will never win Gibbs — he
cleared at $73. To buy a tier-1 player you have to be willing to pay roughly
**1.6× book**, and the money has to come from the tier-4/5 bargain bin, where
the same dollar buys twice the sheet value.

## Inflation over the draft

```
pick   1   0.95
pick  20   0.75
pick  40   0.52
pick  60   0.39
pick  80   0.31
pick 100   0.24
pick 110   0.19
```

Monotonic collapse — the room spent 95% of its money in the first third of the
pool, exactly as the thesis predicted. The flat-value strategy exploited this
correctly; the cost was ceding every tier-1 player.

## Per team

| team | picks | paid | sheet value | over/under |
|---|---|---|---|---|
| 4th and Drunk | 9 | $193 | $123 | **+70** |
| BANG BUS | 12 | $196 | $143 | +53 |
| El Borracho | 9 | $192 | $156 | +36 |
| Fighting Artichokes | 9 | $193 | $159 | +34 |
| TEABAGGERS | 8 | $189 | $157 | +32 |
| The Jesus | 10 | $189 | $167 | +22 |
| Kupp My Balz | 10 | $194 | $177 | +17 |
| Thunder Punch | 14 | $199 | $203 | −4 |
| Nah...Nah...Nah! | 14 | $193 | $211 | −18 |
| **PRotect Ya Neck (us)** | 15 | $195 | $240 | **−45** |

Confirms the debrief's ranking. (The debrief said −52; it was computed from a
mid-draft snapshot, this is the final results page. −45 is the accurate figure.)

## Caveats

- **Tier ratios are one draft, one league, 98 players.** Tier 1 is nine picks.
  Treat these as the right order of magnitude, not a precise coefficient.
- They bundle two effects that this data can't separate: genuine willingness to
  pay for elite players, and early-draft inflation being near 1.0 when the top
  tier goes. Some of the 1.59× is simply *when* those players were nominated.
- K and DEF are excluded, which slightly understates every team's spending.
