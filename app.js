const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let data = null;
let filter = 'all';
let previous = new Map(); // id -> {status, kc, opp} pour détecter les changements
let firstLoad = true;
let timer;
const seen = new Set(); // cartes déjà affichées : l'animation d'entrée ne rejoue pas à chaque actualisation

const notifOn = () => {
  try { return localStorage.getItem('notif') === '1' && Notification.permission === 'granted'; } catch { return false; }
};

/* ---------- Réglages (sauvegardés sur cet appareil) ---------- */
const SETTINGS_DEFAULT = { mode: 'auto', accent: 'kc', size: 'm', motion: 'on', mvp: 'on' };
const SETTINGS_OPTIONS = {
  mode: [['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']],
  accent: [['kc', 'KC'], ['violet', 'Violet'], ['emerald', 'Émeraude'], ['rose', 'Rose']],
  size: [['s', 'Petit'], ['m', 'Normal'], ['l', 'Grand']],
  motion: [['on', 'Oui'], ['off', 'Non']],
  mvp: [['on', 'Oui'], ['off', 'Non']],
};
const SETTINGS_LABEL = { mode: 'Thème', accent: 'Couleur', size: 'Taille du texte', motion: 'Animations', mvp: 'MVP sur les cartes' };
const ACCENT_SWATCH = {
  kc: 'linear-gradient(120deg,#2a6bff,#3fd4ff,#8b5cff)',
  violet: 'linear-gradient(120deg,#6a3dff,#b48cff,#ff6ad5)',
  emerald: 'linear-gradient(120deg,#0fb981,#5ef2c4,#2a8bff)',
  rose: 'linear-gradient(120deg,#ff375f,#ff8fb1,#ffb36b)',
};

let settings = { ...SETTINGS_DEFAULT };
try { settings = { ...SETTINGS_DEFAULT, ...JSON.parse(localStorage.getItem('kc-settings') || '{}') }; } catch {}

function applySettings() {
  const r = document.documentElement;
  for (const k of Object.keys(SETTINGS_DEFAULT)) r.dataset[k] = settings[k];
  if (settings.mode === 'auto') delete r.dataset.mode; // suit le thème du téléphone
}

function saveSettings() {
  try { localStorage.setItem('kc-settings', JSON.stringify(settings)); } catch {}
}

function renderSettings() {
  $('settingsBody').innerHTML = Object.keys(SETTINGS_OPTIONS).map((k) => `
    <div class="setting">
      <div class="slabel">${SETTINGS_LABEL[k]}</div>
      <div class="seg ${k === 'accent' ? 'swatches' : ''}" role="radiogroup" aria-label="${SETTINGS_LABEL[k]}">
        ${SETTINGS_OPTIONS[k].map(([v, label]) => `
          <button type="button" role="radio" aria-checked="${settings[k] === v}" class="${settings[k] === v ? 'on' : ''}" data-set="${k}:${v}">
            ${k === 'accent' ? `<span class="sw" style="background:${ACCENT_SWATCH[v]}"></span>` : ''}<span>${esc(label)}</span>
          </button>`).join('')}
      </div>
    </div>`).join('');
}

$('settingsBtn').addEventListener('click', () => { renderSettings(); $('settings').showModal(); });
$('settings').addEventListener('click', (e) => {
  if (e.target === $('settings') || e.target.closest('[data-close]')) return $('settings').close();
  if (e.target.closest('[data-reset]')) { settings = { ...SETTINGS_DEFAULT }; }
  else {
    const b = e.target.closest('[data-set]');
    if (!b) return;
    const [k, v] = b.dataset.set.split(':');
    settings[k] = v;
  }
  saveSettings(); applySettings(); renderSettings();
});
applySettings();

/* ---------- Rendu ---------- */
function teamHTML(t) {
  if (!t) return '<div class="team"><span class="ph">?</span><b>À définir</b></div>';
  const logo = t.img
    ? `<img src="${esc(t.img)}" alt="" loading="lazy">`
    : `<span class="ph">${esc(t.acronym.slice(0, 3))}</span>`;
  return `<div class="team">${logo}<b>${esc(t.acronym)}</b></div>`;
}

