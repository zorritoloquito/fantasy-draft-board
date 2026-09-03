// Polls the Yahoo draft tab over CDP, matches Yahoo's abbreviated names to the
// sheet's players, and writes data/live.json for the board to consume.
//
// Design note — the root cause of every P0 in KNOWN-ISSUES is that this file
// cannot tell "sold" from "not currently rendered". It still can't. What it can
// do is refuse to believe implausible readings, and say so out loud instead of
// silently writing confident nonsense. Three guards do that work:
//   1. a per-tick sales cap  (an auction sells one player at a time)
//   2. a sanity check on the shape of the available list
//   3. `filled` from Yahoo as the hard ceiling on how many players can be gone
// When a guard trips we still write live.json, marked `stale` with a reason, so
// the board can shout. Writing nothing is what made P0-2 invisible.
import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from 'node:fs';
import { checkGuards, reconcileGone, inflationOf } from './model.mjs';

const url = p => new URL(p, import.meta.url);
const CFG = JSON.parse(readFileSync(url('../config.json')));
const EXPR = readFileSync(url('./extract.js'), 'utf8');
const SHEET = JSON.parse(readFileSync(url('../data/players.json')));

const BUDGET = CFG.budget, TEAMS = CFG.teams;
const MAX_SALES_PER_TICK = CFG.maxSalesPerTick ?? 3;
const MY_TEAM = CFG.myTeamName || '';
const TOTVAL = SHEET.players.reduce((a, p) => a + (p.value || 0), 0);
const PICKLOG = url(`../data/picks-${new Date().toISOString().slice(0, 10)}.ndjson`);

console.log(`league: ${CFG.league} · ${TEAMS} teams × $${BUDGET} = $${TEAMS * BUDGET} pool · ${CFG.rosterSlots} spots`);
if (TEAMS === 10 && BUDGET === 200) console.log('  (defaults — confirm these match the actual draft room)');

/* ---------- single-instance guard (KNOWN-ISSUES P1-2) ----------
   Two watchers both writing live.json on their own timers means the stale one
   can win, and the symptom looks like "the fix didn't work". */
const PIDFILE = url('../.watch.pid');
if (existsSync(PIDFILE)) {
  const old = +readFileSync(PIDFILE, 'utf8');
  let alive = false;
  try { process.kill(old, 0); alive = true; } catch {}
  if (alive) {
    console.error(`\n✗ another watcher is already running (pid ${old}).`);
    console.error(`  Two instances fight over data/live.json and the stale one can win.`);
    console.error(`  Kill it first:  kill ${old}\n`);
    process.exit(1);
  }
  console.log(`(clearing stale pidfile from dead pid ${old})`);
}
writeFileSync(PIDFILE, String(process.pid));
const cleanup = () => { try { unlinkSync(PIDFILE); } catch {} };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(0); });

/* ---------- name matching ---------- */
const norm = s => s.replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
function matchPlayer(y) {                     // y = {name:"A. St. Brown", pos, team}
  const m = norm(y.name).match(/^([A-Z])\.?\s*(.+)$/);
  if (!m) return null;
  const [, init, rest] = m;
  const cand = SHEET.players.filter(p =>
    p.pos === y.pos && norm(p.name).toLowerCase().endsWith(rest.toLowerCase()) &&
    norm(p.name)[0].toUpperCase() === init);
  if (cand.length === 1) return cand[0];
  const byTeam = cand.filter(p => p.team === y.team);
  return byTeam.length === 1 ? byTeam[0] : (cand[0] ?? null);
}
// Yahoo calls you "You" in the live banner but uses your real team name on the
// results page, and the two are scraped from different places. Match both, and
// forgive case/spacing/truncation — a config typo shouldn't cost you your roster
// panel mid-draft (KNOWN-ISSUES P2-1, P3-1).
const slug = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const MY_SLUG = slug(MY_TEAM);
const isMine = name => {
  if (name === 'You') return true;
  if (!MY_SLUG) return false;
  const n = slug(name);
  if (!n) return false;
  // Yahoo truncates long names with an ellipsis, so accept a prefix match too.
  return n === MY_SLUG || (n.length >= 6 && (MY_SLUG.startsWith(n) || n.startsWith(MY_SLUG)));
};

