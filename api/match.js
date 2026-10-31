// Détail d'un match : compositions des équipes + scoreboard par game (champions/agents, K/D/A, CS, or).
// GET /api/match?id=<match_id>
// - Compositions : incluses dans l'offre gratuite PandaScore.
// - Stats par joueur : selon l'offre PandaScore (Historical pour les games terminées, Live pour le direct).
//   Si l'offre ne les inclut pas, on renvoie stats: 'locked' et l'interface affiche seulement les compositions.

const BASE = 'https://api.pandascore.co';
const GAME_PATH = { 'league-of-legends': 'lol', valorant: 'valorant', 'cs-go': 'csgo', 'cs-2': 'csgo', 'dota-2': 'dota2' };
const ROLE_ORDER = ['top', 'jun', 'jungle', 'mid', 'adc', 'bot', 'sup', 'support'];

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function pd(path, token) {
  const r = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!r.ok) throw new HttpError(r.status, `PandaScore ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
const isLocked = (e) => e instanceof HttpError && [401, 403, 404].includes(e.status);
const num = (...v) => { for (const x of v) if (typeof x === 'number') return x; return null; };

function rosterOf(team) {
  return (team?.players || [])
    .filter((p) => p.active !== false)
    .map((p) => ({
      name: p.name,
      realName: [p.first_name, p.last_name].filter(Boolean).join(' '),
      role: p.role || '',
      img: p.image_url || null,
      nat: p.nationality || '',
    }))
    .sort((a, b) => roleIdx(a.role) - roleIdx(b.role));
}
function roleIdx(r) { const i = ROLE_ORDER.indexOf(String(r).toLowerCase()); return i < 0 ? 99 : i; }

// Joueur d'une game terminée (/lol/games/:id, /valorant/games/:id…) : format variable selon le jeu
function statPlayer(p) {
  const pick = p.champion || p.agent || p.hero || null;
  const s = p.stats || {};
  return {
    name: p.player?.name || p.name || '?',
    role: p.role || p.player?.role || '',
    pick: pick ? { name: pick.name, img: pick.image_url || null } : null,
    k: num(p.kills, s.kills, s.totals?.kills),
    d: num(p.deaths, s.deaths, s.totals?.deaths),
    a: num(p.assists, s.assists, s.totals?.assists),
    cs: num(p.minions_killed, p.cs, s.minions_killed),
    gold: num(p.gold_earned, p.gold, s.gold_earned),
    teamId: p.team?.id ?? p.team_id ?? p.opponent?.id ?? null,
  };
}

// Frame live LoL (/lol/games/:id/frames) : { blue: {id, name, kills, gold, players: {top:{…}, jun, mid, adc, sup}}, red: {…} }
function frameTeam(t) {
  const players = Object.entries(t?.players || {}).map(([role, p]) => ({
    name: p?.name || '?',
    role,
    pick: p?.champion ? { name: p.champion.name, img: p.champion.image_url || null } : null,
    k: num(p?.kills), d: num(p?.deaths), a: num(p?.assists),
    cs: num(p?.cs, p?.minions_killed), gold: num(p?.gold, p?.gold_earned),
    level: num(p?.level),
  }));
  return { id: t?.id ?? null, name: t?.name || '', acronym: t?.acronym || '', kills: num(t?.kills), gold: num(t?.gold), towers: num(t?.towers), players };
}

function sumKills(players) {
  const ks = players.map((p) => p.k).filter((k) => k !== null);
  return ks.length ? ks.reduce((a, b) => a + b, 0) : null;
}

// Rattache une équipe (frame ou stats) à KC ou à l'adversaire
function side(t, kc, opp) {
  if (t.id != null) { if (t.id === kc?.id) return 'kc'; if (t.id === opp?.id) return 'opp'; }
  const n = `${t.name} ${t.acronym}`.toLowerCase();
  if (/karmine|\bkc/.test(n)) return 'kc';
  return 'opp';
}

async function liveGame(g, kc, opp, token) {
  const frames = await pd(`/lol/games/${g.id}/frames?per_page=1`, token);
  const list = Array.isArray(frames) ? frames : [frames];
  const f = list.sort((a, b) => String(b.current_timestamp ?? '').localeCompare(String(a.current_timestamp ?? '')))[0];
  if (!f) return null;
  const teams = [frameTeam(f.blue), frameTeam(f.red)];
  const sides = teams.map((t) => side(t, kc, opp));
  if (sides[0] === sides[1]) sides[1] = sides[0] === 'kc' ? 'opp' : 'kc';
  const out = {};
  teams.forEach((t, i) => {
    t.color = i === 0 ? 'blue' : 'red';
    t.players.sort((a, b) => roleIdx(a.role) - roleIdx(b.role));
    if (t.kills === null) t.kills = sumKills(t.players);
    out[sides[i]] = t;
  });
  return { clock: num(f.current_timestamp), teams: out };
}

async function finishedGame(path, g, kc, opp, token) {
  const d = await pd(`/${path}/games/${g.id}`, token);
  const players = (d.players || []).map(statPlayer);
  if (!players.length) return null;
  const out = { kc: { players: [] }, opp: { players: [] } };
  for (const p of players) out[p.teamId === kc?.id ? 'kc' : 'opp'].players.push(p);
  for (const k of ['kc', 'opp']) {
    out[k].players.sort((a, b) => roleIdx(a.role) - roleIdx(b.role));
    const teamInfo = (d.teams || []).find((t) => (t.team?.id ?? t.id) === (k === 'kc' ? kc?.id : opp?.id));
    out[k].kills = num(teamInfo?.kills) ?? sumKills(out[k].players);
    out[k].color = teamInfo?.color || null;
  }
  return { clock: num(d.length), teams: out };
}

export default async function handler(req, res) {
  const token = (process.env.PANDASCORE_TOKEN || '').replace(/[^\x21-\x7e]/g, '');
  if (!token) return res.status(500).json({ error: 'PANDASCORE_TOKEN manquant dans les variables Vercel' });
  const id = Number(req.query?.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Paramètre id invalide' });

  try {
    const [m, opps] = await Promise.all([pd(`/matches/${id}`, token), pd(`/matches/${id}/opponents`, token).catch(() => null)]);
    const teams = (opps?.opponents || m.opponents?.map((o) => o.opponent) || []).filter(Boolean);
    const kc = teams.find((t) => /karmine/i.test(t.name)) || teams[0] || null;
    const opp = teams.find((t) => t !== kc) || null;
    const path = GAME_PATH[m.videogame?.slug];

    let statsLocked = false;
    let liveLocked = false;
    const games = [];
    for (const g of [...(m.games || [])].sort((a, b) => a.position - b.position)) {
      const game = {
        id: g.id, position: g.position, status: g.status,
        winner: g.winner?.id === kc?.id ? 'kc' : g.winner?.id ? 'opp' : null,
        stats: 'none', clock: null, teams: null,
      };
      try {
        if (g.status === 'running' && path === 'lol' && !liveLocked) {
          const r = await liveGame(g, kc, opp, token);
          if (r) Object.assign(game, r, { stats: 'live' });
        } else if (g.status === 'finished' && path && !statsLocked) {
          const r = await finishedGame(path, g, kc, opp, token);
          if (r) Object.assign(game, r, { stats: 'ok' });
        }
      } catch (e) {
        if (!isLocked(e)) throw e;
        if (g.status === 'running') liveLocked = true; else statsLocked = true;
        game.stats = 'locked';
      }
      if (g.status === 'running' && game.stats === 'none' && liveLocked) game.stats = 'locked';
      if (g.status === 'finished' && game.stats === 'none' && statsLocked) game.stats = 'locked';
      games.push(game);
    }

    const running = m.status === 'running';
    res.setHeader('Cache-Control', running ? 's-maxage=45, stale-while-revalidate=30' : 's-maxage=600, stale-while-revalidate=600');
    res.status(200).json({
      id: m.id,
      status: m.status,
      game: m.videogame?.name || '',
      kc: kc ? { id: kc.id, name: kc.name, acronym: kc.acronym || kc.name, img: kc.image_url, roster: rosterOf(kc) } : null,
      opp: opp ? { id: opp.id, name: opp.name, acronym: opp.acronym || opp.name, img: opp.image_url, roster: rosterOf(opp) } : null,
      games,
      statsLocked,
      liveLocked,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(e instanceof HttpError && e.status === 404 ? 404 : 502).json({ error: e.message });
  }
}
