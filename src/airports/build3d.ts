/**
 * Construction 3D des aéroports, en échantillonnant EXACTEMENT les fonctions de
 * `airports.ts` (terrain, profils de piste) utilisées par la physique.
 * Terrain à grille non uniforme (fine au centre), pistes texturées (marquages OACI),
 * balisage, rampe d'approche, PAPI dynamiques, bâtiments (hangars, tour à radar rotatif),
 * océan animé, végétation instanciée.
 */
import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  approachRef, dirFromHeading, profileHeight, terrainHeight, type AirportDef, type ApproachRef, type ApronDef, type RunwayDef,
} from './airports';
import { LightField } from '../world/lightField';
import { fbm2 } from '../physics/math';

export interface AirportScene {
  group: THREE.Group;
  water: Water | null;
  /** feux PAPI : 4 feux par piste (indices dans le champ de feux), couleur selon l'œil */
  papis: { ref: ApproachRef; lights: number[] }[];
  lights: LightField;
  radar: THREE.Object3D | null;
  update(eye: THREE.Vector3, t: number, dt: number): void;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Texture de piste (marquages OACI : seuil, numéros, axe, zone de toucher, points visés). */
function runwayTexture(r: RunwayDef): THREE.CanvasTexture {
  const W = 256, H = Math.min(8192, Math.max(1024, Math.round((r.length / r.width) * 128)));
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#3b3d40';
    g.fillRect(0, 0, W, H);
    // grain d'asphalte
    for (let i = 0; i < W * H * 0.02; i++) {
      const v = 50 + Math.random() * 30;
      g.fillStyle = `rgb(${v},${v},${v + 2})`;
      g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    }
    const mpp = r.length / H; // mètres par pixel (longueur)
    const ppmW = W / r.width;
    g.fillStyle = '#e8e8e2';
    const ends = [0, H];
    for (const end of ends) {
      const dir = end === 0 ? 1 : -1;
      const y0 = end === 0 ? 0 : H;
      // seuil : bandes « piano »
      const nb = r.width >= 45 ? 16 : r.width >= 30 ? 12 : 8;
      const bw = (r.width - 6) / (nb * 2);
      for (let i = 0; i < nb; i++) {
        const x = (3 + i * 2 * bw + (i >= nb / 2 ? bw : 0)) * ppmW;
        g.fillRect(x, y0 + dir * (6 / mpp) - (dir < 0 ? 30 / mpp : 0), bw * ppmW, 30 / mpp);
      }
      // numéro de piste
      const label = end === 0 ? r.id : r.opposite;
      g.save();
      g.translate(W / 2, y0 + dir * (60 / mpp));
      if (dir < 0) g.rotate(Math.PI);
      g.scale(1, 9 / mpp / 14);
      g.font = `bold ${Math.round(W * 0.42)}px Arial`;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText(label, 0, 0);
      g.restore();
      // zone de toucher + point visé
      if (r.length > 1200) {
        for (let k = 0; k < 3; k++) {
          const yy = y0 + dir * ((150 + k * 150) / mpp);
          g.fillRect(W * 0.18, yy, W * 0.1, dir * (22 / mpp));
          g.fillRect(W * 0.72, yy, W * 0.1, dir * (22 / mpp));
        }
        g.fillRect(W * 0.15, y0 + dir * (400 / mpp), W * 0.16, dir * (45 / mpp));
        g.fillRect(W * 0.69, y0 + dir * (400 / mpp), W * 0.16, dir * (45 / mpp));
      }
    }
    // axe central
    for (let y = 130 / mpp; y < H - 130 / mpp; y += 50 / mpp) g.fillRect(W / 2 - 0.45 * ppmW, y, 0.9 * ppmW, 30 / mpp);
    // bords
    g.fillRect(0.4 * ppmW, 0, 0.9 * ppmW, H);
    g.fillRect(W - 1.3 * ppmW, 0, 0.9 * ppmW, H);
  });
}

