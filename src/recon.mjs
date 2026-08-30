// RECON: attach to the Yahoo draft tab over CDP and dump everything it receives,
// so we can find where the picks actually live. Node 24 has global WebSocket + fetch.
import { appendFileSync, mkdirSync } from 'node:fs';
mkdirSync('recon', { recursive: true });
const LOG = 'recon/dump.ndjson';
const log = (o) => appendFileSync(LOG, JSON.stringify(o) + '\n');

const tabs = await (await fetch('http://localhost:9222/json/list')).json();
const page = tabs.find(t => t.type === 'page' && /yahoo/i.test(t.url));
if (!page) { console.error('No Yahoo tab. Open the draft room first.\nTabs:', tabs.map(t=>t.url)); process.exit(1); }
console.log('attached →', page.title, '\n', page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
const pending = new Map();

ws.onopen = () => { send('Network.enable'); send('Page.enable'); console.log('listening… (Ctrl-C to stop)\n'); };

ws.onmessage = async (ev) => {
  const m = JSON.parse(ev.data);

  // websocket frames — most likely home of live picks
  if (m.method === 'Network.webSocketFrameReceived') {
    const d = m.params.response.payloadData || '';
    log({ t: 'ws', d: d.slice(0, 4000) });
    if (/pick|player|draft|select/i.test(d)) console.log('WS ▸', d.slice(0, 240));
  }
  if (m.method === 'Network.webSocketCreated') console.log('WS OPEN ▸', m.params.url);

  // XHR/fetch responses
  if (m.method === 'Network.responseReceived') {
    const { url, mimeType } = m.params.response;
    if (/json/i.test(mimeType) && !/analytics|beacon|csp|adserv|doubleclick|scorecard/i.test(url)) {
      pending.set(m.params.requestId, url);
    }
  }
  if (m.method === 'Network.loadingFinished' && pending.has(m.params.requestId)) {
    const url = pending.get(m.params.requestId); pending.delete(m.params.requestId);
    send('Network.getResponseBody', { requestId: m.params.requestId });
    responseUrls.set(id, url);
  }
  if (m.id && responseUrls.has(m.id) && m.result?.body) {
    const url = responseUrls.get(m.id); responseUrls.delete(m.id);
    log({ t: 'xhr', url, body: m.result.body.slice(0, 20000) });
    if (/pick|player|draft/i.test(m.result.body)) console.log('XHR ▸', url.slice(0, 130));
  }
};
const responseUrls = new Map();
ws.onerror = e => console.error('ws error', e.message);
