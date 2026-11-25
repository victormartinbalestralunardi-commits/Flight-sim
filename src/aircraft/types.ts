/**
 * Types de description d'un appareil. Données pures (aucun import Three.js) :
 * utilisables dans le worker physique, le worker CFD et le rendu.
 *
 * Repère modèle : origine = pointe avant du nez, X vers l'avant (donc les positions
 * sont négatives vers l'arrière), Y vers le haut, Z vers l'aile droite. Mètres.
 */

export type AircraftId = 'f22' | 'f35' | 'rafale' | 'a380' | 'b787' | 'dr400' | 'g8000';
export type AircraftCategory = 'fighter' | 'airliner' | 'bizjet' | 'ga';
export type FcsType = 'direct' | 'fbw';
export type EngineType = 'piston' | 'turbofan' | 'turbojet_ab';

export interface Airfoil {
  name: string;
  /** cambrure max (fraction de corde) et position (fraction) — ligne moyenne NACA 4 chiffres */
  camber: number;
  camberPos: number;
  /** épaisseur relative t/c */
  thickness: number;
  /** cl max 2D (lisse) */
  clMax: number;
}

export interface Station {
  /** bord d'attaque [x, y, z] repère modèle */
  le: [number, number, number];
  chord: number;
  /** vrillage géométrique (deg, + = cabreur) */
  twist: number;
}

export type ControlKind = 'elevator' | 'aileron' | 'rudder' | 'flap' | 'canard' | 'elevon' | 'ruddervator';

export interface ControlSurface {
  kind: ControlKind;
  /** fraction d'envergure (le long des stations) du début et de la fin */
  spanFrom: number;
  spanTo: number;
  /** fraction de corde arrière mobile (1 = surface entièrement mobile) */
  chordFrac: number;
  /** débattement max (deg) */
  maxDeg: number;
  /** nom du nœud 3D (sans suffixe _L/_R) */
  node: string;
}

export interface LiftingSurface {
  name: string;
  role: 'wing' | 'htail' | 'vtail' | 'canard';
  /** stations de la racine vers le saumon (demi-surface droite, ou dérive vers le haut) */
  stations: Station[];
  /** true : dupliquée en miroir (z → −z) */
  symmetric: boolean;
  airfoil: Airfoil;
  controls: ControlSurface[];
}

export interface Fuselage {
  length: number;
  width: number;
  height: number;
  /** position Y de l'axe du fuselage */
  axisY: number;
  /** facteur d'efficacité Munk (1 = fuselage cylindrique ; < 1 corps porteur « blended ») */
  munk?: number;
}

export interface EngineDef {
  type: EngineType;
  /** position de la tuyère / hélice (modèle) */
  pos: [number, number, number];
  /** poussée statique sèche niveau mer (N) — ou puissance (W) pour piston */
  thrustDry: number;
  /** poussée PC (N), 0 si pas de PC */
  thrustAB: number;
  /** consommation spécifique (kg/(N·h)) sèche et PC ; piston : kg/(W·h) */
  tsfc: number;
  tsfcAB: number;
  /** constante de temps de montée en régime (s) */
  spoolTime: number;
  /** taux de dilution (bypass) pour l'effet Mach */
  bypass: number;
  /** diamètre hélice (m), piston uniquement */
  propDiameter?: number;
  /** poussée vectorielle en tangage (deg max), 0 sinon */
  vectorDeg?: number;
}

export interface GearLeg {
  name: 'gear_front' | 'gear_main_L' | 'gear_main_R';
  /** point de contact roue sortie (modèle) */
  pos: [number, number, number];
  /** course amortisseur (m) */
  travel: number;
  steerable: boolean;
  braked: boolean;
  /** nombre de roues (rendu) */
  wheels: number;
  wheelRadius: number;
  /** bogies multiples (A380/B787) */
  bogies?: number;
}

