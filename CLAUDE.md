# CLAUDE.md — AéroSim 3D Studio

Guide de référence pour toute contribution (humaine ou IA). **Lire avant de coder.**

> **Règle permanente :** toute modification, ajout ou correction doit être consignée dans
> `CHANGELOG.md` (version/sprint, horodatage, fichiers créés/modifiés/supprimés, détail
> technique, état `vitest` + `npm run build`).

## 1. Stack

TypeScript strict · Vite 5 · React 18 · Three.js r169 · Tailwind CSS 3 · Vitest 2 ·
three-gpu-pathtracer (Hangar/Photo). Aucun moteur physique externe : tout est maison.

## 2. Architecture

```
src/
  physics/     Noyau 6-DDL (tourne dans le Web Worker) : math sans allocation, ISA, RK4,
               aéro, moteurs, train, FCS/FBW, vent, layout du buffer partagé, worker, pont.
  cfd/         Solveur VLM (vortex lattice), dérivées/verdict, lignes de courant, worker CFD,
               vue 3D Soufflerie.
  aircraft/    Fiches des 7 appareils, modèles procéduraux PBR, matériaux, feux, chargeur GLTF.
  cockpit/     Cockpits 3D cliquables (raycast), instruments canvas (PFD/MFD/HUD/analogique),
               check-list Cold & Dark.
  airports/    4 aéroports, terrain analytique, `getSurfaceInfo`, porte-avions, ILS/PAPI/FLOLS.
  world/       Scène de vol : ciel, soleil, CSM, océan, caméras, boucle de rendu.
  clouds/      Nuages volumétriques (raymarch 1/2 ou 1/4 res + upsampling bilatéral + TAA).
  raytracing/  Path tracer progressif, post-process temps réel (SSR/SSAO/bloom/ACES/DRS),
               gestionnaire d'erreurs GLSL et métriques GPU.
  controls/    Mapping clavier (remapping + conflits + localStorage), souris-yoke, Gamepad/HOTAS.
  audio/       Synthèse Web Audio procédurale (piston, turbofan, PC, vent, alarmes, clics).
  replay/      Boîte noire (10 Hz), analyse d'atterrissage ; le replay 3D est piloté par
               `ui/FlightView.tsx`.
  ui/          Composants React « Liquid Glass » (menus, atelier, soufflerie, paramètres...).
```

### Flux de données

```
 React UI ──config──▶ PhysicsBridge ──postMessage(init)──▶ physics.worker (240 Hz RK4)
                           ▲   │ entrées (SAB Float64Array ou postMessage)          │
                           │   └───────────────────────────────────────────────────▶│
                           └──── état (ring buffer SAB ou Float64Array transférés) ◀─┘
 rAF (main) : interpole 2 snapshots → met à jour Object3D pré-alloués → rendu.
```

* `SharedArrayBuffer` utilisé si `crossOriginIsolated` (en-têtes COOP/COEP dans
  `vite.config.ts`), sinon **fallback automatique** `postMessage` avec `Float64Array`
  transférés et recyclés (pool) → zéro allocation en régime établi.
* Le solveur VLM est exécuté dans un worker (`cfd/cfd.worker.ts`) pour la soufflerie, et dans
  le worker physique à l'initialisation du vol (dérivées injectées dans le modèle 6-DDL).

## 3. Repères & conventions

