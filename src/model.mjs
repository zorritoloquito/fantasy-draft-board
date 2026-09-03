// Pure decision logic, extracted from watch.mjs so it can be tested without a
// live draft room. Every P0/P1 in KNOWN-ISSUES lived in this code and none of
// it had test coverage, because it was welded to a CDP socket and a setInterval.
// Nothing in here does I/O.

/** Decides whether a tick can be trusted (KNOWN-ISSUES P0-1).
 *
 *  Returns one of three actions:
 *    ok      — diff normally.
 *    refuse  — the view is wrong (filter, wrong tab). Do not diff and do NOT
 *              advance the baseline; the next healthy tick recovers by itself.
 *    resync  — the view looks healthy but too much changed at once. Adopt the
 *              new list as the baseline WITHOUT recording those as sales, and
 *              let `filled`-driven self-calibration work out who actually went.
 *
 *  The `resync` case exists because refusing here deadlocks: filter the list for
 *  thirty seconds, four players sell, unfilter — four vanish in one tick, the
 *  rate guard trips, the baseline never advances, and it trips forever. Adopting
 *  the baseline is safe because `reconcileGone` caps the sold list at Yahoo's
 *  own `filled` count, so a resync cannot invent sales.
 */
export function checkGuards({ posSeen, vanishedCount, filled, totalPlayers,
                              maxSalesPerTick = 3, posFilter = null }) {
  // Yahoo exposes the filter directly as `pos_type=All` on a <select>. Verified
  // against a live draft room on Sep 3. This is a definitive signal, so it goes
  // first — the heuristics below are the fallback for when the DOM changes.
  if (posFilter && !/=All$/i.test(posFilter))
    return { action: 'refuse',
             reason: `the player list is filtered (${posFilter.replace(/^pos_type=/, '')}) — set the position filter back to All.` };

  // A position filter drops every other position from the DOM at once. Late in a
  // draft the pool genuinely thins, so only apply this while plenty remain.
  if (posSeen.size < 3 && filled < totalPlayers - 20)
    return { action: 'refuse',
             reason: `only ${[...posSeen].join('/')} in the list — position filter is on. Set it back to All.` };

  // An auction sells one player at a time. More than a couple vanishing inside
  // one 2s tick is a re-render — a re-sort, a scroll, or a view just restored
  // after being filtered. Don't believe it as sales, but don't get stuck either.
  if (vanishedCount > maxSalesPerTick)
    return { action: 'resync',
             reason: `${vanishedCount} players left the list at once — re-synced against Yahoo's pick count rather than counting them as sales.` };

  return { action: 'ok', reason: null };
}

/** How many of this tick's disappearances may be recorded as sales.
 *  Yahoo's `filled` count is the authority: if it didn't move, nobody was
 *  bought, however many players left the rendered list.
 *
 *  Observed live on Sep 3: right after a re-sync adopted a fresh baseline
 *  mid-scroll, two players vanished and were logged as "SOLD ▸ Aaron Rodgers"
 *  and "SOLD ▸ Cooper Kupp". Neither had been nominated. Both had a null buyer
 *  AND a null price, because no team's budget had moved — the tell that nothing
 *  was actually sold. */
export function salesAllowed({ filled, lastFilled }) {
  if (lastFilled == null) return 0;      // first tick has no baseline to trust
  return Math.max(filled - lastFilled, 0);
}

/** Builds the sold list, using Yahoo's `filled` count as ground truth.
 *  KNOWN-ISSUES P1-1: `soldOrder` used to be append-only and uncapped, so one
 *  bad tick poisoned every later tick (soldIds 128 against filled 30). */
