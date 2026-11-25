# CHANGELOG — AéroSim 3D Studio

Journal de suivi permanent. **Chaque modification doit y être consignée** (version/sprint,
horodatage UTC, fichiers, détail technique, état de vérification).

---

## [0.2.0] — Sprint 2 : soufflerie CFD couplée & UI Liquid Glass — 2026-11-25 10:45 UTC

### Fichiers créés
- `src/cfd/tunnel.ts`, `cfd.worker.ts`, `CfdScene.ts`, `palette.ts`, `tunnel.test.ts`
- `src/controls/bindings.ts`, `gamepad.ts`, `input.ts`, `controls.test.ts`
- `src/replay/blackbox.ts`
- `src/ui/store.ts`, `glass.tsx`, `charts.tsx`, `Settings.tsx`, `WindTunnel.tsx`, `Hangar.tsx`,
  `Planform.tsx`, `MainMenu.tsx`, `FlightSetup.tsx`, `HangarViewport.tsx` (provisoire),
  `FlightView.tsx` (provisoire)

### Fichiers modifiés
- `src/cfd/vlm.ts` : noyau visqueux absolu (Vatistas n=1) pour l'évaluation du champ de vitesse
  (lignes de courant), sans changer le noyau de la résolution.
- `src/index.css` : système « Liquid Glass » (`@layer components`), curseurs, animations ressort.
- `src/ui/App.tsx` : routage des écrans + chargement paresseux de la vue de vol.

### Détail technique
- **Soufflerie « Fly it or Not »** dans un worker dédié (requêtes coalescées) :
  VLM fine (8 panneaux en corde) → ΔCp ; Cp extrados/intrados = Cp d'épaisseur (profil
  mince, corrigé 1/β) ∓ ΔCp/2 ; **Cp\* critique isentropique** → poches supersoniques et
  **onde de choc** placée en fin de poche par bande (hauteur ∝ intensité) ; **cône de Mach**
  (μ = asin 1/M) en supersonique ; **lignes de courant 3D** intégrées en RK2 dans le champ
  induit (maillage grossier) avec graines dédiées aux **tourbillons marginaux** ; charge en
  envergure ; facteur d'Oswald VLM.
- **Polaires** CL-α, CL-CD, L/D, Cm-α calculées par `FlightModel.coefficients` : exactement le
  modèle utilisé en vol (décrochage, compressibilité, traînées).
- **Verdict** Stable / Limite / Instable (marge statique + capacité FBW), réglette CG/foyer,
  dérivées affichées, boutons **FLY IT** / **RETOUR ATELIER**.
- Rendu CFD : fond bleu nuit, colormap Turbo (Cp et |V|/V∞), nœuds lissés par moyenne des
  panneaux adjacents, pas de tone mapping (fidélité colorimétrique), lignes `LineSegments2`
  pointillées animées, peau extrados/intrados à épaisseur NACA, fuselage en Cp newtonien
  modifié (Lees). *Aucune image de référence n'était jointe à la demande : la palette est
  centralisée dans `cfd/palette.ts` pour être recalée dès réception de l'image.*
- **Atelier** : 7 appareils, carburant, charge, centrage (% MAC), envergure, flèche, dièdre,
  aire empennage/canard et dérives (appliqués à la géométrie AVANT le VLM) ; T/W, charge alaire,
  Vs lisse/volets, marge statique, vue en plan d'ingénierie (MAC, CG, foyer, train).
- **UI Apple Liquid Glass** : `backdrop-filter: blur(28px) saturate(180%)`, bordure spéculaire
  1px rgba(255,255,255,.28), reflet supérieur, halo suivant le pointeur, opacité pilotable
  par variables CSS (`--glass-alpha`, `--glass-tint`), micro-animations ressort.
