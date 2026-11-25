/**
 * Path tracing progressif (three-gpu-pathtracer) pour l'Atelier et le Mode Photo :
 * reflets physiques sur verrière et fuselage, occlusion ambiante réelle, ombres douces.
 * Le rendu rasterisé sert d'aperçu tant que le BVH se construit / la caméra bouge.
 */
import * as THREE from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';

export class ProgressivePathTracer {
  private pt: WebGLPathTracer | null = null;
  private renderer: THREE.WebGLRenderer;
  enabled = true;
  maxSamples = 512;
  failed: string | null = null;
  private ready = false;
  private studioEnv: THREE.DataTexture | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  /** (Re)charge la scène dans le traceur (construction BVH). */
  async setScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera, bounces: number): Promise<void> {
    if (!this.enabled) return;
    try {
      if (!this.pt) {
        this.pt = new WebGLPathTracer(this.renderer);
        this.pt.tiles.set(3, 3);
        this.pt.renderScale = Math.min(1, 1.5 / Math.max(1, window.devicePixelRatio));
        this.pt.filterGlossyFactor = 0.5;
        this.pt.minSamples = 3;
        this.pt.renderDelay = 120;
        this.pt.fadeDuration = 400;
        this.pt.dynamicLowRes = true;
        this.pt.lowResScale = 0.35;
      }
      this.pt.bounces = bounces;
      this.ready = false;
      // construction BVH synchrone (pas de worker BVH requis) ; différée d'une frame pour l'UI
      await new Promise((r) => setTimeout(r, 30));
      this.pt.setScene(this.tracable(scene), camera);
      this.ready = true;
      this.failed = null;
    } catch (e) {
      this.failed = e instanceof Error ? e.message : String(e);
      this.ready = false;
      console.warn('[path tracer] désactivé :', this.failed, e instanceof Error ? e.stack : '');
    }
  }

  /**
   * Scène « traçable » : uniquement des Mesh non instanciés à matériaux PBR standard
   * (les sprites de feux, flammes en shader et instances sont rendus en raster).
   */
  private tracable(src: THREE.Scene): THREE.Scene {
    const dst = new THREE.Scene();
    // le traceur requiert une carte d'environnement équirectangulaire en données (pas un PMREM)
    if (!this.studioEnv) this.studioEnv = studioEquirect();
    dst.environment = this.studioEnv;
    dst.background = this.studioEnv;
    dst.backgroundIntensity = 0.35;
    src.updateMatrixWorld(true);
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((o as THREE.Light).isLight && !(o as THREE.SpotLight).isSpotLight) {
        const l = (o as THREE.Light).clone();
        l.applyMatrix4(o.matrixWorld.clone().multiply(new THREE.Matrix4().copy(o.matrix).invert()));
        dst.add(l);
        return;
      }
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || !m.visible) return;
      const mat = m.material as THREE.Material;
      if (Array.isArray(mat) || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
      let visible = true;
      o.traverseAncestors((a) => { if (!a.visible) visible = false; });
      if (!visible) return;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute('position').count) * 2), 2));
      g.applyMatrix4(m.matrixWorld);
      dst.add(new THREE.Mesh(g, mat));
    });
    return dst;
  }

  cameraMoved(): void {
    if (this.pt && this.ready) this.pt.updateCamera();
  }

  materialsChanged(): void {
    if (this.pt && this.ready) this.pt.updateMaterials();
  }

  get samples(): number {
    return this.pt && this.ready ? this.pt.samples : 0;
  }

  /** Rend un échantillon ; retourne false si le rendu rasterisé doit être utilisé. */
  render(): boolean {
    if (!this.enabled || !this.pt || !this.ready || this.failed) return false;
    if (this.pt.samples >= this.maxSamples) {
      this.pt.pausePathTracing = true;
    } else this.pt.pausePathTracing = false;
    this.pt.renderSample();
    return true;
  }

  dispose(): void {
    this.pt?.dispose();
    this.pt = null;
  }
}

/** Environnement de studio HDR équirectangulaire procédural (softbox zénithale + latérales). */
export function studioEquirect(w = 256, h = 128): THREE.DataTexture {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const el = (0.5 - y / h) * Math.PI; // +π/2 zénith
    for (let x = 0; x < w; x++) {
      const az = (x / w) * Math.PI * 2;
      let v = 0.08 + 0.25 * Math.max(0, Math.sin(el));
      // softbox zénithale rectangulaire
      if (el > 1.1) v += 6;
      // deux softbox latérales
      if (el > 0.15 && el < 0.6 && (Math.abs(az - 1.2) < 0.25 || Math.abs(az - 4.4) < 0.3)) v += 3.5;
      // sol
      if (el < 0) v = 0.05;
      const o = 4 * (y * w + x);
      data[o] = v; data[o + 1] = v * 0.98; data[o + 2] = v * 0.95; data[o + 3] = 1;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
