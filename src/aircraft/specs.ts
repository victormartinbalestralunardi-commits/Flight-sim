/**
 * Fiches techniques des 7 appareils.
 *
 * Cotes extérieures (longueur, envergure, hauteur, surface alaire, masses, poussées) issues
 * des données constructeur publiées (Lockheed Martin, Dassault Aviation, Airbus, Boeing,
 * Robin Aircraft / EASA TCDS, Bombardier factsheet Global 8000). Les géométries internes
 * (cordes d'emplanture/saumon, cassures, positions des empennages) sont reconstituées à
 * partir des plans 3 vues publics de façon à respecter exactement surface, envergure,
 * flèche et dièdre publiés. Voir CHANGELOG.md pour le détail.
 */
import type { AircraftId, AircraftSpec, Airfoil, ControlSurface, LiftingSurface, Station } from './types';
import { computeMac } from './types';

const tanD = (d: number) => Math.tan((d * Math.PI) / 180);

/** Construit une station (bord d'attaque) */
function st(x: number, y: number, z: number, chord: number, twist = 0): Station {
  return { le: [x, y, z], chord, twist };
}

/**
 * Panneau trapézoïdal : à partir d'une station de départ, ajoute une station à
 * `spanLen` (projeté horizontal) avec flèche BA et dièdre donnés.
 */
function next(from: Station, spanLen: number, sweepLE: number, dihedral: number, chord: number, twist: number): Station {
  return st(from.le[0] - spanLen * tanD(sweepLE), from.le[1] + spanLen * tanD(dihedral), from.le[2] + spanLen, chord, twist);
}

/** Dérive (verticale ou inclinée d'un angle `cant` depuis la verticale vers l'extérieur). */
function fin(rootX: number, rootY: number, rootZ: number, rootChord: number, height: number, sweepLE: number, tipChord: number, cant = 0): Station[] {
  const c = (cant * Math.PI) / 180;
  return [
    st(rootX, rootY, rootZ, rootChord),
    st(rootX - height * tanD(sweepLE), rootY + height * Math.cos(c), rootZ + height * Math.sin(c), tipChord),
  ];
}

const ctl = (kind: ControlSurface['kind'], spanFrom: number, spanTo: number, chordFrac: number, maxDeg: number, node: string): ControlSurface => ({
  kind, spanFrom, spanTo, chordFrac, maxDeg, node,
});

const AF = {
  naca64a204: { name: 'NACA 64A204', camber: 0.006, camberPos: 0.4, thickness: 0.045, clMax: 1.2 } as Airfoil,
  naca64a005: { name: 'NACA 64A005', camber: 0, camberPos: 0.4, thickness: 0.05, clMax: 0.9 } as Airfoil,
  naca0009: { name: 'NACA 0009', camber: 0, camberPos: 0.4, thickness: 0.09, clMax: 1.1 } as Airfoil,
  naca0012: { name: 'NACA 0012', camber: 0, camberPos: 0.4, thickness: 0.12, clMax: 1.4 } as Airfoil,
  supercrit: { name: 'Supercritique (cambrure arrière)', camber: 0.02, camberPos: 0.65, thickness: 0.115, clMax: 1.6 } as Airfoil,
  naca43013: { name: 'NACA 43013,5 (Jodel)', camber: 0.024, camberPos: 0.15, thickness: 0.135, clMax: 1.5 } as Airfoil,
  delta: { name: 'Delta mince cambré', camber: 0.01, camberPos: 0.5, thickness: 0.045, clMax: 1.4 } as Airfoil,
};