/* ---------- CDP ---------- */
let ws, msgId = 0;
const waiters = new Map();
async function connect() {
  let tabs;
  try { tabs = await (await fetch('http://localhost:9222/json/list')).json(); }
  catch { throw new Error('NO_CDP'); }
  // P2-2: prefer a tab that actually parses over merely the first match.
  const cands = tabs.filter(t => t.type === 'page' && /draftclient/.test(t.url));
  if (!cands.length) throw new Error('draft room not open');
  if (cands.length > 1) console.log(`(${cands.length} draft tabs open — probing for a live one)`);
  for (const page of cands) {
    try {
      const sock = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej;
        setTimeout(() => rej(new Error('ws timeout')), 4000); });
      ws = sock;
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
      };
      const probe = await evaluate();
      if (probe?.avail?.length) return;         // this tab is rendering the list
      console.log(`  tab ${page.id?.slice(0, 6)} parsed nothing, trying next`);
      ws.close();
    } catch (e) { console.log(`  tab probe failed: ${e.message}`); }
  }
  if (!ws) throw new Error('no draft tab responded');
  console.log('⚠ no tab is rendering the player list — is the room on the Players tab?');
}
const evaluate = () => new Promise((res, rej) => {
  const id = ++msgId;
  waiters.set(id, m => {
    if (m.result?.exceptionDetails)
      return rej(new Error('page threw: ' + JSON.stringify(m.result.exceptionDetails).slice(0, 200)));
    res(m.result?.result?.value);
  });
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate',
    params: { expression: EXPR, returnByValue: true, awaitPromise: true } }));
  setTimeout(() => { if (waiters.delete(id)) rej(new Error('evaluate timed out')); }, 5000);
});

// Startup failures are the ones that happen 15 minutes before a draft, with
// everybody waiting. Say what is wrong and what to do about it — no stack trace.
try {
  await connect();
} catch (e) {
  const help = {
    NO_CDP: ['the debug browser is not running (nothing on port 9222)',
             'Run ./start-browser.sh, log into Yahoo, and open the draft room.'],
    'draft room not open': ['the browser is up but no draft-room tab is open',
             'In THAT browser window: open your league → enter the draft room,\n  and leave it on the Players tab with NO position filter.'],
  }[e.message] ?? [e.message, 'Check ./start-browser.sh is running and the draft room is open.'];
  console.error(`\n✗ Cannot start: ${help[0]}\n\n  ${help[1]}\n`);
  process.exit(1);
}
console.log('watching draft room…  writing data/live.json');

/* ---------- state ---------- */
let lastAvail = null, soldOrder = [];
const boughtBy = {};          // playerId -> team name that won him
const priceOf  = {};          // playerId -> $ paid, when we caught the banner
try {
  const seed = JSON.parse(readFileSync(url('../data/seed.json')));
  soldOrder.push(...seed.soldIds);
  Object.assign(boughtBy, seed.boughtBy);
  Object.assign(priceOf, seed.priceOf ?? {});
  console.log(`seeded ${seed.soldIds.length} picks from data/seed.json`);
} catch {}

/* ---------- write ---------- */
let lastErr = null, lastGuard = null, tick = 0;
function writeState(o) {
  writeFileSync(url('../data/live.json'), JSON.stringify({ ts: Date.now(), ...o }, null, 1));
}
function logPick(id, buyer, price) {
  try {
    appendFileSync(PICKLOG, JSON.stringify({
      t: new Date().toISOString(), id, buyer: buyer ?? null, price: price ?? null }) + '\n');
  } catch {}
}

