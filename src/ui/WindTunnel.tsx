/** Écran Soufflerie CFD « Fly it or Not » couplée au modèle de vol. */
import { useEffect, useRef, useState } from 'react';
import { CfdScene, type LegendInfo, type LineColoring, type SurfaceMap } from '../cfd/CfdScene';
import type { StreamlineResult, TunnelRequest, TunnelResult } from '../cfd/tunnel';
import { cssJet } from '../cfd/palette';
import { getAircraft } from '../aircraft/specs';
import { buildSpec } from '../aircraft/mods';
import { store, useStore } from './store';
import { Badge, GlassButton, GlassPanel, GlassSlider, GlassToggle, SectionTitle, Segmented, Stat } from './glass';
import { LineChart } from './charts';

type PolarView = 'cl' | 'cd' | 'ld' | 'cm';
type SpanView = 'cl' | 'sigma';
type Tab = 'verdict' | 'flow' | 'struct' | 'perf';

const MAPS: { value: SurfaceMap; label: string }[] = [
  { value: 'velocity', label: '|V|' }, { value: 'cp', label: 'Cp' }, { value: 'cf', label: 'Cf' }, { value: 'tau', label: 'τw' },
  { value: 'regime', label: 'Régime' }, { value: 'cl', label: 'cl' }, { value: 'stress', label: 'σ' },
];

function fmtNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 0.1) return v.toFixed(2);
  return v.toFixed(4);
}

/** Légende verticale façon post-processeur CFD (cf. image de référence). */
function VerticalLegend({ info, index }: { info: LegendInfo; index: number }) {
  if (info.categorical) {
    return (
      <div className="rounded-xl bg-white/85 px-3 py-2 text-[11px] text-[#1a2230] shadow-md">
        <div className="mb-1 font-semibold">({index}) {info.title}</div>
        {info.categorical.map((c) => (
          <div key={c.label} className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm" style={{ background: c.color }} />{c.label}</div>
        ))}
      </div>
    );
  }
  const ticks = 9;
  return (
    <div className="rounded-xl bg-white/85 px-3 py-2 text-[11px] text-[#1a2230] shadow-md">
      <div className="mb-1 font-semibold">({index}) {info.title}{info.unit && ` — ${info.unit}`}</div>
      <div className="flex gap-2">
        <div className="h-[170px] w-5 border border-black/30" style={{ background: `linear-gradient(0deg, ${Array.from({ length: 11 }, (_, i) => cssJet(i / 10)).join(',')})` }} />
        <div className="flex h-[170px] flex-col justify-between tabular">
          {Array.from({ length: ticks }, (_, i) => info.max - ((info.max - info.min) * i) / (ticks - 1)).map((v, i) => <span key={i} className="leading-none">{fmtNum(v)}</span>)}
        </div>
      </div>
    </div>
  );
}

