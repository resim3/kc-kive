// Détail d'un match, partagé entre /api/match (détail) et /api/matches (MVP des résultats).
// - PandaScore : structure du match (games, vainqueurs, durées) et compositions, pour tous les jeux.
// - LoL : stats complètes et VOD via lolesports (gratuit).
// - Autres jeux : stats PandaScore si l'offre les inclut, sinon stats: 'locked' -> compositions seules.

import { matchWithTeams, rosterOf, finishedGameStats, isLocked, GAME_PATH } from './_pandascore.js';
import { findMatchId, lolMatch } from './_lolesports.js';

export async function buildMatch(id) {
  const { m, kc, opp } = await matchWithTeams(id);
  const path = GAME_PATH[m.videogame?.slug];
  const beginAt = m.begin_at || m.scheduled_at;

  let lol = null;
  if (path === 'lol') {
    try {
      const lolMatchId = await findMatchId(beginAt, kc?.acronym);
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

  return {
    id: m.id,
    status: m.status,
    game: m.videogame?.name || '',
    kc: kc ? { id: kc.id, name: kc.name, acronym: kc.acronym || kc.name, img: kc.image_url, roster: rosterOf(kc) } : null,
    opp: opp ? { id: opp.id, name: opp.name, acronym: opp.acronym || opp.name, img: opp.image_url, roster: rosterOf(opp) } : null,
    games,
    source: lol ? 'lolesports' : 'pandascore',
    hasBracket: !!lol?.tournamentId,
    statsLocked,
    mvp: seriesMvp(games),
    updatedAt: new Date().toISOString(),
  };
}

// MVP d'une série terminée : meilleur KDA cumulé de l'équipe gagnante. Null si pas de stats ou série non décidée.
// Ne calcule que pour les games avec stats complètes (LoL / jeux PandaScore avec stats).
export function seriesMvp(games) {
  const done = games.filter((g) => g.stats === 'ok' && g.teams);
  const kcWins = games.filter((g) => g.winner === 'kc').length;
  const oppWins = games.filter((g) => g.winner === 'opp').length;
  if (!done.length || kcWins === oppWins) return null;
  const side = kcWins > oppWins ? 'kc' : 'opp';
  const sums = new Map();
  for (const g of done) for (const p of g.teams[side]?.players || []) {
    const s = sums.get(p.name) || { name: p.name, k: 0, d: 0, a: 0 };
    s.k += p.k ?? 0; s.d += p.d ?? 0; s.a += p.a ?? 0;
    sums.set(p.name, s);
  }
  const kda = (s) => (s.k + s.a) / Math.max(1, s.d);
  const best = [...sums.values()].sort((x, y) => kda(y) - kda(x))[0];
  return best ? { name: best.name, k: best.k, d: best.d, a: best.a, side } : null;
}

// MVP d'un match terminé, mémorisé : une fois calculé, il ne change plus
const mvpMemo = new Map();
export function mvpOf(id) {
  if (!mvpMemo.has(id)) {
    const p = buildMatch(id).then((m) => m.mvp ?? null).catch(() => null);
    mvpMemo.set(id, p);
  }
  return mvpMemo.get(id);
}