// ───────────────────────────── F-22 Raptor ─────────────────────────────
function f22(): AircraftSpec {
  // surface 78,04 m², envergure 13,56 m, flèche BA 42°, BF −17°, dièdre −3,25°
  const semi = 6.78;
  const cr = 9.84, ct = 1.67;
  const root = st(-6.4, 0, 0, cr, 0);
  const wing: LiftingSurface = {
    name: 'wing', role: 'wing', symmetric: true, airfoil: AF.naca64a204,
    stations: [root, next(root, semi, 42, -3.25, ct, -3)],
    controls: [
      ctl('flap', 0.14, 0.52, 0.22, 20, 'flap'),
      ctl('aileron', 0.55, 0.95, 0.28, 25, 'aileron'),
    ],
  };
  const htRoot = st(-15.2, -0.1, 1.3, 3.3);
  const htail: LiftingSurface = {
    name: 'htail', role: 'htail', symmetric: true, airfoil: AF.naca64a005,
    stations: [htRoot, next(htRoot, 3.12, 42, 0, 1.0, 0)],
    controls: [ctl('elevator', 0, 1, 1, 25, 'elevator')],
  };
  const vtail: LiftingSurface = {
    name: 'vtail', role: 'vtail', symmetric: true, airfoil: AF.naca64a005,
    stations: fin(-12.9, 0.85, 1.55, 3.6, 2.6, 22.9, 1.6, 28),
    controls: [ctl('rudder', 0.1, 0.9, 0.3, 30, 'rudder')],
  };
  return {
    id: 'f22', name: 'F-22 Raptor', manufacturer: 'Lockheed Martin', category: 'fighter', fcs: 'fbw',
    length: 18.92, span: 13.56, height: 5.08, wingArea: 78.04,
    surfaces: [wing, htail, vtail],
    fuselage: { length: 18.92, width: 3.4, height: 1.9, axisY: 0, munk: 0.45 },
    engines: [
      { type: 'turbojet_ab', pos: [-17.6, 0, -0.75], thrustDry: 116000, thrustAB: 156000, tsfc: 0.064, tsfcAB: 0.2, spoolTime: 3, bypass: 0.3, vectorDeg: 20 },
      { type: 'turbojet_ab', pos: [-17.6, 0, 0.75], thrustDry: 116000, thrustAB: 156000, tsfc: 0.064, tsfcAB: 0.2, spoolTime: 3, bypass: 0.3, vectorDeg: 20 },
    ],
    gear: [
      { name: 'gear_front', pos: [-4.9, -2.25, 0], travel: 0.3, steerable: true, braked: false, wheels: 1, wheelRadius: 0.32 },
      { name: 'gear_main_L', pos: [-10.6, -2.25, -1.6], travel: 0.35, steerable: false, braked: true, wheels: 1, wheelRadius: 0.47 },
      { name: 'gear_main_R', pos: [-10.6, -2.25, 1.6], travel: 0.35, steerable: false, braked: true, wheels: 1, wheelRadius: 0.47 },
    ],
    mass: { empty: 19700, mtow: 38000, fuelMax: 8200, payloadMax: 2300, kxx: 0.27, kyy: 0.4, kzz: 0.37 },
    perf: {
      cd0: 0.0185, cdGear: 0.012, cdFlaps: 0.02, cdSpeedbrake: 0.045, alphaStall: 28, alphaStallFlaps: 28, alphaMaxFcs: 40,
      mdd: 0.95, nzMax: 9, nzMin: -3, vApp: 140, vR: 145, glideDeg: 3, maxSinkRate: 4.5, mmo: 2.25,
      flapDetents: [0, 0.5, 1], flapMaxDeg: 20, wingFlexPerG: 0.02,
    },
    hasHook: true, hasAfterburner: true, xcgDefault: 22, xcgRange: [5, 38],
    eye: [-4.2, 0.95, 0],
    livery: { primary: 0x6c737a, secondary: 0x50575e, accent: 0xc9a227 },
    notes: 'Géométrie facettée furtive, double dérive inclinée 28°, tuyères 2D vectorielles ±20°. Profil NACA 64A204.',
  };
}