/** Terrain : grille non uniforme (raffinée au centre) échantillonnant terrainHeight. */
function buildTerrain(ap: AirportDef): THREE.Mesh {
  const N = 300;
  const R = ap.radius;
  const coord = (i: number) => {
    const u = (i / N) * 2 - 1;
    return Math.sign(u) * R * Math.pow(Math.abs(u), 1.9);
  };
  const pos = new Float32Array((N + 1) * (N + 1) * 3);
  const col = new Float32Array((N + 1) * (N + 1) * 3);
  const c = new THREE.Color();
  const grass = new THREE.Color(ap.groundTint), rock = new THREE.Color(0x7d7a72), snow = new THREE.Color(0xf2f4f8), sand = new THREE.Color(0xd8c9a0);
  for (let j = 0; j <= N; j++) {
    const z = coord(j);
    for (let i = 0; i <= N; i++) {
      const x = coord(i);
      const h = terrainHeight(ap, x, z);
      const o = 3 * (j * (N + 1) + i);
      pos[o] = x; pos[o + 1] = h - 0.25; pos[o + 2] = z;
      const hx = terrainHeight(ap, x + 8, z) - h, hz = terrainHeight(ap, x, z + 8) - h;
      const slope = Math.hypot(hx, hz) / 8;
      const n = fbm2(x / 300, z / 300, 3, 77) * 0.5 + 0.5;
      c.copy(grass).multiplyScalar(0.8 + 0.35 * n);
      if (ap.id === 'lflj') {
        c.lerp(rock, Math.min(1, slope * 1.6));
        if (h > 2350 + n * 300) c.lerp(snow, Math.min(1, (h - 2350 - n * 300) / 120));
      } else {
        c.lerp(rock, Math.min(0.7, Math.max(0, slope - 0.35) * 1.5));
        if (ap.oceanLevel !== null && h < ap.oceanLevel + 3) c.lerp(sand, Math.min(1, (ap.oceanLevel + 3 - h) / 3));
      }
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
    }
  }
  const idx = new Uint32Array(N * N * 6);
  let k = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + N + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const detail = canvasTex(256, 256, (gg) => {
    const img = gg.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const v = 200 + fbm2(x / 16, y / 16, 4, 5) * 55;
      const o = 4 * (y * 256 + x);
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
    }
    gg.putImageData(img, 0, 0);
  });
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  const uv = new Float32Array((N + 1) * (N + 1) * 2);
  for (let i = 0; i < (N + 1) * (N + 1); i++) { uv[2 * i] = pos[3 * i] / 40; uv[2 * i + 1] = pos[3 * i + 2] / 40; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95, metalness: 0 }));
  m.receiveShadow = true;
  m.name = 'terrain';
  return m;
}

function buildRunway(r: RunwayDef): THREE.Mesh {
  const segs = Math.max(4, Math.ceil(r.length / 40));
  const [dx, dz] = dirFromHeading(r.heading);
  const rx = -dz, rz = dx;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const s = (i / segs) * r.length;
    const h = profileHeight(r, s) + 0.04;
    for (const side of [-1, 1]) {
      pos.push(r.thrX + dx * s + rx * side * r.width / 2, h, r.thrZ + dz * s + rz * side * r.width / 2);
      uv.push(side < 0 ? 0 : 1, i / segs);
    }
  }
  for (let i = 0; i < segs; i++) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: runwayTexture(r), roughness: 0.85, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.receiveShadow = true;
  m.name = `runway_${r.id}`;
  return m;
}

