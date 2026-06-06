export default async function handler(req, res) {
  try {
    const r = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!r.ok) throw new Error('ESPN HTTP ' + r.status);
    const data = await r.json();

    // Enrich the current event with its real purse from ESPN's core API.
    // The scoreboard feed omits purse; the core event endpoint carries the
    // exact, current dollar figure (plus isSignature / playoffType flags).
    // Best-effort: if this fails we still return live scores unchanged.
    try {
      const ev = data?.events?.[0];
      const eid = ev?.id;
      if (eid) {
        const cr = await fetch(
          'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/' + eid,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        if (cr.ok) {
          const core = await cr.json();
          const purse = Number(core?.purse);
          if (purse > 0) {
            ev.purse = purse;
            ev.displayPurse = core.displayPurse || null;
          }
          if (typeof core?.isSignature === 'boolean') ev.isSignature = core.isSignature;
          if (core?.playoffType != null) ev.playoffType = core.playoffType;
        }
      }
    } catch (_) { /* purse enrichment is optional */ }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.status(200).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
