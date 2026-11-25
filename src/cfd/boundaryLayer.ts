/**
 * Couche limite, frottement et contraintes structurelles (post-traitement de la solution VLM).
 *
 * Couche limite (par panneau, extrados et intrados) :
 *  - vitesse de bord V_e = V∞ √(1 − Cp) (Bernoulli) ;
 *  - Re_x = ρ V_e x / μ ; transition laminaire → turbulent au premier des critères :
 *    Re_x > Re_tr (rugosité/qualité de surface) ou passage du minimum de pression
 *    (gradient adverse, critère de type Michel simplifié) ;
 *  - Cf laminaire de Blasius 0,664/√Re_x ; Cf turbulent 0,0592 Re_x^−0,2 corrigé de la
 *    compressibilité (1 + 0,144 M²)^−0,65 ; τ_w = Cf · ½ ρ V_e² ;
 *  - décollement de bord de fuite quand le cl local de bande dépasse 90 % du cl_max 2D.
 * Fuselage : plaque plane turbulente de Schlichting 0,455 / (log Re_L)^2,58 × facteur de forme.
 *
 * Structure (par bande, surfaces symétriques) :
 *  - moment de flexion M(s) = Σ_{extérieur} (L_k − n·g·m_k)(s_k − s), soulagement inertiel
 *    de la voilure (masse structurale + carburant d'aile) ;
 *  - caisson de longerons h = 0,85 t, largeur 0,45 c, épaisseur de peau dimensionnée pour la
 *    charge extrême elliptique 1,5 × n_max × MTOW (minimum de jauge matériau) ;
 *  - σ = M / (h · b · t_peau), rapport σ/σ_adm, flèche en bout d'aile ∬ M/(EI).
 */
import type { AircraftSpec } from '../aircraft/types';
import type { Lattice, VlmResult } from './vlm';
import { G0 } from '../physics/math';

export interface Material {
  name: string;
  sigmaUlt: number; // Pa
  E: number; // Pa
  tMin: number; // m
}

export const MATERIALS: Record<string, Material> = {
  al: { name: 'Aluminium 7075-T6', sigmaUlt: 572e6, E: 71.7e9, tMin: 0.0016 },
  cfrp: { name: 'Composite carbone/époxy', sigmaUlt: 600e6, E: 70e9, tMin: 0.002 },
  alli: { name: 'Al-Li 2050 + composite', sigmaUlt: 550e6, E: 76e9, tMin: 0.0018 },
  spruce: { name: 'Épicéa / contreplaqué (Jodel)', sigmaUlt: 75e6, E: 11e9, tMin: 0.003 },
};

export function materialFor(spec: AircraftSpec): Material {
  switch (spec.id) {
    case 'b787': case 'f35': case 'rafale': return MATERIALS.cfrp;
    case 'f22': return MATERIALS.alli;
    case 'dr400': return MATERIALS.spruce;
    default: return MATERIALS.al;
  }
}

/** Reynolds de transition selon la qualité de surface. */
function reTransition(spec: AircraftSpec): number {
  switch (spec.id) {
    case 'b787': case 'g8000': return 2.5e6; // composite lisse / aile à laminarité étendue
    case 'f35': case 'f22': case 'rafale': return 1.2e6; // revêtements RAM, jointures
    case 'dr400': return 4e5; // bois entoilé, rivets
    default: return 1e6;
  }
}

export interface BoundaryLayerResult {
  /** par panneau : Cf et τw (Pa) extrados/intrados, régime (0 laminaire, 1 turbulent, 2 décollé) */
  cfUpper: Float32Array;
  cfLower: Float32Array;
  tauUpper: Float32Array;
  tauLower: Float32Array;
  regimeUpper: Uint8Array;
  regimeLower: Uint8Array;
  /** position de transition extrados par bande (fraction de corde) */
  transitionUpper: Float32Array;
  CDf: number;
  CDfFuselage: number;
  laminarFraction: number;
  reMac: number;
  cfMean: number;
  separatedFraction: number;
  /** cl local par bande */
  clStrip: Float32Array;
}