setInterval(async () => {
  tick++;
  let s;
  try { s = await evaluate(); }
  catch (e) {
    // P3-3: never swallow. A silent no-op here is what cost 4 minutes mid-draft.
    if (e.message !== lastErr) { console.error(`✗ ${e.message}`); lastErr = e.message; }
    return writeState({ connected: false, stale: true, reason: e.message });
  }
  lastErr = null;

  // P0-2: an empty parse means the room is on Team/Queue/Chat, not that the
  // draft ended. Write the fact instead of returning silently.
  if (!s || !s.avail?.length) {
    return writeState({ connected: true, stale: true,
      reason: 'no player list in the DOM — is the draft room on the Players tab?' });
  }

  const availIds = new Set();
  for (const y of s.avail) { const p = matchPlayer(y); if (p) availIds.add(p.id); }

  const filled = s.teams.reduce((a, t) => a + t.filled, 0);
  const spent  = s.teams.reduce((a, t) => a + (BUDGET - t.budget), 0);

  /* ---- guards (KNOWN-ISSUES P0-1) ----
     A position filter drops every other position from the DOM at once. Both
     tells are cheap to check and neither needs to know Yahoo's markup. */
  const posSeen = new Set(s.avail.map(y => y.pos));
  const vanished = lastAvail ? [...lastAvail].filter(id => !availIds.has(id)) : [];

  const guard = checkGuards({
    posSeen, vanishedCount: vanished.length, filled,
    totalPlayers: SHEET.players.length, maxSalesPerTick: MAX_SALES_PER_TICK,
  });

  if (guard.action === 'refuse') {
    // Do NOT diff and do NOT advance lastAvail — a poisoned baseline is what
    // turned P0-1 from a glitch into unrecoverable state. The next healthy
    // tick recovers on its own.
    if (guard.reason !== lastGuard) console.error(`⚠ ${guard.reason}`);
    lastGuard = guard.reason;
    return writeState({ connected: true, stale: true, reason: guard.reason,
      teams: s.teams, filled, spent });
  }
  lastGuard = null;

  if (guard.action === 'resync') {
    // Healthy-looking view, implausible delta: adopt the new baseline but do
    // not credit any of it as sales. reconcileGone caps everything at Yahoo's
    // `filled`, so the sold list stays honest and the next tick is normal.
    console.error(`⚠ ${guard.reason}`);
    lastAvail = availIds;
    return writeState({ connected: true, stale: true, reason: guard.reason,
      teams: s.teams, filled, spent });
  }

  /* ---- record sales ---- */
  for (const id of vanished) if (!soldOrder.includes(id)) {
    soldOrder.push(id);
    const won = s.last && matchPlayer(s.last);
    const buyer = (won && won.id === id && s.last.by) ? s.last.by : null;
    const price = (won && won.id === id && s.last.price != null) ? s.last.price : null;
    if (buyer) boughtBy[id] = buyer;
    if (price != null) priceOf[id] = price;
    logPick(id, buyer, price);                       // P1-3: durable pick record
    console.log(`SOLD ▸ ${id.split(':')[1].padEnd(24)}${price != null ? ('$' + price).padStart(5) : '     '} ${buyer ? '→ ' + buyer : ''}${buyer && isMine(buyer) ? '   ⭐ YOURS' : ''}`);
  }
  lastAvail = availIds;

  if (s.last && isMine(s.last.by)) {
    const won = matchPlayer(s.last);
    if (won && !availIds.has(won.id)) {
      boughtBy[won.id] = s.last.by;
      if (s.last.price != null) priceOf[won.id] = s.last.price;
    }
  }

  const me = s.teams.find(t => isMine(t.name));

  /* ---- who is gone ----
     Yahoo renders only the top ~100 available and sorts by ITS OWN proj$, so
     "absent from our 237-row sheet" can't be read directly. Self-calibrate
     against Yahoo's authoritative `filled` count: walk our players best-first
     and take the absent ones until we've accounted for exactly `filled` sales.

     P1-1: `filled` is also the CEILING. Previously anything ever observed
     vanishing was re-added unconditionally, so one bad tick poisoned every
     later tick (soldIds hit 128 against filled 30). Now the observed list is
     merged in but the total is capped, and provable phantoms are dropped. */
  const { goneList, phantoms } = reconcileGone({
    soldOrder, availIds, filled, players: SHEET.players, boughtBy });
  if (phantoms && tick % 15 === 1)
    console.error(`⚠ dropped ${phantoms} phantom sales (Yahoo says ${filled} filled)`);

  const goneVal = goneList.reduce((a, p) => a + (p.value || 0), 0);
  const { moneyLeft, valueLeft, inflation } = inflationOf({
    teams: TEAMS, budget: BUDGET, spent, totalValue: TOTVAL, goneValue: goneVal });

  const nominated = s.nominated ? matchPlayer(s.nominated) : null;
  const slotsLeft = me ? me.slots - me.filled : CFG.rosterSlots;

  writeState({
    connected: true, stale: false, reason: null,
    league: CFG.league, teams_n: TEAMS, budget: BUDGET,
    me: me ? { budget: me.budget, filled: me.filled, slots: me.slots,
               maxBid: me.budget - (slotsLeft - 1) } : null,
    spent, filled, moneyLeft, valueLeft, inflation,
    teams: s.teams, block: s.block, last: s.last,
    nominated: nominated ? { ...nominated, target: Math.round(nominated.value * inflation) } : null,
    soldIds: goneList.map(p => p.id),
    mineIds: Object.keys(boughtBy).filter(id => isMine(boughtBy[id])),
    boughtBy, priceOf,
    goneCount: goneList.length, phantoms,
  });
}, 2000);
