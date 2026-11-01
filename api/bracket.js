// Arbre complet du tournoi LoL d'un match KC (barrages, suisse, phase finale…), via lolesports.
// GET /api/bracket?at=<date ISO du match>&code=<acronyme KC, ex. KC ou KCB>
// Pas d'appel PandaScore : la date et l'acronyme viennent déjà de /api/matches.

import { findMatchId, bracket } from './_lolesports.js';

export default async function handler(req, res) {
  const at = String(req.query?.at || '');
  const code = String(req.query?.code || '').slice(0, 10);
  if (!Date.parse(at)) return res.status(400).json({ error: 'Paramètre at invalide' });
  try {
    const id = await findMatchId(at, code);
    const b = id && (await bracket(id));
    if (!b) return res.status(404).json({ error: 'Tableau introuvable pour ce match' });
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json(b);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