/** Corde locale et longueur en envergure de chaque bande. */
export function stripGeometry(L: Lattice): { chord: Float32Array; ds: Float32Array; x: Float32Array; y: Float32Array; z: Float32Array } {
  const ns = L.nStrips;
  const chord = new Float32Array(ns), ds = new Float32Array(ns), x = new Float32Array(ns), y = new Float32Array(ns), z = new Float32Array(ns);
  for (let s = 0; s < ns; s++) {
    const i0 = s * L.nc, i1 = s * L.nc + L.nc - 1;
    const c = L.corners;
    // BA milieu (panneau 0) et BF milieu (dernier panneau)
    const lex = 0.5 * (c[12 * i0] + c[12 * i0 + 3]), tex = 0.5 * (c[12 * i1 + 6] + c[12 * i1 + 9]);
    chord[s] = Math.max(1e-3, lex - tex);
    ds[s] = Math.hypot(L.B[3 * i0] - L.A[3 * i0], L.B[3 * i0 + 1] - L.A[3 * i0 + 1], L.B[3 * i0 + 2] - L.A[3 * i0 + 2]);
    x[s] = 0.5 * (lex + tex);
    y[s] = 0.5 * (c[12 * i0 + 1] + c[12 * i0 + 4]);
    z[s] = 0.5 * (c[12 * i0 + 2] + c[12 * i0 + 5]);
  }
  return { chord, ds, x, y, z };
}

export function boundaryLayer(
  spec: AircraftSpec, L: Lattice, res: VlmResult, cpUpper: Float32Array, cpLower: Float32Array,
  V: number, rho: number, mu: number, mach: number, Sref: number, cref: number,
): BoundaryLayerResult {
  const n = L.n, nc = L.nc;
  const sg = stripGeometry(L);
  const cfU = new Float32Array(n), cfL = new Float32Array(n), tauU = new Float32Array(n), tauL = new Float32Array(n);
  const regU = new Uint8Array(n), regL = new Uint8Array(n);
  const trU = new Float32Array(L.nStrips);
  const clStrip = new Float32Array(L.nStrips);
  const reTr = reTransition(spec);
  const comp = Math.pow(1 + 0.144 * mach * mach, -0.65);
  const qinf = 0.5 * rho * V * V;
  let dragF = 0, lamArea = 0, totArea = 0, sepArea = 0, cfSum = 0;
  // lift dir (axes vent, sans dérapage) pour le cl de bande
  for (let s = 0; s < L.nStrips; s++) {
    let lift = 0;
    for (let r = 0; r < nc; r++) {
      const i = s * nc + r;
      // force normale au panneau (portance locale de la bande)
      const nx = L.c[3 * i + 1] * L.s[3 * i + 2] - L.c[3 * i + 2] * L.s[3 * i + 1];
      const ny = L.c[3 * i + 2] * L.s[3 * i] - L.c[3 * i] * L.s[3 * i + 2];
      const nz = L.c[3 * i] * L.s[3 * i + 1] - L.c[3 * i + 1] * L.s[3 * i];
      lift += res.F[3 * i] * nx + res.F[3 * i + 1] * ny + res.F[3 * i + 2] * nz;
    }
    clStrip[s] = Math.abs(lift) / (qinf * sg.chord[s] * sg.ds[s]);
    const surf = L.surfaces[L.surf[s * nc]];
    const clMax = surf.airfoil.clMax;
    const sepFrac = Math.max(0, Math.min(1, (clStrip[s] / clMax - 0.9) * 4));
    for (const side of [0, 1]) {
      const cp = side === 0 ? cpUpper : cpLower;
      // minimum de pression (fin du gradient favorable)
      let rMin = 0, cpMin = 1e9;
      for (let r = 0; r < nc; r++) { const v = cp[s * nc + r]; if (v < cpMin) { cpMin = v; rMin = r; } }
      let turbulent = false;
      for (let r = 0; r < nc; r++) {
        const i = s * nc + r;
        const u = L.uMid[i];
        const x = Math.max(1e-3, u * sg.chord[s]);
        const ve = V * Math.sqrt(Math.max(0.05, 1 - cp[i]));
        const re = (rho * ve * x) / mu;
        if (!turbulent && (re > reTr || r > rMin + (side === 0 ? 0 : 1))) {
          turbulent = true;
          if (side === 0) trU[s] = u;
        }
        let cf = turbulent ? 0.0592 * Math.pow(re, -0.2) * comp : 0.664 / Math.sqrt(re);
        let reg = turbulent ? 1 : 0;
        if (side === 0 && sepFrac > 0 && u > 1 - sepFrac) { reg = 2; cf *= 0.15; }
        const tau = cf * 0.5 * rho * ve * ve;
        const area = L.area[i] * (1 + 2 * surf.airfoil.thickness);
        if (side === 0) { cfU[i] = cf; tauU[i] = tau; regU[i] = reg; } else { cfL[i] = cf; tauL[i] = tau; regL[i] = reg; }
        dragF += tau * area;
        totArea += area;
        cfSum += cf * area;
        if (reg === 0) lamArea += area;
        if (reg === 2) sepArea += area;
      }
      if (!turbulent && side === 0) trU[s] = 1;
    }
  }
  // fuselage (turbulent, facteur de forme Raymer)
  const f = spec.fuselage;
  const d = Math.sqrt(f.width * f.height);
  const reL = (rho * V * f.length) / mu;
  const cfF = (0.455 / Math.pow(Math.log10(reL), 2.58)) * comp;
  const fineness = f.length / d;
  const FF = 1 + 60 / fineness ** 3 + fineness / 400;
  const swet = Math.PI * d * f.length * 0.8;
  const CDfFus = (cfF * FF * swet) / Sref;
  return {
    cfUpper: cfU, cfLower: cfL, tauUpper: tauU, tauLower: tauL, regimeUpper: regU, regimeLower: regL, transitionUpper: trU,
    CDf: dragF / (qinf * Sref) + CDfFus, CDfFuselage: CDfFus, laminarFraction: lamArea / Math.max(1e-9, totArea),
    reMac: (rho * V * cref) / mu, cfMean: cfSum / Math.max(1e-9, totArea), separatedFraction: sepArea / Math.max(1e-9, totArea), clStrip,
  };
}

