/**
 * Calculs de la soufflerie numérique (exécutés dans cfd.worker.ts) :
 * - solution VLM fine → ΔCp, Cp extrados/intrados (épaisseur + Prandtl-Glauert) ;
 * - zones supersoniques locales (Cp < Cp*) et position de l'onde de choc par bande ;
 * - couche limite : transition laminaire/turbulent, Cf, τw, décollement (boundaryLayer.ts) ;
 * - contraintes structurelles de flexion σ/σ_adm et flèche (boundaryLayer.ts) ;
 * - vitesse maximale en palier (poussée disponible = traînée) et limite MMO ;
 * - lignes de courant 3D (râteau d'entrée + graines d'aile + tourbillons marginaux) intégrées en
 *   RK2 dans le champ VLM + filaments de tourbillons de bord d'attaque (Polhamus), avec
 *   classification laminaire / turbulent (sillages, couche limite) / tourbillon / décollé ;
 * - polaires issues EXACTEMENT du modèle de vol (FlightModel.coefficients) ;
 * - dérivées couplées + verdict « Fly it or Not ».
 */
import type { AircraftId } from '../aircraft/types';
import { computeMac } from '../aircraft/types';
import { buildSpec, type GeometryMods } from '../aircraft/mods';
import { addFilament, buildLattice, controlDeflection, VlmSolver, type FlowCondition } from './vlm';
import { computeDerivatives, npPercent, staticMargin, verdict, type AeroDerivatives, type Verdict } from './derivatives';
import { FlightModel } from '../physics/flightModel';
import { createAtmo, isa } from '../physics/isa';
import { steadyThrust } from '../physics/engine';
import { G0 } from '../physics/math';
import { boundaryLayer, structuralStress, type BoundaryLayerResult, type StressResult } from './boundaryLayer';

export interface TunnelRequest {
  id: number;
  aircraft: AircraftId;
  mods: GeometryMods;
  xcgPct: number;
  alphaDeg: number;
  betaDeg: number;
  mach: number;
  altitude: number;
  flap: number; // 0..1
  massKg: number;
  fuelKg: number;
  streamlines: boolean;
}

export interface TunnelGeometry {
  /** coins des panneaux (12 floats / panneau) */
  corners: Float32Array;
  /** normales géométriques (3 / panneau) */
  normals: Float32Array;
  /** u0,u1 (fraction de corde) et corde locale aux bords int./ext. (4 / panneau) */
  chordInfo: Float32Array;
  thickness: Float32Array;
  surf: Int16Array;
  strip: Int32Array;
  role: string[];
  n: number;
  fuselage: { length: number; width: number; height: number; axisY: number; noseFrac: number; tailFrac: number };
  span: number;
  length: number;
  xcg: number;
  xnp: number;
  macLE: number;
  mac: number;
}

export interface VmaxResult {
  mach: number;
  tasKt: number;
  /** limitation retenue */
  limitedBy: 'poussée' | 'MMO';
  machPropulsive: number;
  mmo: number;
  curveMach: Float32Array;
  curveThrust: Float32Array; // kN
  curveDrag: Float32Array; // kN
}

export interface TunnelResult {
  id: number;
  geometry: TunnelGeometry;
  cpUpper: Float32Array;
  cpLower: Float32Array;
  dCp: Float32Array;
  supersonic: Uint8Array;
  /** segments de choc : (x,y,z bas, x,y,z haut) × k, hauteur ∝ intensité */
  shock: Float32Array;
  cpStar: number;
  CL: number;
  CLvortex: number;
  CDi: number;
  CDtot: number;
  Cm: number;
  LD: number;
  spanLoad: Float32Array;
  oswaldVlm: number;
  bl: BoundaryLayerResult;
  stress: StressResult;
  vmax: VmaxResult;
  polar: { alpha: Float32Array; CL: Float32Array; CD: Float32Array; Cm: Float32Array; LD: Float32Array };
  deriv: AeroDerivatives;
  npPct: number;
  staticMarginPct: number;
  verdict: Verdict;
  verdictReason: string;
  machCone: number; // demi-angle (rad) ou 0
  V: number;
  rho: number;
  mu: number;
  mach: number;
  elapsedMs: number;
}

