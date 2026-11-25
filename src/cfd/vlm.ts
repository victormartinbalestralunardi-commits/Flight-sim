/**
 * Méthode des treillis tourbillonnaires (Vortex Lattice Method, Katz & Plotkin ch. 12).
 *
 * - Fers à cheval : segment lié au 1/4 du panneau, point de contrôle au 3/4, jambes
 *   libres parallèles à l'axe −X corps jusqu'à « l'infini » (40 envergures).
 * - Condition de glissement : (V∞ − ω×r + Σ Γj·wij) · n_i = 0 ; normales tournées du
 *   calage local (vrillage + pente de cambrure + braquage de gouverne).
 * - Compressibilité : transformation de Prandtl-Glauert / Göthert (x étiré de 1/β pour les
 *   coefficients d'influence) ; Γ obtenu directement (cl = 2πα/β en 2D).
 * - Efforts : Kutta-Joukowski F = ρ Γ (V_loc + v_ind) × l sur chaque segment lié.
 *
 * Toutes les longueurs en mètres, repère modèle (X avant, Y haut, Z droite).
 */
import type { AircraftSpec, ControlKind, LiftingSurface } from '../aircraft/types';
import { computeMac } from '../aircraft/types';

export interface Lattice {
  n: number;
  /** extrémités du segment lié A→B (3n) */
  A: Float64Array;
  B: Float64Array;
  /** point de contrôle (3n) */
  P: Float64Array;
  /** vecteurs unitaires corde (vers BF) et envergure (3n), non braqués */
  c: Float64Array;
  s: Float64Array;
  /** surface du panneau */
  area: Float64Array;
  /** calage local de base (rad) : vrillage + pente de cambrure au 3/4 */
  incidence: Float64Array;
  /** fraction de corde du centre du panneau (0 = BA) et fraction d'envergure */
  uMid: Float64Array;
  tMid: Float64Array;
  /** côté : +1 droite (ou unique), −1 gauche (miroir) */
  side: Int8Array;
  surf: Int16Array;
  /** indices de bande (strip) et de rang chordal */
  strip: Int32Array;
  row: Int16Array;
  /** coins du panneau (4 × 3n) pour le rendu : BA-int, BA-ext, BF-ext, BF-int */
  corners: Float64Array;
  surfaces: LiftingSurface[];
  nc: number;
  nStrips: number;
  /** longueur des jambes libres */
  farLen: number;
}

export interface LatticeOptions {
  nc?: number; // panneaux en corde
  nsTotal?: number; // nombre approx. de bandes par demi-surface principale
}

