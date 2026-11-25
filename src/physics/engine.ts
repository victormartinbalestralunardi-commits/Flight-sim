/**
 * Modèles moteurs : piston + hélice à pas fixe, turbofan (fort taux de dilution),
 * turboréacteur à postcombustion. Dynamique de régime du 1er ordre, séquence de
 * démarrage (démarreur → allumage → ralenti), consommation TSFC, EGT.
 */
import type { EngineDef } from '../aircraft/types';
import { clamp } from './math';

export interface EngineState {
  def: EngineDef;
  /** régimes normalisés (1 = 100 %) */
  n1: number;
  n2: number;
  running: boolean;
  starting: number; // temps écoulé dans la séquence de démarrage (s), −1 si inactif
  failed: boolean;
  cut: boolean;
  ab: number; // fraction PC effective 0..1
  egt: number; // °C
  ff: number; // kg/h
  thrust: number; // N
  propRpm: number;
  propAngle: number; // rad (rendu)
}

export const IDLE_N1 = 0.22;
export const IDLE_N2 = 0.6;
/** Levier au-delà duquel la PC est engagée (cran PC). */
export const AB_DETENT = 0.95;

export function createEngine(def: EngineDef, running: boolean): EngineState {
  return {
    def,
    n1: running ? IDLE_N1 : 0,
    n2: running ? IDLE_N2 : 0,
    running,
    starting: -1,
    failed: false,
    cut: false,
    ab: 0,
    egt: running ? 420 : 15,
    ff: 0,
    thrust: 0,
    propRpm: running ? 700 : 0,
    propAngle: 0,
  };
}

/** Facteur de chute de poussée avec densité et Mach. */
export function thrustLapse(def: EngineDef, sigma: number, mach: number, ab: boolean): number {
  if (def.type === 'turbofan') {
    const B = def.bypass;
    const f = 1 - 0.45 * mach * (B / (1 + B)) + (0.25 * mach * mach) / (1 + B);
    return Math.pow(sigma, 0.75) * Math.max(0.2, f);
  }
  if (def.type === 'turbojet_ab') {
    const m = Math.min(mach, 2.4);
    const f = ab ? 1 + 0.2 * m + 0.3 * m * m - 0.08 * m * m * m : 1 - 0.12 * m + 0.18 * m * m - 0.04 * m * m * m;
    return Math.pow(sigma, 0.75) * Math.max(0.3, f);
  }
  return 1;
}

/** Puissance disponible d'un moteur atmosphérique (Gagg-Ferrar). */
export function pistonPower(def: EngineDef, sigma: number): number {
  return def.thrustDry * Math.max(0, (sigma - 0.117) / 0.883);
}