export function reconcileGone({ soldOrder, availIds, filled, players, boughtBy = {} }) {
  const byId = new Map(players.map(p => [p.id, p]));

  const observed = soldOrder.map(id => byId.get(id)).filter(Boolean);
  const goneList = [...observed];
  const have = new Set(observed.map(p => p.id));

  // Yahoo renders only its own top ~100 available, so "absent from our sheet"
  // can't be read directly. Self-calibrate: walk best-first and take absent
  // players until we've accounted for exactly `filled` sales.
  const ranked = [...players].sort((a, b) => (b.value || 0) - (a.value || 0));
  for (const p of ranked) {
    if (goneList.length >= filled) break;
    if (!availIds.has(p.id) && !have.has(p.id)) { goneList.push(p); have.add(p.id); }
  }

  let phantoms = 0;
  if (goneList.length > filled) {
    phantoms = goneList.length - filled;
    // Keep the ones we have a named buyer for; those are the confident sales.
    goneList.sort((a, b) => (boughtBy[b.id] ? 1 : 0) - (boughtBy[a.id] ? 1 : 0));
    goneList.length = filled;
  }
  return { goneList, phantoms };
}

/** moneyLeft / valueLeft — the number the whole board turns on. */
export function inflationOf({ teams, budget, spent, totalValue, goneValue }) {
  const moneyLeft = teams * budget - spent;
  const valueLeft = Math.max(totalValue - goneValue, 1);
  return { moneyLeft, valueLeft, inflation: moneyLeft / valueLeft };
}

/* ---------- positional scarcity & tier breaks (ROADMAP 1) ----------
   The question that drives aggression in an auction is not "what is he worth"
   but "how many like him are left, and what happens to my options if I lose
   him". Sheet value can't answer that; tier structure can.

   `drop` is the load-bearing number. "Last in tier" with $1 behind it is noise;
   "last in tier" with $9 behind it is a reason to break your target price.
------------------------------------------------------------------------------- */
export function tierScarcity(players, isTaken = () => false) {
  const POSN = ['QB', 'RB', 'WR', 'TE'];
  const byVal = a => [...a].sort((x, y) => (y.value - x.value) || (x.ecr - y.ecr));
  const out = {};

  for (const pos of POSN) {
    const all  = players.filter(p => p.pos === pos);
    if (!all.length) continue;
    const left = byVal(all.filter(p => !isTaken(p.id)));
    const totVal  = all.reduce((a, p) => a + (p.value || 0), 0);
    const leftVal = left.reduce((a, p) => a + (p.value || 0), 0);

    const tiers = new Map();
    for (const p of left) { if (!tiers.has(p.tier)) tiers.set(p.tier, []); tiers.get(p.tier).push(p); }
    const order = [...tiers.keys()].sort((a, b) => a - b);

    const flags = new Map();
    order.forEach((tier, i) => {
      const grp  = tiers.get(tier);
      const next = i + 1 < order.length ? tiers.get(order[i + 1])[0] : null;
      // distance from the WORST remaining player in this tier to the BEST in
      // the next: what you actually fall to if this tier empties out.
      const drop = next ? Math.max((grp[grp.length - 1].value || 0) - (next.value || 0), 0) : 0;
      for (const p of grp) flags.set(p.id, {
        tier, leftInTier: grp.length, nextTier: next ? next.tier : null,
        drop, isLast: grp.length === 1, cliff: grp.length === 1 ? drop : 0,
      });
    });

    const topTier = order[0] ?? null;
    const topGrp  = topTier != null ? tiers.get(topTier) : [];
    const nextGrp = order.length > 1 ? tiers.get(order[1]) : null;
    out[pos] = {
      left: left.length, total: all.length, leftVal, totVal,
      goneFrac: totVal ? 1 - leftVal / totVal : 1,
      best: left[0] ?? null,
      topTier, leftInTopTier: topGrp.length,
      nextTier: nextGrp ? nextGrp[0].tier : null,
      cliff: nextGrp ? Math.max((topGrp[topGrp.length - 1].value || 0) - (nextGrp[0].value || 0), 0) : 0,
      flags,
    };
  }
  return out;
}

