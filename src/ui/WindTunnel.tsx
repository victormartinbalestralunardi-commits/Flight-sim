/** Écran Soufflerie CFD « Fly it or Not » couplée au modèle de vol. */
import { useEffect, useRef, useState } from 'react';
import { CfdScene } from '../cfd/CfdScene';
import type { StreamlineResult, TunnelRequest, TunnelResult } from '../cfd/tunnel';
import { CFD_STYLE, cssTurbo } from '../cfd/palette';
import { getAircraft } from '../aircraft/specs';
import { store, useStore } from './store';
import { Badge, GlassButton, GlassPanel, GlassSlider, GlassToggle, SectionTitle, Segmented, Stat } from './glass';
import { LineChart } from './charts';

type PolarView = 'cl' | 'cd' | 'ld' | 'cm';

export function WindTunnel() {
  const aircraft = useStore((s) => s.aircraft);
  const mods = useStore((s) => s.mods);
  const loadout = useStore((s) => s.loadout);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CfdScene | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const [alpha, setAlpha] = useState(4);
  const [beta, setBeta] = useState(0);
  const [mach, setMach] = useState(0.3);
  const [altitude, setAltitude] = useState(0);
  const [flap, setFlap] = useState(0);
  const [stream, setStream] = useState(true);
  const [shockOn, setShockOn] = useState(true);
  const [res, setRes] = useState<TunnelResult | null>(null);
  const [lines, setLines] = useState<StreamlineResult | null>(null);
  const [polarView, setPolarView] = useState<PolarView>('cl');
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);
  const spec = getAircraft(aircraft);

  useEffect(() => {
    const scene = new CfdScene(canvasRef.current!);
    sceneRef.current = scene;
    const onResize = () => scene.resize(window.innerWidth, window.innerHeight);
    onResize();
    window.addEventListener('resize', onResize);
    let raf = 0;
    const loop = () => {
      scene.render();
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

  // requêtes (coalescées dans le worker)
  useEffect(() => {
    const t = setTimeout(() => {
      const req: TunnelRequest = {
        id: ++reqId.current, aircraft, mods, xcgPct: loadout.xcgPct, alphaDeg: alpha, betaDeg: beta, mach, altitude, flap,
        massKg: spec.mass.empty + loadout.fuelKg + loadout.payloadKg, streamlines: stream,
      };
      setBusy(true);
      workerRef.current?.postMessage({ type: 'solve', req });
    }, 40);
    return () => clearTimeout(t);
  }, [aircraft, mods, loadout.xcgPct, alpha, beta, mach, altitude, flap, stream, loadout.fuelKg, loadout.payloadKg, spec.mass.empty]);

  useEffect(() => {
    if (res) sceneRef.current?.setResult(res, alpha, beta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);
  useEffect(() => {
    if (lines && lines.id === res?.id) sceneRef.current?.setStreamlines(lines);
  }, [lines, res?.id]);
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
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Barre de titre */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 flex justify-center p-4">
        <GlassPanel className="pointer-events-auto flex items-center gap-4 px-5 py-2.5">
          <div className="text-[15px] font-semibold tracking-tight">Soufflerie numérique — {spec.name}</div>
          <Badge tone="info">VLM {res ? `${res.geometry.n} panneaux` : '…'}</Badge>
          {busy && <span className="text-[11px] text-white/50">calcul…</span>}
          {res && <span className="text-[11px] text-white/45 tabular">{res.elapsedMs.toFixed(0)} ms{lines ? ` · lignes ${lines.elapsedMs.toFixed(0)} ms` : ''}</span>}
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
        <div className="pt-1">
          <GlassToggle label="Lignes de courant & tourbillons" checked={stream} onChange={setStream} />
          <GlassToggle label="Onde de choc / cône de Mach" checked={shockOn} onChange={setShockOn} />
        </div>
        {res && (
          <div className="grid grid-cols-3 gap-3 border-t border-white/10 pt-3">
            <Stat label="CL" value={res.CL.toFixed(3)} small />
            <Stat label="CD" value={res.CDtot.toFixed(4)} small />
            <Stat label="L/D" value={res.LD.toFixed(1)} small />
            <Stat label="CDi (VLM)" value={res.CDi.toFixed(4)} small />
            <Stat label="Cm CG" value={res.polar.Cm[curIdx].toFixed(3)} small />
            <Stat label="e (VLM)" value={res.oswaldVlm.toFixed(2)} small />
            <Stat label="Cp*" value={res.cpStar < -50 ? '—' : res.cpStar.toFixed(2)} small />
            <Stat label="V∞" value={(res.V * 1.94384).toFixed(0)} unit="kt" small />
            <Stat label="Choc" value={res.shock.length ? 'OUI' : 'non'} tone={res.shock.length ? 'warn' : 'default'} small />
          </div>
        )}
        <div className="border-t border-white/10 pt-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.08em] text-white/45">Coefficient de pression Cp</div>
          <div className="h-2.5 w-full rounded-full" style={{ background: `linear-gradient(90deg, ${Array.from({ length: 11 }, (_, i) => cssTurbo(i / 10)).join(',')})` }} />
          <div className="mt-1 flex justify-between text-[10px] text-white/60 tabular"><span>{CFD_STYLE.cpMin.toFixed(1)}</span><span>0</span><span>+{CFD_STYLE.cpMax.toFixed(1)}</span></div>
          <div className="mt-1 text-[10px] leading-snug text-white/45">Lignes colorées par |V|/V∞ · <span className="text-[#ff7ad9]">tourbillons marginaux</span> · fuselage : Cp newtonien modifié (Lees)</div>
        </div>
      </GlassPanel>

      {/* Verdict & dérivées */}
      {res && (
        <GlassPanel className="absolute right-4 top-20 w-[310px] space-y-3 p-5">
          <SectionTitle>Verdict d'ingénierie</SectionTitle>
          <div className="flex items-center gap-3">
            <div className={`text-2xl font-bold tracking-tight ${tone === 'good' ? 'text-[#5bf09a]' : tone === 'warn' ? 'text-[#ffd25a]' : 'text-[#ff6b6b]'}`}>
              {res.verdict === 'stable' ? 'STABLE' : res.verdict === 'limite' ? 'LIMITE' : 'INSTABLE'}
            </div>
            <Badge tone={tone}>{res.staticMarginPct >= 0 ? '+' : ''}{res.staticMarginPct.toFixed(1)} % MAC</Badge>
          </div>
          <div className="text-[12px] leading-snug text-white/70">{res.verdictReason}</div>
          {/* Réglette centrage / foyer */}
          <div className="relative mt-1 h-8 rounded-xl bg-white/10">
            {[0, 25, 50, 75, 100].map((p) => <div key={p} className="absolute top-0 h-full w-px bg-white/10" style={{ left: `${p}%` }} />)}
            <div className="absolute top-1 h-6 w-1.5 -translate-x-1/2 rounded-full bg-[#34e0ff]" style={{ left: `${Math.min(100, Math.max(0, res.npPct))}%` }} title="Foyer" />
            <div className="absolute top-1 h-6 w-1.5 -translate-x-1/2 rounded-full bg-[#ffd23f]" style={{ left: `${Math.min(100, Math.max(0, loadout.xcgPct))}%` }} title="CG" />
          </div>
          <div className="flex justify-between text-[10px] text-white/50"><span>BA MAC</span><span className="text-[#ffd23f]">CG {loadout.xcgPct.toFixed(1)} %</span><span className="text-[#34e0ff]">Foyer {res.npPct.toFixed(1)} %</span><span>BF</span></div>
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
          <div className="text-[10px] leading-snug text-white/40">Ces dérivées sont injectées telles quelles dans le moteur de vol 6-DDL (worker 240 Hz).</div>
          <div className="flex gap-2 pt-1">
            <GlassButton variant="success" size="lg" className="flex-1" onClick={() => store.set({ screen: 'setup' })}>FLY IT</GlassButton>
            <GlassButton size="lg" onClick={() => store.set({ screen: 'hangar' })}>RETOUR ATELIER</GlassButton>
          </div>
        </GlassPanel>
      )}

      {/* Polaires + charge en envergure */}
      {res && pv && (
        <div className="absolute bottom-4 left-[318px] right-[342px] flex flex-wrap items-end justify-center gap-4">
          <GlassPanel className="p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <SectionTitle>Polaires (modèle de vol, M={mach.toFixed(2)})</SectionTitle>
              <Segmented<PolarView> value={polarView} onChange={setPolarView} options={[{ value: 'cl', label: 'CL-α' }, { value: 'cd', label: 'CL-CD' }, { value: 'ld', label: 'L/D' }, { value: 'cm', label: 'Cm-α' }]} />
            </div>
            <LineChart series={pv.s} marker={pv.m} width={400} height={140} xLabel={pv.xl} yLabel={pv.yl} />
          </GlassPanel>
          <GlassPanel className="p-4">
            <SectionTitle>Charge en envergure (cl·c / c̄)</SectionTitle>
            <LineChart series={[{ x: Array.from(res.spanLoad, (_, i) => i), y: res.spanLoad, color: '#bf5af2' }]} width={260} height={140} xLabel="bandes (G → D)" />
          </GlassPanel>
        </div>
      )}
    </div>
  );
}
