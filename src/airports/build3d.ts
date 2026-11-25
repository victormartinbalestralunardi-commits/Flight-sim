/**
 * Construction 3D des aéroports, en échantillonnant EXACTEMENT les fonctions de
 * `airports.ts` (terrain, profils de piste) utilisées par la physique.
 * Terrain à grille non uniforme (fine au centre), pistes texturées (marquages OACI),
 * balisage, rampe d'approche, PAPI dynamiques, bâtiments (hangars, tour à radar rotatif),
 * océan animé, végétation instanciée.
 */
import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import {
  approachRef, dirFromHeading, profileHeight, terrainHeight, type AirportDef, type ApproachRef, type RunwayDef,
} from './airports';
import { fbm2 } from '../physics/math';

export interface AirportScene {
  group: THREE.Group;
  water: Water | null;
  /** feux PAPI : 4 sprites par piste, mis à jour selon la position de l'œil */
  papis: { ref: ApproachRef; lights: THREE.Sprite[] }[];
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

function glowTexture(): THREE.Texture {
  return canvasTex(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }, false);
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

function sprite(glow: THREE.Texture, color: number, size: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size);
  return s;
}

function addRunwayLights(group: THREE.Group, r: RunwayDef, glow: THREE.Texture, approach: boolean): void {
  const [dx, dz] = dirFromHeading(r.heading);
  const rx = -dz, rz = dx;
  // feux de bord (blancs) et de seuil (verts) / fin de piste (rouges)
  for (let s = 0; s <= r.length; s += 60) {
    for (const side of [-1, 1]) {
      const l = sprite(glow, 0xfff2d0, 2.2);
      l.position.set(r.thrX + dx * s + rx * side * (r.width / 2 + 1.5), profileHeight(r, s) + 0.5, r.thrZ + dz * s + rz * side * (r.width / 2 + 1.5));
      group.add(l);
    }
  }
  for (let k = -r.width / 2; k <= r.width / 2; k += 4) {
    const gl = sprite(glow, 0x30ff60, 2.4);
    gl.position.set(r.thrX + rx * k - dx * 2, profileHeight(r, 0) + 0.5, r.thrZ + rz * k - dz * 2);
    const rl = sprite(glow, 0xff2020, 2.4);
    rl.position.set(r.thrX + dx * (r.length + 2) + rx * k, profileHeight(r, r.length) + 0.5, r.thrZ + dz * (r.length + 2) + rz * k);
    group.add(gl, rl);
  }
  // rampe d'approche (ALS) sur 900 m
  if (approach) {
    for (let s = 60; s <= 900; s += 30) {
      const bar = s % 150 === 0 ? 7 : 1;
      for (let k = -bar; k <= bar; k++) {
        const l = sprite(glow, 0xfff8e8, 2.6);
        const h = terrainHeightSafe(r, s);
        l.position.set(r.thrX - dx * s + rx * k * 2.5, h + 1.2, r.thrZ - dz * s + rz * k * 2.5);
        group.add(l);
      }
    }
  }
}

function terrainHeightSafe(r: RunwayDef, s: number): number {
  return profileHeight(r, 0) - Math.max(0, s) * 0.0;
}

