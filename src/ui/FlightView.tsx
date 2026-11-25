/** Vue de vol : orchestration worker physique ⇄ entrées ⇄ rendu ⇄ instruments ⇄ audio ⇄ boîte noire. */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { buildSpec } from '../aircraft/mods';
import { computeMac } from '../aircraft/types';
import { getAirport, approachRef, ilsDeviation, flolsBall, type IlsDeviation } from '../airports/airports';
import { PhysicsBridge } from '../physics/bridge';
import { O, OUT_SIZE, I, LIGHT } from '../physics/layout';
import type { SimConfig } from '../physics/protocol';
import { InputManager } from '../controls/input';
import { keyLabel, keyboardLayout, type Action } from '../controls/bindings';
import { FlightScene, CAMERA_MODES, type CameraMode } from '../world/FlightScene';
import { drawPFD, drawND, drawEICAS, drawAnalogPanel, buildRelief, type MapContext } from '../cockpit/instruments';
import { drawHUD } from '../cockpit/hud';
import { coldDarkChecklist, nextStep } from '../cockpit/checklist';
import type { CockpitAction } from '../cockpit/Cockpit3D';
import { FlightAudio } from '../audio/FlightAudio';
import { BlackBox, recField, REC_INDEX, REC_STRIDE, type FlightRecord } from '../replay/blackbox';
import { glDiagnostics, type FrameMetrics } from '../raytracing/glDebug';
import { ProgressivePathTracer } from '../raytracing/pathTracer';
import { DEG, FT, KT } from '../physics/math';
import { store, useStore } from './store';
import { Badge, GlassButton, GlassPanel, GlassToggle, SectionTitle, Stat } from './glass';
import { LineChart } from './charts';

const CAM_LABEL: Record<CameraMode, string> = { chase: 'Poursuite', cockpit: 'Cockpit', orbit: 'Orbite', tower: 'Tour', flyby: 'Passage', free: 'Libre' };
const GPWS_LABEL: Record<number, string> = { 1: 'SINK RATE', 2: 'PULL UP', 3: 'TOO LOW GEAR', 5: 'BANK ANGLE', 7: 'STALL' };

