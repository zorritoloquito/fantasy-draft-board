import { readFileSync, writeFileSync } from 'node:fs';

// Inlines the sheet, the league config, and the shared decision model into a
// single self-contained board.html. The model is shared with the watcher and
// with src/test-model.mjs so the board and the tests can never drift apart —
// the `export` keywords are simply stripped, since the board has no bundler.
const [,, tpl, data, cfg, model, out] = process.argv;

const modelSrc = readFileSync(model, 'utf8').replace(/^export\s+function/gm, 'function');

const html = readFileSync(tpl, 'utf8')
  .replace('/*__DATA__*/',  readFileSync(data, 'utf8'))
  .replace('/*__CFG__*/',   readFileSync(cfg, 'utf8'))
  .replace('/*__MODEL__*/', modelSrc);

writeFileSync(out, html);
const c = JSON.parse(readFileSync(cfg, 'utf8'));
console.log('built', out, (html.length / 1024).toFixed(0) + 'kb',
            `· ${c.league}: ${c.teams}×$${c.budget}, ${c.rosterSlots} spots`);