// ───────────────────────────── F-35C Lightning II ─────────────────────────────
function f35(): AircraftSpec {
  // Variante embarquée C : envergure 13,1 m, surface 62,1 m², crosse renforcée.
  const semi = 6.55;
  const root = st(-5.8, 0.05, 0, 7.44, 0);
  const wing: LiftingSurface = {
    name: 'wing', role: 'wing', symmetric: true, airfoil: AF.naca64a204,
    stations: [root, next(root, semi, 33, -2, 2.04, -2)],
    controls: [
      ctl('flap', 0.15, 0.6, 0.25, 30, 'flap'),
      ctl('aileron', 0.62, 0.95, 0.28, 25, 'aileron'),
    ],
  };
  const htRoot = st(-12.3, 0.0, 1.0, 3.2);
  const htail: LiftingSurface = {
    name: 'htail', role: 'htail', symmetric: true, airfoil: AF.naca64a005,
    stations: [htRoot, next(htRoot, 2.5, 38, 0, 1.0, 0)],
    controls: [ctl('elevator', 0, 1, 1, 25, 'elevator')],
  };
  const vtail: LiftingSurface = {
    name: 'vtail', role: 'vtail', symmetric: true, airfoil: AF.naca64a005,
    stations: fin(-11.3, 0.85, 1.35, 2.8, 2.2, 35, 1.1, 25),
    controls: [ctl('rudder', 0.12, 0.9, 0.3, 30, 'rudder')],
  };
  return {
    id: 'f35', name: 'F-35C Lightning II', manufacturer: 'Lockheed Martin', category: 'fighter', fcs: 'fbw',
    length: 15.67, span: 13.1, height: 4.48, wingArea: 62.1,
    surfaces: [wing, htail, vtail],
    fuselage: { length: 15.67, width: 3.2, height: 2.0, axisY: 0, munk: 0.45 },
    engines: [
      { type: 'turbojet_ab', pos: [-15.5, 0.05, 0], thrustDry: 125000, thrustAB: 191000, tsfc: 0.072, tsfcAB: 0.2, spoolTime: 3.5, bypass: 0.57 },
    ],
    gear: [
      { name: 'gear_front', pos: [-3.7, -2.05, 0], travel: 0.4, steerable: true, braked: false, wheels: 2, wheelRadius: 0.3 },
      { name: 'gear_main_L', pos: [-9.3, -2.05, -1.65], travel: 0.45, steerable: false, braked: true, wheels: 1, wheelRadius: 0.45 },
      { name: 'gear_main_R', pos: [-9.3, -2.05, 1.65], travel: 0.45, steerable: false, braked: true, wheels: 1, wheelRadius: 0.45 },
    ],
    mass: { empty: 15785, mtow: 31751, fuelMax: 8960, payloadMax: 3000, kxx: 0.27, kyy: 0.4, kzz: 0.37 },
    perf: {
      cd0: 0.021, cdGear: 0.014, cdFlaps: 0.025, cdSpeedbrake: 0.04, alphaStall: 26, alphaStallFlaps: 26, alphaMaxFcs: 30,
      mdd: 0.92, nzMax: 7.5, nzMin: -3, vApp: 140, vR: 150, glideDeg: 3.5, maxSinkRate: 7.6, mmo: 1.6,
      flapDetents: [0, 0.5, 1], flapMaxDeg: 30, wingFlexPerG: 0.025,
    },
    hasHook: true, hasAfterburner: true, xcgDefault: 24, xcgRange: [5, 38],
    eye: [-3.6, 1.0, 0],
    livery: { primary: 0x5e656b, secondary: 0x4b5157, accent: 0x9aa3a9 },
    notes: 'Variante C (CATOBAR). Entrées d\'air DSI, mono-tuyère à bords dentelés, dérives jumelles inclinées 25° (silhouette en V).',
  };
}

