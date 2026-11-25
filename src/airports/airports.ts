/**
 * Définitions des 4 aéroports + fonction géométrique exacte `getSurfaceInfo`.
 * Module pur (aucun import Three.js) : partagé par le worker physique (collisions) et le
 * rendu (maillages construits en échantillonnant exactement les mêmes fonctions).
 *
 * Repère monde : X = Est, Y = Haut, Z = Sud. Cap ψ → direction (sin ψ, 0, −cos ψ).
 */
import { clamp, fbm2, ridged2, smoothstep } from '../physics/math';

export type AirportId = 'lfbo' | 'lflj' | 'tffj' | 'cvn';
export type StartMode = 'cold' | 'runway' | 'final';

export interface ProfilePoint {
  s: number; // distance depuis le seuil (m) le long du QFU d'atterrissage
  h: number; // altitude (m)
}

export interface RunwayDef {
  id: string; // ex. « 14R »
  opposite: string; // ex. « 32L »
  /** seuil d'atterrissage (centre) */
  thrX: number;
  thrZ: number;
  heading: number; // QFU d'atterrissage (deg vrai)
  length: number;
  width: number;
  /** profil en long (linéaire par morceaux) */
  profile: ProfilePoint[];
  ils: boolean;
  /** plan de descente (deg) et hauteur de franchissement du seuil (m) */
  glideDeg: number;
  tch: number;
  papi: boolean;
}

export interface CarrierDef {
  /** position initiale du centre du navire (ligne de flottaison) */
  x0: number;
  z0: number;
  heading: number;
  speed: number; // m/s
  deckHeight: number; // m au-dessus de l'eau
  /** contour du pont (repère navire : x avant, z tribord) */
  deck: [number, number][];
  /** axe de la piste oblique : origine (rampe) et angle (deg, négatif = bâbord) */
  landingOrigin: [number, number];
  landingAngle: number;
  /** brins d'arrêt : distance depuis la rampe le long de l'axe oblique */
  wires: number[];
  wireHalfLength: number;
  /** catapultes : [x départ, z, x fin] repère navire */
  catapults: [number, number, number][];
  /** FLOLS : position repère navire et pente (deg) */
  flols: [number, number];
  glideDeg: number;
  /** île (superstructure) boîte repère navire : [x0, x1, z0, z1, hauteur] */
  island: [number, number, number, number, number];
}

export interface AirportDef {
  id: AirportId;
  icao: string;
  name: string;
  description: string;
  elevation: number; // m
  runways: RunwayDef[];
  carrier?: CarrierDef;
  /** parking (cold & dark) */
  parking: { x: number; z: number; heading: number };
  /** rayon du monde rendu (m) */
  radius: number;
  oceanLevel: number | null;
  /** couleur dominante du sol (rendu) */
  groundTint: number;
  /** variation magnétique ignorée : caps vrais */
}

export const SURF_TERRAIN = 0;
export const SURF_RUNWAY = 1;
export const SURF_WATER = 2;
export const SURF_DECK = 3;
export const SURF_GRASS = 4;

export interface SurfaceInfo {
  height: number;
  nx: number;
  ny: number;
  nz: number;
  /** vitesse de la surface (pont mobile), m/s monde */
  vx: number;
  vy: number;
  vz: number;
  kind: number;
  /** coefficient de frottement de roulement / freinage max */
  mu: number;
}

export function createSurfaceInfo(): SurfaceInfo {
  return { height: 0, nx: 0, ny: 1, nz: 0, vx: 0, vy: 0, vz: 0, kind: 0, mu: 0.8 };
}

const D2R = Math.PI / 180;

export function dirFromHeading(hdgDeg: number): [number, number] {
  return [Math.sin(hdgDeg * D2R), -Math.cos(hdgDeg * D2R)];
}

// ───────────────────────────── Définitions ─────────────────────────────