export interface MassProps {
  empty: number;
  mtow: number;
  fuelMax: number;
  payloadMax: number;
  /** rayons de giration adimensionnels (Roskam) :
   *  roulis Ixx = m (Rx·b/2)², tangage = m (Ry·L/2)², lacet = m (Rz·(b+L)/4)² */
  kxx: number; // Rx roulis
  kyy: number; // Rz lacet
  kzz: number; // Ry tangage
}

export interface Performance {
  cd0: number;
  cdGear: number;
  cdFlaps: number;
  cdSpeedbrake: number;
  /** α de décrochage (deg) lisse et pleins volets */
  alphaStall: number;
  alphaStallFlaps: number;
  /** α max autorisé par la loi FBW (deg) */
  alphaMaxFcs: number;
  /** Mach critique de traînée (divergence) */
  mdd: number;
  /** limites facteur de charge */
  nzMax: number;
  nzMin: number;
  /** vitesse d'approche (kt) et de rotation (kt) */
  vApp: number;
  vR: number;
  /** pente de descente standard (deg) */
  glideDeg: number;
  /** taux de chute max admissible au toucher (m/s) */
  maxSinkRate: number;
  /** vitesse max (Mach) */
  mmo: number;
  /** débattements volets disponibles (fractions 0..1, détentes) */
  flapDetents: number[];
  /** déflexion volets max (deg) */
  flapMaxDeg: number;
  /** rigidité de flexion d'aile (m de flèche en bout d'aile par g supplémentaire) */
  wingFlexPerG: number;
}

export interface AircraftSpec {
  id: AircraftId;
  name: string;
  manufacturer: string;
  category: AircraftCategory;
  fcs: FcsType;
  /** dimensions constructeur */
  length: number;
  span: number;
  height: number;
  wingArea: number;
  surfaces: LiftingSurface[];
  fuselage: Fuselage;
  engines: EngineDef[];
  gear: GearLeg[];
  mass: MassProps;
  perf: Performance;
  hasHook: boolean;
  hasAfterburner: boolean;
  /** centrage par défaut (% MAC) et plage autorisée */
  xcgDefault: number;
  xcgRange: [number, number];
  /** position œil pilote (modèle) */
  eye: [number, number, number];
  /** couleur de livrée principale (hex) et secondaire */
  livery: { primary: number; secondary: number; accent: number };
  /** remarques de modélisation / sources */
  notes: string;
}

/** Corde aérodynamique moyenne d'une surface (demi-surface), position du BA de la MAC. */
export interface MacInfo {
  mac: number;
  xLE: number; // x du bord d'attaque de la MAC (modèle)
  yMac: number; // position en envergure
  area: number; // surface totale (les deux côtés si symétrique)
  span: number; // envergure totale
  aspect: number;
}

export function computeMac(s: LiftingSurface): MacInfo {
  let area = 0, macNum = 0, xNum = 0, yNum = 0, spanLen = 0;
  for (let i = 0; i < s.stations.length - 1; i++) {
    const a = s.stations[i], b = s.stations[i + 1];
    const dz = Math.hypot(b.le[2] - a.le[2], b.le[1] - a.le[1]); // longueur projetée normale à l'écoulement
    const c1 = a.chord, c2 = b.chord;
    const A = 0.5 * (c1 + c2) * dz;
    // intégrales exactes pour corde linéaire
    const macSeg = (dz / 3) * (c1 * c1 + c1 * c2 + c2 * c2);
    // x_LE linéaire, pondéré par c
    const xSeg = (dz / 6) * (a.le[0] * (2 * c1 + c2) + b.le[0] * (c1 + 2 * c2));
    const ySeg = (dz / 6) * (0 * (2 * c1 + c2) + dz * (c1 + 2 * c2)) + spanLen * A;
    area += A;
    macNum += macSeg;
    xNum += xSeg;
    yNum += ySeg;
    spanLen += dz;
  }
  const mult = s.symmetric ? 2 : 1;
  const mac = macNum / area;
  const span = spanLen * mult;
  const totalArea = area * mult;
  return { mac, xLE: xNum / area, yMac: yNum / area, area: totalArea, span, aspect: (span * span) / totalArea };
}