// ───────────────────────────── Rafale M ─────────────────────────────
function rafale(): AircraftSpec {
  // Delta 45,7 m², envergure 10,90 m, flèche BA 48°, canards actifs, élevons.
  const semi = 5.45;
  const root = st(-6.4, -0.15, 0, 7.22, 0);
  const wing: LiftingSurface = {
    name: 'wing', role: 'wing', symmetric: true, airfoil: AF.delta,
    stations: [root, next(root, semi, 48, -1, 1.17, -2)],
    controls: [
      ctl('elevon', 0.14, 0.52, 0.2, 25, 'elevon_in'),
      ctl('elevon', 0.52, 0.94, 0.22, 25, 'elevon_out'),
    ],
  };
  const cRoot = st(-4.55, 0.45, 1.05, 1.6);
  const canard: LiftingSurface = {
    name: 'canard', role: 'canard', symmetric: true, airfoil: AF.naca64a005,
    stations: [cRoot, next(cRoot, 1.2, 50, 5, 0.6, 0)],
    controls: [ctl('canard', 0, 1, 1, 20, 'canard')],
  };
  const vtail: LiftingSurface = {
    name: 'vtail', role: 'vtail', symmetric: false, airfoil: AF.naca64a005,
    stations: fin(-10.6, 1.0, 0, 4.2, 3.0, 50, 1.2, 0),
    controls: [ctl('rudder', 0.08, 0.85, 0.28, 30, 'rudder')],
  };
  return {
    id: 'rafale', name: 'Rafale M', manufacturer: 'Dassault Aviation', category: 'fighter', fcs: 'fbw',
    length: 15.27, span: 10.9, height: 5.34, wingArea: 45.7,
    surfaces: [wing, canard, vtail],
    fuselage: { length: 15.27, width: 2.6, height: 1.9, axisY: 0, munk: 0.5 },
    engines: [
      { type: 'turbojet_ab', pos: [-15.0, -0.1, -0.55], thrustDry: 50000, thrustAB: 75000, tsfc: 0.08, tsfcAB: 0.175, spoolTime: 3, bypass: 0.3 },
      { type: 'turbojet_ab', pos: [-15.0, -0.1, 0.55], thrustDry: 50000, thrustAB: 75000, tsfc: 0.08, tsfcAB: 0.175, spoolTime: 3, bypass: 0.3 },
    ],
    gear: [
      { name: 'gear_front', pos: [-4.3, -2.0, 0], travel: 0.45, steerable: true, braked: false, wheels: 2, wheelRadius: 0.28 },
      { name: 'gear_main_L', pos: [-9.9, -2.0, -1.35], travel: 0.5, steerable: false, braked: true, wheels: 1, wheelRadius: 0.42 },
      { name: 'gear_main_R', pos: [-9.9, -2.0, 1.35], travel: 0.5, steerable: false, braked: true, wheels: 1, wheelRadius: 0.42 },
    ],
    mass: { empty: 10600, mtow: 24500, fuelMax: 4700, payloadMax: 4000, kxx: 0.27, kyy: 0.4, kzz: 0.37 },
    perf: {
      cd0: 0.02, cdGear: 0.014, cdFlaps: 0, cdSpeedbrake: 0.035, alphaStall: 30, alphaStallFlaps: 30, alphaMaxFcs: 29,
      mdd: 0.95, nzMax: 9, nzMin: -3.2, vApp: 125, vR: 130, glideDeg: 3.5, maxSinkRate: 6.5, mmo: 1.8,
      flapDetents: [0], flapMaxDeg: 0, wingFlexPerG: 0.015,
    },
    hasHook: true, hasAfterburner: true, xcgDefault: 25, xcgRange: [5, 38],
    eye: [-3.3, 0.95, 0],
    livery: { primary: 0x77808a, secondary: 0x5f6872, accent: 0x1f3f8f },
    notes: 'Delta-canard à instabilité naturelle contrôlée, entrées d\'air semi-ventrales, 2× M88-2.',
  };
}