function lfbo(): AirportDef {
  // Toulouse-Blagnac : 14R/32L 3000 m et 14L/32R 3500 m, QFU 143°, 152 m.
  const e = 152;
  const [dx, dz] = dirFromHeading(143);
  const rx = -dz, rz = dx; // à droite du QFU 143
  return {
    id: 'lfbo', icao: 'LFBO', name: 'Toulouse-Blagnac',
    description: 'Doubles pistes 14/32, ILS catégorie III, PAPI 3°, hangars d\'assemblage.',
    elevation: e,
    runways: [
      {
        id: '14R', opposite: '32L', thrX: 0, thrZ: 0, heading: 143, length: 3000, width: 45,
        profile: [{ s: 0, h: e }, { s: 3000, h: e - 3 }], ils: true, glideDeg: 3, tch: 15, papi: true,
      },
      {
        id: '14L', opposite: '32R', thrX: -rx * 950 - dx * 400, thrZ: -rz * 950 - dz * 400, heading: 143, length: 3500, width: 45,
        profile: [{ s: 0, h: e + 1 }, { s: 3500, h: e - 2 }], ils: true, glideDeg: 3, tch: 15, papi: true,
      },
    ],
    parking: { x: -rx * 420 + dx * 900, z: -rz * 420 + dz * 900, heading: 53 },
    radius: 30000, oceanLevel: null, groundTint: 0x6f8a4a,
  };
}

function lflj(): AirportDef {
  // Courchevel : piste 22 (atterrissage en montée) 537 × 30 m, pente max 18,6 %.
  const top = 2008;
  const lowerLen = 290, upperLen = 247;
  const h0 = top - upperLen * 0.186 - lowerLen * 0.125;
  return {
    id: 'lflj', icao: 'LFLJ', name: 'Courchevel Altiport',
    description: 'Altiport alpin, piste de 537 m en pente jusqu\'à 18,6 %, approche à vue guidée (PAPI 4,5°).',
    elevation: top,
    runways: [
      {
        id: '22', opposite: '04', thrX: 0, thrZ: 0, heading: 220, length: lowerLen + upperLen, width: 30,
        profile: [
          { s: 0, h: h0 },
          { s: lowerLen, h: h0 + lowerLen * 0.125 },
          { s: lowerLen + upperLen, h: top },
          { s: lowerLen + upperLen + 90, h: top + 2 },
        ],
        ils: false, glideDeg: 4.5, tch: 12, papi: true,
      },
    ],
    parking: (() => {
      const [dx, dz] = dirFromHeading(220);
      return { x: dx * 590 + dz * 45, z: dz * 590 - dx * 45, heading: 130 };
    })(),
    radius: 26000, oceanLevel: null, groundTint: 0x8c9682,
  };
}

function tffj(): AirportDef {
  // Saint-Barthélemy Rémy de Haenen : piste 10/28, 646 × 18 m, approche 10 au-dessus du col de la Tourmente.
  return {
    id: 'tffj', icao: 'TFFJ', name: 'Saint-Barthélemy',
    description: 'Approche rasante au-dessus du col de la Tourmente, piste de 646 m finissant sur la baie de Saint-Jean.',
    elevation: 5,
    runways: [
      {
        id: '10', opposite: '28', thrX: 0, thrZ: 0, heading: 95, length: 646, width: 18,
        profile: [{ s: 0, h: 6 }, { s: 646, h: 3.5 }], ils: false, glideDeg: 6, tch: 12, papi: true,
      },
    ],
    parking: (() => {
      const [dx, dz] = dirFromHeading(95);
      return { x: dx * 300 - dz * 55, z: dz * 300 + dx * 55, heading: 5 };
    })(),
    radius: 22000, oceanLevel: 0, groundTint: 0x5f7d3c,
  };
}

function cvn(): AirportDef {
  return {
    id: 'cvn', icao: 'CVN', name: 'Porte-avions nucléaire (classe Nimitz)',
    description: 'Pont d\'envol mobile à 25 nœuds, 4 brins d\'arrêt, 2 catapultes d\'étrave, miroir FLOLS 3,5°.',
    elevation: 18.5,
    runways: [],
    carrier: {
      x0: 0, z0: 0, heading: 0, speed: 25 * 0.514444, deckHeight: 18.5,
      deck: [
        [166, -5], [166, 6], [150, 17], [40, 24], [-150, 22], [-166, 14], [-166, -12],
        [-140, -30], [-60, -38], [40, -31], [120, -20],
      ],
      landingOrigin: [-164, 6],
      landingAngle: -9,
      wires: [48, 60, 72, 84],
      wireHalfLength: 14,
      catapults: [[30, 9, 150], [30, -5, 150]],
      flols: [-40, -33],
      glideDeg: 3.5,
      island: [10, 52, 18, 28, 24],
    },
    parking: { x: 0, z: 0, heading: 0 },
    radius: 40000, oceanLevel: 0, groundTint: 0x1d4f73,
  };
}

