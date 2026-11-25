# Prompt de recréation — AéroSim 3D Studio

> À coller tel quel dans Claude Code (ou un autre assistant de code), dans un dossier vide.
> Il décrit l'état final du projet, y compris les corrections apprises en cours de route.

---

Tu es un ingénieur logiciel senior spécialisé en simulation aéronautique, physique temps réel,
rendu 3D (Three.js / WebGL2) et design d'interface. Crée **AéroSim 3D Studio**, un simulateur de
vol 3D web complet, en **TypeScript strict + Vite + React + Three.js + Tailwind CSS**, installable
en application (PWA). Tout le texte de l'interface est en **français**.

## 0. Règles de travail

1. Avant de coder, crée `CLAUDE.md` (architecture, conventions de repères et de nommage 3D,
   invariants physiques, plan des sprints, points d'attention) et `CHANGELOG.md`.
2. **À chaque modification**, ajoute une entrée au `CHANGELOG.md` : version, horodatage UTC,
   fichiers créés/modifiés/supprimés, détail technique (équations, corrections), état de
   `vitest` et de `npm run build`.
3. Travaille en **4 sprints** (§ 12), commit à la fin de chacun. `npm run build`
   (`tsc -b && vite build`) doit passer **sans aucune erreur TypeScript**.
4. Aucune valeur « mockée » : instruments, polaires, cartes CFD, ILS/PAPI/FLOLS, alarmes
   dérivent tous de la physique ou du solveur.
5. Vérifie visuellement avec Playwright (captures) les écrans principaux.

## 1. Stack (versions exactes)

`react@18.3.1`, `react-dom@18.3.1`, `three@0.169.0`, `three-gpu-pathtracer@0.0.23`,
`three-mesh-bvh@0.8.3` ; dev : `typescript@5.6.3`, `vite@5.4.21`, `vitest@2.1.9`,
`@vitejs/plugin-react@4.3.4`, `@types/react@18.3.12`, `@types/react-dom@18.3.1`,
`@types/three@0.169.0`, `@types/node@22.9.0`, `tailwindcss@3.4.19`, `postcss@8.4.49`,
`autoprefixer@10.4.20`. Scripts : `dev`, `build`, `preview`, `test` (`vitest run`).

## 2. Architecture

```
src/physics/   math sans allocation, ISA, layout des buffers, moteurs, vent, FCS, modèle 6-DDL,
               worker physique, pont main⇄worker, protocole
src/cfd/       solveur VLM, dérivées, couche limite & contraintes, soufflerie (calcul + worker),
               scène 3D CFD, palette
src/aircraft/  types, fiches des 7 avions, ajustements géométriques, matériaux, livrées,
               modèles procéduraux, animateur, chargeur GLTF
src/cockpit/   cockpit 3D cliquable, instruments canvas, HUD, check-list
src/airports/  données + getSurfaceInfo (pur), construction 3D aéroports, porte-avions 3D
src/world/     scène de vol, champ de feux instancié
src/clouds/    nuages volumétriques
src/raytracing/ gestionnaire GLSL + métriques, path tracer
src/controls/  mapping clavier, manette, agrégateur d'entrées
src/audio/     synthèse Web Audio
src/replay/    boîte noire
src/ui/        React « Liquid Glass » (store, composants, écrans)
src/pwa.ts     service worker + installation ; pwa/sw-template.js
```

## 3. Repères et conventions (impératifs)

- **Monde** = Three.js : X Est, Y Haut, Z Sud (Nord = −Z). SI partout.
- **Cap ψ** (degrés vrais depuis le Nord, horaire) → direction `(sin ψ, 0, −cos ψ)`.
- **Avion (modèle)** : X vers le nez, Y dessus, Z aile droite, origine à la **pointe du nez**
  (cotes arrière négatives). **Physique** : mêmes axes, origine au **CG**.
- Rotations corps : `p` autour de X (+ roulis droite), `q` autour de Z (+ cabré), `ω_y` autour
  de Y (+ nez à gauche) ; lacet aéro `r = −ω_y` ; moment de lacet appliqué `M_y = −N`.
- Dérivées en convention aéro standard (Cnβ>0, Clβ<0, Cmα<0 = stable). Commandes normalisées :
  profondeur +1 = cabrer, ailerons +1 = roulis droit, direction +1 = nez à droite.
- Quaternion corps→monde `[x,y,z,w]`. Cap/assiette/inclinaison : lacet (axe Y monde, angle
  π/2−ψ) puis tangage (Z corps) puis roulis (X corps) ; ordre Euler Three `YZX`.
- **Nommage des nœuds 3D** (procédural ET .glb) : `aileron_L/R`, `elevator_L/R`, `rudder`,
  `rudder_L/R`, `canard_L/R`, `flap_L/R`, `spoiler_L/R`, `gear_front`, `gear_main_L/R`,
  `gear_strut_*`, `canopy`, `hook`, `nozzle(_L/_R)`, `afterburner_*`, `fan_*`, `propeller`,
  `prop_disc`, `light_nav_L` (rouge), `light_nav_R` (vert), `light_strobe_*`, `light_beacon_*`,
  `light_landing`. Chaque gouverne tourne autour de son **X local** (charnière).

## 4. Architecture d'exécution

- **Web Worker physique** : pas fixe **240 Hz**, intégrateur **RK4**, rattrapage borné (24 pas),
  quaternion renormalisé. Publication d'un **anneau `SharedArrayBuffer`** de 8 snapshots
  (seqlock `Atomics`). **Fallback automatique** si pas d'isolation : `postMessage` de
  `Float64Array` transférés et recyclés par pool. Commandes : mémoire partagée ou message.
- En-têtes **COOP/COEP/CORP** dans `vite.config.ts` (dev, preview, plugin middleware).
- Le thread principal **interpole** deux snapshots (lerp + nlerp quaternion, angles sur le
  chemin court) ; zéro allocation dans les boucles chaudes (vecteurs pré-alloués).
- Layout `Float64Array` documenté : entrées (manche, gaz, volets, train, freins, frein de
  parc, crosse, trim, loi FBW, PA HDG/ALT/A-THR + consignes, feux, batterie, APU, pompes,
  démarrage moteurs, avionique, catapulte, pause, spoilers armés, échelle de temps, pannes
  moteur/FBW, wind shear, coupure carburant, STOVL, tuyère) et sorties (~116 valeurs : état,
  α/β, TAS/CAS/Mach, facteurs de charge, altitude/hauteur radio, attitude, N1/N2/EGT/FF par
  moteur, carburant, masse, gouvernes, train et compressions, alarmes, loi FCS, crash, brin,
  catapulte (état, course et vitesse de navette, index), câble déroulé, vent, voile noir/rouge,
  CL/CD, pression dynamique, pose du porte-avions, feux, flexion d'aile, STOVL, tuyère…).

## 5. Physique

- **ISA** 0–32 km (+ΔISA), Sutherland, CAS compressible (Rayleigh en supersonique).
- **Aéro** : CL linéaire (dérivées VLM) × effet de sol, **décrochage** sigmoïde vers plaque
  plane, **portance tourbillonnaire de Polhamus** `Kv sin²α cosα` pour les ailes très en flèche
  (indispensable pour que le Rafale approche à α réaliste), traînée `CD0 + train + volets +
  aérofreins + spoilers + K(CL−CLv)² + |CLv tanα| + onde + décrochage + β²`, **Prandtl-Glauert**
  (M plafonné 0,92) / **Ackeret** `4/√(M²−1)`, **traînée d'onde de Lock** `20(M−Mcrit)⁴` bornée,
  recul du foyer supersonique, **Mach tuck**, **effet de sol McCormick**
  `φ=(16h/b)²/(1+(16h/b)²)`, autorotation (Clp inversé au décrochage), buffeting.
- **Moment de tangage au CG** : `Cm_cg = Cm_np + CmFlap·f + CL_wb·(x_np − x_cg)/c̄ + Cmq_cg·q̂ +
  Cmδe_cg·δe + …` → un CG derrière le foyer rend réellement l'avion instable (test).
- **Moteurs** : piston (Gagg-Ferrar, hélice `T = 0,8P/√(V²+32²)`), turbofan (lapse selon BPR),
  turboréacteur PC (lapses sec/PC selon Mach), régime 1er ordre, séquence de démarrage
  (démarreur → allumage → ralenti, exige batterie + pompes + APU/JFS), TSFC, EGT, poussée
  vectorielle F-22 ±20°, cran PC au-delà de 95 % du levier.
- **Train** ressort-amortisseur (raideur sur la répartition statique, compression 45 %),
  frottement longitudinal/latéral saturé, direction avant asservie à la vitesse, freins
  différentiels, frein de parc. **Points de structure** (nez, queue, saumons, ventre, dérive,
  nacelles) → crash. Crash aussi si : taux de chute > 1,7 × admissible, train non verrouillé,
  n > 1,5 × limite, contact eau (train ou structure), impact sous le pont du navire.
- **Placement automatique du train principal** 6 % MAC derrière la limite arrière de centrage
  (sinon les liners basculent sur la queue).
- **Vent** : log-profil, turbulence Dryden (bruit déterministe), **microburst** déclenchable.
- **FCS** : loi directe (DR-400) ; **FBW C\*** par inversion dynamique non linéaire (auto-trim
  n_z intégral, compensation d'inclinaison 33°, protection α, protection d'inclinaison 67° pour
  liners/bizjet, maintien d'inclinaison, coordination + amortisseur de lacet, loi sol) ; loi
  Alternate ; pilote auto HDG/ALT/A-THR ; poussée vectorielle en complément à basse pression.
- **STOVL F-35B** : soufflante (89 kN), tuyère 3BSM 0→95° à sortie interpolée (80 kN), roll
  posts (2 × 8,7 kN), répartitions modulées pour le contrôle ; **loi « unifiée »** : manche =
  vitesse de translation par rapport à la surface (gains 0,022 rad/(m/s), intégrateurs lents,
  sinon oscillation), palonnier = taux de lacet, levier = vitesse verticale (±6,5 m/s), PC
  interdite, régime ×3 plus vif.
- **Catapulte** : retenue tant que gaz < 85 %, navette ressort-amortisseur, accélération
  `v²/2L` vers V_R. **Brins d'arrêt** : détection de franchissement par la crosse
  (hauteur < 0,6 m, latéral < demi-longueur), décélération pour arrêt en ~95 m.
- **Trim initial** (finale) : Newton sur α (pente estimée sur **0,05°**, pas un plancher
  absolu), Cm=0, T=D+W sinγ ; **TAS = V_app(CAS)/√σ** (altiports).
- Facteurs physiologiques (voile noir/rouge), GPWS (sink rate, pull up, too low gear, bank
  angle, terrain prédictif 20 s), avertisseur de décrochage.

## 6. Solveur VLM (soufflerie couplée « Fly it or Not »)

- Fers à cheval (Katz & Plotkin) : segment lié au 1/4 du panneau, point de contrôle au 3/4,
  jambes libres sur 40 envergures ; distribution cosinus + cassures exactes ; normales tournées
  (vrillage, cambrure NACA 4 chiffres, braquages par Rodrigues) ; **Göthert** (x étiré de 1/β) ;
  efforts Kutta-Joukowski champ proche et par surface ; élimination de Gauss pivotée.
- **Dérivées** : CLα, foyer (+ Munk/Gilruth fuselage, facteur `munk` 0,45–0,5 pour les corps
  porteurs de chasseurs), Cmq/CLq, CYβ/Clβ/Cnβ **à α = 4°** (effet dièdre de flèche), Clp/Cnp,
  Clr/Cnr, gouvernes **par unité de commande** (profondeur/élevons/canard, ailerons, direction),
  volets (loi en sinus η=0,65), **effet de plaque des dérives ×1,55**, Cnβ fuselage DATCOM,
  Oswald Raymer borné par la VLM, Kv Polhamus. Verdict Stable/Limite/Instable (FBW tolère −8 %).
- **Soufflerie** (worker dédié, requêtes coalescées) : Cp extrados/intrados (épaisseur ∓ ΔCp/2,
  1/β), **Cp\*** et onde de choc en fin de poche supersonique, cône de Mach, **couche limite**
  (V_e = V√(1−Cp), Re_x, transition par Re critique ou minimum de pression, **Cf Blasius /
  0,0592 Re^−0,2** corrigé compressible, τw, décollement si cl local > 0,9 cl_max, fuselage
  Schlichting + facteur de forme), **contraintes de flexion** (M(s) avec soulagement inertiel,
  caisson h=0,85t b=0,45c, peaux dimensionnées à 1,5·n_max·MTOW elliptique, matériaux Al/CFRP/
  Al-Li/épicéa, coefficient de sécurité, flèche ∬M/EI), **Vmax** (poussée max = traînée trimée,
  bornée par MMO, courbes T/D), **lignes de courant** RK2 dans le champ induit (noyau Vatistas
  absolu), râteau 9 × 13 dans le repère vent + nappes d'aile + anneaux de saumon, **filaments de
  tourbillons de bord d'attaque** injectés au-delà de α=5°, classification **laminaire /
  turbulent / tourbillon / décollé** avec fluctuations déterministes, polaires CL-α, CL-CD,
  L/D, Cm-α calculées par **la même fonction que le modèle de vol**.
- **Style visuel** : fond clair gris-bleu, veine en boîte filaire bleue, graines rouges, **tubes
  de courant** ombrés colorés par |V| en m/s (échelle **jet**, bornes percentiles 1–99 %),
  trièdre XYZ, particules animées, légendes verticales numérotées, barre d'échelle. La
  **vraie maquette 3D** (modèle procédural) est colorée par la carte choisie (|V| paroi, Cp, Cf,
  τw, régime, cl local, σ/σadm) : chaque sommet → panneau VLM le plus proche (extrados/intrados
  selon la normale), le reste en Cp newtonien modifié. Éclairage `RoomEnvironment`, ombre douce
  (ShadowMaterial), pas de tone mapping (fidélité des couleurs).

## 7. Les 7 appareils (fiches + modèles)

Données constructeur ; géométries internes reconstruites pour respecter surface, envergure,
flèche, dièdre. Surfaces portantes décrites par **stations** (BA x,y,z, corde, vrillage),
utilisées à la fois par la VLM et le modèle 3D.

| Appareil | L × b (m) | S (m²) | Points clés |
|---|---|---|---|
| F-22 | 18,92 × 13,56 | 78,04 | BA 42°, BF −17°, anhédre 3,25°, dérives inclinées 28°, 2×F119 116/156 kN, tuyères 2D ±20° |
| **F-35B** | 15,6 × 10,7 | 42,7 | STOVL, emplanture BA −6,7 m, CG 18 % MAC, F135-600 120/182 kN, **pas de crosse** |
| Rafale M | 15,27 × 10,9 | 45,7 | delta 48°, canards, élevons, 2×M88-2 50/75 kN, crosse |
| A380-800 | 72,72 × 79,75 | 845 | cassure, dièdre 5,6°, 4×Trent 970 311 kN, winglets |
| 787-9 | 62,81 × 60,12 | 360,5 | aile très flexible, chevrons, 2×GEnx 330 kN |
| DR-400/180 | 6,96 × 8,72 | 14,2 | aile Jodel (dièdre externe ~14°), O-360 180 ch, hélice Ø1,83, loi directe |
| Global 8000 | 33,8 × 31,7 | 116,5 | flèche 35,3°, empennage en T, 2×Passport 84 kN, Mmo 0,94 |

**Modèles procéduraux PBR** : fuselage superellipse lofté (≥ 96 × 40 segments, UV, couture de
normales lissée ; F-22 facetté), surfaces lofées (NACA), **gouvernes sur charnière**, **segments
d'aile chaînés pour la flexion**, winglets, nacelles (soufflante tournante, chevrons 787), mâts
réacteurs reliant nacelle et intrados, tuyères, **postcombustion volumétrique** en shader avec
anneaux de Mach (> 85 %), hélice + disque de flou, trains (amortisseur, bogies, carénages
DR-400), verrières (or ITO furtifs, coulissante DR-400, arceau), entrées d'air (DSI, caret,
semi-ventrales), chines/LERX, perche Rafale, carénage voilure-fuselage, empennage en T, feux
(sprites + projecteur d'atterrissage), crosse, porte de soufflante F-35B.
**Livrées en texture** (UV : u le long du fuselage, v = angle/2π) : hublots, pare-brise, portes,
cheatlines, ventre, immatriculations, radôme, lignes de panneaux, cocardes Rafale.
**Matériaux** : RAM mat (furtifs), peinture clearcoat (civils), aluminium brossé des BA,
verre, caoutchouc. **Interdits** : `anisotropy` et `iridescence` (NaN sans tangentes → écran
noir via le bloom). Fusion des pièces statiques par matériau (draw calls).
Chargeur **.glb/.gltf** animé par la convention de nommage, import depuis l'Atelier.

## 8. Aéroports et monde

- `getSurfaceInfo(ap, x, z, t, out)` = **unique source de vérité** du sol (hauteur, normale,
  vitesse de surface, nature, frottement), partagée physique/rendu. Ordre : pont du navire →
  pistes (plans par profil linéaire par morceaux) → **taxiways / aires de trafic** → terrain
  analytique (fBm/ridged) aplani autour des surfaces revêtues → océan.
- **LFBO** : 14R/32L 3000 m et 14L/32R 3500 m (QFU 143°, 152 m), ILS 3°, PAPI ; taxiways
  parallèles A et B, bretelles et sorties rapides, liaisons entre pistes, aires aérogare
  (postes numérotés) et halls d'assemblage, tour à radar rotatif.
- **LFLJ** : 537 m, 12,5 % puis 18,6 %, PAPI 4,5°, vallée d'approche, plateforme sommitale.
- **TFFJ** : 646 × 18 m, col de la Tourmente, PAPI 6°, baie, aire + 2 bretelles.
- **CVN** : pont oblique −9°, 4 brins, 2 catapultes d'étrave, FLOLS 3,5°, 25 kt, houle.
  Rendu : coque extrudée du contour du pont, navettes mobiles, **déflecteurs de jet**, vapeur,
  **câble d'arrêt tendu en V jusqu'à la crosse**, boule FLOLS pilotée par l'œil.
- ILS géométrique (loc ±2,5°, glide ±0,7° pleine échelle), PAPI 4 feux, FLOLS 5 cellules.
- 3 départs : **Cold & Dark** (parking sur l'aire, check-list guidée), **seuil de piste**
  (catapulte sur CVN ; départ court STOVL pour le F-35B), **finale 5 NM** trimée.
- Rendu : **un seul `Points` pour tout le balisage** (halo shader, couleurs dynamiques PAPI,
  intensité jour/nuit), bâtiments fusionnés, végétation instanciée, eau `Water` 512².

## 9. Rendu temps réel

Sky physique + soleil selon l'heure (Jour / Golden Hour / Nuit), IBL PMREM du ciel, **CSM**,
brouillard, GTAO (Élevé+), SSR (Ultra), bloom, ACES, SMAA, **DRS** (toutes les 15 images,
échelle 0,5–1). **Nuages volumétriques** : raymarch ½ ou ¼ rés. (pas 20→48 selon le preset,
fBm 4 octaves, Beer-Lambert 3 échantillons, Henyey-Greenstein double lobe), **reprojection
temporelle** avec clamp de voisinage, **upsampling bilatéral**, ombres au sol, dérive au vent.
**`SceneDepthPass`** : rendre la scène dans une cible dédiée (couleur HDR + `DepthTexture`) puis
copier — ne jamais échantillonner une profondeur attachée au framebuffer courant (boucle de
rétroaction). Caméras : poursuite, cockpit (inertie de tête sous G), orbite, tour, passage,
libre (replay). Gestionnaire d'erreurs **GLSL** (extrait numéroté) + métriques (FPS, ms, temps
GPU, draw calls cumulés, triangles, mémoire). **Path tracing progressif** (Atelier + Mode
Photo) : scène filtrée aux `Mesh` standard, environnement **équirectangulaire en données**
(pas un PMREM), `setScene` synchrone, 256 échantillons.

## 10. Cockpit, instruments, audio, boîte noire

- Cockpits 3D par catégorie (glass cockpit, 3 MFD, écran panoramique F-35, planche
  analogique DR-400), **commandes cliquables** (raycast, info-bulle, clic sonore) : gaz
  (cliquer-glisser), train, volets, aérofreins, frein de parc, crosse, feux, PA, loi FBW,
  batterie, APU, pompes, démarrages, avionique, STOVL, spoilers ; manche/palonniers animés.
- Instruments canvas (30 Hz) : PFD (horizon, bandes, FMA, ILS, α, radioaltimètre), ND /
  **carte mobile** (relief ombré, pistes, axes ILS, route du navire, trace), EICAS, six-pack.
  **HUD conformal** projeté avec la caméra (FPV, échelle, ILS, boule FLOLS, mini-carte).
- Audio procédural Web Audio (piston, turbofan, PC, vent, décrochage, GPWS vocal, annonces
  radio-altimètre, clics, impacts).
- Boîte noire **10 Hz** (conserver le reste du temps, sinon dérive), analyse d'atterrissage
  (taux de chute, distance de freinage relative à la surface, écart latéral), **replay 3D**
  avec timeline et graphes.

## 11. Interface, contrôles, PWA

- **Liquid Glass** (`@layer components`) : `backdrop-filter: blur(28px) saturate(180%)`, bordure
  1px rgba(255,255,255,.28), reflet supérieur, halo qui suit le pointeur, animations ressort,
  teinte réglable (`--glass-tint`, `--glass-tint-a`, `--glass-alpha`). Les boutons font
  **`blur()` après clic** (sinon Espace/Entrée les réactivent au lieu des freins).
- Écrans : menu, Atelier (7 appareils, carburant, charge, centrage %MAC, envergure, flèche,
  dièdre, aires d'empennage → appliqués AVANT la VLM ; T/W, charge alaire, Vs, marge statique,
  vue en plan), Soufflerie, préparation du vol (aéroport + départ), vol (pannes, debug, pause,
  mode photo, aide-mémoire des commandes), paramètres (clavier, manette, graphismes, météo,
  audio).
- **Clavier** : liaisons par **position physique** (`KeyboardEvent.code`), 30+ actions
  remappables, conflits, `localStorage` ; **détection AZERTY/QWERTZ** via
  `navigator.keyboard.getLayoutMap()` pour afficher les touches imprimées ; axes vifs (5/s,
  retour ×2,5, inversion immédiate). Souris-yoke. **Gamepad/HOTAS** (apprentissage d'axes et
  boutons, zone morte, expo, gaz bipolaire).
- Réglages par défaut **légers** : preset Moyen, cible 60 FPS, DPR 1,25, nuages ¼, DRS actif.
- **PWA** : manifeste (plein écran, icônes dont maskable), service worker **généré au build**
  par un plugin Vite (liste exacte des fichiers + version par hash), pré-cache hors ligne,
  **injection des en-têtes COOP/COEP/CORP** (SharedArrayBuffer même sur GitHub Pages, un seul
  rechargement anti-boucle), bouton « Installer l'application », `VITE_BASE` pour les
  sous-chemins, workflow GitHub Pages, `_headers` (Netlify) et `vercel.json`.

## 12. Sprints et tests

1. **Noyau** : docs, Vite COOP/COEP + fallback, worker RK4 240 Hz, ISA, sol, VLM, FBW, GLSL.
2. **Soufflerie & UI** : CFD complète, polaires, verdict, Liquid Glass, paramètres, contrôles.
3. **Flotte & cockpits** : 7 modèles + GLTF, cockpits, instruments, HUD, départs, pannes.
4. **Monde** : aéroports + taxiways, porte-avions, nuages, boîte noire, audio, path tracing,
   optimisation, PWA.

Tests Vitest minimum : VLM (aile rectangulaire AR6 vs Helmbold ±6 %, PG, signes des dérivées des
7 avions, foyer, verdict), ISA OACI, quaternions aller-retour, `getSurfaceInfo` (piste, pente
18,6 %, pont mobile, taxiways), ILS/PAPI, Cp\*, choc à M 0,88, couche limite/contraintes/Vmax,
finales stables DR-400 et A380, 787 immobile au parking, décollage Rafale, divergence CG
arrière, **appontage Rafale** (avec auto-manette), **catapultage**, **stationnaire et
atterrissage vertical F-35B**, boîte noire, check-list, mapping clavier, courbes manette.