/** Feux de piste (bords, seuil, fin) et rampe d'approche — ajoutés au champ de feux instancié. */
function addRunwayLights(lf: LightField, r: RunwayDef, approach: boolean): void {
  const [dx, dz] = dirFromHeading(r.heading);
  const rx = -dz, rz = dx;
  for (let s = 0; s <= r.length; s += 60) {
    for (const side of [-1, 1]) {
      lf.add(r.thrX + dx * s + rx * side * (r.width / 2 + 1.5), profileHeight(r, s) + 0.5, r.thrZ + dz * s + rz * side * (r.width / 2 + 1.5), 0xfff2d0, 2.2);
    }
  }
  // axe (feux encastrés) sur les pistes longues
  if (r.length > 1500) for (let s = 30; s < r.length; s += 30) lf.add(r.thrX + dx * s, profileHeight(r, s) + 0.15, r.thrZ + dz * s, s > r.length - 900 ? 0xff5040 : 0xfff6e0, 1.2);
  for (let k = -r.width / 2; k <= r.width / 2; k += 4) {
    lf.add(r.thrX + rx * k - dx * 2, profileHeight(r, 0) + 0.5, r.thrZ + rz * k - dz * 2, 0x30ff60, 2.4);
    lf.add(r.thrX + dx * (r.length + 2) + rx * k, profileHeight(r, r.length) + 0.5, r.thrZ + dz * (r.length + 2) + rz * k, 0xff2020, 2.4);
  }
  if (approach) {
    for (let s = 60; s <= 900; s += 30) {
      const bar = s % 150 === 0 ? 7 : 1;
      for (let k = -bar; k <= bar; k++) lf.add(r.thrX - dx * s + rx * k * 2.5, profileHeight(r, 0) + 1.2, r.thrZ - dz * s + rz * k * 2.5, 0xfff8e8, 2.6);
    }
  }
}

/** Texture de taxiway : enrobé + axe jaune continu + lignes de bord jaunes doublées. */
function taxiwayTexture(): THREE.CanvasTexture {
  const t = canvasTex(128, 256, (g) => {
    g.fillStyle = '#34363a';
    g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 2500; i++) { const v = 45 + Math.random() * 25; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * 128, Math.random() * 256, 1.5, 1.5); }
    g.fillStyle = '#e8b41c';
    g.fillRect(61, 0, 6, 256);
    g.fillRect(3, 0, 3, 256); g.fillRect(9, 0, 3, 256);
    g.fillRect(116, 0, 3, 256); g.fillRect(122, 0, 3, 256);
  });
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Texture d'aire de trafic : béton à joints + lignes de guidage jaunes vers les postes. */
function apronTexture(a: ApronDef): THREE.CanvasTexture {
  const W = 1024, H = Math.max(128, Math.round((1024 * a.width) / a.length));
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#8d8f90';
    g.fillRect(0, 0, W, H);
    const ppm = W / a.length;
    g.strokeStyle = 'rgba(60,60,60,0.35)';
    g.lineWidth = 1;
    for (let x = 0; x < W; x += 7.5 * ppm) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += 7.5 * ppm) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    for (let i = 0; i < 6000; i++) { const v = 120 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    // voie de circulation d'aire (côté piste) + lignes d'entrée des postes
    g.fillStyle = '#e8b41c';
    const yTaxi = H * 0.18;
    g.fillRect(0, yTaxi - 2, W, 4);
    for (const sp of a.stands) {
      const x = (sp / a.length + 0.5) * W;
      g.fillRect(x - 2, yTaxi, 4, H * 0.62);
      g.fillRect(x - 14, yTaxi + H * 0.62, 28, 5); // barre d'arrêt
      g.fillStyle = '#ffffff';
      g.font = `bold ${Math.round(H * 0.07)}px Arial`;
      g.textAlign = 'center';
      g.fillText(String(a.stands.indexOf(sp) + 1), x, H * 0.92);
      g.fillStyle = '#e8b41c';
    }
    g.fillStyle = '#c03030';
    g.fillRect(0, H - 6, W, 4);
  });
}

