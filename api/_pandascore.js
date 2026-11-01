// PandaScore : liste des matchs KC (tous jeux), compositions, structure des games (positions, vainqueurs, durées).
// Le token reste côté serveur (variable d'environnement PANDASCORE_TOKEN).
// Les fichiers api/_*.js ne sont pas exposés comme routes par Vercel.

const BASE = 'https://api.pandascore.co';
const ROLE_ORDER = ['top', 'jun', 'jungle', 'mid', 'adc', 'bot', 'bottom', 'sup', 'support'];
export const GAME_PATH = { 'league-of-legends': 'lol', valorant: 'valorant', 'cs-go': 'csgo', 'cs-2': 'csgo', 'dota-2': 'dota2' };

export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

export const token = () => (process.env.PANDASCORE_TOKEN || '').replace(/[^\x21-\x7e]/g, '');

export async function pd(path) {
  const r = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${token()}`, Accept: 'application/json' },
  });
  if (!r.ok) throw new HttpError(r.status, `PandaScore ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export const isLocked = (e) => e instanceof HttpError && [401, 403, 404].includes(e.status);
export const num = (...v) => { for (const x of v) if (typeof x === 'number') return x; return null; };
export function roleIdx(r) { const i = ROLE_ORDER.indexOf(String(r).toLowerCase()); return i < 0 ? 99 : i; }

let teamCache = null;
let teamCacheAt = 0;
// IDs de toutes les équipes Karmine Corp (LoL, Valorant, RL, TFT...)
export async function getTeamIds() {
  if (process.env.KC_TEAM_IDS) return process.env.KC_TEAM_IDS.split(',').map((s) => Number(s.trim()));
  if (teamCache && Date.now() - teamCacheAt < 6 * 3600e3) return teamCache;
  const teams = await pd('/teams?search[name]=Karmine&per_page=100');
  teamCache = teams.filter((t) => /karmine/i.test(t.name)).map((t) => t.id);
  teamCacheAt = Date.now();
  return teamCache;
}

function listTeam(t, m) {
  if (!t) return null;
  const score = (m.results || []).find((r) => r.team_id === t.id)?.score ?? 0;
  return { name: t.name, acronym: t.acronym || t.name, img: t.image_url, score };
}

// Match PandaScore -> format de la liste
export function normalize(m, ids) {
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
    kc: listTeam(kc, m),
    opp: listTeam(other, m),
    kcWon: m.winner_id ? ids.includes(m.winner_id) : null,
    stream: stream?.raw_url || null,
  };
}

export function rosterOf(team) {
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

// Match PandaScore + ses deux équipes (KC / adversaire)
export async function matchWithTeams(id) {
  const [m, opps] = await Promise.all([pd(`/matches/${id}`), pd(`/matches/${id}/opponents`).catch(() => null)]);
  const teams = (opps?.opponents || m.opponents?.map((o) => o.opponent) || []).filter(Boolean);
  const kc = teams.find((t) => /karmine/i.test(t.name)) || teams[0] || null;
  const opp = teams.find((t) => t !== kc) || null;
  return { m, kc, opp };
}

// Stats joueurs d'une game terminée (offre Historical PandaScore, hors LoL qui passe par lolesports)
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

function sumKills(players) {
  const ks = players.map((p) => p.k).filter((k) => k !== null);
  return ks.length ? ks.reduce((a, b) => a + b, 0) : null;
}

export async function finishedGameStats(path, g, kc, opp) {
  const d = await pd(`/${path}/games/${g.id}`);
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