function lerp3(out: number[], a: number[], b: number[], t: number): number[] {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** Pente de la ligne moyenne NACA 4 chiffres à x/c. */
export function camberSlope(m: number, p: number, x: number): number {
  if (m === 0) return 0;
  if (x < p) return ((2 * m) / (p * p)) * (p - x);
  return ((2 * m) / ((1 - p) * (1 - p))) * (p - x);
}

/** Construit le maillage VLM complet de l'appareil. */
export function buildLattice(spec: AircraftSpec, opts: LatticeOptions = {}): Lattice {
  const nc = opts.nc ?? 5;
  const nsTotal = opts.nsTotal ?? 14;
  type Strip = { surfIdx: number; side: number; le0: number[]; le1: number[]; c0: number; c1: number; tw0: number; tw1: number; t0: number; t1: number };
  const strips: Strip[] = [];
  const surfaces = spec.surfaces;
  const wingSpan = computeMac(surfaces[0]).span;

  surfaces.forEach((surf, si) => {
    // longueur cumulée le long des stations
    const st = surf.stations;
    const segLen: number[] = [];
    let total = 0;
    for (let i = 0; i < st.length - 1; i++) {
      const l = Math.hypot(st[i + 1].le[1] - st[i].le[1], st[i + 1].le[2] - st[i].le[2]);
      segLen.push(l);
      total += l;
    }
    const nsSurf = Math.max(4, Math.round((nsTotal * total) / (wingSpan / 2)));
    // distribution cosinus sur toute la demi-surface (raffinée au saumon)
    const ts: number[] = [];
    for (let k = 0; k <= nsSurf; k++) ts.push(Math.sin((k / nsSurf) * (Math.PI / 2)));
    // insérer les cassures pour respecter la géométrie exacte
    let acc = 0;
    for (let i = 0; i < segLen.length - 1; i++) {
      acc += segLen[i];
      const tk = acc / total;
      if (!ts.some((v) => Math.abs(v - tk) < 1e-3)) ts.push(tk);
    }
    ts.sort((a, b) => a - b);

    const at = (t: number) => {
      // position le long des stations pour un paramètre t ∈ [0,1]
      let d = t * total;
      for (let i = 0; i < segLen.length; i++) {
        if (d <= segLen[i] + 1e-9 || i === segLen.length - 1) {
          const f = segLen[i] > 0 ? Math.min(1, d / segLen[i]) : 0;
          const a = st[i], b = st[i + 1];
          const le = lerp3([0, 0, 0], a.le, b.le, f);
          return { le, c: a.chord + (b.chord - a.chord) * f, tw: a.twist + (b.twist - a.twist) * f };
        }
        d -= segLen[i];
      }
      const l = st[st.length - 1];
      return { le: [...l.le], c: l.chord, tw: l.twist };
    };

    const right: Strip[] = [];
    for (let k = 0; k < ts.length - 1; k++) {
      const p0 = at(ts[k]), p1 = at(ts[k + 1]);
      right.push({ surfIdx: si, side: 1, le0: p0.le, le1: p1.le, c0: p0.c, c1: p1.c, tw0: p0.tw, tw1: p1.tw, t0: ts[k], t1: ts[k + 1] });
    }
    if (surf.symmetric) {
      // côté gauche : miroir, parcouru du saumon vers l'emplanture pour garder s ≈ +Z
      for (let k = right.length - 1; k >= 0; k--) {
        const r = right[k];
        strips.push({
          surfIdx: si, side: -1,
          le0: [r.le1[0], r.le1[1], -r.le1[2]], le1: [r.le0[0], r.le0[1], -r.le0[2]],
          c0: r.c1, c1: r.c0, tw0: r.tw1, tw1: r.tw0, t0: r.t1, t1: r.t0,
        });
      }
    }
    for (const r of right) strips.push(r);
  });

  const n = strips.length * nc;
  const L: Lattice = {
    n,
    A: new Float64Array(3 * n), B: new Float64Array(3 * n), P: new Float64Array(3 * n),
    c: new Float64Array(3 * n), s: new Float64Array(3 * n),
    area: new Float64Array(n), incidence: new Float64Array(n),
    uMid: new Float64Array(n), tMid: new Float64Array(n),
    side: new Int8Array(n), surf: new Int16Array(n), strip: new Int32Array(n), row: new Int16Array(n),
    corners: new Float64Array(12 * n),
    surfaces, nc, nStrips: strips.length, farLen: 40 * wingSpan,
  };

  const pt = (sp: Strip, t: number, u: number, out: number[]) => {
    // point à la fraction d'envergure t (0=bord le0, 1=le1) et de corde u
    const lx = sp.le0[0] + (sp.le1[0] - sp.le0[0]) * t;
    const ly = sp.le0[1] + (sp.le1[1] - sp.le0[1]) * t;
    const lz = sp.le0[2] + (sp.le1[2] - sp.le0[2]) * t;
    const ch = sp.c0 + (sp.c1 - sp.c0) * t;
    out[0] = lx - u * ch;
    out[1] = ly;
    out[2] = lz;
    return out;
  };
  const tmp0 = [0, 0, 0], tmp1 = [0, 0, 0], tmp2 = [0, 0, 0], tmp3 = [0, 0, 0];

  let idx = 0;
  strips.forEach((sp, si) => {
    const af = surfaces[sp.surfIdx].airfoil;
    for (let r = 0; r < nc; r++) {
      const u0 = r / nc, u1 = (r + 1) / nc;
      const uq = u0 + 0.25 * (u1 - u0);
      const u3 = u0 + 0.75 * (u1 - u0);
      pt(sp, 0, uq, tmp0);
      pt(sp, 1, uq, tmp1);
      L.A.set(tmp0, 3 * idx);
      L.B.set(tmp1, 3 * idx);
      const cpA = pt(sp, 0.5, u3, tmp2);
      L.P.set(cpA, 3 * idx);
      // coins
      pt(sp, 0, u0, tmp0); L.corners.set(tmp0, 12 * idx);
      pt(sp, 1, u0, tmp1); L.corners.set(tmp1, 12 * idx + 3);
      pt(sp, 1, u1, tmp2); L.corners.set(tmp2, 12 * idx + 6);
      pt(sp, 0, u1, tmp3); L.corners.set(tmp3, 12 * idx + 9);
      // vecteurs unitaires
      const sx = L.B[3 * idx] - L.A[3 * idx], sy = L.B[3 * idx + 1] - L.A[3 * idx + 1], sz = L.B[3 * idx + 2] - L.A[3 * idx + 2];
      const sl = Math.hypot(sx, sy, sz) || 1;
      L.s[3 * idx] = sx / sl; L.s[3 * idx + 1] = sy / sl; L.s[3 * idx + 2] = sz / sl;
      L.c[3 * idx] = -1; L.c[3 * idx + 1] = 0; L.c[3 * idx + 2] = 0;
      const chMid = sp.c0 + (sp.c1 - sp.c0) * 0.5;
      L.area[idx] = sl * chMid * (u1 - u0);
      const tw = ((sp.tw0 + sp.tw1) * 0.5 * Math.PI) / 180;
      L.incidence[idx] = tw + Math.atan(-camberSlope(af.camber, af.camberPos, u3));
      L.uMid[idx] = (u0 + u1) / 2;
      L.tMid[idx] = (sp.t0 + sp.t1) / 2;
      L.side[idx] = sp.side;
      L.surf[idx] = sp.surfIdx;
      L.strip[idx] = si;
      L.row[idx] = r;
      idx++;
    }
  });
  return L;
}

// ───────────────────────────── Biot-Savart ─────────────────────────────

const CORE2 = 1e-10;

/** Ajoute la vitesse induite (Γ=1) d'un segment X1→X2 au point P dans out. */
function segment(px: number, py: number, pz: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, out: Float64Array, core2: number, absCore2 = 0): void {
  const r1x = px - x1, r1y = py - y1, r1z = pz - z1;
  const r2x = px - x2, r2y = py - y2, r2z = pz - z2;
  const cx = r1y * r2z - r1z * r2y;
  const cy = r1z * r2x - r1x * r2z;
  const cz = r1x * r2y - r1y * r2x;
  const c2 = cx * cx + cy * cy + cz * cz;
  const r1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z);
  const r2 = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z);
  const r0x = x2 - x1, r0y = y2 - y1, r0z = z2 - z1;
  const l2 = r0x * r0x + r0y * r0y + r0z * r0z;
  if (r1 < 1e-9 || r2 < 1e-9) return;
  let denom: number;
  if (absCore2 > 0) {
    // noyau visqueux (Vatistas n=1) de rayon absolu : d² → d² + rc²
    denom = c2 + absCore2 * l2;
  } else {
    if (c2 < core2 * l2) return;
    denom = c2;
  }
  const k = (r0x * (r1x / r1 - r2x / r2) + r0y * (r1y / r1 - r2y / r2) + r0z * (r1z / r1 - r2z / r2)) / (4 * Math.PI * denom);
  out[0] += k * cx;
  out[1] += k * cy;
  out[2] += k * cz;
}

