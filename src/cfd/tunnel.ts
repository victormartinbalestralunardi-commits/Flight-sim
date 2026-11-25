/**
 * Calculs de la soufflerie numérique (exécutés dans cfd.worker.ts) :
 * - solution VLM fine → ΔCp, Cp extrados/intrados (épaisseur + Prandtl-Glauert) ;
 * - zones supersoniques locales (Cp < Cp*) et position de l'onde de choc par bande ;
 * - lignes de courant 3D (RK2 dans le champ induit, noyaux visqueux) incl. tourbillons marginaux ;
 * - polaires issues EXACTEMENT du modèle de vol (FlightModel.coefficients) ;
 * - dérivées couplées + verdict « Fly it or Not ».
 */
import type { AircraftId } from '../aircraft/types';
import { computeMac } from '../aircraft/types';
import { buildSpec, type GeometryMods } from '../aircraft/mods';
import { buildLattice, controlDeflection, VlmSolver, type FlowCondition } from './vlm';
import { computeDerivatives, npPercent, staticMargin, verdict, type AeroDerivatives, type Verdict } from './derivatives';
import { FlightModel } from '../physics/flightModel';
import { createAtmo, isa } from '../physics/isa';

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
  CDi: number;
  CDtot: number;
  Cm: number;
  LD: number;
  spanLoad: Float32Array;
  oswaldVlm: number;
  polar: { alpha: Float32Array; CL: Float32Array; CD: Float32Array; Cm: Float32Array; LD: Float32Array };
  deriv: AeroDerivatives;
  npPct: number;
  staticMarginPct: number;
  verdict: Verdict;
  verdictReason: string;
  machCone: number; // demi-angle (rad) ou 0
  V: number;
  elapsedMs: number;
}

export interface StreamlineResult {
  id: number;
  /** positions (3/pt) ; lignes séparées par offsets */
  points: Float32Array;
  speed: Float32Array;
  offsets: Int32Array;
  /** lignes « tourbillon marginal » */
  vortexFlags: Uint8Array;
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
    geometry: null, fm: null,
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
    // normale géométrique (c × s), c = (−1,0,0)
    const sx = L.s[3 * i], sy = L.s[3 * i + 1], sz = L.s[3 * i + 2];
    let nx = 0 * sz - 0 * sy, ny = 0 * sx - -1 * sz, nz = -1 * sy - 0 * sx;
    // orienter « vers l'extrados » : +Y pour les surfaces horizontales, +Z (côté droit) pour les dérives
    const vertical = Math.abs(sy) > Math.abs(sz);
    if ((vertical && nz < 0 && L.side[i] > 0) || (!vertical && ny < 0)) { nx = -nx; ny = -ny; nz = -nz; }
    if (vertical && L.side[i] < 0 && nz > 0) { nx = -nx; ny = -ny; nz = -nz; }
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
    corners, normals, chordInfo, thickness, surf: L.surf.slice(), role: spec.surfaces.map((s) => s.role), n,
    fuselage: { ...spec.fuselage, noseFrac: fighter ? 0.28 : spec.category === 'ga' ? 0.18 : 0.12, tailFrac: fighter ? 0.12 : 0.3 },
    span: spec.span, length: spec.length, xcg, xnp: c.deriv.xnp, macLE: c.deriv.xMacLE, mac: c.deriv.cref,
  };
}

