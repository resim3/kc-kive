const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthOf = (iso) => { const d = new Date(iso); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const dayOf = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

function render(d) {
  $('updated').textContent = `${d.matches.length} matchs terminés`;
  $('stats').innerHTML = `
    <div class="stat glass"><b>${d.record.wins} – ${d.record.losses}</b><span>Bilan</span></div>
    <div class="stat glass"><b>${d.bestWinStreak}</b><span>Plus longue série de victoires</span></div>
    <div class="stat glass"><b>${d.worstLossStreak}</b><span>Plus longue série de défaites</span></div>`;

  let html = '';
  let lastMonth = '';
  // Plus récent en haut, une frise par mois
  for (const m of [...d.matches].reverse()) {
    const mon = monthOf(m.beginAt);
    if (mon !== lastMonth) {
      if (lastMonth) html += '</div>';
      html += `<div class="month">${esc(mon)}</div><div class="frise">`;
      lastMonth = mon;
    }
    const hot = Math.abs(m.streak) >= 3 ? `<span class="flame">${m.streak > 0 ? '🔥' : '🧊'} ${Math.abs(m.streak)}</span>` : '';
    html += `
      <div class="ev glass ${m.kcWon ? 'w' : 'l'}">
        ${m.opp?.img ? `<img src="${esc(m.opp.img)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
        <div class="info">
          <b>${m.kcWon ? 'Victoire' : 'Défaite'} vs ${esc(m.opp?.acronym || '?')}</b>
          <small>${esc(dayOf(m.beginAt))} · ${esc(m.game)} · ${esc(m.league)}</small>
        </div>
        ${hot}
        <span class="score">${m.kcScore}–${m.oppScore}</span>
      </div>`;
  }
  if (lastMonth) html += '</div>';
  $('timeline').innerHTML = html || '<p class="note">Aucun match terminé pour l’instant.</p>';
}

async function load() {
  try {
    const r = await fetch('/api/saison', { cache: 'no-store' });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || r.status);
    render(json);
  } catch (e) {
    $('updated').textContent = 'Indisponible';
    $('timeline').innerHTML = `<div class="error glass">Erreur : ${esc(e.message)}</div>`;
  }
}

load();
