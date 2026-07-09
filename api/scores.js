export default async function handler(req, res) {
  try {
    const r = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!r.ok) throw new Error('ESPN HTTP ' + r.status);
    const data = await r.json();

    // Small retry wrapper: a single transient fetch failure used to silently
    // null the purse (it did at the US Open), and a wrong purse scales every
    // payout. Retrying + a backup source makes the live figure far more robust.
    const getJson = async (url, tries = 2) => {
      for (let a = 0; a < tries; a++) {
        try {
          const rr = await fetch(url.replace(/^http:/, 'https:'),
            { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (rr.ok) return await rr.json();
        } catch (_) { /* retry */ }
      }
      return null;
    };

    // Enrich EVERY event with its real purse from ESPN's core API (the scoreboard
    // feed omits purse), plus isSignature / playoffType / winner / live cut. Doing
    // it for all events — not just events[0] — lets us pick the featured event
    // deterministically below and keeps metadata correct no matter how ESPN orders
    // them. Best-effort and parallel: if it fails we still return live scores.
    const events = Array.isArray(data?.events) ? data.events : [];
    await Promise.all(events.map(async (ev) => {
      try {
        const eid = ev?.id;
        if (!eid) return;
        const core = await getJson(
          'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/' + eid);
        if (!core) return;
        const purse = Number(core?.purse);
        if (purse > 0) {
          ev.purse = purse;
          ev.displayPurse = core.displayPurse || null;
        }
        if (typeof core?.isSignature === 'boolean') ev.isSignature = core.isSignature;
        if (core?.playoffType != null) ev.playoffType = core.playoffType;

        // ESPN names the tournament champion here once the event is final.
        // After a sudden-death playoff the participants stay tied on score,
        // so the scoreboard alone can't say who won — this is the only
        // authoritative signal. (ESPN's playoffType is unreliable: it read
        // "None" for the 2026 Memorial despite Poston beating Gerard in a
        // playoff.) The client uses winnerName to award sole 1st place.
        const wname = core?.winner?.athlete?.displayName || core?.winner?.athlete?.fullName;
        if (wname) ev.winnerName = wname;

        // Attach ESPN's live cut line/count from the tournament object.
        // ESPN computes the cut per event (it knows each event's rule:
        // signature top-50, standard top-65, the majors, or no-cut) and
        // updates cutScore/cutCount in real time — so we never hardcode or
        // guess the cut. The tournament object also carries a backup purse,
        // used when the event object hasn't published one yet.
        const tref = core?.tournament?.$ref || '';
        if (tref) {
          const t = await getJson(tref);
          if (t) {
            const num = v => (v != null && !isNaN(v)) ? Number(v) : null;
            ev.cut = {
              round: num(t?.cutRound),
              score: num(t?.cutScore),
              count: num(t?.cutCount),
              currentRound: num(t?.currentRound)
            };
            if (!(Number(ev.purse) > 0)) {
              const tp = Number(t?.purse);
              if (tp > 0) { ev.purse = tp; ev.displayPurse = ev.displayPurse || t.displayPurse || null; }
            }
          }
        }
      } catch (_) { /* per-event enrichment is optional */ }
    }));

    // Featured event = highest purse. On weeks with an opposite-field event (e.g.
    // the ISCO Championship alongside the Genesis Scottish Open) the marquee event —
    // where the pool's players actually are — always carries the bigger purse, so
    // this locks the app onto it no matter how ESPN orders the scoreboard. Events
    // with an unknown purse (enrichment failed) sort last; ties keep ESPN's order.
    if (events.length > 1) {
      events.sort((a, b) => (Number(b?.purse) || 0) - (Number(a?.purse) || 0));
      data.events = events;
    }

    // Official prize money per player on the featured event (events[0]). Once it's
    // FINAL, ESPN's core API exposes each competitor's exact official money
    // (statistics → "amount"), which already bakes in ties and amateur forfeits to
    // the dollar. We attach it as competitor.earnings so the client uses REAL money
    // instead of an approximate curve — accurate for any tournament, no per-event
    // upkeep. Only runs when final (no official money exists mid-event); best-effort
    // and time-bounded so it can never delay or break the live scores response.
    let moneyComplete = false;
    try {
      const ev = data?.events?.[0];
      const eid = ev?.id;
      const comp = ev?.competitions?.[0];
      const st = comp?.status?.type;
      const isFinal = st?.completed === true || /final/i.test(st?.name || '');
      const cs = comp?.competitors || [];
      if (eid && isFinal && cs.length) {
        const base = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/'
          + eid + '/competitions/' + eid + '/competitors';
        const deadline = Date.now() + 7000;
        let attached = 0, bailed = false;
        const CONC = 24;
        for (let i = 0; i < cs.length; i += CONC) {
          if (Date.now() > deadline) { bailed = true; break; }
          await Promise.all(cs.slice(i, i + CONC).map(async (c) => {
            try {
              const sr = await fetch(base + '/' + c.id + '/statistics',
                { headers: { 'User-Agent': 'Mozilla/5.0' } });
              if (!sr.ok) return;
              const sj = await sr.json();
              const stats = sj?.splits?.categories?.[0]?.stats
                || sj?.categories?.[0]?.stats || [];
              const amt = stats.find(s => s.name === 'amount' || s.name === 'officialAmount');
              if (amt && typeof amt.value === 'number') { c.earnings = amt.value; attached++; }
            } catch (_) { /* per-player best-effort */ }
          }));
        }
        moneyComplete = !bailed && attached > 0;
      }
    } catch (_) { /* money enrichment is optional */ }

    res.setHeader('Access-Control-Allow-Origin', '*');
    // Final results are immutable, so cache the money-enriched payload hard once
    // it's complete; otherwise keep the short live cache.
    res.setHeader('Cache-Control', moneyComplete
      ? 's-maxage=3600, stale-while-revalidate=86400'
      : 's-maxage=30, stale-while-revalidate=60');
    res.status(200).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