function fmtDate(iso) {
  if (!iso) return { main: 'Date à venir', sub: '' };
  const d = new Date(iso);
  const diff = d - Date.now();
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diff > 0 && diff < 3600e3) return { main: `Dans ${Math.ceil(diff / 60e3)} min`, sub: time };
  const day = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  return { main: time, sub: day };
}

function card(m) {
  const live = m.status === 'running';
  const done = m.status === 'finished';
  let center, tag;
  if (live || done) {
    const k = m.kc?.score ?? 0, o = m.opp?.score ?? 0;
    center = `<div class="score" data-id="${m.id}"><span class="${k > o ? 'lead' : ''}">${k}</span><span class="sep">–</span><span class="${o > k ? 'lead' : ''}">${o}</span></div>`;
  } else {
    const f = fmtDate(m.beginAt);
    center = `<div class="when">${esc(f.main)}<small>${esc(f.sub)}</small></div>`;
  }
  if (live) tag = '<span class="tag live">LIVE</span>';
  else if (done && m.kcWon === true) tag = '<span class="tag win">Victoire</span>';
  else if (done && m.kcWon === false) tag = '<span class="tag loss">Défaite</span>';
  else if (m.status === 'canceled') tag = m.kcWon ? '<span class="tag win">Victoire (forfait)</span>' : '<span class="tag">Annulé</span>';
  else tag = `<span class="tag">${esc(m.game)}</span>`;

  const leagueImg = m.leagueImg ? `<img src="${esc(m.leagueImg)}" alt="" loading="lazy">` : '';
  const stream = m.stream && !done ? `<a class="more" href="${esc(m.stream)}" target="_blank" rel="noopener">📺 Regarder</a>` : '';
  const hasDetails = live || done;
  const open = isOpen(m);
  const toggle = hasDetails ? `<button class="more" type="button" data-toggle="${m.id}" aria-expanded="${open}">${open ? 'Masquer' : 'Scoreboard'} ${open ? '▴' : '▾'}</button>` : '';
  const tree = m.gameSlug === 'league-of-legends' && m.beginAt ? `<button class="more" type="button" data-bracket="${m.id}">🏆 Tableau</button>` : '';
  const recap = done && m.kc && m.opp
    ? `<a class="cap recap" href="https://www.youtube.com/results?search_query=${encodeURIComponent(`${m.kc.acronym} vs ${m.opp.acronym} ${m.league} highlights`)}" target="_blank" rel="noopener">🎬 Récap</a>`
    : '';
  const mvp = done && m.mvp ? `<div class="mvpchip">⭐ MVP ${esc(m.mvp.name)} <small>${m.mvp.k}/${m.mvp.d}/${m.mvp.a}</small></div>` : '';
  const fresh = !seen.has(m.id);
  seen.add(m.id);
  return `
    <article class="card glass ${live ? 'live' : ''} ${fresh ? 'fresh' : ''}">
      <div class="meta">
        <div class="league">${leagueImg}<span>${esc(m.league)} · ${esc(m.serie || m.tournament)}</span></div>
        ${tag}
      </div>
      <div class="match">${teamHTML(m.kc)}${center}${teamHTML(m.opp)}</div>
      ${mvp}
      <div class="foot">${recap || `<span class="gameTag">${esc(m.game)}${m.bestOf ? ' · BO' + m.bestOf : ''}</span>`}<span class="actions">${tree}${toggle}${stream}</span></div>
      ${hasDetails ? `<div class="details" data-details="${m.id}" ${open ? '' : 'hidden'}>${open ? detailHTML(m.id) : ''}</div>` : ''}
    </article>`;
}

function renderList(el, list, emptyMsg) {
  const items = list.filter((m) => filter === 'all' || m.gameSlug === filter);
  el.innerHTML = items.length ? items.map(card).join('') : `<div class="empty glass">${emptyMsg}</div>`;
}

