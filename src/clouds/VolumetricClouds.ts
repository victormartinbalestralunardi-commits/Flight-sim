/**
 * Nuages volumétriques dynamiques optimisés.
 *
 * 1. Raymarching en résolution réduite (½ ou ¼) d'une couche nuageuse [base, base+épaisseur] :
 *    densité = bruit fBm 3D procédural modulé par la couverture, dérive avec le vent ;
 *    extinction de Beer-Lambert vers le soleil (4 échantillons), fonction de phase de
 *    Henyey-Greenstein double lobe (diffusion de Mie avant/arrière), terme « powder »,
 *    ambiant ciel ; arrêt au premier obstacle (tampon de profondeur de la scène).
 * 2. Reprojection temporelle (TAA) : l'historique est reprojeté avec la matrice vue-projection
 *    précédente au point milieu de la couche, puis mélangé (95 %) ; le décalage de rayon
 *    est gigué par frame (bruit à gradient entrelacé).
 * 3. Composition plein écran avec suréchantillonnage bilatéral (poids de profondeur) et
 *    ombres portées des nuages au sol (intégration de densité le long du rayon solaire).
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const NOISE = /* glsl */ `
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; } return s; }
uniform float uBase; uniform float uTop; uniform float uCover; uniform vec3 uWindOffset;
float density(vec3 p) {
  float h = (p.y - uBase) / (uTop - uBase);
  if (h < 0.0 || h > 1.0) return 0.0;
  float profile = smoothstep(0.0, 0.18, h) * smoothstep(1.0, 0.45, h);
  vec3 q = (p + uWindOffset) * 0.00055;
  float shape = fbm(q * vec3(1.0, 1.6, 1.0));
  float d = shape - (1.0 - uCover) * 0.72 - 0.1;
  d = d * profile;
  if (d <= 0.0) return 0.0;
  d -= 0.12 * fbm(q * 6.0) * (1.0 - h);
  return max(0.0, d) * 0.065;
}
`;

