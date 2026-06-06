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

          // Attach ESPN's live cut line/count from the tournament object.
          // ESPN computes the cut per event (it knows each event's rule:
          // signature top-50, standard top-65, the majors, or no-cut) and
          // updates cutScore/cutCount in real time — so we never hardcode or
          // guess the cut. One extra hop via tournament.$ref.
          try {
            const tref = (core?.tournament?.$ref || '').replace(/^http:/, 'https:');
            if (tref) {
              const tr = await fetch(tref, { headers: { 'User-Agent': 'Mozilla/5.0' } });
              if (tr.ok) {
                const t = await tr.json();
                const num = v => (v != null && !isNaN(v)) ? Number(v) : null;
                ev.cut = {
                  round: num(t?.cutRound),
                  score: num(t?.cutScore),
                  count: num(t?.cutCount),
                  currentRound: num(t?.currentRound)
                };
              }
            }
          } catch (_) { /* cut enrichment is optional */ }
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
