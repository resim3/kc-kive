// Détail d'un match : compositions + scoreboard par game + VOD.
// GET /api/match?id=<match_id PandaScore>
// - PandaScore : structure du match (games, vainqueurs, durées) et compositions, pour tous les jeux.
// - LoL : stats complètes (champions, K/D/A, CS, or, objets, objectifs) et VOD via lolesports (gratuit).
// - Autres jeux : stats PandaScore si l'offre les inclut, sinon stats: 'locked' -> compositions seules.

import { token, matchWithTeams, rosterOf, finishedGameStats, isLocked, GAME_PATH, HttpError } from './_pandascore.js';
import { findMatchId, lolMatch } from './_lolesports.js';

export default async function handler(req, res) {
  if (!token()) return res.status(500).json({ error: 'PANDASCORE_TOKEN manquant dans les variables Vercel' });
  const id = Number(req.query?.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Paramètre id invalide' });

  try {
    const { m, kc, opp } = await matchWithTeams(id);
    const path = GAME_PATH[m.videogame?.slug];
    const beginAt = m.begin_at || m.scheduled_at;

    let lol = null;
    let lolMatchId = null;
    if (path === 'lol') {
      try {
        lolMatchId = await findMatchId(beginAt, kc?.acronym);
        if (lolMatchId) lol = await lolMatch(lolMatchId, kc?.acronym);
      } catch (e) {
        console.error('lolesports', e.message); // on continue avec PandaScore seul
      }
    }

    let statsLocked = false;
    const games = [];
    for (const g of [...(m.games || [])].sort((a, b) => a.position - b.position)) {
      const running = g.status === 'running';
      const game = {
        id: g.id, position: g.position, status: g.status,
        winner: g.winner?.id === kc?.id ? 'kc' : g.winner?.id ? 'opp' : null,
        stats: 'none',
        clock: typeof g.length === 'number' ? g.length : running && g.begin_at ? (Date.now() - Date.parse(g.begin_at)) / 1000 : null,
        teams: null, vod: null,
      };
      const lg = lol?.games.find((x) => x.number === g.position);
      if (lg) {
        game.vod = lg.vod;
        if (lg.stats) Object.assign(game, { teams: lg.stats.teams, stats: lg.stats.state === 'finished' ? 'ok' : 'live' });
        if (game.stats === 'live' && g.status === 'not_started') game.status = 'running'; // lolesports plus rapide
      } else if (g.status === 'finished' && path && path !== 'lol') {
        if (statsLocked) game.stats = 'locked';
        else {
          try {
            const r = await finishedGameStats(path, g, kc, opp);
            if (r) Object.assign(game, r, { stats: 'ok' });
          } catch (e) {
            if (!isLocked(e)) throw e;
            statsLocked = true;
            game.stats = 'locked';
          }
        }
      }
      games.push(game);
    }

    const live = m.status === 'running';
    res.setHeader('Cache-Control', live ? 's-maxage=30, stale-while-revalidate=30' : 's-maxage=600, stale-while-revalidate=600');
    res.status(200).json({
      id: m.id,
      status: m.status,
      game: m.videogame?.name || '',
      kc: kc ? { id: kc.id, name: kc.name, acronym: kc.acronym || kc.name, img: kc.image_url, roster: rosterOf(kc) } : null,
      opp: opp ? { id: opp.id, name: opp.name, acronym: opp.acronym || opp.name, img: opp.image_url, roster: rosterOf(opp) } : null,
      games,
      source: lol ? 'lolesports' : 'pandascore',
      hasBracket: !!lol?.tournamentId,
      statsLocked,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(e instanceof HttpError && e.status === 404 ? 404 : 502).json({ error: e.message });
  }
}
