(() => {
  const t = document.body.innerText;
  const out = { ts: Date.now() };

  // teams: "Team 9\t$131\t1/15"  and  "You\t$200\t0/15"
  out.teams = [...t.matchAll(/\n\s*([^\n$]{1,28}?)\s*\n?\s*\$(\d+)\s+(\d+)\/(\d+)/g)]
    .map(m => ({ name: m[1], budget: +m[2], filled: +m[3], slots: +m[4] }));

  // available players still on the board
  out.avail = [...t.matchAll(/\n([A-Z][A-Za-z.'’\- ]{1,28}?)\n(?:Q\n)?(QB|RB|WR|TE|K|DEF)\n([A-Za-z]{2,3})\nBye (\d+)\n\t([\d.]+)\t([\d.]+)/g)]
    .map(m => ({ name: m[1].trim(), pos: m[2], team: m[3].toUpperCase(), bye: +m[4],
                 proj: +m[5], avg: +m[6] }));

  // current nomination + live bid
  const nom = t.match(/Last:\s*\n([^\n]+)\n\(([A-Z]+)\s*·\s*([A-Za-z]+)\)\n([^\n]+)/);
  if (nom) out.last = { name: nom[1].trim(), pos: nom[2], team: nom[3].toUpperCase(), by: nom[4].trim() };
  const bid = t.match(/Proj \$(\d+)\s*\n\$(\d+)\s*\n([^\n]+)\nOffer \$(\d+)\s*\nMax Offer \$(\d+)\s*\nBudget \$(\d+)/);
  if (bid) out.block = { proj:+bid[1], bid:+bid[2], leader:bid[3].trim(),
                         nextOffer:+bid[4], myMax:+bid[5], myBudget:+bid[6] };
  const onBlock = t.match(/Budget\s*\n?\$?\d*\s*\n?([A-Z]\.\s?[A-Za-z.'\-]+)\n(?:Q\n)?(QB|RB|WR|TE)\n/);
  const nomName = t.match(/\n([A-Z]\.\s?[A-Za-z.'’\- ]+)\n(?:Q\n)?(QB|RB|WR|TE)\n([A-Za-z]{2,3})\nBye \d+\nProj \$/);
  if (nomName) out.nominated = { name: nomName[1].trim(), pos: nomName[2], team: nomName[3].toUpperCase() };
  const nomLeft = t.match(/(\d+) nominations? until your turn/);
  if (nomLeft) out.nomsUntilMe = +nomLeft[1];

  // --- everything below is ADDITIVE and best-effort. It must never throw and
  // must never change the fields above; the watcher works without any of it. ---

  // NOTE ON SALE PRICES (KNOWN-ISSUES P1-3): Yahoo does NOT put the price in
  // the "Last:" banner. Verified against a live draft room on Sep 3 — the
  // banner is only:
  //     Last:\nK. MONANGAI\n(RB · CHI)\nTeam 9
  // and the very next lines belong to the NEXT nomination (Proj $52, $56,
  // Offer $57, Max Offer $186 ...). An earlier version grabbed the first $N
  // after "Last:" and consequently recorded CeeDee Lamb as selling for $186.
  //
  // The price is instead derived in watch.mjs from the winning team's budget
  // dropping. That is exact, and it cross-checks the buyer for free.

  // Best-effort read of the position filter. The watcher does NOT depend on
  // this — it independently refuses to diff when the list holds fewer than 3
  // positions or when too many players vanish at once. This is a nicer error
  // message when it happens to work.
  try {
    const sel = document.querySelector('select[name*="pos" i], select[id*="pos" i]');
    if (sel) out.posFilter = sel.value;
    else {
      const on = [...document.querySelectorAll('[class*="selected" i],[class*="active" i],[aria-pressed="true"]')]
        .map(e => (e.textContent || '').trim())
        .find(s => /^(QB|RB|WR|TE|K|DEF|W\/R\/T|All)$/.test(s));
      if (on) out.posFilter = on;
    }
  } catch (e) {}

  return out;
})()