| Repère | Axes |
|---|---|
| Monde (= Three.js) | **X = Est, Y = Haut, Z = Sud** (donc Nord = −Z). Unités SI (m, s, kg, rad). |
| Avion (modèle) | **X = nez (avant), Y = dessus, Z = aile droite.** Origine = pointe du nez (toutes les cotes vers l'arrière sont négatives). |
| Avion (physique) | Mêmes axes, origine = **centre de gravité** (`x_cg` calculé depuis le % MAC). |
| Cap ψ | degrés depuis le Nord, sens horaire → direction monde `(sin ψ, 0, −cos ψ)`. |
| Rotations corps | `p` autour de X (+ = roulis à droite), `q` autour de Z (+ = cabré), `ω_y` autour de Y (+ = nez à gauche). Le lacet « aéronautique » vaut `r = −ω_y`. |
| Coefficients | Dérivées de stabilité en convention aéronautique standard (Cnβ > 0 stable, Clβ < 0 stable, Cmα < 0 stable). Le moment de lacet appliqué au corps est `M_y = −N`. |
| Commandes | Toutes normalisées : profondeur `+1` = cabrer, ailerons `+1` = roulis droit, direction `+1` = nez à droite, gaz `[0,1]`, volets `[0,1]`. |

### Nommage 3D (modèles GLTF externes et procéduraux)

Les nœuds animables **doivent** porter exactement ces noms (préfixe accepté : `xxx_aileron_L`) :

`aileron_L`, `aileron_R`, `elevator_L`, `elevator_R`, `rudder`, `rudder_L`, `rudder_R`,
`canard_L`, `canard_R`, `flap_L`, `flap_R`, `spoiler_L`, `spoiler_R`, `airbrake`,
`gear_front`, `gear_main_L`, `gear_main_R`, `gear_strut_*` (amortisseur), `canopy`, `hook`,
`nozzle_L`, `nozzle_R`, `nozzle`, `afterburner_*`, `fan_*`, `propeller`, `prop_disc`,
`light_nav_L` (rouge), `light_nav_R` (vert), `light_strobe_*`, `light_beacon`, `light_landing`.

Chaque gouverne tourne autour de son axe local **X** (charnière) ; l'angle est piloté par
`aircraft/animator.ts`. Les modèles procéduraux respectent la même convention, ce qui permet
de remplacer n'importe quel appareil par un `.glb` sans toucher au code.

## 4. Invariants physiques (à ne jamais casser)

1. **Pas fixe 240 Hz, RK4** ; quaternion renormalisé après chaque pas ; rien n'utilise
   `Math.random()` dans la dérivée (les rafales sont échantillonnées une fois par pas).
2. **Aucune valeur mockée** : instruments, polaires, Cp, ILS/PAPI/FLOLS, alarmes dérivent
   tous de l'état physique ou du solveur VLM.
3. **Marge statique** : avec x mesuré vers l'arrière en % de MAC, `Cmα = CLα · (x_cg − x_np) / c̄`.
   Si le CG est derrière le foyer → `Cmα > 0` → instable en loi directe (divergence réelle
   observable, testée dans `physics.test.ts`). En code (repère modèle, X vers l'avant) :
   `Cm_cg = Cm_np + CL_wb · (x_np − x_cg)/c̄` (`flightModel.coefficients`).
9. Le train principal est placé automatiquement 6 % MAC derrière la limite arrière de centrage
   (`specs.finalize`) pour éviter le basculement sur la queue.
4. **ISA** : T₀ = 288,15 K, p₀ = 101 325 Pa, ρ₀ = 1,225 kg/m³, L = 0,0065 K/m jusqu'à
   11 km, isotherme 216,65 K jusqu'à 20 km.
5. **Compressibilité** : Prandtl-Glauert `1/√(1−M²)` (M plafonné à 0,95 en subsonique),
   Ackeret `4/√(M²−1)` en supersonique, traînée d'onde de Lock `20 (M − M_crit)⁴`.
6. **Effet de sol McCormick** : `φ = (16h/b)² / (1 + (16h/b)²)` multiplie la traînée induite.
7. **`getSurfaceInfo(x, z, t, out)`** est l'unique source de vérité du sol (hauteur,
   normale, vitesse de surface) — partagée par le worker (collision) et le rendu (maillage).
8. **Zéro allocation** dans les boucles chaudes (`step`, `update` du rendu) : vecteurs et
   quaternions pré-alloués, `Float64Array` réutilisés.

## 5. Commandes

```bash
npm run dev       # serveur Vite (COOP/COEP actifs)
npm test          # vitest (noyau math/physique/VLM/surface)
npm run build     # tsc -b + vite build — doit passer sans erreur
VITE_BASE=/Flight-sim/ npm run build   # build pour GitHub Pages (sous-chemin)
```

**PWA** : `sw.js` est généré au build par le plugin `aerosim-pwa` (`vite.config.ts`) depuis
`pwa/sw-template.js` ; ne pas l'écrire à la main. Toute nouvelle ressource chargée à
l'exécution depuis une autre origine doit être servie en CORS (COEP `require-corp`).

## 6. Plan en 4 sprints

1. **Sprint 1 — Noyau** : CLAUDE.md, CHANGELOG.md, Vite COOP/COEP + fallback postMessage,
   Web Worker physique (ISA, RK4 240 Hz, sol pente/mobile, VLM, FBW), gestionnaire GLSL,
   tests vitest.
2. **Sprint 2 — Soufflerie CFD & UI Liquid Glass** : rendu Cp/streamlines/tourbillons/choc,
   polaires, verdict FLY IT, menus, paramètres, remapping clavier + Gamepad API.
3. **Sprint 3 — Flotte & cockpits** : 7 appareils procéduraux PBR + GLTF, cockpits
   cliquables, PFD/MFD/HUD/ILS/Moving map, 3 modes de départ, panneau Pannes.
4. **Sprint 4 — Monde** : 4 aéroports (LFBO, LFLJ, TFFJ, CVN), nuages volumétriques,
   boîte noire + replay, audio procédural, path tracing, passe d'optimisation, build final.

## 7. Points d'attention

* **F-35 = F-35B STOVL** (demande utilisateur) : `spec.stovl` (soufflante, tuyère 3BSM, roll
  posts). Loi de vol stationnaire « unifiée » dans `flightModel.hoverControl`. Pas de crosse :
  l'appontage du F-35B est vertical ; les tests d'appontage à brins utilisent le Rafale.
* Soufflerie : la palette et le style suivent l'image de référence fournie (`cfd/palette.ts`).
* Les matériaux à anisotropie / iridescence sont proscrits sur les modèles (NaN sans tangentes
  → propagés par le bloom).
* `SceneDepthPass` rend la scène dans une cible dédiée : ne jamais échantillonner une texture de
  profondeur attachée au framebuffer courant (boucle de rétroaction WebGL).
* Le path tracing exige un environnement équirectangulaire en données (`studioEquirect`), pas
  un PMREM.

## 8. Style de code

* Pas de `any` implicite ; préférer des `Float64Array` à layout documenté pour l'état.
* Les fichiers `*.test.ts` vivent à côté du module testé.
* UI : composants `Glass*` de `ui/glass.tsx` uniquement (pas de styles ad hoc).
* Texte UI en français.