const AIRPORTS: Record<AirportId, () => AirportDef> = { lfbo, lflj, tffj, cvn };
export const AIRPORT_IDS: AirportId[] = ['lfbo', 'lflj', 'tffj', 'cvn'];

export function getAirport(id: AirportId): AirportDef {
  return AIRPORTS[id]();
}

// ───────────────────────────── Géométrie piste ─────────────────────────────

/** Altitude du profil de piste à la distance s (extrapolée à plat hors profil). */
export function profileHeight(r: RunwayDef, s: number): number {
  const p = r.profile;
  if (s <= p[0].s) return p[0].h;
  for (let i = 0; i < p.length - 1; i++) {
    if (s <= p[i + 1].s) {
      const t = (s - p[i].s) / (p[i + 1].s - p[i].s);
      return p[i].h + (p[i + 1].h - p[i].h) * t;
    }
  }
  return p[p.length - 1].h;
}

/** Pente (dh/ds) du profil à s. */
export function profileSlope(r: RunwayDef, s: number): number {
  const p = r.profile;
  if (s < p[0].s) return 0;
  for (let i = 0; i < p.length - 1; i++) {
    if (s <= p[i + 1].s) return (p[i + 1].h - p[i].h) / (p[i + 1].s - p[i].s);
  }
  return 0;
}

/** Coordonnées piste (s le long du QFU, l latéral à droite) d'un point monde. */
export function runwayCoords(r: RunwayDef, x: number, z: number, out: { s: number; l: number }): { s: number; l: number } {
  const [dx, dz] = dirFromHeading(r.heading);
  const px = x - r.thrX, pz = z - r.thrZ;
  out.s = px * dx + pz * dz;
  out.l = px * -dz + pz * dx;
  return out;
}

// ───────────────────────────── Terrain analytique ─────────────────────────────

const _rc = { s: 0, l: 0 };

/** Hauteur brute du relief naturel (sans aplanissement des pistes). */
function naturalTerrain(ap: AirportDef, x: number, z: number): number {
  switch (ap.id) {
    case 'lfbo': {
      // Plaine de la Garonne, collines douces, vallée au nord-est
      const n = fbm2(x / 3500, z / 3500, 5, 11) * 55 + fbm2(x / 700, z / 700, 3, 5) * 6;
      const river = Math.exp(-Math.pow((x * 0.8 + z * 0.6 + 2500) / 600, 2)) * 18;
      return ap.elevation - 4 + n - river;
    }
    case 'lflj': {
      // Vallée glaciaire descendant vers le NE (axe d'approche 220 → on arrive du NE)
      const [dx, dz] = dirFromHeading(220);
      const s = x * dx + z * dz; // < 0 en amont de l'approche (vers la vallée)
      const l = -x * dz + z * dx;
      const valleyFloor = 2008 - 120 + Math.min(0, s) * 0.12 + Math.max(0, s - 700) * 0.05;
      const halfWidth = 650 + Math.max(0, -s) * 0.18;
      const sideRise = Math.pow(Math.max(0, Math.abs(l) - 80) / halfWidth, 1.6) * 900;
      const ridges = ridged2(x / 2600, z / 2600, 5, 41) * 1500 + fbm2(x / 600, z / 600, 4, 7) * 70;
      const mountains = 1300 + ridges;
      const valley = valleyFloor + sideRise + fbm2(x / 900, z / 900, 3, 3) * 40;
      // le relief est le max entre fond de vallée et montagnes atténuées dans l'axe
      const axis = smoothstep(0, 1, Math.abs(l) / (halfWidth * 1.3));
      return Math.max(valley, mountains * (0.55 + 0.45 * axis));
    }
    case 'tffj': {
      // Île volcanique : collines 100–280 m, col de la Tourmente à l'ouest du seuil 10
      const [dx, dz] = dirFromHeading(95);
      const s = x * dx + z * dz;
      const l = -x * dz + z * dx;
      const rIsland = Math.hypot(x / 4200, (z + 400) / 2600);
      const island = Math.max(0, 1 - rIsland * rIsland) * (130 + fbm2(x / 1400, z / 1400, 4, 9) * 160);
      // col : selle centrée 260 m avant le seuil, crête 25 m, épaules 110 m de part et d'autre
      const colS = s + 260;
      const saddle = 25 * Math.exp(-(colS * colS) / (120 * 120)) + Math.min(110, Math.pow(Math.abs(l) / 140, 2) * 30) * Math.exp(-(colS * colS) / (500 * 500));
      // baie de Saint-Jean à l'est de la piste : on creuse vers l'océan
      const bay = smoothstep(560, 760, s) * smoothstep(-300, 0, -Math.abs(l) + 300) * 60;
      const beachFlat = smoothstep(-200, 60, s) * smoothstep(900, 640, s) * smoothstep(260, 90, Math.abs(l));
      const h = (island + saddle) * (1 - beachFlat * 0.9) - bay - 6 + beachFlat * 9;
      return h;
    }
    case 'cvn':
      return -30; // fond (inutilisé : océan)
  }
}

