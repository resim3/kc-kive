// Fonction serverless Vercel : proxy sécurisé vers PandaScore.
// Le token reste côté serveur (variable d'environnement PANDASCORE_TOKEN).

const BASE = 'https://api.pandascore.co';
let teamCache = null;
let teamCacheAt = 0;

async function pd(path, token) {
  const r = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`PandaScore ${r.status}: ${await r.text()}`);
  return r.json();
}

// Récupère les IDs de toutes les équipes Karmine Corp (LoL, Valorant, RL, TFT...)
async function getTeamIds(token) {
  if (process.env.KC_TEAM_IDS) {
    return process.env.KC_TEAM_IDS.split(',').map((s) => Number(s.trim()));
  }
  if (teamCache && Date.now() - teamCacheAt < 6 * 3600e3) return teamCache;
  const teams = await pd('/teams?search[name]=Karmine&per_page=100', token);
  teamCache = teams.filter((t) => /karmine/i.test(t.name)).map((t) => t.id);
  teamCacheAt = Date.now();
  return teamCache;
}

function team(t, m) {
  if (!t) return null;
  const score = (m.results || []).find((r) => r.team_id === t.id)?.score ?? 0;
  return { name: t.name, acronym: t.acronym || t.name, img: t.image_url, score };
}

function normalize(m, ids) {
  const opps = (m.opponents || []).map((o) => o.opponent).filter(Boolean);
  const kc = opps.find((t) => ids.includes(t.id)) || opps[0] || null;
  const other = opps.find((t) => t !== kc) || null;
  const streams = m.streams_list || [];
  const stream = streams.find((s) => s.main) || streams[0];
  return {
    id: m.id,
    status: m.status, // not_started | running | finished | canceled
    beginAt: m.begin_at || m.scheduled_at,
    game: m.videogame?.name || '',
    gameSlug: m.videogame?.slug || '',
    league: m.league?.name || '',
    leagueImg: m.league?.image_url || null,
    serie: m.serie?.full_name || '',
    tournament: m.tournament?.name || '',
    bestOf: m.number_of_games,
    kc: team(kc, m),
    opp: team(other, m),
    kcWon: m.winner_id ? ids.includes(m.winner_id) : null,
    stream: stream?.raw_url || null,
  };
}

export default async function handler(req, res) {
  const token = (process.env.PANDASCORE_TOKEN || '').replace(/[^\x21-\x7e]/g, '');
  if (!token) {
    return res.status(500).json({ error: 'PANDASCORE_TOKEN manquant dans les variables Vercel' });
  }
  try {
    const ids = await getTeamIds(token);
    if (!ids.length) return res.status(200).json({ running: [], upcoming: [], past: [], teams: 0 });
    const f = `filter[opponent_id]=${ids.join(',')}`;
    const [running, upcoming, past] = await Promise.all([
      pd(`/matches/running?${f}&per_page=10`, token),
      pd(`/matches/upcoming?${f}&sort=begin_at&per_page=15`, token),
      pd(`/matches/past?${f}&sort=-begin_at&per_page=15`, token),
    ]);
    // Cache CDN Vercel 10 s : protège ton quota PandaScore même avec beaucoup de visiteurs
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');
    res.status(200).json({
      running: running.map((m) => normalize(m, ids)),
      upcoming: upcoming.map((m) => normalize(m, ids)),
      past: past.map((m) => normalize(m, ids)),
      teams: ids.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
