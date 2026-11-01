// Saison de la KC : tous les matchs terminés, bilan, plus longues séries. Source : PandaScore.
// GET /api/saison

import { token, pd, getTeamIds, normalize } from './_pandascore.js';

export default async function handler(req, res) {
  if (!token()) return res.status(500).json({ error: 'PANDASCORE_TOKEN manquant dans les variables Vercel' });
  try {
    const ids = await getTeamIds();
    const f = `filter[opponent_id]=${ids.join(',')}`;
    // Jusqu'à 300 matchs terminés (3 pages de 100)
    const all = [];
    for (let page = 1; page <= 3; page++) {
      const list = await pd(`/matches/past?${f}&sort=-begin_at&per_page=100&page=${page}`);
      all.push(...list);
      if (list.length < 100) break;
    }
    // Chronologique, sans les matchs annulés ni sans résultat
    const items = all
      .map((m) => normalize(m, ids))
      .filter((m) => m.status === 'finished' && m.kcWon !== null)
      .sort((a, b) => String(a.beginAt).localeCompare(String(b.beginAt)));

    let wins = 0, losses = 0, winStreak = 0, lossStreak = 0, bestWin = 0, worstLoss = 0;
    for (const m of items) {
      if (m.kcWon) {
        wins++; winStreak++; lossStreak = 0;
        bestWin = Math.max(bestWin, winStreak);
      } else {
        losses++; lossStreak++; winStreak = 0;
        worstLoss = Math.max(worstLoss, lossStreak);
      }
      m.streak = m.kcWon ? winStreak : -lossStreak; // sert à marquer les séries sur la frise
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({
      record: { wins, losses },
      bestWinStreak: bestWin,
      worstLossStreak: worstLoss,
      matches: items.map((m) => ({
        id: m.id, beginAt: m.beginAt, game: m.game, gameSlug: m.gameSlug, league: m.league,
        opp: m.opp ? { name: m.opp.name, acronym: m.opp.acronym, img: m.opp.img } : null,
        kcScore: m.kc?.score ?? 0, oppScore: m.opp?.score ?? 0, kcWon: m.kcWon, streak: m.streak,
      })),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
