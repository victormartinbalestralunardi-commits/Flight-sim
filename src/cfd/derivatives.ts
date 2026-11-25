/**
 * Calcul des dérivées aérodynamiques complètes d'un appareil par VLM, plus corrections
 * empiriques fuselage (Munk/Gilruth pour Cmα, DATCOM simplifié pour Cnβ).
 * Ces dérivées sont injectées telles quelles dans le modèle de vol 6-DDL.
 */
import type { AircraftSpec, ControlKind } from '../aircraft/types';
import { computeMac } from '../aircraft/types';
import { buildLattice, controlDeflection, VlmSolver, type FlowCondition, type Lattice, type VlmResult } from './vlm';

/** Facteur d'effet de plaque (fuselage + empennage horizontal) sur l'allongement effectif des dérives (DATCOM ≈ 1,55). */
export const FIN_ENDPLATE = 1.55;

/** Coefficients latéraux avec la contribution des dérives corrigée de l'effet de plaque. */
function lateral(res: VlmResult, spec: AircraftSpec, ref: number): { CY: number; Cl: number; Cn: number } {
  let Fz = 0, Mx = 0, My = 0;
  spec.surfaces.forEach((s, i) => {
    const k = s.role === 'vtail' ? FIN_ENDPLATE : 1;
    Fz += res.bySurf[6 * i + 2] * k;
    Mx += res.bySurf[6 * i + 3] * k;
    My += res.bySurf[6 * i + 4] * k;
  });
  const qS = res.qinf * res.Sref;
  void ref;
  return { CY: Fz / qS, Cl: Mx / (qS * res.bref), Cn: -My / (qS * res.bref) };
}

export interface AeroDerivatives {
  mach: number;
  Sref: number;
  cref: number;
  bref: number;
  /** x du point de référence (1/4 MAC, modèle) et du foyer (point neutre) */
  xref: number;
  xnp: number;
  xMacLE: number;
  CL0: number;
  CLa: number;
  /** Cm au point neutre (constant) */
  CmNp: number;
  CLq: number;
  Cmq: number;
  CYb: number;
  Clb: number;
  Cnb: number;
  CYp: number;
  Clp: number;
  Cnp: number;
  CYr: number;
  Clr: number;
  Cnr: number;
  /** dérivées de commande par unité de commande normalisée (−1..+1) */
  CLde: number;
  Cmde: number;
  Clda: number;
  Cnda: number;
  CYdr: number;
  Cldr: number;
  Cndr: number;
  /** effet volets pleins (commande = 1) */
  CLflap: number;
  CmFlap: number;
  /** facteur d'Oswald de la configuration */
  oswald: number;
  aspect: number;
  /** α de portance nulle (rad) */
  alpha0: number;
  /** constante de portance tourbillonnaire de bord d'attaque (analogie de succion de Polhamus) */
  Kv: number;
  /** flèche de bord d'attaque de l'aile (rad) */
  sweepLE: number;
}

export interface DerivativeOptions {
  mach?: number;
  nc?: number;
  nsTotal?: number;
}

/** Signe de braquage (BF bas = +) par type pour une commande de tangage positive (cabrer). */
function pitchAngle(_side: number, kind: ControlKind, maxRad: number): number {
  if (kind === 'canard') return maxRad; // BA canard vers le haut → force ↑ à l'avant
  return -maxRad; // profondeur / élevons : BF vers le haut
}

function rollAngle(side: number, _kind: ControlKind, maxRad: number): number {
  // roulis à droite : aileron droit BF haut, gauche BF bas
  return side > 0 ? -maxRad : maxRad;
}

