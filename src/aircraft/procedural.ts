/**
 * Modèles 3D procéduraux PBR des 7 appareils, générés depuis la MÊME géométrie que le
 * solveur VLM (stations des surfaces portantes) → cohérence parfaite aéro / visuel.
 *
 * Hiérarchie et noms conformes à la convention GLTF (voir CLAUDE.md) :
 * gouvernes pivotant autour de leur axe local X (charnière), segments d'aile chaînés pour la
 * flexion dynamique, trains (jambe + amortisseur `gear_strut_*`), feux, nacelles, tuyères,
 * postcombustion, hélice, verrière, crosse, soufflante STOVL.
 */
import * as THREE from 'three';
import type { AircraftSpec, ControlSurface, LiftingSurface, Station } from './types';
import { createMaterials, type AircraftMaterials } from './materials';
import { createLivery } from './livery';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const V3 = THREE.Vector3;

// ───────────────────────────── Profils de fuselage ─────────────────────────────

/** [ξ, demi-largeur, demi-hauteur, y centre, exposant superellipse] */
type Key = [number, number, number, number, number];

const PROFILES: Record<string, { keys: Key[]; radial: number; flat: boolean }> = {
  f22: { radial: 10, flat: true, keys: [[0, 0.02, 0.02, 0.1, 1.4], [0.06, 0.45, 0.36, 0.12, 1.5], [0.15, 0.78, 0.6, 0.16, 1.6], [0.25, 1.25, 0.8, 0.08, 1.4], [0.33, 1.7, 0.92, 0, 1.3], [0.52, 1.75, 0.92, 0, 1.3], [0.72, 1.6, 0.8, 0, 1.4], [0.88, 1.25, 0.6, 0.05, 1.5], [0.95, 1.15, 0.45, 0.05, 1.6], [1, 1.1, 0.36, 0.05, 1.8]] },
  f35: { radial: 22, flat: false, keys: [[0, 0.02, 0.02, 0.05, 2], [0.06, 0.4, 0.37, 0.1, 2], [0.15, 0.72, 0.62, 0.15, 2], [0.25, 1.3, 0.86, 0.05, 1.6], [0.42, 1.6, 0.95, 0, 1.6], [0.65, 1.5, 0.86, 0, 1.8], [0.85, 1.0, 0.75, 0.05, 2], [0.95, 0.66, 0.62, 0.05, 2], [1, 0.6, 0.6, 0.05, 2]] },
  rafale: { radial: 22, flat: false, keys: [[0, 0.02, 0.02, 0, 2], [0.07, 0.32, 0.32, 0.05, 2], [0.18, 0.55, 0.62, 0.16, 2], [0.3, 0.95, 0.86, 0, 1.8], [0.45, 1.25, 0.9, -0.05, 1.7], [0.7, 1.2, 0.85, 0, 1.8], [0.9, 1.0, 0.7, 0, 2], [1, 0.95, 0.55, 0, 2]] },
  a380: { radial: 40, flat: false, keys: [[0, 0.05, 0.05, -0.6, 2], [0.012, 1.3, 1.6, -0.5, 2], [0.05, 2.75, 3.45, 0, 2], [0.1, 3.5, 4.15, 0, 2.1], [0.12, 3.57, 4.2, 0, 2.15], [0.7, 3.57, 4.2, 0, 2.15], [0.86, 2.55, 3.1, 0.7, 2], [0.97, 0.95, 1.3, 1.9, 2], [1, 0.4, 0.6, 2.2, 2]] },
  b787: { radial: 36, flat: false, keys: [[0, 0.05, 0.05, -0.3, 2], [0.02, 1.15, 1.15, -0.3, 2], [0.07, 2.65, 2.75, 0, 2], [0.1, 2.88, 2.98, 0, 2], [0.74, 2.88, 2.98, 0, 2], [0.88, 1.9, 2.0, 0.55, 2], [0.98, 0.6, 0.7, 1.3, 2], [1, 0.25, 0.35, 1.4, 2]] },
  g8000: { radial: 32, flat: false, keys: [[0, 0.04, 0.04, -0.1, 2], [0.03, 0.75, 0.8, -0.15, 2], [0.1, 1.3, 1.35, 0, 2], [0.12, 1.35, 1.4, 0, 2], [0.68, 1.35, 1.4, 0, 2], [0.85, 1.0, 1.05, 0.25, 2], [0.98, 0.35, 0.4, 0.55, 2], [1, 0.2, 0.25, 0.6, 2]] },
  dr400: { radial: 26, flat: false, keys: [[0, 0.16, 0.16, -0.05, 2], [0.03, 0.42, 0.38, -0.05, 2.5], [0.12, 0.5, 0.5, 0, 3], [0.2, 0.55, 0.62, 0.05, 3], [0.42, 0.55, 0.6, 0.03, 3], [0.6, 0.38, 0.42, 0, 2.6], [0.85, 0.2, 0.28, 0.12, 2.2], [1, 0.1, 0.2, 0.2, 2]] },
};

function sampleProfile(keys: Key[], xi: number): Key {
  if (xi <= keys[0][0]) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (xi <= b[0]) {
      let t = (xi - a[0]) / (b[0] - a[0]);
      t = t * t * (3 - 2 * t);
      return [xi, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t];
    }
  }
  return keys[keys.length - 1];
}

function superEllipse(theta: number, n: number): [number, number] {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [Math.sign(c) * Math.pow(Math.abs(c), 2 / n), Math.sign(s) * Math.pow(Math.abs(s), 2 / n)];
}

