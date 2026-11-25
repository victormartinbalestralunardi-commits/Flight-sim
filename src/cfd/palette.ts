/**
 * Palette et style visuel de la soufflerie CFD.
 *
 * Recalé sur l'image de référence fournie : fond clair gris-bleu, veine d'essai en boîte
 * filaire bleue, râteau de graines rouges à l'entrée, tubes de courant colorés par |V| (m/s)
 * avec l'échelle « jet » (bleu 0 → rouge max), maquette bleue (vitesse nulle à la paroi,
 * condition d'adhérence), trièdre d'axes X rouge / Y vert / Z bleu.
 */

export const CFD_STYLE = {
  backgroundTop: 0xf4f6fa,
  backgroundBottom: 0xb8c6da,
  domainBox: 0x2438c8,
  seedColor: 0xc8202a,
  grid: 0x3a5a8a,
  gridOpacity: 0.22,
  streamlineWidth: 1.6,
  streamlineOpacity: 0.95,
  shockColor: 0x5a3cff,
  shockOpacity: 0.28,
  machConeColor: 0x2438c8,
  vortexColor: 0xff7ad9,
  /** plage Cp affichée (min = dépression max, en bleu) */
  cpMin: -1.4,
  cpMax: 1.0,
  speedMin: 0.6,
  speedMax: 1.5,
};

/** Colormap « Turbo » (Mikhailov, Google 2019), approximation polynomiale. t ∈ [0,1]. */
export function turbo(t: number, out: number[] | Float32Array, o = 0): void {
  const x = Math.min(1, Math.max(0, t));
  const r = 0.13572138 + x * (4.6153926 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))));
  const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))));
  const b = 0.1066733 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))));
  out[o] = Math.min(1, Math.max(0, r));
  out[o + 1] = Math.min(1, Math.max(0, g));
  out[o + 2] = Math.min(1, Math.max(0, b));
}

/** Cp → t ∈ [0,1] (dépression = bleu, surpression/arrêt = rouge). */
export function cpToT(cp: number): number {
  return (cp - CFD_STYLE.cpMin) / (CFD_STYLE.cpMax - CFD_STYLE.cpMin);
}

export function cssTurbo(t: number): string {
  const c = [0, 0, 0];
  turbo(t, c);
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
}

/** Colormap « jet » classique des post-processeurs CFD (bleu → cyan → vert → jaune → rouge). */
export function jet(t: number, out: number[] | Float32Array, o = 0): void {
  const x = Math.min(1, Math.max(0, t));
  const r = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * x - 3)));
  const g = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * x - 2)));
  const b = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * x - 1)));
  out[o] = r; out[o + 1] = g; out[o + 2] = b;
}

export function cssJet(t: number): string {
  const c = [0, 0, 0];
  jet(t, c);
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
}

/** Couleurs des régimes d'écoulement. */
export const REGIME_COLORS = {
  laminar: [0.12, 0.55, 1.0],
  turbulent: [1.0, 0.55, 0.08],
  vortex: [0.85, 0.15, 0.85],
  separated: [0.9, 0.08, 0.1],
} as const;
