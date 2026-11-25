/**
 * Mathématiques sans allocation pour la boucle physique.
 * Les vecteurs sont des tableaux (Float64Array ou number[]) manipulés par offset.
 * Quaternion : [x, y, z, w] (convention Three.js), rotation corps → monde.
 */

export type Arr = Float64Array | number[];

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const G0 = 9.80665;
export const KT = 0.514444; // m/s par nœud
export const FT = 0.3048;
export const NM = 1852;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Rotation d'un vecteur v par le quaternion q (corps → monde). Résultat dans out[oo..]. */
export function quatRotate(q: Arr, qo: number, v: Arr, vo: number, out: Arr, oo: number): void {
  const qx = q[qo], qy = q[qo + 1], qz = q[qo + 2], qw = q[qo + 3];
  const vx = v[vo], vy = v[vo + 1], vz = v[vo + 2];
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[oo] = vx + qw * tx + (qy * tz - qz * ty);
  out[oo + 1] = vy + qw * ty + (qz * tx - qx * tz);
  out[oo + 2] = vz + qw * tz + (qx * ty - qy * tx);
}

/** Rotation inverse (monde → corps). */
export function quatRotateInv(q: Arr, qo: number, v: Arr, vo: number, out: Arr, oo: number): void {
  const qx = -q[qo], qy = -q[qo + 1], qz = -q[qo + 2], qw = q[qo + 3];
  const vx = v[vo], vy = v[vo + 1], vz = v[vo + 2];
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[oo] = vx + qw * tx + (qy * tz - qz * ty);
  out[oo + 1] = vy + qw * ty + (qz * tx - qx * tz);
  out[oo + 2] = vz + qw * tz + (qx * ty - qy * tx);
}

/** Dérivée du quaternion : q̇ = ½ q ⊗ (ω, 0), ω exprimé dans le repère corps. */
export function quatDerivative(q: Arr, qo: number, w: Arr, wo: number, out: Arr, oo: number): void {
  const qx = q[qo], qy = q[qo + 1], qz = q[qo + 2], qw = q[qo + 3];
  const wx = w[wo], wy = w[wo + 1], wz = w[wo + 2];
  out[oo] = 0.5 * (qw * wx + qy * wz - qz * wy);
  out[oo + 1] = 0.5 * (qw * wy + qz * wx - qx * wz);
  out[oo + 2] = 0.5 * (qw * wz + qx * wy - qy * wx);
  out[oo + 3] = 0.5 * (-qx * wx - qy * wy - qz * wz);
}

export function quatNormalize(q: Arr, qo: number): void {
  const n = Math.hypot(q[qo], q[qo + 1], q[qo + 2], q[qo + 3]) || 1;
  q[qo] /= n; q[qo + 1] /= n; q[qo + 2] /= n; q[qo + 3] /= n;
}

/**
 * Quaternion à partir des angles aéronautiques (cap ψ depuis le Nord horaire,
 * assiette θ positive cabrée, inclinaison φ positive aile droite basse).
 * Ordre : lacet (axe monde Y) → tangage (axe corps Z) → roulis (axe corps X).
 */
export function quatFromEuler(headingRad: number, pitchRad: number, bankRad: number, out: Arr, oo: number): void {
  // Le nez du repère corps (+X) doit pointer vers (sin ψ, 0, −cos ψ).
  // Rotation autour de Y d'un angle a : X → (cos a, 0, −sin a). On veut cos a = sin ψ, −sin a = −cos ψ → a = π/2 − ψ.
  const a = Math.PI / 2 - headingRad;
  const cy = Math.cos(a / 2), sy = Math.sin(a / 2);
  const cp = Math.cos(pitchRad / 2), sp = Math.sin(pitchRad / 2);
  const cr = Math.cos(bankRad / 2), sr = Math.sin(bankRad / 2);
  // q = qYaw(Y) * qPitch(Z) * qRoll(X)
  // qYaw = (0, sy, 0, cy), qPitch = (0, 0, sp, cp), qRoll = (sr, 0, 0, cr)
  // qyp = qYaw*qPitch
  const ax = sy * sp, ay = sy * cp, az = cy * sp, aw = cy * cp;
  // (ax,ay,az,aw) * (sr,0,0,cr)
  out[oo] = aw * sr + ax * cr;
  out[oo + 1] = ay * cr + az * sr;
  out[oo + 2] = az * cr - ay * sr;
  out[oo + 3] = aw * cr - ax * sr;
}

const _tmpA = new Float64Array(3);
const _tmpB = new Float64Array(3);
const _unitX = new Float64Array([1, 0, 0]);
const _unitY = new Float64Array([0, 1, 0]);
const _unitZ = new Float64Array([0, 0, 1]);

/** Angles d'Euler aéronautiques à partir du quaternion → out = [cap, assiette, inclinaison] (rad). */
export function eulerFromQuat(q: Arr, qo: number, out: Arr, oo: number): void {
  quatRotate(q, qo, _unitX, 0, _tmpA, 0); // nez monde
  quatRotate(q, qo, _unitZ, 0, _tmpB, 0); // aile droite monde
  const fx = _tmpA[0], fy = _tmpA[1], fz = _tmpA[2];
  let heading = Math.atan2(fx, -fz);
  if (heading < 0) heading += 2 * Math.PI;
  const pitch = Math.asin(clamp(fy, -1, 1));
  // inclinaison : angle de l'aile droite sous l'horizon, signé
  quatRotate(q, qo, _unitY, 0, _tmpA, 0); // dessus monde
  const bank = Math.atan2(-_tmpB[1], _tmpA[1]);
  out[oo] = heading;
  out[oo + 1] = pitch;
  out[oo + 2] = bank;
}

export function cross(a: Arr, ao: number, b: Arr, bo: number, out: Arr, oo: number): void {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2];
  const bx = b[bo], by = b[bo + 1], bz = b[bo + 2];
  out[oo] = ay * bz - az * by;
  out[oo + 1] = az * bx - ax * bz;
  out[oo + 2] = ax * by - ay * bx;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) — utilisé pour les rafales/buffeting. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bruit de valeur 2D lisse et déterministe (utilisé par le terrain, identique worker/rendu). */
function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz) * 2 - 1;
}

export function fbm2(x: number, z: number, octaves: number, seed: number): number {
  let amp = 0.5, freq = 1, sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, z * freq, seed + i * 17);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

/** Bruit « ridged » pour les crêtes alpines. */
export function ridged2(x: number, z: number, octaves: number, seed: number): number {
  let amp = 0.5, freq = 1, sum = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise2(x * freq, z * freq, seed + i * 31));
    sum += amp * n * n;
    freq *= 2.1;
    amp *= 0.5;
  }
  return sum;
}
