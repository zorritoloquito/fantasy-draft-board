// Minimal static file server. Exists so the board can be served with nothing
// but Node — no Python, no npx, no packages. `data/live.json` is served with
// no-cache headers because the board polls it every 2 seconds.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = +(process.argv[2] ?? 8777);
const TYPES = { '.html':'text/html', '.json':'application/json', '.js':'text/javascript',
                '.css':'text/css', '.csv':'text/csv', '.ndjson':'application/x-ndjson' };

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/board.html';
  // keep requests inside the project directory
  const rel = normalize(p).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, {
      'content-type': TYPES[extname(rel)] ?? 'application/octet-stream',
      'cache-control': 'no-store, must-revalidate',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found: ' + rel);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Board → http://localhost:${PORT}/board.html   (Ctrl-C to stop)`);
});
