# CHANGELOG — AéroSim 3D Studio

Journal de suivi permanent. **Chaque modification doit y être consignée** (version/sprint,
horodatage UTC, fichiers, détail technique, état de vérification).

---

## [0.6.0] — Performances, touches, taxiways, porte-avions, remodelage, soufflerie — 2026-11-25 12:40 UTC

Demande utilisateur : remodéliser/affiner les avions, jeu trop lent, touches peu réactives,
taxiways, CFD plus belle, catapulte et mécanisme d'arrêt sur le porte-avions.

### Fichiers créés
- `src/world/lightField.ts` — feux ponctuels instanciés (un seul draw call, halo shader,
  couleurs dynamiques pour le PAPI, intensité jour/nuit).
- `src/aircraft/livery.ts` — livrées procédurales plaquées en texture (UV fuselage) :
  hublots, pare-brise, portes, cheatlines, ventre peint, immatriculations, radôme, lignes de
  panneaux et trappes (chasseurs), cocardes basse visibilité (Rafale), carte de rugosité.

### Fichiers modifiés
- **Performances** : `airports/build3d.ts` (centaines de sprites → `LightField` ; bâtiments
  fusionnés par matériau `StaticBatch` ; matériaux partagés ; eau 512²),
  `clouds/VolumetricClouds.ts` (pas de raymarching selon le preset 20→48, fBm 4 octaves,
  3 échantillons solaires, ombres au sol à 2 échantillons), `world/FlightScene.ts` (nuages
  recréés au changement de preset, DRS toutes les 15 images avec pas adaptatif, intensité du
  balisage), `aircraft/procedural.ts` (`mergeStatic` : fusion des pièces fixes par matériau),
  `ui/FlightView.tsx` (HUD effacé seulement s'il a été dessiné), `ui/store.ts` (réglages v2 :
  preset « Moyen » par défaut, cible 60 FPS, DPR 1,25, nuages ¼, path tracing 256 éch. ;
  migration des contrôles/météo/audio depuis v1).
