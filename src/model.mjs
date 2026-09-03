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
export function checkGuards({ posSeen, vanishedCount, filled, totalPlayers, maxSalesPerTick = 3 }) {
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
