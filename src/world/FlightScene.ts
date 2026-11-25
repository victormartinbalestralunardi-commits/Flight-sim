/**
 * Scène de vol temps réel (cible 4K / 120 FPS) :
 * ciel physique (Sky) + soleil selon l'heure, IBL dynamique (PMREM du ciel), ombres cascadées
 * (CSM), brouillard, aéroport / porte-avions, avion animé, cockpit 3D, nuages volumétriques,
 * post-traitement (GTAO, SSR optionnel, bloom physique, ACES Filmic, SMAA), résolution
 * dynamique (DRS) et caméras (poursuite, cockpit avec inertie de tête sous G, orbite, tour,
 * passage, libre pour le replay). Aucune allocation dans update().
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SSRPass } from 'three/examples/jsm/postprocessing/SSRPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AircraftSpec } from '../aircraft/types';
import { buildAircraftModel } from '../aircraft/procedural';
import { AircraftAnimator } from '../aircraft/animator';
import { Cockpit3D } from '../cockpit/Cockpit3D';
import { buildAirportScene, type AirportScene } from '../airports/build3d';
import { buildCarrier, type CarrierScene } from '../airports/carrier3d';
import { approachRef, flolsBall, type AirportDef } from '../airports/airports';
import { VolumetricClouds } from '../clouds/VolumetricClouds';
import { installGlErrorHandler, MetricsCollector } from '../raytracing/glDebug';
import { O } from '../physics/layout';
import type { GraphicsSettings, WeatherSettings } from '../ui/store';

export type CameraMode = 'chase' | 'cockpit' | 'orbit' | 'tower' | 'flyby' | 'free';
export const CAMERA_MODES: CameraMode[] = ['chase', 'cockpit', 'orbit', 'tower', 'flyby'];

/**
 * Rendu de la scène dans une cible dédiée (couleur HDR + texture de profondeur), puis copie
 * de la couleur dans la chaîne du composer : la profondeur reste lisible par les passes
 * suivantes (nuages) sans boucle de rétroaction framebuffer/texture.
 */
class SceneDepthPass extends Pass {
  readonly rt: THREE.WebGLRenderTarget;
  private copy: FullScreenQuad;
  constructor(private scene: THREE.Scene, private camera: THREE.Camera) {
    super();
    this.needsSwap = false;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rt.texture } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }',
      depthTest: false, depthWrite: false,
    }));
  }
  get depthTexture(): THREE.DepthTexture | null {
    return this.rt.depthTexture;
  }
  setSize(w: number, h: number): void {
    this.rt.setSize(w, h);
  }
  render(renderer: THREE.WebGLRenderer, _w: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.copy.render(renderer);
  }
  dispose(): void {
    this.rt.dispose();
    this.copy.dispose();
  }
}

