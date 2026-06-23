// TEMPORARY diagnostic — v3. Pulls official money for the WHOLE field to verify
// completeness, totals, and timing/feasibility of the real-money approach. Read-only.
export default async function handler(req, res) {
  const UA = { headers: { 'User-Agent': 'Mozilla/5.0' } };
  const t0 = Date.now();
  const getJ = async (url) => {
    try { const r = await fetch(url.replace(/^http:/, 'https:'), UA);
      return r.ok ? await r.json() : null; } catch { return null; }
  };
  const out = {};
  try {
    const sb = await getJ('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
    const ev = sb?.events?.[0];
    const eid = ev?.id;
    const comps = ev?.competitions?.[0]?.competitors || [];
    out.eid = eid; out.field = comps.length;
    out.status = ev?.competitions?.[0]?.status?.type?.name;

    // Bulk-endpoint candidates (one call for everyone = ideal)
    const bulk = {};
    for (const [k, url] of Object.entries({
      siteLb: `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard`,
      siteLbEvent: `https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga&event=${eid}`,
      coreCompetitorsList: `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${eid}/competitions/${eid}/competitors?limit=200`
    })) {
      const j = await getJ(url);
      bulk[k] = j ? (JSON.stringify(j).match(/"(amount|earnings|officialAmount)"/g)?.slice(0,3) || 'no-money-keys') : 'failed';
    }
    out.bulkEndpoints = bulk;

    // Per-competitor money via statistics, batched in parallel
    const base = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${eid}/competitions/${eid}/competitors`;
    const ids = comps.map(c => ({ id: c.id, name: c.athlete?.displayName, order: c.order }));
    const money = {};
    const CONC = 24;
    for (let i = 0; i < ids.length; i += CONC) {
      const batch = ids.slice(i, i + CONC);
      await Promise.all(batch.map(async (c) => {
        const st = await getJ(`${base}/${c.id}/statistics`);
        const stats = st?.splits?.categories?.[0]?.stats || st?.categories?.[0]?.stats || [];
        const amt = stats.find(s => s.name === 'amount' || s.name === 'officialAmount');
        money[c.id] = amt ? amt.value : null;
      }));
    }
    const vals = Object.values(money).filter(v => v != null);
    out.elapsedMs = Date.now() - t0;
    out.playersWithMoney = vals.length;
    out.playersNull = Object.values(money).filter(v => v == null).length;
    out.totalMoney = vals.reduce((a, b) => a + b, 0);
    // samples: winner, a mid, the last by order
    const byOrder = ids.slice().sort((a, b) => a.order - b.order);
    const pick = [byOrder[0], byOrder[Math.floor(byOrder.length/2)], byOrder[byOrder.length-1]];
    out.samples = pick.map(c => ({ name: c.name, order: c.order, amount: money[c.id] }));
  } catch (e) {
    out.error = String(e && e.message || e); out.elapsedMs = Date.now() - t0;
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(out);
}