export interface StressResult {
  /** σ/σ_adm par bande et par panneau (chargement de peau, extrados) */
  ratioStrip: Float32Array;
  ratioPanel: Float32Array;
  sigmaStrip: Float32Array; // Pa
  momentStrip: Float32Array; // N·m
  sigmaMax: number;
  safetyFactor: number;
  rootMoment: number;
  tipDeflection: number;
  loadFactor: number;
  material: Material;
  /** σ(s) aile droite pour le graphique : s (m) et σ (MPa) */
  wingS: Float32Array;
  wingSigma: Float32Array;
}

export function structuralStress(spec: AircraftSpec, L: Lattice, res: VlmResult, massKg: number, fuelKg: number, qinf: number): StressResult {
  const nc = L.nc, ns = L.nStrips;
  const sg = stripGeometry(L);
  const mat = materialFor(spec);
  const ratioStrip = new Float32Array(ns), sigmaStrip = new Float32Array(ns), momentStrip = new Float32Array(ns);
  const ratioPanel = new Float32Array(L.n);
  // force normale par bande
  const fn = new Float32Array(ns);
  for (let s = 0; s < ns; s++) {
    let v = 0;
    for (let r = 0; r < nc; r++) {
      const i = s * nc + r;
      const nx = L.c[3 * i + 1] * L.s[3 * i + 2] - L.c[3 * i + 2] * L.s[3 * i + 1];
      const ny = L.c[3 * i + 2] * L.s[3 * i] - L.c[3 * i] * L.s[3 * i + 2];
      const nz = L.c[3 * i] * L.s[3 * i + 1] - L.c[3 * i + 1] * L.s[3 * i];
      v += res.F[3 * i] * nx + res.F[3 * i + 1] * ny + res.F[3 * i + 2] * nz;
    }
    fn[s] = v;
  }
  const liftTotal = res.CL * qinf * res.Sref;
  const n = liftTotal / (massKg * G0);
  const wingFrac = spec.category === 'airliner' ? 0.11 : spec.category === 'fighter' ? 0.09 : spec.category === 'ga' ? 0.1 : 0.1;
  const fuelInWing = spec.category === 'fighter' ? 0.4 : 0.85;
  let sigmaMax = 0, rootMoment = 0, tipDefl = 0;
  const qD = 0.5 * 1.225 * Math.min(spec.perf.mmo * 340, 320) ** 2;
  let wingS = new Float32Array(0), wingSig = new Float32Array(0);
  spec.surfaces.forEach((surf, si) => {
    for (const side of surf.symmetric ? [1, -1] : [1]) {
      const strips: number[] = [];
      for (let s = 0; s < ns; s++) if (L.surf[s * nc] === si && L.side[s * nc] === side) strips.push(s);
      if (!strips.length) continue;
      strips.sort((a, b) => L.tMid[a * nc] - L.tMid[b * nc]);
      let semi = 0;
      for (const s of strips) semi += sg.ds[s];
      const pos = strips.map((_, k) => { let acc = 0; for (let j = 0; j < k; j++) acc += sg.ds[strips[j]]; return acc + sg.ds[strips[k]] / 2; });
      // masse structurale répartie ∝ corde (aile principale uniquement)
      let cSum = 0;
      for (const s of strips) cSum += sg.chord[s] * sg.ds[s];
      const mWing = surf.role === 'wing' ? (wingFrac * spec.mass.mtow + fuelInWing * fuelKg) / 2 : 0;
      // charge de dimensionnement elliptique (par côté)
      const area = cSum;
      const Ld = surf.role === 'wing' ? (1.5 * spec.perf.nzMax * spec.mass.mtow * G0) / 2 : 1.5 * qD * 0.9 * area;
      const nD = 1.5 * spec.perf.nzMax;
      const momentAt = (k: number, loads: (j: number) => number) => {
        let M = 0;
        for (let j = k + 1; j < strips.length; j++) M += loads(j) * (pos[j] - pos[k]);
        return M;
      };
      const ellLoad = (j: number) => {
        const t0 = (pos[j] - sg.ds[strips[j]] / 2) / semi, t1 = (pos[j] + sg.ds[strips[j]] / 2) / semi;
        const F = (t: number) => (Math.asin(Math.min(1, t)) + Math.min(1, t) * Math.sqrt(Math.max(0, 1 - t * t))) / (Math.PI / 2);
        return Ld * (F(t1) - F(t0)) - (mWing * G0 * nD * sg.chord[strips[j]] * sg.ds[strips[j]]) / Math.max(1e-9, cSum);
      };
      const curLoad = (j: number) => Math.abs(fn[strips[j]]) * Math.sign(n || 1) - (mWing * G0 * n * sg.chord[strips[j]] * sg.ds[strips[j]]) / Math.max(1e-9, cSum);
      let theta = 0, defl = 0;
      const sArr: number[] = [], sigArr: number[] = [];
      strips.forEach((s, k) => {
        const tc = surf.airfoil.thickness;
        const c = sg.chord[s];
        const h = 0.85 * tc * c, b = 0.45 * c;
        const Mdes = Math.abs(momentAt(k, ellLoad)) + 1e-6;
        const ts = Math.max(mat.tMin, Mdes / (mat.sigmaUlt * h * b));
        const M = momentAt(k, curLoad);
        const sigma = Math.abs(M) / (h * b * ts);
        sigmaStrip[s] = sigma;
        momentStrip[s] = M;
        ratioStrip[s] = sigma / mat.sigmaUlt;
        sigmaMax = Math.max(sigmaMax, sigma);
        if (surf.role === 'wing' && k === 0) rootMoment = Math.max(rootMoment, Math.abs(M));
        // flèche : courbure M/EI intégrée deux fois
        const I = 2 * b * ts * (h / 2) ** 2;
        theta += (M / (mat.E * I)) * sg.ds[s];
        defl += theta * sg.ds[s];
        sArr.push(pos[k]);
        sigArr.push(sigma / 1e6);
        for (let r = 0; r < nc; r++) {
          const i = s * nc + r;
          const u = L.uMid[i];
          const inBox = u > 0.12 && u < 0.65;
          ratioPanel[i] = ratioStrip[s] * (inBox ? 1 : 0.3);
        }
      });
      if (surf.role === 'wing' && side === 1) {
        tipDefl = defl;
        wingS = new Float32Array(sArr);
        wingSig = new Float32Array(sigArr);
      }
    }
  });
  return {
    ratioStrip, ratioPanel, sigmaStrip, momentStrip, sigmaMax, safetyFactor: mat.sigmaUlt / Math.max(1, sigmaMax),
    rootMoment, tipDeflection: tipDefl, loadFactor: n, material: mat, wingS, wingSigma: wingSig,
  };
}