/** Short badge text for a player row, or '' when there is nothing worth saying. */
export function tierBadge(flag, pos) {
  if (!flag) return null;
  if (flag.isLast && flag.cliff >= 4)
    return { kind: 'last', text: `LAST T${flag.tier} · −$${flag.cliff}`,
             title: `last ${pos} in tier ${flag.tier}; the next tier's best is $${flag.cliff} cheaper` };
  if (flag.isLast)
    return { kind: 'thin', text: `LAST T${flag.tier}`,
             title: `last ${pos} in tier ${flag.tier}, but only $${flag.cliff} behind him` };
  if (flag.leftInTier === 2 && flag.drop >= 4)
    return { kind: 'cliff', text: `2 LEFT T${flag.tier}`,
             title: `only 2 ${pos}s left in tier ${flag.tier}; $${flag.drop} drop behind them` };
  return null;
}

/* ---------- budget strategy (ROADMAP 2) ----------------------------------
   Measured against the 2026 draft (docs/MARKET-2026-OZARK.md): the room paid
   1.84x the board's own target, and — once inflation is accounted for —
   it did so almost identically at EVERY tier (1.85 / 1.87 / 1.85 / 1.84 /
   1.57). So the flat-value model isn't mispricing stars specifically; it is
   uniformly low. Tier multipliers would be fitting noise on nine picks.

   The cause is structural, not a bug. `inflation = moneyLeft / valueLeft`
   prices a player as if all remaining money chased all remaining value evenly.
   Money is not spent evenly — the room dumps it early. So the model is
   accurate late (where it found real bargains) and far too timid early, which
   is precisely why the entire top tier went unbid.

   The fix is not a mode switch. It's a BUDGET PLAN, declared before the draft
   and tracked against reality as it goes:

     starSlots  how many premium players you intend to buy
     starBudget how much of your $200 is reserved for them

   Everything below follows from the plan's live state. Nothing here needs to
   be toggled mid-draft: once the stars are bought or gone, the unspent star
   money rolls into the scrub pool on its own.
-------------------------------------------------------------------------- */

/** Live state of the budget plan: what's committed, what's left, what a slot
 *  is worth in each pot right now. */
export function planState({ budget, filled, slots, strategy, myStarsBought = 0 }) {
  const starSlots  = Math.max(strategy?.starSlots ?? 0, 0);
  const starBudget = Math.max(strategy?.starBudget ?? 0, 0);
  const slotsLeft  = Math.max(slots - filled, 0);

  const starsLeft = Math.max(starSlots - myStarsBought, 0);
  const scrubSlotsLeft = Math.max(slotsLeft - starsLeft, 0);

  // Yahoo's own rule: you must keep $1 for every other empty slot.
  const maxBid = slotsLeft > 0 ? budget - (slotsLeft - 1) : 0;

  // Star money still available = whatever's left of the star allocation, but
  // never more than we can actually spend while still filling the roster.
  const spentOnStars = Math.max(starBudget - (budget - scrubSlotsLeft * 1), 0);
  let starPot = starsLeft > 0 ? Math.min(starBudget - spentOnStars, maxBid) : 0;
  starPot = Math.max(starPot, 0);

  // If the star plan is dead (no stars left to buy, or the window closed), the
  // reserve rolls into the scrub pool automatically. This is the "fallback to
  // value mode" that would otherwise need a toggle.
  const scrubPot = Math.max(budget - starPot, 0);

  return {
    starSlots, starBudget, starsLeft, slotsLeft, scrubSlotsLeft,
    maxBid: Math.max(maxBid, 0),
    starPot,
    perStar:  starsLeft > 0 ? Math.floor(starPot / starsLeft) : 0,
    scrubPot,
    perScrub: scrubSlotsLeft > 0 ? scrubPot / scrubSlotsLeft : 0,
    planActive: starsLeft > 0 && starPot > 0,
  };
}

