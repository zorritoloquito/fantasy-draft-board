// Fake draft generator. Writes data/live.json exactly the way watch.mjs does,
// so the board can be exercised end-to-end without Yahoo, a browser profile, or
// a real draft. This is the pre-flight check: run it, watch the board, and
// confirm prices move, scarcity drains and the stale banner behaves.
//
//   node src/simulate.mjs            # a normal draft, one sale every ~1.2s
//   node src/simulate.mjs --fast     # same, but quick
//   node src/simulate.mjs --freeze   # stop writing mid-draft (tests P0-2)
//   node src/simulate.mjs --filter   # simulate a position filter (tests P0-1)
import { readFileSync, writeFileSync } from 'node:fs';
import { checkGuards, reconcileGone, inflationOf } from './model.mjs';

const url = p => new URL(p, import.meta.url);
const CFG = JSON.parse(readFileSync(url('../config.json')));
const SHEET = JSON.parse(readFileSync(url('../data/players.json')));
const P = SHEET.players;
const TOTVAL = P.reduce((a, p) => a + (p.value || 0), 0);

const arg  = f => process.argv.includes(f);
const FAST = arg('--fast'), FREEZE = arg('--freeze'), FILTER = arg('--filter');
const STEP = FAST ? 120 : 1200;

// Marked `source: 'simulator'` so a board that was watching a real draft wipes
// its state rather than quietly folding fake picks into your roster.
const SESSION = { id: `sim-${Date.now().toString(36)}`, startedAt: Date.now(),
                  league: CFG.league + ' (SIMULATED)', source: 'simulator' };

const NAMES = ['You', '4th and Drunk', 'BANG BUS', '⚡️El Borracho ⚡️', 'Fighting Artichokes',
               'TEA👊🏽BAGGERS', 'Kupp My Balz', 'The Jesus', 'Thunder Punch', 'Nah...Nah...Nah!']
  .slice(0, CFG.teams);
const teams = NAMES.map(name => ({ name, budget: CFG.budget, filled: 0, slots: CFG.rosterSlots }));

// Market order: roughly ECR, which is how the room actually drafts. The room
// overpays early (that's the whole thesis), so prices start above book.
const order = [...P].sort((a, b) => (a.ecr ?? 999) - (b.ecr ?? 999));

const soldOrder = [], boughtBy = {}, priceOf = {};
let i = 0;

console.log(`simulating ${CFG.teams}-team $${CFG.budget} auction · ${order.length} players`);
if (FREEZE) console.log('  --freeze: will stop writing after 20 picks (expect the STALE banner)');
if (FILTER) console.log('  --filter: will simulate a position filter at pick 15 (expect the guard)');

const timer = setInterval(() => {
  if (i >= order.length || teams.every(t => t.filled >= t.slots)) {
    console.log('draft complete'); clearInterval(timer); return;
  }

  if (FREEZE && i === 20) {
    console.log('… frozen. The board should go loud within ' + (CFG.staleAfterMs / 1000) + 's. Ctrl-C when satisfied.');
    clearInterval(timer); return;
  }

  const p = order[i++];
  const buyers = teams.filter(t => t.filled < t.slots && t.budget > (t.slots - t.filled));
  if (!buyers.length) { console.log('everyone is full'); clearInterval(timer); return; }
  const buyer = buyers[Math.floor(Math.random() * buyers.length)];

  // early money is dumb money: pay well over book at the top, under it later
  const heat  = Math.max(0, 1 - i / 60);
  const price = Math.max(1, Math.min(
    buyer.budget - (buyer.slots - buyer.filled - 1),
    Math.round((p.value || 1) * (0.75 + heat * 1.1) * (0.85 + Math.random() * 0.3))));

  buyer.budget -= price; buyer.filled++;
  soldOrder.push(p.id); boughtBy[p.id] = buyer.name; priceOf[p.id] = price;

  const availIds = new Set(P.filter(x => !soldOrder.includes(x.id)).map(x => x.id));
  const filled = teams.reduce((a, t) => a + t.filled, 0);
  const spent  = teams.reduce((a, t) => a + (CFG.budget - t.budget), 0);

  // At pick 15 with --filter, pretend the DOM only renders TEs. The guard must
  // refuse the tick rather than concluding the room bought everyone.
  if (FILTER && i === 15) {
    const posSeen = new Set(['TE']);
    const guard = checkGuards({ posSeen, vanishedCount: 98, filled,
                                totalPlayers: P.length, maxSalesPerTick: CFG.maxSalesPerTick });
    console.log(`  ⚠ filter tick → ${guard.action.toUpperCase()}: ${guard.reason}`);
    writeFileSync(url('../data/live.json'), JSON.stringify({
      ts: Date.now(), session: SESSION, connected: true, stale: true,
      reason: guard.reason, teams, filled, spent }, null, 1));
    return;
  }

  const { goneList, phantoms } = reconcileGone({ soldOrder, availIds, filled, players: P, boughtBy });
  const goneValue = goneList.reduce((a, x) => a + (x.value || 0), 0);
  const { moneyLeft, valueLeft, inflation } = inflationOf({
    teams: CFG.teams, budget: CFG.budget, spent, totalValue: TOTVAL, goneValue });

  const next = order[i];
  const me = teams[0];
  const slotsLeft = me.slots - me.filled;

  writeFileSync(url('../data/live.json'), JSON.stringify({
    ts: Date.now(), session: SESSION, connected: true, stale: false, reason: null,
    league: CFG.league + ' (SIMULATED)', teams_n: CFG.teams, budget: CFG.budget,
    me: { budget: me.budget, filled: me.filled, slots: me.slots,
          maxBid: me.budget - (slotsLeft - 1) },
    spent, filled, moneyLeft, valueLeft, inflation, teams,
    block: next ? { proj: next.value, bid: Math.max(1, Math.round((next.value || 1) * inflation * 0.8)),
                    leader: NAMES[1], nextOffer: Math.max(2, Math.round((next.value || 1) * inflation * 0.9)),
                    myMax: me.budget - (slotsLeft - 1), myBudget: me.budget } : null,
    last: { name: p.name, pos: p.pos, team: p.team, by: buyer.name, price },
    nominated: next ? { ...next, target: Math.round((next.value || 0) * inflation) } : null,
    soldIds: goneList.map(x => x.id),
    mineIds: Object.keys(boughtBy).filter(id => boughtBy[id] === 'You'),
    boughtBy, priceOf, goneCount: goneList.length, phantoms,
  }, null, 1));

  console.log(`${String(i).padStart(3)}  ${p.pos} ${p.name.padEnd(22)} $${String(price).padStart(3)} (book $${p.value})  → ${buyer.name}    infl ${inflation.toFixed(2)}`);
}, STEP);