/** Ruban plat le long d'un segment (hauteurs linéaires), légèrement au-dessus du terrain. */
function ribbon(ax: number, az: number, ha: number, bx: number, bz: number, hb: number, width: number, uvLen: number): THREE.BufferGeometry {
  const ex = bx - ax, ez = bz - az;
  const L = Math.hypot(ex, ez) || 1;
  const nx = -ez / L, nz = ex / L;
  const w = width / 2;
  const pos = [ax + nx * w, ha + 0.06, az + nz * w, ax - nx * w, ha + 0.06, az - nz * w, bx + nx * w, hb + 0.06, bz + nz * w, bx - nx * w, hb + 0.06, bz - nz * w];
  const uv = [0, 0, 1, 0, 0, L / uvLen, 1, L / uvLen];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** Taxiways (texturés, fusionnés en un seul maillage) + feux de bord bleus + aires de trafic. */
function buildPavement(ap: AirportDef, group: THREE.Group, lf: LightField): void {
  const geos: THREE.BufferGeometry[] = [];
  for (const t of ap.taxiways) {
    for (let i = 0; i < t.pts.length - 1; i++) {
      const [ax, az] = t.pts[i], [bx, bz] = t.pts[i + 1];
      geos.push(ribbon(ax, az, t.hs[i], bx, bz, t.hs[i + 1], t.width, t.width * 2));
      // feux de bord bleus tous les 60 m
      const L = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let d = 0; d <= L; d += 60) {
        const u = d / L, h = t.hs[i] + (t.hs[i + 1] - t.hs[i]) * u;
        for (const side of [-1, 1]) lf.add(ax + (bx - ax) * u + nx * side * (t.width / 2 + 1), h + 0.4, az + (bz - az) * u + nz * side * (t.width / 2 + 1), 0x3060ff, 1.6);
      }
    }
  }
  if (geos.length) {
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: taxiwayTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.receiveShadow = true;
    m.name = 'taxiways';
    group.add(m);
    geos.forEach((g) => g.dispose());
  }
  for (const a of ap.aprons) {
    const g = new THREE.PlaneGeometry(a.length, a.width);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: apronTexture(a), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.position.set(a.cx, a.h + 0.05, a.cz);
    // l'axe X du plan suit la longueur de l'aire (cap) ; le côté piste est en haut de la texture
    m.rotation.y = Math.PI / 2 - (a.heading * Math.PI) / 180;
    m.receiveShadow = true;
    m.name = `apron_${a.id}`;
    group.add(m);
    // projecteurs d'aire
    const [dx, dz] = dirFromHeading(a.heading);
    for (let k = -2; k <= 2; k++) lf.add(a.cx + dx * k * a.length * 0.22 + dz * a.width * 0.55, a.h + 18, a.cz + dz * k * a.length * 0.22 - dx * a.width * 0.55, 0xffe2b0, 6);
  }
}

/** Fusionne les maillages statiques par matériau (réduction des draw calls). */
class StaticBatch {
  private byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(obj: THREE.Object3D): void {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      g.applyMatrix4(m.matrixWorld);
      const mat = m.material as THREE.Material;
      const list = this.byMat.get(mat) ?? [];
      list.push(g);
      this.byMat.set(mat, list);
    });
  }
  build(group: THREE.Group): void {
    for (const [mat, list] of this.byMat) {
      const merged = mergeGeometries(list);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      list.forEach((g) => g.dispose());
    }
  }
}

const MAT_CACHE = new Map<string, THREE.MeshStandardMaterial>();
function sharedMat(color: number, rough: number, metal: number): THREE.MeshStandardMaterial {
  const key = `${color}:${rough}:${metal}`;
  let m = MAT_CACHE.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); MAT_CACHE.set(key, m); }
  return m;
}

function box(w: number, h: number, d: number, color: number, rough = 0.8, metal = 0.1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), sharedMat(color, rough, metal));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Hangar à toit cintré. */
function hangar(w: number, l: number, h: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const walls = box(w, h, l, color, 0.7, 0.3);
  walls.position.y = h / 2;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, l, 24, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x9aa2aa, roughness: 0.5, metalness: 0.6 }));
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.scale.set(1, 1, 0.35);
  roof.position.y = h;
  roof.castShadow = true;
  const door = box(0.3, h * 0.85, l * 0.8, 0x34393f, 0.6, 0.5);
  door.position.set(w / 2 + 0.1, h * 0.42, 0);
  g.add(walls, roof, door);
  return g;
}

/** Tour de contrôle avec radar rotatif. */
function tower(height: number): { g: THREE.Group; radar: THREE.Object3D } {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3, height, 16), new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.8 }));
  shaft.position.y = height / 2;
  shaft.castShadow = true;
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 4.2, 4, 12), new THREE.MeshPhysicalMaterial({ color: 0x2a3f55, roughness: 0.05, metalness: 0.5, clearcoat: 1 }));
  cab.position.y = height + 2;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
  roof.position.y = height + 4.3;
  const radar = new THREE.Group();
  radar.position.y = height + 5.5;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 2, 8), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8 }));
  mast.position.y = -0.5;
  const dish = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, 7), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4, metalness: 0.3 }));
  dish.position.y = 0.8;
  dish.rotation.x = 0.25;
  radar.add(mast, dish);
  g.add(shaft, cab, roof, radar);
  return { g, radar };
}

