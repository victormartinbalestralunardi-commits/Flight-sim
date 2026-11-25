/**
 * Scène 3D de la soufflerie (style calé sur l'image de référence) :
 * veine d'essai filaire, râteau de graines, tubes de courant colorés par |V| (m/s, échelle jet)
 * ou par régime (laminaire / turbulent / tourbillon / décollé), particules animées,
 * maquette colorée par la carte choisie (vitesse paroi, Cp, Cf, τw, régime, cl local, σ/σadm),
 * filaments de tourbillons de bord d'attaque, onde de choc, cône de Mach, CG / foyer, trièdre.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CFD_STYLE, jet, REGIME_COLORS } from './palette';
import type { StreamlineResult, TunnelGeometry, TunnelResult } from './tunnel';
import { installGlErrorHandler } from '../raytracing/glDebug';

/** Demi-épaisseur NACA 4 chiffres (fraction de corde) à u. */
function naca(u: number, t: number): number {
  const x = Math.min(1, Math.max(0, u));
  return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
}

export type SurfaceMap = 'velocity' | 'cp' | 'cf' | 'tau' | 'regime' | 'cl' | 'stress';
export type LineColoring = 'speed' | 'regime';

export interface LegendInfo {
  title: string;
  min: number;
  max: number;
  unit: string;
  categorical?: { label: string; color: string }[];
}

const lin = (v: number) => v ** 2.2;