- **Contrôles** : 30 actions remappables (capture de touche, effacement, conflits surlignés,
  sauvegarde localStorage), souris-yoke (sensibilité, zone morte), **Gamepad API** (liste des
  périphériques, apprentissage d'axe par mouvement, inversion, zone morte, courbe expo avec
  aperçu, apprentissage des boutons, gaz bipolaire).
- **Paramètres** : presets qualité (Éco → Cinéma), échelle de rendu jusqu'à 200 %, DPR, DRS +
  cible FPS, CSM, SSAO, SSR, bloom, nuages ½ / ¼ rés., path tracing (rebonds, échantillons),
  FOV, métriques ; météo (vent, rafales, ΔISA, houle, heure : Jour/Golden Hour/Nuit,
  couverture, base) ; audio (5 bus).
- Boîte noire (structure de données + analyse d'atterrissage) préparée pour le Sprint 4.

### Vérification
- `npx vitest run` : **28 tests / 28 réussis** (dont Cp\*, choc transsonique à M=0,88, lignes de
  courant, conflits de mapping, courbes manette).
- `npm run build` : **OK, 0 erreur TypeScript**.
- Contrôle visuel Playwright (Chromium/SwiftShader) : menu, atelier, soufflerie ; COOP/COEP
  vérifiés (`crossOriginIsolated === true` en preview).

---

## [0.1.0] — Sprint 1 : noyau physique, worker, VLM, sol — 2026-11-25 09:50 UTC

### Fichiers créés
- `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `tailwind.config.js`,
  `postcss.config.js`, `index.html`, `.gitignore`
- `CLAUDE.md`, `CHANGELOG.md`
- `src/main.tsx`, `src/index.css`, `src/vite-env.d.ts`, `src/ui/App.tsx` (coquille)
- `src/physics/math.ts`, `isa.ts`, `layout.ts`, `engine.ts`, `wind.ts`, `fcs.ts`,
  `flightModel.ts`, `protocol.ts`, `physics.worker.ts`, `bridge.ts`, `physics.test.ts`
- `src/cfd/vlm.ts`, `derivatives.ts`, `vlm.test.ts`
- `src/aircraft/types.ts`, `specs.ts`, `mods.ts`
- `src/airports/airports.ts`
- `src/raytracing/glDebug.ts`, `glDebug.test.ts`

### Détail technique
- **Vite** : en-têtes `Cross-Origin-Opener-Policy: same-origin` / `Cross-Origin-Embedder-Policy:
  require-corp` (dev + preview + plugin middleware) pour activer `SharedArrayBuffer`.
- **Web Worker physique** (`physics.worker.ts`) : pas fixe **240 Hz**, intégrateur **RK4**,
  rattrapage borné (24 pas). Publication par **anneau SharedArrayBuffer** de 8 snapshots avec
  seqlock (`Atomics`) ; **fallback automatique** `postMessage` + `Float64Array` transférés et
  recyclés par pool (zéro allocation en régime établi). Commandes : mémoire partagée ou message.
- **Pont** (`bridge.ts`) : détection `crossOriginIsolated`, interpolation temporelle de l'état
  (lerp + nlerp quaternion, angles sur le chemin court), aucune allocation par frame.
- **ISA** complète 0–32 km (+ΔISA), Sutherland, CAS compressible (Rayleigh en supersonique),
  altitude-pression.
- **Solveur VLM** (Katz & Plotkin) : fers à cheval, distribution cosinus + cassures exactes,
  normales tournées (vrillage, cambrure NACA 4 chiffres, braquages par Rodrigues),
  **Prandtl-Glauert/Göthert** (x étiré de 1/β), efforts Kutta-Joukowski champ proche, efforts
  par surface. Dérivées : CLα, foyer x_np (+ Munk/Gilruth fuselage), Cmq/CLq (rotation),
  CYβ/Clβ/Cnβ (à α=4°, effet dièdre de flèche), Clp/Cnp, Clr/Cnr, gouvernes par unité de
  commande (profondeur/élevons/canard, ailerons, direction), volets (loi en sinus η=0,65),
  correction d'effet de plaque des dérives (×1,55, DATCOM), Oswald Raymer borné par la VLM.
- **Couplage VLM → vol** : `Cm_cg = Cm_np + CL_wb·(x_np − x_cg)/c̄ + Cmq_cg·q̂ + Cmδe_cg·δe…`
  → un centrage derrière le foyer rend réellement l'avion instable (test dédié).
- **Modèle 6-DDL** : aéro (décrochage sigmoïde → plaque plane, autorotation Clp, buffeting),
  compressibilité (PG, Ackeret, traînée d'onde de Lock `20(M−Mcrit)⁴` bornée, recul du foyer
  supersonique, **Mach tuck**), **effet de sol McCormick**, moteurs (piston Gagg-Ferrar + hélice,
  turbofan à lapse dépendant du BPR, turboréacteur PC, spool 1er ordre, séquence de démarrage,
  TSFC, EGT, poussée vectorielle F-22), train ressort-amortisseur (raideur calculée sur la
  répartition statique, frottement longitudinal/latéral saturé, direction avant asservie à la
  vitesse, freins différentiels, frein de parc), points de structure (crash), **catapulte**
  (ressort-amortisseur sur navette, accélération v²/2L), **brins d'arrêt** (détection de
  franchissement de la crosse, décélération à 95 m), vent Dryden + gradient log + **microburst**,
  voile noir/rouge, GPWS (sink rate, pull up, terrain prédictif 20 s, gear, bank angle), trim
  initial (Newton sur α, Cm = 0, T = D + W sinγ).
- **FCS** : loi directe (DR-400) ; **FBW C\*** par inversion dynamique non linéaire (auto-trim
  n_z intégral, compensation d'inclinaison 33°, protection α, protection d'inclinaison 67°,
  maintien d'inclinaison, coordination de virage + amortisseur de lacet, loi sol) ; loi
  **Alternate** ; pilote automatique HDG/ALT/A-THR.
- **`getSurfaceInfo(ap, x, z, t, out)`** : hauteur, normale, vitesse de surface et nature
  (piste = plan exact par profil linéaire par morceaux, terrain analytique fBm/ridged identique
  rendu/physique, océan, **pont mobile** du porte-avions avec houle tangage/roulis/pilonnement).
- **4 aéroports** (données) : LFBO (14R/32L + 14L/32R, ILS 3°), LFLJ (537 m, 12,5 % → 18,6 %),
  TFFJ (646 m, col de la Tourmente, approche 6°), CVN (pont oblique −9°, 4 brins, 2 catapultes,
  FLOLS 3,5°). ILS géométrique (loc ±2,5° / glide ±0,7° pleine échelle), PAPI, boule FLOLS.
- **7 fiches appareils** (cotes constructeur : F-22, F-35C, Rafale M, A380-800, 787-9,
  DR-400/180 — 14,2 m² — et Global 8000 — 116,5 m², flèche 35,3°, d'après le factsheet
  Bombardier), positionnement automatique du train principal derrière la limite arrière de
  centrage.
- **Gestionnaire GLSL** : `renderer.debug.onShaderError` → extrait de source numéroté autour
  des lignes fautives, perte/restauration de contexte, nom du GPU ; collecteur de métriques
  (FPS, frame time, max, draw calls, triangles, mémoire GPU estimée, temps GPU par
  `EXT_disjoint_timer_query_webgl2`).

### Vérification
- `npx vitest run` : **20 tests / 20 réussis** (VLM vs Helmbold ±6 %, PG, signes des dérivées
  des 7 appareils, foyer, verdict ; ISA OACI ; quaternions ; getSurfaceInfo LFBO/LFLJ/CVN ;
  ILS/PAPI ; finale DR-400 et A380 stables ; 787 immobile au parking ; décollage Rafale ;
  divergence CG arrière ; appontage F-35C avec brin).
- `npm run build` (`tsc -b && vite build`) : **OK, 0 erreur TypeScript**.