/** Can the plan actually buy what it says it wants, at real market prices?
 *  Dividing the star budget evenly is the naive answer and it is usually wrong:
 *  $140 across 3 stars is $46 each, but stars clear around $60-75, so that plan
 *  wins nothing. This works out how many stars the money really buys, and what
 *  you can pay for THIS one while still affording the rest.
 *
 *  `starPrices` = market estimates for the best remaining star candidates,
 *  best first, excluding the player being priced. */
export function planViability({ plan, starPrices = [] }) {
  const need = plan.starsLeft;
  if (need <= 0 || plan.starPot <= 0) return { need: 0, afford: 0, shortfall: 0, typical: 0, ok: true };

  const typical = starPrices.length
    ? Math.round(starPrices.slice(0, need).reduce((a, p) => a + p, 0) / Math.min(need, starPrices.length))
    : 0;

  // How many of the players you'd actually TARGET can the pot cover? Walk them
  // best-first, taking each if it still fits and skipping the ones that don't.
  // Cheapest-first would flatter the plan: it answers "can I buy two stars"
  // with the two cheapest star-tier players, which is not the plan you wrote.
  let afford = 0, budget = plan.starPot;
  for (const price of starPrices) {
    if (afford >= need) break;
    if (budget >= price) { budget -= price; afford++; }
  }
  const wanted    = starPrices.slice(0, need).reduce((a, p) => a + p, 0);
  // If the plan is executable, there is no shortfall to report — you may not
  // land the two most expensive names, but you can fill the star slots.
  const shortfall = afford >= need ? 0 : Math.max(Math.round(wanted - plan.starPot), 0);
  // Being $1 short of an estimate is not the same as being $60 short, and it
  // shouldn't flip the verdict off a cliff — these are estimates, and one
  // player going slightly cheap closes a small gap.
  const tight = afford < need && shortfall > 0 && shortfall <= Math.max(plan.starPot * 0.12, 8);
  return { need, afford, typical, shortfall, tight, ok: afford >= need };
}

/* Measured from the 2026 Ozark draft: price ÷ (book × inflation), bucketed by
   how far through the draft the pick landed, keyed by the inflation reading at
   the time. The room did NOT pay a constant premium — it was most irrational in
   the middle, not at the top:

       inflation 0.91  →  1.56x    (picks 1-10, where the stars go)
       inflation 0.82  →  1.92x
       inflation 0.68  →  2.11x    (peak overpaying)
       inflation 0.55  →  2.01x
       inflation 0.45  →  1.90x
       inflation 0.35  →  1.72x
       inflation 0.25  →  1.68x

   An earlier version used the single aggregate figure of 1.84x everywhere. That
   is right on average and wrong exactly where it matters most: it priced Gibbs
   at $85 when he went for $73, and consequently claimed a $135 star budget
   could only buy one star instead of two.

   ONE DRAFT, 98 PLAYERS. Treat this as the shape of the room's behaviour, not
   as a calibrated coefficient. Set `strategy.marketBias` to a number in
   config.json to override the whole curve with a constant. */
const BIAS_CURVE = [[0.91, 1.56], [0.82, 1.92], [0.68, 2.11], [0.55, 2.01],
                    [0.45, 1.90], [0.35, 1.72], [0.25, 1.68]];

/** How much more than the board's own target the room is likely to pay, at this
 *  point in the draft. Linear interpolation between measured points, flat
 *  outside the observed range. */
