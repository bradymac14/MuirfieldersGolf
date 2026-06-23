// TEMPORARY diagnostic — v2. Dumps ESPN core competitor status + the actual
// statistics stat names/values to find per-player prize money. Read-only.
export default async function handler(req, res) {
  const UA = { headers: { 'User-Agent': 'Mozilla/5.0' } };
  const get = async (url) => {
    try { const r = await fetch(url.replace(/^http:/, 'https:'), UA);
      return r.ok ? await r.json() : { _httpError: r.status }; }
    catch (e) { return { _err: String(e && e.message || e) }; }
  };
  const out = {};
  try {
    const sb = await get('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
    const eid = sb?.events?.[0]?.id;
    out.eid = eid;

    // Winner (Clark = 11119) competitor + statistics
    const cbase = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${eid}/competitions/${eid}/competitors/11119`;
    const comp = await get(cbase);
    out.competitor = {
      amateur: comp?.amateur,
      status: comp?.status,
      orderKeys: comp?.status ? Object.keys(comp.status) : null
    };
    const stats = await get(cbase + '/statistics');
    const cats = stats?.splits?.categories || stats?.categories || [];
    out.statistics = (Array.isArray(cats) ? cats : []).map(c => ({
      category: c.name,
      stats: (c.stats || []).map(s => ({
        name: s.name, displayName: s.displayName,
        value: s.value, displayValue: s.displayValue
      }))
    }));

    // Try the SITE leaderboard (with event id) — often has earnings inline
    const lb = await get(`https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?event=${eid}`);
    const lbComp = lb?.events?.[0]?.competitions?.[0]?.competitors?.[0]
                || lb?.leaderboard?.[0];
    out.siteLeaderboard = {
      ok: !lb?._httpError && !lb?._err, err: lb?._httpError || lb?._err || null,
      firstCompetitor: lbComp ? JSON.stringify(lbComp).slice(0, 1500) : null
    };
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json(out);
}