function renderChips() {
  const games = new Map();
  [...data.running, ...data.upcoming, ...data.past].forEach((m) => m.gameSlug && games.set(m.gameSlug, m.game));
  const chips = [['all', 'Tous'], ...games];
  $('chips').innerHTML = chips
    .map(([slug, name]) => `<button class="pill ${slug === filter ? 'on' : ''}" data-slug="${esc(slug)}">${esc(name)}</button>`)
    .join('');
}

function render() {
  renderChips();
  $('liveSection').hidden = !data.running.length;
  $('liveCount').hidden = !data.running.length;
  $('liveCount').querySelector('span').textContent = `${data.running.length} en direct`;
  renderList($('live'), data.running, '');
  renderList($('upcoming'), data.upcoming, 'Aucun match programmé');
  renderList($('past'), data.past, 'Aucun résultat');
  $('updated').textContent = 'Mis à jour à ' + new Date(data.updatedAt).toLocaleTimeString('fr-FR');
  refreshDetails();
}

/* ---------- Scoreboard (compositions + stats par game) ---------- */
const details = new Map(); // id -> { data, at, loading, error, tab }
const userOpened = new Set();
const userClosed = new Set();
const DETAIL_TTL = 60e3; // actualisation toutes les minutes pendant un match

function isOpen(m) {
  if (userClosed.has(m.id)) return false;
  return userOpened.has(m.id) || m.status === 'running'; // ouvert d'office pendant le direct
}

function findMatch(id) {
  return data && [...data.running, ...data.upcoming, ...data.past].find((m) => m.id === id);
}

async function fetchDetail(id) {
  const d = details.get(id) || {};
  if (d.loading) return;
  d.loading = true; details.set(id, d);
  try {
    const r = await fetch('/api/match?id=' + id, { cache: 'no-store' });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || r.status);
    d.data = json; d.error = null;
  } catch (e) {
    d.error = e.message;
  }
  d.at = Date.now(); d.loading = false;
  paintDetail(id);
}

function refreshDetails() {
  if (!data) return;
  for (const m of [...data.running, ...data.past]) {
    if (!isOpen(m)) continue;
    const d = details.get(m.id);
    const stale = !d || (!d.data && !d.loading) || (m.status === 'running' && Date.now() - (d.at || 0) >= DETAIL_TTL - 1000);
    if (stale) fetchDetail(m.id);
  }
}

function paintDetail(id) {
  const el = document.querySelector(`[data-details="${id}"]`);
  if (el && !el.hidden) el.innerHTML = detailHTML(id);
}

const fmtGold = (g) => (g == null ? '–' : g >= 1000 ? (g / 1000).toFixed(1) + 'k' : String(g));
const val = (v) => (v == null ? '–' : v);
const fmtClock = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const ROLE_FR = { top: 'Top', jun: 'Jungle', jungle: 'Jungle', mid: 'Mid', adc: 'ADC', bot: 'ADC', sup: 'Support', support: 'Support' };

const pct = (x) => (x == null ? '' : Math.round(x * 100) + '%');
const DRAKE_FR = { infernal: 'Infernal', mountain: 'Montagne', ocean: 'Océan', cloud: 'Nuage', hextech: 'Hextech', chemtech: 'Chimtech', elder: 'Ancestral' };
const hasStats = (g) => g?.teams && (g.teams.kc?.players?.length || g.teams.opp?.players?.length);

// Onglet affiché : choix de l'utilisateur, sinon la game en direct, sinon le bilan d'un match terminé
function pickedGame(d) {
  const games = d.data.games || [];
  const canSum = games.some((g) => g.stats === 'ok');
  if (d.tab === 'sum' && canSum) return 'sum';
  if (d.tab != null && games[d.tab]) return d.tab;
  let i = games.findIndex((g) => g.status === 'running');
  if (i >= 0) return i;
  if (canSum && d.data.status === 'finished') return 'sum';
  i = games.map((g) => g.stats === 'ok' || g.status === 'finished').lastIndexOf(true);
  return Math.max(0, i);
}

