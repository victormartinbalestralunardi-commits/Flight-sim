# AéroSim 3D Studio

Simulateur de vol 3D (TypeScript · Three.js · React) : atelier, soufflerie VLM couplée,
vol 6-DDL à 240 Hz dans un Web Worker, 7 appareils, 4 aéroports.

## Jouer

- **En ligne / installer l'application** : ouvrir l'adresse GitHub Pages du dépôt
  (`https://<utilisateur>.github.io/Flight-sim/`) dans Chrome ou Edge, puis cliquer
  **« Installer l'application »** dans le menu (ou l'icône d'installation de la barre d'adresse).
  Le jeu se lance ensuite depuis le bureau / menu Démarrer, en plein écran, et reste jouable
  **hors ligne**.
- **En local** :

```bash
npm install
npm run dev
```

## Déploiement

- **GitHub Pages** : automatique à chaque push (`.github/workflows/deploy-pages.yml`).
  Activer une fois : *Settings → Pages → Source : GitHub Actions*.
- **Netlify / Cloudflare Pages** : `npm run build`, dossier `dist` (en-têtes dans `public/_headers`).
- **Vercel** : idem (en-têtes dans `vercel.json`).

Le service worker injecte les en-têtes COOP/COEP : la mémoire partagée (SharedArrayBuffer)
fonctionne même sur GitHub Pages ; à défaut, le moteur bascule automatiquement en `postMessage`.

Voir `CLAUDE.md` (architecture) et `CHANGELOG.md` (journal).