/** Régimes d'écoulement des points de lignes de courant. */
export const FLOW_LAMINAR = 0;
export const FLOW_TURBULENT = 1;
export const FLOW_VORTEX = 2;
export const FLOW_SEPARATED = 3;

export interface StreamlineResult {
  id: number;
  /** positions (3/pt) ; lignes séparées par offsets */
  points: Float32Array;
  /** |V| (m/s) par point */
  speed: Float32Array;
  /** régime par point (FLOW_*) */
  regime: Uint8Array;
  offsets: Int32Array;
  /** graines du râteau d'entrée (3/pt) */
  seeds: Float32Array;
  /** lignes « tourbillon » (marginal ou bord d'attaque) */
  vortexFlags: Uint8Array;
  /** filaments tourbillonnaires de bord d'attaque (6 floats / segment) */
  leVortex: Float32Array;
  vMax: number;
  /** bornes robustes de |V| (percentiles 1 % / 99 %) pour la légende */
  vLo: number;
  vHi: number;
  bounds: [number, number, number, number, number, number];
  elapsedMs: number;
}

const DEG = Math.PI / 180;

/** Coefficient de pression critique (sonique local). */
export function cpCritical(M: number): number {
  if (M <= 0.05) return -1e9;
  const g = 1.4;
  return (2 / (g * M * M)) * (Math.pow((2 + (g - 1) * M * M) / (g + 1), g / (g - 1)) - 1);
}

/** Cp d'épaisseur (théorie des profils minces, approximation analytique). */
function cpThickness(u: number, tc: number): number {
  if (u < 0.025) return 1 - (u / 0.025) * (1 + 2.4 * tc);
  const x = u;
  return -2.4 * tc * Math.max(0, 1 - 2.2 * (x - 0.32) * (x - 0.32)) * (1 - 0.6 * x);
}

interface Cache {
  key: string;
  spec: ReturnType<typeof buildSpec>;
  fine: VlmSolver;
  coarse: VlmSolver;
  deriv: AeroDerivatives;
  geometry: TunnelGeometry | null;
  fm: FlightModel | null;
  /** dernier résultat (pour classer les régimes des lignes de courant) */
  lastTransition: number;
  lastSeparated: number;
}
let cache: Cache | null = null;

function getCache(req: TunnelRequest): Cache {
  const key = `${req.aircraft}|${JSON.stringify(req.mods)}`;
  if (cache && cache.key === key) return cache;
  const spec = buildSpec(req.aircraft, req.mods);
  const mac = computeMac(spec.surfaces[0]);
  const fineL = buildLattice(spec, { nc: 8, nsTotal: 18 });
  const coarseL = buildLattice(spec, { nc: 3, nsTotal: 9 });
  const deriv = computeDerivatives(spec);
  cache = {
    key, spec, deriv,
    fine: new VlmSolver(fineL, spec.wingArea, mac.mac, spec.span),
    coarse: new VlmSolver(coarseL, spec.wingArea, mac.mac, spec.span),
    geometry: null, fm: null, lastTransition: 0.3, lastSeparated: 0,
  };
  return cache;
}