/**
 * Vitesse induite au point (px,py,pz) par le fer à cheval j (Γ=1).
 * `stretch` = 1/β appliqué aux coordonnées x (Göthert). `boundOnly`/`trailOnly` pour diagnostics.
 */
export function horseshoe(L: Lattice, j: number, px: number, py: number, pz: number, stretch: number, out: Float64Array, core2 = CORE2, includeBound = true, absCore2 = 0): void {
  const ax = L.A[3 * j] * stretch, ay = L.A[3 * j + 1], az = L.A[3 * j + 2];
  const bx = L.B[3 * j] * stretch, by = L.B[3 * j + 1], bz = L.B[3 * j + 2];
  const far = L.farLen;
  const X = px * stretch;
  segment(X, py, pz, ax - far, ay, az, ax, ay, az, out, core2, absCore2);
  if (includeBound) segment(X, py, pz, ax, ay, az, bx, by, bz, out, core2, absCore2);
  segment(X, py, pz, bx, by, bz, bx - far, by, bz, out, core2, absCore2);
}

// ───────────────────────────── Solveur ─────────────────────────────

export interface FlowCondition {
  alpha: number; // rad
  beta: number; // rad
  /** vitesses angulaires corps (rad/s) : p (X), q (Z), r_std (lacet nez à droite) */
  p: number;
  q: number;
  r: number;
  V: number; // m/s
  mach: number;
  rho: number;
  /** braquages par panneau (rad, + = BF vers le bas / vers +Z pour une dérive), optionnel */
  deflection?: Float64Array;
  /** point de référence des moments (modèle) */
  ref: [number, number, number];
}