- **Touches** : `controls/bindings.ts` (détection de la disposition AZERTY/QWERTZ via
  `navigator.keyboard.getLayoutMap`, libellés des touches réellement imprimées),
  `controls/input.ts` (axes 2× plus vifs, retour au neutre rapide, inversion instantanée,
  gaz 0,8/s), `ui/glass.tsx` (les boutons rendent le focus : Espace/Entrée restent aux
  commandes de vol), `ui/Settings.tsx` (disposition affichée, vitesse des axes jusqu'à 10/s),
  `ui/FlightView.tsx` (aide-mémoire « Commandes » en vol), `main.tsx`.
- **Taxiways** : `airports/airports.ts` (`TaxiwayDef`, `ApronDef`, `pavedSurface`, aplanissement
  du terrain, `getSurfaceInfo` sur surfaces revêtues, parking Cold & Dark sur l'aire de trafic) :
  LFBO (parallèles A et B, bretelles dont sorties rapides, liaisons entre pistes, aires
  aérogare et halls), LFLJ (plateforme sommitale), TFFJ (aire de l'aérogare + 2 bretelles) ;
  `build3d.ts` (taxiways texturés axe/bords jaunes, feux bleus, aires en béton à joints avec
  lignes de guidage, barres d'arrêt et numéros de postes, projecteurs).
- **Porte-avions** : `physics/layout.ts` (`CAT_S`, `CAT_INDEX`, `WIRE_PULL`, `CAT_V`,
  `OUT_SIZE` 116), `physics/flightModel.ts` (retenue tant que les gaz < 85 %, longueur de
  câble déroulée), `physics/bridge.ts`, `airports/carrier3d.ts` (navettes mobiles avec
  rétraction, déflecteurs de jet levés pendant l'attelage, vapeur, **câble d'arrêt tendu en V
  jusqu'à la crosse**, poulies), `world/FlightScene.ts` (point de crosse en repère navire),
  `ui/FlightView.tsx` (bandeaux « Catapulte attelée », vitesse de lancement, « Brin n° »).
- **Avions** : `aircraft/procedural.ts` (fuselage 96–120 × 40 segments, UV, couture lissée,
  livrée, arceau de verrière, carénage voilure-fuselage, cône de queue/APU, carénage d'empennage
  en T, chines/LERX F-22/F-35, perche de ravitaillement et raccords de canards Rafale, congés
  d'emplanture et antenne DR-400, mâts réacteurs reliant nacelle et intrados).
- **Soufflerie** : `cfd/CfdScene.ts` (le vrai modèle 3D est coloré par la CFD : chaque sommet
  est associé au panneau VLM le plus proche, extrados/intrados selon la normale ; éclairage
  studio réfléchissant `RoomEnvironment`, ombre douce sur le plancher de veine, tubes vernis à
  8 segments), `ui/WindTunnel.tsx`.
- Tests : `physics/physics.test.ts` (taxiways/aires, catapultage).

### Vérification
- `npx vitest run` : **35 tests / 35 réussis** ; `npm run build` : **OK, 0 erreur TypeScript**.
- Captures Playwright : livrées (A380, Global 8000, DR-400, Rafale, F-35B), soufflerie avec
  maquette réelle en vitesse et en Cp. Mesure de FPS non représentative ici (rendu logiciel).

---

## [0.5.0] — Application installable (PWA) — 2026-11-25 14:10 UTC

### Fichiers créés
- `public/manifest.webmanifest` — nom, icônes (dont *maskable*), affichage plein écran, paysage.
- `public/icons/icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
  `apple-touch-icon.png` (rendus depuis le SVG).
- `pwa/sw-template.js` — service worker : pré-cache complet (jeu jouable hors ligne),
  navigation réseau d'abord avec repli sur le cache, **injection des en-têtes COOP/COEP/CORP**
  (isolation cross-origin → SharedArrayBuffer même sur GitHub Pages).
- `src/pwa.ts` — enregistrement du service worker (production), rechargement unique si la page
  n'est pas encore isolée (anti-boucle), gestion de `beforeinstallprompt`.
- `public/_headers` (Netlify / Cloudflare Pages), `vercel.json` — en-têtes COOP/COEP.
- `.github/workflows/deploy-pages.yml` — tests + build + déploiement GitHub Pages à chaque push.
- `README.md` — lancement, installation, déploiement.

### Fichiers modifiés
- `vite.config.ts` — `base` configurable (`VITE_BASE`), plugin `aerosim-pwa` qui génère `sw.js`
  avec la liste exacte des fichiers et une version dérivée de leur contenu.
- `index.html` — manifeste, icônes, `theme-color`, balises mobiles.
- `src/main.tsx` — appel de `registerPwa()`.
- `src/ui/MainMenu.tsx` — bouton **« Installer l'application »** / mention « installée ».
- `package.json` — `@types/node` (typage de la config Vite).

### Vérification
- `npx vitest run` : **33 tests / 33 réussis** ; `npm run build` : **OK, 0 erreur TypeScript**.
- Test Playwright sur un serveur statique **sans en-têtes** sous `/Flight-sim/` (cas GitHub Pages) :
  service worker actif, `crossOriginIsolated === true` après le rechargement automatique,
  manifeste chargé, **aucune erreur d'installabilité Chrome**, puis **réseau coupé** :
  menu affiché et vol lancé (worker physique opérationnel hors ligne).

---

## [0.4.0] — Sprint 4 : aéroports, porte-avions, nuages, boîte noire, audio, ray tracing — 2026-11-25 13:30 UTC

### Fichiers créés
- `src/airports/build3d.ts` — terrain à grille non uniforme (300², fine au centre) échantillonnant
  `terrainHeight` (même fonction que la physique), pistes texturées (marquages OACI générés),
  feux de bord/seuil/fin, rampe d'approche, **PAPI dynamiques** (calage 2,5/2,83/3,17/3,5° autour
  de la pente, couleur calculée depuis l'œil), hangars à toit cintré (halls d'assemblage LFBO),
  **tour de contrôle à radar rotatif**, chalets (LFLJ), maisons à flanc de colline (TFFJ),
  végétation instanciée hors axe d'approche, **océan** (`Water`, normales procédurales).
- `src/airports/carrier3d.ts` — coque extrudée depuis le contour EXACT du pont physique, pont
  texturé (piste oblique −9°, catapultes), **4 brins d'arrêt**, île + radar, **FLOLS** (boule
  ambre/rouge positionnée par `flolsBall` depuis l'œil, barres de datum vertes), feux de pont ;
  animation tangage/roulis/pilonnement depuis l'état physique.
- `src/clouds/VolumetricClouds.ts` — raymarching ½ ou ¼ résolution (48 pas, gigue IGN), densité
  fBm 3D × couverture, **Beer-Lambert** vers le soleil, **Henyey-Greenstein double lobe (Mie)**,
  « powder », ambiant ; **reprojection temporelle** (VP précédente, clamp de voisinage) ;
  **suréchantillonnage bilatéral** pondéré par la profondeur ; **ombres des nuages au sol** ;
  dérive avec le vent ; couleur/intensité selon l'heure.
- `src/audio/FlightAudio.ts` — synthèse Web Audio : piston (fréquence d'allumage), turbofan
  (sifflement aubes ∝ N1 + souffle + grondement), turboréacteur + crépitement PC, souffle
  aérodynamique ∝ q, avertisseur de décrochage, **GPWS vocal** (Sink rate, Pull up, Too low
  gear, Bank angle), annonces radio-altimètre, clics cockpit, impacts (toucher, brin, crash).
- `src/raytracing/pathTracer.ts` — **path tracing progressif** (three-gpu-pathtracer) pour
  l'Atelier et le **Mode Photo** (en pause) ; scène traçable filtrée, environnement studio HDR
  équirectangulaire procédural, tuiles 3×3, basse résolution dynamique pendant le mouvement.
- `src/replay/blackbox.test.ts` (boîte noire + check-list).

### Fichiers modifiés
- `src/replay/blackbox.ts` : échantillonnage 10 Hz sans dérive (reste conservé), distance de
  freinage intégrée relativement à la surface (suit le pont mobile).
- `src/physics/flightModel.ts` : TAS d'approche = CAS/√σ (altiports), réglage de la boucle
  de translation STOVL (amortissement), `structHitIdx` de diagnostic.
- `src/aircraft/specs.ts` : F-35B — emplanture d'aile reculée (−6,7 m), centrage 18 % MAC.
- `src/aircraft/materials.ts` : suppression anisotropie/iridescence (NaN → écran noir via bloom).
- `src/world/FlightScene.ts` : `SceneDepthPass` (cible dédiée + copie) contre la boucle de
  rétroaction profondeur ; compteurs de draw calls cumulés sur toutes les passes.

### Optimisation (cible 4K / 120 FPS)
- Physique hors thread principal (worker 240 Hz), état interpolé sans allocation.
- Nuages en ½ / ¼ résolution + TAA + upsampling bilatéral ; **DRS** (échelle 0,5–1 ajustée sur
  la moyenne glissante des frame times vers la cible FPS) ; presets Éco → Cinéma.
- Instruments cockpit rafraîchis à 30 Hz (CanvasTexture), HUD et boucles sans allocation
  (vecteurs/quaternions pré-alloués), géométries instanciées (hublots, arbres, graines CFD).
- Mesure : FPS, frame time, temps GPU (`EXT_disjoint_timer_query_webgl2`), draw calls,
  triangles, textures, mémoire GPU estimée, DPR effectif, mode de transport physique.
- *Limite de vérification : l'environnement de CI n'a pas de GPU (rendu logiciel SwiftShader,
  ~3 s/frame) ; la cible 4K / 120 FPS n'a donc pas pu être mesurée ici et doit être validée
  sur une machine équipée d'un GPU dédié via le panneau Debug (F3).*

### Vérification
- `npx vitest run` : **33 tests / 33 réussis**.
- `npm run build` : **OK, 0 erreur TypeScript**.
- Contrôles visuels Playwright : LFBO (piste, hangars, nuages, cockpit HUD), porte-avions en
  finale (océan, ombres de nuages), Courchevel (vallée alpine en finale).

---

## [0.3.0] — Sprint 3 : flotte des 7 appareils, cockpits 3D, instruments, vol — 2026-11-25 12:50 UTC

### Fichiers créés
- `src/aircraft/materials.ts` — PBR : **RAM mat** (F-22/F-35 : rugosité 0,84 + sheen), peinture
  **clearcoat** (A380/787/Global/DR-400), **aluminium brossé** des bords d'attaque, verrière teinte
  or ITO (furtifs), caoutchouc, métal chaud.
- `src/aircraft/procedural.ts` — modèles procéduraux générés depuis les MÊMES stations que le
  VLM : fuselages superellipse par appareil (F-22 facetté à ombrage plat, A380 double pont…),
  surfaces lofées (NACA, cambrure, vrillage), **gouvernes pivotantes** sur charnière (axe X local),
  **segments d'aile chaînés pour la flexion dynamique** (787), winglets (A380, Global), nacelles
  (soufflante rotative, **chevrons** 787), tuyères (F-22 2D vectorielles, F-35 dentelée, Rafale),
  **postcombustion volumétrique avec anneaux de Mach**, hélice + disque de flou (DR-400), trains
  (jambe, amortisseur `gear_strut_*`, bogies, carénages DR-400), verrières (coulissante DR-400),
  hublots instanciés, entrées d'air (DSI F-35, caret F-22, semi-ventrales Rafale), crosse,
  **feux NAV/STROBE/BEACON/LANDING** (+ projecteur), porte de soufflante STOVL.
- `src/aircraft/animator.ts` — animation par convention de nommage (procédural **ou GLTF**).
- `src/aircraft/gltf.ts` — chargeur `.glb/.gltf` + rapport des nœuds reconnus.
- `src/cockpit/instruments.ts` — **PFD** (horizon, badin, altimètre, vario, cap, FMA, loi FBW,
  **aiguilles ILS loc/glide**, α, radioaltimètre), **ND / Moving Map** (relief ombré, pistes, axes ILS,
  **route du porte-avions**, trace parcourue, vent), **EICAS** (N1/N2/RPM, EGT, FF, carburant,
  train, volets, STOVL, crosse), **planche analogique DR-400** (six pack + GPS).
- `src/cockpit/hud.ts` — **HUD collimaté conformal** (échelle de tangage, FPV, boresight, ILS,
  **boule FLOLS**, GPWS, indexeur d'incidence, mini-carte).
- `src/cockpit/Cockpit3D.ts` — cockpits par catégorie (glass cockpit, 3 MFD, écran panoramique
  F-35, planche analogique), **commandes cliquables** (raycast + info-bulle + clic sonore) : gaz
  (cliquer-glisser), train, volets, aérofreins, frein de parc, crosse, feux, PA HDG/ALT/A-THR,
  bascule FBW, batterie, APU/JFS, pompes, démarrage moteurs, avionique, STOVL, spoilers ;
  manche/yoke et palonniers animés ; combinateur HUD.
- `src/cockpit/checklist.ts` — **check-list Cold & Dark** validée par l'état physique.
- `src/world/FlightScene.ts` — ciel physique + soleil selon l'heure (Jour / Golden Hour / Nuit),
  **IBL dynamique** (PMREM du ciel), **CSM**, brouillard, GTAO, SSR (optionnel), bloom, ACES,
  SMAA, DRS, caméras poursuite / **cockpit avec inertie de tête sous G** / orbite / tour /
  passage / libre.
- `src/ui/FlightView.tsx` — orchestration (worker, entrées, rendu, HUD, instruments, audio,
  boîte noire), **3 modes de départ**, **panneau Pannes** (extinction moteur → poussée
  asymétrique, FBW Alternate/Direct, wind shear), panneau Debug (métriques + erreurs GLSL),
  pause, **mode photo**, voile noir/rouge, crash, **replay 3D + analyse d'atterrissage**.
- `src/ui/HangarViewport.tsx` — Atelier 3D (path tracing progressif, démo gouvernes & feux,
  import `.glb`).

### Vérification
- `npx vitest run` : 31 → **33 tests** (ajout boîte noire + check-list au Sprint 4).
- `npm run build` : **OK, 0 erreur TypeScript**. Captures Playwright des 7 appareils à l'Atelier.

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