const MARCH_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDepth;
uniform mat4 uInvProj; uniform mat4 uInvView; uniform vec3 uCamPos;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmbient;
uniform float uNear; uniform float uFar; uniform float uFrame; uniform vec2 uRes;
varying vec2 vUv;
${NOISE}
float linDepth(float z) { float ndc = z * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear)); }
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
void main() {
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 view = uInvProj * ndc; view /= view.w;
  vec3 dirV = normalize(view.xyz);
  vec3 dir = normalize((uInvView * vec4(dirV, 0.0)).xyz);
  float sceneZ = linDepth(texture2D(tDepth, vUv).r);
  float sceneDist = sceneZ / max(1e-4, -dirV.z);
  // intersection avec la couche
  float t0, t1;
  if (abs(dir.y) < 1e-4) { t0 = 0.0; t1 = 60000.0; }
  else {
    float ta = (uBase - uCamPos.y) / dir.y, tb = (uTop - uCamPos.y) / dir.y;
    t0 = max(0.0, min(ta, tb)); t1 = max(ta, tb);
  }
  t1 = min(t1, min(sceneDist, 60000.0));
  if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  const int STEPS = 48;
  float stepLen = (t1 - t0) / float(STEPS);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.618034);
  float T = 1.0; vec3 L = vec3(0.0);
  float cosT = dot(dir, uSunDir);
  float phase = mix(hg(cosT, 0.6), hg(cosT, -0.25), 0.3);
  for (int i = 0; i < STEPS; i++) {
    float t = t0 + (float(i) + jitter) * stepLen;
    vec3 p = uCamPos + dir * t;
    float d = density(p);
    if (d > 0.0) {
      // ombrage : densité accumulée vers le soleil
      float od = 0.0;
      for (int j = 1; j <= 4; j++) od += density(p + uSunDir * float(j * j) * 45.0) * float(j) * 45.0;
      float beer = exp(-od * 1.4);
      float powder = 1.0 - exp(-d * 2.0 * stepLen);
      vec3 S = uSunColor * beer * phase * (0.6 + 0.4 * powder) * 18.0 + uAmbient * (0.55 + 0.45 * (p.y - uBase) / (uTop - uBase));
      float ext = exp(-d * stepLen);
      L += T * S * (1.0 - ext);
      T *= ext;
      if (T < 0.02) break;
    }
  }
  gl_FragColor = vec4(L, T);
}`;

const TEMPORAL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tCurrent; uniform sampler2D tHistory;
uniform mat4 uPrevViewProj; uniform mat4 uInvProj; uniform mat4 uInvView; uniform vec3 uCamPos;
uniform float uBase; uniform float uTop; uniform float uBlend;
varying vec2 vUv;
void main() {
  vec4 cur = texture2D(tCurrent, vUv);
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 view = uInvProj * ndc; view /= view.w;
  vec3 dir = normalize((uInvView * vec4(normalize(view.xyz), 0.0)).xyz);
  float mid = 0.5 * (uBase + uTop);
  float t = abs(dir.y) > 1e-4 ? (mid - uCamPos.y) / dir.y : 20000.0;
  if (t < 0.0) t = 20000.0;
  vec3 wp = uCamPos + dir * min(t, 40000.0);
  vec4 prev = uPrevViewProj * vec4(wp, 1.0);
  vec2 puv = prev.xy / prev.w * 0.5 + 0.5;
  vec4 hist = texture2D(tHistory, puv);
  float valid = step(0.0, puv.x) * step(puv.x, 1.0) * step(0.0, puv.y) * step(puv.y, 1.0);
  // clamp de voisinage pour limiter le ghosting
  vec2 px = vec2(dFdx(vUv.x), dFdy(vUv.y));
  vec4 mn = cur, mx = cur;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) { vec4 s = texture2D(tCurrent, vUv + vec2(x, y) * px); mn = min(mn, s); mx = max(mx, s); }
  hist = clamp(hist, mn, mx);
  gl_FragColor = mix(cur, hist, uBlend * valid);
}`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene; uniform sampler2D tClouds; uniform sampler2D tDepth;
uniform vec2 uLowRes; uniform float uNear; uniform float uFar;
uniform mat4 uInvProj; uniform mat4 uInvView; uniform vec3 uCamPos; uniform vec3 uSunDir; uniform float uShadow;
varying vec2 vUv;
${NOISE}
float linDepth(float z) { float ndc = z * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear)); }
void main() {
  vec4 scene = texture2D(tScene, vUv);
  float zFull = linDepth(texture2D(tDepth, vUv).r);
  // suréchantillonnage bilatéral : 4 texels basse résolution pondérés par la profondeur
  vec2 lp = vUv * uLowRes - 0.5;
  vec2 f = fract(lp);
  vec2 base = (floor(lp) + 0.5) / uLowRes;
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 uv = base + vec2(i, j) / uLowRes;
    float zl = linDepth(texture2D(tDepth, uv).r);
    float wb = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    float wd = 1.0 / (1e-3 + abs(zl - zFull) / max(1.0, zFull) * 40.0);
    float w = wb * wd;
    acc += texture2D(tClouds, uv) * w; wsum += w;
  }
  vec4 cl = acc / max(1e-5, wsum);
  // ombres des nuages au sol
  vec3 col = scene.rgb;
  if (uShadow > 0.0 && zFull < uFar * 0.95) {
    vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec4 v = uInvProj * ndc; v /= v.w;
    vec3 dirV = normalize(v.xyz);
    vec3 dir = normalize((uInvView * vec4(dirV, 0.0)).xyz);
    vec3 wp = uCamPos + dir * (zFull / max(1e-4, -dirV.z));
    if (wp.y < uBase && uSunDir.y > 0.02) {
      float t0 = (uBase - wp.y) / uSunDir.y, t1 = (uTop - wp.y) / uSunDir.y;
      float od = 0.0;
      for (int k = 0; k < 3; k++) od += density(wp + uSunDir * mix(t0, t1, (float(k) + 0.5) / 3.0)) * (t1 - t0) / 3.0;
      col *= mix(1.0, exp(-od * 1.2), uShadow);
    }
  }
  gl_FragColor = vec4(col * cl.a + cl.rgb, scene.a);
}`;

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export interface CloudSettings {
  enabled: boolean;
  coverage: number;
  base: number;
  thickness: number;
  resolution: 0.5 | 0.25;
}

export class VolumetricClouds {
  private march: FullScreenQuad;
  private temporal: FullScreenQuad;
  private composite: FullScreenQuad;
  private rtLow: THREE.WebGLRenderTarget;
  private hist: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private prevVP = new THREE.Matrix4();
  private frame = 0;
  private windOffset = new THREE.Vector3();
  settings: CloudSettings;
  readonly sunDir = new THREE.Vector3(0.3, 0.8, 0.2).normalize();
  readonly sunColor = new THREE.Color(1, 0.97, 0.9);
  readonly ambient = new THREE.Color(0.55, 0.62, 0.75);

  constructor(settings: CloudSettings) {
    this.settings = settings;
    const common = {
      uBase: { value: settings.base }, uTop: { value: settings.base + settings.thickness }, uCover: { value: settings.coverage },
      uWindOffset: { value: this.windOffset },
    };
    this.march = new FullScreenQuad(new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: MARCH_FRAG,
      uniforms: {
        ...common, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: this.sunDir }, uSunColor: { value: this.sunColor }, uAmbient: { value: this.ambient },
        uNear: { value: 0.1 }, uFar: { value: 1e5 }, uFrame: { value: 0 }, uRes: { value: new THREE.Vector2() },
      },
      depthTest: false, depthWrite: false,
    }));
    this.temporal = new FullScreenQuad(new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: TEMPORAL_FRAG,
      uniforms: {
        tCurrent: { value: null }, tHistory: { value: null }, uPrevViewProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() },
        uInvView: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uBase: common.uBase, uTop: common.uTop, uBlend: { value: 0.9 },
      },
      depthTest: false, depthWrite: false,
    }));
    this.composite = new FullScreenQuad(new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        ...common, tScene: { value: null }, tClouds: { value: null }, tDepth: { value: null }, uLowRes: { value: new THREE.Vector2() },
        uNear: { value: 0.1 }, uFar: { value: 1e5 }, uInvProj: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: this.sunDir }, uShadow: { value: 0.65 },
      },
      depthTest: false, depthWrite: false,
    }));
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtLow = new THREE.WebGLRenderTarget(1, 1, opts);
    this.hist = [new THREE.WebGLRenderTarget(1, 1, opts), new THREE.WebGLRenderTarget(1, 1, opts)];
  }

  setSize(w: number, h: number): void {
    const s = this.settings.resolution;
    const lw = Math.max(1, Math.round(w * s)), lh = Math.max(1, Math.round(h * s));
    this.rtLow.setSize(lw, lh);
    this.hist[0].setSize(lw, lh);
    this.hist[1].setSize(lw, lh);
    (this.composite.material as THREE.ShaderMaterial).uniforms.uLowRes.value.set(lw, lh);
    (this.march.material as THREE.ShaderMaterial).uniforms.uRes.value.set(lw, lh);
  }

  update(dt: number, wind: THREE.Vector3): void {
    this.windOffset.addScaledVector(wind, -dt);
    const u = (this.march.material as THREE.ShaderMaterial).uniforms;
    u.uBase.value = this.settings.base;
    u.uTop.value = this.settings.base + this.settings.thickness;
    u.uCover.value = this.settings.coverage;
  }

  /**
   * Rend les nuages et compose sur `sceneRT` (couleur + profondeur) dans `output`.
   */
  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, sceneTex: THREE.Texture, depthTex: THREE.Texture, output: THREE.WebGLRenderTarget | null): void {
    const mu = (this.march.material as THREE.ShaderMaterial).uniforms;
    const tu = (this.temporal.material as THREE.ShaderMaterial).uniforms;
    const cu = (this.composite.material as THREE.ShaderMaterial).uniforms;
    for (const u of [mu, tu, cu]) {
      if (u.uInvProj) u.uInvProj.value.copy(camera.projectionMatrixInverse);
      if (u.uInvView) u.uInvView.value.copy(camera.matrixWorld);
      if (u.uCamPos) u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
      if (u.uNear) { u.uNear.value = camera.near; u.uFar.value = camera.far; }
    }
    mu.tDepth.value = depthTex;
    mu.uFrame.value = this.frame++ % 64;
    renderer.setRenderTarget(this.rtLow);
    this.march.render(renderer);
    // reprojection temporelle
    const [hPrev, hNext] = this.frame % 2 ? [this.hist[0], this.hist[1]] : [this.hist[1], this.hist[0]];
    tu.tCurrent.value = this.rtLow.texture;
    tu.tHistory.value = hPrev.texture;
    tu.uPrevViewProj.value.copy(this.prevVP);
    tu.uBlend.value = this.frame < 3 ? 0 : 0.9;
    renderer.setRenderTarget(hNext);
    this.temporal.render(renderer);
    this.prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // composition bilatérale
    cu.tScene.value = sceneTex;
    cu.tClouds.value = hNext.texture;
    cu.tDepth.value = depthTex;
    renderer.setRenderTarget(output);
    this.composite.render(renderer);
  }

  dispose(): void {
    this.rtLow.dispose();
    this.hist.forEach((h) => h.dispose());
    this.march.dispose();
    this.temporal.dispose();
    this.composite.dispose();
  }
}