export interface VlmResult {
  gamma: Float64Array;
  /** ΔCp par panneau (intrados − extrados) */
  dCp: Float64Array;
  /** forces par panneau (3n), repère corps */
  F: Float64Array;
  CL: number;
  CD: number; // traînée induite (champ proche)
  CY: number;
  Cl: number; // roulis
  Cm: number; // tangage autour de ref
  Cn: number; // lacet (std, + nez à droite)
  /** charge en envergure : cl·c / c̄ par bande */
  spanLoad: Float64Array;
  /** efforts par surface portante : [Fx,Fy,Fz,Mx,My,Mz] × nSurf (N, N·m) */
  bySurf: Float64Array;
  qinf: number;
  Sref: number;
  cref: number;
  bref: number;
}

/** Workspace réutilisable pour éviter les allocations répétées. */
export class VlmSolver {
  readonly L: Lattice;
  private M: Float64Array;
  private rhs: Float64Array;
  private normals: Float64Array;
  private piv: Int32Array;
  private tmp = new Float64Array(3);
  readonly Sref: number;
  readonly cref: number;
  readonly bref: number;
  private factoredFor = { mach: -1, key: '' };

  constructor(L: Lattice, Sref: number, cref: number, bref: number) {
    this.L = L;
    const n = L.n;
    this.M = new Float64Array(n * n);
    this.rhs = new Float64Array(n);
    this.normals = new Float64Array(3 * n);
    this.piv = new Int32Array(n);
    this.Sref = Sref;
    this.cref = cref;
    this.bref = bref;
  }

  /** Normale du panneau i après rotation d'un angle θ (BF vers le bas / vers +Z). */
  private normal(i: number, theta: number, out: Float64Array, o: number): void {
    const L = this.L;
    const sx = L.s[3 * i], sy = L.s[3 * i + 1], sz = L.s[3 * i + 2];
    // corde de base (−1,0,0) tournée autour de s par Rodrigues
    const rot = (th: number, res: number[]) => {
      const cx = -1, cy = 0, cz = 0;
      const ct = Math.cos(th), stt = Math.sin(th);
      const dot = sx * cx + sy * cy + sz * cz;
      const kx = sy * cz - sz * cy, ky = sz * cx - sx * cz, kz = sx * cy - sy * cx;
      res[0] = cx * ct + kx * stt + sx * dot * (1 - ct);
      res[1] = cy * ct + ky * stt + sy * dot * (1 - ct);
      res[2] = cz * ct + kz * stt + sz * dot * (1 - ct);
    };
    const r = [0, 0, 0];
    const vertical = Math.abs(sy) > Math.abs(sz);
    rot(theta, r);
    // convention : θ>0 → BF vers −Y (surface horizontale) ou vers +Z (dérive)
    if (theta !== 0) {
      const ok = vertical ? r[2] * Math.sign(theta) > 0 : r[1] * Math.sign(theta) < 0;
      if (!ok) rot(-theta, r);
    }
    // n = c' × s
    out[o] = r[1] * sz - r[2] * sy;
    out[o + 1] = r[2] * sx - r[0] * sz;
    out[o + 2] = r[0] * sy - r[1] * sx;
    const nl = Math.hypot(out[o], out[o + 1], out[o + 2]) || 1;
    out[o] /= nl; out[o + 1] /= nl; out[o + 2] /= nl;
  }