export function marketBiasAt(inflation, override = null) {
  if (typeof override === 'number') return override;
  const pts = BIAS_CURVE;                      // sorted by descending inflation
  if (inflation >= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (inflation <= last[0]) return last[1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (inflation <= x0 && inflation >= x1)
      return y0 + (y1 - y0) * ((x0 - inflation) / (x0 - x1));
  }
  return last[1];
}

/** What this player is likely to actually COST, versus what the sheet says he
 *  is worth. `marketBias` is the measured gap between the board's target and
 *  the clearing price — 1.0 means "trust the sheet", 1.84 is what 2026 did. */
export function priceView(player, opts = {}) {
  const { inflation = 1, strategy = {}, plan = null } = opts;
  const book = player?.value ?? 0;
  const bias = marketBiasAt(inflation, strategy.marketBias ?? null);

  const valueTarget = Math.max(Math.round(book * inflation), 1);   // the old board
  const marketEst   = Math.max(Math.round(book * inflation * bias), 1);

  // What the plan can afford for this player right now.
  let planMax = valueTarget, lane = 'value';
  if (plan && plan.planActive && isStarCandidate(player, strategy)) {
    // Spend up to whatever is left after reserving market price for the OTHER
    // stars you still want — not a flat share of the pot. Reserving $46 each
    // when stars cost $65 loses all three; reserving the real cost of the
    // remaining two tells you what you can actually throw at this one.
    const others  = (opts.otherStarPrices ?? []).slice(0, Math.max(plan.starsLeft - 1, 0));
    const reserve = others.reduce((a, p) => a + p, 0);
    planMax = Math.max(plan.starPot - reserve, plan.perStar, valueTarget);
    lane = 'star';
  } else if (plan) {
    // Scrubs are capped by what the remaining slots can bear, so a mid-tier
    // buy can't quietly eat the money the rest of the roster needs.
    planMax = Math.max(Math.min(valueTarget, Math.round(plan.scrubPot - (plan.scrubSlotsLeft - 1))), 1);
  }
  planMax = Math.min(planMax, plan ? plan.maxBid : planMax);

  return { book, valueTarget, marketEst, planMax: Math.max(planMax, 1), lane };
}

/** Is this player one the star budget is meant for? */
export function isStarCandidate(player, strategy = {}) {
  if (!player) return false;
  const names = strategy.mustHave ?? [];
  if (names.length && names.some(n => player.id === n || player.name === n)) return true;
  return (player.tier ?? 99) <= (strategy.starTier ?? 2);
}

/** "Paying $X here leaves $Y per slot for Z spots" — the consequence line. */
export function afterSpending(price, { budget, filled, slots }) {
  const slotsLeft = Math.max(slots - filled, 0);
  const left      = budget - price;
  const remaining = Math.max(slotsLeft - 1, 0);
  return {
    left, remaining,
    perSlot: remaining > 0 ? left / remaining : 0,
    affordable: slotsLeft > 0 && left >= remaining,   // still $1 for every slot
  };
}

/** What to do with saved picks when a draft session identifies itself.
 *
 *  Every watcher/simulator run stamps live.json with a session id; the board
 *  remembers which session its localStorage belongs to. Without this, state
 *  accumulates silently across drafts: on Sep 3 a simulator run left seven
 *  players marked "mine" on a board watching an unrelated mock, and nothing on
 *  screen suggested anything was wrong (KNOWN-ISSUES P0-6).
 *
 *    adopt — nothing saved, or same session. Carry on.
 *    wipe  — we know which draft these picks came from and it isn't this one.
 *            Merging two drafts is never what anyone wants.
 *    warn  — picks of unknown provenance. Could be a hand-marked draft in
 *            progress, could be leftovers. Don't destroy them; say so loudly.
 */
export function sessionAction({ savedSession, incomingSession, savedPickCount = 0 }) {
  if (!incomingSession) return 'adopt';                  // offline / hand-driven
  if (savedSession === incomingSession) return 'adopt';
  if (savedSession) return 'wipe';
  return savedPickCount > 0 ? 'warn' : 'adopt';
}

/** Your share of the money still in the room, and how that compares to an even
 *  split among the teams still buying. Above 1.0x means you can outbid the room
 *  on anything you actually want; below means you're being squeezed. */
export function moneyShare({ myBudget, moneyLeft, activeTeams }) {
  const n = Math.max(activeTeams, 1);
  const share = moneyLeft > 0 ? myBudget / moneyLeft : 0;
  const even  = 1 / n;
  return { share, evenShare: even, relative: even > 0 ? share / even : 0, activeTeams: n };
}
