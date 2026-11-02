const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');

let target = null; // { match, at }
let ticker = null;

function team(t) {
  if (!t) return '<div><span class="ph">?</span><b>À définir</b></div>';
  const logo = t.img ? `<img src="${esc(t.img)}" alt="">` : `<span class="ph">${esc((t.acronym || '?').slice(0, 3))}</span>`;
  return `<div>${logo}<b>${esc(t.acronym || t.name)}</b></div>`;
}

function renderNext(m) {
  const when = new Date(m.beginAt).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  $('next').innerHTML = `
    <div class="league">${esc(m.league)} · ${esc(m.serie || m.tournament)} · ${esc(m.game)}${m.bestOf ? ' · BO' + m.bestOf : ''}</div>
    <div class="vs">${team(m.kc)}<span class="sep">vs</span>${team(m.opp)}</div>
    <div class="when">${esc(when)}</div>
    <div class="count glass" id="count" aria-live="polite">
      <div class="unit"><b id="d">--</b><span>jours</span></div>
      <div class="unit"><b id="h">--</b><span>heures</span></div>
      <div class="unit"><b id="mi">--</b><span>min</span></div>
      <div class="unit"><b id="s">--</b><span>sec</span></div>
    </div>
    <div class="foot2">
      <a class="cap" href="/api/calendar?id=${m.id}">📅 Ajouter à l’agenda</a>
      ${m.stream ? `<a class="cap accent" href="${esc(m.stream)}" target="_blank" rel="noopener">📺 Regarder</a>` : ''}
    </div>`;
}

function tick() {
  if (!target) return;
  const diff = Date.parse(target.at) - Date.now();
  if (diff <= 0) {
    clearInterval(ticker);
    $('count').outerHTML = '<div class="live">🔴 C’est parti !</div>';
    $('updated').textContent = 'Match commencé';
    return;
  }
  const s = Math.floor(diff / 1000);
  $('d').textContent = Math.floor(s / 86400);
  $('h').textContent = pad(Math.floor((s % 86400) / 3600));
  $('mi').textContent = pad(Math.floor((s % 3600) / 60));
  $('s').textContent = pad(s % 60);
}

function renderNone(msg) {
  $('next').innerHTML = `<div class="empty glass">${esc(msg)}</div><div class="foot2"><a class="cap" href="/saison.html">📊 Saison</a><a class="cap" href="/">← Matchs</a></div>`;
  $('updated').textContent = '';
}

async function load() {
  try {
    const r = await fetch('/api/matches', { cache: 'no-store' });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || r.status);
    const next = json.running?.[0] || json.upcoming?.[0];
    if (!next) return renderNone('Aucun match prévu pour le moment.');
    if (next.status === 'running') {
      target = null;
      $('next').innerHTML = `<div class="live">🔴 En direct maintenant</div><div class="vs">${team(next.kc)}<span class="sep">vs</span>${team(next.opp)}</div><a class="cap accent" href="/">Voir le score</a>`;
      $('updated').textContent = 'En direct';
      return;
    }
    target = { match: next, at: next.beginAt };
    renderNext(next);
    $('updated').textContent = 'Compte à rebours';
    tick();
    clearInterval(ticker);
    ticker = setInterval(tick, 1000);
  } catch (e) {
    $('updated').textContent = 'Indisponible';
    $('next').innerHTML = `<div class="error glass">Erreur : ${esc(e.message)}</div>`;
  }
}

load();
setInterval(() => { if (!document.hidden && (!target || Date.parse(target.at) - Date.now() < -60e3)) load(); }, 60e3);