export default function FlightView() {
  const st = store.get();
  const settings = useStore((s) => s.settings);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const pfdRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FlightScene | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const bridgeRef = useRef<PhysicsBridge | null>(null);
  const audioRef = useRef<FlightAudio | null>(null);
  const boxRef = useRef<BlackBox | null>(null);
  const stateRef = useRef(new Float64Array(OUT_SIZE));
  const ptRef = useRef<ProgressivePathTracer | null>(null);
  const [cam, setCam] = useState<CameraMode>('chase');
  const [paused, setPaused] = useState(false);
  const [showFail, setShowFail] = useState(false);
  const [showDebug, setShowDebug] = useState(settings.graphics.showMetrics);
  const [showInstr, setShowInstr] = useState(true);
  const [showHelp, setShowHelp] = useState(true);
  const [photo, setPhoto] = useState(false);
  const [crash, setCrash] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<FrameMetrics | null>(null);
  const [hudState, setHudState] = useState(new Float64Array(OUT_SIZE));
  const [record, setRecord] = useState<FlightRecord | null>(null);
  const [replayT, setReplayT] = useState(0);
  const [replayPlay, setReplayPlay] = useState(true);
  const [mode, setMode] = useState<'sim' | 'replay'>('sim');
  const [ready, setReady] = useState(false);
  const [glErrors, setGlErrors] = useState(glDiagnostics.errors);
  const spec = useRef(buildSpec(st.aircraft, st.mods)).current;
  const ap = useRef(getAirport(st.airport)).current;
  const checklist = useRef(st.startMode === 'cold' ? coldDarkChecklist(spec) : []).current;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const replayRef = useRef({ t: 0, play: true, speed: 1 });

  useEffect(() => glDiagnostics.subscribe(() => setGlErrors([...glDiagnostics.errors])), []);

  useEffect(() => {
    const s = store.get();
    const mac = computeMac(spec.surfaces[0]);
    const xcg = mac.xLE - (s.loadout.xcgPct / 100) * mac.mac;
    const wx = s.settings.weather;
    const config: SimConfig = {
      aircraft: s.aircraft, mods: s.mods, xcgPct: s.loadout.xcgPct, fuelKg: s.loadout.fuelKg, payloadKg: s.loadout.payloadKg,
      airport: s.airport, startMode: s.startMode, wind: { fromDeg: wx.windFrom, speed: wx.windSpeedKt * KT, turbulence: wx.turbulence },
      deltaIsa: wx.deltaIsa, seaState: wx.seaState,
    };
    const bridge = new PhysicsBridge(config);
    bridgeRef.current = bridge;
    const input = new InputManager(spec, s.settings.controls, s.startMode === 'cold');
    inputRef.current = input;
    const scene = new FlightScene(canvasRef.current!, spec, ap, xcg, s.settings.graphics, wx);
    sceneRef.current = scene;
    const audio = new FlightAudio(spec);
    audioRef.current = audio;
    const box = new BlackBox(s.aircraft, s.airport);
    boxRef.current = box;
    const relief = buildRelief(ap, Math.min(ap.radius, 25000));
    const trail = new Float32Array(2 * 2000);
    const mapCtx: MapContext = { ap, relief, radius: Math.min(ap.radius, 25000), trail, trailLen: 0 };
    const miniMap = document.createElement('canvas');
    miniMap.width = miniMap.height = 280;
    const miniCtx = miniMap.getContext('2d')!;
    const ils: IlsDeviation = { loc: 0, gs: 0, locDeg: 0, gsDeg: 0, distance: 0, valid: false };
    const refScratch = approachRef(ap, 0);

    bridge.onError = (m) => setToast(`Erreur physique : ${m.split('\n')[0]}`);
    bridge.onEvents = (evs) => {
      for (const e of evs) {
        if (e.type === 'touchdown') { audio.burst('thump'); setToast(`Toucher : ${Math.round((-e.vs / FT) * 60)} ft/min`); }
        if (e.type === 'wire') { audio.burst('wire'); setToast(`Brin n°${e.wire} accroché !`); }
        if (e.type === 'catapult') setToast('Catapultage !');
        if (e.type === 'crash') { audio.burst('crash'); box.crashed = e.reason; setCrash(e.reason); }
      }
    };
    void bridge.ready.then((info) => {
      const p = input.pilot;
      p.throttle = info.initialThrottle;
      if (s.startMode === 'final') {
        p.flapIndex = spec.perf.flapDetents.length - 1;
        p.gearDown = true;
        p.hook = spec.hasHook && ap.id === 'cvn';
        p.lights |= LIGHT.LANDING;
        p.spoilerArm = spec.category === 'airliner' || spec.id === 'g8000';
        p.apAthr = false;
      }
      if (s.startMode === 'runway' && ap.id === 'cvn' && !spec.stovl) setToast('Catapulte attelée : plein gaz (PC), puis T pour le lancement');
      if (s.startMode === 'runway' && ap.id === 'cvn' && spec.stovl) { p.stovl = true; p.nozzle = 0.45; setToast('Décollage court STOVL : tuyère à 45°, plein gaz'); }
      if (s.startMode === 'cold') setToast('Cold & Dark : suivez la check-list (vue cockpit recommandée)');
      p.hdgTarget = Math.round(ap.runways[0]?.heading ?? 0);
      p.altTarget = Math.round((ap.elevation + 900) / FT / 100) * 100;
      setReady(true);
    });

    // cockpit : survol (info-bulle) et clics
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let dragThrottle = false;
    let lastY = 0;
    const pick = (ev: PointerEvent): THREE.Intersection | null => {
      if (scene.mode !== 'cockpit') return null;
      const r = canvasRef.current!.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, scene.camera);
      return ray.intersectObjects(scene.cockpit.clickables, false)[0] ?? null;
    };
    const doAction = (a: CockpitAction) => {
      const p = input.pilot;
      audio.burst('click');
      const map: Partial<Record<CockpitAction, () => void>> = {
        gear: () => input.trigger('gearToggle'), flapsUp: () => input.trigger('flapsUp'), flapsDown: () => input.trigger('flapsDown'),
        speedbrake: () => input.trigger('speedbrakeToggle'), parking: () => input.trigger('parkingBrake'), hook: () => input.trigger('hookToggle'),
        lightNav: () => { p.lights ^= LIGHT.NAV; }, lightStrobe: () => { p.lights ^= LIGHT.STROBE; }, lightBeacon: () => { p.lights ^= LIGHT.BEACON; },
        lightLanding: () => { p.lights ^= LIGHT.LANDING; }, apHdg: () => { p.apHdg = !p.apHdg; }, apAlt: () => { p.apAlt = !p.apAlt; }, apAthr: () => { p.apAthr = !p.apAthr; },
        fbwLaw: () => input.trigger('fbwToggle'), battery: () => { p.battery = !p.battery; }, apu: () => { p.apu = !p.apu; }, pumps: () => { p.pumps = !p.pumps; },
        avionics: () => { p.avionics = !p.avionics; }, stovl: () => input.trigger('stovlToggle'), spoilerArm: () => input.trigger('spoilerArm'),
      };
      if (a.startsWith('start')) { const i = +a.slice(5); p.engineStart |= 1 << i; setTimeout(() => { p.engineStart &= ~(1 << i); }, 400); }
      else map[a]?.();
    };
    const onDown = (ev: PointerEvent) => {
      audio.start(store.get().settings.audio);
      const hit = pick(ev);
      if (!hit) return;
      const a = hit.object.userData.action as CockpitAction;
      if (a === 'throttle') { dragThrottle = true; lastY = ev.clientY; canvasRef.current!.setPointerCapture(ev.pointerId); audio.burst('click'); }
      else doAction(a);
    };
    const onMove = (ev: PointerEvent) => {
      if (dragThrottle) {
        input.pilot.throttle = Math.min(1, Math.max(0, input.pilot.throttle - (ev.clientY - lastY) * 0.004));
        lastY = ev.clientY;
        return;
      }
      const hit = pick(ev);
      const tip = tipRef.current!;
      if (hit) {
        tip.style.display = 'block';
        tip.style.left = `${ev.clientX + 14}px`;
        tip.style.top = `${ev.clientY + 10}px`;
        tip.textContent = hit.object.userData.tip as string;
        canvasRef.current!.style.cursor = 'pointer';
      } else { tip.style.display = 'none'; canvasRef.current!.style.cursor = ''; }
    };
    const onUp = () => { dragThrottle = false; };
    const cv = canvasRef.current!;
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);

    input.onAction = (a: Action) => {
      audio.start(store.get().settings.audio);
      if (a === 'cameraNext') {
        const i = CAMERA_MODES.indexOf(scene.mode);
        const m = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
        scene.setMode(m); setCam(m);
      } else if (a === 'cockpitToggle') {
        const m: CameraMode = scene.mode === 'cockpit' ? 'chase' : 'cockpit';
        scene.setMode(m); setCam(m);
      } else if (a === 'pause') setPaused((p) => !p);
      else if (a === 'failuresPanel') setShowFail((v) => !v);
      else if (a === 'debugPanel') setShowDebug((v) => !v);
      else if (a === 'photoMode') setPhoto((v) => !v);
      else if (['gearToggle', 'flapsDown', 'flapsUp', 'speedbrakeToggle', 'parkingBrake', 'hookToggle', 'fbwToggle', 'autopilot', 'landingLights', 'stovlToggle', 'spoilerArm'].includes(a)) audio.burst('click');
    };
    input.attach(cv);

    const onResize = () => scene.resize(window.innerWidth, window.innerHeight);
    onResize();
    window.addEventListener('resize', onResize);

    let raf = 0;
    let last = performance.now();
    let instrAcc = 0, uiAcc = 0, trailAcc = 0;
    let hudDirty = false;
    const hudCtx = hudRef.current!.getContext('2d')!;
    const rq = new THREE.Quaternion();
    const re = new THREE.Euler();
    const s0 = stateRef.current;
    const loop = () => {
      const nowP = performance.now();
      const dt = Math.min(0.1, (nowP - last) / 1000);
      const frameMs = nowP - last;
      last = nowP;
      if (modeRef.current === 'sim') {
        input.update(dt);
        input.write(bridge.input);
        input.pilot.catapult = false;
        bridge.markInput();
        bridge.flushInput();
        if (!bridge.sample(performance.timeOrigin + nowP)) { raf = requestAnimationFrame(loop); return; }
        s0.set(bridge.state);
        box.record(bridge.latest, dt);
      } else {
        // replay : relecture de la boîte noire interpolée
        const rec = recordRef.current;
        if (rec && rec.n > 1) {
          const rp = replayRef.current;
          if (rp.play) rp.t = Math.min(rec.n - 1.001, rp.t + dt * rec.hz * rp.speed);
          const i0 = Math.floor(rp.t), f = rp.t - i0;
          const g = (k: keyof typeof REC_INDEX) => recField(rec, i0, k) + (recField(rec, i0 + 1, k) - recField(rec, i0, k)) * f;
          s0[O.PX] = g('x'); s0[O.PY] = g('y'); s0[O.PZ] = g('z');
          s0[O.QX] = g('qx'); s0[O.QY] = g('qy'); s0[O.QZ] = g('qz'); s0[O.QW] = g('qw');
          s0[O.ELEV] = g('elev'); s0[O.AIL] = g('ail'); s0[O.RUD] = g('rud'); s0[O.GEAR] = g('gear'); s0[O.FLAPS] = g('flaps');
          s0[O.ALPHA] = g('alpha'); s0[O.NZ] = g('nz'); s0[O.VS] = g('vs'); s0[O.TAS] = g('tas'); s0[O.CAS] = g('tas'); s0[O.AGL] = g('agl');
          s0[O.SIM_TIME] = g('t'); s0[O.LIGHTS] = LIGHT.NAV | LIGHT.STROBE | LIGHT.BEACON; s0[O.N1] = 0.6; s0[O.PROP_RPM] = 2200;
          rq.set(s0[O.QX], s0[O.QY], s0[O.QZ], s0[O.QW]);
          const e = re.setFromQuaternion(rq, 'YZX');
          s0[O.HEADING] = Math.PI / 2 - e.y; s0[O.PITCH] = e.z; s0[O.BANK] = e.x;
          if (++uiAcc % 6 === 0) setReplayT(rp.t);
        }
      }
      scene.update(s0, dt);
      // instruments du cockpit (30 Hz)
      instrAcc += dt;
      const eye = scene.eyeWorld;
      approachRef(ap, s0[O.SIM_TIME], 0, refScratch);
      ilsDeviation(refScratch, eye.x, eye.y, eye.z, ils);
      const avionicsOn = s0[O.AVIONICS] > 0.5 || modeRef.current === 'replay';
      if (instrAcc > 1 / 30) {
        instrAcc = 0;
        trailAcc++;
        if (trailAcc % 15 === 0) {
          if (mapCtx.trailLen >= 2000) { trail.copyWithin(0, 2); mapCtx.trailLen--; }
          trail[2 * mapCtx.trailLen] = s0[O.PX]; trail[2 * mapCtx.trailLen + 1] = s0[O.PZ]; mapCtx.trailLen++;
        }
        if (scene.mode === 'cockpit') {
          for (const d of scene.cockpit.displays) {
            const { ctx, canvas } = d;
            if (!avionicsOn) { ctx.fillStyle = '#020304'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
            else if (d.name === 'pfd') drawPFD(ctx, canvas.width, canvas.height, s0, spec, ils);
            else if (d.name === 'nd') drawND(ctx, canvas.width, canvas.height, s0, mapCtx, ap.id === 'lflj' || ap.id === 'tffj' ? 5 : 10);
            else if (d.name === 'eicas') drawEICAS(ctx, canvas.width, canvas.height, s0, spec);
            else drawAnalogPanel(ctx, canvas.width, canvas.height, s0, ils);
            d.texture.needsUpdate = true;
          }
          // surbrillance de l'étape de check-list en cours
          const k = nextStep(checklist, bridge.latest);
          scene.cockpit.setHighlight(k < checklist.length ? checklist[k].action : null);
        }
        if (pfdRef.current && showInstrRef.current && scene.mode !== 'cockpit') {
          const c = pfdRef.current.getContext('2d')!;
          if (spec.category === 'ga') drawAnalogPanel(c, pfdRef.current.width, pfdRef.current.height, s0, ils);
          else drawPFD(c, pfdRef.current.width, pfdRef.current.height, s0, spec, ils);
        }
        if (spec.category === 'fighter') drawND(miniCtx, 280, 280, s0, mapCtx, 5);
      }
      // HUD (cockpit des avions équipés, ou HUD plein écran en vue extérieure pour les chasseurs)
      const hc = hudRef.current!;
      if (hc.width !== window.innerWidth || hc.height !== window.innerHeight) { hc.width = window.innerWidth; hc.height = window.innerHeight; }
      const hudOn = avionicsOn && scene.mode === 'cockpit' && scene.cockpit.hudRect.present;
      if (hudOn || hudDirty) { hudCtx.clearRect(0, 0, hc.width, hc.height); hudDirty = false; }
      if (hudOn) {
        hudDirty = true;
        const w = hc.width, h = hc.height;
        const clip = { x: w * 0.3, y: h * 0.12, w: w * 0.4, h: h * 0.52 };
        const flols = ap.carrier ? flolsBall(refScratch, eye.x, eye.y, eye.z) : null;
        drawHUD(hudCtx, w, h, s0, scene.camera, spec, clip, { ils, flols, gpwsText: GPWS_LABEL[s0[O.GPWS] | 0] ?? null, miniMap: miniMap });
      }
      scene.render(nowP, frameMs);
      if (ptRef.current) ptRef.current.render();
      audio.update(s0, dt, scene.mode === 'cockpit', scene.camera.position.distanceTo(scene.aircraft.position));
      if (++uiAcc % 10 === 0) {
        setHudState(Float64Array.from(s0));
        setMetrics({ ...scene.metrics.m, physicsMode: bridge.mode });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      input.detach();
      bridge.dispose();
      audio.dispose();
      ptRef.current?.dispose();
      scene.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showInstrRef = useRef(showInstr);
  showInstrRef.current = showInstr;
  const recordRef = useRef<FlightRecord | null>(null);
  recordRef.current = record;

  // paramètres en direct
  useEffect(() => {
    sceneRef.current?.applySettings(settings.graphics, settings.weather);
    inputRef.current?.setSettings(settings.controls);
    audioRef.current?.applySettings(settings.audio);
  }, [settings]);
  // pause
  useEffect(() => {
    const b = bridgeRef.current;
    if (!b) return;
    b.input[I.PAUSED] = paused || photo || mode === 'replay' ? 1 : 0;
    b.markInput();
  }, [paused, photo, mode]);
  // mode photo : path tracing de la scène figée
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    if (photo) {
      const pt = new ProgressivePathTracer(sc.renderer);
      pt.maxSamples = settings.graphics.ptMaxSamples;
      void pt.setScene(sc.scene, sc.camera, settings.graphics.ptBounces).then(() => { if (pt.failed) setToast(`Path tracing indisponible : ${pt.failed}`); });
      ptRef.current = pt;
      setToast('Mode photo : path tracing progressif (F9 pour quitter)');
    } else {
      ptRef.current?.dispose();
      ptRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const endFlight = () => {
    const rec = boxRef.current?.finish() ?? null;
    if (rec) {
      setRecord(rec);
      store.set({ lastFlight: rec });
      replayRef.current = { t: 0, play: true, speed: 1 };
      setMode('replay');
      setPaused(false);
      setCrash(null);
      sceneRef.current?.setMode('free');
      setCam('free');
    }
  };

  const p = inputRef.current?.pilot;
  const s = hudState;
  const k = nextStep(checklist, s);

  return (
    <div className="relative h-full w-full select-none overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={hudRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div ref={tipRef} className="pointer-events-none fixed z-40 hidden rounded-lg bg-black/75 px-2 py-1 text-[11px] text-white" />
      {/* voile noir / rouge */}
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle, rgba(0,0,0,${s[O.BLACKOUT] * 0.6}) 0%, rgba(0,0,0,${Math.min(1, s[O.BLACKOUT] * 1.3)}) 70%)` }} />
      <div className="pointer-events-none absolute inset-0" style={{ background: `rgba(160,0,0,${s[O.REDOUT] * 0.7})` }} />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-white/70">Initialisation du worker physique (VLM + trim)…</div>}

      {/* barre supérieure */}
      <div className="absolute left-0 right-0 top-0 flex items-start justify-between p-3">
        <GlassPanel className="flex items-center gap-3 px-4 py-2" animate={false}>
          <span className="text-[13px] font-semibold">{spec.name}</span>
          <Badge tone="info">{ap.icao}</Badge>
          <Badge>{CAM_LABEL[cam]}</Badge>
          {mode === 'replay' && <Badge tone="warn">REPLAY</Badge>}
          {s[O.FCS_LAW] > 0 && spec.fcs === 'fbw' && <Badge tone="warn">{s[O.FCS_LAW] === 1 ? 'ALTERNATE LAW' : 'DIRECT LAW'}</Badge>}
          {s[O.WIND_SHEAR] > 0 && <Badge tone="bad">WINDSHEAR</Badge>}
        </GlassPanel>
        <GlassPanel className="flex gap-1.5 p-1.5" animate={false}>
          <GlassButton size="sm" onClick={() => { const m: CameraMode = cam === 'cockpit' ? 'chase' : 'cockpit'; sceneRef.current?.setMode(m); setCam(m); }}>{cam === 'cockpit' ? 'Vue ext.' : 'Cockpit'}</GlassButton>
          <GlassButton size="sm" onClick={() => { const i = CAMERA_MODES.indexOf(cam); const m = CAMERA_MODES[(i + 1) % CAMERA_MODES.length]; sceneRef.current?.setMode(m); setCam(m); }}>Caméra</GlassButton>
          <GlassButton size="sm" active={showInstr} onClick={() => setShowInstr(!showInstr)}>Instruments</GlassButton>
          <GlassButton size="sm" active={showHelp} onClick={() => setShowHelp(!showHelp)}>Commandes</GlassButton>
          <GlassButton size="sm" active={showFail} onClick={() => setShowFail(!showFail)}>Pannes</GlassButton>
          <GlassButton size="sm" active={showDebug} onClick={() => setShowDebug(!showDebug)}>Debug</GlassButton>
          <GlassButton size="sm" active={paused} onClick={() => setPaused(!paused)}>Pause</GlassButton>
        </GlassPanel>
      </div>

      {/* données de vol (vue extérieure) */}
      {mode === 'sim' && cam !== 'cockpit' && (
        <GlassPanel className="absolute bottom-3 right-3 grid grid-cols-4 gap-x-5 gap-y-2 px-5 py-3" animate={false}>
          <Stat small label="CAS" value={Math.round(s[O.CAS] / KT)} unit="kt" />
          <Stat small label="Alt" value={Math.round(s[O.ALT] / FT)} unit="ft" />
          <Stat small label="V/S" value={Math.round((s[O.VS] / FT) * 60)} unit="fpm" />
          <Stat small label="Cap" value={String(Math.round((s[O.HEADING] / DEG + 360) % 360)).padStart(3, '0')} />
          <Stat small label="Mach" value={s[O.MACH].toFixed(2)} />
          <Stat small label="α" value={(s[O.ALPHA] / DEG).toFixed(1)} unit="°" tone={s[O.STALL_WARN] ? 'bad' : 'default'} />
          <Stat small label="n" value={s[O.NZ].toFixed(2)} unit="g" />
          <Stat small label="Gaz" value={Math.round(s[O.THROTTLE] * 100)} unit="%" tone={s[O.AB] > 0.05 ? 'warn' : 'default'} />
          <Stat small label="Volets" value={Math.round(s[O.FLAPS] * spec.perf.flapMaxDeg)} unit="°" />
          <Stat small label="Train" value={s[O.GEAR] > 0.98 ? 'SORTI' : s[O.GEAR] < 0.02 ? 'RENTRÉ' : '…'} tone={s[O.GEAR] > 0.98 ? 'good' : 'warn'} />
          <Stat small label="Carburant" value={Math.round(s[O.FUEL])} unit="kg" />
          {spec.stovl ? <Stat small label="STOVL / tuyère" value={`${s[O.STOVL] > 0.5 ? 'ON' : 'OFF'} ${Math.round(s[O.NOZZLE_ANGLE] / DEG)}°`} tone={s[O.STOVL] > 0.5 ? 'warn' : 'default'} /> : <Stat small label="Frein parc" value={s[O.PARKING] > 0.5 ? 'SERRÉ' : '—'} />}
        </GlassPanel>
      )}
      {mode === 'sim' && cam !== 'cockpit' && showInstr && (
        <div className="absolute bottom-3 left-3 overflow-hidden rounded-2xl border border-white/20 shadow-glass">
          <canvas ref={pfdRef} width={spec.category === 'ga' ? 600 : 420} height={spec.category === 'ga' ? 300 : 340} style={{ width: spec.category === 'ga' ? 420 : 300, height: spec.category === 'ga' ? 210 : 243 }} />
        </div>
      )}
      {(GPWS_LABEL[s[O.GPWS] | 0]) && mode === 'sim' && (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded-xl bg-[#ff3b30]/85 px-4 py-1.5 text-lg font-bold tracking-wider">{GPWS_LABEL[s[O.GPWS] | 0]}</div>
      )}
      {toast && <div className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2"><GlassPanel className="px-4 py-2 text-[13px]">{toast}</GlassPanel></div>}

      {/* check-list Cold & Dark */}
      {checklist.length > 0 && mode === 'sim' && k < checklist.length && (
        <GlassPanel className="absolute left-3 top-20 w-[300px] p-4">
          <SectionTitle>Check-list « Cold & Dark »</SectionTitle>
          {checklist.map((c, i) => (
            <div key={c.id} className={`flex items-center gap-2 py-0.5 text-[12px] ${i === k ? 'font-semibold text-white' : c.done(s) ? 'text-[#5bf09a]' : 'text-white/45'}`}>
              <span>{c.done(s) ? '✓' : i === k ? '▶' : '○'}</span><span>{c.label}</span>
            </div>
          ))}
          <div className="mt-2 rounded-lg bg-[#0a84ff]/25 px-2 py-1 text-[11px]">{checklist[k].hint} — commande en surbrillance dans le cockpit.</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {cam !== 'cockpit' && <GlassButton size="sm" onClick={() => { sceneRef.current?.setMode('cockpit'); setCam('cockpit'); }}>Aller au cockpit</GlassButton>}
          </div>
        </GlassPanel>
      )}

      {/* aide-mémoire des commandes (touches réellement imprimées) */}
      {showHelp && mode === 'sim' && <KeyHelp onClose={() => setShowHelp(false)} stovl={!!spec.stovl} hook={spec.hasHook} carrier={ap.id === 'cvn'} />}

      {/* panneau des pannes */}
      {showFail && p && mode === 'sim' && (
        <GlassPanel className="absolute right-3 top-20 w-[300px] space-y-2 p-4">
          <SectionTitle>Simulateur de pannes</SectionTitle>
          {spec.engines.map((_, i) => (
            <GlassToggle key={i} label={`Extinction moteur ${i + 1}`} hint={spec.engines.length > 1 ? 'Poussée asymétrique' : undefined} checked={(p.failEngine & (1 << i)) !== 0} onChange={(v) => { p.failEngine = v ? p.failEngine | (1 << i) : p.failEngine & ~(1 << i); setHudState(Float64Array.from(s)); }} />
          ))}
          {spec.fcs === 'fbw' && (
            <>
              <GlassToggle label="Dégradation FBW : loi Alternate" checked={p.failFbw === 1} onChange={(v) => { p.failFbw = v ? 1 : 0; setHudState(Float64Array.from(s)); }} />
              <GlassToggle label="Dégradation FBW : loi Directe" checked={p.failFbw === 2} onChange={(v) => { p.failFbw = v ? 2 : 0; setHudState(Float64Array.from(s)); }} />
            </>
          )}
          <GlassButton variant="danger" className="w-full" onClick={() => { p.windshear = true; setToast('Cisaillement de vent (microburst) déclenché devant l\'avion'); setTimeout(() => { p.windshear = false; }, 500); }}>Déclencher un wind shear</GlassButton>
        </GlassPanel>
      )}

      {/* debug / métriques */}
      {showDebug && metrics && (
        <GlassPanel className="absolute left-3 top-20 w-[260px] p-3 font-mono text-[11px]" animate={false} style={checklist.length && k < checklist.length ? { top: 360 } : undefined}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span className="text-white/50">FPS</span><span className={metrics.fps >= 100 ? 'text-[#5bf09a]' : metrics.fps >= 55 ? 'text-[#ffd25a]' : 'text-[#ff6b6b]'}>{metrics.fps.toFixed(0)}</span>
            <span className="text-white/50">Frame</span><span>{metrics.frameMs.toFixed(2)} ms (max {metrics.frameMsMax.toFixed(1)})</span>
            <span className="text-white/50">GPU</span><span>{metrics.gpuMs > 0 ? `${metrics.gpuMs.toFixed(2)} ms` : 'n/d'}</span>
            <span className="text-white/50">Draw calls</span><span>{metrics.drawCalls}</span>
            <span className="text-white/50">Triangles</span><span>{(metrics.triangles / 1000).toFixed(0)} k</span>
            <span className="text-white/50">Textures</span><span>{metrics.textures}</span>
            <span className="text-white/50">Mém. GPU ≈</span><span>{metrics.gpuMemMB.toFixed(0)} Mo</span>
            <span className="text-white/50">DPR effectif</span><span>{metrics.renderScale.toFixed(2)}</span>
            <span className="text-white/50">Physique</span><span>{metrics.physicsMode} · 240 Hz RK4</span>
            <span className="text-white/50">GPU</span><span className="truncate">{glDiagnostics.gpuName}</span>
          </div>
          {glErrors.length > 0 && (
            <div className="mt-2 max-h-40 overflow-auto rounded bg-[#ff3b30]/20 p-1 text-[10px]">
              {glErrors.map((e, i) => <pre key={i} className="whitespace-pre-wrap">[{e.stage}] {e.message}{'\n'}{e.excerpt}</pre>)}
            </div>
          )}
          {glDiagnostics.contextLost && <div className="mt-1 text-[#ff6b6b]">Contexte WebGL perdu</div>}
        </GlassPanel>
      )}

      {/* pause */}
      {paused && mode === 'sim' && !crash && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/25">
          <GlassPanel className="w-[360px] space-y-2 p-6 text-center">
            <div className="text-xl font-semibold">Pause</div>
            <GlassButton variant="primary" className="w-full" onClick={() => setPaused(false)}>Reprendre</GlassButton>
            <GlassButton className="w-full" onClick={() => setPhoto(true)}>Mode photo (path tracing)</GlassButton>
            <GlassButton className="w-full" onClick={() => store.set({ settingsOpen: true })}>Paramètres</GlassButton>
            <GlassButton className="w-full" onClick={endFlight}>Terminer le vol → analyse & replay</GlassButton>
            <GlassButton className="w-full" onClick={() => store.set((x) => ({ flightId: x.flightId + 1 }))}>Recommencer</GlassButton>
            <GlassButton className="w-full" onClick={() => store.set({ screen: 'hangar' })}>Retour à l'atelier</GlassButton>
          </GlassPanel>
        </div>
      )}
      {photo && <div className="absolute bottom-3 left-1/2 -translate-x-1/2"><GlassButton onClick={() => setPhoto(false)}>Quitter le mode photo</GlassButton></div>}

      {/* crash */}
      {crash && mode === 'sim' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <GlassPanel className="w-[420px] space-y-3 p-6 text-center">
            <div className="text-2xl font-bold text-[#ff6b6b]">Accident</div>
            <div className="text-[13px] text-white/80">{crash}</div>
            <GlassButton variant="primary" className="w-full" onClick={endFlight}>Analyse & replay 3D</GlassButton>
            <GlassButton className="w-full" onClick={() => store.set((x) => ({ flightId: x.flightId + 1 }))}>Recommencer</GlassButton>
            <GlassButton className="w-full" onClick={() => store.set({ screen: 'hangar' })}>Atelier</GlassButton>
          </GlassPanel>
        </div>
      )}

      {/* replay + analyse d'atterrissage */}
      {mode === 'replay' && record && <ReplayPanel record={record} t={replayT} play={replayPlay} onSeek={(t) => { replayRef.current.t = t; setReplayT(t); }} onPlay={(v) => { replayRef.current.play = v; setReplayPlay(v); }} onSpeed={(v) => { replayRef.current.speed = v; }} />}
    </div>
  );
}

function KeyHelp({ onClose, stovl, hook, carrier }: { onClose: () => void; stovl: boolean; hook: boolean; carrier: boolean }) {
  const b = useStore((s) => s.settings.controls.bindings);
  const k = (a: Action) => (b[a] ?? []).map(keyLabel).join(' / ') || '—';
  const rows: [string, string][] = [
    ['Tangage (cabrer / piquer)', `${k('pitchUp')}  |  ${k('pitchDown')}`],
    ['Roulis (gauche / droite)', `${k('rollLeft')}  |  ${k('rollRight')}`],
    ['Palonnier', `${k('yawLeft')}  |  ${k('yawRight')}`],
    ['Gaz + / −', `${k('throttleUp')}  |  ${k('throttleDown')}`],
    ['Plein gaz / ralenti', `${k('throttleMax')}  |  ${k('throttleIdle')}`],
    ['Volets + / −', `${k('flapsDown')}  |  ${k('flapsUp')}`],
    ['Train · Freins · Frein de parc', `${k('gearToggle')} · ${k('brakes')} · ${k('parkingBrake')}`],
    ['Aérofreins · Trim', `${k('speedbrakeToggle')} · ${k('trimUp')} ${k('trimDown')}`],
    ['Pilote auto · Loi FBW', `${k('autopilot')} · ${k('fbwToggle')}`],
    ['Caméra · Cockpit · Pause', `${k('cameraNext')} · ${k('cockpitToggle')} · ${k('pause')}`],
  ];
  if (hook) rows.push(['Crosse d\'appontage', k('hookToggle')]);
  if (carrier && !stovl) rows.push(['Lancement catapulte (plein gaz d\'abord)', k('catapult')]);
  if (stovl) rows.push(['STOVL · tuyère ↓ / ↑', `${k('stovlToggle')} · ${k('nozzleDown')} / ${k('nozzleUp')}`]);
  return (
    <GlassPanel className="absolute bottom-3 left-1/2 w-[520px] -translate-x-1/2 p-4">
      <div className="mb-2 flex items-center justify-between">
        <SectionTitle>Commandes {keyboardLayout !== 'inconnue' ? `(${keyboardLayout.toUpperCase()})` : ''}</SectionTitle>
        <GlassButton size="sm" onClick={onClose}>Masquer</GlassButton>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        {rows.map(([l, v]) => (
          <div key={l} className="contents"><span className="text-white/60">{l}</span><span className="font-mono font-semibold">{v}</span></div>
        ))}
      </div>
      <div className="mt-2 text-[10px] text-white/45">Remappage complet et manette/HOTAS : Paramètres → Clavier & souris.</div>
    </GlassPanel>
  );
}

function ReplayPanel({ record, t, play, onSeek, onPlay, onSpeed }: { record: FlightRecord; t: number; play: boolean; onSeek: (t: number) => void; onPlay: (v: boolean) => void; onSpeed: (v: number) => void }) {
  const a = record.analysis;
  const n = record.n;
  const tt = Array.from({ length: n }, (_, i) => record.data[i * REC_STRIDE + REC_INDEX.t]);
  const vs = Array.from({ length: n }, (_, i) => (record.data[i * REC_STRIDE + REC_INDEX.vs] / FT) * 60);
  const agl = Array.from({ length: n }, (_, i) => record.data[i * REC_STRIDE + REC_INDEX.agl] / FT);
  const lat = Array.from({ length: n }, (_, i) => record.data[i * REC_STRIDE + REC_INDEX.lat]);
  const t0 = a.touchdown ? a.touchdown.t - 30 : tt[0];
  const t1 = a.touchdown ? a.touchdown.t + 20 : tt[n - 1];
  const cur = tt[Math.min(n - 1, Math.floor(t))] ?? 0;
  return (
    <>
      <GlassPanel className="absolute right-3 top-20 w-[360px] space-y-3 p-5">
        <SectionTitle>Analyse post-vol (boîte noire)</SectionTitle>
        <div className={`text-[14px] font-semibold ${record.crashed ? 'text-[#ff6b6b]' : 'text-white'}`}>{a.verdict}</div>
        <div className="grid grid-cols-3 gap-3">
          <Stat small label="Taux de chute" value={a.touchdown ? Math.abs(Math.round(a.touchdown.vsFpm)) : '—'} unit="ft/min" tone={a.touchdown && Math.abs(a.touchdown.vsFpm) > 600 ? 'bad' : 'good'} />
          <Stat small label="Écart latéral" value={a.touchdown ? a.touchdown.lateral.toFixed(1) : '—'} unit="m" />
          <Stat small label="Distance freinage" value={a.brakingDistance !== null ? Math.round(a.brakingDistance) : '—'} unit="m" />
          <Stat small label="Toucher / seuil" value={a.touchdown ? Math.round(a.touchdown.distanceFromThreshold) : '—'} unit="m" />
          <Stat small label="G max" value={a.maxG.toFixed(2)} />
          <Stat small label="α max" value={(a.maxAlpha / DEG).toFixed(1)} unit="°" />
        </div>
        <LineChart title="Vitesse verticale (ft/min)" series={[{ x: tt, y: vs, color: '#64d2ff' }]} xDomain={[t0, t1]} width={320} height={120} marker={{ x: cur, y: vs[Math.min(n - 1, Math.floor(t))] ?? 0 }} />
        <LineChart title="Hauteur radio (ft)" series={[{ x: tt, y: agl, color: '#30d158' }]} xDomain={[t0, t1]} width={320} height={110} />
        <LineChart title="Écart à l'axe (m)" series={[{ x: tt, y: lat, color: '#ff9f0a' }]} xDomain={[t0, t1]} width={320} height={110} />
      </GlassPanel>
      <GlassPanel className="absolute bottom-3 left-1/2 flex w-[640px] -translate-x-1/2 items-center gap-3 px-4 py-3" animate={false}>
        <GlassButton size="sm" onClick={() => onPlay(!play)}>{play ? '❚❚' : '▶'}</GlassButton>
        <input type="range" className="glass-range flex-1" min={0} max={Math.max(1, n - 1)} step={0.1} value={t} onChange={(e) => onSeek(parseFloat(e.target.value))} style={{ ['--pct' as string]: `${(t / Math.max(1, n - 1)) * 100}%` }} />
        <span className="tabular w-16 text-right text-[12px]">{cur.toFixed(1)} s</span>
        {[0.25, 1, 4].map((v) => <GlassButton key={v} size="sm" onClick={() => onSpeed(v)}>×{v}</GlassButton>)}
        {a.touchdown && <GlassButton size="sm" onClick={() => onSeek(Math.max(0, (a.touchdown!.t - tt[0]) * record.hz - 80))}>Toucher</GlassButton>}
        <GlassButton size="sm" onClick={() => store.set({ screen: 'hangar' })}>Atelier</GlassButton>
      </GlassPanel>
    </>
  );
}