function box(w: number, h: number, d: number, color: number, rough = 0.8, metal = 0.1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
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
  const glow = glowTexture();
  let water: Water | null = null;
  if (ap.id !== 'cvn') group.add(buildTerrain(ap));
  if (ap.oceanLevel !== null) {
    water = new Water(new THREE.PlaneGeometry(ap.radius * 4, ap.radius * 4), {
      textureWidth: 1024, textureHeight: 1024, waterNormals: waterNormals(), sunDirection: new THREE.Vector3(0.3, 1, 0.2).normalize(),
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
    addRunwayLights(group, r, glow, r.ils);
    if (r.papi) {
      const ref = approachRef(ap, 0, ri);
      const [dx, dz] = dirFromHeading(r.heading);
      const rx = -dz, rz = dx;
      const lights: THREE.Sprite[] = [];
      const aim = Math.hypot(ref.x - r.thrX, ref.z - r.thrZ);
      for (let k = 0; k < 4; k++) {
        const off = -(r.width / 2 + 15 + k * 9);
        const l = sprite(glow, 0xffffff, 5);
        l.position.set(r.thrX + dx * aim + rx * off, profileHeight(r, aim) + 1, r.thrZ + dz * aim + rz * off);
        const housing = box(1.5, 1, 1.5, 0x333333);
        housing.position.copy(l.position).add(new THREE.Vector3(0, -0.6, 0));
        group.add(l, housing);
        lights.push(l);
      }
      papis.push({ ref, lights });
    }
  });
  let radar: THREE.Object3D | null = null;
  const r0 = ap.runways[0];
  if (r0) {
    const [dx, dz] = dirFromHeading(r0.heading);
    const rx = -dz, rz = dx;
    const place = (o: THREE.Object3D, along: number, side: number, rotY = 0) => {
      const x = r0.thrX + dx * along + rx * side, z = r0.thrZ + dz * along + rz * side;
      o.position.set(x, terrainHeight(ap, x, z) - 0.2, z);
      o.rotation.y = -((r0.heading * Math.PI) / 180) + rotY;
      group.add(o);
    };
    if (ap.id === 'lfbo') {
      // Halls d'assemblage (type « Jean-Luc Lagardère ») et hangars de maintenance
      place(hangar(250, 480, 46, 0xe6e9ec), 1800, -820, Math.PI / 2);
      place(hangar(120, 220, 32, 0xdfe3e6), 900, -700, Math.PI / 2);
      place(hangar(90, 160, 26, 0xd5d9dd), 2400, -650, Math.PI / 2);
      const term = box(320, 22, 80, 0xc9ced4, 0.4, 0.5);
      place(term, 1200, 520);
      const t = tower(52);
      place(t.g, 1500, 420);
      radar = t.radar;
    } else if (ap.id === 'lflj') {
      for (let k = 0; k < 9; k++) {
        const ch = box(14, 9, 10, 0x8a5a3a, 0.9, 0);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(11, 6, 4), new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.9 }));
        roof.position.y = 7.5;
        roof.rotation.y = Math.PI / 4;
        ch.add(roof);
        place(ch, 560 + (k % 3) * 25, 60 + Math.floor(k / 3) * 22);
      }
      const t = tower(10);
      place(t.g, 540, -40);
      radar = t.radar;
    } else if (ap.id === 'tffj') {
      const term = box(60, 8, 22, 0xf2efe6, 0.6, 0);
      place(term, 320, 60);
      const t = tower(14);
      place(t.g, 380, 75);
      radar = t.radar;
      // maisons à flanc de colline
      for (let k = 0; k < 40; k++) {
        const x = -900 + Math.sin(k * 7.1) * 1200, z = -500 + Math.cos(k * 3.3) * 700;
        const hgt = terrainHeight(ap, x, z);
        if (hgt < 3) continue;
        const hb = box(10, 6, 8, [0xf6f1e7, 0xe3d2b8, 0xf0e2c8][k % 3], 0.8, 0);
        hb.position.set(x, hgt + 2.5, z);
        group.add(hb);
      }
    }
    // végétation instanciée
    const n = ap.id === 'lflj' ? 900 : 1400;
    const treeG = ap.id === 'tffj' ? new THREE.ConeGeometry(2.5, 9, 6) : new THREE.ConeGeometry(3.5, 14, 6);
    const trees = new THREE.InstancedMesh(treeG, new THREE.MeshStandardMaterial({ color: ap.id === 'lflj' ? 0x1f3a22 : 0x2f5a2a, roughness: 0.95 }), n);
    const m4 = new THREE.Matrix4();
    let cnt = 0;
    for (let k = 0; k < n * 3 && cnt < n; k++) {
      const a = k * 2.399, rr = 600 + Math.sqrt(k) * 140;
      const x = Math.cos(a) * rr + r0.thrX, z = Math.sin(a) * rr + r0.thrZ;
      const hgt = terrainHeight(ap, x, z);
      if ((ap.oceanLevel !== null && hgt < 4) || hgt > 2300) continue;
      // pas d'arbres dans l'axe d'approche
      const [ddx, ddz] = dirFromHeading(r0.heading);
      const along = (x - r0.thrX) * ddx + (z - r0.thrZ) * ddz, lat = (x - r0.thrX) * -ddz + (z - r0.thrZ) * ddx;
      if (Math.abs(lat) < 250 && along > -3000 && along < r0.length + 1500) continue;
      const sc = 0.7 + ((k * 13) % 7) / 10;
      m4.compose(new THREE.Vector3(x, hgt + 5 * sc, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc));
      trees.setMatrixAt(cnt++, m4);
    }
    trees.count = cnt;
    trees.castShadow = true;
    group.add(trees);
  }
  return {
    group, water, papis, radar,
    update(eye: THREE.Vector3, t: number, dt: number) {
      if (radar) radar.rotation.y += dt * 2.4;
      if (water) (water.material as THREE.ShaderMaterial).uniforms.time.value = t;
      for (const p of papis) {
        const [dx, dz] = dirFromHeading(p.ref.heading);
        const dist = -((eye.x - p.ref.x) * dx + (eye.z - p.ref.z) * dz);
        const ang = (Math.atan2(eye.y - p.ref.y, Math.max(1, dist)) * 180) / Math.PI;
        // feu k blanc si l'œil est au-dessus de son calage (2,5/2,83/3,17/3,5° pour 3°)
        const offs = [0.5, 0.17, -0.17, -0.5];
        p.lights.forEach((l, k) => (l.material as THREE.SpriteMaterial).color.setHex(ang > p.ref.glideDeg + offs[k] ? 0xffffff : 0xff2020));
      }
    },
  };
}