  solve(cond: FlowCondition): VlmResult {
    const L = this.L;
    const n = L.n;
    const beta = Math.sqrt(Math.max(0.05, 1 - Math.min(cond.mach, 0.95) ** 2));
    const stretch = 1 / beta;
    // normales braquées
    for (let i = 0; i < n; i++) {
      const th = L.incidence[i] + (cond.deflection ? cond.deflection[i] : 0);
      // incidence positive = cabreur = BF vers le bas pour une surface horizontale.
      // Pour une dérive l'incidence géométrique est nulle par construction.
      this.normal(i, th, this.normals, 3 * i);
    }
    // matrice d'influence (dépend des normales braquées → refaite à chaque appel ; n ≤ ~400)
    const M = this.M;
    const t = this.tmp;
    for (let i = 0; i < n; i++) {
      const px = L.P[3 * i], py = L.P[3 * i + 1], pz = L.P[3 * i + 2];
      const nx = this.normals[3 * i], ny = this.normals[3 * i + 1], nz = this.normals[3 * i + 2];
      for (let j = 0; j < n; j++) {
        t[0] = 0; t[1] = 0; t[2] = 0;
        horseshoe(L, j, px, py, pz, stretch, t);
        // la composante x induite est comprimée par β dans l'espace étiré
        M[i * n + j] = t[0] * beta * nx + t[1] * ny + t[2] * nz;
      }
    }
    this.factoredFor.mach = cond.mach;
    // second membre
    const ca = Math.cos(cond.alpha), sa = Math.sin(cond.alpha);
    const cb = Math.cos(cond.beta), sb = Math.sin(cond.beta);
    // air relatif : opposé à la vitesse avion (u=V cosα cosβ, v=−V sinα cosβ, w=V sinβ)
    const Vx = -cond.V * ca * cb, Vy = cond.V * sa * cb, Vz = -cond.V * sb;
    const wx = cond.p, wy = -cond.r, wz = cond.q; // ω corps (ω_y = −r_std)
    const ref = cond.ref;
    const vloc = (x: number, y: number, z: number, out: Float64Array) => {
      // V_loc = V∞ − ω × (r − ref)
      const rx = x - ref[0], ry = y - ref[1], rz = z - ref[2];
      out[0] = Vx - (wy * rz - wz * ry);
      out[1] = Vy - (wz * rx - wx * rz);
      out[2] = Vz - (wx * ry - wy * rx);
    };
    for (let i = 0; i < n; i++) {
      vloc(L.P[3 * i], L.P[3 * i + 1], L.P[3 * i + 2], t);
      this.rhs[i] = -(t[0] * this.normals[3 * i] + t[1] * this.normals[3 * i + 1] + t[2] * this.normals[3 * i + 2]);
    }
    const gamma = new Float64Array(n);
    gaussSolve(M, this.rhs, gamma, n, this.piv);

    // efforts Kutta-Joukowski au milieu des segments liés
    const F = new Float64Array(3 * n);
    const dCp = new Float64Array(n);
    const qinf = 0.5 * cond.rho * cond.V * cond.V;
    let Fx = 0, Fy = 0, Fz = 0, Mx = 0, My = 0, Mz = 0;
    const bySurf = new Float64Array(6 * L.surfaces.length);
    const vi = new Float64Array(3);
    for (let i = 0; i < n; i++) {
      const mx = 0.5 * (L.A[3 * i] + L.B[3 * i]);
      const my = 0.5 * (L.A[3 * i + 1] + L.B[3 * i + 1]);
      const mz = 0.5 * (L.A[3 * i + 2] + L.B[3 * i + 2]);
      vi[0] = 0; vi[1] = 0; vi[2] = 0;
      for (let j = 0; j < n; j++) {
        t[0] = 0; t[1] = 0; t[2] = 0;
        horseshoe(L, j, mx, my, mz, stretch, t, CORE2, j !== i);
        const g = gamma[j];
        vi[0] += g * t[0] * beta; vi[1] += g * t[1]; vi[2] += g * t[2];
      }
      vloc(mx, my, mz, t);
      const ux = t[0] + vi[0], uy = t[1] + vi[1], uz = t[2] + vi[2];
      const lx = L.B[3 * i] - L.A[3 * i], ly = L.B[3 * i + 1] - L.A[3 * i + 1], lz = L.B[3 * i + 2] - L.A[3 * i + 2];
      const g = cond.rho * gamma[i];
      const fx = g * (uy * lz - uz * ly);
      const fy = g * (uz * lx - ux * lz);
      const fz = g * (ux * ly - uy * lx);
      F[3 * i] = fx; F[3 * i + 1] = fy; F[3 * i + 2] = fz;
      Fx += fx; Fy += fy; Fz += fz;
      const rx = mx - ref[0], ry = my - ref[1], rz = mz - ref[2];
      Mx += ry * fz - rz * fy;
      My += rz * fx - rx * fz;
      Mz += rx * fy - ry * fx;
      const so = 6 * L.surf[i];
      bySurf[so] += fx; bySurf[so + 1] += fy; bySurf[so + 2] += fz;
      bySurf[so + 3] += ry * fz - rz * fy;
      bySurf[so + 4] += rz * fx - rx * fz;
      bySurf[so + 5] += rx * fy - ry * fx;
      const fn = fx * this.normals[3 * i] + fy * this.normals[3 * i + 1] + fz * this.normals[3 * i + 2];
      dCp[i] = fn / (qinf * L.area[i]);
    }
    // axes vent
    const dx = Vx / cond.V, dy = Vy / cond.V, dz = Vz / cond.V; // direction de l'écoulement
    // portance : d × Zcorps normalisé
    let lx = dy * 1 - dz * 0, ly = dz * 0 - dx * 1, lz = 0;
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll; ly /= ll;
    const qS = qinf * this.Sref;
    const lift = Fx * lx + Fy * ly + Fz * lz;
    const drag = Fx * dx + Fy * dy + Fz * dz;
    // charge en envergure par bande
    const spanLoad = new Float64Array(L.nStrips);
    for (let i = 0; i < n; i++) {
      const sl = Math.hypot(L.B[3 * i] - L.A[3 * i], L.B[3 * i + 1] - L.A[3 * i + 1], L.B[3 * i + 2] - L.A[3 * i + 2]);
      spanLoad[L.strip[i]] += (F[3 * i] * lx + F[3 * i + 1] * ly) / (qinf * this.cref * Math.max(sl, 1e-6));
    }
    return {
      gamma, dCp, F, spanLoad, bySurf, qinf,
      CL: lift / qS,
      CD: drag / qS,
      CY: Fz / qS,
      Cl: Mx / (qS * this.bref),
      Cm: Mz / (qS * this.cref),
      Cn: -My / (qS * this.bref),
      Sref: this.Sref, cref: this.cref, bref: this.bref,
    };
  }