function teamBoard(team, info, label) {
  const logo = info?.img ? `<span class="chip"><img src="${esc(info.img)}" alt="" loading="lazy"></span>` : '';
  const stat = (v, unit) => (v == null || v === '' ? '' : `<span><b>${v}</b> ${unit}</span>`);
  const rows = team.players.map((p) => {
    const sub = p.champs || p.pick?.name || ROLE_FR[String(p.role).toLowerCase()] || p.role || '';
    const kda = p.k != null && p.d != null ? ((p.k + (p.a ?? 0)) / Math.max(1, p.d)).toFixed(1) : null;
    const stats = [stat(p.cs, 'CS'), stat(p.gold == null ? null : fmtGold(p.gold), 'or'), stat(pct(p.dmg), 'dégâts'), stat(pct(p.kp), 'KP'), p.level != null ? `<span>niv. <b>${p.level}</b></span>` : ''].join('');
    const items = p.items?.length ? `<div class="items">${p.items.map((src) => `<img src="${esc(src)}" alt="" loading="lazy">`).join('')}</div>` : '';
    return `
    <div class="row">
      ${p.pick?.img ? `<img class="pick" src="${esc(p.pick.img)}" alt="" title="${esc(p.pick.name)}" loading="lazy">` : '<span class="pick ph"></span>'}
      <div class="who"><b>${esc(p.name)}${p.mvp ? '<span class="mvp">MVP</span>' : ''}</b><small>${esc(sub)}</small></div>
      <div class="kda"><span><b>${val(p.k)}</b>/<b class="d">${val(p.d)}</b>/<b>${val(p.a)}</b></span>${kda ? `<small>KDA ${kda}</small>` : ''}</div>
      ${stats ? `<div class="stats">${stats}</div>` : ''}
      ${items}
    </div>`;
  }).join('');
  const drakeTitle = team.dragons?.length ? ` title="${esc(team.dragons.map((x) => DRAKE_FR[x] || x).join(', '))}"` : '';
  const objs = [
    team.towers != null ? `<span>🏰 ${team.towers} tours</span>` : '',
    team.barons ? `<span>👾 ${team.barons} nashor</span>` : '',
    team.dragons?.length ? `<span${drakeTitle}>🐉 ${team.dragons.length} drake${team.dragons.length > 1 ? 's' : ''}</span>` : '',
    team.gold != null ? `<span>💰 ${fmtGold(team.gold)}</span>` : '',
  ].join('');
  return `
    <div class="board ${label}">
      <div class="bhead">${logo}<b>${esc(info?.acronym || '?')}</b><span class="k">${val(team.kills)}<small> kills</small></span></div>
      ${objs ? `<div class="objs">${objs}</div>` : ''}
      ${rows}
    </div>`;
}

function rosterHTML(info) {
  const list = (info?.roster || []).map((p) => `
    <li>${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
      <div><b>${esc(p.name)}</b><small>${esc(ROLE_FR[String(p.role).toLowerCase()] || p.role || p.realName || '')}</small></div></li>`).join('');
  return `<div class="roster"><h4>${esc(info?.acronym || '?')}</h4><ul>${list || '<li class="none">Composition inconnue</li>'}</ul></div>`;
}

// Liens vidéo d'une game : rediff au bon moment (lolesports) + recherche des temps forts
function videoLinks(md, g) {
  const links = [];
  if (g.vod) links.push(`<a class="cap accent" href="${esc(g.vod.url)}" target="_blank" rel="noopener">▶ Revoir${g.vod.lang && g.vod.lang !== 'FR' ? ' (' + esc(g.vod.lang) + ')' : ''}</a>`);
  if (g.status === 'finished' && md.kc && md.opp) {
    const q = `${md.kc.acronym} vs ${md.opp.acronym} game ${g.position} highlights`;
    links.push(`<a class="cap" href="https://www.youtube.com/results?search_query=${encodeURIComponent(q)}" target="_blank" rel="noopener">✨ Temps forts</a>`);
  }
  return links.length ? `<div class="vlinks">${links.join('')}</div>` : '';
}