/** Masque d'aplanissement autour des pistes (1 sur la piste et l'accotement). */
function runwayBlend(ap: AirportDef, x: number, z: number, terrain: number): number {
  let h = terrain;
  for (const r of ap.runways) {
    runwayCoords(r, x, z, _rc);
    const s = _rc.s, l = Math.abs(_rc.l);
    const ext = r.id === '22' ? 60 : 300; // prolongement (prolongement d'arrêt + RESA)
    const sIn = clamp(s, -ext, r.length + ext);
    const ds = Math.abs(s - sIn);
    const halfFlat = r.width / 2 + (ap.id === 'lflj' ? 25 : 90);
    const blendW = ap.id === 'lflj' ? 60 : ap.id === 'tffj' ? 60 : 400;
    const d = Math.max(0, l - halfFlat) + ds;
    const w = 1 - smoothstep(0, blendW, d);
    if (w > 0) {
      const ph = profileHeight(r, sIn);
      h = h * (1 - w) + ph * w;
    }
  }
  return h;
}

/** Altitude du sol (hors porte-avions) — fonction partagée rendu/physique. */
export function terrainHeight(ap: AirportDef, x: number, z: number): number {
  if (ap.id === 'cvn') return -30;
  const t = naturalTerrain(ap, x, z);
  return runwayBlend(ap, x, z, t);
}

// ───────────────────────────── Porte-avions ─────────────────────────────

export interface CarrierPose {
  x: number;
  z: number;
  heading: number; // rad
  pitch: number; // rad (+ étrave haute)
  roll: number; // rad (+ tribord bas)
  heave: number; // m
  vx: number;
  vz: number;
  pitchRate: number;
  rollRate: number;
  heaveRate: number;
}

export function createCarrierPose(): CarrierPose {
  return { x: 0, z: 0, heading: 0, pitch: 0, roll: 0, heave: 0, vx: 0, vz: 0, pitchRate: 0, rollRate: 0, heaveRate: 0 };
}

/** Mouvement déterministe du navire (houle) à l'instant t. */
export function carrierPose(c: CarrierDef, t: number, out: CarrierPose, seaState = 1): CarrierPose {
  const h = c.heading * D2R;
  const dx = Math.sin(h), dz = -Math.cos(h);
  out.x = c.x0 + dx * c.speed * t;
  out.z = c.z0 + dz * c.speed * t;
  out.heading = h;
  out.vx = dx * c.speed;
  out.vz = dz * c.speed;
  const wp = (2 * Math.PI) / 9, wr = (2 * Math.PI) / 13, wh = (2 * Math.PI) / 8;
  const ap = 0.45 * D2R * seaState, ar = 0.7 * D2R * seaState, ah = 0.45 * seaState;
  out.pitch = ap * Math.sin(wp * t);
  out.roll = ar * Math.sin(wr * t + 1);
  out.heave = ah * Math.sin(wh * t + 0.5);
  out.pitchRate = ap * wp * Math.cos(wp * t);
  out.rollRate = ar * wr * Math.cos(wr * t + 1);
  out.heaveRate = ah * wh * Math.cos(wh * t + 0.5);
  return out;
}

