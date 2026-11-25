# CHANGELOG — AéroSim 3D Studio

Journal de suivi permanent. **Chaque modification doit y être consignée** (version/sprint,
horodatage UTC, fichiers, détail technique, état de vérification).

---

## [0.2.1] — Sprint 2 (complément) : F-35B STOVL, couche limite, contraintes, Vmax, style CFD de référence — 2026-11-25 11:40 UTC

Demande utilisateur en cours de sprint : flux laminaires/turbulents, tourbillons, coefficients de
frottement et de portance, zones de contraintes, vitesse max ; F-35 en version à décollage vertical ;
image de référence CFD fournie.

### Fichiers créés
- `src/cfd/boundaryLayer.ts` (couche limite, frottement, contraintes structurelles)

### Fichiers modifiés
- `src/aircraft/types.ts` : `StovlDef`, champ `stovl` d'`AircraftSpec`.
- `src/aircraft/specs.ts` : **F-35C → F-35B** (10,7 m, 42,7 m², F135-PW-600 120/182 kN,
  LiftFan 89 kN, tuyère 3BSM 80 kN, roll posts 2 × 8,7 kN, pas de crosse).
- `src/physics/layout.ts` : entrées `STOVL`, `NOZZLE` ; sorties `STOVL`, `NOZZLE_ANGLE`.
- `src/physics/engine.ts` : facteur d'accélération du régime (mode STOVL).
- `src/physics/flightModel.ts` : efforts STOVL (tuyère pivotante 0→95° avec sortie interpolée,
  soufflante, roll posts, déviation latérale de tuyère), **loi de vol stationnaire unifiée**
  (manche = vitesse de translation par rapport à la surface → assiette/inclinaison, palonnier =
  taux de lacet, levier = vitesse verticale, PC interdite), **portance tourbillonnaire de
  Polhamus** (Kv sin²α cosα, traînée CLv·tanα), contact train/eau = amerrissage (crash).
- `src/cfd/derivatives.ts` : `Kv` (Polhamus) et flèche BA.
- `src/cfd/vlm.ts` : `addFilament` (filament tourbillonnaire à noyau visqueux).
- `src/cfd/tunnel.ts` : couche limite + contraintes + **Vmax** (poussée max = traînée trimée,
  bornée par MMO, courbes T/D), lignes de courant : râteau d'entrée 9 × 13 dans le repère vent,
  **filaments de tourbillons de bord d'attaque** injectés dans le champ, classification
  **laminaire / turbulent (sillages δ ∝ √(c·x), couche limite après transition) / tourbillon /
  décollé**, fluctuations turbulentes déterministes, percentiles de |V| pour l'échelle.
- `src/cfd/CfdScene.ts` (réécrit), `src/cfd/palette.ts` : **style de l'image de référence** —
  fond clair, veine d'essai filaire bleue, graines rouges, tubes de courant ombrés colorés |V|
  en m/s (échelle jet), maquette bleue (adhérence à la paroi), trièdre XYZ, particules animées ;
  cartes de surface **|V|, Cp, Cf, τw, régime de couche limite, cl local, σ/σadm**.
- `src/ui/WindTunnel.tsx` (réécrit) : légendes verticales numérotées, barre d'échelle, onglets
  Verdict / Écoulement / Structure / Perfs, graphe σ(s), courbes poussée/traînée.
- `src/controls/bindings.ts`, `input.ts` : actions `stovlToggle` (Y), `nozzleDown` (.), `nozzleUp` (,).
- `src/airports/airports.ts` : départ STO du F-35B à l'arrière du pont (sans catapulte).
- `src/ui/FlightSetup.tsx`, `src/index.css` (teinte de verre adaptative `--glass-tint-a`).
- Tests : appontage refait avec le Rafale (crosse) + auto-manette ; nouveau test STOVL.

### Équations ajoutées
- Transition : Re_x = ρ V_e x / μ > Re_tr (4·10⁵ bois … 2,5·10⁶ composite lisse) ou minimum de Cp.
- Cf laminaire 0,664/√Re_x ; turbulent 0,0592 Re_x^−0,2 · (1 + 0,144 M²)^−0,65 ; τw = Cf ½ρV_e².
- Fuselage : Cf = 0,455/(log₁₀ Re_L)^2,58, FF = 1 + 60/f³ + f/400.
- Flexion : M(s) = Σ (L_k − n g m_k)(s_k − s) ; σ = M/(h b t_peau) ; flèche ∬ M/(EI).
- Polhamus : CL = Kp sinα cos²α + Kv sin²α cosα.
- Vmax : max M tel que Σ T_max(M, σ) ≥ ½ρV² S CD(α_trim).

### Vérification
- `npx vitest run` : **31 tests / 31 réussis** (dont stationnaire + atterrissage vertical F-35B,
  appontage Rafale, couche limite/contraintes/Vmax du 787, Vmax F-22 > M 1,5, tourbillons Polhamus).
- `npm run build` : **OK, 0 erreur TypeScript**. Contrôle visuel Playwright de la soufflerie.

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
