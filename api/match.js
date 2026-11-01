// GET /api/match?id=<match_id PandaScore> : détail d'un match (voir api/_match.js)

import { token, HttpError } from './_pandascore.js';
import { buildMatch } from './_match.js';

export default async function handler(req, res) {
  if (!token()) return res.status(500).json({ error: 'PANDASCORE_TOKEN manquant dans les variables Vercel' });
  const id = Number(req.query?.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Paramètre id invalide' });

  try {
    const body = await buildMatch(id);
    res.setHeader('Cache-Control', body.status === 'running' ? 's-maxage=30, stale-while-revalidate=30' : 's-maxage=600, stale-while-revalidate=600');
    res.status(200).json(body);
  } catch (e) {
    res.status(e instanceof HttpError && e.status === 404 ? 404 : 502).json({ error: e.message });
  }
}
