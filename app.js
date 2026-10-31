const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let data = null;
let filter = 'all';
let previous = new Map(); // id -> {status, kc, opp} pour détecter les changements
let firstLoad = true;
let timer;

const notifOn = () => {
  try { return localStorage.getItem('notif') === '1' && Notification.permission === 'granted'; } catch { return false; }
};

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
  const stream = m.stream && !done ? `<a href="${esc(m.stream)}" target="_blank" rel="noopener">Regarder ↗</a>` : '';
  return `
    <article class="card glass ${live ? 'live' : ''}">
      <div class="meta">
        <div class="league">${leagueImg}<span>${esc(m.league)} · ${esc(m.serie || m.tournament)}</span></div>
        ${tag}
      </div>
      <div class="match">${teamHTML(m.kc)}${center}${teamHTML(m.opp)}</div>
      <div class="foot"><span>${esc(m.game)}${m.bestOf ? ' · BO' + m.bestOf : ''}</span>${stream}</div>
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
  renderList($('live'), data.running, '');
  renderList($('upcoming'), data.upcoming, 'Aucun match programmé');
  renderList($('past'), data.past, 'Aucun résultat');
  $('updated').textContent = 'Mis à jour à ' + new Date(data.updatedAt).toLocaleTimeString('fr-FR');
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
  const opts = { body, icon: '/icon.svg', badge: '/icon.svg', tag: title, vibrate: [100, 50, 100] };
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
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-slug]');
  if (!b) return;
  filter = b.dataset.slug;
  render();
});

function updateNotifBtn() {
  $('notifBtn').classList.toggle('on', notifOn());
  $('notifBtn').textContent = notifOn() ? '🔔 Activées' : '🔕 Notifs';
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
