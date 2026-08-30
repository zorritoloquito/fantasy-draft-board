// Polls the Yahoo draft tab over CDP, matches Yahoo's abbreviated names to the
// sheet's players, and writes data/live.json for the board to consume.
import { readFileSync, writeFileSync } from 'node:fs';

const EXPR = readFileSync(new URL('./extract.js', import.meta.url), 'utf8');
const SHEET = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url)));
const BUDGET = 200, TEAMS = 10;
const TOTVAL = SHEET.players.reduce((a, p) => a + (p.value || 0), 0);

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

let ws, msgId = 0;
const waiters = new Map();
async function connect() {
  const tabs = await (await fetch('http://localhost:9222/json/list')).json();
  const page = tabs.find(t => t.type === 'page' && /draftclient/.test(t.url));
  if (!page) throw new Error('draft room not open');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
}
const evaluate = () => new Promise(res => {
  const id = ++msgId; waiters.set(id, m => res(m.result?.result?.value));
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate',
    params: { expression: EXPR, returnByValue: true, awaitPromise: true } }));
});

await connect();
console.log('watching draft room…  writing data/live.json');

let lastAvail = null, soldOrder = [];
setInterval(async () => {
  let s; try { s = await evaluate(); } catch { return; }
  if (!s || !s.avail?.length) return;

  const availIds = new Set();
  for (const y of s.avail) { const p = matchPlayer(y); if (p) availIds.add(p.id); }

  // anyone who was on the board last tick and isn't now = sold
  if (lastAvail) for (const id of lastAvail) if (!availIds.has(id)) {
    if (!soldOrder.includes(id)) { soldOrder.push(id); console.log('SOLD ▸', id); }
  }
  lastAvail = availIds;

  const me = s.teams.find(t => t.name === 'You');
  const spent = s.teams.reduce((a, t) => a + (BUDGET - t.budget), 0);
  const filled = s.teams.reduce((a, t) => a + t.filled, 0);

  // Yahoo renders only the top ~100 available and sorts by ITS OWN proj$, so
  // "absent from the list" cannot be read directly against our 237-row sheet.
  // Instead self-calibrate against Yahoo's authoritative sold count: walk our
  // players best-first and take the absent ones until we've accounted for
  // exactly `filled` sales. Disappearance-tracking keeps it honest after that.
  const ranked = [...SHEET.players].sort((a, b) => (b.value || 0) - (a.value || 0));
  const goneList = [];
  for (const p of ranked) {
    if (goneList.length >= filled) break;
    if (!availIds.has(p.id)) goneList.push(p);
  }
  for (const id of soldOrder) {                      // anything we watched vanish
    const p = SHEET.players.find(x => x.id === id);
    if (p && !goneList.includes(p)) goneList.push(p);
  }
  const goneVal = goneList.reduce((a, p) => a + (p.value || 0), 0);

  const moneyLeft = TEAMS * BUDGET - spent;
  const valueLeft = Math.max(TOTVAL - goneVal, 1);
  const inflation = moneyLeft / valueLeft;

  const nominated = s.nominated ? matchPlayer(s.nominated) : null;
  const slotsLeft = me ? me.slots - me.filled : 15;

  writeFileSync(new URL('../data/live.json', import.meta.url), JSON.stringify({
    ts: s.ts, connected: true,
    me: me ? { budget: me.budget, filled: me.filled, slots: me.slots,
               maxBid: me.budget - (slotsLeft - 1) } : null,
    spent, filled, moneyLeft, valueLeft, inflation,
    teams: s.teams, block: s.block, last: s.last,
    nominated: nominated ? { ...nominated, target: Math.round(nominated.value * inflation) } : null,
    soldIds: goneList.map(p => p.id),
    goneCount: goneList.length,
  }, null, 1));
}, 2000);