/** Passe de composition des nuages volumétriques. */
class CloudPass extends Pass {
  constructor(private clouds: VolumetricClouds, private camera: THREE.PerspectiveCamera, private depth: () => THREE.Texture | null) {
    super();
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const d = this.depth();
    if (!d) return;
    this.clouds.render(renderer, this.camera, readBuffer.texture, d, this.renderToScreen ? null : writeBuffer);
  }
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _wind = new THREE.Vector3();

export class FlightScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly metrics = new MetricsCollector();
  readonly aircraft: THREE.Group;
  readonly animator: AircraftAnimator;
  readonly cockpit: Cockpit3D;
  readonly airport: AirportScene;
  readonly carrier: CarrierScene | null;
  readonly spec: AircraftSpec;
  readonly ap: AirportDef;
  private sky: Sky;
  private sun: THREE.DirectionalLight | null = null;
  private csm: CSM | null = null;
  private hemi: THREE.HemisphereLight;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private composer: EffectComposer;
  private depthPass: SceneDepthPass;
  private ssr: SSRPass | null = null;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private clouds: VolumetricClouds | null = null;
  private cloudPass: CloudPass | null = null;
  private orbit: OrbitControls;
  readonly sunDir = new THREE.Vector3();
  mode: CameraMode = 'chase';
  private gfx: GraphicsSettings;
  private wx: WeatherSettings;
  private dynScale = 1;
  private frameTimes = new Float32Array(30);
  private ftIdx = 0;
  private t = 0;
  private headOffset = new THREE.Vector3();
  private chasePos = new THREE.Vector3();
  private flybyPos = new THREE.Vector3();
  private flybyT = -1;
  private width = 1;
  private height = 1;
  /** position de l'œil (monde) — pour PAPI, FLOLS, audio */
  readonly eyeWorld = new THREE.Vector3();
  replayTarget: Float64Array | null = null;
  private hookNode: THREE.Object3D | null = null;
  private readonly hookTip = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, spec: AircraftSpec, ap: AirportDef, xcg: number, gfx: GraphicsSettings, wx: WeatherSettings) {
    this.spec = spec;
    this.ap = ap;
    this.gfx = gfx;
    this.wx = wx;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, logarithmicDepthBuffer: false });
    installGlErrorHandler(this.renderer);
    this.metrics.attach(this.renderer);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = gfx.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(gfx.fov, 1, 0.3, 120000);
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enabled = false;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    // ciel
    this.sky = new Sky();
    this.sky.scale.setScalar(200000);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 4;
    su.rayleigh.value = 1.6;
    su.mieCoefficient.value = 0.004;
    su.mieDirectionalG.value = 0.82;
    this.scene.add(this.sky);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x55504a, 0.4);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0xb8c8dc, 0.000035);

    // monde
    this.airport = buildAirportScene(ap);
    this.scene.add(this.airport.group);
    this.carrier = ap.carrier ? buildCarrier(ap.carrier) : null;
    if (this.carrier) this.scene.add(this.carrier.group);

    // avion + cockpit
    const m = buildAircraftModel(spec, xcg);
    this.aircraft = m.object;
    this.aircraft.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
    this.scene.add(this.aircraft);
    this.animator = new AircraftAnimator(this.aircraft, spec);
    this.hookNode = this.aircraft.getObjectByName('hook') ?? null;
    this.cockpit = new Cockpit3D(spec, xcg);
    this.aircraft.add(this.cockpit.group);
    this.cockpit.group.visible = false;

    // éclairage soleil (CSM ou lumière simple)
    this.setupSun();
    this.setTimeOfDay(wx.timeOfDay);

    // post-traitement
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.depthPass = new SceneDepthPass(this.scene, this.camera);
    this.buildPipeline();
  }

  private setupSun(): void {
    if (this.csm) { this.csm.remove(); this.csm.dispose(); this.csm = null; }
    if (this.sun) { this.scene.remove(this.sun); this.sun = null; }
    if (this.gfx.shadows) {
      this.csm = new CSM({
        maxFar: Math.max(800, this.spec.length * 60), cascades: this.gfx.shadowCascades, mode: 'practical', parent: this.scene,
        shadowMapSize: this.gfx.preset === 'cinema' || this.gfx.preset === 'ultra' ? 4096 : 2048, lightDirection: new THREE.Vector3(-0.4, -1, -0.3).normalize(),
        camera: this.camera, lightIntensity: 3, lightFar: 6000, lightMargin: 400,
      });
      this.csm.fade = true;
      this.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mt of mats) if ((mt as THREE.MeshStandardMaterial).isMeshStandardMaterial) this.csm!.setupMaterial(mt);
        }
      });
    } else {
      this.sun = new THREE.DirectionalLight(0xffffff, 3);
      this.scene.add(this.sun, this.sun.target);
    }
  }

  private buildPipeline(): void {
    const c = this.composer;
    while (c.passes.length) c.removePass(c.passes[0]);
    this.ssr?.dispose(); this.ssr = null;
    this.gtao?.dispose(); this.gtao = null;
    this.bloom?.dispose(); this.bloom = null;
    if (this.gfx.ssr) {
      const selects: THREE.Mesh[] = [];
      this.aircraft.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) selects.push(m); });
      if (this.airport.water) selects.push(this.airport.water);
      this.ssr = new SSRPass({ renderer: this.renderer, scene: this.scene, camera: this.camera, width: this.width, height: this.height, selects, groundReflector: null });
      this.ssr.thickness = 0.02;
      this.ssr.maxDistance = 400;
      this.ssr.opacity = 0.6;
      c.addPass(this.ssr);
    } else c.addPass(this.depthPass);
    if (this.gfx.ssao && !this.gfx.ssr) {
      this.gtao = new GTAOPass(this.scene, this.camera, this.width, this.height);
      this.gtao.blendIntensity = 0.8;
      this.gtao.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.5, thickness: 2, scale: 1 });
      c.addPass(this.gtao);
    }
    if (this.gfx.clouds) {
      if (!this.clouds) {
        const steps = { eco: 20, medium: 26, high: 32, ultra: 40, cinema: 48 }[this.gfx.preset];
        this.clouds = new VolumetricClouds({ enabled: true, coverage: this.wx.cloudCover, base: this.wx.cloudBase + this.ap.elevation * (this.ap.id === 'lflj' ? 0.3 : 1), thickness: 1400, resolution: this.gfx.cloudRes, steps });
      }
      this.clouds.settings.resolution = this.gfx.cloudRes;
      this.cloudPass = new CloudPass(this.clouds, this.camera, () => (this.ssr ? this.ssr.beautyRenderTarget.depthTexture : this.depthPass.depthTexture));
      c.addPass(this.cloudPass);
    }
    if (this.gfx.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.35, 0.6, 0.92);
      c.addPass(this.bloom);
    }
    c.addPass(new OutputPass());
    if (this.gfx.preset !== 'eco') c.addPass(new SMAAPass(this.width, this.height));
    this.resize(this.width, this.height);
  }

  applySettings(gfx: GraphicsSettings, wx: WeatherSettings): void {
    const shadowsChanged = gfx.shadows !== this.gfx.shadows || gfx.shadowCascades !== this.gfx.shadowCascades;
    const pipeChanged = gfx.ssr !== this.gfx.ssr || gfx.ssao !== this.gfx.ssao || gfx.bloom !== this.gfx.bloom || gfx.clouds !== this.gfx.clouds || gfx.cloudRes !== this.gfx.cloudRes || gfx.preset !== this.gfx.preset;
    this.gfx = gfx;
    const todChanged = Math.abs(wx.timeOfDay - this.wx.timeOfDay) > 0.01;
    this.wx = wx;
    this.camera.fov = gfx.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.shadowMap.enabled = gfx.shadows;
    if (shadowsChanged) this.setupSun();
    if (pipeChanged && this.clouds) { this.clouds.dispose(); this.clouds = null; }
    if (pipeChanged) this.buildPipeline();
    if (todChanged) this.setTimeOfDay(wx.timeOfDay);
    if (this.clouds) {
      this.clouds.settings.coverage = wx.cloudCover;
      this.clouds.settings.base = wx.cloudBase + (this.ap.id === 'lflj' ? 1300 : this.ap.elevation);
    }
  }

  /** Position du soleil, couleur, exposition, IBL et brouillard selon l'heure. */
  setTimeOfDay(h: number): void {
    const elevDeg = 64 * Math.sin((Math.PI * (h - 6.6)) / 13.6);
    const az = ((h - 6) / 14) * Math.PI; // est → ouest par le sud
    const el = (Math.max(-12, elevDeg) * Math.PI) / 180;
    this.sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const day = THREE.MathUtils.smoothstep(elevDeg, -6, 10);
    const golden = THREE.MathUtils.smoothstep(elevDeg, -2, 4) * (1 - THREE.MathUtils.smoothstep(elevDeg, 8, 22));
    const sunCol = new THREE.Color(1, 0.96, 0.9).lerp(new THREE.Color(1, 0.55, 0.25), golden);
    const intensity = 0.15 + 3.2 * day;
    if (this.csm) {
      this.csm.lightDirection.copy(this.sunDir).negate();
      for (const l of this.csm.lights) { l.intensity = intensity; l.color.copy(sunCol); }
    }
    if (this.sun) {
      this.sun.position.copy(this.sunDir).multiplyScalar(4000);
      this.sun.intensity = intensity;
      this.sun.color.copy(sunCol);
    }
    this.hemi.intensity = 0.08 + 0.45 * day;
    this.hemi.color.setRGB(0.6 + 0.15 * day, 0.7 + 0.1 * day, 0.95);
    this.renderer.toneMappingExposure = 0.35 + 0.35 * day;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setRGB(0.04 + 0.66 * day, 0.05 + 0.73 * day, 0.08 + 0.78 * day).lerp(new THREE.Color(0.95, 0.6, 0.4), golden * 0.5);
    if (this.airport.water) (this.airport.water.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(this.sunDir);
    if (this.clouds) {
      this.clouds.sunDir.copy(this.sunDir);
      this.clouds.sunColor.copy(sunCol).multiplyScalar(0.3 + 0.7 * day);
      this.clouds.ambient.setRGB(0.05 + 0.5 * day, 0.06 + 0.56 * day, 0.1 + 0.62 * day);
    }
    // IBL dynamique depuis le ciel
    const skyScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(1000);
    Object.assign(skyCopy.material.uniforms, THREE.UniformsUtils.clone(this.sky.material.uniforms));
    skyScene.add(skyCopy);
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(skyScene, 0, 0.1, 2000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.25 + 0.75 * day;
    // feux plus visibles la nuit
    document.documentElement.style.setProperty('--glass-alpha', String(0.06 + 0.08 * day));
    // balisage : discret le jour, éclatant la nuit
    this.airport.lights.setIntensity(0.5 + 2.2 * (1 - day));
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    const pr = Math.min(this.gfx.maxPixelRatio, window.devicePixelRatio || 1) * this.gfx.renderScale * this.dynScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.clouds?.setSize(Math.round(w * pr), Math.round(h * pr));
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.csm?.updateFrustums();
  }

  setMode(m: CameraMode): void {
    this.mode = m;
    this.cockpit.group.visible = m === 'cockpit';
    this.orbit.enabled = m === 'orbit' || m === 'free';
    this.camera.near = m === 'cockpit' ? 0.05 : 0.3;
    this.camera.updateProjectionMatrix();
    this.csm?.updateFrustums();
    if (m === 'orbit' || m === 'free') {
      this.orbit.target.copy(this.aircraft.position);
      this.camera.position.copy(this.aircraft.position).add(_v.set(this.spec.length * 1.2, this.spec.length * 0.4, this.spec.length * 1.3));
    }
    if (m === 'flyby') this.flybyT = -1;
  }

  /** Mise à jour depuis l'état interpolé (layout O). */
  update(s: Float64Array, dt: number): void {
    this.t += dt;
    const a = this.aircraft;
    a.position.set(s[O.PX], s[O.PY], s[O.PZ]);
    a.quaternion.set(s[O.QX], s[O.QY], s[O.QZ], s[O.QW]);
    this.animator.update(s, dt);
    if (this.mode === 'cockpit') this.cockpit.update(s, dt);
    if (this.carrier) {
      const g = this.carrier.group;
      g.position.set(s[O.CARRIER_X], s[O.CARRIER_HEAVE], s[O.CARRIER_Z]);
      g.rotation.set(s[O.CARRIER_ROLL], Math.PI / 2 - s[O.CARRIER_HDG], s[O.CARRIER_PITCH], 'YZX');
      // point d'accrochage de la crosse (repère navire) pour tendre le câble
      let hookLocal: THREE.Vector3 | null = null;
      if (s[O.WIRE] > 0 && this.hookNode) {
        hookLocal = this.hookNode.localToWorld(this.hookTip.set(-1.8, 0, 0));
        g.updateMatrixWorld();
        g.worldToLocal(hookLocal);
        hookLocal.y = Math.max(hookLocal.y, (this.ap.carrier?.deckHeight ?? 0) + 0.1);
      }
      this.carrier.update(dt, s, hookLocal);
      // FLOLS : position de la boule calculée depuis l'œil du pilote
      const ref = approachRef(this.ap, s[O.SIM_TIME]);
      this.carrier.setBall(flolsBall(ref, this.eyeWorld.x, this.eyeWorld.y, this.eyeWorld.z), true);
    }
    this.updateCamera(s, dt);
    this.airport.update(this.eyeWorld, this.t, dt);
    if (this.clouds) {
      _wind.set(s[O.WIND_X], 0, s[O.WIND_Z]);
      this.clouds.update(dt, _wind);
    }
    if (this.csm) this.csm.update();
    else if (this.sun) {
      this.sun.position.copy(a.position).addScaledVector(this.sunDir, 3000);
      this.sun.target.position.copy(a.position);
    }
  }

  private updateCamera(s: Float64Array, dt: number): void {
    const a = this.aircraft;
    const cam = this.camera;
    const L = Math.max(8, this.spec.length);
    switch (this.mode) {
      case 'cockpit': {
        // inertie de la tête sous facteur de charge (G-force head movement)
        _v.set(-s[O.NX] * 0.012, -(s[O.NZ] - 1) * 0.018, -s[O.NY] * 0.02);
        this.headOffset.lerp(_v, Math.min(1, dt * 6));
        _v2.copy(this.cockpit.eye).add(this.headOffset);
        cam.position.copy(_v2).applyQuaternion(a.quaternion).add(a.position);
        // regard vers l'avant (+X corps), légère plongée vers la planche
        _q.setFromAxisAngle(_v.set(0, 1, 0), -Math.PI / 2);
        cam.quaternion.copy(a.quaternion).multiply(_q);
        _q.setFromAxisAngle(_v.set(1, 0, 0), -0.08);
        cam.quaternion.multiply(_q);
        break;
      }
      case 'chase': {
        // derrière et au-dessus, suiveur amorti (repère horizon : cap seulement)
        const hdg = s[O.HEADING];
        _v.set(-Math.sin(hdg) * L * 2.1, L * 0.45, Math.cos(hdg) * L * 2.1).add(a.position);
        if (this.chasePos.lengthSq() === 0) this.chasePos.copy(_v);
        this.chasePos.lerp(_v, Math.min(1, dt * 4));
        cam.position.copy(this.chasePos);
        cam.lookAt(_v2.copy(a.position).add(_v.set(0, L * 0.1, 0)));
        break;
      }
      case 'tower': {
        const r = this.ap.runways[0];
        if (r) cam.position.set(r.thrX + 300, r.profile[0].h + 45, r.thrZ - 400);
        else cam.position.set(s[O.CARRIER_X] + 60, s[O.CARRIER_HEAVE] + 45, s[O.CARRIER_Z] + 40);
        cam.lookAt(a.position);
        cam.fov = THREE.MathUtils.clamp(2 * Math.atan((L * 1.6) / cam.position.distanceTo(a.position)) * (180 / Math.PI), 2, this.gfx.fov);
        cam.updateProjectionMatrix();
        break;
      }
      case 'flyby': {
        if (this.flybyT < 0 || this.t - this.flybyT > 9) {
          this.flybyT = this.t;
          _v.set(s[O.VX], 0, s[O.VZ]);
          const sp = _v.length();
          _v.normalize().multiplyScalar(Math.max(60, sp * 5));
          this.flybyPos.copy(a.position).add(_v).add(_v2.set(_v.z * 0.15, 8 + L * 0.3, -_v.x * 0.15));
        }
        cam.position.copy(this.flybyPos);
        cam.lookAt(a.position);
        break;
      }
      case 'orbit':
      case 'free': {
        _v.copy(a.position).sub(this.orbit.target);
        this.orbit.target.add(_v);
        cam.position.add(_v);
        this.orbit.update();
        break;
      }
    }
    if (this.mode !== 'tower' && cam.fov !== this.gfx.fov) { cam.fov = this.gfx.fov; cam.updateProjectionMatrix(); }
    // œil du pilote (PAPI/FLOLS) toujours depuis le cockpit
    this.eyeWorld.copy(this.cockpit.eye).applyQuaternion(a.quaternion).add(a.position);
  }

  render(now: number, frameMs: number): void {
    // DRS : ajustement de l'échelle de résolution vers la cible FPS
    this.frameTimes[this.ftIdx++ % this.frameTimes.length] = frameMs;
    if (this.gfx.drs && this.ftIdx % 15 === 0) {
      let avg = 0;
      for (const v of this.frameTimes) avg += v;
      avg /= this.frameTimes.length;
      const target = 1000 / this.gfx.targetFps;
      const prev = this.dynScale;
      if (avg > target * 1.08) this.dynScale = Math.max(0.5, this.dynScale * (avg > target * 1.5 ? 0.8 : 0.9));
      else if (avg < target * 0.8) this.dynScale = Math.min(1, this.dynScale * 1.04);
      if (Math.abs(prev - this.dynScale) > 1e-3) this.resize(this.width, this.height);
    }
    this.metrics.m.renderScale = this.renderer.getPixelRatio();
    this.renderer.info.reset();
    this.metrics.beginGpu();
    this.composer.render();
    this.metrics.endGpu();
    this.metrics.frame(this.renderer, now);
  }

  dispose(): void {
    this.csm?.dispose();
    this.composer.dispose();
    this.clouds?.dispose();
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.orbit.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    this.renderer.dispose();
  }
}
