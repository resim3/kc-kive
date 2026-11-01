// lolesports (Riot) : scoreboard LoL complet, VOD de chaque game, arbre du tournoi.
// API NON OFFICIELLE : on utilise la clé publique embarquée dans le site lolesports.com.
// Riot peut la changer sans préavis -> surcharge possible via la variable LOLESPORTS_KEY.
// Tout échec ici est rattrapé par les routes : l'appli retombe sur les données PandaScore.

const GW = 'https://esports-api.lolesports.com/persisted/gw';
const FEED = 'https://feed.lolesports.com/livestats/v1';
const DD = 'https://ddragon.leagueoflegends.com/cdn';
const KEY = process.env.LOLESPORTS_KEY || '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const VOD_LOCALES = ['fr-FR', 'en-US'];

async function gw(op, params = {}) {
  const r = await fetch(`${GW}/${op}?${new URLSearchParams({ hl: 'fr-FR', ...params })}`, { headers: { 'x-api-key': KEY } });
  if (!r.ok) throw new Error(`lolesports ${op} ${r.status}`);
  return (await r.json()).data;
}

async function feed(path) {
  const r = await fetch(FEED + path);
  if (r.status === 204 || r.status === 404) return null; // game pas encore commencée
  if (!r.ok) throw new Error(`lolesports feed ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/* ---------- Calendrier : retrouver le match lolesports d'un match PandaScore ---------- */
let sched = { at: 0, events: [], next: undefined, pages: 0 };
async function scheduleEvents(pages) {
  if (Date.now() - sched.at > 5 * 60e3) sched = { at: Date.now(), events: [], next: undefined, pages: 0 };
  while (sched.pages < pages && sched.next !== null) {
    const s = (await gw('getSchedule', sched.next ? { pageToken: sched.next } : {})).schedule;
    sched.events.push(...s.events);
    sched.next = s.pages?.older || null;
    sched.pages++;
  }
  return sched.events;
}

// Match KC le plus proche (± 12 h) de la date PandaScore ; code = acronyme PandaScore (KC, KCB…)
export async function findMatchId(beginAt, code) {
  const t = Date.parse(beginAt);
  if (!t) return null;
  for (let pages = 1; pages <= 3; pages++) {
    const events = await scheduleEvents(pages);
    let best = null;
    let bestScore = Infinity;
    for (const e of events) {
      const teams = e.match?.teams || [];
      if (!teams.some((x) => /karmine/i.test(x.name))) continue;
      const dt = Math.abs(Date.parse(e.startTime) - t);
      if (dt > 12 * 3600e3) continue;
      const score = dt + (teams.some((x) => x.code === code) ? 0 : 24 * 3600e3); // préfère le bon code (KC vs KCB)
      if (score < bestScore) { best = e; bestScore = score; }
    }
    if (best) return best.match.id;
    const oldest = Math.min(...events.map((e) => Date.parse(e.startTime)));
    if (oldest < t || sched.next === null) return null; // période couverte : pas de match lolesports
  }
  return null;
}

/* ---------- Scoreboard ---------- */
const champCache = new Map(); // version ddragon -> { id: nom }
async function champNames(ver) {
  if (!ver) return {};
  if (!champCache.has(ver)) {
    const p = fetch(`${DD}/${ver}/data/fr_FR/champion.json`)
      .then((r) => (r.ok ? r.json() : { data: {} }))
      .then((j) => Object.fromEntries(Object.values(j.data).map((c) => [c.id, c.name])))
      .catch(() => ({}));
    champCache.set(ver, p);
  }
  return champCache.get(ver);
}
const ddVer = (patch) => (patch ? patch.split('.').slice(0, 2).join('.') + '.1' : null); // "16.20.826.3891" -> "16.20.1"
const stripTag = (n) => String(n || '?').replace(/^[A-Z0-9]{2,5}\s+/, ''); // "KC Canna" -> "Canna"

const statsCache = new Map(); // gameId -> stats d'une game terminée (ne bougent plus)
async function gameStats(gameId, kcTeamId) {
  if (statsCache.has(gameId)) return statsCache.get(gameId);
  // Le flux exige un horodatage multiple de 10 s ; une date après la fin renvoie l'état final
  const at = new Date(Math.floor((Date.now() - 60e3) / 10e3) * 10e3).toISOString();
  const [w, det] = await Promise.all([
    feed(`/window/${gameId}?startingTime=${at}`),
    feed(`/details/${gameId}?startingTime=${at}`).catch(() => null),
  ]);
  const f = w?.frames?.at(-1);
  if (!f) return null;
  const meta = w.gameMetadata;
  const ver = ddVer(meta.patchVersion);
  const names = await champNames(ver);
  const extra = new Map((det?.frames?.at(-1)?.participants || []).map((p) => [p.participantId, p]));

  const side = (tm, fr, color) => {
    const pm = new Map(tm.participantMetadata.map((p) => [p.participantId, p]));
    return {
      id: tm.esportsTeamId, color,
      kills: fr.totalKills, gold: fr.totalGold, towers: fr.towers, inhibs: fr.inhibitors, barons: fr.barons, dragons: fr.dragons || [],
      players: fr.participants.map((p) => {
        const m = pm.get(p.participantId) || {};
        const x = extra.get(p.participantId) || {};
        return {
          name: stripTag(m.summonerName), role: m.role || '',
          pick: m.championId ? { name: names[m.championId] || m.championId, img: ver && `${DD}/${ver}/img/champion/${m.championId}.png` } : null,
          k: p.kills, d: p.deaths, a: p.assists, cs: p.creepScore, gold: p.totalGold, level: p.level,
          items: ver ? (x.items || []).filter(Boolean).map((i) => `${DD}/${ver}/img/item/${i}.png`) : [],
          dmg: x.championDamageShare ?? null, kp: x.killParticipation ?? null, wards: x.wardsPlaced ?? null,
        };
      }),
    };
  };
  const blue = side(meta.blueTeamMetadata, f.blueTeam, 'blue');
  const red = side(meta.redTeamMetadata, f.redTeam, 'red');
  const out = { state: f.gameState, teams: red.id === kcTeamId ? { kc: red, opp: blue } : { kc: blue, opp: red } };
  if (f.gameState === 'finished') statsCache.set(gameId, out);
  return out;
}

function vodOf(g) {
  const v = VOD_LOCALES.map((l) => g.vods?.find((x) => x.locale === l)).find(Boolean) || g.vods?.[0];
  if (!v) return null;
  const s = Math.floor((v.startMillis || 0) / 1000);
  const id = encodeURIComponent(v.parameter);
  const url = v.provider === 'youtube' ? `https://www.youtube.com/watch?v=${id}&t=${s}s`
    : v.provider === 'twitch' ? `https://www.twitch.tv/videos/${id}?t=${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`
      : null;
  return url && { url, lang: v.locale.slice(0, 2).toUpperCase(), provider: v.provider };
}

// Détail d'un match : VOD + stats de chaque game, et l'id du tournoi (pour l'arbre)
export async function lolMatch(matchId, code) {
  const ev = (await gw('getEventDetails', { id: matchId })).event;
  const teams = ev.match.teams;
  const kcTeam = teams.find((t) => t.code === code) || teams.find((t) => /karmine/i.test(t.name));
  const games = await Promise.all(ev.match.games.filter((g) => g.state !== 'unneeded').map(async (g) => ({
    number: g.number,
    state: g.state, // unstarted | inProgress | completed
    vod: vodOf(g),
    stats: g.state === 'unstarted' ? null : await gameStats(g.id, kcTeam?.id).catch(() => null),
  })));
  return { tournamentId: ev.tournament?.id || null, league: ev.league?.name || '', games };
}

/* ---------- Arbre du tournoi ---------- */
function bTeam(t) {
  const tbd = !t || t.slug === 'tbd' || t.id === '0';
  return { name: tbd ? 'À définir' : t.name, code: tbd ? 'TBD' : t.code, img: tbd ? null : t.image, wins: t?.result?.gameWins ?? null, outcome: t?.result?.outcome || null, kc: !tbd && /karmine/i.test(t.name) };
}

export async function bracket(matchId) {
  const ev = (await gw('getEventDetails', { id: matchId })).event;
  const tId = ev.tournament?.id;
  if (!tId) return null;
  const st = (await gw('getStandings', { tournamentId: tId })).standings?.[0];
  return {
    league: ev.league?.name || '',
    leagueImg: ev.league?.image || null,
    stages: (st?.stages || []).map((s) => ({
      name: s.name,
      slug: s.slug, // play_ins | swiss | knockouts | groups | regular_season | playoffs…
      matches: s.sections.flatMap((sec) => sec.matches).map((m) => ({ id: m.id, state: m.state, teams: m.teams.map(bTeam) })),
    })),
  };
}
