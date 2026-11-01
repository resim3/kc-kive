// Liste des matchs KC (tous jeux) : direct, à venir, résultats. Source : PandaScore.
// Le MVP des derniers matchs LoL terminés est ajouté pour l'afficher sur la carte, sans clic.

import { token, pd, getTeamIds, normalize } from './_pandascore.js';
import { mvpOf } from './_match.js';

let last = null; // dernière réponse réussie (instance chaude) : resservie si PandaScore refuse (429, panne)
const MVP_BUDGET_MS = 7000; // au-delà, on répond sans les MVP manquants (ils arrivent au chargement suivant)

export default async function handler(req, res) {
  if (!token()) return res.status(500).json({ error: 'PANDASCORE_TOKEN manquant dans les variables Vercel' });
  try {
    const ids = await getTeamIds();
    if (!ids.length) return res.status(200).json({ running: [], upcoming: [], past: [], teams: 0 });
    const f = `filter[opponent_id]=${ids.join(',')}`;
    const [running, upcoming, past] = await Promise.all([
      pd(`/matches/running?${f}&per_page=10`),
      pd(`/matches/upcoming?${f}&sort=begin_at&per_page=15`),
      // 100 sur 1 an (même coût : 1 requête) : avec 15, les matchs LoL cachaient Valorant et RL, et de vieux matchs annulés s'intercalaient
      pd(`/matches/past?${f}&sort=-begin_at&per_page=100&range[begin_at]=${new Date(Date.now() - 365 * 86400e3).toISOString()},${new Date().toISOString()}`),
    ]);
    const byDateDesc = (a, b) => String(b.beginAt).localeCompare(String(a.beginAt));
    // PandaScore renvoie de vieux matchs annulés en tête malgré sort=-begin_at : on retrie
    const perGame = {};
    const pastItems = past.map((m) => normalize(m, ids)).sort(byDateDesc)
      .filter((m) => (perGame[m.gameSlug] = (perGame[m.gameSlug] || 0) + 1) <= 10); // 10 derniers par jeu

    // MVP : seulement pour les 6 derniers matchs LoL terminés (lolesports, gratuit)
    const withMvp = pastItems.filter((m) => m.status === 'finished' && m.gameSlug === 'league-of-legends').slice(0, 6);
    let timer;
    const budget = new Promise((r) => { timer = setTimeout(r, MVP_BUDGET_MS); });
    await Promise.race([
      Promise.all(withMvp.map(async (m) => { m.mvp = await mvpOf(m.id); })),
      budget,
    ]);
    clearTimeout(timer);

    // Cache CDN Vercel 10 s : protège le quota PandaScore même avec beaucoup de visiteurs
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');
    last = {
      running: running.map((m) => normalize(m, ids)),
      upcoming: upcoming.map((m) => normalize(m, ids)),
      past: pastItems,
      teams: ids.length,
      updatedAt: new Date().toISOString(),
    };
    res.status(200).json(last);
  } catch (e) {
    // Erreur aussi mise en cache 10 s : sinon chaque visiteur relance PandaScore et prolonge le 429
    res.setHeader('Cache-Control', 's-maxage=10');
    if (last) return res.status(200).json(last);
    res.status(502).json({ error: e.message });
  }
}
