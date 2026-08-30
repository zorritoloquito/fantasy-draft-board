import { readFileSync, writeFileSync } from 'node:fs';
const [,, tpl, data, out] = process.argv;
const html = readFileSync(tpl, 'utf8').replace('/*__DATA__*/', readFileSync(data, 'utf8'));
writeFileSync(out, html);
console.log('built', out, (html.length / 1024).toFixed(0) + 'kb');