// ───────────────────────────── Airbus A380-800 ─────────────────────────────
function a380(): AircraftSpec {
  // 845 m², envergure 79,75 m, flèche 33,5° (1/4 corde), dièdre 5,6°, cassure Yehudi.
  const root = st(-24.5, -2.4, 0, 19.5, 3);
  const kink = next(root, 13.5, 37, 5.6, 12.0, 1);
  const tip = next(kink, 26.375, 35, 5.6, 4.0, -2.5);
  const wing: LiftingSurface = {
    name: 'wing', role: 'wing', symmetric: true, airfoil: AF.supercrit,
    stations: [root, kink, tip],
    controls: [
      ctl('flap', 0.08, 0.68, 0.3, 33, 'flap'),
      ctl('aileron', 0.7, 0.97, 0.25, 25, 'aileron'),
    ],
  };
  const htRoot = st(-58.5, 1.2, 0, 10.9);
  const htail: LiftingSurface = {
    name: 'htail', role: 'htail', symmetric: true, airfoil: AF.naca0012,
    stations: [htRoot, next(htRoot, 15.2, 38, 5, 2.6, 0)],
    controls: [ctl('elevator', 0.05, 0.95, 0.3, 30, 'elevator')],
  };
  const vtail: LiftingSurface = {
    name: 'vtail', role: 'vtail', symmetric: false, airfoil: AF.naca0012,
    stations: fin(-57.0, 3.0, 0, 13.5, 14.0, 40, 4.5),
    controls: [ctl('rudder', 0.05, 0.95, 0.33, 30, 'rudder')],
  };
  const eng = (z: number, x: number, y: number) => ({
    type: 'turbofan' as const, pos: [x, y, z] as [number, number, number], thrustDry: 311000, thrustAB: 0,
    tsfc: 0.036, tsfcAB: 0, spoolTime: 6, bypass: 7.5,
  });
  return {
    id: 'a380', name: 'A380-800', manufacturer: 'Airbus', category: 'airliner', fcs: 'fbw',
    length: 72.72, span: 79.75, height: 24.09, wingArea: 845,
    surfaces: [wing, htail, vtail],
    fuselage: { length: 72.72, width: 7.14, height: 8.41, axisY: 0 },
    engines: [eng(-25.6, -37.0, -2.3), eng(-15.3, -30.0, -3.6), eng(15.3, -30.0, -3.6), eng(25.6, -37.0, -2.3)],
    gear: [
      { name: 'gear_front', pos: [-5.6, -7.05, 0], travel: 0.5, steerable: true, braked: false, wheels: 2, wheelRadius: 0.62 },
      { name: 'gear_main_L', pos: [-36.0, -7.05, -5.2], travel: 0.6, steerable: false, braked: true, wheels: 4, wheelRadius: 0.72, bogies: 2 },
      { name: 'gear_main_R', pos: [-36.0, -7.05, 5.2], travel: 0.6, steerable: false, braked: true, wheels: 4, wheelRadius: 0.72, bogies: 2 },
    ],
    mass: { empty: 277000, mtow: 575000, fuelMax: 254000, payloadMax: 84000, kxx: 0.32, kyy: 0.45, kzz: 0.38 },
    perf: {
      cd0: 0.018, cdGear: 0.02, cdFlaps: 0.06, cdSpeedbrake: 0.03, alphaStall: 15, alphaStallFlaps: 17, alphaMaxFcs: 15,
      mdd: 0.89, nzMax: 2.5, nzMin: -1, vApp: 138, vR: 150, glideDeg: 3, maxSinkRate: 3.0, mmo: 0.89,
      flapDetents: [0, 0.25, 0.5, 0.75, 1], flapMaxDeg: 33, wingFlexPerG: 2.4,
    },
    hasHook: false, hasAfterburner: false, xcgDefault: 38, xcgRange: [20, 50],
    eye: [-4.6, 1.8, -0.55],
    livery: { primary: 0xf4f6f8, secondary: 0x1b3a6b, accent: 0xd0d6dc },
    notes: 'Fuselage double pont (7,14 × 8,41 m), 4× RR Trent 970, winglets en flèche, train principal multi-bogies (22 roues).',
  };
}