/** Monde → repère navire (x avant, z tribord), sans tangage/roulis. */
export function worldToShip(p: CarrierPose, x: number, z: number, out: { s: number; l: number }): { s: number; l: number } {
  const dx = Math.sin(p.heading), dz = -Math.cos(p.heading);
  const px = x - p.x, pz = z - p.z;
  out.s = px * dx + pz * dz;
  out.l = px * -dz + pz * dx;
  return out;
}

/** Repère navire → monde (x, z). */
export function shipToWorld(p: CarrierPose, s: number, l: number, out: number[]): number[] {
  const dx = Math.sin(p.heading), dz = -Math.cos(p.heading);
  out[0] = p.x + dx * s - dz * l;
  out[1] = p.z + dz * s + dx * l;
  return out;
}

/** Point dans polygone (ray casting). */
export function insidePolygon(poly: [number, number][], s: number, l: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [si, li] = poly[i], [sj, lj] = poly[j];
    if (li > l !== lj > l && s < ((sj - si) * (l - li)) / (lj - li) + si) inside = !inside;
  }
  return inside;
}

/** Altitude du pont au point navire (s, l). */
export function deckHeightAt(c: CarrierDef, p: CarrierPose, s: number, l: number): number {
  return c.deckHeight + p.heave + s * Math.tan(p.pitch) - l * Math.tan(p.roll);
}

// ───────────────────────────── getSurfaceInfo ─────────────────────────────

const _sc = { s: 0, l: 0 };
const _pose = createCarrierPose();

/**
 * Source de vérité unique du sol : hauteur, normale, vitesse de surface et nature.
 * @param t temps de simulation (s) — pilote le mouvement du porte-avions
 */
export function getSurfaceInfo(ap: AirportDef, x: number, z: number, t: number, out: SurfaceInfo, pose?: CarrierPose): SurfaceInfo {
  out.vx = 0; out.vy = 0; out.vz = 0;
  if (ap.carrier) {
    const c = ap.carrier;
    const p = pose ?? carrierPose(c, t, _pose);
    worldToShip(p, x, z, _sc);
    if (insidePolygon(c.deck, _sc.s, _sc.l)) {
      const h = deckHeightAt(c, p, _sc.s, _sc.l);
      // normale : gradient de h dans le repère navire, tourné en monde
      const gs = Math.tan(p.pitch), gl = -Math.tan(p.roll);
      const dx = Math.sin(p.heading), dz = -Math.cos(p.heading);
      // dh/dx_monde = gs*dx + gl*(-dz) ; dh/dz_monde = gs*dz + gl*dx
      const hx = gs * dx - gl * dz, hz = gs * dz + gl * dx;
      const inv = 1 / Math.sqrt(1 + hx * hx + hz * hz);
      out.height = h;
      out.nx = -hx * inv; out.ny = inv; out.nz = -hz * inv;
      // vitesse : translation + houle + rotation (tangage/roulis) + lacet nul
      out.vx = p.vx; out.vz = p.vz;
      out.vy = p.heaveRate + _sc.s * p.pitchRate - _sc.l * p.rollRate;
      out.kind = SURF_DECK;
      out.mu = 0.75;
      return out;
    }
    out.height = 0; out.nx = 0; out.ny = 1; out.nz = 0; out.kind = SURF_WATER; out.mu = 0.05;
    return out;
  }
  // Piste : plan exact
  for (const r of ap.runways) {
    runwayCoords(r, x, z, _rc);
    if (_rc.s >= 0 && _rc.s <= r.length && Math.abs(_rc.l) <= r.width / 2) {
      out.height = profileHeight(r, _rc.s);
      const g = profileSlope(r, _rc.s);
      const [dx, dz] = dirFromHeading(r.heading);
      const inv = 1 / Math.sqrt(1 + g * g);
      out.nx = -g * dx * inv; out.ny = inv; out.nz = -g * dz * inv;
      out.kind = SURF_RUNWAY;
      out.mu = 0.8;
      return out;
    }
  }
  const h = terrainHeight(ap, x, z);
  if (ap.oceanLevel !== null && h < ap.oceanLevel) {
    out.height = ap.oceanLevel; out.nx = 0; out.ny = 1; out.nz = 0; out.kind = SURF_WATER; out.mu = 0.05;
    return out;
  }
  const e = 1.5;
  const hx = (terrainHeight(ap, x + e, z) - terrainHeight(ap, x - e, z)) / (2 * e);
  const hz = (terrainHeight(ap, x, z + e) - terrainHeight(ap, x, z - e)) / (2 * e);
  const inv = 1 / Math.sqrt(1 + hx * hx + hz * hz);
  out.height = h; out.nx = -hx * inv; out.ny = inv; out.nz = -hz * inv;
  out.kind = SURF_GRASS;
  out.mu = 0.55;
  return out;
}

