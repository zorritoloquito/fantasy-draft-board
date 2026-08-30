import { readFileSync, writeFileSync } from 'node:fs';

// --- minimal RFC4180 CSV parser (the sheet has quoted commas in the notes row) ---
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const POS = { QUARTERBACK: 'QB', 'RUNNING BACK': 'RB', 'WIDE RECEIVER': 'WR', 'TIGHT END': 'TE' };
// Each position block occupies 9 columns starting at these indices.
// Layout: TIER, NAME, TM/BYE, PTS, VALUE, PS, ECR, DRAFT, VOR(unlabeled)
const BASES = [1, 11, 21];

const num = (s) => { const n = parseFloat(String(s ?? '').replace(/[%$,]/g, '')); return Number.isFinite(n) ? n : null; };

const rows = parseCSV(readFileSync(process.argv[2], 'utf8'));
const players = [];

for (const base of BASES) {
  let pos = null;
  for (let r = 0; r < rows.length; r++) {
    const cell = (rows[r][base] ?? '').trim();
    if (POS[cell]) { pos = POS[cell]; continue; }   // section label
    if (cell === 'TIER') continue;                   // header row
    if (!pos) continue;
    const tier = num(cell);
    const name = (rows[r][base + 1] ?? '').trim();
    if (tier === null || !name) continue;

    const tmbye = (rows[r][base + 2] ?? '').trim();
    const [team, bye] = tmbye.split('/');
    players.push({
      id: `${pos}:${name}`,
      pos, tier, name,
      team: team ?? '', bye: num(bye),
      pts:   num(rows[r][base + 3]),
      value: num(rows[r][base + 4]),   // auction $
      ps:    num(rows[r][base + 5]),   // % chance gone before your next pick
      ecr:   num(rows[r][base + 6]),
      draft: (rows[r][base + 7] ?? '').trim().toLowerCase(), // '' | 'x' | 'o'
      vor:   num(rows[r][base + 8]),   // points above replacement
      row: r + 1, col: base,           // provenance back to the sheet
    });
  }
}

// Replacement baseline per position = PTS of the player whose VOR is 0.
const baselines = {};
for (const p of players) {
  if (p.vor === 0 && p.pts != null) baselines[p.pos] = Math.min(baselines[p.pos] ?? Infinity, p.pts);
}

const out = { generatedAt: new Date().toISOString(), baselines, players };
writeFileSync(process.argv[3], JSON.stringify(out, null, 2));

const byPos = {};
for (const p of players) byPos[p.pos] = (byPos[p.pos] ?? 0) + 1;
console.log('counts:', byPos, 'total:', players.length);
console.log('baselines:', baselines);
console.log('sample:', players.slice(0, 2), players.filter(p => p.pos === 'TE')[0]);
