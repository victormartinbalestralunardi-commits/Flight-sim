/**
 * Palette et style visuel de la soufflerie CFD.
 *
 * NOTE : aucune image de référence n'a été jointe à la demande initiale. Le style par défaut
 * reprend les codes classiques des rendus CFD (fond bleu nuit, carte Cp « turbo »,
 * lignes de courant lumineuses colorées par |V|/V∞). Toutes les couleurs sont centralisées
 * ici pour être recalées sur l'image de référence dès qu'elle sera fournie.
 */

export const CFD_STYLE = {
  backgroundTop: 0x0b1226,
  backgroundBottom: 0x1b2a4a,
  grid: 0x3a5a8a,
  gridOpacity: 0.22,
  streamlineWidth: 1.6,
  streamlineOpacity: 0.95,
  shockColor: 0x9fe8ff,
  shockOpacity: 0.32,
  machConeColor: 0xffffff,
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