function buildGeometry(c: Cache, xcg: number): TunnelGeometry {
  const L = c.fine.L;
  const n = L.n;
  const corners = new Float32Array(12 * n);
  const normals = new Float32Array(3 * n);
  const chordInfo = new Float32Array(4 * n);
  const thickness = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 12; k++) corners[12 * i + k] = L.corners[12 * i + k];
    const sx = L.s[3 * i], sy = L.s[3 * i + 1], sz = L.s[3 * i + 2];
    let nx = 0, ny = sz, nz = -sy;
    const vertical = Math.abs(sy) > Math.abs(sz);
    if ((vertical && nz < 0 && L.side[i] > 0) || (!vertical && ny < 0)) { nx = -nx; ny = -ny; nz = -nz; }
    if (vertical && L.side[i] < 0 && nz > 0) { nx = -nx; ny = -ny; nz = -nz; }
    void sx;
    normals[3 * i] = nx; normals[3 * i + 1] = ny; normals[3 * i + 2] = nz;
    const r = L.row[i];
    const u0 = r / L.nc, u1 = (r + 1) / L.nc;
    const cIn = Math.hypot(corners[12 * i + 9] - corners[12 * i], corners[12 * i + 10] - corners[12 * i + 1], corners[12 * i + 11] - corners[12 * i + 2]) / (u1 - u0);
    const cOut = Math.hypot(corners[12 * i + 6] - corners[12 * i + 3], corners[12 * i + 7] - corners[12 * i + 4], corners[12 * i + 8] - corners[12 * i + 5]) / (u1 - u0);
    chordInfo[4 * i] = u0; chordInfo[4 * i + 1] = u1; chordInfo[4 * i + 2] = cIn; chordInfo[4 * i + 3] = cOut;
    thickness[i] = L.surfaces[L.surf[i]].airfoil.thickness;
  }
  const spec = c.spec;
  const fighter = spec.category === 'fighter';
  return {
    corners, normals, chordInfo, thickness, surf: L.surf.slice(), strip: L.strip.slice(), role: spec.surfaces.map((s) => s.role), n,
    fuselage: { ...spec.fuselage, noseFrac: fighter ? 0.28 : spec.category === 'ga' ? 0.18 : 0.12, tailFrac: fighter ? 0.12 : 0.3 },
    span: spec.span, length: spec.length, xcg, xnp: c.deriv.xnp, macLE: c.deriv.xMacLE, mac: c.deriv.cref,
  };
}

const atmo = createAtmo();

function flightModelFor(c: Cache, xcgPct: number): FlightModel {
  if (!c.fm || Math.abs(c.fm.xcgPct - xcgPct) > 1e-6) {
    c.fm = new FlightModel({
      spec: c.spec, aero: c.deriv, airport: 'lfbo', startMode: 'runway', fuelKg: c.spec.mass.fuelMax * 0.4, payloadKg: 0,
      xcgPct, wind: { fromDeg: 0, speed: 0, turbulence: 0 }, deltaIsa: 0, seaState: 0,
    });
  }
  return c.fm;
}

/** Vitesse maximale en palier : plus grand Mach où la poussée maximale ≥ traînée trimée. */
function computeVmax(c: Cache, fm: FlightModel, altitude: number, mass: number): VmaxResult {
  const spec = c.spec;
  isa(altitude, atmo);
  const S = spec.wingArea;
  const W = mass * G0;
  const mTop = spec.category === 'fighter' ? 2.6 : 1.05;
  const curveMach: number[] = [], thrust: number[] = [], drag: number[] = [];
  let mProp = 0;
  fm.flap = 0; fm.gearPos = 0; fm.spoiler = 0; fm.speedbrake = 0;
  for (let M = 0.1; M <= mTop + 1e-9; M += 0.02) {
    const V = M * atmo.a;
    const q = 0.5 * atmo.rho * V * V;
    const CLreq = W / (q * S);
    // α par Newton sur CL(α)
    let a = 2 * DEG;
    for (let it = 0; it < 12; it++) {
      const cl = fm.coefficients(a, 0, 0, 0, 0, V, M, 0, 0, 0, 5000).CL;
      const cl2 = fm.coefficients(a + 0.2 * DEG, 0, 0, 0, 0, V, M, 0, 0, 0, 5000).CL;
      const slope = Math.max(0.3, (cl2 - cl) / (0.2 * DEG));
      a = Math.max(-6 * DEG, Math.min(25 * DEG, a + (CLreq - cl) / slope));
    }
    const CD = fm.coefficients(a, 0, 0, 0, 0, V, M, 0, 0, 0, 5000).CD;
    const D = CD * q * S;
    let T = 0;
    for (const e of spec.engines) T += steadyThrust(e, 1, atmo.sigma, M, V);
    curveMach.push(M); thrust.push(T / 1000); drag.push(D / 1000);
    if (T >= D) mProp = M;
  }
  const mach = Math.min(mProp, spec.perf.mmo);
  return {
    mach, tasKt: (mach * atmo.a) / 0.514444, limitedBy: mProp < spec.perf.mmo ? 'poussée' : 'MMO', machPropulsive: mProp, mmo: spec.perf.mmo,
    curveMach: new Float32Array(curveMach), curveThrust: new Float32Array(thrust), curveDrag: new Float32Array(drag),
  };
}