const atmo = createAtmo();

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
      // bord de fuite du dernier panneau supersonique, au milieu de la bande
      const k = 12 * last;
      const x = 0.5 * (L.corners[k + 6] + L.corners[k + 9]);
      const y = 0.5 * (L.corners[k + 7] + L.corners[k + 10]);
      const z = 0.5 * (L.corners[k + 8] + L.corners[k + 11]);
      // intensité : nombre de Mach local maximal approché par l'isentropique
      const strength = Math.min(1.6, Math.sqrt(Math.max(0, (cpStar - minCp) * 1.4)));
      const chord = (L.corners[k + 6] - L.corners[k + 3]) / (1 / L.nc) || 1;
      const h = Math.abs(chord) * 0.08 + strength * Math.abs(chord) * 0.35;
      shock.push(x, y, z, x, y + h, z);
    }
  }
  // supersonique : cône de Mach de nez
  const machCone = req.mach > 1 ? Math.asin(1 / req.mach) : 0;

  // polaires via le modèle de vol (cohérence totale soufflerie ↔ vol)
  if (!c.fm) {
    c.fm = new FlightModel({
      spec, aero: d, airport: 'lfbo', startMode: 'runway', fuelKg: spec.mass.fuelMax * 0.4, payloadKg: 0,
      xcgPct: req.xcgPct, wind: { fromDeg: 0, speed: 0, turbulence: 0 }, deltaIsa: 0, seaState: 0,
    });
  }
  const fm = c.fm;
  // le CG du modèle est figé à la construction : on reconstruit si le centrage change
  if (Math.abs(fm.xcgPct - req.xcgPct) > 1e-6) {
    c.fm = new FlightModel({
      spec, aero: d, airport: 'lfbo', startMode: 'runway', fuelKg: spec.mass.fuelMax * 0.4, payloadKg: 0,
      xcgPct: req.xcgPct, wind: { fromDeg: 0, speed: 0, turbulence: 0 }, deltaIsa: 0, seaState: 0,
    });
  }
  const m = c.fm!;
  m.flap = req.flap; m.gearPos = 0; m.spoiler = 0; m.speedbrake = 0; m.agl = 5000;
  const na = 31;
  const polar = { alpha: new Float32Array(na), CL: new Float32Array(na), CD: new Float32Array(na), Cm: new Float32Array(na), LD: new Float32Array(na) };
  for (let i = 0; i < na; i++) {
    const a = -6 + i;
    const ac = m.coefficients(a * DEG, 0, 0, 0, 0, V, req.mach, 0, 0, 0, 5000);
    polar.alpha[i] = a; polar.CL[i] = ac.CL; polar.CD[i] = ac.CD; polar.Cm[i] = ac.Cm; polar.LD[i] = ac.CL / Math.max(1e-4, ac.CD);
  }
  const cur = m.coefficients(req.alphaDeg * DEG, req.betaDeg * DEG, 0, 0, 0, V, req.mach, 0, 0, 0, 5000);
  const v = verdict(d, req.xcgPct, spec.fcs === 'fbw');
  const AR = d.aspect;
  if (!c.geometry || Math.abs(c.geometry.xcg - xcg) > 1e-6) c.geometry = buildGeometry(c, xcg);
  return {
    id: req.id, geometry: c.geometry, cpUpper, cpLower, dCp, supersonic, shock: new Float32Array(shock), cpStar,
    CL: cur.CL, CDi: res.CD, CDtot: cur.CD, Cm: cur.Cm, LD: cur.CL / Math.max(1e-4, cur.CD),
    spanLoad: new Float32Array(res.spanLoad), oswaldVlm: res.CD > 1e-6 ? (res.CL * res.CL) / (Math.PI * AR * res.CD) : 1,
    polar, deriv: d, npPct: npPercent(d), staticMarginPct: staticMargin(d, req.xcgPct) * 100, verdict: v.verdict, verdictReason: v.reason,
    machCone, V, elapsedMs: performance.now() - t0,
  };
}

