// Reads a recorded draft (data/drafts/<x>/picks.csv) and measures the market
// against the sheet. This is the calibration input for stars-and-scrubs: how
// much MORE than book the room actually paid, broken out by tier.
import { readFileSync } from 'node:fs';

const SHEET = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url)));
const dir = process.argv[2] ?? 'data/drafts/2026-08-30-ozark';
const rows = readFileSync(new URL(`../${dir}/picks.csv`, import.meta.url), 'utf8')
  .trim().split('\n').slice(1)
  .map(l => {
    // team names contain commas ("Nah...Nah...Nah!" does not, but be safe)
    const m = l.match(/^(\d+),(.+),([A-Za-z]+),(QB|RB|WR|TE|K|DEF),(\d+),(.+)$/);
    if (!m) { console.error('unparsed:', l); return null; }
    return { pick:+m[1], name:m[2], nfl:m[3], pos:m[4], price:+m[5], team:m[6] };
  }).filter(Boolean);

const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
const byName = new Map(SHEET.players.map(p => [norm(p.name) + p.pos, p]));
for (const r of rows) r.sheet = byName.get(norm(r.name) + r.pos) ?? null;

const matched   = rows.filter(r => r.sheet);
const unmatched = rows.filter(r => !r.sheet);
const TOTVAL = SHEET.players.reduce((a, p) => a + (p.value || 0), 0);

console.log(`\n${rows.length} picks · $${rows.reduce((a,r)=>a+r.price,0)} spent`);
console.log(`${matched.length} matched to the sheet · ${unmatched.length} not in it (${[...new Set(unmatched.map(r=>r.pos))].join(', ')})\n`);

/* ---------- inflation, as it actually moved ---------- */
console.log('INFLATION — money left ÷ sheet value left, recomputed after every pick');
let spent = 0, goneVal = 0;
const marks = [];
for (const r of rows) {
  const before = (2000 - spent) / Math.max(TOTVAL - goneVal, 1);
  spent += r.price; goneVal += r.sheet?.value ?? 0;
  marks.push({ pick: r.pick, infl: before });
}
for (const p of [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]) {
  const m = marks.find(x => x.pick === p); if (!m) continue;
  const bar = '█'.repeat(Math.round(m.infl * 30));
  console.log(`  pick ${String(p).padStart(3)}  ${m.infl.toFixed(2)}  ${bar}`);
}

/* ---------- the number that matters for stars-and-scrubs ---------- */
console.log('\nMARKET PRICE vs SHEET VALUE, BY TIER');
console.log('  tier   n   sheet$   paid$   ratio   what the room actually did');
const buckets = {};
for (const r of matched) {
  const k = r.sheet.tier <= 4 ? r.sheet.tier : '5+';
  (buckets[k] ??= []).push(r);
}
const mult = {};
for (const k of [1, 2, 3, 4, '5+']) {
  const g = buckets[k]; if (!g) continue;
  const sv = g.reduce((a, r) => a + (r.sheet.value || 0), 0);
  const pd = g.reduce((a, r) => a + r.price, 0);
  const ratio = pd / Math.max(sv, 1);
  mult[k] = ratio;
  const note = ratio > 1.5 ? 'paid a huge premium' : ratio > 1.15 ? 'paid up' :
               ratio > 0.9 ? 'about book' : 'bargain bin';
  console.log(`   ${String(k).padStart(3)}  ${String(g.length).padStart(3)}  ${('$'+sv).padStart(6)}  ${('$'+pd).padStart(6)}   ${ratio.toFixed(2)}×   ${note}`);
}

console.log('\nTOP 20 BY PRICE — where the money went');
for (const r of [...rows].sort((a,b)=>b.price-a.price).slice(0, 20)) {
  const v = r.sheet?.value, t = r.sheet?.tier;
  const over = v != null ? r.price - v : null;
  console.log(`  $${String(r.price).padStart(3)}  ${r.pos} ${r.name.padEnd(21)} ${v!=null?('book $'+String(v).padEnd(3)+' T'+t):'(not in sheet)'}${over!=null?`  ${over>=0?'+':''}${over}`:''}   ${r.team}`);
}

/* ---------- per-team ---------- */
console.log('\nBY TEAM — paid vs sheet value acquired');
const teams = {};
for (const r of rows) {
  const t = (teams[r.team] ??= { n:0, paid:0, val:0 });
  t.n++; t.paid += r.price; t.val += r.sheet?.value ?? 0;
}
const rank = Object.entries(teams).sort((a,b)=>(b[1].paid-b[1].val)-(a[1].paid-a[1].val));
for (const [name, t] of rank) {
  const d = t.paid - t.val;
  console.log(`  ${name.padEnd(22)} ${String(t.n).padStart(2)} picks  $${String(t.paid).padStart(3)} paid  $${String(t.val).padStart(3)} value  ${d>=0?'+':''}${d}`);
}

console.log('\nSUGGESTED TIER MULTIPLIERS for stars-and-scrubs (config.json):');
console.log('  ' + JSON.stringify(Object.fromEntries(
  Object.entries(mult).map(([k, v]) => [k, +v.toFixed(2)]))));
console.log('  ^ what the room paid per $1 of sheet value, by tier. A stars-and-scrubs');
console.log('    budget has to clear these to win a tier-1 player at all.\n');
