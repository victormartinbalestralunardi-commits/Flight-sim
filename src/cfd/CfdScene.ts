/**
 * Scène 3D de la soufflerie : maillage portant coloré par Cp (extrados/intrados), fuselage,
 * lignes de courant animées, tourbillons marginaux, onde de choc transsonique, cône de Mach,
 * repères CG / foyer.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CFD_STYLE, cpToT, turbo } from './palette';
import type { StreamlineResult, TunnelGeometry, TunnelResult } from './tunnel';
import { installGlErrorHandler } from '../raytracing/glDebug';

/** Demi-épaisseur NACA 4 chiffres (fraction de corde) à u. */
function naca(u: number, t: number): number {
  const x = Math.min(1, Math.max(0, u));
  return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
}

export type CfdView = 'upper' | 'lower';

export class CfdScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  readonly controls: OrbitControls;
  private model = new THREE.Group();
  private skinUpper: THREE.Mesh | null = null;
  private skinLower: THREE.Mesh | null = null;
  private fuselage: THREE.Mesh | null = null;
  private lines: LineSegments2 | null = null;
  private lineMat: LineMaterial;
  private shock: THREE.Mesh | null = null;
  private cone: THREE.LineSegments | null = null;
  private cgMarker: THREE.Mesh;
  private npMarker: THREE.Mesh;
  private geomKey = '';
  private geom: TunnelGeometry | null = null;
  private alpha = 0;
  private beta = 0;
  showStreamlines = true;
  showShock = true;
  private nodeIndexUpper: Int32Array = new Int32Array(0);
  private nodeCount = 0;
  private clock = new THREE.Clock();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    installGlErrorHandler(this.renderer);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    // pas de tone mapping : la colormap Cp doit rester fidèle
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.gradientTexture();
    this.scene.fog = new THREE.Fog(CFD_STYLE.backgroundTop, 200, 2000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404858, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(30, 60, 40);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc2ff, 0.45);
    rim.position.set(-40, 20, -50);
    this.scene.add(rim);
    this.scene.add(this.model);
    this.lineMat = new LineMaterial({
      vertexColors: true, linewidth: CFD_STYLE.streamlineWidth, transparent: true, opacity: CFD_STYLE.streamlineOpacity,
      dashed: true, dashSize: 1.2, gapSize: 0.5, dashScale: 1, worldUnits: false, depthWrite: false,
    });
    const mk = (c: number) => new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.95 }));
    this.cgMarker = mk(0xffd23f);
    this.npMarker = mk(0x34e0ff);
    this.cgMarker.renderOrder = 10;
    this.npMarker.renderOrder = 10;
    this.model.add(this.cgMarker, this.npMarker);
  }

  private gradientTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#' + CFD_STYLE.backgroundTop.toString(16).padStart(6, '0'));
    grad.addColorStop(1, '#' + CFD_STYLE.backgroundBottom.toString(16).padStart(6, '0'));
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.lineMat.resolution.set(w, h);
  }

  /** Construit (une fois par géométrie) les peaux extrados/intrados et le fuselage. */
  private buildGeometry(g: TunnelGeometry): void {
    for (const m of [this.skinUpper, this.skinLower, this.fuselage]) {
      if (m) { this.model.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    }
    const n = g.n;
    // nœuds partagés pour lisser les couleurs (moyenne des panneaux adjacents)
    const keyMap = new Map<string, number>();
    this.nodeIndexUpper = new Int32Array(4 * n);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) {
        const o = 12 * i + 3 * k;
        const key = `${g.surf[i]}:${Math.round(g.corners[o] * 200)}:${Math.round(g.corners[o + 1] * 200)}:${Math.round(g.corners[o + 2] * 200)}`;
        let id = keyMap.get(key);
        if (id === undefined) { id = keyMap.size; keyMap.set(key, id); }
        this.nodeIndexUpper[4 * i + k] = id;
      }
    }
    this.nodeCount = keyMap.size;
    const mkSkin = (sign: number) => {
      const pos = new Float32Array(n * 4 * 3);
      const col = new Float32Array(n * 4 * 3);
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const nx = g.normals[3 * i], ny = g.normals[3 * i + 1], nz = g.normals[3 * i + 2];
        const u0 = g.chordInfo[4 * i], u1 = g.chordInfo[4 * i + 1], cIn = g.chordInfo[4 * i + 2], cOut = g.chordInfo[4 * i + 3];
        const t = g.thickness[i];
        const us = [u0, u0, u1, u1];
        const cs = [cIn, cOut, cOut, cIn];
        for (let k = 0; k < 4; k++) {
          const o = 12 * i + 3 * k;
          const h = naca(us[k], t) * cs[k] * sign;
          pos[(4 * i + k) * 3] = g.corners[o] + nx * h;
          pos[(4 * i + k) * 3 + 1] = g.corners[o + 1] + ny * h;
          pos[(4 * i + k) * 3 + 2] = g.corners[o + 2] + nz * h;
        }
        const b = 4 * i;
        if (sign > 0) idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
        else idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.0, side: THREE.DoubleSide });
      return new THREE.Mesh(geo, mat);
    };
    this.skinUpper = mkSkin(1);
    this.skinLower = mkSkin(-1);
    this.model.add(this.skinUpper, this.skinLower);
    this.fuselage = this.buildFuselage(g);
    this.model.add(this.fuselage);
    const s = Math.max(g.span, g.length) * 0.012;
    this.cgMarker.scale.setScalar(s);
    this.npMarker.scale.setScalar(s);
    // cadrage
    const size = Math.max(g.span, g.length);
    this.controls.target.set(-g.length * 0.5, 0, 0);
    this.camera.position.set(-g.length * 0.5 + size * 0.75, size * 0.55, size * 0.95);
    this.camera.near = size * 0.005;
    this.camera.far = size * 40;
    this.camera.updateProjectionMatrix();
    (this.scene.fog as THREE.Fog).near = size * 3;
    (this.scene.fog as THREE.Fog).far = size * 12;
    const grid = this.scene.getObjectByName('grid');
    if (grid) this.scene.remove(grid);
    const gh = new THREE.GridHelper(size * 6, 60, CFD_STYLE.grid, CFD_STYLE.grid);
    (gh.material as THREE.Material).transparent = true;
    (gh.material as THREE.Material).opacity = CFD_STYLE.gridOpacity;
    gh.position.set(-g.length * 0.5, -g.fuselage.height * 2.2 - size * 0.08, 0);
    gh.name = 'grid';
    this.scene.add(gh);
  }

  private buildFuselage(g: TunnelGeometry): THREE.Mesh {
    const f = g.fuselage;
    const NX = 64, NT = 36;
    const pos = new Float32Array((NX + 1) * (NT + 1) * 3);
    const idx: number[] = [];
    for (let i = 0; i <= NX; i++) {
      const xi = i / NX;
      let r: number;
      if (xi < f.noseFrac) { const q = 1 - xi / f.noseFrac; r = Math.sqrt(Math.max(0, 1 - q * q)); }
      else if (xi > 1 - f.tailFrac) { const q = (xi - (1 - f.tailFrac)) / f.tailFrac; r = 1 - 0.82 * Math.pow(q, 1.4); }
      else r = 1;
      const tailRise = xi > 1 - f.tailFrac ? Math.pow((xi - (1 - f.tailFrac)) / f.tailFrac, 1.5) * f.height * 0.3 : 0;
      for (let j = 0; j <= NT; j++) {
        const th = (j / NT) * Math.PI * 2;
        const o = (i * (NT + 1) + j) * 3;
        pos[o] = -xi * f.length;
        pos[o + 1] = f.axisY + tailRise + Math.sin(th) * r * f.height * 0.5;
        pos[o + 2] = Math.cos(th) * r * f.width * 0.5 * 0.92;
      }
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NT; j++) {
      const a = i * (NT + 1) + j, b = a + NT + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1 }));
  }

  /** Cp du fuselage : théorie newtonienne modifiée (Lees), cohérente avec l'incidence courante. */
  private colorFuselage(): void {
    if (!this.fuselage) return;
    const geo = this.fuselage.geometry;
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const ca = Math.cos(this.alpha), sa = Math.sin(this.alpha), cb = Math.cos(this.beta), sb = Math.sin(this.beta);
    const dx = -ca * cb, dy = sa * cb, dz = -sb;
    const tmp = [0, 0, 0];
    for (let i = 0; i < nrm.count; i++) {
      const c = -(nrm.getX(i) * dx + nrm.getY(i) * dy + nrm.getZ(i) * dz);
      const cp = c > 0 ? 1.0 * c * c - 0.42 * (1 - c) : -0.42 + 0.25 * -c;
      turbo(cpToT(cp), tmp);
      col.setXYZ(i, tmp[0] ** 2.2, tmp[1] ** 2.2, tmp[2] ** 2.2);
    }
    col.needsUpdate = true;
  }

  setResult(r: TunnelResult, alphaDeg: number, betaDeg: number): void {
    const g = r.geometry;
    const key = `${g.n}:${g.span.toFixed(3)}:${g.length.toFixed(3)}:${g.corners[3]}:${g.corners[g.corners.length - 1]}`;
    if (key !== this.geomKey) {
      this.buildGeometry(g);
      this.geomKey = key;
    }
    this.geom = g;
    this.alpha = (alphaDeg * Math.PI) / 180;
    this.beta = (betaDeg * Math.PI) / 180;
    // l'avion est incliné de α (la soufflerie souffle selon −X)
    this.model.rotation.set(0, -this.beta, this.alpha);
    if (this.lines) this.lines.rotation.set(0, 0, 0);
    // couleurs nodales
    const sumU = new Float32Array(this.nodeCount), sumL = new Float32Array(this.nodeCount), cnt = new Float32Array(this.nodeCount);
    for (let i = 0; i < g.n; i++) for (let k = 0; k < 4; k++) {
      const id = this.nodeIndexUpper[4 * i + k];
      sumU[id] += r.cpUpper[i]; sumL[id] += r.cpLower[i]; cnt[id]++;
    }
    const tmp = [0, 0, 0];
    for (const [mesh, sum] of [[this.skinUpper, sumU], [this.skinLower, sumL]] as const) {
      if (!mesh) continue;
      const col = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < g.n; i++) for (let k = 0; k < 4; k++) {
        const id = this.nodeIndexUpper[4 * i + k];
        turbo(cpToT(sum[id] / cnt[id]), tmp);
        col.setXYZ(4 * i + k, tmp[0] ** 2.2, tmp[1] ** 2.2, tmp[2] ** 2.2); // sRGB → linéaire
      }
      col.needsUpdate = true;
    }
    this.colorFuselage();
    this.cgMarker.position.set(g.xcg, 0, 0);
    this.npMarker.position.set(r.deriv.xnp, 0, 0);
    // onde de choc
    if (this.shock) { this.model.remove(this.shock); this.shock.geometry.dispose(); (this.shock.material as THREE.Material).dispose(); this.shock = null; }
    if (r.shock.length >= 12) {
      const s = r.shock;
      const k = s.length / 6;
      const pos: number[] = [];
      for (let i = 0; i < k - 1; i++) {
        const a = 6 * i, b = 6 * (i + 1);
        if (Math.hypot(s[a] - s[b], s[a + 2] - s[b + 2]) > g.span * 0.15) continue;
        pos.push(s[a], s[a + 1], s[a + 2], s[b], s[b + 1], s[b + 2], s[b + 3], s[b + 4], s[b + 5]);
        pos.push(s[a], s[a + 1], s[a + 2], s[b + 3], s[b + 4], s[b + 5], s[a + 3], s[a + 4], s[a + 5]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.shock = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: CFD_STYLE.shockColor, transparent: true, opacity: CFD_STYLE.shockOpacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      this.shock.visible = this.showShock;
      this.model.add(this.shock);
    }
    // cône de Mach (supersonique) : apex au nez, axe = vent relatif (−X monde)
    if (this.cone) { this.scene.remove(this.cone); this.cone.geometry.dispose(); this.cone = null; }
    if (r.machCone > 0) {
      const L = g.length * 1.6;
      const rad = L * Math.tan(r.machCone);
      const cg = new THREE.ConeGeometry(rad, L, 48, 1, true);
      cg.translate(0, -L / 2, 0);
      cg.rotateZ(-Math.PI / 2);
      this.cone = new THREE.LineSegments(new THREE.WireframeGeometry(cg), new THREE.LineBasicMaterial({ color: CFD_STYLE.machConeColor, transparent: true, opacity: 0.18 }));
      cg.dispose();
      this.scene.add(this.cone);
    }
  }

  setStreamlines(s: StreamlineResult): void {
    if (this.lines) { this.scene.remove(this.lines); this.lines.geometry.dispose(); this.lines = null; }
    const segs: number[] = [], cols: number[] = [];
    const tmp = [0, 0, 0];
    const vc = new THREE.Color(0xff7ad9);
    // les lignes sont calculées dans le repère avion ; on les tourne avec le modèle
    for (let l = 0; l < s.offsets.length - 1; l++) {
      const a = s.offsets[l], b = s.offsets[l + 1];
      const vortex = s.vortexFlags[l] === 1;
      for (let i = a; i < b - 1; i++) {
        segs.push(s.points[3 * i], s.points[3 * i + 1], s.points[3 * i + 2], s.points[3 * i + 3], s.points[3 * i + 4], s.points[3 * i + 5]);
        const t = (s.speed[i] - 0.6) / 0.9;
        turbo(t, tmp);
        if (vortex) { tmp[0] = tmp[0] * 0.3 + vc.r * 0.7; tmp[1] = tmp[1] * 0.3 + vc.g * 0.7; tmp[2] = tmp[2] * 0.3 + vc.b * 0.7; }
        const r = tmp[0] ** 2.2, gg = tmp[1] ** 2.2, bb = tmp[2] ** 2.2;
        cols.push(r, gg, bb, r, gg, bb);
      }
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(segs);
    geo.setColors(cols);
    this.lines = new LineSegments2(geo, this.lineMat);
    this.lines.computeLineDistances();
    const size = this.geom ? Math.max(this.geom.span, this.geom.length) : 10;
    this.lineMat.dashSize = size * 0.05;
    this.lineMat.gapSize = size * 0.025;
    this.lines.rotation.copy(this.model.rotation);
    this.lines.visible = this.showStreamlines;
    this.scene.add(this.lines);
  }

  setVisibility(stream: boolean, shock: boolean): void {
    this.showStreamlines = stream;
    this.showShock = shock;
    if (this.lines) this.lines.visible = stream;
    if (this.shock) this.shock.visible = shock;
  }

  render(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    const size = this.geom ? Math.max(this.geom.span, this.geom.length) : 10;
    this.lineMat.dashOffset -= dt * size * 0.35;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