/** Lignes de courant : intégration RK2 à pas spatial constant dans le champ VLM (maillage grossier). */
export function runStreamlines(req: TunnelRequest): StreamlineResult {
  const t0 = performance.now();
  const c = getCache(req);
  const spec = c.spec;
  const d = c.deriv;
  isa(req.altitude, atmo);
  const V = Math.max(10, req.mach * atmo.a);
  const cond: FlowCondition = { alpha: req.alphaDeg * DEG, beta: req.betaDeg * DEG, p: 0, q: 0, r: 0, V, mach: req.mach, rho: atmo.rho, ref: [d.xref, 0, 0] };
  const L = c.coarse.L;
  if (req.flap > 0 && spec.perf.flapMaxDeg > 0) cond.deflection = controlDeflection(L, ['flap'], (_s, _k, m) => req.flap * Math.min(m, 40 * DEG) * 0.8);
  const sol = c.coarse.solve(cond);
  const span = spec.span, len = spec.length;
  const wing = spec.surfaces[0];
  const tip = wing.stations[wing.stations.length - 1];
  const root = wing.stations[0];
  const seeds: [number, number, number, number][] = []; // x,y,z, vortex flag
  const x0 = 1.0 + len * 0.05;
  // nappes autour de l'aile (au-dessus et en dessous du bord d'attaque)
  const nSpan = 9;
  for (let k = 0; k < nSpan; k++) {
    const t = (k + 0.5) / nSpan;
    const z = tip.le[2] * t * 0.97;
    const yLe = root.le[1] + (tip.le[1] - root.le[1]) * t;
    const chord = root.chord + (tip.chord - root.chord) * t;
    for (const side of [1, -1]) {
      for (const dy of [0.12, -0.1]) seeds.push([x0, yLe + dy * chord + Math.tan(req.alphaDeg * DEG) * 0.0, side * z, 0]);
    }
  }
  // tourbillons marginaux : anneau autour du saumon
  const ringR = Math.max(0.15, tip.chord * 0.18);
  for (const side of [1, -1]) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      seeds.push([x0, tip.le[1] + Math.sin(a) * ringR, side * (tip.le[2] - tip.chord * 0.05 + Math.cos(a) * ringR), 1]);
    }
  }
  // râteau d'ensemble (plan vertical amont)
  for (let iy = 0; iy < 3; iy++) {
    for (let iz = 0; iz < 5; iz++) {
      seeds.push([x0, -span * 0.12 + iy * span * 0.12, (iz / 4 - 0.5) * span * 1.3, 0]);
    }
  }
  const ds = Math.max(span, len) / 140;
  const maxSteps = 260;
  const xEnd = -len - span * 0.9;
  const pts: number[] = [], spd: number[] = [], offs: number[] = [], vflags: number[] = [];
  const v1 = new Float64Array(3), v2 = new Float64Array(3);
  const rc = Math.max(0.08, d.cref * 0.05);
  for (const s of seeds) {
    // reculer la graine pour qu'elle démarre au même x devant l'avion (incidence)
    let x = s[0], y = s[1] - Math.tan(req.alphaDeg * DEG) * (x0 - s[0]), z = s[2];
    offs.push(pts.length / 3);
    vflags.push(s[3]);
    for (let k = 0; k < maxSteps; k++) {
      c.coarse.velocityAt(sol.gamma, cond, x, y, z, v1, rc);
      const m1 = Math.hypot(v1[0], v1[1], v1[2]) || 1;
      pts.push(x, y, z);
      spd.push(m1 / V);
      const hx = x + (v1[0] / m1) * ds * 0.5, hy = y + (v1[1] / m1) * ds * 0.5, hz = z + (v1[2] / m1) * ds * 0.5;
      c.coarse.velocityAt(sol.gamma, cond, hx, hy, hz, v2, rc);
      const m2 = Math.hypot(v2[0], v2[1], v2[2]) || 1;
      x += (v2[0] / m2) * ds;
      y += (v2[1] / m2) * ds;
      z += (v2[2] / m2) * ds;
      if (x < xEnd) break;
    }
  }
  offs.push(pts.length / 3);
  return {
    id: req.id, points: new Float32Array(pts), speed: new Float32Array(spd), offsets: new Int32Array(offs), vortexFlags: new Uint8Array(vflags),
    elapsedMs: performance.now() - t0,
  };
}