export function runTunnel(req: TunnelRequest): TunnelResult {
  const t0 = performance.now();
  const c = getCache(req);
  const spec = c.spec;
  const d = c.deriv;
  isa(req.altitude, atmo);
  const V = Math.max(10, req.mach * atmo.a);
  const xcg = d.xMacLE - (req.xcgPct / 100) * d.cref;
  const cond: FlowCondition = {
    alpha: req.alphaDeg * DEG, beta: req.betaDeg * DEG, p: 0, q: 0, r: 0, V, mach: req.mach, rho: atmo.rho, ref: [xcg, 0, 0],
  };
  const L = c.fine.L;
  if (req.flap > 0 && spec.perf.flapMaxDeg > 0) {
    cond.deflection = controlDeflection(L, ['flap'], (_s, _k, m) => req.flap * Math.min(m, 40 * DEG) * 0.8);
  }
  const res = c.fine.solve(cond);
  const n = L.n;
  const beta = Math.sqrt(Math.max(0.05, 1 - Math.min(req.mach, 0.95) ** 2));
  const cpUpper = new Float32Array(n), cpLower = new Float32Array(n), dCp = new Float32Array(n);
  const supersonic = new Uint8Array(n);
  const cpStar = cpCritical(req.mach);
  for (let i = 0; i < n; i++) {
    const tc = L.surfaces[L.surf[i]].airfoil.thickness;
    const ct = cpThickness(L.uMid[i], tc) / (L.uMid[i] < 0.025 ? 1 : beta);
    const dcp = res.dCp[i];
    dCp[i] = dcp;
    cpUpper[i] = Math.max(-6, ct - dcp / 2);
    cpLower[i] = Math.max(-6, ct + dcp / 2);
    if (cpUpper[i] < cpStar) supersonic[i] = 1;
  }
  // onde de choc : fin de la poche supersonique de chaque bande (extrados)
  const shock: number[] = [];
  if (req.mach > 0.55) {
    for (let sIdx = 0; sIdx < L.nStrips; sIdx++) {
      let last = -1, minCp = 0;
      for (let r = 0; r < L.nc; r++) {
        const i = sIdx * L.nc + r;
        if (supersonic[i]) { last = i; minCp = Math.min(minCp, cpUpper[i]); }
      }
      if (last < 0) continue;
      const role = spec.surfaces[L.surf[last]].role;
      if (role === 'vtail') continue;
      const k = 12 * last;
      const x = 0.5 * (L.corners[k + 6] + L.corners[k + 9]);
      const y = 0.5 * (L.corners[k + 7] + L.corners[k + 10]);
      const z = 0.5 * (L.corners[k + 8] + L.corners[k + 11]);
      const strength = Math.min(1.6, Math.sqrt(Math.max(0, (cpStar - minCp) * 1.4)));
      const chord = (L.corners[k + 6] - L.corners[k + 3]) / (1 / L.nc) || 1;
      const h = Math.abs(chord) * 0.08 + strength * Math.abs(chord) * 0.35;
      shock.push(x, y, z, x, y + h, z);
    }
  }
  const machCone = req.mach > 1 ? Math.asin(1 / req.mach) : 0;

  const fm = flightModelFor(c, req.xcgPct);
  fm.flap = req.flap; fm.gearPos = 0; fm.spoiler = 0; fm.speedbrake = 0; fm.agl = 5000;
  const na = 31;
  const polar = { alpha: new Float32Array(na), CL: new Float32Array(na), CD: new Float32Array(na), Cm: new Float32Array(na), LD: new Float32Array(na) };
  for (let i = 0; i < na; i++) {
    const a = -6 + i;
    const ac = fm.coefficients(a * DEG, 0, 0, 0, 0, V, req.mach, 0, 0, 0, 5000);
    polar.alpha[i] = a; polar.CL[i] = ac.CL; polar.CD[i] = ac.CD; polar.Cm[i] = ac.Cm; polar.LD[i] = ac.CL / Math.max(1e-4, ac.CD);
  }
  const cur = fm.coefficients(req.alphaDeg * DEG, req.betaDeg * DEG, 0, 0, 0, V, req.mach, 0, 0, 0, 5000);
  const CLvortex = cur.CLvortex;
  const curCL = cur.CL, curCD = cur.CD, curCm = cur.Cm;
  const bl = boundaryLayer(spec, L, res, cpUpper, cpLower, V, atmo.rho, atmo.mu, req.mach, spec.wingArea, d.cref);
  const stress = structuralStress(spec, L, res, req.massKg, req.fuelKg, 0.5 * atmo.rho * V * V);
  let trSum = 0, trN = 0;
  for (let s = 0; s < L.nStrips; s++) if (spec.surfaces[L.surf[s * L.nc]].role === 'wing') { trSum += bl.transitionUpper[s]; trN++; }
  c.lastTransition = trN ? trSum / trN : 0.3;
  c.lastSeparated = bl.separatedFraction;
  const vmax = computeVmax(c, fm, req.altitude, req.massKg);
  fm.flap = req.flap;
  isa(req.altitude, atmo);
  const v = verdict(d, req.xcgPct, spec.fcs === 'fbw');
  const AR = d.aspect;
  if (!c.geometry || Math.abs(c.geometry.xcg - xcg) > 1e-6) c.geometry = buildGeometry(c, xcg);
  return {
    id: req.id, geometry: c.geometry, cpUpper, cpLower, dCp, supersonic, shock: new Float32Array(shock), cpStar,
    CL: curCL, CLvortex, CDi: res.CD, CDtot: curCD, Cm: curCm, LD: curCL / Math.max(1e-4, curCD),
    spanLoad: new Float32Array(res.spanLoad), oswaldVlm: res.CD > 1e-6 ? (res.CL * res.CL) / (Math.PI * AR * res.CD) : 1,
    bl, stress, vmax,
    polar, deriv: d, npPct: npPercent(d), staticMarginPct: staticMargin(d, req.xcgPct) * 100, verdict: v.verdict, verdictReason: v.reason,
    machCone, V, rho: atmo.rho, mu: atmo.mu, mach: req.mach, elapsedMs: performance.now() - t0,
  };
}