/** Surface du fuselage (demi-section éventuellement) : lofting superellipse le long de X. */
function buildFuselage(spec: AircraftSpec, mat: THREE.Material): THREE.Mesh {
  const prof = PROFILES[spec.id];
  const L = spec.fuselage.length;
  const NX = spec.category === 'airliner' ? 120 : 96;
  const NT = prof.flat ? prof.radial : Math.max(prof.radial, 40);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= NX; i++) {
    // échantillonnage resserré au nez et à la queue (galbe plus lisse)
    const t = i / NX;
    const xi = 0.5 - 0.5 * Math.cos(Math.PI * t) * 0.35 - (0.5 - t) * 0.65;
    const [, w, h, yc, n] = sampleProfile(prof.keys, xi);
    for (let j = 0; j <= NT; j++) {
      const th = (j / NT) * Math.PI * 2;
      const [cx, sy] = superEllipse(th, n);
      pos.push(-xi * L, spec.fuselage.axisY + yc + sy * h, cx * w);
      uv.push(xi, j / NT);
    }
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NT; j++) {
    const a = i * (NT + 1) + j, b = a + NT + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  if (prof.flat) geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  if (!prof.flat) {
    // couture j=0 / j=NT : normales moyennées (pas de ligne visible)
    const nr = geo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i <= NX; i++) {
      const a = i * (NT + 1), b = a + NT;
      const x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      nr.setXYZ(a, x / l, y / l, z / l);
      nr.setXYZ(b, x / l, y / l, z / l);
    }
  }
  const m = new THREE.Mesh(geo, mat);
  m.name = 'fuselage';
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Point (demi-dimensions) du fuselage à la station x (repère modèle). */
export function fuselageSection(spec: AircraftSpec, x: number): { w: number; h: number; yc: number } {
  const [, w, h, yc] = sampleProfile(PROFILES[spec.id].keys, Math.min(1, Math.max(0, -x / spec.fuselage.length)));
  return { w, h, yc: yc + spec.fuselage.axisY };
}

// ───────────────────────────── Surfaces portantes ─────────────────────────────

interface SurfPoint { le: THREE.Vector3; chord: number; twist: number }

function stationAt(st: Station[], t: number): SurfPoint {
  const lens: number[] = [];
  let tot = 0;
  for (let i = 0; i < st.length - 1; i++) {
    const l = Math.hypot(st[i + 1].le[1] - st[i].le[1], st[i + 1].le[2] - st[i].le[2]);
    lens.push(l);
    tot += l;
  }
  let d = t * tot;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] + 1e-9 || i === lens.length - 1) {
      const f = lens[i] > 0 ? Math.min(1, d / lens[i]) : 0;
      const a = st[i], b = st[i + 1];
      return {
        le: new V3(a.le[0] + (b.le[0] - a.le[0]) * f, a.le[1] + (b.le[1] - a.le[1]) * f, a.le[2] + (b.le[2] - a.le[2]) * f),
        chord: a.chord + (b.chord - a.chord) * f,
        twist: a.twist + (b.twist - a.twist) * f,
      };
    }
    d -= lens[i];
  }
  const l = st[st.length - 1];
  return { le: new V3(...l.le), chord: l.chord, twist: l.twist };
}

/** Coordonnées du profil (extrados puis intrados) entre les fractions de corde u0..u1. */
function airfoilLoop(tc: number, camber: number, cpos: number, u0: number, u1: number, n: number): [number, number][] {
  const yt = (x: number) => 5 * tc * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
  const yc = (x: number) => (camber === 0 ? 0 : x < cpos ? (camber / (cpos * cpos)) * (2 * cpos * x - x * x) : (camber / ((1 - cpos) ** 2)) * (1 - 2 * cpos + 2 * cpos * x - x * x));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const s = u0 + (u1 - u0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / n));
    pts.push([s, yc(s) + yt(s)]);
  }
  for (let i = n; i >= 0; i--) {
    const s = u0 + (u1 - u0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / n));
    pts.push([s, yc(s) - yt(s)]);
  }
  return pts;
}

/**
 * Loft d'une portion de surface (span t0..t1, corde u0..u1), coordonnées relatives à `origin`.
 * `normalDir` : direction « épaisseur » (Y pour une aile, ±Z pour une dérive).
 */