  /** Vitesse totale au point p (pour les lignes de courant). */
  velocityAt(gamma: Float64Array, cond: FlowCondition, px: number, py: number, pz: number, out: Float64Array, coreRadius = 0.05): void {
    const rc2 = coreRadius * coreRadius;
    const L = this.L;
    const beta = Math.sqrt(Math.max(0.05, 1 - Math.min(cond.mach, 0.95) ** 2));
    const stretch = 1 / beta;
    const ca = Math.cos(cond.alpha), sa = Math.sin(cond.alpha);
    const cb = Math.cos(cond.beta), sb = Math.sin(cond.beta);
    out[0] = -cond.V * ca * cb;
    out[1] = cond.V * sa * cb;
    out[2] = -cond.V * sb;
    const t = this.tmp;
    for (let j = 0; j < L.n; j++) {
      t[0] = 0; t[1] = 0; t[2] = 0;
      horseshoe(L, j, px, py, pz, stretch, t, CORE2, true, rc2);
      const g = gamma[j];
      out[0] += g * t[0] * beta;
      out[1] += g * t[1];
      out[2] += g * t[2];
    }
  }
}

/** Élimination de Gauss avec pivot partiel (M est détruite). */
export function gaussSolve(M: Float64Array, b: Float64Array, x: Float64Array, n: number, piv: Int32Array): void {
  const A = M;
  const rhs = b;
  for (let i = 0; i < n; i++) piv[i] = i;
  for (let k = 0; k < n; k++) {
    let maxv = Math.abs(A[k * n + k]), p = k;
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i * n + k]);
      if (v > maxv) { maxv = v; p = i; }
    }
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const tmp = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = tmp;
      }
      const tb = rhs[k]; rhs[k] = rhs[p]; rhs[p] = tb;
    }
    const akk = A[k * n + k] || 1e-12;
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / akk;
      if (f === 0) continue;
      for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j];
      rhs[i] -= f * rhs[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = rhs[i];
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
    x[i] = s / (A[i * n + i] || 1e-12);
  }
}

/** Construit le vecteur de braquage par panneau pour un type de gouverne. */
export function controlDeflection(
  L: Lattice,
  kinds: ControlKind[],
  /** fonction (côté, kind, maxDeg) → angle rad (+ = BF bas / vers +Z) */
  angle: (side: number, kind: ControlKind, maxRad: number) => number,
  out?: Float64Array,
): Float64Array {
  const d = out ?? new Float64Array(L.n);
  for (let i = 0; i < L.n; i++) {
    const surf = L.surfaces[L.surf[i]];
    for (const c of surf.controls) {
      if (!kinds.includes(c.kind)) continue;
      const tm = L.tMid[i];
      if (tm < c.spanFrom || tm > c.spanTo) continue;
      if (L.uMid[i] < 1 - c.chordFrac) continue;
      d[i] += angle(L.side[i], c.kind, (c.maxDeg * Math.PI) / 180);
    }
  }
  return d;
}