interface Wake {
  /** bord de fuite : z (envergure), x, y, corde */
  z0: number; z1: number;
  xTE0: number; xTE1: number;
  yTE0: number; yTE1: number;
  c0: number; c1: number;
  xLE0: number; xLE1: number;
}

/** Lignes de courant avec classification de régime. */
export function runStreamlines(req: TunnelRequest): StreamlineResult {
  const t0 = performance.now();
  const c = getCache(req);
  const spec = c.spec;
  const d = c.deriv;
  isa(req.altitude, atmo);
  const V = Math.max(10, req.mach * atmo.a);
  const alpha = req.alphaDeg * DEG;
  const cond: FlowCondition = { alpha, beta: req.betaDeg * DEG, p: 0, q: 0, r: 0, V, mach: req.mach, rho: atmo.rho, ref: [d.xref, 0, 0] };
  const L = c.coarse.L;
  if (req.flap > 0 && spec.perf.flapMaxDeg > 0) cond.deflection = controlDeflection(L, ['flap'], (_s, _k, m) => req.flap * Math.min(m, 40 * DEG) * 0.8);
  const sol = c.coarse.solve(cond);
  const span = spec.span, len = spec.length;
  const size = Math.max(span, len);
  const wing = spec.surfaces[0];
  const tip = wing.stations[wing.stations.length - 1];
  const root = wing.stations[0];
  const semi = tip.le[2];

  // ── Tourbillons de bord d'attaque (analogie de Polhamus) : filaments ajoutés au champ ──
  const le: number[] = [];
  let gammaLE = 0;
  if (d.Kv > 0 && alpha > 5 * DEG) {
    const q = 0.5 * atmo.rho * V * V;
    const CLv = d.Kv * Math.sin(alpha) ** 2 * Math.cos(alpha);
    const zc = 0.72 * semi;
    gammaLE = (CLv * q * spec.wingArea) / (2 * atmo.rho * V * 0.75 * semi);
    const zr = spec.fuselage.width * 0.45;
    const fr = (zc - root.le[2]) / (semi - root.le[2]);
    const xLe = root.le[0] + (tip.le[0] - root.le[0]) * fr;
    const ch = root.chord + (tip.chord - root.chord) * fr;
    const yLe = root.le[1] + (tip.le[1] - root.le[1]) * fr;
    const hv = ch * (0.04 + 0.25 * Math.sin(alpha));
    const apexX = root.le[0] + (tip.le[0] - root.le[0]) * ((zr - root.le[2]) / (semi - root.le[2]));
    const xTe = xLe - ch;
    const far = size * 3;
    for (const side of [1, -1]) {
      const pts = [[apexX, root.le[1] + 0.05, side * zr], [xTe, yLe + hv, side * zc], [xTe - far * Math.cos(alpha), yLe + hv + far * Math.sin(alpha), side * zc]];
      for (let k = 0; k < 2; k++) {
        const a = side > 0 ? pts[k] : pts[k + 1], b = side > 0 ? pts[k + 1] : pts[k];
        le.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
    }
  }
  const rcLE = Math.max(0.1, root.chord * 0.06);

  // ── Graines : râteau d'entrée (style soufflerie) + nappes d'aile + anneaux de saumon ──
  const seeds: [number, number, number, number][] = [];
  const x0 = len * 0.25;
  const ny = 9, nzR = 13;
  const yHalf = Math.max(spec.fuselage.height * 2.5, size * 0.16);
  for (let iy = 0; iy < ny; iy++) {
    for (let iz = 0; iz < nzR; iz++) {
      // râteau défini dans le repère vent (plan vertical), ramené en axes avion
      const xw = x0, yw = -yHalf + (2 * yHalf * iy) / (ny - 1) - len * 0.5 * Math.sin(alpha);
      seeds.push([xw * Math.cos(alpha) + yw * Math.sin(alpha), -xw * Math.sin(alpha) + yw * Math.cos(alpha), (iz / (nzR - 1) - 0.5) * span * 1.25, 0]);
    }
  }
  const rakeCount = seeds.length;
  const nSpan = 7;
  for (let k = 0; k < nSpan; k++) {
    const t = (k + 0.5) / nSpan;
    const z = semi * t * 0.97;
    const yLe = root.le[1] + (tip.le[1] - root.le[1]) * t;
    const chord = root.chord + (tip.chord - root.chord) * t;
    for (const side of [1, -1]) for (const dy of [0.1, -0.08]) seeds.push([x0, yLe + dy * chord, side * z, 0]);
  }
  const ringR = Math.max(0.15, tip.chord * 0.18);
  for (const side of [1, -1]) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      seeds.push([x0, tip.le[1] + Math.sin(a) * ringR, side * (tip.le[2] - tip.chord * 0.05 + Math.cos(a) * ringR), 1]);
    }
    if (gammaLE > 0) {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        seeds.push([x0, root.le[1] + 0.3 + Math.sin(a) * 0.25, side * (spec.fuselage.width * 0.5 + 0.2 + Math.cos(a) * 0.25), 1]);
      }
    }
  }

  // ── Sillages (pour la classification turbulente) ──
  const wakes: Wake[] = [];
  for (const s of spec.surfaces) {
    if (s.role === 'vtail') continue;
    for (let k = 0; k < s.stations.length - 1; k++) {
      const a = s.stations[k], b = s.stations[k + 1];
      wakes.push({ z0: a.le[2], z1: b.le[2], xTE0: a.le[0] - a.chord, xTE1: b.le[0] - b.chord, yTE0: a.le[1], yTE1: b.le[1], c0: a.chord, c1: b.chord, xLE0: a.le[0], xLE1: b.le[0] });
    }
  }
  const tanA = Math.tan(alpha);
  const transition = c.lastTransition;
  const sepBoost = 1 + 4 * c.lastSeparated;
  const tipTE = tip.le[0] - tip.chord;
  const classify = (x: number, y: number, z: number): [number, number] => {
    // tourbillon marginal : noyau issu du saumon, suivant l'écoulement
    if (x < tipTE + tip.chord * 0.2) {
      const dist = tipTE - x;
      const yc = tip.le[1] + dist * tanA;
      const zc = Math.sign(z) * (semi - Math.min(0.11 * semi, dist * 0.02));
      const r = Math.hypot(y - yc, z - zc);
      if (r < tip.chord * 0.3 + dist * 0.01) return [FLOW_VORTEX, 0];
    }
    if (gammaLE > 0 && x < root.le[0] && x > tipTE - size) {
      for (let k = 0; k < le.length; k += 6) {
        const ax = le[k], ay = le[k + 1], az = le[k + 2], bx = le[k + 3], by = le[k + 4], bz = le[k + 5];
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const l2 = dx * dx + dy * dy + dz * dz;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / l2));
        if (Math.hypot(x - ax - t * dx, y - ay - t * dy, z - az - t * dz) < rcLE * 4) return [FLOW_VORTEX, 0];
      }
    }
    const az = Math.abs(z);
    for (const w of wakes) {
      if (az < Math.min(w.z0, w.z1) || az > Math.max(w.z0, w.z1)) continue;
      const f = (az - w.z0) / (w.z1 - w.z0 || 1);
      const xTE = w.xTE0 + (w.xTE1 - w.xTE0) * f;
      const xLE = w.xLE0 + (w.xLE1 - w.xLE0) * f;
      const yS = w.yTE0 + (w.yTE1 - w.yTE0) * f;
      const ch = w.c0 + (w.c1 - w.c0) * f;
      if (x <= xLE && x >= xTE) {
        // couche limite : turbulente après la transition
        const u = (xLE - x) / ch;
        const yLocal = yS + (xLE - x) * 0;
        if (Math.abs(y - yLocal) < ch * 0.06 * sepBoost && u > transition) return [c.lastSeparated > 0.05 && u > 0.6 ? FLOW_SEPARATED : FLOW_TURBULENT, ch * 0.02];
      } else if (x < xTE) {
        const dist = xTE - x;
        const yw = yS + dist * tanA;
        const delta = (ch * 0.02 + 0.09 * Math.sqrt(ch * dist)) * sepBoost;
        if (Math.abs(y - yw) < delta) return [c.lastSeparated > 0.05 ? FLOW_SEPARATED : FLOW_TURBULENT, delta];
      }
    }
    // sillage du fuselage
    if (x < -len) {
      const dist = -len - x;
      const r = Math.hypot(y - spec.fuselage.axisY - dist * tanA, z);
      const R = spec.fuselage.width * 0.35 + 0.06 * dist;
      if (r < R) return [FLOW_TURBULENT, R * 0.5];
    }
    return [FLOW_LAMINAR, 0];
  };

  const ds = size / 110;
  const maxSteps = 210;
  const xEnd = -len - span * 0.7;
  const pts: number[] = [], spd: number[] = [], reg: number[] = [], offs: number[] = [], vflags: number[] = [];
  const v1 = new Float64Array(3), v2 = new Float64Array(3);
  const rc = Math.max(0.08, d.cref * 0.05);
  const vel = (x: number, y: number, z: number, out: Float64Array) => {
    c.coarse.velocityAt(sol.gamma, cond, x, y, z, out, rc);
    for (let k = 0; k < le.length; k += 6) addFilament(x, y, z, le[k], le[k + 1], le[k + 2], le[k + 3], le[k + 4], le[k + 5], gammaLE, rcLE, out);
  };
  let vMax = 0;
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  const seedPts: number[] = [];
  seeds.forEach((s, si) => {
    let x = s[0], y = s[1], z = s[2];
    if (si < rakeCount) seedPts.push(x, y, z);
    offs.push(pts.length / 3);
    vflags.push(s[3]);
    let arc = 0;
    const phase = si * 1.37;
    for (let k = 0; k < maxSteps; k++) {
      vel(x, y, z, v1);
      const m1 = Math.hypot(v1[0], v1[1], v1[2]) || 1;
      const [rg, delta] = classify(x, y, z);
      // fluctuations turbulentes (déterministes) dans les sillages / couches limites
      let ox = 0, oy = 0, oz = 0;
      if (rg === FLOW_TURBULENT || rg === FLOW_SEPARATED) {
        const a = delta * (rg === FLOW_SEPARATED ? 0.45 : 0.25);
        const w = 14 / Math.max(0.5, delta * 8);
        oy = a * (Math.sin(arc * w + phase) + 0.5 * Math.sin(arc * w * 2.3 + phase * 1.7));
        oz = a * (Math.cos(arc * w * 1.3 + phase * 0.6) + 0.4 * Math.sin(arc * w * 3.1));
        ox = a * 0.3 * Math.sin(arc * w * 0.7 + phase);
      }
      pts.push(x + ox, y + oy, z + oz);
      spd.push(m1);
      reg.push(rg);
      if (m1 > vMax) vMax = m1;
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z);
      const hx = x + (v1[0] / m1) * ds * 0.5, hy = y + (v1[1] / m1) * ds * 0.5, hz = z + (v1[2] / m1) * ds * 0.5;
      vel(hx, hy, hz, v2);
      const m2 = Math.hypot(v2[0], v2[1], v2[2]) || 1;
      x += (v2[0] / m2) * ds;
      y += (v2[1] / m2) * ds;
      z += (v2[2] / m2) * ds;
      arc += ds;
      if (x < xEnd) break;
    }
  });
  offs.push(pts.length / 3);
  const sorted = Float32Array.from(spd).sort();
  const vLo = sorted[Math.floor(sorted.length * 0.01)] ?? 0;
  const vHi = sorted[Math.floor(sorted.length * 0.99)] ?? vMax;
  return {
    id: req.id, points: new Float32Array(pts), speed: new Float32Array(spd), regime: new Uint8Array(reg), offsets: new Int32Array(offs),
    seeds: new Float32Array(seedPts), vortexFlags: new Uint8Array(vflags), leVortex: new Float32Array(le), vMax, vLo, vHi,
    bounds: [bx0, bx1, by0, by1, bz0, bz1], elapsedMs: performance.now() - t0,
  };
}
