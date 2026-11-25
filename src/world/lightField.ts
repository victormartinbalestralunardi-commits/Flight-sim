/**
 * Champ de feux ponctuels (balisage, PAPI, pont) rendu en UN SEUL appel de dessin :
 * `THREE.Points` + shader (halo radial additif, taille en mètres avec plancher en pixels).
 * Remplace des centaines de `Sprite` individuels (gain massif en draw calls).
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 color;
attribute float size;
varying vec3 vColor;
uniform float uScale;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * uScale / max(1.0, -mv.z), 2.0, 64.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
uniform float uIntensity;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = exp(-r * r * 5.0) + 0.6 * exp(-r * r * 40.0);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a * uIntensity, a);
}`;

export class LightField {
  private pos: number[] = [];
  private col: number[] = [];
  private siz: number[] = [];
  points: THREE.Points | null = null;
  private colorAttr: THREE.BufferAttribute | null = null;
  private tmp = new THREE.Color();

  add(x: number, y: number, z: number, color: number, size: number): number {
    this.tmp.setHex(color);
    this.pos.push(x, y, z);
    this.col.push(this.tmp.r, this.tmp.g, this.tmp.b);
    this.siz.push(size);
    return this.siz.length - 1;
  }

  get count(): number {
    return this.siz.length;
  }

  build(name = 'lights'): THREE.Points {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    this.colorAttr = new THREE.Float32BufferAttribute(this.col, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('color', this.colorAttr);
    g.setAttribute('size', new THREE.Float32BufferAttribute(this.siz, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 900 }, uIntensity: { value: 1.6 } },
    });
    this.points = new THREE.Points(g, m);
    this.points.name = name;
    this.points.frustumCulled = false;
    return this.points;
  }

  /** Change la couleur d'un feu (ex. PAPI rouge/blanc). */
  setColor(i: number, hex: number): void {
    if (!this.colorAttr) return;
    this.tmp.setHex(hex);
    this.colorAttr.setXYZ(i, this.tmp.r, this.tmp.g, this.tmp.b);
    this.colorAttr.needsUpdate = true;
  }

  /** Intensité globale (feux plus visibles la nuit). */
  setIntensity(v: number): void {
    if (this.points) (this.points.material as THREE.ShaderMaterial).uniforms.uIntensity.value = v;
  }
}
