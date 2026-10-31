# KC Live

Suivi en temps réel des matchs de la **Karmine Corp** (LoL, Valorant, Rocket League), avec une interface façon « verre dépoli » Apple et des notifications (PWA).

En ligne : https://kc-live.vercel.app

## Structure
- `index.html`, `style.css`, `app.js` : l'interface
- `api/matches.js` : fonction serverless Vercel, proxy vers l'API PandaScore
- `sw.js`, `manifest.json`, `icon.svg` : installation sur l'écran d'accueil + notifications

## Configuration
Variable d'environnement à définir sur Vercel (jamais dans le code) :
- `PANDASCORE_TOKEN` : ton token PandaScore

## Déploiement
```
vercel --prod
```
