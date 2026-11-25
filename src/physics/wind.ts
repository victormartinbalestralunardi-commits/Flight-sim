/**
 * Vent 3D : vent moyen (gradient logarithmique près du sol), turbulence Dryden
 * (filtres du 1er ordre sur bruit blanc déterministe), et microburst (cisaillement)
 * de type Oseguera-Bowles simplifié.
 */
import { clamp, makeRng } from './math';

export interface WindConfig {
  /** direction D'OÙ vient le vent (deg vrai) */
  fromDeg: number;
  speed: number; // m/s à 10 m+
  turbulence: number; // 0..1
}

export class Wind {
  cfg: WindConfig;
  private rng: () => number;
  /** composantes turbulentes (m/s) */
  private ug = 0;
  private vg = 0;
  private wg = 0;
  /** microburst : centre et instant d'activation */
  burstX = 0;
  burstZ = 0;
  burstActive = false;
  burstAge = 0;
  readonly out = new Float64Array(3);

  constructor(cfg: WindConfig, seed = 1234) {
    this.cfg = cfg;
    this.rng = makeRng(seed);
  }

  private gauss(): number {
    // Box-Muller
    const u = Math.max(1e-9, this.rng());
    const v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Déclenche un microburst centré à (x, z). */
  triggerBurst(x: number, z: number): void {
    this.burstX = x;
    this.burstZ = z;
    this.burstActive = true;
    this.burstAge = 0;
  }

  /**
   * Avance la turbulence de dt et calcule le vent total au point (x, agl, z).
   * Résultat dans `this.out` (monde, m/s).
   */
  sample(x: number, agl: number, z: number, V: number, dt: number): Float64Array {
    const c = this.cfg;
    const h = Math.max(0.5, agl);
    // gradient logarithmique (rugosité 0,05 m) normalisé à 10 m
    const shearFactor = clamp(Math.log(h / 0.05) / Math.log(10 / 0.05), 0, 1.6);
    const dir = (c.fromDeg * Math.PI) / 180;
    // le vent souffle VERS dir+180
    const sx = -Math.sin(dir) * c.speed * shearFactor;
    const sz = Math.cos(dir) * c.speed * shearFactor;
    // Dryden : σ ∝ intensité, échelles L
    const sigma = c.turbulence * (1.5 + 0.12 * c.speed);
    const Lu = h < 300 ? Math.max(30, h / Math.pow(0.177 + 0.000823 * h, 1.2)) : 530;
    const Lw = Math.max(10, Math.min(h, 530));
    const Vs = Math.max(V, 10);
    const au = clamp((Vs / Lu) * dt, 0, 1);
    const aw = clamp((Vs / Lw) * dt, 0, 1);
    this.ug += -au * this.ug + sigma * Math.sqrt(2 * au) * this.gauss();
    this.vg += -au * this.vg + sigma * Math.sqrt(2 * au) * this.gauss();
    this.wg += -aw * this.wg + sigma * 0.7 * Math.sqrt(2 * aw) * this.gauss();
    let wx = sx + this.ug, wy = this.wg * clamp(h / 50, 0.2, 1), wz = sz + this.vg;

    if (this.burstActive) {
      this.burstAge += dt;
      const R = 900;
      const dx = x - this.burstX, dz = z - this.burstZ;
      const r = Math.hypot(dx, dz);
      const q = r / R;
      // montée en puissance puis dissipation
      const life = clamp(this.burstAge / 8, 0, 1) * clamp((120 - this.burstAge) / 20, 0, 1);
      const hf = Math.exp(-h / 700);
      const ur = 16 * q * Math.exp(0.5 * (1 - q * q)) * life * hf;
      const down = -13 * Math.exp(-q * q) * clamp(h / 250, 0.15, 1) * life;
      if (r > 1) {
        wx += (ur * dx) / r;
        wz += (ur * dz) / r;
      }
      wy += down;
      if (this.burstAge > 140) this.burstActive = false;
    }
    this.out[0] = wx;
    this.out[1] = wy;
    this.out[2] = wz;
    return this.out;
  }
}