// ───────────────────────────── Aides à l'approche ─────────────────────────────

export interface ApproachRef {
  /** point de toucher visé (monde) et altitude */
  x: number;
  z: number;
  y: number;
  heading: number; // deg
  glideDeg: number;
  /** antenne localizer (fin de piste) */
  locX: number;
  locZ: number;
  hasIls: boolean;
}

/** Référence d'approche d'une piste (ou du pont oblique à l'instant t). */
export function approachRef(ap: AirportDef, t: number, runwayIdx = 0, out?: ApproachRef): ApproachRef {
  const o = out ?? { x: 0, z: 0, y: 0, heading: 0, glideDeg: 3, locX: 0, locZ: 0, hasIls: false };
  if (ap.carrier) {
    const c = ap.carrier;
    const p = carrierPose(c, t, _pose);
    const ang = c.landingAngle * D2R;
    const ls = c.landingOrigin[0], ll = c.landingOrigin[1];
    // point d'impact crosse visé : entre brins 2 et 3
    const sT = (c.wires[1] + c.wires[2]) / 2;
    const tx = ls + Math.cos(ang) * sT, tl = ll + Math.sin(ang) * sT;
    const w = shipToWorld(p, tx, tl, [0, 0]);
    const wl = shipToWorld(p, ls + Math.cos(ang) * 400, ll + Math.sin(ang) * 400, [0, 0]);
    o.x = w[0]; o.z = w[1]; o.y = c.deckHeight + p.heave;
    o.heading = ((p.heading + ang) / D2R + 360) % 360;
    o.glideDeg = c.glideDeg;
    o.locX = wl[0]; o.locZ = wl[1];
    o.hasIls = true; // ICLS/ACLS embarqué
    return o;
  }
  const r = ap.runways[runwayIdx];
  const [dx, dz] = dirFromHeading(r.heading);
  const aim = r.length > 1500 ? 300 : r.length * 0.12; // antenne GS / zone de toucher
  o.x = r.thrX + dx * aim; o.z = r.thrZ + dz * aim;
  o.y = profileHeight(r, aim);
  o.heading = r.heading;
  o.glideDeg = r.glideDeg;
  o.locX = r.thrX + dx * (r.length + 300);
  o.locZ = r.thrZ + dz * (r.length + 300);
  o.hasIls = r.ils;
  return o;
}

export interface IlsDeviation {
  /** écarts en « points » (±2 = pleine échelle), + = l'avion est à droite / au-dessus */
  loc: number;
  gs: number;
  /** angles bruts (deg) */
  locDeg: number;
  gsDeg: number;
  distance: number; // m jusqu'au point de toucher
  valid: boolean;
}

/** Écarts ILS calculés géométriquement (localizer ±2,5° pleine échelle, glide ±0,7°). */
export function ilsDeviation(ref: ApproachRef, x: number, y: number, z: number, out: IlsDeviation): IlsDeviation {
  const [dx, dz] = dirFromHeading(ref.heading);
  // localizer : angle vu depuis l'antenne en bout de piste
  const lx = x - ref.locX, lz = z - ref.locZ;
  const along = -(lx * dx + lz * dz); // distance devant l'antenne (côté approche)
  const lat = lx * -dz + lz * dx; // + à droite de l'axe
  out.locDeg = Math.atan2(lat, Math.max(1, along)) / D2R;
  out.loc = clamp(out.locDeg / 1.25, -2.5, 2.5);
  const px = x - ref.x, pz = z - ref.z;
  const dist = -(px * dx + pz * dz);
  out.distance = Math.hypot(px, pz);
  const h = y - ref.y;
  out.gsDeg = Math.atan2(h, Math.max(1, dist)) / D2R - ref.glideDeg;
  out.gs = clamp(out.gsDeg / 0.35, -2.5, 2.5);
  out.valid = ref.hasIls && along > 0 && dist > -50 && Math.abs(out.locDeg) < 35 && out.distance < 46000;
  return out;
}

