// Round-trip every sheet player through Yahoo's abbreviation format and make
// sure the matcher gets the same player back. Catches initial+surname collisions.
import { readFileSync } from 'node:fs';
const SHEET = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url)));
const norm = s => s.replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
function matchPlayer(y) {
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
const yahooize = full => { const parts = norm(full).split(' '); return parts[0][0] + '. ' + parts.slice(1).join(' '); };

let ok = 0; const fails = [], ambiguous = [];
for (const p of SHEET.players) {
  const y = { name: yahooize(p.name), pos: p.pos, team: p.team };
  const got = matchPlayer(y);
  if (!got) fails.push({ y: y.name, want: p.name, got: 'NO MATCH' });
  else if (got.id !== p.id) fails.push({ y: y.name, want: p.name, got: got.name });
  else {
    ok++;
    const noTeam = SHEET.players.filter(q => q.pos === p.pos &&
      norm(q.name).toLowerCase().endsWith(norm(p.name).split(' ').slice(1).join(' ').toLowerCase()) &&
      norm(q.name)[0] === norm(p.name)[0]);
    if (noTeam.length > 1) ambiguous.push(`${y.name} (${p.pos}) → ${noTeam.map(q=>q.name+'/'+q.team).join(' vs ')}`);
  }
}
console.log(`matched ${ok}/${SHEET.players.length}`);
if (fails.length) { console.log('\nFAILURES:'); fails.forEach(f => console.log(' ', f.y, '→ got', f.got, '| want', f.want)); }
if (ambiguous.length) { console.log('\nresolved only by team (fragile if Yahoo disagrees on team):'); ambiguous.forEach(a => console.log('  ', a)); }
if (!fails.length) console.log('\n✅ no collisions');