// ───────────────────────────── Boeing 787-9 ─────────────────────────────
function b787(): AircraftSpec {
  // 360,5 m², envergure 60,12 m, flèche 32,2°, saumons « raked », grande flexibilité.
  const root = st(-23.0, -1.7, 0, 11.0, 2.5);
  const kink = next(root, 9.5, 34, 6, 7.2, 0.5);
  const tip = next(kink, 20.56, 34.5, 6, 1.75, -2.5);
  const wing: LiftingSurface = {
    name: 'wing', role: 'wing', symmetric: true, airfoil: AF.supercrit,
    stations: [root, kink, tip],
    controls: [
      ctl('flap', 0.08, 0.62, 0.3, 30, 'flap'),
      ctl('aileron', 0.64, 0.92, 0.24, 25, 'aileron'),
    ],
  };
  const htRoot = st(-51.5, 1.0, 0, 6.2);
  const htail: LiftingSurface = {
    name: 'htail', role: 'htail', symmetric: true, airfoil: AF.naca0012,
    stations: [htRoot, next(htRoot, 9.8, 36, 7, 1.9, 0)],
    controls: [ctl('elevator', 0.05, 0.95, 0.3, 30, 'elevator')],
  };
  const vtail: LiftingSurface = {
    name: 'vtail', role: 'vtail', symmetric: false, airfoil: AF.naca0012,
    stations: fin(-49.0, 2.6, 0, 9.0, 9.8, 40, 3.4),
    controls: [ctl('rudder', 0.05, 0.95, 0.33, 30, 'rudder')],
  };
  const eng = (z: number) => ({
    type: 'turbofan' as const, pos: [-27.0, -3.1, z] as [number, number, number], thrustDry: 330000, thrustAB: 0,
    tsfc: 0.034, tsfcAB: 0, spoolTime: 6, bypass: 9.3,
  });
  return {
    id: 'b787', name: '787-9 Dreamliner', manufacturer: 'Boeing', category: 'airliner', fcs: 'fbw',
    length: 62.81, span: 60.12, height: 17.02, wingArea: 360.5,
    surfaces: [wing, htail, vtail],
    fuselage: { length: 62.81, width: 5.77, height: 5.97, axisY: 0 },
    engines: [eng(-9.9), eng(9.9)],
    gear: [
      { name: 'gear_front', pos: [-6.6, -4.65, 0], travel: 0.45, steerable: true, braked: false, wheels: 2, wheelRadius: 0.55 },
      { name: 'gear_main_L', pos: [-30.6, -4.65, -4.9], travel: 0.55, steerable: false, braked: true, wheels: 4, wheelRadius: 0.68 },
      { name: 'gear_main_R', pos: [-30.6, -4.65, 4.9], travel: 0.55, steerable: false, braked: true, wheels: 4, wheelRadius: 0.68 },
    ],
    mass: { empty: 128850, mtow: 254011, fuelMax: 101000, payloadMax: 52600, kxx: 0.31, kyy: 0.45, kzz: 0.38 },
    perf: {
      cd0: 0.017, cdGear: 0.02, cdFlaps: 0.055, cdSpeedbrake: 0.03, alphaStall: 14.5, alphaStallFlaps: 16.5, alphaMaxFcs: 14.5,
      mdd: 0.88, nzMax: 2.5, nzMin: -1, vApp: 147, vR: 155, glideDeg: 3, maxSinkRate: 3.0, mmo: 0.9,
      flapDetents: [0, 0.17, 0.33, 0.5, 0.83, 1], flapMaxDeg: 30, wingFlexPerG: 2.6,
    },
    hasHook: false, hasAfterburner: false, xcgDefault: 38, xcgRange: [20, 50],
    eye: [-4.0, 1.25, -0.5],
    livery: { primary: 0xf5f7f9, secondary: 0x0b2a5b, accent: 0x5aa0d8 },
    notes: 'Aile composite très flexible (flèche dynamique ∝ n_z), nacelles GEnx à chevrons, nez effilé 4 vitres.',
  };
}

