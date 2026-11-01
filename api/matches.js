// Liste des matchs KC (tous jeux) : direct, à venir, résultats. Source : PandaScore.

import { token, pd, getTeamIds, normalize } from './_pandascore.js';

export default async function handler(req, res) {
  if (!token()) return res.status(500).json({ error: 'PANDASCORE_TOKEN manquant dans les variables Vercel' });
  try {
    const ids = await getTeamIds();
    if (!ids.length) return res.status(200).json({ running: [], upcoming: [], past: [], teams: 0 });
    const f = `filter[opponent_id]=${ids.join(',')}`;
    const [running, upcoming, past] = await Promise.all([
      pd(`/matches/running?${f}&per_page=10`),
      pd(`/matches/upcoming?${f}&sort=begin_at&per_page=15`),
      pd(`/matches/past?${f}&sort=-begin_at&per_page=15`),
    ]);
    const byDateDesc = (a, b) => String(b.beginAt).localeCompare(String(a.beginAt));
    // Cache CDN Vercel 10 s : protège le quota PandaScore même avec beaucoup de visiteurs
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');
    res.status(200).json({
      running: running.map((m) => normalize(m, ids)),
      upcoming: upcoming.map((m) => normalize(m, ids)),
      // PandaScore renvoie de vieux matchs annulés en tête malgré sort=-begin_at : on retrie
      past: past.map((m) => normalize(m, ids)).sort(byDateDesc),
      teams: ids.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
