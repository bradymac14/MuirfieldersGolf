// TEMPORARY diagnostic endpoint — probes ESPN's APIs to find where per-player
// prize money/earnings live, so we can wire real money into /api/scores.
// Safe & read-only; does not touch the working /api/scores. Remove after use.
export default async function handler(req, res) {
  const UA = { headers: { 'User-Agent': 'Mozilla/5.0' } };
  const out = { steps: {} };
  const get = async (url) => {
    const r = await fetch(url, UA);
    return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : null };
  };
  const scan = (obj) => {
    // recursively collect any key whose name hints at money, with its value
    const hits = [];
    const walk = (o, path) => {
      if (o == null || typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        const p = path ? path + '.' + k : k;
        if (/earn|money|cash|prize|purse|winnings|payout/i.test(k)) {
          const v = o[k];
          hits.push({ path: p, value: (v && typeof v === 'object') ? '[object]' : v });
        }
        if (typeof o[k] === 'object') walk(o[k], p);
      }
    };
    walk(obj, '');
    return hits.slice(0, 40);
  };

  try {
    // 1) current event id from the scoreboard
    const sb = await get('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
    const ev = sb.json?.events?.[0];
    const eid = ev?.id;
    out.steps.scoreboard = { eid, name: ev?.name, status: ev?.competitions?.[0]?.status?.type?.name };

    // 2) SITE leaderboard endpoint — may carry earnings inline
    const lb = await get('https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard');
    const lbc = lb.json?.events?.[0]?.competitions?.[0]?.competitors?.[0];
    out.steps.siteLeaderboard = {
      ok: lb.ok, firstCompetitorKeys: lbc ? Object.keys(lbc) : null,
      moneyHits: lbc ? scan(lbc) : null
    };

    if (eid) {
      // 3) core API competitors list
      const base = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${eid}/competitions/${eid}/competitors`;
      const cl = await get(base + '?limit=3');
      const firstRef = cl.json?.items?.[0]?.$ref;
      out.steps.coreCompetitorsList = { ok: cl.ok, count: cl.json?.count, firstRef };

      if (firstRef) {
        // 4) one competitor object
        const comp = await get(firstRef.replace(/^http:/, 'https:'));
        out.steps.coreCompetitor = {
          ok: comp.ok,
          keys: comp.json ? Object.keys(comp.json) : null,
          moneyHits: comp.json ? scan(comp.json) : null,
          statisticsRef: comp.json?.statistics?.$ref || null
        };
        // 5) that competitor's statistics
        const sref = comp.json?.statistics?.$ref;
        if (sref) {
          const st = await get(sref.replace(/^http:/, 'https:'));
          const cats = st.json?.splits?.categories || st.json?.categories;
          out.steps.coreStatistics = {
            ok: st.ok,
            categoryNames: Array.isArray(cats) ? cats.map(c => c.name) : null,
            moneyHits: st.json ? scan(st.json) : null
          };
        }
      }
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json({ error: String(e && e.message || e), out });
  }
}