// ───────────────────────────── Robin DR-400/180 Régent ─────────────────────────────
function dr400(): AircraftSpec {
  // Aile Jodel : plan central sans dièdre, panneaux externes à fort dièdre (≈14°). 14,2 m², 8,72 m.
  const root = st(-1.85, -0.45, 0, 1.71, 0);
  const crank = st(-1.85, -0.45, 1.6, 1.71, 0);
  const tip = next(crank, 2.76, 4, 14, 1.45, -1.5);
  const wing: LiftingSurface = {
    name: 'wing', role: 'wing', symmetric: true, airfoil: AF.naca43013,
    stations: [root, crank, tip],
    controls: [
      ctl('flap', 0.08, 0.36, 0.22, 60, 'flap'),
      ctl('aileron', 0.55, 0.95, 0.25, 20, 'aileron'),
    ],
  };
  const htRoot = st(-5.95, 0.05, 0, 0.82);
  const htail: LiftingSurface = {
    name: 'htail', role: 'htail', symmetric: true, airfoil: AF.naca0009,
    stations: [htRoot, next(htRoot, 1.6, 4, 0, 0.7, 0)],
    controls: [ctl('elevator', 0, 1, 1, 15, 'elevator')],
  };
  const vtail: LiftingSurface = {
    name: 'vtail', role: 'vtail', symmetric: false, airfoil: AF.naca0009,
    stations: fin(-5.75, 0.3, 0, 1.15, 1.15, 40, 0.65),
    controls: [ctl('rudder', 0.05, 1, 0.42, 25, 'rudder')],
  };
  return {
    id: 'dr400', name: 'DR-400/180 Régent', manufacturer: 'Robin Aircraft', category: 'ga', fcs: 'direct',
    length: 6.96, span: 8.72, height: 2.23, wingArea: 14.2,
    surfaces: [wing, htail, vtail],
    fuselage: { length: 6.96, width: 1.1, height: 1.25, axisY: 0 },
    engines: [
      { type: 'piston', pos: [-0.05, 0, 0], thrustDry: 134000, thrustAB: 0, tsfc: 0.00031, tsfcAB: 0, spoolTime: 0.6, bypass: 0, propDiameter: 1.83 },
    ],
    gear: [
      { name: 'gear_front', pos: [-0.7, -1.18, 0], travel: 0.12, steerable: true, braked: false, wheels: 1, wheelRadius: 0.19 },
      { name: 'gear_main_L', pos: [-2.25, -1.2, -1.3], travel: 0.1, steerable: false, braked: true, wheels: 1, wheelRadius: 0.21 },
      { name: 'gear_main_R', pos: [-2.25, -1.2, 1.3], travel: 0.1, steerable: false, braked: true, wheels: 1, wheelRadius: 0.21 },
    ],
    mass: { empty: 600, mtow: 1100, fuelMax: 115, payloadMax: 360, kxx: 0.25, kyy: 0.39, kzz: 0.31 },
    perf: {
      cd0: 0.031, cdGear: 0, cdFlaps: 0.045, cdSpeedbrake: 0, alphaStall: 15, alphaStallFlaps: 13, alphaMaxFcs: 99,
      mdd: 0.7, nzMax: 3.8, nzMin: -1.5, vApp: 65, vR: 55, glideDeg: 3.5, maxSinkRate: 2.5, mmo: 0.3,
      flapDetents: [0, 0.25, 1], flapMaxDeg: 60, wingFlexPerG: 0.01,
    },
    hasHook: false, hasAfterburner: false, xcgDefault: 28, xcgRange: [10, 45],
    eye: [-2.1, 0.65, -0.3],
    livery: { primary: 0xf6f4ef, secondary: 0xb3202a, accent: 0x1d3f8a },
    notes: 'Lycoming O-360 180 ch, hélice bipale à pas fixe Ø1,83 m, verrière coulissante, carénages de roues.',
  };
}

