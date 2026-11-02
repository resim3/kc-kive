// Agenda des matchs KC au format iCalendar (.ics). Source : PandaScore.
// GET /api/calendar               -> flux à s'abonner (matchs à venir + résultats des 30 derniers jours)
// GET /api/calendar?game=<slug>   -> flux limité à un jeu (ex. league-of-legends, valorant, rocket-league)
// GET /api/calendar?id=<match_id> -> un seul match, à ajouter à l'agenda (rappel 15 min avant)

import { token, pd, getTeamIds, normalize } from './_pandascore.js';

const SITE = 'https://kc-live.vercel.app';
const PAST_DAYS = 30;

// Échappement iCalendar (RFC 5545 §3.3.11)
const txt = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Lignes de plus de 75 octets repliées (RFC 5545 §3.1)
function fold(line) {
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function event(m, { alarm }) {
  const start = Date.parse(m.beginAt);
  const hours = Math.max(1, m.bestOf || 1); // ~1 h par game au maximum
  const kc = m.kc?.acronym || 'KC';
  const opp = m.opp?.acronym || 'À définir';
  const done = m.status === 'finished';
  const summary = done
    ? `${m.kcWon ? '✅' : '❌'} ${kc} ${m.kc?.score ?? 0}–${m.opp?.score ?? 0} ${opp} · ${m.game}`
    : m.status === 'canceled' ? `Annulé : ${kc} vs ${opp} · ${m.game}`
      : `🎮 ${kc} vs ${opp} · ${m.game}`;
  const desc = [
    `${m.league}${m.serie || m.tournament ? ' · ' + (m.serie || m.tournament) : ''}${m.bestOf ? ' · BO' + m.bestOf : ''}`,
    m.stream && !done ? `Stream : ${m.stream}` : '',
    `Score en direct : ${SITE}`,
  ].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VEVENT',
    `UID:kc-${m.id}@kc-live.vercel.app`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(start + hours * 3600e3)}`,
    `SUMMARY:${txt(summary)}`,
    `DESCRIPTION:${txt(desc)}`,
    `LOCATION:${txt(m.stream || m.league)}`,
    `URL:${SITE}/`,
    `STATUS:${m.status === 'canceled' ? 'CANCELLED' : 'CONFIRMED'}`,
  ];
  if (alarm && !done) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${txt(`${kc} vs ${opp} dans 15 min`)}`, 'TRIGGER:-PT15M', 'END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}

function ics(events, name) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KC Live//Karmine Corp Score//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${txt(name)}`, 'X-WR-TIMEZONE:Europe/Paris', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ...events.flat(), 'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}

export default async function handler(req, res) {
  if (!token()) return res.status(500).json({ error: 'PANDASCORE_TOKEN manquant dans les variables Vercel' });
  const id = req.query?.id ? Number(req.query.id) : null;
  const game = String(req.query?.game || '').replace(/[^a-z0-9-]/gi, '');
  if (id !== null && (!Number.isInteger(id) || id <= 0)) return res.status(400).json({ error: 'Paramètre id invalide' });

  try {
    const ids = await getTeamIds();
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');

    if (id) {
      const m = normalize(await pd(`/matches/${id}`), ids);
      if (!m.beginAt) return res.status(404).json({ error: 'Match sans date' });
      res.setHeader('Content-Disposition', `attachment; filename="kc-${id}.ics"`);
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).send(ics([event(m, { alarm: true })], `KC vs ${m.opp?.acronym || '?'}`));
    }

    const f = `filter[opponent_id]=${ids.join(',')}`;
    const since = new Date(Date.now() - PAST_DAYS * 86400e3).toISOString();
    const [running, upcoming, past] = await Promise.all([
      pd(`/matches/running?${f}&per_page=10`),
      pd(`/matches/upcoming?${f}&sort=begin_at&per_page=50`),
      pd(`/matches/past?${f}&range[begin_at]=${since},${new Date().toISOString()}&sort=-begin_at&per_page=50`),
    ]);
    const seen = new Set();
    const list = [...running, ...upcoming, ...past]
      .map((m) => normalize(m, ids))
      .filter((m) => m.beginAt && !seen.has(m.id) && seen.add(m.id))
      .filter((m) => !game || m.gameSlug === game);

    res.setHeader('Content-Disposition', 'inline; filename="karmine-corp.ics"');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    const name = game && list[0] ? `Karmine Corp · ${list[0].game}` : 'Karmine Corp';
    res.status(200).send(ics(list.map((m) => event(m, { alarm: true })), name));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