/** PAPI : nombre de feux blancs (0..4) vu depuis l'œil (angles 2,5/2,83/3,17/3,5° autour de la pente). */
export function papiWhiteCount(ref: ApproachRef, eyeX: number, eyeY: number, eyeZ: number): number {
  const [dx, dz] = dirFromHeading(ref.heading);
  const px = eyeX - ref.x, pz = eyeZ - ref.z;
  const dist = -(px * dx + pz * dz);
  if (dist <= 0) return 2;
  const ang = Math.atan2(eyeY - ref.y, dist) / D2R;
  const g = ref.glideDeg;
  let n = 0;
  for (const off of [-0.5, -0.17, 0.17, 0.5]) if (ang > g + off) n++;
  return n;
}

/**
 * FLOLS « meatball » : position verticale de la boule en cellules (−2.5..+2.5), 0 = sur le plan.
 * Calculée depuis la crosse vers le point d'impact visé.
 */
export function flolsBall(ref: ApproachRef, hookX: number, hookY: number, hookZ: number): number {
  const [dx, dz] = dirFromHeading(ref.heading);
  const px = hookX - ref.x, pz = hookZ - ref.z;
  const dist = -(px * dx + pz * dz);
  if (dist <= 1) return 0;
  const ang = Math.atan2(hookY - ref.y, dist) / D2R;
  return clamp((ang - ref.glideDeg) / 0.3, -2.6, 2.6);
}

/** Position de départ (monde) et cap selon le mode choisi. */
export interface StartPose {
  x: number;
  y: number; // altitude du sol (cold/runway) ou de l'avion (final)
  z: number;
  heading: number;
  airborne: boolean;
  speed: number; // m/s
  gamma: number; // pente (rad)
  onCatapult: number; // index catapulte ou −1
}

export function startPose(ap: AirportDef, mode: StartMode, vAppMs: number, glideOverride?: number, stovl = false): StartPose {
  if (ap.carrier) {
    const c = ap.carrier;
    const p = carrierPose(c, 0, createCarrierPose());
    if (mode === 'final') {
      const ref = approachRef(ap, 0);
      const g = (glideOverride ?? c.glideDeg) * D2R;
      // l'avion rattrape le navire : on vise le point futur (temps de vol ≈ d / (V − Vs))
      const d = 5 * 1852;
      const [dx, dz] = dirFromHeading(ref.heading);
      return {
        x: ref.x - dx * d, z: ref.z - dz * d, y: ref.y + d * Math.tan(g) + 4, heading: ref.heading,
        airborne: true, speed: vAppMs, gamma: -g, onCatapult: -1,
      };
    }
    if (stovl && mode === 'runway') {
      // F-35B : décollage court (STO) depuis l'arrière du pont, sans catapulte
      const w = shipToWorld(p, -120, 4, [0, 0]);
      return { x: w[0], z: w[1], y: c.deckHeight, heading: c.heading, airborne: false, speed: c.speed, gamma: 0, onCatapult: -1 };
    }
    const cat = c.catapults[0];
    const w = shipToWorld(p, cat[0], cat[1], [0, 0]);
    return { x: w[0], z: w[1], y: c.deckHeight, heading: c.heading, airborne: false, speed: c.speed, gamma: 0, onCatapult: mode === 'runway' ? 0 : -1 };
  }
  const r = ap.runways[0];
  const [dx, dz] = dirFromHeading(r.heading);
  if (mode === 'cold') {
    const pk = ap.parking;
    return { x: pk.x, z: pk.z, y: terrainHeight(ap, pk.x, pk.z), heading: pk.heading, airborne: false, speed: 0, gamma: 0, onCatapult: -1 };
  }
  if (mode === 'runway') {
    const s = 40;
    return { x: r.thrX + dx * s, z: r.thrZ + dz * s, y: profileHeight(r, s), heading: r.heading, airborne: false, speed: 0, gamma: 0, onCatapult: -1 };
  }
  const ref = approachRef(ap, 0, 0);
  const g = (glideOverride ?? r.glideDeg) * D2R;
  const d = 5 * 1852;
  return {
    x: ref.x - dx * d, z: ref.z - dz * d, y: ref.y + d * Math.tan(g) + r.tch * 0.2, heading: r.heading,
    airborne: true, speed: vAppMs, gamma: -g, onCatapult: -1,
  };
}