// Bilan de la série : totaux par joueur sur toutes les games, MVP = meilleur KDA de l'équipe gagnante
function summaryHTML(md) {
  const done = (md.games || []).filter((g) => g.stats === 'ok' && hasStats(g));
  const agg = (side) => {
    const map = new Map();
    for (const g of done) for (const p of g.teams[side]?.players || []) {
      const a = map.get(p.name) || { name: p.name, role: p.role, k: 0, d: 0, a: 0, cs: 0, gold: 0, picks: [], dmg: [], pick: null };
      a.k += p.k ?? 0; a.d += p.d ?? 0; a.a += p.a ?? 0; a.cs += p.cs ?? 0; a.gold += p.gold ?? 0;
      if (p.pick) { a.picks.push(p.pick.name); a.pick = p.pick; }
      if (p.dmg != null) a.dmg.push(p.dmg);
      map.set(p.name, a);
    }
    const players = [...map.values()].map((a) => ({ ...a, champs: a.picks.join(', '), dmg: a.dmg.length ? a.dmg.reduce((x, y) => x + y, 0) / a.dmg.length : null }));
    return { players, kills: players.reduce((s, p) => s + p.k, 0) };
  };
  const kc = agg('kc'), opp = agg('opp');
  const kcWins = md.games.filter((g) => g.winner === 'kc').length;
  const oppWins = md.games.filter((g) => g.winner === 'opp').length;
  const winner = kcWins > oppWins ? kc : oppWins > kcWins ? opp : null;
  const kdaOf = (p) => (p.k + p.a) / Math.max(1, p.d);
  const mvp = winner?.players.reduce((b, p) => (!b || kdaOf(p) > kdaOf(b) ? p : b), null);
  if (mvp) mvp.mvp = true;

  const list = md.games.filter((g) => g.status === 'finished').map((g) => {
    const res = g.winner === 'kc' ? 'Victoire' : g.winner === 'opp' ? 'Défaite' : '';
    const meta = [hasStats(g) ? `${val(g.teams.kc?.kills)} – ${val(g.teams.opp?.kills)} kills` : '', g.clock ? fmtClock(g.clock) : ''].filter(Boolean).join(' · ');
    return `<div class="gitem ${g.winner === 'kc' ? 'w' : g.winner === 'opp' ? 'l' : ''}">
        <div class="gtop"><b>Game ${g.position}</b><span class="res">${res}</span><span class="gmeta">${meta}</span></div>
        ${videoLinks(md, g)}
      </div>`;
  }).join('');
  const verdict = md.status === 'finished' ? (kcWins > oppWins ? 'Victoire de la KC' : 'Défaite de la KC') : 'Série en cours';
  return `<div class="summary">
      <div class="hero ${kcWins >= oppWins ? 'w' : 'l'}"><span class="verdict">${esc(verdict)}</span><b class="big">${kcWins} – ${oppWins}</b>${mvp ? `<span class="cap">⭐ MVP ${esc(mvp.name)} · ${mvp.k}/${mvp.d}/${mvp.a}</span>` : ''}</div>
      <div class="glist">${list}</div>
    </div>
    ${teamBoard(kc, md.kc, 'kc')}
    ${teamBoard(opp, md.opp, 'opp')}`;
}

