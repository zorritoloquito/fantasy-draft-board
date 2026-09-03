// Regression tests for the failures that actually happened during the 2026
// Ozark auction. Each case below is taken from docs/KNOWN-ISSUES.md, with the
// real numbers observed on the night.
import { readFileSync } from 'node:fs';
import { checkGuards, reconcileGone, inflationOf, tierScarcity, tierBadge,
         planState, priceView, isStarCandidate, afterSpending,
         planViability, salesAllowed } from './model.mjs';

const SHEET = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url)));
const P = SHEET.players;
const TOTVAL = P.reduce((a, p) => a + (p.value || 0), 0);

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m ?? ''} expected ${b}, got ${a}`); };
const ok = (v, m) => { if (!v) throw new Error(m ?? 'expected truthy'); };

const idsExcept = gone => new Set(P.filter(p => !gone.has(p.id)).map(p => p.id));

console.log('\nP0-1 — position filter must not be read as a mass sale');
t('a TE-only list is REFUSED (baseline must not advance)', () => {
  const g = checkGuards({ posSeen: new Set(['TE']), vanishedCount: 98, filled: 30,
                          totalPlayers: P.length });
  eq(g.action, 'refuse');
  ok(/position filter/.test(g.reason), `wrong reason: ${g.reason}`);
});
t('98 vanishing with a healthy-looking list RESYNCS rather than refusing', () => {
  const g = checkGuards({ posSeen: new Set(['QB','RB','WR','TE']), vanishedCount: 98,
                          filled: 30, totalPlayers: P.length });
  eq(g.action, 'resync');
});
t('a normal tick with one sale passes', () => {
  eq(checkGuards({ posSeen: new Set(['QB','RB','WR','TE']), vanishedCount: 1,
                   filled: 30, totalPlayers: P.length }).action, 'ok');
});
t('a quiet tick with zero sales passes', () => {
  eq(checkGuards({ posSeen: new Set(['QB','RB','WR','TE']), vanishedCount: 0,
                   filled: 30, totalPlayers: P.length }).action, 'ok');
});
t('late draft, thin pool, few positions left is NOT treated as a filter', () => {
  eq(checkGuards({ posSeen: new Set(['WR']), vanishedCount: 1,
                   filled: P.length - 5, totalPlayers: P.length }).action, 'ok');
});

t('Yahoo\'s own filter state is believed over any heuristic', () => {
  // Verified against a live draft room Sep 3: extract.js reads "pos_type=All".
  eq(checkGuards({ posSeen: new Set(['QB','RB','WR','TE']), vanishedCount: 0, filled: 5,
                   totalPlayers: P.length, posFilter: 'pos_type=All' }).action, 'ok');
  const g = checkGuards({ posSeen: new Set(['QB','RB','WR','TE']), vanishedCount: 0, filled: 5,
                          totalPlayers: P.length, posFilter: 'pos_type=TE' });
  eq(g.action, 'refuse');
  ok(/filtered \(TE\)/.test(g.reason), `reason was: ${g.reason}`);
});
t('a missing filter reading falls back to the heuristics', () => {
  eq(checkGuards({ posSeen: new Set(['TE']), vanishedCount: 0, filled: 5,
                   totalPlayers: P.length, posFilter: null }).action, 'refuse');
});

console.log('\nClicking around the draft room mid-auction');
t('filter on → refuse; filter off with sales missed → resync, never deadlock', () => {
  // The exact sequence Luis described: click a position filter, leave it on
  // while the room keeps drafting, then switch back.
  const shapeBad  = checkGuards({ posSeen: new Set(['TE']), vanishedCount: 90,
                                  filled: 30, totalPlayers: P.length });
  eq(shapeBad.action, 'refuse', 'while filtered:');

  // View restored. Four players sold during the blackout, so four vanish at
  // once relative to the stale pre-filter baseline. Under the first version of
  // this guard that refused forever — the board froze for the rest of the draft.
  const restored = checkGuards({ posSeen: new Set(['QB','RB','WR','TE']),
                                 vanishedCount: 4, filled: 34, totalPlayers: P.length });
  eq(restored.action, 'resync', 'after unfiltering:');

  // And the very next tick is normal again.
  eq(checkGuards({ posSeen: new Set(['QB','RB','WR','TE']), vanishedCount: 1,
                   filled: 35, totalPlayers: P.length }).action, 'ok', 'next tick:');
});
t('a resync cannot invent sales — filled still caps the sold list', () => {
  // Worst case: a resync adopts a baseline implying 128 players are gone while
  // Yahoo reports 34 filled. The ceiling has to hold.
  const ranked = [...P].sort((a, b) => (b.value || 0) - (a.value || 0));
  const hidden = new Set(ranked.slice(0, 128).map(p => p.id));
  const { goneList } = reconcileGone({
    soldOrder: [], availIds: idsExcept(hidden), filled: 34, players: P });
  eq(goneList.length, 34);
});
t('switching to the Team tab never reaches the guards at all', () => {
  // An empty parse is handled upstream in watch.mjs: it writes stale + reason
  // and returns before diffing. Guarded here so the contract stays documented.
  eq(checkGuards({ posSeen: new Set(), vanishedCount: 0, filled: 30,
                   totalPlayers: P.length }).action, 'refuse');
});

console.log('\nP1-1 — `filled` is the ceiling; phantoms get dropped');
t('soldOrder of 128 against filled 30 reconciles to 30', () => {
  const soldOrder = P.slice(0, 128).map(p => p.id);
  const { goneList, phantoms } = reconcileGone({
    soldOrder, availIds: idsExcept(new Set(soldOrder)), filled: 30, players: P });
  eq(goneList.length, 30, 'goneList size:');
  eq(phantoms, 98, 'phantoms:');
});
t('players with a known buyer survive reconciliation over unattributed ones', () => {
  const soldOrder = P.slice(0, 10).map(p => p.id);
  const keep = soldOrder[7];
  const { goneList } = reconcileGone({
    soldOrder, availIds: idsExcept(new Set(soldOrder)), filled: 3, players: P,
    boughtBy: { [keep]: 'The Jesus' } });
  eq(goneList.length, 3);
  ok(goneList.some(p => p.id === keep), 'the attributed sale was dropped');
});
t('self-calibration still fills up to `filled` when soldOrder is empty', () => {
  const top = new Set(P.slice().sort((a,b)=>(b.value||0)-(a.value||0)).slice(0, 12).map(p => p.id));
  const { goneList, phantoms } = reconcileGone({
    soldOrder: [], availIds: idsExcept(top), filled: 12, players: P });
  eq(goneList.length, 12);
  eq(phantoms, 0);
});
t('unknown ids in soldOrder are ignored, not counted', () => {
  const { goneList } = reconcileGone({
    soldOrder: ['RB:Nobody At All', 'WR:Also Fake'], availIds: new Set(P.map(p=>p.id)),
    filled: 0, players: P });
  eq(goneList.length, 0);
});

console.log('\nThe $92-on-a-$40-player bug, end to end');
// The pre-patch reconciliation, kept verbatim so these tests provably have
// teeth: if a future refactor reintroduces the append-without-cap, the
// comparison below fails loudly instead of passing vacuously.
function reconcileGone_PRE_PATCH({ soldOrder, availIds, filled, players }) {
  const ranked = [...players].sort((a, b) => (b.value || 0) - (a.value || 0));
  const goneList = [];
  for (const p of ranked) { if (goneList.length >= filled) break; if (!availIds.has(p.id)) goneList.push(p); }
  for (const id of soldOrder) {
    const p = players.find(x => x.id === id);
    if (p && !goneList.includes(p)) goneList.push(p);   // <- uncapped: the bug
  }
  return { goneList };
}

// Aug 30, ~20:38. A position filter hid every non-TE player, so the ~128
// highest-valued players all "vanished" in one tick while Yahoo reported 30
// roster spots filled. Board advised $92 on Chase Brown; he sold for $40.
const FILTER_INCIDENT = (() => {
  const ranked = [...P].sort((a, b) => (b.value || 0) - (a.value || 0));
  const soldOrder = ranked.slice(0, 128).map(p => p.id);
  const hidden = new Set(soldOrder);
  return { soldOrder, availIds: idsExcept(hidden), filled: 30, spent: 1189 };
})();

t('the pre-patch code really did blow up (guards the test itself)', () => {
  const { goneList } = reconcileGone_PRE_PATCH({ ...FILTER_INCIDENT, players: P });
  const goneValue = goneList.reduce((a, p) => a + (p.value || 0), 0);
  const { inflation } = inflationOf({ teams: 10, budget: 200, spent: FILTER_INCIDENT.spent,
                                      totalValue: TOTVAL, goneValue });
  eq(goneList.length, 128, 'pre-patch goneList:');
  ok(inflation > 2.5, `pre-patch inflation should be absurd, got ${inflation.toFixed(2)}`);
});

t('the same input now reconciles to Yahoo\'s filled count', () => {
  const { goneList, phantoms } = reconcileGone({ ...FILTER_INCIDENT, players: P });
  eq(goneList.length, 30, 'goneList:');
  eq(phantoms, 98, 'phantoms:');
});

t('and produces a sane inflation instead of 2.96+', () => {
  const { goneList } = reconcileGone({ ...FILTER_INCIDENT, players: P });
  const goneValue = goneList.reduce((a, p) => a + (p.value || 0), 0);
  const { inflation } = inflationOf({ teams: 10, budget: 200, spent: FILTER_INCIDENT.spent,
                                      totalValue: TOTVAL, goneValue });
  ok(inflation < 1.2, `inflation still wrong: ${inflation.toFixed(2)}`);
});

t('the guard stops that tick before it is ever recorded', () => {
  eq(checkGuards({ posSeen: new Set(['TE']), vanishedCount: 128, filled: 30,
                   totalPlayers: P.length }).action, 'refuse');
});

console.log('\nInflation arithmetic');
t('pre-draft inflation is about 1.0', () => {
  const { inflation } = inflationOf({ teams: 10, budget: 200, spent: 0,
                                      totalValue: TOTVAL, goneValue: 0 });
  ok(Math.abs(inflation - 0.95) < 0.15, `got ${inflation.toFixed(2)}`);
});
t('valueLeft never divides by zero', () => {
  const { inflation, valueLeft } = inflationOf({ teams: 10, budget: 200, spent: 2000,
                                                 totalValue: TOTVAL, goneValue: TOTVAL });
  eq(valueLeft, 1);
  ok(Number.isFinite(inflation));
});
t('config drives the money pool', () => {
  eq(inflationOf({ teams: 12, budget: 300, spent: 0, totalValue: 100, goneValue: 0 }).moneyLeft, 3600);
});

console.log('\nPositional scarcity & tier breaks (ROADMAP 1)');
const S0 = tierScarcity(P);                       // nothing drafted yet

t('every position reports a full, undrafted pool', () => {
  eq(S0.QB.left, 40); eq(S0.RB.left, 80); eq(S0.WR.left, 80); eq(S0.TE.left, 37);
  for (const pos of ['QB','RB','WR','TE']) eq(S0.RB.goneFrac === 0, true, pos);
});

t('best available per position matches the sheet', () => {
  eq(S0.RB.best.name, 'Jahmyr Gibbs');
  eq(S0.WR.best.name, 'Puka Nacua');
  eq(S0.QB.best.name, 'Josh Allen');
  eq(S0.TE.best.name, 'Brock Bowers');
});

t('tier-1 counts are right', () => {
  eq(S0.QB.leftInTopTier, 1, 'QB T1:');   // Allen alone
  eq(S0.RB.leftInTopTier, 2, 'RB T1:');   // Gibbs, Bijan
  eq(S0.WR.leftInTopTier, 4, 'WR T1:');
  eq(S0.TE.leftInTopTier, 2, 'TE T1:');
});

t('cliff = worst remaining in the tier minus best in the next', () => {
  eq(S0.QB.cliff, 9,  'QB T1->T2 ($18 Allen -> $9 Jackson):');
  eq(S0.RB.cliff, 5,  'RB T1->T2 ($44 Bijan -> $39 McCaffrey):');
  eq(S0.WR.cliff, 9,  'WR T1->T2 ($37 -> $28):');
  eq(S0.TE.cliff, 6,  'TE T1->T2 ($22 McBride -> $16 Loveland):');
});

t('the lone tier-1 QB is flagged LAST with his drop attached', () => {
  const b = tierBadge(S0.QB.flags.get('QB:Josh Allen'), 'QB');
  ok(b, 'Allen should carry a badge');
  eq(b.kind, 'last');
  ok(/LAST T1/.test(b.text) && /−\$9/.test(b.text), `bad text: ${b.text}`);
});

t('a two-deep tier gets the softer "2 LEFT" badge, not LAST', () => {
  const b = tierBadge(S0.RB.flags.get('RB:Jahmyr Gibbs'), 'RB');
  ok(b); eq(b.kind, 'cliff'); eq(b.text, '2 LEFT T1');
});

t('a crowded tier gets no badge at all', () => {
  const wr1 = S0.WR.flags.get(S0.WR.best.id);       // 4 deep
  eq(tierBadge(wr1, 'WR'), null);
});

t('last-in-tier with a trivial drop is downgraded to "thin"', () => {
  const fake = [
    { id:'RB:A', pos:'RB', tier:1, value:10, ecr:1 },
    { id:'RB:B', pos:'RB', tier:2, value:9,  ecr:2 },
  ];
  const b = tierBadge(tierScarcity(fake).RB.flags.get('RB:A'), 'RB');
  eq(b.kind, 'thin');
  eq(b.text, 'LAST T1');
});

t('drafting the tier-1 RBs promotes tier 2 and re-flags the cliff', () => {
  const taken = new Set(['RB:Jahmyr Gibbs', 'RB:Bijan Robinson']);
  const S = tierScarcity(P, id => taken.has(id));
  eq(S.RB.left, 78);
  eq(S.RB.topTier, 2, 'top tier should now be 2:');
  eq(S.RB.leftInTopTier, 2, 'T2 is McCaffrey + Taylor:');
  eq(S.RB.best.name, 'Christian McCaffrey');
});

t('emptying a tier makes its last man LAST, with the real drop', () => {
  const taken = new Set(['RB:Jahmyr Gibbs']);       // Bijan alone in T1
  const S = tierScarcity(P, id => taken.has(id));
  const f = S.RB.flags.get('RB:Bijan Robinson');
  eq(f.isLast, true);
  eq(f.cliff, 5, 'Bijan $44 -> McCaffrey $39:');
  eq(tierBadge(f, 'RB').kind, 'last');
});

t('value-gone fraction tracks what has actually left the board', () => {
  const taken = new Set(['RB:Jahmyr Gibbs', 'RB:Bijan Robinson']);   // $48 + $44
  const S = tierScarcity(P, id => taken.has(id));
  eq(S.RB.totVal - S.RB.leftVal, 92, 'value removed:');
  ok(S.RB.goneFrac > 0 && S.RB.goneFrac < 1);
});

t('a fully drafted position degrades without throwing', () => {
  const S = tierScarcity(P, id => id.startsWith('TE:'));
  eq(S.TE.left, 0);
  eq(S.TE.best, null);
  eq(S.TE.goneFrac, 1);
  eq(tierBadge(null, 'TE'), null);
});

console.log('\nFound in a live mock draft, Sep 3');
t('a disappearance is only a sale if Yahoo\'s filled count went up', () => {
  eq(salesAllowed({ filled: 16, lastFilled: 16 }), 0, 'nothing filled, nothing sold:');
  eq(salesAllowed({ filled: 17, lastFilled: 16 }), 1);
  eq(salesAllowed({ filled: 19, lastFilled: 16 }), 3);
  eq(salesAllowed({ filled: 16, lastFilled: null }), 0, 'first tick has no baseline:');
  eq(salesAllowed({ filled: 15, lastFilled: 16 }), 0, 'filled going backwards is not negative sales:');
});

t('the Rodgers/Kupp phantom cannot be recorded', () => {
  // Two players vanished from the DOM after a re-sync while Yahoo's filled
  // count stayed at 16. Nothing was bought, so nothing may be recorded.
  const allowed = salesAllowed({ filled: 16, lastFilled: 16 });
  const vanished = ['QB:Aaron Rodgers', 'WR:Cooper Kupp'];
  const recorded = vanished.slice(0, allowed);
  eq(recorded.length, 0);
});

t('a real sale alongside phantoms records only the real one', () => {
  const allowed = salesAllowed({ filled: 17, lastFilled: 16 });
  eq(allowed, 1);
  eq(['WR:A.J. Brown', 'QB:Aaron Rodgers', 'WR:Cooper Kupp'].slice(0, allowed).length, 1);
});

t('the live filter reading uses Yahoo\'s real format (pos=TE, not pos_type=TE)', () => {
  // The live room reported "pos=TE"; the earlier probe saw "pos_type=All".
  // Both must work.
  for (const f of ['pos=TE', 'pos_type=TE', 'pos=RB'])
    eq(checkGuards({ posSeen: new Set(['QB','RB','WR','TE']), vanishedCount: 0, filled: 5,
                     totalPlayers: P.length, posFilter: f }).action, 'refuse', f);
  for (const f of ['pos=All', 'pos_type=All'])
    eq(checkGuards({ posSeen: new Set(['QB','RB','WR','TE']), vanishedCount: 0, filled: 5,
                     totalPlayers: P.length, posFilter: f }).action, 'ok', f);
});

console.log('\nBudget plan / stars-and-scrubs (ROADMAP 2)');
const STRAT = { starSlots: 3, starBudget: 140, starTier: 2, mustHave: [], marketBias: 1.84 };
const ROSTER = { budget: 200, filled: 0, slots: 15 };

t('viability: $140 across 3 stars cannot buy 3 stars at $60-75', () => {
  const plan = planState({ ...ROSTER, strategy: STRAT });
  const v = planViability({ plan, starPrices: [75, 68, 62, 58, 55] });
  eq(v.need, 3);
  eq(v.afford, 2, 'the pot really buys 2:');
  eq(v.ok, false);
  ok(v.shortfall > 0, 'should quantify the gap');
});
t('viability: a realistic plan reports ok', () => {
  const plan = planState({ budget: 200, filled: 0, slots: 15,
                           strategy: { ...STRAT, starSlots: 2, starBudget: 135 } });
  eq(planViability({ plan, starPrices: [75, 68, 62] }).ok, true);
});
t('viability degrades safely with no star candidates left', () => {
  const plan = planState({ ...ROSTER, strategy: STRAT });
  const v = planViability({ plan, starPrices: [] });
  ok(Number.isFinite(v.afford) && Number.isFinite(v.shortfall));
});

t('an untouched plan reserves the star money and starves the rest', () => {
  const pl = planState({ ...ROSTER, strategy: STRAT });
  eq(pl.starsLeft, 3);
  eq(pl.scrubSlotsLeft, 12);
  eq(pl.starPot, 140);
  eq(pl.perStar, 46);
  ok(Math.abs(pl.perScrub - 5) < 0.01, `perScrub ${pl.perScrub}`);
});

t('maxBid matches Yahoo: budget minus $1 per other empty slot', () => {
  eq(planState({ ...ROSTER, strategy: STRAT }).maxBid, 186);
  eq(planState({ budget: 58, filled: 9, slots: 15, strategy: STRAT }).maxBid, 53);
});

t('buying a star shrinks the pot and re-prices the ones left', () => {
  // paid $73 for Gibbs: 1 star down, $127 left, 14 slots
  const pl = planState({ budget: 127, filled: 1, slots: 15, strategy: STRAT, myStarsBought: 1 });
  eq(pl.starsLeft, 2);
  eq(pl.scrubSlotsLeft, 12);
  ok(pl.perStar > 0 && pl.perStar <= pl.maxBid, `perStar ${pl.perStar} vs maxBid ${pl.maxBid}`);
});

t('the star plan retires itself once the stars are bought — no toggle needed', () => {
  const pl = planState({ budget: 60, filled: 3, slots: 15, strategy: STRAT, myStarsBought: 3 });
  eq(pl.starsLeft, 0);
  eq(pl.starPot, 0, 'star pot should be gone:');
  eq(pl.planActive, false);
  eq(pl.scrubPot, 60, 'everything rolls into the scrub pool:');
});

t('a star target never exceeds what you can actually bid', () => {
  const pl = planState({ budget: 40, filled: 10, slots: 15, strategy: STRAT, myStarsBought: 0 });
  ok(pl.perStar <= pl.maxBid, `perStar ${pl.perStar} > maxBid ${pl.maxBid}`);
  ok(pl.starPot >= 0 && pl.scrubPot >= 0, 'pots must never go negative');
});

t('tier decides who the star money is for; mustHave overrides it', () => {
  const gibbs = P.find(p => p.id === 'RB:Jahmyr Gibbs');       // T1
  const mid   = P.find(p => p.tier === 4 && p.pos === 'RB');
  ok(isStarCandidate(gibbs, STRAT));
  ok(!isStarCandidate(mid, STRAT));
  ok(isStarCandidate(mid, { ...STRAT, mustHave: [mid.name] }), 'mustHave should promote him');
  eq(isStarCandidate(null, STRAT), false);
});

t('priceView separates what he is worth from what he will cost', () => {
  const gibbs = P.find(p => p.id === 'RB:Jahmyr Gibbs');       // book $48
  const plan  = planState({ ...ROSTER, strategy: STRAT });
  const v = priceView(gibbs, { inflation: 0.95, strategy: STRAT, plan });
  eq(v.book, 48);
  eq(v.valueTarget, 46, 'the old board would have said $46:');
  eq(v.lane, 'star');
  ok(v.marketEst > 80, `market estimate too low: ${v.marketEst}`);
  ok(v.planMax >= v.valueTarget, 'the plan must allow at least the value target');
});

t('BACKTEST: the old board could never have won Gibbs; the plan can', () => {
  // He actually sold for $73.
  const gibbs = P.find(p => p.id === 'RB:Jahmyr Gibbs');
  const plan  = planState({ ...ROSTER, strategy: STRAT });
  const v = priceView(gibbs, { inflation: 0.95, strategy: STRAT, plan });
  ok(v.valueTarget < 73, `old target ${v.valueTarget} should lose to $73`);
  ok(v.marketEst >= 73, `market estimate ${v.marketEst} should have warned us he costs ~$73`);
  ok(plan.maxBid >= 73, 'the plan must at least permit the winning bid');
});

t('a non-star cannot quietly eat the money the roster still needs', () => {
  const mid  = P.find(p => p.tier === 4 && p.pos === 'RB');
  const plan = planState({ budget: 20, filled: 10, slots: 15, strategy: STRAT });
  const v = priceView(mid, { inflation: 1.5, strategy: STRAT, plan });
  ok(v.planMax <= plan.maxBid, `planMax ${v.planMax} exceeds maxBid ${plan.maxBid}`);
  ok(v.planMax >= 1);
});

t('marketBias 1.0 reproduces the old board exactly', () => {
  const gibbs = P.find(p => p.id === 'RB:Jahmyr Gibbs');
  const v = priceView(gibbs, { inflation: 0.95, strategy: { ...STRAT, marketBias: 1 } });
  eq(v.marketEst, v.valueTarget);
});

t('starBudget 0 is flat value, the pre-existing behaviour', () => {
  const pl = planState({ ...ROSTER, strategy: { ...STRAT, starSlots: 0, starBudget: 0 } });
  eq(pl.planActive, false);
  eq(pl.starPot, 0);
  eq(pl.scrubPot, 200);
});

t('the consequence line is arithmetically right', () => {
  const a = afterSpending(73, { budget: 200, filled: 0, slots: 15 });
  eq(a.left, 127);
  eq(a.remaining, 14);
  ok(Math.abs(a.perSlot - 9.07) < 0.01, `perSlot ${a.perSlot}`);
  ok(a.affordable);
});

t('a bid that would leave the roster unfillable is flagged', () => {
  eq(afterSpending(58, { budget: 60, filled: 10, slots: 15 }).affordable, false);
  eq(afterSpending(55, { budget: 60, filled: 10, slots: 15 }).affordable, true);
});

t('a full roster degrades without dividing by zero', () => {
  const a = afterSpending(0, { budget: 5, filled: 15, slots: 15 });
  eq(a.perSlot, 0);
  const pl = planState({ budget: 5, filled: 15, slots: 15, strategy: STRAT });
  eq(pl.slotsLeft, 0);
  ok(Number.isFinite(pl.perScrub));
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
