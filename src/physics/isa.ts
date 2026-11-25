/**
 * Atmosphère standard internationale (ISA, OACI Doc 7488) jusqu'à 32 km,
 * avec écart de température ΔISA optionnel.
 */
export const ISA_T0 = 288.15; // K
export const ISA_P0 = 101325; // Pa
export const ISA_RHO0 = 1.225; // kg/m³
export const ISA_L = 0.0065; // K/m
export const R_AIR = 287.05287; // J/(kg·K)
export const GAMMA = 1.4;
const G = 9.80665;

export interface AtmoState {
  T: number; // K
  p: number; // Pa
  rho: number; // kg/m³
  a: number; // vitesse du son m/s
  sigma: number; // ρ/ρ0
  mu: number; // viscosité dynamique Pa·s
}

export function createAtmo(): AtmoState {
  return { T: ISA_T0, p: ISA_P0, rho: ISA_RHO0, a: 340.294, sigma: 1, mu: 1.789e-5 };
}

/** Calcule l'atmosphère à l'altitude géopotentielle h (m). Sans allocation. */
export function isa(h: number, out: AtmoState, deltaT = 0): AtmoState {
  const hc = Math.max(-1000, Math.min(h, 32000));
  let Tstd: number, p: number;
  if (hc <= 11000) {
    Tstd = ISA_T0 - ISA_L * hc;
    p = ISA_P0 * Math.pow(Tstd / ISA_T0, G / (ISA_L * R_AIR));
  } else if (hc <= 20000) {
    Tstd = 216.65;
    const p11 = 22632.06;
    p = p11 * Math.exp((-G * (hc - 11000)) / (R_AIR * 216.65));
  } else {
    // 20–32 km : gradient +1 K/km
    const L2 = -0.001;
    Tstd = 216.65 - L2 * (hc - 20000);
    const p20 = 5474.889;
    p = p20 * Math.pow(Tstd / 216.65, G / (L2 * R_AIR));
  }
  const T = Tstd + deltaT;
  const rho = p / (R_AIR * T);
  out.T = T;
  out.p = p;
  out.rho = rho;
  out.a = Math.sqrt(GAMMA * R_AIR * T);
  out.sigma = rho / ISA_RHO0;
  // Loi de Sutherland
  out.mu = (1.458e-6 * Math.pow(T, 1.5)) / (T + 110.4);
  return out;
}

/** Vitesse conventionnelle (CAS) à partir de la TAS (compressible, subsonique). */
export function tasToCas(tas: number, atmo: AtmoState): number {
  const M = tas / atmo.a;
  // pression d'impact qc
  let qc: number;
  if (M < 1) {
    qc = atmo.p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
  } else {
    // Rayleigh pitot (onde de choc normale devant la sonde)
    qc = atmo.p * ((166.92158 * Math.pow(M, 7)) / Math.pow(7 * M * M - 1, 2.5) - 1);
  }
  const a0 = 340.294;
  return a0 * Math.sqrt(5 * (Math.pow(qc / ISA_P0 + 1, 2 / 7) - 1));
}

/** Altitude-pression à partir de la pression statique (calage 1013,25). */
export function pressureAltitude(p: number): number {
  if (p >= 22632.06) return (ISA_T0 / ISA_L) * (1 - Math.pow(p / ISA_P0, (ISA_L * R_AIR) / G));
  return 11000 - (R_AIR * 216.65 * Math.log(p / 22632.06)) / G;
}
