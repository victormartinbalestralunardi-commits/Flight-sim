/** Vue 3D de l'Atelier : modèle procédural PBR (ou .glb importé) + path tracing progressif. */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AircraftId } from '../aircraft/types';
import { buildSpec, type GeometryMods } from '../aircraft/mods';
import { buildAircraftModel } from '../aircraft/procedural';
import { AircraftAnimator } from '../aircraft/animator';
import { loadGltfAircraft } from '../aircraft/gltf';
import { computeMac } from '../aircraft/types';
import { ProgressivePathTracer } from '../raytracing/pathTracer';
import { installGlErrorHandler } from '../raytracing/glDebug';
import { O, OUT_SIZE, LIGHT } from '../physics/layout';
import { useStore } from './store';
import { GlassButton, GlassPanel } from './glass';

export default function HangarViewport({ aircraft, mods, xcgPct }: { aircraft: AircraftId; mods: GeometryMods; xcgPct: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    pt: ProgressivePathTracer; holder: THREE.Group; anim: AircraftAnimator | null; state: Float64Array;
  } | null>(null);
  const gfx = useStore((s) => s.settings.graphics);
  const [samples, setSamples] = useState(0);
  const [ptMsg, setPtMsg] = useState<string | null>(null);
  const [glbInfo, setGlbInfo] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current!, antialias: true, preserveDrawingBuffer: false });
    installGlErrorHandler(renderer);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.background = new THREE.Color(0x1c222c);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshPhysicalMaterial({ color: 0x3a3f47, roughness: 0.35, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'hangar_floor';
    scene.add(floor);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(40, 80, 30);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);
    const holder = new THREE.Group();
    scene.add(holder);
    const pt = new ProgressivePathTracer(renderer);
    const state = new Float64Array(OUT_SIZE);
    state[O.GEAR] = 1; state[O.LIGHTS] = LIGHT.NAV;
    ctxRef.current = { renderer, scene, camera, controls, pt, holder, anim: null, state };
    controls.addEventListener('change', () => pt.cameraMoved());
    const onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      pt.cameraMoved();
    };
    onResize();
    window.addEventListener('resize', onResize);
    let raf = 0, frame = 0, last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      controls.update();
      const c = ctxRef.current!;
      if (c.anim && demoRef.current) {
        const t = now / 1000;
        c.state[O.ELEV] = Math.sin(t * 1.3) * 0.8; c.state[O.AIL] = Math.sin(t * 0.9) * 0.8; c.state[O.RUD] = Math.sin(t * 0.7) * 0.8;
        c.state[O.FLAPS] = 0.5 + 0.5 * Math.sin(t * 0.4); c.state[O.PROP_RPM] = 2400; c.state[O.N1] = 0.5; c.state[O.AB] = 0.5 + 0.5 * Math.sin(t);
        c.state[O.THROTTLE] = 1; c.state[O.LIGHTS] = LIGHT.NAV | LIGHT.STROBE | LIGHT.BEACON | LIGHT.LANDING;
        c.state[O.NOZZLE_ANGLE] = (0.5 + 0.5 * Math.sin(t * 0.5)) * 1.6; c.state[O.STOVL] = 1; c.state[O.HOOK] = 1;
        c.anim.update(c.state, dt);
      }
      const usedPt = !demoRef.current && c.pt.render();
      if (!usedPt) renderer.render(scene, camera);
      if (++frame % 20 === 0) setSamples(c.pt.samples);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      pt.dispose();
      controls.dispose();
      renderer.dispose();
      pmrem.dispose();
    };
  }, []);

  const demoRef = useRef(false);
  useEffect(() => { demoRef.current = demo; if (!demo) ctxRef.current?.pt.cameraMoved(); }, [demo]);

  const install = (obj: THREE.Object3D, spec: ReturnType<typeof buildSpec>) => {
    const c = ctxRef.current;
    if (!c) return;
    c.holder.clear();
    // poser l'avion sur ses roues
    const gy = spec.gear[1].pos[1];
    obj.position.y = -gy;
    c.holder.add(obj);
    c.anim = new AircraftAnimator(obj, spec);
    c.state.fill(0);
    c.state[O.GEAR] = 1; c.state[O.LIGHTS] = LIGHT.NAV; c.state[O.ON_GROUND] = 7;
    c.anim.update(c.state, 0);
    const size = Math.max(spec.span, spec.length);
    c.controls.target.set(0, size * 0.08, 0);
    c.camera.position.set(size * 1.05, size * 0.5, size * 1.2);
    c.camera.near = size * 0.01;
    c.camera.far = size * 60;
    c.camera.updateProjectionMatrix();
    c.pt.enabled = gfx.pathTracing;
    c.pt.maxSamples = gfx.ptMaxSamples;
    setPtMsg(gfx.pathTracing ? 'Construction du BVH…' : null);
    void c.pt.setScene(c.scene, c.camera, gfx.ptBounces).then(() => setPtMsg(c.pt.failed ? `Path tracing indisponible : ${c.pt.failed}` : null));
  };

  useEffect(() => {
    const spec = buildSpec(aircraft, mods);
    const mac = computeMac(spec.surfaces[0]);
    const xcg = mac.xLE - (xcgPct / 100) * mac.mac;
    const m = buildAircraftModel(spec, xcg);
    m.object.position.x = 0;
    install(m.object, spec);
    setGlbInfo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraft, mods, gfx.pathTracing, gfx.ptBounces, gfx.ptMaxSamples]);

  const onGlb = async (file: File) => {
    const spec = buildSpec(aircraft, mods);
    const mac = computeMac(spec.surfaces[0]);
    const xcg = mac.xLE - (xcgPct / 100) * mac.mac;
    const url = URL.createObjectURL(file);
    try {
      const r = await loadGltfAircraft(url, xcg);
      install(r.object, spec);
      setGlbInfo(`${file.name} : ${r.found.length} nœuds animables reconnus${r.missing.length ? ` (absents : ${r.missing.join(', ')})` : ''}`);
    } catch (e) {
      setGlbInfo(`Échec du chargement : ${e instanceof Error ? e.message : e}`);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3">
        <GlassPanel className="flex items-center gap-3 px-4 py-2 text-[12px]" animate={false}>
          <span className="text-white/60">{gfx.pathTracing ? (ptMsg ?? `Path tracing : ${samples} / ${gfx.ptMaxSamples} échantillons`) : 'Rendu rasterisé (path tracing désactivé)'}</span>
          <GlassButton size="sm" active={demo} onClick={() => setDemo(!demo)}>{demo ? 'Arrêter la démo' : 'Démo gouvernes & feux'}</GlassButton>
          <label className="glass-btn cursor-pointer rounded-xl px-3 py-1.5 text-xs font-medium">
            Importer .glb
            <input type="file" accept=".glb,.gltf" className="hidden" onChange={(e) => e.target.files?.[0] && onGlb(e.target.files[0])} />
          </label>
        </GlassPanel>
      </div>
      {glbInfo && <div className="absolute bottom-20 left-1/2 max-w-[600px] -translate-x-1/2 text-center text-[11px] text-white/70">{glbInfo}</div>}
    </>
  );
}
