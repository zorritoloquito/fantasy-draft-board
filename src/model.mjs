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

  // How many can the pot actually cover, buying cheapest-first among the ones
  // we'd realistically target?
  let afford = 0, budget = plan.starPot;
  for (const price of [...starPrices].sort((a, b) => a - b)) {
    if (afford >= need) break;
    if (budget >= price) { budget -= price; afford++; } else break;
  }
  const wanted = starPrices.slice(0, need).reduce((a, p) => a + p, 0);
  return {
    need, afford, typical,
    shortfall: Math.max(Math.round(wanted - plan.starPot), 0),
    ok: afford >= need,
  };
}

/** What this player is likely to actually COST, versus what the sheet says he
 *  is worth. `marketBias` is the measured gap between the board's target and
 *  the clearing price — 1.0 means "trust the sheet", 1.84 is what 2026 did. */
export function priceView(player, opts = {}) {
  const { inflation = 1, strategy = {}, plan = null } = opts;
  const book = player?.value ?? 0;
  const bias = strategy.marketBias ?? 1;

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