export function computeDerivatives(spec: AircraftSpec, opts: DerivativeOptions = {}): AeroDerivatives {
  const mach = opts.mach ?? 0.2;
  const L: Lattice = buildLattice(spec, { nc: opts.nc ?? 4, nsTotal: opts.nsTotal ?? 12 });
  const mac = computeMac(spec.surfaces[0]);
  const Sref = spec.wingArea;
  const cref = mac.mac;
  const bref = spec.span;
  const xref = mac.xLE - 0.25 * cref;
  const solver = new VlmSolver(L, Sref, cref, bref);
  const V = 100;
  const base: FlowCondition = { alpha: 0, beta: 0, p: 0, q: 0, r: 0, V, mach, rho: 1.225, ref: [xref, 0, 0] };
  const da = 2 * (Math.PI / 180);

  const r0 = solver.solve(base);
  const r1 = solver.solve({ ...base, alpha: da });
  const CLa = (r1.CL - r0.CL) / da;
  const CmaRef = (r1.Cm - r0.Cm) / da;

  // Correction fuselage (Munk / Gilruth, Raymer éq. 16.25) : moment pur déstabilisant
  const f = spec.fuselage;
  const Kf = 0.012 * (180 / Math.PI) * (f.munk ?? 1); // par rad
  const dCmaFus = (Kf * f.width * f.width * f.length) / (cref * Sref);
  const CmaTot = CmaRef + dCmaFus;
  const xnp = xref + (cref * CmaTot) / CLa;
  const CmNp = r0.Cm - ((xnp - xref) * r0.CL) / cref;

  // Tangage : q̂ = q c / 2V
  const qRate = 0.05;
  const rq = solver.solve({ ...base, q: qRate });
  const qhat = (qRate * cref) / (2 * V);
  const CLq = (rq.CL - r0.CL) / qhat;
  const Cmq = (rq.Cm - r0.Cm) / qhat;

  // Dérapage (autour de α = 4° pour capter l'effet dièdre de flèche ∝ CL·tanΛ)
  const a4 = 4 * (Math.PI / 180);
  const r4 = solver.solve({ ...base, alpha: a4 });
  const l4 = lateral(r4, spec, xref);
  const db = 2 * (Math.PI / 180);
  const rb = solver.solve({ ...base, alpha: a4, beta: db });
  const lb = lateral(rb, spec, xref);
  const munk = f.munk ?? 1;
  const volFus = 0.6 * (Math.PI / 4) * f.width * f.height * f.length * munk;
  const CnbFus = (-1.3 * volFus) / (Sref * bref);
  const CYbFus = (-0.25 * f.height * f.length * 0.8) / Sref;
  const CYb = (lb.CY - l4.CY) / db + CYbFus;
  const Clb = (lb.Cl - l4.Cl) / db;
  const Cnb = (lb.Cn - l4.Cn) / db + CnbFus;

  // Roulis : p̂ = p b / 2V
  const pRate = 0.1;
  const rp = lateral(solver.solve({ ...base, alpha: a4, p: pRate }), spec, xref);
  const phat = (pRate * bref) / (2 * V);
  const CYp = (rp.CY - l4.CY) / phat;
  const Clp = (rp.Cl - l4.Cl) / phat;
  const Cnp = (rp.Cn - l4.Cn) / phat;

  // Lacet : r̂ = r b / 2V
  const rRate = 0.1;
  const rr = lateral(solver.solve({ ...base, alpha: a4, r: rRate }), spec, xref);
  const rhat = (rRate * bref) / (2 * V);
  const CYr = (rr.CY - l4.CY) / rhat;
  const Clr = (rr.Cl - l4.Cl) / rhat;
  // amortissement fuselage additionnel
  const Cnr = (rr.Cn - l4.Cn) / rhat - 0.02;

  // Gouvernes : commande 0,2 puis extrapolée (linéaire) ×5, efficacité 0,8
  const eff = 0.8;
  const cmd = 0.2;
  const dPitch = controlDeflection(L, ['elevator', 'elevon', 'canard'], (s, k, m) => cmd * pitchAngle(s, k, m));
  const re = solver.solve({ ...base, deflection: dPitch });
  const CLde = ((re.CL - r0.CL) / cmd) * eff;
  const Cmde = ((re.Cm - r0.Cm) / cmd) * eff;

  const dRoll = controlDeflection(L, ['aileron', 'elevon'], (s, k, m) => cmd * rollAngle(s, k, m));
  const l0 = lateral(r0, spec, xref);
  const ra = lateral(solver.solve({ ...base, deflection: dRoll }), spec, xref);
  const Clda = ((ra.Cl - l0.Cl) / cmd) * eff;
  const Cnda = ((ra.Cn - l0.Cn) / cmd) * eff;

  const dYaw = controlDeflection(L, ['rudder'], (_s, _k, m) => cmd * m);
  const rd = lateral(solver.solve({ ...base, deflection: dYaw }), spec, xref);
  const CYdr = ((rd.CY - l0.CY) / cmd) * eff;
  const Cldr = ((rd.Cl - l0.Cl) / cmd) * eff;
  const Cndr = ((rd.Cn - l0.Cn) / cmd) * eff;

  // Volets : théorie linéaire à 10° puis loi en sinus (saturation des grands braquages), η = 0,65
  let CLflap = 0, CmFlap = 0;
  if (spec.perf.flapMaxDeg > 0) {
    const small = (10 * Math.PI) / 180;
    const dFlap = controlDeflection(L, ['flap'], () => small);
    const rf = solver.solve({ ...base, deflection: dFlap });
    const scale = (Math.sin((spec.perf.flapMaxDeg * Math.PI) / 180) / Math.sin(small)) * 0.65;
    CLflap = (rf.CL - r0.CL) * scale;
    // moment au point neutre (indépendant du centrage)
    const cmNpF = rf.Cm - ((xnp - xref) * rf.CL) / cref;
    CmFlap = (cmNpF - CmNp) * scale;
  }

  // Facteur d'Oswald : estimation Raymer (éq. 12.48/12.49), bornée par l'efficacité VLM
  const r6 = solver.solve({ ...base, alpha: 6 * (Math.PI / 180) });
  const AR = (bref * bref) / Sref;
  const st0 = spec.surfaces[0].stations;
  const sweepLE = Math.atan2(st0[0].le[0] - st0[st0.length - 1].le[0], st0[st0.length - 1].le[2] - st0[0].le[2]);
  const eRaymer = sweepLE > (30 * Math.PI) / 180 && AR < 5
    ? 4.61 * (1 - 0.045 * Math.pow(AR, 0.68)) * Math.pow(Math.cos(sweepLE), 0.15) - 3.1
    : 1.78 * (1 - 0.045 * Math.pow(AR, 0.68)) - 0.64;
  const eVlm = r6.CD > 1e-6 ? (r6.CL * r6.CL) / (Math.PI * AR * r6.CD) : 1;
  const oswald = Math.min(0.98, Math.max(0.5, Math.min(eRaymer, eVlm)));

  return {
    mach, Sref, cref, bref, xref, xnp, xMacLE: mac.xLE,
    CL0: r0.CL, CLa, CmNp, CLq, Cmq,
    CYb, Clb, Cnb, CYp, Clp, Cnp, CYr, Clr, Cnr,
    CLde, Cmde, Clda, Cnda, CYdr, Cldr, Cndr,
    CLflap, CmFlap, oswald, aspect: AR,
    alpha0: -r0.CL / CLa,
    // Polhamus : Kv ≈ π pour un delta élancé ; seulement significatif pour les BA très en flèche
    Kv: Math.PI * Math.min(1, Math.max(0, (sweepLE - (38 * Math.PI) / 180) / ((12 * Math.PI) / 180))),
    sweepLE,
  };
}