function detailHTML(id) {
  const d = details.get(id);
  if (!d || (!d.data && !d.error)) return '<div class="dloading">Chargement du scoreboard…</div>';
  if (!d.data) return `<div class="derror">Scoreboard indisponible : ${esc(d.error)}</div>`;
  const md = d.data;
  const games = md.games || [];
  const gi = pickedGame(d);
  const g = gi === 'sum' ? null : games[gi];

  const sumTab = games.some((x) => x.stats === 'ok') ? `<button class="gtab ${gi === 'sum' ? 'on' : ''}" data-tab="${id}:sum" type="button">Bilan</button>` : '';
  const tabs = games.length > 1 || sumTab ? `<div class="gtabs">${sumTab}${games.map((x, i) => {
    const mark = x.status === 'running' ? '<span class="dot"></span>' : x.winner === 'kc' ? '✓' : x.winner === 'opp' ? '✗' : '';
    return `<button class="gtab ${i === gi ? 'on' : ''} ${x.winner || ''}" data-tab="${id}:${i}" type="button">Game ${x.position}${mark ? ' ' + mark : ''}</button>`;
  }).join('')}</div>` : '';

  let body;
  if (gi === 'sum') body = summaryHTML(md);
  else if (hasStats(g)) {
    const clock = g.clock != null ? `<span>${g.stats === 'live' ? '⏱ ' : 'Durée '}${fmtClock(g.clock)}</span>` : '';
    body = `<div class="ghead">${g.stats === 'live' ? '<span class="tag live">LIVE</span>' : ''}${clock}${videoLinks(md, g)}</div>
      ${teamBoard(g.teams.kc || { players: [] }, md.kc, 'kc')}
      ${teamBoard(g.teams.opp || { players: [] }, md.opp, 'opp')}`;
  } else {
    let note = '';
    if (g?.stats === 'locked') note = 'Stats des joueurs non incluses dans ton offre PandaScore. Voici les compositions.';
    else if (!g || g.status === 'not_started') note = 'La game n’a pas encore commencé. Compositions :';
    else note = 'Stats pas encore disponibles pour cette game. Compositions :';
    body = `${g ? `<div class="ghead">${videoLinks(md, g)}</div>` : ''}<p class="note">${note}</p><div class="rosters">${rosterHTML(md.kc)}${rosterHTML(md.opp)}</div>`;
  }

  const m = findMatch(id);
  const upd = d.at ? `Actualisé à ${new Date(d.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}${m?.status === 'running' ? ' · toutes les minutes' : ''}` : '';
  const src = md.source === 'lolesports' ? ' · stats lolesports' : '';
  const err = d.error ? ` · ⚠️ ${esc(d.error)}` : '';
  return `${tabs}${body}<div class="dfoot">${upd}${src}${err}</div>`;
}

/* ---------- Tableau du tournoi (LoL, via lolesports) ---------- */
const brackets = new Map(); // "date|code" -> promesse

function bTeamHTML(t) {
  const logo = t.img ? `<img src="${esc(t.img)}" alt="" loading="lazy">` : '<span class="ph"></span>';
  return `<div class="bt ${t.outcome || ''} ${t.kc ? 'kc' : ''}">${logo}<b>${esc(t.code)}</b><span>${t.wins ?? ''}</span></div>`;
}
const bMatchHTML = (m) => `<div class="bm ${esc(m.state)}">${m.teams.map(bTeamHTML).join('')}</div>`;
const ROUND_FR = { 2: 'Demi-finales', 4: 'Quarts', 8: 'Huitièmes' };

// Élimination directe : finale au milieu, les deux moitiés du tableau en miroir.
// shortcut: suppose l'ordre lolesports tour par tour (quarts, demies, finale) car previousMatchIds est vide ;
// un tableau qui n'a pas 2^n-1 matchs (double élimination, petite finale) s'affiche en simple liste.
function knockoutHTML(matches) {
  let n = (matches.length + 1) / 2;
  if (!Number.isInteger(Math.log2(n))) return `<div class="blist">${matches.map(bMatchHTML).join('')}</div>`;
  const rounds = [];
  for (let i = 0; n >= 1; n /= 2) { rounds.push(matches.slice(i, i + n)); i += n; }
  const final = rounds.pop()[0];
  const col = (r, half) => `<div class="bcol"><h5>${ROUND_FR[r.length] || ''}</h5>${half.map(bMatchHTML).join('')}</div>`;
  const left = rounds.map((r) => col(r, r.slice(0, r.length / 2)));
  const right = rounds.map((r) => col(r, r.slice(r.length / 2))).reverse();
  return `<div class="tree">${left.join('')}<div class="bcol final"><h5>Finale</h5>${bMatchHTML(final)}</div>${right.join('')}</div>`;
}