// ───────────────────────────── Bombardier Global 8000 ─────────────────────────────
function g8000(): AircraftSpec {
  // Factsheet Bombardier : L 33,8 m, b 31,7 m, h 8,2 m. Surface 116,5 m², flèche 35,3°.
  const root = st(-12.6, -0.95, 0, 6.6, 2);
  const kink = next(root, 4.5, 37, 4, 4.6, 0.5);
  const tip = next(kink, 11.35, 35.3, 4, 1.35, -2.5);
  const wing: LiftingSurface = {
    name: 'wing', role: 'wing', symmetric: true, airfoil: AF.supercrit,
    stations: [root, kink, tip],
    controls: [
      ctl('flap', 0.1, 0.66, 0.28, 30, 'flap'),
      ctl('aileron', 0.68, 0.94, 0.24, 25, 'aileron'),
    ],
  };
  const vtail: LiftingSurface = {
    name: 'vtail', role: 'vtail', symmetric: false, airfoil: AF.naca0012,
    stations: fin(-26.5, 1.3, 0, 5.6, 4.7, 45, 3.6),
    controls: [ctl('rudder', 0.08, 0.92, 0.33, 30, 'rudder')],
  };
  const htRoot = st(-29.4, 6.05, 0, 3.4);
  const htail: LiftingSurface = {
    name: 'htail', role: 'htail', symmetric: true, airfoil: AF.naca0012,
    stations: [htRoot, next(htRoot, 5.0, 30, -2, 1.4, 0)],
    controls: [ctl('elevator', 0.05, 0.95, 0.32, 28, 'elevator')],
  };
  const eng = (z: number) => ({
    type: 'turbofan' as const, pos: [-27.6, 0.9, z] as [number, number, number], thrustDry: 84200, thrustAB: 0,
    tsfc: 0.04, tsfcAB: 0, spoolTime: 5, bypass: 5.6,
  });
  return {
    id: 'g8000', name: 'Global 8000', manufacturer: 'Bombardier', category: 'bizjet', fcs: 'fbw',
    length: 33.8, span: 31.7, height: 8.2, wingArea: 116.5,
    surfaces: [wing, htail, vtail],
    fuselage: { length: 33.0, width: 2.69, height: 2.79, axisY: 0 },
    engines: [eng(-2.35), eng(2.35)],
    gear: [
      { name: 'gear_front', pos: [-3.1, -2.85, 0], travel: 0.3, steerable: true, braked: false, wheels: 2, wheelRadius: 0.36 },
      { name: 'gear_main_L', pos: [-16.6, -2.85, -2.35], travel: 0.35, steerable: false, braked: true, wheels: 2, wheelRadius: 0.5 },
      { name: 'gear_main_R', pos: [-16.6, -2.85, 2.35], travel: 0.35, steerable: false, braked: true, wheels: 2, wheelRadius: 0.5 },
    ],
    mass: { empty: 26000, mtow: 52300, fuelMax: 25450, payloadMax: 2600, kxx: 0.29, kyy: 0.42, kzz: 0.37 },
    perf: {
      cd0: 0.017, cdGear: 0.018, cdFlaps: 0.05, cdSpeedbrake: 0.03, alphaStall: 16, alphaStallFlaps: 18, alphaMaxFcs: 16,
      mdd: 0.92, nzMax: 2.6, nzMin: -1, vApp: 115, vR: 130, glideDeg: 3, maxSinkRate: 3.0, mmo: 0.94,
      flapDetents: [0, 0.2, 0.53, 1], flapMaxDeg: 30, wingFlexPerG: 0.6,
    },
    hasHook: false, hasAfterburner: false, xcgDefault: 38, xcgRange: [20, 52],
    eye: [-2.6, 0.75, -0.45],
    livery: { primary: 0xf7f7f5, secondary: 0x2b2f36, accent: 0xb08d57 },
    notes: 'Empennage en T, 2× GE Passport en nacelles arrière, grands hublots ovales, winglets inclinés. Mmo 0,94.',
  };
}

/**
 * Cohérence centrage / train : le train principal est placé juste derrière la limite
 * arrière de centrage (marge de basculement de 6 % MAC), comme sur l'avion réel.
 */
function finalize(s: AircraftSpec): AircraftSpec {
  const mac = computeMac(s.surfaces[0]);
  const x = mac.xLE - (s.xcgRange[1] / 100 + 0.06) * mac.mac;
  for (const g of s.gear) if (g.name !== 'gear_front') g.pos[0] = x;
  return s;
}

const builders: Record<AircraftId, () => AircraftSpec> = {
  f22: () => finalize(f22()), f35: () => finalize(f35()), rafale: () => finalize(rafale()), a380: () => finalize(a380()),
  b787: () => finalize(b787()), dr400: () => finalize(dr400()), g8000: () => finalize(g8000()),
};

export const AIRCRAFT_IDS: AircraftId[] = ['rafale', 'f22', 'f35', 'a380', 'b787', 'g8000', 'dr400'];

export function getAircraft(id: AircraftId): AircraftSpec {
  return builders[id]();
}

export function allAircraft(): AircraftSpec[] {
  return AIRCRAFT_IDS.map((id) => builders[id]());
}