/** Position x (modèle) du CG pour un centrage en % MAC. */
export function xcgFromPercent(d: AeroDerivatives, pct: number): number {
  return d.xMacLE - (pct / 100) * d.cref;
}

/** Marge statique (fraction de MAC, + = stable). */
export function staticMargin(d: AeroDerivatives, xcgPct: number): number {
  const xcg = xcgFromPercent(d, xcgPct);
  return (xcg - d.xnp) / d.cref;
}

/** Point neutre en % MAC. */
export function npPercent(d: AeroDerivatives): number {
  return ((d.xMacLE - d.xnp) / d.cref) * 100;
}

export type Verdict = 'stable' | 'limite' | 'instable';

/**
 * Verdict d'ingénierie : marge statique + capacité de la loi de commande.
 * Les avions FBW tolèrent une légère instabilité (jusqu'à −8 % MAC, comme le Rafale ou le F-22).
 */
export function verdict(d: AeroDerivatives, xcgPct: number, fbw: boolean): { verdict: Verdict; margin: number; reason: string } {
  const sm = staticMargin(d, xcgPct);
  const pct = sm * 100;
  if (fbw) {
    if (pct > 2) return { verdict: 'stable', margin: sm, reason: `Marge statique +${pct.toFixed(1)} % MAC — stable naturellement.` };
    if (pct > -8) return { verdict: 'limite', margin: sm, reason: `Marge ${pct.toFixed(1)} % MAC — instabilité relaxée, stabilisée par le FBW (dangereux en loi directe).` };
    return { verdict: 'instable', margin: sm, reason: `Marge ${pct.toFixed(1)} % MAC — instabilité au-delà de l'autorité du FBW.` };
  }
  if (pct > 5) return { verdict: 'stable', margin: sm, reason: `Marge statique +${pct.toFixed(1)} % MAC.` };
  if (pct > 0) return { verdict: 'limite', margin: sm, reason: `Marge faible ${pct.toFixed(1)} % MAC — avion très sensible en tangage.` };
  return { verdict: 'instable', margin: sm, reason: `CG en arrière du foyer (${pct.toFixed(1)} % MAC) — divergence en tangage.` };
}