export class CfdScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  readonly controls: OrbitControls;
  private root = new THREE.Group(); // tourné de α/β (repère avion)
  private skinUpper: THREE.Mesh | null = null;
  private skinLower: THREE.Mesh | null = null;
  private fuselage: THREE.Mesh | null = null;
  private tubes: THREE.Mesh | null = null;
  private particles: THREE.Points | null = null;
  private seeds: THREE.InstancedMesh | null = null;
  private leLines: THREE.LineSegments | null = null;
  private box: THREE.LineSegments | null = null;
  private axes = new THREE.Group();
  private shock: THREE.Mesh | null = null;
  private cone: THREE.LineSegments | null = null;
  private cgMarker: THREE.Mesh;
  private npMarker: THREE.Mesh;
  private geomKey = '';
  private geom: TunnelGeometry | null = null;
  private result: TunnelResult | null = null;
  private lines: StreamlineResult | null = null;
  private alpha = 0;
  private beta = 0;
  surfaceMap: SurfaceMap = 'velocity';
  lineColoring: LineColoring = 'speed';
  showStreamlines = true;
  showShock = true;
  private nodeIndex: Int32Array = new Int32Array(0);
  private nodeCount = 0;
  private clock = new THREE.Clock();
  private partLine = new Int32Array(0);
  private partPos = new Float32Array(0);
  private partArr = new Float32Array(0);
  /** bornes de la légende des lignes (m/s) */
  lineMax = 1;
  lineMin = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    installGlErrorHandler(this.renderer);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.toneMapping = THREE.NoToneMapping; // fidélité colorimétrique des cartes
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.gradientTexture();
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a8, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(30, 60, 40);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    rim.position.set(-40, 20, -50);
    this.scene.add(rim);
    this.scene.add(this.root, this.axes);
    const mk = (c: number) => new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.95 }));
    this.cgMarker = mk(0xffb000);
    this.npMarker = mk(0x00b4d8);
    this.cgMarker.renderOrder = 10;
    this.npMarker.renderOrder = 10;
    this.root.add(this.cgMarker, this.npMarker);
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
  }

  /** Pixels par mètre au point visé (barre d'échelle). */
  pixelsPerMeter(): number {
    const d = this.camera.position.distanceTo(this.controls.target);
    const h = this.renderer.domElement.clientHeight || 1;
    return h / (2 * d * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  private disposeObj(o: THREE.Object3D | null, parent: THREE.Object3D = this.root): void {
    if (!o) return;
    parent.remove(o);
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
  }

  private buildGeometry(g: TunnelGeometry): void {
    this.disposeObj(this.skinUpper); this.disposeObj(this.skinLower); this.disposeObj(this.fuselage);
    const n = g.n;
    const keyMap = new Map<string, number>();
    this.nodeIndex = new Int32Array(4 * n);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) {
        const o = 12 * i + 3 * k;
        const key = `${g.surf[i]}:${Math.round(g.corners[o] * 200)}:${Math.round(g.corners[o + 1] * 200)}:${Math.round(g.corners[o + 2] * 200)}`;
        let id = keyMap.get(key);
        if (id === undefined) { id = keyMap.size; keyMap.set(key, id); }
        this.nodeIndex[4 * i + k] = id;
      }
    }
    this.nodeCount = keyMap.size;
    const mkSkin = (sign: number) => {
      const pos = new Float32Array(n * 12);
      const col = new Float32Array(n * 12);
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
      return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.0, side: THREE.DoubleSide }));
    };
    this.skinUpper = mkSkin(1);
    this.skinLower = mkSkin(-1);
    this.fuselage = this.buildFuselage(g);
    this.root.add(this.skinUpper, this.skinLower, this.fuselage);
    const s = Math.max(g.span, g.length) * 0.012;
    this.cgMarker.scale.setScalar(s);
    this.npMarker.scale.setScalar(s);
    const size = Math.max(g.span, g.length);
    this.controls.target.set(-g.length * 0.55, 0, 0);
    this.camera.position.set(-g.length * 0.55 + size * 1.05, size * 0.62, size * 1.15);
    this.camera.near = size * 0.005;
    this.camera.far = size * 40;
    this.camera.updateProjectionMatrix();
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
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.05 }));
  }

  surfaceLegend(): LegendInfo {
    const r = this.result;
    switch (this.surfaceMap) {
      case 'velocity': return { title: 'Vitesse |V| (paroi : adhérence)', min: 0, max: this.lineMax, unit: 'm/s' };
      case 'cp': return { title: 'Coefficient de pression Cp', min: CFD_STYLE.cpMin, max: CFD_STYLE.cpMax, unit: '' };
      case 'cf': return { title: 'Coefficient de frottement Cf', min: 0, max: 0.006, unit: '' };
      case 'tau': return { title: 'Contrainte pariétale τw', min: 0, max: r ? this.tauMax(r) : 100, unit: 'Pa' };
      case 'cl': return { title: 'Coefficient de portance local cl', min: 0, max: r ? this.clMax(r) : 1.5, unit: '' };
      case 'stress': return { title: `Contrainte de flexion σ/σadm — ${r?.stress.material.name ?? ''}`, min: 0, max: 1, unit: '' };
      case 'regime': return {
        title: 'Régime de couche limite', min: 0, max: 1, unit: '',
        categorical: [
          { label: 'Laminaire', color: 'rgb(31,140,255)' }, { label: 'Turbulent', color: 'rgb(255,140,20)' }, { label: 'Décollé', color: 'rgb(230,20,26)' },
        ],
      };
    }
  }

  lineLegend(): LegendInfo {
    if (this.lineColoring === 'regime') {
      return {
        title: 'Régime de l\'écoulement', min: 0, max: 1, unit: '',
        categorical: [
          { label: 'Laminaire', color: 'rgb(31,140,255)' }, { label: 'Turbulent (sillage / CL)', color: 'rgb(255,140,20)' },
          { label: 'Tourbillon', color: 'rgb(217,38,217)' }, { label: 'Décollé', color: 'rgb(230,20,26)' },
        ],
      };
    }
    return { title: 'Vitesse |V|', min: this.lineMin, max: this.lineMax, unit: 'm/s' };
  }

  private tauMax(r: TunnelResult): number {
    let m = 1;
    for (let i = 0; i < r.bl.tauUpper.length; i++) m = Math.max(m, r.bl.tauUpper[i], r.bl.tauLower[i]);
    return m;
  }

  private clMax(r: TunnelResult): number {
    let m = 0.2;
    for (const v of r.bl.clStrip) m = Math.max(m, v);
    return m;
  }

  /** Valeur normalisée (0..1) ou code catégoriel (< 0) d'un panneau. */
  private panelValue(r: TunnelResult, i: number, upper: boolean, tauMax: number, clMax: number): number {
    switch (this.surfaceMap) {
      case 'velocity': return 0.04; // adhérence : V = 0 à la paroi
      case 'cp': return ((upper ? r.cpUpper[i] : r.cpLower[i]) - CFD_STYLE.cpMin) / (CFD_STYLE.cpMax - CFD_STYLE.cpMin);
      case 'cf': return (upper ? r.bl.cfUpper[i] : r.bl.cfLower[i]) / 0.006;
      case 'tau': return (upper ? r.bl.tauUpper[i] : r.bl.tauLower[i]) / tauMax;
      case 'cl': return r.bl.clStrip[r.geometry.strip[i]] / clMax;
      case 'stress': return r.stress.ratioPanel[i];
      case 'regime': return -1 - (upper ? r.bl.regimeUpper[i] : r.bl.regimeLower[i]);
    }
  }

  private color(v: number, out: number[]): void {
    if (v < 0) {
      const code = -1 - v;
      const c = code === 0 ? REGIME_COLORS.laminar : code === 1 ? REGIME_COLORS.turbulent : REGIME_COLORS.separated;
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    } else jet(v, out);
  }

  private recolorSurfaces(): void {
    const r = this.result;
    if (!r || !this.skinUpper || !this.skinLower) return;
    const g = r.geometry;
    const tauMax = this.tauMax(r);
    const clMax = this.clMax(r);
    const tmp = [0, 0, 0];
    for (const [mesh, upper] of [[this.skinUpper, true], [this.skinLower, false]] as const) {
      const col = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      if (this.surfaceMap === 'regime') {
        for (let i = 0; i < g.n; i++) {
          this.color(this.panelValue(r, i, upper, tauMax, clMax), tmp);
          for (let k = 0; k < 4; k++) col.setXYZ(4 * i + k, lin(tmp[0]), lin(tmp[1]), lin(tmp[2]));
        }
      } else {
        const sum = new Float32Array(this.nodeCount), cnt = new Float32Array(this.nodeCount);
        for (let i = 0; i < g.n; i++) {
          const v = this.panelValue(r, i, upper, tauMax, clMax);
          for (let k = 0; k < 4; k++) { const id = this.nodeIndex[4 * i + k]; sum[id] += v; cnt[id]++; }
        }
        for (let i = 0; i < g.n; i++) for (let k = 0; k < 4; k++) {
          const id = this.nodeIndex[4 * i + k];
          this.color(sum[id] / cnt[id], tmp);
          col.setXYZ(4 * i + k, lin(tmp[0]), lin(tmp[1]), lin(tmp[2]));
        }
      }
      col.needsUpdate = true;
    }
    this.colorFuselage(r);
  }

  /** Fuselage : Cp newtonien modifié (Lees), Cf de plaque plane le long de x, etc. */
  private colorFuselage(r: TunnelResult): void {
    if (!this.fuselage) return;
    const geo = this.fuselage.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const ca = Math.cos(this.alpha), sa = Math.sin(this.alpha), cb = Math.cos(this.beta), sb = Math.sin(this.beta);
    const dx = -ca * cb, dy = sa * cb, dz = -sb;
    const tmp = [0, 0, 0];
    const tauMax = this.tauMax(r);
    for (let i = 0; i < nrm.count; i++) {
      const xs = Math.max(0.05, -pos.getX(i));
      const reX = (r.rho * r.V * xs) / r.mu;
      const lam = reX < 5e5;
      const cf = lam ? 0.664 / Math.sqrt(reX) : 0.0592 * Math.pow(reX, -0.2);
      let v: number;
      switch (this.surfaceMap) {
        case 'velocity': v = 0.04; break;
        case 'cp': {
          const c = -(nrm.getX(i) * dx + nrm.getY(i) * dy + nrm.getZ(i) * dz);
          const cp = c > 0 ? 1.0 * c * c - 0.42 * (1 - c) : -0.42 + 0.25 * -c;
          v = (cp - CFD_STYLE.cpMin) / (CFD_STYLE.cpMax - CFD_STYLE.cpMin);
          break;
        }
        case 'cf': v = cf / 0.006; break;
        case 'tau': v = (cf * 0.5 * r.rho * r.V * r.V) / tauMax; break;
        case 'regime': v = lam ? -1 : -2; break;
        case 'cl': v = 0.02; break;
        case 'stress': v = 0.08; break;
      }
      this.color(v, tmp);
      col.setXYZ(i, lin(tmp[0]), lin(tmp[1]), lin(tmp[2]));
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
    this.result = r;
    this.alpha = (alphaDeg * Math.PI) / 180;
    this.beta = (betaDeg * Math.PI) / 180;
    this.root.rotation.set(0, -this.beta, this.alpha);
    this.recolorSurfaces();
    this.cgMarker.position.set(g.xcg, 0, 0);
    this.npMarker.position.set(r.deriv.xnp, 0, 0);
    this.disposeObj(this.shock); this.shock = null;
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
      this.shock = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: CFD_STYLE.shockColor, transparent: true, opacity: CFD_STYLE.shockOpacity, side: THREE.DoubleSide, depthWrite: false }));
      this.shock.visible = this.showShock;
      this.root.add(this.shock);
    }
    this.disposeObj(this.cone, this.scene); this.cone = null;
    if (r.machCone > 0) {
      const L = g.length * 1.6;
      const rad = L * Math.tan(r.machCone);
      const cg = new THREE.ConeGeometry(rad, L, 48, 1, true);
      cg.translate(0, -L / 2, 0);
      cg.rotateZ(-Math.PI / 2);
      this.cone = new THREE.LineSegments(new THREE.WireframeGeometry(cg), new THREE.LineBasicMaterial({ color: CFD_STYLE.machConeColor, transparent: true, opacity: 0.22 }));
      cg.dispose();
      this.cone.visible = this.showShock;
      this.scene.add(this.cone);
    }
  }

  setStreamlines(s: StreamlineResult): void {
    this.lines = s;
    // échelle « jet » étalée sur la plage utile (percentiles 1–99 %), arrondie à 5 m/s
    this.lineMin = Math.max(0, Math.floor(s.vLo / 5) * 5);
    this.lineMax = Math.max(this.lineMin + 5, Math.ceil(s.vHi / 5) * 5);
    this.disposeObj(this.tubes); this.tubes = null;
    this.disposeObj(this.particles); this.particles = null;
    this.disposeObj(this.seeds); this.seeds = null;
    this.disposeObj(this.leLines); this.leLines = null;
    const size = this.geom ? Math.max(this.geom.span, this.geom.length) : 10;
    const radius = size * 0.0028;
    const RS = 6;
    let nPts = 0, nSegs = 0;
    for (let l = 0; l < s.offsets.length - 1; l++) {
      const c = s.offsets[l + 1] - s.offsets[l];
      if (c < 2) continue;
      nPts += c;
      nSegs += c - 1;
    }
    const pos = new Float32Array(nPts * RS * 3);
    const nor = new Float32Array(nPts * RS * 3);
    const col = new Float32Array(nPts * RS * 3);
    const idx = new Uint32Array(nSegs * RS * 6);
    let vi = 0, ii = 0;
    const t = new THREE.Vector3(), nA = new THREE.Vector3(), bA = new THREE.Vector3(), up = new THREE.Vector3();
    for (let l = 0; l < s.offsets.length - 1; l++) {
      const a = s.offsets[l], b = s.offsets[l + 1];
      if (b - a < 2) continue;
      const base = vi;
      for (let i = a; i < b; i++) {
        const j0 = Math.max(a, i - 1), j1 = Math.min(b - 1, i + 1);
        t.set(s.points[3 * j1] - s.points[3 * j0], s.points[3 * j1 + 1] - s.points[3 * j0 + 1], s.points[3 * j1 + 2] - s.points[3 * j0 + 2]).normalize();
        up.set(0, 1, 0);
        if (Math.abs(t.y) > 0.9) up.set(1, 0, 0);
        nA.crossVectors(t, up).normalize();
        bA.crossVectors(t, nA).normalize();
        for (let k = 0; k < RS; k++) {
          const th = (k / RS) * Math.PI * 2;
          const cx = Math.cos(th), sy = Math.sin(th);
          const nx = nA.x * cx + bA.x * sy, ny = nA.y * cx + bA.y * sy, nz = nA.z * cx + bA.z * sy;
          const o = 3 * vi;
          pos[o] = s.points[3 * i] + nx * radius; pos[o + 1] = s.points[3 * i + 1] + ny * radius; pos[o + 2] = s.points[3 * i + 2] + nz * radius;
          nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
          vi++;
        }
      }
      for (let i = 0; i < b - a - 1; i++) {
        for (let k = 0; k < RS; k++) {
          const p0 = base + i * RS + k, p1 = base + i * RS + ((k + 1) % RS);
          const q0 = p0 + RS, q1 = p1 + RS;
          idx[ii++] = p0; idx[ii++] = q0; idx[ii++] = p1;
          idx[ii++] = p1; idx[ii++] = q0; idx[ii++] = q1;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.tubes = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 }));
    this.tubes.visible = this.showStreamlines;
    this.root.add(this.tubes);
    this.recolorLines();

    // graines du râteau d'entrée
    const ns = s.seeds.length / 3;
    const sg = new THREE.SphereGeometry(size * 0.0055, 10, 8);
    this.seeds = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: CFD_STYLE.seedColor, roughness: 0.5 }), Math.max(1, ns));
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < ns; i++) this.seeds.setMatrixAt(i, m4.makeTranslation(s.seeds[3 * i], s.seeds[3 * i + 1], s.seeds[3 * i + 2]));
    this.seeds.count = ns;
    this.seeds.visible = this.showStreamlines;
    this.root.add(this.seeds);

    // filaments de tourbillons de bord d'attaque (Polhamus)
    if (s.leVortex.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(s.leVortex.slice(), 3));
      this.leLines = new THREE.LineSegments(lg, new THREE.LineDashedMaterial({ color: 0xd926d9, dashSize: size * 0.02, gapSize: size * 0.012 }));
      this.leLines.computeLineDistances();
      this.leLines.visible = this.showStreamlines;
      this.root.add(this.leLines);
    }

    // particules animées
    const nl = s.offsets.length - 1;
    const per = 3;
    this.partLine = new Int32Array(nl * per);
    this.partPos = new Float32Array(nl * per);
    for (let l = 0; l < nl; l++) for (let k = 0; k < per; k++) { this.partLine[l * per + k] = l; this.partPos[l * per + k] = (k + (l % 7) / 7) / per; }
    this.partArr = new Float32Array(nl * per * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.partArr, 3));
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffffff, size: 4, sizeAttenuation: false, transparent: true, opacity: 0.95, depthWrite: false }));
    this.particles.frustumCulled = false;
    this.particles.visible = this.showStreamlines;
    this.root.add(this.particles);

    // veine d'essai (repère vent) et trièdre
    this.root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(this.tubes);
    bb.expandByScalar(size * 0.04);
    this.disposeObj(this.box, this.scene);
    const bg = new THREE.BoxGeometry(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    this.box = new THREE.LineSegments(new THREE.EdgesGeometry(bg), new THREE.LineBasicMaterial({ color: CFD_STYLE.domainBox }));
    bg.dispose();
    bb.getCenter(this.box.position);
    this.scene.add(this.box);
    this.axes.clear();
    const L = size * 0.14;
    const c = bb.getCenter(new THREE.Vector3());
    const origin = new THREE.Vector3(c.x, bb.min.y, c.z + (bb.max.z - c.z) * 0.35);
    for (const [dir, colr] of [[new THREE.Vector3(1, 0, 0), 0xe0201a], [new THREE.Vector3(0, 1, 0), 0x22b020], [new THREE.Vector3(0, 0, 1), 0x1a3ae0]] as const) {
      this.axes.add(new THREE.ArrowHelper(dir, origin, L, colr, L * 0.28, L * 0.14));
    }
  }

  recolorLines(): void {
    const s = this.lines;
    if (!s || !this.tubes) return;
    const col = this.tubes.geometry.getAttribute('color') as THREE.BufferAttribute;
    const RS = 6;
    const tmp = [0, 0, 0];
    let vi = 0;
    for (let l = 0; l < s.offsets.length - 1; l++) {
      const a = s.offsets[l], b = s.offsets[l + 1];
      if (b - a < 2) continue;
      for (let i = a; i < b; i++) {
        if (this.lineColoring === 'regime') {
          const g = s.regime[i];
          const c = g === 0 ? REGIME_COLORS.laminar : g === 1 ? REGIME_COLORS.turbulent : g === 2 ? REGIME_COLORS.vortex : REGIME_COLORS.separated;
          tmp[0] = c[0]; tmp[1] = c[1]; tmp[2] = c[2];
        } else jet((s.speed[i] - this.lineMin) / (this.lineMax - this.lineMin), tmp);
        for (let k = 0; k < RS; k++) { col.setXYZ(vi, lin(tmp[0]), lin(tmp[1]), lin(tmp[2])); vi++; }
      }
    }
    col.needsUpdate = true;
  }

  setModes(map: SurfaceMap, lines: LineColoring): void {
    const changedMap = map !== this.surfaceMap;
    const changedLines = lines !== this.lineColoring;
    this.surfaceMap = map;
    this.lineColoring = lines;
    if (changedMap) this.recolorSurfaces();
    if (changedLines) this.recolorLines();
  }

  setVisibility(stream: boolean, shock: boolean): void {
    this.showStreamlines = stream;
    this.showShock = shock;
    for (const o of [this.tubes, this.seeds, this.particles, this.leLines]) if (o) o.visible = stream;
    if (this.shock) this.shock.visible = shock;
    if (this.cone) this.cone.visible = shock;
  }

  private animateParticles(dt: number): void {
    const s = this.lines;
    if (!s || !this.particles || !this.showStreamlines) return;
    const arr = this.partArr;
    for (let p = 0; p < this.partLine.length; p++) {
      const l = this.partLine[p];
      const a = s.offsets[l], b = s.offsets[l + 1];
      const n = b - a;
      if (n < 2) continue;
      const i = a + Math.min(n - 1, Math.floor(this.partPos[p] * (n - 1)));
      const v = s.speed[i] / Math.max(1, s.vMax);
      this.partPos[p] = (this.partPos[p] + dt * 0.12 * (0.4 + v)) % 1;
      const f = this.partPos[p] * (n - 1);
      const i0 = a + Math.floor(f), i1 = Math.min(b - 1, i0 + 1), w = f - Math.floor(f);
      arr[3 * p] = s.points[3 * i0] + (s.points[3 * i1] - s.points[3 * i0]) * w;
      arr[3 * p + 1] = s.points[3 * i0 + 1] + (s.points[3 * i1 + 1] - s.points[3 * i0 + 1]) * w;
      arr[3 * p + 2] = s.points[3 * i0 + 2] + (s.points[3 * i1 + 2] - s.points[3 * i0 + 2]) * w;
    }
    (this.particles.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  render(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.animateParticles(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.renderer.dispose();
  }
}
