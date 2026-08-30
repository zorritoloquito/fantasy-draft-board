(() => {
  const t = document.body.innerText;
  const out = { ts: Date.now() };

  // teams: "Team 9\t$131\t1/15"  and  "You\t$200\t0/15"
  out.teams = [...t.matchAll(/\n\s*(You|Team \d+)\s*\n?\s*\$(\d+)\s+(\d+)\/(\d+)/g)]
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
  return out;
})()