// Système suisse / poules : bilan victoires-défaites calculé depuis les résultats
function recordHTML(matches) {
  const rec = new Map();
  for (const m of matches) for (const t of m.teams) {
    if (t.code === 'TBD' || !t.outcome) continue;
    const r = rec.get(t.code) || { t, w: 0, l: 0 };
    if (t.outcome === 'win') r.w++; else if (t.outcome === 'loss') r.l++;
    rec.set(t.code, r);
  }
  const rows = [...rec.values()].sort((a, b) => b.w - a.w || a.l - b.l)
    .map((r) => `<li class="${r.t.kc ? 'kc' : ''}">${r.t.img ? `<img src="${esc(r.t.img)}" alt="" loading="lazy">` : '<span></span>'}<b>${esc(r.t.code)}</b><span>${r.w} – ${r.l}</span></li>`).join('');
  return `<ul class="records">${rows}</ul>`;
}

function stageHTML(s) {
  const body = s.slug === 'knockouts' || s.slug === 'playoffs' ? knockoutHTML(s.matches)
    : /swiss|group|regular/i.test(s.slug) ? recordHTML(s.matches)
      : `<div class="blist">${s.matches.map(bMatchHTML).join('')}</div>`;
  return `<section class="stage"><h4>${esc(s.name)}</h4>${body}</section>`;
}

async function openBracket(id) {
  const m = findMatch(id);
  if (!m) return;
  $('bracketTitle').textContent = m.league || 'Tableau';
  $('bracketBody').innerHTML = '<div class="dloading">Chargement du tableau…</div>';
  $('bracket').showModal();
  const key = m.beginAt + '|' + (m.kc?.acronym || '');
  if (!brackets.has(key)) {
    brackets.set(key, fetch(`/api/bracket?at=${encodeURIComponent(m.beginAt)}&code=${encodeURIComponent(m.kc?.acronym || '')}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; }));
  }
  try {
    const b = await brackets.get(key);
    $('bracketTitle').textContent = b.league || m.league;
    // Phase finale en premier : c'est ce qu'on veut voir
    $('bracketBody').innerHTML = [...b.stages].reverse().map(stageHTML).join('') || '<p class="note">Tableau vide</p>';
  } catch (e) {
    brackets.delete(key);
    $('bracketBody').innerHTML = `<div class="derror">Tableau indisponible : ${esc(e.message)}</div>`;
  }
}

/* ---------- Détection des changements + notifs ---------- */
function vs(m) { return `KC ${m.kc?.score ?? 0} – ${m.opp?.score ?? 0} ${m.opp?.acronym ?? '?'}`; }

function detectChanges() {
  const all = [...data.running, ...data.upcoming, ...data.past];
  for (const m of all) {
    const p = previous.get(m.id);
    if (p && !firstLoad) {
      if (p.status === 'not_started' && m.status === 'running') {
        notify(`🔵 C'est parti ! KC vs ${m.opp?.name ?? '?'}`, `${m.game} · ${m.league}`);
      } else if (m.status === 'running' && (p.kc !== m.kc?.score || p.opp !== m.opp?.score)) {
        notify(`⚡ ${vs(m)}`, `${m.game} · ${m.league}`);
        flash(m.id);
      } else if (p.status === 'running' && m.status === 'finished') {
        notify(m.kcWon ? `🏆 VICTOIRE ! ${vs(m)}` : `Défaite… ${vs(m)}`, `${m.game} · ${m.league}`);
      }
    }
    previous.set(m.id, { status: m.status, kc: m.kc?.score, opp: m.opp?.score });
  }
  firstLoad = false;
}