/** Inverse : levier nécessaire pour une poussée donnée (pour le trim initial). */
export function leverForThrust(def: EngineDef, thrust: number, sigma: number, mach: number, V: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    const t = steadyThrust(def, mid, sigma, mach, V);
    if (t < thrust) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** N1 commandé pour une position de levier (partie sèche). */
export function n1Command(lever: number): number {
  const dry = Math.min(lever, AB_DETENT) / AB_DETENT;
  return IDLE_N1 + (1 - IDLE_N1) * dry;
}

function thrustFromN1(def: EngineDef, n1: number, ab: number, sigma: number, mach: number, V: number): number {
  if (def.type === 'piston') {
    const P = pistonPower(def, sigma) * clamp((n1 - IDLE_N1) / (1 - IDLE_N1), 0, 1) + pistonPower(def, sigma) * 0.04;
    return (0.8 * P) / Math.sqrt(V * V + 32 * 32);
  }
  const x = clamp((n1 - IDLE_N1) / (1 - IDLE_N1), 0, 1.05);
  const dry = def.thrustDry * thrustLapse(def, sigma, mach, false) * (0.04 + 0.96 * Math.pow(x, 1.5));
  if (ab > 0 && def.thrustAB > 0) {
    const abT = (def.thrustAB * thrustLapse(def, sigma, mach, true) - def.thrustDry * thrustLapse(def, sigma, mach, false)) * ab;
    return dry + Math.max(0, abT);
  }
  // perte de poussée de bélier (drag de captation) à N1 très bas
  return Math.max(0, dry);
}

/** Poussée stabilisée (pour le trim). */
export function steadyThrust(def: EngineDef, lever: number, sigma: number, mach: number, V: number): number {
  const ab = lever > AB_DETENT && def.thrustAB > 0 ? (lever - AB_DETENT) / (1 - AB_DETENT) : 0;
  return thrustFromN1(def, n1Command(lever), ab, sigma, mach, V);
}

export interface EngineEnv {
  sigma: number;
  mach: number;
  V: number;
  battery: boolean;
  apu: boolean;
  pumps: boolean;
  fuel: number;
}

/**
 * Avance l'état moteur de dt. `startReq` : demande de démarrage (front montant géré par l'appelant).
 */
export function updateEngine(e: EngineState, lever: number, startReq: boolean, env: EngineEnv, dt: number, spoolScale = 1): void {
  const def = e.def;
  const fuelOk = env.fuel > 0.5 && env.pumps && !e.cut;
  if (e.failed || !fuelOk) {
    if (e.running) e.running = false;
    e.starting = -1;
  }
  // Séquence de démarrage
  if (!e.running && startReq && e.starting < 0 && !e.failed && fuelOk) {
    const airOk = def.type === 'piston' ? env.battery : env.battery && (env.apu || def.type === 'turbojet_ab');
    if (airOk) e.starting = 0;
  }
  if (e.starting >= 0) {
    e.starting += dt;
    const isPiston = def.type === 'piston';
    const crank = isPiston ? 1.6 : def.type === 'turbojet_ab' ? 6 : 10;
    if (e.starting < crank) {
      // démarreur : N2 monte vers 25 %
      e.n2 += (0.25 - e.n2) * dt * (isPiston ? 3 : 0.5);
      e.n1 += (0.06 - e.n1) * dt * 0.5;
      e.egt += (isPiston ? 5 : -2) * dt;
    } else {
      e.running = true;
      e.starting = -1;
    }
  }
  // Régime
  let n1Target = 0, n2Target = 0;
  if (e.running) {
    n1Target = n1Command(lever);
    n2Target = IDLE_N2 + (1 - IDLE_N2) * ((n1Target - IDLE_N1) / (1 - IDLE_N1));
  } else if (e.starting < 0) {
    n1Target = 0;
    n2Target = 0;
  } else {
    n1Target = e.n1;
    n2Target = e.n2;
  }
  // moulinet en vol si arrêté
  if (!e.running && def.type !== 'piston') n1Target = Math.max(n1Target, Math.min(0.15, env.mach * 0.25));
  const tau = (def.spoolTime / spoolScale) * (e.running ? 1.25 - 0.85 * e.n1 : 1.5);
  const k = clamp(dt / Math.max(0.05, tau), 0, 1);
  e.n1 += (n1Target - e.n1) * k;
  e.n2 += (n2Target - e.n2) * k * 1.3;

  // Postcombustion
  const abCmd = e.running && def.thrustAB > 0 && lever > AB_DETENT && e.n1 > 0.9 ? (lever - AB_DETENT) / (1 - AB_DETENT) : 0;
  e.ab += (abCmd - e.ab) * clamp(dt * (abCmd > e.ab ? 2.5 : 4), 0, 1);

  // Poussée et consommation
  const T = e.running || e.n1 > 0.05 ? thrustFromN1(def, e.n1, e.ab, env.sigma, env.mach, env.V) * (e.running ? 1 : 0.1) : 0;
  e.thrust = T;
  if (def.type === 'piston') {
    const P = pistonPower(def, env.sigma) * clamp((e.n1 - IDLE_N1) / (1 - IDLE_N1) + 0.04, 0, 1.05);
    e.ff = e.running ? def.tsfc * P : 0;
    const rpmTarget = e.running ? clamp(700 + 1850 * Math.pow(clamp((e.n1 - IDLE_N1) / (1 - IDLE_N1), 0, 1), 0.8) + 6 * env.V, 0, 2750) : e.starting >= 0 ? 250 : 0;
    e.propRpm += (rpmTarget - e.propRpm) * clamp(dt * 2.5, 0, 1);
    e.propAngle = (e.propAngle + (e.propRpm / 60) * 2 * Math.PI * dt) % (2 * Math.PI);
    e.egt += ((e.running ? 600 + 180 * e.n1 : 20) - e.egt) * clamp(dt * 0.3, 0, 1);
  } else {
    const tsfc = (e.ab > 0.01 ? def.tsfcAB : def.tsfc) * (1 + 0.35 * env.mach);
    e.ff = e.running ? Math.max(tsfc * T, 0.012 * def.thrustDry * def.tsfc * 3) : 0;
    const egtTarget = e.running ? 380 + 520 * Math.pow(e.n1, 2) + (e.ab > 0 ? 120 : 0) : e.starting >= 0 ? 150 + e.starting * 40 : 20;
    e.egt += (egtTarget - e.egt) * clamp(dt * 0.8, 0, 1);
    e.propAngle = (e.propAngle + e.n1 * 60 * dt) % (2 * Math.PI);
  }
}