function loftPart(surf: LiftingSurface, mirror: number, t0: number, t1: number, u0: number, u1: number, origin: THREE.Vector3, vertical: boolean): THREE.BufferGeometry {
  const st = mirror < 0 ? surf.stations.map((s) => ({ ...s, le: [s.le[0], s.le[1], -s.le[2]] as [number, number, number] })) : surf.stations;
  const af = surf.airfoil;
  const nc = 10;
  const ns = 3;
  const loop = airfoilLoop(af.thickness, af.camber, af.camberPos, u0, u1, nc);
  const m = loop.length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= ns; k++) {
    const t = t0 + ((t1 - t0) * k) / ns;
    const sp = stationAt(st, t);
    const tw = (sp.twist * Math.PI) / 180;
    for (const [u, y] of loop) {
      // rotation de vrillage autour du BA
      const dx = -u * sp.chord, dy = y * sp.chord;
      const rx = dx * Math.cos(tw) - dy * Math.sin(tw);
      const ry = dx * Math.sin(tw) + dy * Math.cos(tw);
      if (vertical) pos.push(sp.le.x + rx - origin.x, sp.le.y - origin.y, sp.le.z + ry * mirror - origin.z);
      else pos.push(sp.le.x + rx - origin.x, sp.le.y + ry - origin.y, sp.le.z - origin.z);
    }
  }
  for (let k = 0; k < ns; k++) for (let j = 0; j < m - 1; j++) {
    const a = k * m + j, b = a + m;
    if (mirror > 0 !== vertical) idx.push(a, b, a + 1, a + 1, b, b + 1);
    else idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  // capots d'extrémité
  for (const k of [0, ns]) {
    const base = k * m;
    const c = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < m; j++) { cx += pos[3 * (base + j)]; cy += pos[3 * (base + j) + 1]; cz += pos[3 * (base + j) + 2]; }
    pos.push(cx / m, cy / m, cz / m);
    for (let j = 0; j < m - 1; j++) {
      if ((k === 0) === (mirror > 0 !== vertical)) idx.push(c, base + j + 1, base + j);
      else idx.push(c, base + j, base + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface BuildCtx {
  spec: AircraftSpec;
  mats: AircraftMaterials;
  root: THREE.Group;
}

const SIDE_SUFFIX = (mirror: number, sym: boolean) => (sym ? (mirror > 0 ? '_R' : '_L') : '');

/**
 * Construit une surface portante complète (un côté) : segments chaînés (flexion),
 * parties fixes, bord d'attaque aluminium, gouvernes pivotantes.
 */
function buildSurface(ctx: BuildCtx, surf: LiftingSurface, mirror: number): THREE.Group {
  const { spec, mats } = ctx;
  const vertical = surf.role === 'vtail';
  const flexSegs = surf.role === 'wing' ? [0.25, 0.45, 0.65, 0.82] : [];
  const bps = new Set<number>([0, 1, ...flexSegs]);
  for (const c of surf.controls) { bps.add(c.spanFrom); bps.add(c.spanTo); }
  const ts = [...bps].sort((a, b) => a - b);
  const st = mirror < 0 ? surf.stations.map((s) => ({ ...s, le: [s.le[0], s.le[1], -s.le[2]] as [number, number, number] })) : surf.stations;
  const top = new THREE.Group();
  top.name = `${surf.name}${SIDE_SUFFIX(mirror, surf.symmetric)}`;
  let parent: THREE.Object3D = top;
  let parentOrigin = new V3(0, 0, 0);
  const counts: Record<string, number> = {};
  const skin = surf.role === 'vtail' && spec.category !== 'fighter' ? mats.secondary : mats.skin;
  for (let s = 0; s < ts.length - 1; s++) {
    const t0 = ts[s], t1 = ts[s + 1];
    if (t1 - t0 < 1e-4) continue;
    const o = stationAt(st, t0).le;
    let seg: THREE.Object3D;
    if (surf.role === 'wing' && flexSegs.includes(t0)) {
      // nouveau segment de flexion, enfant du précédent
      const g = new THREE.Group();
      g.name = `flex_${surf.name}${SIDE_SUFFIX(mirror, true)}_${flexSegs.indexOf(t0)}`;
      g.userData.flexSide = mirror;
      g.userData.flexIndex = flexSegs.indexOf(t0);
      g.position.copy(o).sub(parentOrigin);
      parent.add(g);
      parent = g;
      parentOrigin = o.clone();
      seg = g;
    } else seg = parent;
    const ctl = surf.controls.find((c) => c.spanFrom <= t0 + 1e-6 && c.spanTo >= t1 - 1e-6);
    const hingeU = ctl ? 1 - ctl.chordFrac : 1;
    const useLE = !vertical && hingeU > 0.1 && mats.leadingEdge !== mats.skin;
    if (useLE) {
      seg.add(mesh(loftPart(surf, mirror, t0, t1, 0, 0.07, parentOrigin, vertical), mats.leadingEdge));
      seg.add(mesh(loftPart(surf, mirror, t0, t1, 0.07, hingeU, parentOrigin, vertical), skin));
    } else if (hingeU > 0.001) {
      seg.add(mesh(loftPart(surf, mirror, t0, t1, 0, hingeU, parentOrigin, vertical), skin));
    }
    if (ctl) seg.add(controlPivot(ctx, surf, ctl, mirror, t0, t1, st, parentOrigin, vertical, counts, skin));
  }
  // winglets / saumons spécifiques
  if (surf.role === 'wing') addWinglet(ctx, parent, st, parentOrigin, mirror);
  return top;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const x = new THREE.Mesh(g, m);
  x.castShadow = true;
  x.receiveShadow = true;
  return x;
}

function controlPivot(_ctx: BuildCtx, surf: LiftingSurface, ctl: ControlSurface, mirror: number, t0: number, t1: number, st: Station[], origin: THREE.Vector3, vertical: boolean, counts: Record<string, number>, skin: THREE.Material): THREE.Group {
  const hu = 1 - ctl.chordFrac;
  const p0 = stationAt(st, t0), p1 = stationAt(st, t1);
  const h0 = p0.le.clone().add(new V3(-hu * p0.chord, 0, 0));
  const h1 = p1.le.clone().add(new V3(-hu * p1.chord, 0, 0));
  const axis = h1.clone().sub(h0).normalize();
  const pivot = new THREE.Group();
  const base = ctl.node + SIDE_SUFFIX(mirror, surf.symmetric || ctl.node === 'rudder' && surf.symmetric);
  counts[base] = (counts[base] ?? 0) + 1;
  pivot.name = counts[base] > 1 ? `${base}_${counts[base]}` : base;
  pivot.userData.control = ctl.kind;
  pivot.userData.maxDeg = ctl.maxDeg;
  pivot.userData.side = mirror;
  // signe : + = BF vers le bas (surfaces horizontales) / vers +Z (dérives)
  pivot.userData.hingeSign = vertical ? 1 : mirror > 0 ? 1 : -1;
  pivot.position.copy(h0).sub(origin);
  const inner = new THREE.Group();
  inner.quaternion.setFromUnitVectors(new V3(1, 0, 0), axis);
  pivot.add(inner);
  const g = loftPart(surf, mirror, t0, t1, hu, 1, h0, vertical);
  // géométrie exprimée dans le repère de la charnière
  g.applyQuaternion(inner.quaternion.clone().invert());
  const m = mesh(g, skin);
  inner.add(m);
  // l'axe de rotation est l'axe X local de `inner` ; on expose `inner` comme nœud animé
  inner.name = `${pivot.name}__hinge`;
  return pivot;
}

function addWinglet(ctx: BuildCtx, parent: THREE.Object3D, st: Station[], origin: THREE.Vector3, mirror: number): void {
  const { spec, mats } = ctx;
  const tip = st[st.length - 1];
  const kind = spec.id === 'a380' ? 'fence' : spec.id === 'g8000' ? 'blended' : null;
  if (!kind) return;
  const h = kind === 'fence' ? 3.5 : 1.8;
  const cant = kind === 'fence' ? 0 : 20;
  const wl: LiftingSurface = {
    name: 'winglet', role: 'vtail', symmetric: false, airfoil: { name: 'wl', camber: 0, camberPos: 0.4, thickness: 0.08, clMax: 1 }, controls: [],
    stations: [
      { le: [tip.le[0] - tip.chord * 0.05, tip.le[1], tip.le[2]], chord: tip.chord * 0.95, twist: 0 },
      { le: [tip.le[0] - tip.chord * 0.6 - h * 0.6, tip.le[1] + h * Math.cos((cant * Math.PI) / 180), tip.le[2] + mirror * h * Math.sin((cant * Math.PI) / 180)], chord: tip.chord * 0.4, twist: 0 },
    ],
  };
  const g = loftPart(wl, 1, 0, 1, 0, 1, origin, true);
  const m = mesh(g, mats.skin);
  m.name = `winglet${mirror > 0 ? '_R' : '_L'}`;
  parent.add(m);
}

// ───────────────────────────── Moteurs ─────────────────────────────

function lathe(profile: [number, number][], segs: number, mat: THREE.Material): THREE.Mesh {
  // profil (x, r) → révolution autour de l'axe X
  const pts = profile.map(([x, r]) => new THREE.Vector2(r, x));
  const g = new THREE.LatheGeometry(pts, segs);
  g.rotateZ(-Math.PI / 2); // axe Y → axe X
  g.rotateX(Math.PI / 2);
  return mesh(g, mat);
}

function chevronRing(r: number, len: number, lobes: number, mat: THREE.Material): THREE.Mesh {
  const N = lobes * 2;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const tipX = i % 2 === 0 ? -len : 0;
    const rr = i % 2 === 0 ? r * 0.93 : r;
    pos.push(0, Math.sin(a) * r, Math.cos(a) * r, tipX, Math.sin(a) * rr, Math.cos(a) * rr);
  }
  for (let i = 0; i < N; i++) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  (m.material as THREE.Material).side = THREE.DoubleSide;
  return m;
}

/** Flamme de postcombustion volumétrique avec diamants de choc (anneaux de Mach). */
export function afterburnerMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uIntensity: { value: 0 }, uTime: { value: 0 }, uRings: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vPos; varying vec3 vN; varying vec3 vView;
      void main() {
        vPos = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity; uniform float uTime; uniform float uRings;
      varying vec3 vPos; varying vec3 vN; varying vec3 vView;
      void main() {
        float x = clamp(-vPos.x, 0.0, 1.0);           // 0 = sortie tuyère, 1 = bout de flamme
        float core = pow(abs(dot(vN, vView)), 1.6);     // épaisseur optique (bords transparents)
        float flick = 0.85 + 0.15 * sin(uTime * 60.0 + x * 30.0);
        float diamonds = uRings * smoothstep(0.55, 1.0, 0.5 + 0.5 * cos(x * 28.0)) * (1.0 - x);
        vec3 hot = mix(vec3(1.0, 0.85, 0.55), vec3(1.0, 0.45, 0.15), x);
        vec3 blue = vec3(0.45, 0.6, 1.0);
        vec3 col = mix(blue, hot, smoothstep(0.0, 0.35, x)) * (1.0 - x) * flick + vec3(1.0, 0.75, 0.5) * diamonds * 1.6;
        float a = uIntensity * core * (1.0 - x * 0.9);
        gl_FragColor = vec4(col * a * 1.8, a);
      }`,
  });
}

function buildEngines(ctx: BuildCtx): void {
  const { spec, mats, root } = ctx;
  spec.engines.forEach((e, i) => {
    const [ex, ey, ez] = e.pos;
    if (e.type === 'turbofan') {
      const big = spec.category === 'airliner';
      const R = spec.id === 'a380' ? 1.55 : spec.id === 'b787' ? 1.5 : 0.78;
      const len = spec.id === 'a380' ? 5.6 : spec.id === 'b787' ? 5.2 : 3.4;
      const g = new THREE.Group();
      g.name = `engine_${i}`;
      g.position.set(ex, ey, ez);
      // nacelle : de l'entrée (x = +len) à la tuyère (x = 0)
      const prof: [number, number][] = [
        [0, R * 0.78], [len * 0.15, R * 0.92], [len * 0.55, R * 1.08], [len * 0.88, R * 1.06], [len * 0.97, R * 1.0], [len, R * 0.93],
        [len * 0.985, R * 0.88],
      ];
      const nac = lathe(prof, 40, spec.id === 'b787' ? mats.skin : mats.skin);
      g.add(nac);
      // intérieur sombre + soufflante
      const inner = lathe([[len * 0.98, R * 0.9], [len * 0.7, R * 0.88], [len * 0.3, R * 0.8]], 32, mats.intake);
      g.add(inner);
      const fan = new THREE.Group();
      fan.name = `fan_${i}`;
      fan.position.x = len * 0.82;
      const bladeG = new THREE.BoxGeometry(0.05, R * 0.82, R * 0.2);
      bladeG.translate(0, R * 0.45, 0);
      for (let k = 0; k < 20; k++) {
        const b = new THREE.Mesh(bladeG, mats.metalDark);
        b.rotation.x = (k / 20) * Math.PI * 2;
        b.rotation.y = 0.5;
        fan.add(b);
      }
      const spinner = lathe([[0.35, 0], [0, R * 0.28], [-0.2, R * 0.3]], 24, mats.metalDark);
      fan.add(spinner);
      g.add(fan);
      // cône de sortie + chevrons (787)
      g.add(lathe([[0.02, R * 0.55], [-R * 0.9, R * 0.1], [-R * 1.0, 0.0]], 24, mats.metalDark));
      if (spec.id === 'b787') {
        const ch = chevronRing(R * 0.78, 0.5, 14, mats.skin.clone());
        g.add(ch);
      }
      // pylône
      if (big) {
        // mât : du dessus de la nacelle jusqu'à l'intrados, sous le caisson de voilure
        const w = wingAt(spec, Math.abs(ez));
        const x0 = Math.min(len * 0.4, w.x - ex - w.chord * 0.3), x1 = len * 0.72;
        const yTop = w.y - ey - 0.15;
        const hp = Math.max(0.5, yTop - R * 0.85);
        const pg = new THREE.BoxGeometry(x1 - x0, hp, 0.45);
        // biseau avant : profil effilé
        const pp = pg.getAttribute('position') as THREE.BufferAttribute;
        for (let k = 0; k < pp.count; k++) if (pp.getX(k) > 0 && pp.getY(k) > 0) pp.setX(k, pp.getX(k) - (x1 - x0) * 0.35);
        pg.computeVertexNormals();
        const py = new THREE.Mesh(pg, mats.skin);
        py.position.set((x0 + x1) / 2, R * 0.85 + hp / 2, 0);
        g.add(py);
      } else {
        const py = new THREE.Mesh(new THREE.BoxGeometry(len * 0.6, 0.35, Math.abs(ez) - 1.2), mats.skin);
        py.position.set(len * 0.5, 0, -Math.sign(ez) * (Math.abs(ez) - 1.2) / 2 - Math.sign(ez) * R * 0.6);
        g.add(py);
      }
      root.add(g);
    } else if (e.type === 'turbojet_ab') {
      const g = new THREE.Group();
      g.name = `engine_${i}`;
      g.position.set(ex, ey, ez);
      const twin = spec.engines.length > 1;
      const suffix = twin ? (ez < 0 ? '_L' : '_R') : '';
      const R = spec.id === 'f35' ? 0.62 : spec.id === 'rafale' ? 0.45 : 0.55;
      if (spec.id === 'f22') {
        // tuyère 2D rectangulaire, volets vectoriels
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 1.0), mats.metalHot);
        box.position.x = 0.6;
        g.add(box);
        const noz = new THREE.Group();
        noz.name = `nozzle${suffix}`;
        noz.userData.vector = true;
        for (const sy of [1, -1]) {
          const flap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.95), mats.metalHot);
          flap.position.set(-0.45, sy * 0.3, 0);
          noz.add(flap);
        }
        g.add(noz);
      } else {
        // tuyère ronde convergente-divergente (dentelée sur le F-35)
        const noz = new THREE.Group();
        noz.name = `nozzle${suffix}`;
        noz.userData.vector = spec.id === 'f35';
        const body = lathe([[1.0, R * 1.05], [0.3, R * 1.0], [0, R * 0.92]], 28, mats.metalHot);
        noz.add(body);
        if (spec.id === 'f35') noz.add(chevronRing(R * 0.92, 0.25, 12, mats.metalHot.clone()));
        noz.add(lathe([[0.6, R * 0.82], [0.02, R * 0.85]], 28, mats.intake));
        g.add(noz);
      }
      // postcombustion
      const ab = new THREE.Mesh(new THREE.ConeGeometry(R * 0.85, 1, 24, 1, true), afterburnerMaterial());
      ab.geometry.translate(0, -0.5, 0);
      ab.geometry.rotateZ(Math.PI / 2);
      ab.name = `afterburner${suffix || '_0'}`;
      ab.scale.set(R * 9, 1, 1);
      ab.frustumCulled = false;
      g.add(ab);
      root.add(g);
    } else {
      // hélice bipale + cône + disque de flou
      const g = new THREE.Group();
      g.name = 'propeller';
      g.position.set(ex + 0.4, ey - 0.05, ez);
      g.add(lathe([[0.32, 0], [0.1, 0.16], [0, 0.18]], 20, mats.accent));
      const D = e.propDiameter ?? 1.8;
      const bladeG = new THREE.BoxGeometry(0.04, D / 2, 0.14);
      bladeG.translate(0, D / 4, 0);
      for (let k = 0; k < 2; k++) {
        const b = new THREE.Mesh(bladeG, mats.metalDark);
        b.rotation.x = k * Math.PI;
        b.rotation.y = 0.25;
        b.name = 'prop_blade';
        g.add(b);
      }
      root.add(g);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(D / 2, 48), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      disc.rotation.y = Math.PI / 2;
      disc.position.copy(g.position).add(new V3(0.02, 0, 0));
      disc.name = 'prop_disc';
      root.add(disc);
    }
  });
  // STOVL : porte de soufflante (F-35B), pivotant vers le haut à l'arrière
  if (spec.stovl) {
    const sv = spec.stovl;
    const door = new THREE.Group();
    door.name = 'liftfan_door';
    door.position.set(sv.liftFanPos[0] - 0.8, fuselageSection(spec, sv.liftFanPos[0]).yc + fuselageSection(spec, sv.liftFanPos[0]).h + 0.02, 0);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 1.1), mats.skin);
    plate.position.x = 0.8;
    door.add(plate);
    root.add(door);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 28), mats.intake);
    fan.position.set(sv.liftFanPos[0], door.position.y - 0.08, 0);
    root.add(fan);
  }
}

// ───────────────────────────── Train d'atterrissage ─────────────────────────────

function buildGear(ctx: BuildCtx): void {
  const { spec, mats, root } = ctx;
  for (const leg of spec.gear) {
    const [gx, gy, gz] = leg.pos;
    const sec = fuselageSection(spec, gx);
    const mountY = Math.max(gy + leg.wheelRadius * 2 + 0.3, Math.min(sec.yc - sec.h * 0.6, gy + 3.5));
    const strutLen = mountY - (gy + leg.wheelRadius);
    const g = new THREE.Group();
    g.name = leg.name;
    g.position.set(gx, mountY, gz);
    g.userData.travel = leg.travel;
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(leg.wheelRadius * 0.28, leg.wheelRadius * 0.28, strutLen * 0.6, 12), mats.strut);
    upper.position.y = -strutLen * 0.3;
    g.add(upper);
    const strut = new THREE.Group();
    strut.name = `gear_strut_${leg.name.replace('gear_', '')}`;
    g.add(strut);
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(leg.wheelRadius * 0.2, leg.wheelRadius * 0.2, strutLen * 0.55, 12), mats.strut);
    lower.position.y = -strutLen * 0.72;
    strut.add(lower);
    const wheelG = new THREE.CylinderGeometry(leg.wheelRadius, leg.wheelRadius, leg.wheelRadius * 0.6, 24);
    wheelG.rotateX(Math.PI / 2);
    const bogies = leg.bogies ?? 1;
    const perBogie = Math.max(1, Math.round(leg.wheels / 1));
    for (let b = 0; b < bogies; b++) {
      const bz = bogies > 1 ? (b - (bogies - 1) / 2) * 2.2 * Math.sign(gz || 1) : 0;
      for (let k = 0; k < perBogie; k++) {
        const rows = perBogie >= 4 ? 2 : 1;
        const cols = Math.ceil(perBogie / rows);
        const r = k % rows, c = Math.floor(k / rows);
        const w = new THREE.Mesh(wheelG, mats.rubber);
        w.castShadow = true;
        w.name = 'wheel';
        w.position.set((r - (rows - 1) / 2) * leg.wheelRadius * 2.3, -strutLen, bz + (c - (cols - 1) / 2) * leg.wheelRadius * 0.75 + (cols === 1 ? 0 : 0));
        strut.add(w);
      }
    }
    // carénages de roues du DR-400
    if (spec.id === 'dr400') {
      const fairing = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mats.skin);
      fairing.scale.set(leg.wheelRadius * 2.6, leg.wheelRadius * 1.2, leg.wheelRadius * 0.9);
      fairing.position.y = -strutLen + leg.wheelRadius * 0.15;
      strut.add(fairing);
    }
    root.add(g);
  }
}

// ───────────────────────────── Verrière, hublots, crosse, feux ─────────────────────────────

function buildCanopyAndWindows(ctx: BuildCtx): void {
  const { spec, mats, root } = ctx;
  const [ex, ey] = spec.eye;
  if (spec.category === 'fighter' || spec.id === 'dr400') {
    const dr = spec.id === 'dr400';
    const len = dr ? 2.1 : spec.id === 'f22' ? 3.3 : 3.0;
    const wid = dr ? 0.58 : 0.42;
    const hei = dr ? 0.62 : 0.5;
    const canopy = new THREE.Group();
    canopy.name = 'canopy';
    const bub = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass);
    bub.scale.set(len / 2, hei, wid);
    canopy.add(bub);
    const sec = fuselageSection(spec, ex + (dr ? -0.6 : 0.3));
    canopy.position.set(ex + (dr ? -0.6 : 0.25), Math.max(ey - 0.55, sec.yc + sec.h * 0.55), 0);
    canopy.userData.slide = dr;
    root.add(canopy);
    // arceau de verrière
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 24, Math.PI), mats.metalDark);
    arch.rotation.y = Math.PI / 2;
    arch.scale.set(wid, hei, 1);
    arch.position.x = dr ? 0.1 : -len * 0.18;
    canopy.add(arch);
  }
  // avions de ligne / affaires : hublots, pare-brise, portes peints dans la livrée (livery.ts)
}

/** Point de l'aile (BA, corde) à la demi-envergure |z|. */
function wingAt(spec: AircraftSpec, zAbs: number): { x: number; y: number; chord: number } {
  const st = spec.surfaces[0].stations;
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1];
    if (zAbs <= b.le[2] || i === st.length - 2) {
      const f = Math.max(0, Math.min(1, (zAbs - a.le[2]) / ((b.le[2] - a.le[2]) || 1)));
      return { x: a.le[0] + (b.le[0] - a.le[0]) * f, y: a.le[1] + (b.le[1] - a.le[1]) * f, chord: a.chord + (b.chord - a.chord) * f };
    }
  }
  return { x: st[0].le[0], y: st[0].le[1], chord: st[0].chord };
}

/** Détails de forme : carénage voilure-fuselage, LERX/chines, perche, cône de queue, raccords. */
function buildDetails(ctx: BuildCtx): void {
  const { spec, mats, root } = ctx;
  const L = spec.fuselage.length;
  if (spec.category === 'airliner' || spec.category === 'bizjet') {
    const w = wingAt(spec, 0);
    const sec = fuselageSection(spec, w.x - w.chord * 0.45);
    const f = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 18), mats.skin);
    f.scale.set(w.chord * 0.78, sec.h * 0.42, sec.w * 0.98);
    f.position.set(w.x - w.chord * 0.42, sec.yc - sec.h * 0.62, 0);
    root.add(f);
    // cône de queue / sortie APU
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.9, 16), mats.metalDark);
    tail.rotation.z = Math.PI / 2;
    const ts = fuselageSection(spec, -L * 0.995);
    tail.position.set(-L * 0.995, ts.yc, 0);
    root.add(tail);
    if (spec.id === 'g8000') {
      // carénage de jonction de l'empennage en T
      const vt = spec.surfaces.find((s) => s.role === 'vtail')!.stations;
      const top = vt[vt.length - 1];
      const bullet = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mats.skin);
      bullet.scale.set(top.chord * 0.7, 0.35, 0.35);
      bullet.position.set(top.le[0] - top.chord * 0.45, top.le[1], 0);
      root.add(bullet);
    }
  }
  if (spec.id === 'f22' || spec.id === 'f35') {
    // chines / LERX : plaques triangulaires du nez à l'emplanture
    const w = wingAt(spec, 0);
    for (const side of [1, -1]) {
      const sh = new THREE.Shape();
      const s0 = fuselageSection(spec, -L * 0.1), s1 = fuselageSection(spec, w.x);
      sh.moveTo(-L * 0.08, s0.w * 0.95);
      sh.lineTo(w.x - 0.5, s1.w * 1.25);
      sh.lineTo(w.x - w.chord * 0.3, s1.w * 0.9);
      sh.lineTo(-L * 0.12, s0.w * 0.8);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false });
      g.rotateX(Math.PI / 2);
      if (side < 0) g.scale(1, 1, -1);
      const m = new THREE.Mesh(g, mats.skin);
      m.position.y = s0.yc + 0.03;
      root.add(m);
    }
  }
  if (spec.id === 'rafale') {
    // perche de ravitaillement fixe (côté droit du pare-brise)
    const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.6, 10), mats.metalDark);
    probe.rotation.z = Math.PI / 2 - 0.08;
    probe.position.set(spec.eye[0] + 1.2, spec.eye[1] - 0.25, 0.42);
    root.add(probe);
    // raccords des canards
    const cn = spec.surfaces.find((s) => s.role === 'canard')!.stations[0];
    for (const side of [1, -1]) {
      const pod = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mats.skin);
      pod.scale.set(cn.chord * 0.7, 0.18, 0.16);
      pod.position.set(cn.le[0] - cn.chord * 0.4, cn.le[1], side * cn.le[2]);
      root.add(pod);
    }
  }
  if (spec.id === 'dr400') {
    // carénage d'emplanture (congé) et antenne
    const w = wingAt(spec, 0.5);
    for (const side of [1, -1]) {
      const fil = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mats.skin);
      fil.scale.set(w.chord * 0.55, 0.12, 0.2);
      fil.position.set(w.x - w.chord * 0.45, w.y + 0.05, side * 0.52);
      root.add(fil);
    }
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.45, 6), mats.metalDark);
    ant.position.set(-3.2, 0.62, 0);
    ant.rotation.z = 0.35;
    root.add(ant);
  }
}

/**
 * Fusion des pièces statiques par matériau à l'intérieur de chaque nœud (réduction des
 * draw calls) — les nœuds nommés (gouvernes, train, feux, hélice…) restent animables.
 */
function mergeStatic(root: THREE.Object3D): void {
  const groups: THREE.Object3D[] = [];
  root.traverse((o) => groups.push(o));
  for (const parent of groups) {
    const byMat = new Map<THREE.Material, THREE.Mesh[]>();
    for (const ch of parent.children) {
      const m = ch as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || m.children.length) continue;
      if (m.name && m.name !== 'wheel') continue;
      if (Array.isArray(m.material) || (m.material as THREE.ShaderMaterial).isShaderMaterial) continue;
      const l = byMat.get(m.material as THREE.Material) ?? [];
      l.push(m);
      byMat.set(m.material as THREE.Material, l);
    }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        g = g.applyMatrix4(m.matrix);
        return g;
      });
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      for (const m of list) parent.remove(m);
      const mm = new THREE.Mesh(merged, mat);
      mm.castShadow = true;
      mm.receiveShadow = true;
      parent.add(mm);
    }
  }
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let GLOW: THREE.Texture | null = null;

function lightSprite(name: string, color: number, pos: THREE.Vector3, size: number): THREE.Sprite {
  if (!GLOW) GLOW = glowTexture();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.name = name;
  s.position.copy(pos);
  s.scale.setScalar(size);
  s.userData.baseSize = size;
  return s;
}

function buildLightsAndHook(ctx: BuildCtx): void {
  const { spec, mats, root } = ctx;
  const wing = spec.surfaces[0];
  const tip = wing.stations[wing.stations.length - 1];
  const sz = Math.max(0.5, spec.span * 0.03);
  const tx = tip.le[0] - tip.chord * 0.3;
  root.add(lightSprite('light_nav_L', 0xff2a1a, new V3(tx, tip.le[1], -tip.le[2] - 0.05), sz));
  root.add(lightSprite('light_nav_R', 0x22ff55, new V3(tx, tip.le[1], tip.le[2] + 0.05), sz));
  root.add(lightSprite('light_nav_tail', 0xffffff, new V3(-spec.length * 0.995, fuselageSection(spec, -spec.length * 0.99).yc, 0), sz * 0.8));
  root.add(lightSprite('light_strobe_L', 0xffffff, new V3(tx - 0.2, tip.le[1], -tip.le[2] - 0.1), sz * 1.6));
  root.add(lightSprite('light_strobe_R', 0xffffff, new V3(tx - 0.2, tip.le[1], tip.le[2] + 0.1), sz * 1.6));
  const mid = fuselageSection(spec, -spec.length * 0.45);
  root.add(lightSprite('light_beacon_top', 0xff2010, new V3(-spec.length * 0.45, mid.yc + mid.h + 0.05, 0), sz));
  root.add(lightSprite('light_beacon_bottom', 0xff2010, new V3(-spec.length * 0.45, mid.yc - mid.h - 0.05, 0), sz));
  // phare d'atterrissage (projecteur réel + halo)
  const land = new THREE.Group();
  land.name = 'light_landing';
  const lpos = spec.category === 'fighter' ? new V3(spec.gear[0].pos[0], spec.gear[0].pos[1] + 0.8, 0) : new V3(wing.stations[0].le[0] - 0.5, wing.stations[0].le[1], spec.fuselage.width * 0.7);
  land.position.copy(lpos);
  const spot = new THREE.SpotLight(0xfff4e0, 0, spec.length * 25, 0.32, 0.45, 1.2);
  spot.target.position.set(60, -8, 0);
  land.add(spot, spot.target);
  land.add(lightSprite('light_landing_glow', 0xfff8e8, new V3(0, 0, 0), sz * 1.5));
  root.add(land);
  if (spec.hasHook) {
    const hook = new THREE.Group();
    hook.name = 'hook';
    hook.position.set(-spec.length * 0.86, fuselageSection(spec, -spec.length * 0.86).yc - fuselageSection(spec, -spec.length * 0.86).h * 0.8, 0);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 8), mats.metalDark);
    bar.rotation.z = Math.PI / 2;
    bar.position.x = -0.9;
    hook.add(bar);
    const tipM = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.2), mats.accent);
    tipM.position.x = -1.8;
    hook.add(tipM);
    root.add(hook);
  }
}

/** Entrées d'air spécifiques (DSI F-35, caret F-22, semi-ventrales Rafale). */
function buildIntakes(ctx: BuildCtx): void {
  const { spec, mats, root } = ctx;
  if (spec.category !== 'fighter') return;
  const x = -spec.length * (spec.id === 'rafale' ? 0.3 : 0.26);
  const sec = fuselageSection(spec, x);
  for (const side of [1, -1]) {
    const g = new THREE.Group();
    const w = spec.id === 'rafale' ? 0.55 : 0.6, h = spec.id === 'rafale' ? 0.7 : 0.9;
    const box = new THREE.Mesh(new THREE.BoxGeometry(spec.length * 0.22, h, w), mats.skin);
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.85), mats.intake);
    mouth.rotation.y = Math.PI / 2;
    mouth.position.x = spec.length * 0.11 + 0.01;
    g.add(box, mouth);
    if (spec.id === 'f22') { box.rotation.x = side * 0.35; mouth.rotation.x = side * 0.35; }
    if (spec.id === 'f35') {
      const bump = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mats.skin);
      bump.scale.set(0.55, 0.3, 0.15);
      bump.position.set(spec.length * 0.1, 0, -side * w * 0.42);
      g.add(bump);
    }
    const y = spec.id === 'rafale' ? sec.yc - sec.h * 0.55 : sec.yc - sec.h * 0.1;
    g.position.set(x - spec.length * 0.06, y, side * (sec.w * 0.82));
    root.add(g);
  }
}

// ───────────────────────────── Assemblage ─────────────────────────────

export interface AircraftModel {
  /** groupe racine dont l'origine est au CG (repère physique) */
  object: THREE.Group;
  /** repère modèle (origine au nez) décalé du CG */
  model: THREE.Group;
  mats: AircraftMaterials;
}

export function buildAircraftModel(spec: AircraftSpec, xcg = 0): AircraftModel {
  const mats = createMaterials(spec);
  const model = new THREE.Group();
  model.name = `${spec.id}_model`;
  const ctx: BuildCtx = { spec, mats, root: model };
  // fuselage : matériau de peinture + livrée texturée (hublots, cheatlines, immatriculation)
  const livery = createLivery(spec);
  const fusMat = mats.skin.clone();
  fusMat.map = livery.map;
  fusMat.roughnessMap = livery.roughness;
  fusMat.color.set(0xffffff);
  model.add(buildFuselage(spec, fusMat));
  for (const s of spec.surfaces) {
    if (s.symmetric) {
      model.add(buildSurface(ctx, s, 1));
      model.add(buildSurface(ctx, s, -1));
    } else model.add(buildSurface(ctx, s, 1));
  }
  buildEngines(ctx);
  buildGear(ctx);
  buildCanopyAndWindows(ctx);
  buildIntakes(ctx);
  buildLightsAndHook(ctx);
  buildDetails(ctx);
  if (spec.id === 'dr400') {
    // capot moteur rouge
    const cowl = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mats.secondary);
    cowl.scale.set(0.85, 0.42, 0.46);
    cowl.position.set(-0.5, 0, 0);
    model.add(cowl);
  }
  mergeStatic(model);
  model.position.x = -xcg;
  const object = new THREE.Group();
  object.name = spec.id;
  object.add(model);
  return { object, model, mats };
}