export function WindTunnel() {
  const aircraft = useStore((s) => s.aircraft);
  const mods = useStore((s) => s.mods);
  const loadout = useStore((s) => s.loadout);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CfdScene | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const spec = getAircraft(aircraft);
  const [alpha, setAlpha] = useState(4);
  const [beta, setBeta] = useState(0);
  const [mach, setMach] = useState(spec.category === 'ga' ? 0.15 : 0.3);
  const [altitude, setAltitude] = useState(0);
  const [flap, setFlap] = useState(0);
  const [stream, setStream] = useState(true);
  const [shockOn, setShockOn] = useState(true);
  const [map, setMap] = useState<SurfaceMap>('velocity');
  const [lineMode, setLineMode] = useState<LineColoring>('speed');
  const [res, setRes] = useState<TunnelResult | null>(null);
  const [lines, setLines] = useState<StreamlineResult | null>(null);
  const [polarView, setPolarView] = useState<PolarView>('cl');
  const [spanView, setSpanView] = useState<SpanView>('cl');
  const [tab, setTab] = useState<Tab>('verdict');
  const [busy, setBusy] = useState(false);
  const [legends, setLegends] = useState<{ s: LegendInfo; l: LegendInfo } | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const scene = new CfdScene(canvasRef.current!);
    sceneRef.current = scene;
    const onResize = () => scene.resize(window.innerWidth, window.innerHeight);
    onResize();
    window.addEventListener('resize', onResize);
    let raf = 0, frame = 0;
    const loop = () => {
      scene.render();
      // barre d'échelle (mise à jour ~4 Hz, sans re-rendu React)
      if (++frame % 15 === 0 && scaleRef.current) {
        const ppm = scene.pixelsPerMeter();
        const target = 240 / ppm;
        const p = Math.pow(10, Math.floor(Math.log10(target)));
        const step = [1, 2, 5, 10].map((k) => k * p).find((v) => v >= target / 1.2) ?? p * 10;
        scaleRef.current.style.width = `${step * ppm}px`;
        scaleRef.current.dataset.label = `${step} m`;
        const lab = scaleRef.current.querySelector('[data-mid]');
        const end = scaleRef.current.querySelector('[data-end]');
        if (lab) lab.textContent = `${+(step / 2).toPrecision(3)}`;
        if (end) end.textContent = `${step} m`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const w = new Worker(new URL('../cfd/cfd.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'tunnel') { setRes(m.result); setBusy(false); }
      else if (m.type === 'streamlines') setLines(m.result);
      else if (m.type === 'error') console.error('[CFD]', m.message);
    };
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      w.terminate();
      scene.dispose();
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const req: TunnelRequest = {
        id: ++reqId.current, aircraft, mods, xcgPct: loadout.xcgPct, alphaDeg: alpha, betaDeg: beta, mach, altitude, flap,
        massKg: spec.mass.empty + loadout.fuelKg + loadout.payloadKg, fuelKg: loadout.fuelKg, streamlines: stream,
      };
      setBusy(true);
      workerRef.current?.postMessage({ type: 'solve', req });
    }, 40);
    return () => clearTimeout(t);
  }, [aircraft, mods, loadout.xcgPct, alpha, beta, mach, altitude, flap, stream, loadout.fuelKg, loadout.payloadKg, spec.mass.empty]);

  const refreshLegends = () => {
    const s = sceneRef.current;
    if (s) setLegends({ s: s.surfaceLegend(), l: s.lineLegend() });
  };
  useEffect(() => {
    if (res) { sceneRef.current?.setAircraft(buildSpec(aircraft, mods)); sceneRef.current?.setResult(res, alpha, beta); refreshLegends(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);
  useEffect(() => {
    if (lines && lines.id === res?.id) { sceneRef.current?.setStreamlines(lines); refreshLegends(); }
  }, [lines, res?.id]);
  useEffect(() => { sceneRef.current?.setModes(map, lineMode); refreshLegends(); }, [map, lineMode]);
  useEffect(() => sceneRef.current?.setVisibility(stream, shockOn), [stream, shockOn]);

  const tone = res?.verdict === 'stable' ? 'good' : res?.verdict === 'limite' ? 'warn' : 'bad';
  const polar = res?.polar;
  const curIdx = polar ? Math.max(0, Math.min(polar.alpha.length - 1, Math.round(alpha + 6))) : 0;
  const pv = polar && {
    cl: { s: [{ x: polar.alpha, y: polar.CL, color: '#64d2ff' }], m: { x: alpha, y: res!.CL }, xl: 'α (°)', yl: 'CL' },
    cd: { s: [{ x: polar.CD, y: polar.CL, color: '#ffd60a' }], m: { x: res!.CDtot, y: res!.CL }, xl: 'CD', yl: 'CL' },
    ld: { s: [{ x: polar.alpha, y: polar.LD, color: '#30d158' }], m: { x: alpha, y: res!.LD }, xl: 'α (°)', yl: 'L/D' },
    cm: { s: [{ x: polar.alpha, y: polar.Cm, color: '#ff9f0a' }], m: { x: alpha, y: polar.Cm[curIdx] }, xl: 'α (°)', yl: 'Cm (CG)' },
  }[polarView];

  return (
    <div className="relative h-full w-full" style={{ ['--glass-tint' as string]: '16, 22, 34', ['--glass-tint-a' as string]: '0.66' }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Légendes verticales (style post-processeur) */}
      {legends && (
        <div className="pointer-events-none absolute left-[318px] top-20 flex gap-3">
          {stream && <VerticalLegend info={legends.l} index={1} />}
          {map !== 'velocity' && <VerticalLegend info={legends.s} index={2} />}
        </div>
      )}

      {/* Barre d'échelle */}
      <div className="pointer-events-none absolute bottom-[214px] left-1/2 -translate-x-1/2 text-[10px] text-[#1a2230]">
        <div ref={scaleRef} className="relative h-2 border border-[#1a2230]/70" style={{ width: 200, background: 'linear-gradient(90deg,#fff 50%,#9aa6b8 50%)' }}>
          <span className="absolute -top-4 left-0">0</span>
          <span data-mid className="absolute -top-4 left-1/2 -translate-x-1/2" />
          <span data-end className="absolute -top-4 right-0 translate-x-1/2" />
        </div>
      </div>

      {/* Barre de titre */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 flex justify-center p-4">
        <GlassPanel className="pointer-events-auto flex items-center gap-4 px-5 py-2.5">
          <div className="text-[15px] font-semibold tracking-tight">Soufflerie numérique — {spec.name}</div>
          <Badge tone="info">VLM {res ? `${res.geometry.n} panneaux` : '…'}</Badge>
          {busy && <span className="text-[11px] text-white/60">calcul…</span>}
          {res && <span className="tabular text-[11px] text-white/55">{res.elapsedMs.toFixed(0)} ms{lines ? ` · ${lines.offsets.length - 1} lignes ${lines.elapsedMs.toFixed(0)} ms` : ''}</span>}
        </GlassPanel>
      </div>

      {/* Panneau de contrôle */}
      <GlassPanel className="scroll-glass absolute bottom-4 left-4 top-20 w-[290px] space-y-3 overflow-y-auto p-5">
        <SectionTitle>Conditions d'essai</SectionTitle>
        <GlassSlider label="Incidence α" value={alpha} min={-6} max={24} step={0.5} onChange={setAlpha} unit="°" format={(v) => v.toFixed(1)} />
        <GlassSlider label="Dérapage β" value={beta} min={-10} max={10} step={0.5} onChange={setBeta} unit="°" format={(v) => v.toFixed(1)} />
        <GlassSlider label="Mach" value={mach} min={0.1} max={spec.category === 'fighter' ? 2.0 : 0.95} step={0.01} onChange={setMach} format={(v) => v.toFixed(2)} />
        <GlassSlider label="Altitude" value={altitude} min={0} max={15000} step={250} onChange={setAltitude} unit="m" />
        {spec.perf.flapMaxDeg > 0 && <GlassSlider label="Volets" value={flap} min={0} max={1} step={0.05} onChange={setFlap} format={(v) => `${Math.round(v * spec.perf.flapMaxDeg)}°`} />}
        <SectionTitle>Visualisation</SectionTitle>
        <div className="text-[11px] text-white/60">Carte de surface</div>
        <div className="grid grid-cols-4 gap-1">
          {MAPS.map((m) => (
            <button key={m.value} type="button" onClick={() => setMap(m.value)}
              className={`rounded-lg border px-1 py-1 text-[11px] font-semibold transition-all duration-300 ${map === m.value ? 'border-white/60 bg-white/30' : 'border-white/15 bg-white/5 hover:bg-white/15'}`}>{m.label}</button>
          ))}
        </div>
        <div className="text-[11px] text-white/60">Lignes de courant</div>
        <Segmented<LineColoring> value={lineMode} onChange={setLineMode} options={[{ value: 'speed', label: '|V| m/s' }, { value: 'regime', label: 'Laminaire / turbulent' }]} />
        <GlassToggle label="Lignes, tourbillons & particules" checked={stream} onChange={setStream} />
        <GlassToggle label="Onde de choc / cône de Mach" checked={shockOn} onChange={setShockOn} />
        {res && (
          <div className="grid grid-cols-3 gap-3 border-t border-white/10 pt-3">
            <Stat label="CL" value={res.CL.toFixed(3)} small />
            <Stat label="CD" value={res.CDtot.toFixed(4)} small />
            <Stat label="L/D" value={res.LD.toFixed(1)} small />
            <Stat label="CDi (VLM)" value={res.CDi.toFixed(4)} small />
            <Stat label="CDf frott." value={res.bl.CDf.toFixed(4)} small />
            <Stat label="Cm CG" value={res.polar.Cm[curIdx].toFixed(3)} small />
            <Stat label="V∞" value={res.V.toFixed(0)} unit="m/s" small />
            <Stat label="Cp*" value={res.cpStar < -50 ? '—' : res.cpStar.toFixed(2)} small />
            <Stat label="Choc" value={res.shock.length ? 'OUI' : 'non'} tone={res.shock.length ? 'warn' : 'default'} small />
          </div>
        )}
      </GlassPanel>

      {/* Analyse (onglets) */}
      {res && (
        <GlassPanel className="scroll-glass absolute bottom-4 right-4 top-20 w-[330px] space-y-3 overflow-y-auto p-5">
          <Segmented<Tab> value={tab} onChange={setTab} options={[{ value: 'verdict', label: 'Verdict' }, { value: 'flow', label: 'Écoulement' }, { value: 'struct', label: 'Structure' }, { value: 'perf', label: 'Perfs' }]} />
          {tab === 'verdict' && (
            <>
              <div className="flex items-center gap-3">
                <div className={`text-2xl font-bold tracking-tight ${tone === 'good' ? 'text-[#5bf09a]' : tone === 'warn' ? 'text-[#ffd25a]' : 'text-[#ff6b6b]'}`}>
                  {res.verdict === 'stable' ? 'STABLE' : res.verdict === 'limite' ? 'LIMITE' : 'INSTABLE'}
                </div>
                <Badge tone={tone}>{res.staticMarginPct >= 0 ? '+' : ''}{res.staticMarginPct.toFixed(1)} % MAC</Badge>
              </div>
              <div className="text-[12px] leading-snug text-white/75">{res.verdictReason}</div>
              <div className="relative mt-1 h-8 rounded-xl bg-white/10">
                {[0, 25, 50, 75, 100].map((p) => <div key={p} className="absolute top-0 h-full w-px bg-white/10" style={{ left: `${p}%` }} />)}
                <div className="absolute top-1 h-6 w-1.5 -translate-x-1/2 rounded-full bg-[#34e0ff]" style={{ left: `${Math.min(100, Math.max(0, res.npPct))}%` }} />
                <div className="absolute top-1 h-6 w-1.5 -translate-x-1/2 rounded-full bg-[#ffd23f]" style={{ left: `${Math.min(100, Math.max(0, loadout.xcgPct))}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-white/55"><span>BA MAC</span><span className="text-[#ffd23f]">CG {loadout.xcgPct.toFixed(1)} %</span><span className="text-[#34e0ff]">Foyer {res.npPct.toFixed(1)} %</span><span>BF</span></div>
              <div className="grid grid-cols-3 gap-3 border-t border-white/10 pt-3">
                <Stat label="CLα" value={res.deriv.CLa.toFixed(2)} unit="/rad" small />
                <Stat label="Cmq" value={res.deriv.Cmq.toFixed(1)} small />
                <Stat label="Cnβ" value={res.deriv.Cnb.toFixed(3)} small />
                <Stat label="Clβ" value={res.deriv.Clb.toFixed(3)} small />
                <Stat label="Clp" value={res.deriv.Clp.toFixed(3)} small />
                <Stat label="Cnr" value={res.deriv.Cnr.toFixed(3)} small />
                <Stat label="Cmδe" value={res.deriv.Cmde.toFixed(3)} small />
                <Stat label="Clδa" value={res.deriv.Clda.toFixed(3)} small />
                <Stat label="Cnδr" value={res.deriv.Cndr.toFixed(3)} small />
              </div>
              <div className="text-[10px] leading-snug text-white/45">Ces dérivées sont injectées telles quelles dans le moteur de vol 6-DDL (worker 240 Hz).</div>
            </>
          )}
          {tab === 'flow' && (
            <>
              <SectionTitle>Portance</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="CL total" value={res.CL.toFixed(3)} small />
                <Stat label="CL tourb. (Polhamus)" value={res.CLvortex.toFixed(3)} small tone={res.CLvortex > 0.02 ? 'warn' : 'default'} />
                <Stat label="e (VLM)" value={res.oswaldVlm.toFixed(2)} small />
              </div>
              <SectionTitle>Couche limite & frottement</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Re (MAC)" value={(res.bl.reMac / 1e6).toFixed(1)} unit="M" small />
                <Stat label="Cf moyen" value={res.bl.cfMean.toFixed(5)} small />
                <Stat label="CDf" value={res.bl.CDf.toFixed(4)} small />
                <Stat label="Laminaire" value={(res.bl.laminarFraction * 100).toFixed(0)} unit="%" small tone="good" />
                <Stat label="Décollé" value={(res.bl.separatedFraction * 100).toFixed(1)} unit="%" small tone={res.bl.separatedFraction > 0.02 ? 'bad' : 'default'} />
                <Stat label="CDf fuselage" value={res.bl.CDfFuselage.toFixed(4)} small />
              </div>
              <div className="text-[10px] leading-snug text-white/50">Transition : Re_x critique ou minimum de pression ; Cf laminaire Blasius 0,664/√Re_x, turbulent 0,0592 Re_x^−0,2 (corr. compressible) ; décollement quand cl local &gt; 0,9 cl_max.</div>
              <SectionTitle>Tourbillons</SectionTitle>
              <div className="text-[11px] leading-snug text-white/70">
                Marginaux : jambes libres VLM (noyau visqueux Vatistas).{lines && lines.leVortex.length > 0 ? ' Bord d\'attaque : filaments Polhamus actifs (pointillés magenta).' : res.deriv.Kv > 0 ? ' Bord d\'attaque : actifs au-delà de α = 5°.' : ' Pas de tourbillon de bord d\'attaque (flèche insuffisante).'}
              </div>
            </>
          )}
          {tab === 'struct' && (
            <>
              <SectionTitle>Contraintes de flexion (aile)</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="n (L/W)" value={res.stress.loadFactor.toFixed(2)} unit="g" small />
                <Stat label="σ max" value={(res.stress.sigmaMax / 1e6).toFixed(0)} unit="MPa" small tone={res.stress.safetyFactor < 1.5 ? 'bad' : res.stress.safetyFactor < 2.5 ? 'warn' : 'good'} />
                <Stat label="Coef. sécurité" value={res.stress.safetyFactor.toFixed(2)} small tone={res.stress.safetyFactor < 1.5 ? 'bad' : 'good'} />
                <Stat label="M emplanture" value={(res.stress.rootMoment / 1e6).toFixed(2)} unit="MN·m" small />
                <Stat label="Flèche saumon" value={res.stress.tipDeflection.toFixed(2)} unit="m" small />
                <Stat label="σ adm." value={(res.stress.material.sigmaUlt / 1e6).toFixed(0)} unit="MPa" small />
              </div>
              <div className="text-[11px] text-white/70">{res.stress.material.name}</div>
              <div className="text-[10px] leading-snug text-white/50">Caisson h = 0,85·t, b = 0,45·c ; peaux dimensionnées à 1,5 × n_max × MTOW (charge elliptique) avec épaisseur minimale ; soulagement inertiel voilure + carburant. Carte « σ » sur la maquette.</div>
            </>
          )}
          {tab === 'perf' && (
            <>
              <SectionTitle>Vitesse maximale en palier ({altitude.toFixed(0)} m)</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Vmax" value={`M ${res.vmax.mach.toFixed(2)}`} small tone="good" />
                <Stat label="TAS" value={res.vmax.tasKt.toFixed(0)} unit="kt" small />
                <Stat label="Limité par" value={res.vmax.limitedBy} small tone={res.vmax.limitedBy === 'MMO' ? 'warn' : 'default'} />
                <Stat label="M poussée=traînée" value={res.vmax.machPropulsive.toFixed(2)} small />
                <Stat label="MMO" value={res.vmax.mmo.toFixed(2)} small />
              </div>
              <LineChart
                series={[{ x: res.vmax.curveMach, y: res.vmax.curveThrust, color: '#30d158', label: 'Poussée' }, { x: res.vmax.curveMach, y: res.vmax.curveDrag, color: '#ff453a', label: 'Traînée' }]}
                marker={{ x: res.vmax.machPropulsive, y: res.vmax.curveDrag[Math.max(0, Math.round((res.vmax.machPropulsive - 0.1) / 0.02))] ?? 0, color: '#ffd60a' }}
                width={290} height={150} xLabel="Mach" yLabel="kN"
              />
              <div className="flex gap-3 text-[10px]"><span className="text-[#30d158]">— poussée max</span><span className="text-[#ff453a]">— traînée trimée</span></div>
            </>
          )}
          <div className="flex gap-2 pt-1">
            <GlassButton variant="success" size="lg" className="flex-1" onClick={() => store.set({ screen: 'setup' })}>FLY IT</GlassButton>
            <GlassButton size="lg" onClick={() => store.set({ screen: 'hangar' })}>RETOUR ATELIER</GlassButton>
          </div>
        </GlassPanel>
      )}

      {/* Polaires + distribution en envergure */}
      {res && pv && (
        <div className="absolute bottom-4 left-[318px] right-[358px] flex flex-wrap items-end justify-center gap-4">
          <GlassPanel className="p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <SectionTitle>Polaires (M={mach.toFixed(2)})</SectionTitle>
              <Segmented<PolarView> value={polarView} onChange={setPolarView} options={[{ value: 'cl', label: 'CL-α' }, { value: 'cd', label: 'CL-CD' }, { value: 'ld', label: 'L/D' }, { value: 'cm', label: 'Cm-α' }]} />
            </div>
            <LineChart series={pv.s} marker={pv.m} width={380} height={130} xLabel={pv.xl} yLabel={pv.yl} />
          </GlassPanel>
          <GlassPanel className="p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <SectionTitle>Envergure</SectionTitle>
              <Segmented<SpanView> value={spanView} onChange={setSpanView} options={[{ value: 'cl', label: 'cl·c/c̄' }, { value: 'sigma', label: 'σ (MPa)' }]} />
            </div>
            {spanView === 'cl'
              ? <LineChart series={[{ x: Array.from(res.spanLoad, (_, i) => i), y: res.spanLoad, color: '#bf5af2' }]} width={260} height={130} xLabel="bandes (G → D)" />
              : <LineChart series={[{ x: res.stress.wingS, y: res.stress.wingSigma, color: '#ff9f0a' }]} width={260} height={130} xLabel="s (m) emplanture → saumon" yLabel="MPa" />}
          </GlassPanel>
        </div>
      )}
    </div>
  );
}