function waterNormals(): THREE.Texture {
  const t = canvasTex(512, 512, (g) => {
    const img = g.createImageData(512, 512);
    const H = (x: number, y: number) => fbm2(x / 24, y / 24, 4, 3) + 0.5 * fbm2(x / 7, y / 7, 2, 9);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1);
      const o = 4 * (y * 512 + x);
      img.data[o] = 128 + dx * 160; img.data[o + 1] = 128 + dy * 160; img.data[o + 2] = 255; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildAirportScene(ap: AirportDef): AirportScene {
  const group = new THREE.Group();
  group.name = `airport_${ap.id}`;
  const lf = new LightField();
  const papiLf = new LightField();
  const batch = new StaticBatch();
  let water: Water | null = null;
  if (ap.id !== 'cvn') group.add(buildTerrain(ap));
  if (ap.oceanLevel !== null) {
    water = new Water(new THREE.PlaneGeometry(ap.radius * 4, ap.radius * 4), {
      textureWidth: 512, textureHeight: 512, waterNormals: waterNormals(), sunDirection: new THREE.Vector3(0.3, 1, 0.2).normalize(),
      sunColor: 0xffffff, waterColor: ap.id === 'tffj' ? 0x0c6f80 : 0x0b3550, distortionScale: ap.id === 'cvn' ? 3.2 : 1.6, fog: true,
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = ap.oceanLevel - 0.05;
    water.name = 'ocean';
    group.add(water);
  }
  const papis: AirportScene['papis'] = [];
  ap.runways.forEach((r, ri) => {
    group.add(buildRunway(r));
    addRunwayLights(lf, r, r.ils);
    if (r.papi) {
      const ref = approachRef(ap, 0, ri);
      const [dx, dz] = dirFromHeading(r.heading);
      const rx = -dz, rz = dx;
      const lights: number[] = [];
      const aim = Math.hypot(ref.x - r.thrX, ref.z - r.thrZ);
      for (let k = 0; k < 4; k++) {
        const off = -(r.width / 2 + 15 + k * 9);
        const x = r.thrX + dx * aim + rx * off, y = profileHeight(r, aim) + 1, z = r.thrZ + dz * aim + rz * off;
        lights.push(papiLf.add(x, y, z, 0xffffff, 5));
        const housing = box(1.5, 1, 1.5, 0x333333);
        housing.position.set(x, y - 0.6, z);
        batch.add(housing);
      }
      papis.push({ ref, lights });
    }
  });
  buildPavement(ap, group, lf);
  let radar: THREE.Object3D | null = null;
  const r0 = ap.runways[0];
  if (r0) {
    const [dx, dz] = dirFromHeading(r0.heading);
    const rx = -dz, rz = dx;
    const place = (o: THREE.Object3D, along: number, side: number, rotY = 0, dynamic = false) => {
      const x = r0.thrX + dx * along + rx * side, z = r0.thrZ + dz * along + rz * side;
      o.position.set(x, terrainHeight(ap, x, z) - 0.2, z);
      o.rotation.y = -((r0.heading * Math.PI) / 180) + rotY;
      if (dynamic) group.add(o); else batch.add(o);
    };
    if (ap.id === 'lfbo') {
      // Halls d'assemblage (type « Jean-Luc Lagardère ») au-delà de la 14L, hangars de maintenance
      place(hangar(250, 480, 46, 0xe6e9ec), 1800, -1420, Math.PI / 2);
      place(hangar(120, 220, 32, 0xdfe3e6), 1150, -1380, Math.PI / 2);
      place(hangar(90, 160, 26, 0xd5d9dd), 2450, -1360, Math.PI / 2);
      place(box(320, 22, 80, 0xc9ced4, 0.4, 0.5), 1150, 520);
      for (let k = -3; k <= 3; k++) place(box(14, 5, 40, 0xb5bcc4, 0.4, 0.6), 1150 + k * 80, 440); // passerelles
      const t = tower(52);
      place(t.g, 1650, 470, 0, true);
      radar = t.radar;
    } else if (ap.id === 'lflj') {
      for (let k = 0; k < 9; k++) {
        const ch = box(14, 9, 10, 0x8a5a3a, 0.9, 0);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(11, 6, 4), sharedMat(0x4a4440, 0.9, 0));
        roof.position.y = 7.5;
        roof.rotation.y = Math.PI / 4;
        ch.add(roof);
        place(ch, 560 + (k % 3) * 25, 60 + Math.floor(k / 3) * 22);
      }
      const t = tower(10);
      place(t.g, 650, -110, 0, true);
      radar = t.radar;
    } else if (ap.id === 'tffj') {
      place(box(60, 8, 22, 0xf2efe6, 0.6, 0), 310, 92);
      const t = tower(14);
      place(t.g, 400, 90, 0, true);
      radar = t.radar;
      for (let k = 0; k < 40; k++) {
        const x = -900 + Math.sin(k * 7.1) * 1200, z = -500 + Math.cos(k * 3.3) * 700;
        const hgt = terrainHeight(ap, x, z);
        if (hgt < 3) continue;
        const hb = box(10, 6, 8, [0xf6f1e7, 0xe3d2b8, 0xf0e2c8][k % 3], 0.8, 0);
        hb.position.set(x, hgt + 2.5, z);
        batch.add(hb);
      }
    }
    // végétation instanciée (hors axes, pistes, taxiways)
    const n = ap.id === 'lflj' ? 900 : 1400;
    const treeG = ap.id === 'tffj' ? new THREE.ConeGeometry(2.5, 9, 6) : new THREE.ConeGeometry(3.5, 14, 6);
    const trees = new THREE.InstancedMesh(treeG, new THREE.MeshStandardMaterial({ color: ap.id === 'lflj' ? 0x1f3a22 : 0x2f5a2a, roughness: 0.95 }), n);
    const m4 = new THREE.Matrix4();
    const q0 = new THREE.Quaternion(), p0 = new THREE.Vector3(), s0 = new THREE.Vector3();
    let cnt = 0;
    for (let k = 0; k < n * 3 && cnt < n; k++) {
      const a = k * 2.399, rr = 600 + Math.sqrt(k) * 140;
      const x = Math.cos(a) * rr + r0.thrX, z = Math.sin(a) * rr + r0.thrZ;
      const hgt = terrainHeight(ap, x, z);
      if ((ap.oceanLevel !== null && hgt < 4) || hgt > 2300) continue;
      const along = (x - r0.thrX) * dx + (z - r0.thrZ) * dz, lat = (x - r0.thrX) * -dz + (z - r0.thrZ) * dx;
      if (lat > -1700 && lat < 650 && along > -3000 && along < r0.length + 1500) continue;
      const sc = 0.7 + ((k * 13) % 7) / 10;
      m4.compose(p0.set(x, hgt + 5 * sc, z), q0, s0.set(sc, sc, sc));
      trees.setMatrixAt(cnt++, m4);
    }
    trees.count = cnt;
    trees.castShadow = true;
    group.add(trees);
  }
  batch.build(group);
  if (lf.count) group.add(lf.build('airfield_lights'));
  if (papiLf.count) group.add(papiLf.build('papi'));
  return {
    group, water, papis, radar, lights: lf,
    update(eye: THREE.Vector3, t: number, dt: number) {
      if (radar) radar.rotation.y += dt * 2.4;
      if (water) (water.material as THREE.ShaderMaterial).uniforms.time.value = t;
      for (const p of papis) {
        const [ddx, ddz] = dirFromHeading(p.ref.heading);
        const dist = -((eye.x - p.ref.x) * ddx + (eye.z - p.ref.z) * ddz);
        const ang = (Math.atan2(eye.y - p.ref.y, Math.max(1, dist)) * 180) / Math.PI;
        // feu k blanc si l'œil est au-dessus de son calage (2,5/2,83/3,17/3,5° pour 3°)
        const offs = [0.5, 0.17, -0.17, -0.5];
        p.lights.forEach((li, k) => papiLf.setColor(li, ang > p.ref.glideDeg + offs[k] ? 0xffffff : 0xff2020));
      }
    },
  };
}