function flash(id) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`.score[data-id="${id}"]`);
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  });
}

async function notify(title, body) {
  toast(title);
  if (!notifOn()) return;
  const reg = await navigator.serviceWorker?.getRegistration();
  const opts = { body, icon: '/icon-192.png', badge: '/icon.svg', tag: title, vibrate: [100, 50, 100] };
  if (reg) reg.showNotification(title, opts); else new Notification(title, opts);
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 4000);
}

/* ---------- Chargement (polling adaptatif) ---------- */
async function load() {
  try {
    const r = await fetch('/api/matches', { cache: 'no-store' });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || r.status);
    data = json;
    detectChanges();
    render();
  } catch (e) {
    if (!data) $('upcoming').innerHTML = `<div class="error glass">Erreur : ${esc(e.message)}</div>`;
    $('updated').textContent = 'Hors ligne · nouvel essai bientôt';
  }
  clearTimeout(timer);
  // 15 s pendant un match, 60 s sinon
  timer = setTimeout(load, data?.running?.length ? 15000 : 60000);
}

/* ---------- UI ---------- */
document.querySelector('main').addEventListener('click', (e) => {
  const t = e.target.closest('[data-toggle]');
  if (t) {
    const id = Number(t.dataset.toggle);
    const m = findMatch(id);
    if (!m) return;
    if (isOpen(m)) { userClosed.add(id); userOpened.delete(id); }
    else { userOpened.add(id); userClosed.delete(id); }
    render();
    return;
  }
  const b = e.target.closest('[data-bracket]');
  if (b) { openBracket(Number(b.dataset.bracket)); return; }
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    const [id, i] = tab.dataset.tab.split(':');
    const d = details.get(Number(id));
    if (d) { d.tab = i === 'sum' ? 'sum' : Number(i); paintDetail(Number(id)); }
  }
});

// Fermeture du tableau : bouton ou clic à côté
$('bracket').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === $('bracket')) $('bracket').close();
});

// Actualise les scoreboards ouverts toutes les minutes, même entre deux chargements de la liste
setInterval(() => { if (!document.hidden) refreshDetails(); }, 15e3);

$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-slug]');
  if (!b) return;
  filter = b.dataset.slug;
  render();
});

function updateNotifBtn() {
  $('notifBtn').classList.toggle('on', notifOn());
  $('notifBtn').textContent = notifOn() ? '🔔' : '🔕';
  $('notifBtn').title = notifOn() ? 'Notifications activées' : 'Activer les notifications';
}

$('notifBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) return toast('Notifications non supportées (sur iPhone : ajoute l’app à l’écran d’accueil)');
  if (notifOn()) { try { localStorage.setItem('notif', '0'); } catch {} }
  else {
    const p = await Notification.requestPermission();
    if (p !== 'granted') return toast('Permission refusée');
    try { localStorage.setItem('notif', '1'); } catch {}
    notify('✅ Notifications activées', 'Tu seras prévenu des matchs de la KC');
  }
  updateNotifBtn();
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
$('upcoming').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
updateNotifBtn();
load();

// Bonjour <nom> : le web ne donne pas le nom de l'appareil, on le demande au 1er lancement
let asked = false; // une seule demande par ouverture (Échap ou stockage bloqué ne doivent pas boucler)
function showHello() {
  let name = ''; try { name = localStorage.getItem('kc-name') || ''; } catch {}
  $('hello').textContent = 'Bonjour ' + name; $('hello').hidden = !name;
  if (!name && !asked) { asked = true; $('nameDlg').showModal(); }
}
$('nameDlg').addEventListener('close', () => {
  const v = $('nameInput').value.trim();
  if (v) try { localStorage.setItem('kc-name', v); } catch {}
  showHello();
});
$('hello').addEventListener('click', () => { $('nameInput').value = $('hello').textContent.slice(8); $('nameDlg').showModal(); });
showHello();
