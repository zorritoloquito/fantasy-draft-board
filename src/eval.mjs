const tabs = await (await fetch('http://localhost:9222/json/list')).json();
const page = tabs.find(t => t.type==='page' && /draftclient/.test(t.url)) || tabs.find(t=>/yahoo/i.test(t.url));
if (!page) { console.error('no draft tab'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
const expr = process.argv[2];
ws.onopen = () => ws.send(JSON.stringify({id:1, method:'Runtime.evaluate',
  params:{expression:expr, returnByValue:true, awaitPromise:true}}));
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id === 1) {
    if (m.result?.exceptionDetails) console.error('ERR', JSON.stringify(m.result.exceptionDetails).slice(0,500));
    else console.log(typeof m.result.result.value === 'string' ? m.result.result.value : JSON.stringify(m.result.result.value, null, 1));
    process.exit(0);
  }
};
setTimeout(()=>{console.error('timeout');process.exit(1)}, 8000);
