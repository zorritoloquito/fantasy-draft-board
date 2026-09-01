# 2026 Ozark Draft — Debrief

10-team, $200 auction, 0.5 PPR, 15 roster spots. Aug 30, 2026, 9:00pm EDT.
First live run of this system.

## Result

**Best value-per-dollar in the league**, by a wide margin.

| team | picks | paid | sheet value | over/under |
|---|---|---|---|---|
| 4th and Drunk | 7 | $190 | $123 | **+67** |
| BANG BUS | 6 | $182 | $139 | +43 |
| ⚡️El Borracho ⚡️ | 9 | $192 | $156 | +36 |
| Fighting Artichokes | 9 | $193 | $159 | +34 |
| TEA👊🏽BAGGERS | 7 | $187 | $155 | +32 |
| Kupp My Balz | 7 | $188 | $160 | +28 |
| The Jesus | 8 | $185 | $167 | +18 |
| Thunder Punch | 13 | $197 | $203 | −6 |
| Nah...Nah...Nah! | 14 | $193 | $211 | −18 |
| **PRotect Ya Neck (us)** | 13 | $188 | $240 | **−52** |

*(K and DEF excluded — no rows in the sheet. Snapshot taken near the end of the
draft, so counts are close to but not exactly final.)*

The thesis worked exactly as designed: let the room overpay at the top, then buy
the middle once inflation collapsed. Inflation over the course of the draft:

```
0.95  pre-draft
0.76  after ~19 spots filled
0.57  after ~36
0.47  after ~40
0.39  peak buying window
1.03  end of draft — market normalized, bargains gone
```

Nearly every purchase landed in the 0.39–0.57 window. The room spent 95% of its
money on the first third of the player pool.

## Final roster

```
QB  Matthew Stafford    $1   tier 4  bye 11
RB  Kyren Williams      $26  tier 4  bye 11
RB  Javonte Williams    $25  tier 4  bye 14
RB  Breece Hall         $25  tier 4  bye 13
RB  Travis Etienne Jr.  $23  tier 4  bye 8
RB  Bucky Irving        $21  tier 4  bye 10
RB  Quinshon Judkins    $21  tier 4  bye 11
TE  Colston Loveland    $16  tier 2  bye 10
WR  Garrett Wilson      $19  tier 3  bye 13
WR  Emeka Egbuka        $17  tier 3  bye 10
WR  Ladd McConkey       $16  tier 3  bye 7
WR  Jameson Williams    $15  tier 3  bye 6
WR  Jaylen Waddle       $15  tier 3  bye 10

$189 spent, $11 unspent, 14/15 filled
```

## What worked

- **The inflation model.** `moneyLeft / valueLeft` was the single most useful
  number on the screen, and it tracked the room's behavior accurately.
- **Sitting out the top.** Watching Gibbs go for $73 against a $48 sheet value,
  and Josh Allen for $45 against $18, and not chasing.
- **Recovering from corruption mid-draft** by reseeding from Yahoo's own results
  page. That is now a permanent feature (`data/seed.json`).
- **Chat as a live advisor.** Genuinely the highest-value surprise of the night —
  see ROADMAP item 3.

## What to change

**1. The system can only play one strategy.** The sheet encodes flat value, so
the board is structurally incapable of recommending a star. The entire top tier
went unbid. That was the tool's choice, not a decision made with open eyes — see
ROADMAP item 2 (stars-and-scrubs / hybrid).

**2. No visibility into tier breaks.** Sheet value doesn't tell you a player is
the last of his tier. Knowing "last tier-2 TE" or "tier 2→3 cliff" would have
justified paying above target in several spots. ROADMAP item 1, top priority.

**3. Six RBs, zero elite players.** A consequence of 1 and 2 together: the roster
is broad, safe, and has no ceiling. Also four starters on bye 10.

**4. Three separate near-disasters** in the last 20 minutes before and during the
draft, all from the same root cause. See KNOWN-ISSUES.md.

## Timeline of failures

Worth keeping because it shows how the failures presented, which is the hard part.

- **~19:50, pre-flight.** Team-name regex matched only mock-draft names; 9 of 10
  teams invisible. Caught by luck during a pre-draft check. Fixed in place.
- **~20:25, mid-draft.** Board froze. Cause: draft room had been switched to the
  Team tab, so the player list wasn't in the DOM. Silent — no error anywhere.
- **~20:38, mid-draft.** Board showed inflation 2.96 and a $92 target on a player
  who sold for $40. Cause: a position filter had been applied; the watcher marked
  98 unsold players as sold. **This is the dangerous class of bug — it produced
  confident, plausible, wrong numbers rather than an obvious failure.**
- **~20:40.** Recovered by scraping Yahoo's draft-results page, rebuilding state
  into `data/seed.json`, and restarting. Cost: the `boughtBy` attribution
  history, which was rebuilt more accurately from Yahoo anyway.

The through-line: **the watcher cannot distinguish "sold" from "not currently
rendered."** Fix that and most of this file goes away.
