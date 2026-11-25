/** Onglet Paramètres (Liquid Glass) : clavier/souris, manette/HOTAS, graphismes, météo, audio. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTIONS, assignKey, defaultBindings, findConflicts, keyLabel, type Action } from '../controls/bindings';
import { listGamepads, shapeAxis, type AxisName } from '../controls/gamepad';
import { presetValues, store, updateSettings, useStore, type QualityPreset } from './store';
import { Badge, GlassButton, GlassSlider, GlassToggle, Modal, SectionTitle, Segmented } from './glass';
import { LineChart } from './charts';

type Tab = 'keys' | 'pad' | 'gfx' | 'wx' | 'audio';

export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const [tab, setTab] = useState<Tab>('keys');
  if (!open) return null;
  return (
    <Modal onClose={() => store.set({ settingsOpen: false })} className="w-[880px] max-w-[95vw]">
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="text-lg font-semibold tracking-tight">Paramètres</div>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          className="w-[560px]"
          options={[
            { value: 'keys', label: 'Clavier & souris' },
            { value: 'pad', label: 'Manette / HOTAS' },
            { value: 'gfx', label: 'Graphismes' },
            { value: 'wx', label: 'Météo' },
            { value: 'audio', label: 'Audio' },
          ]}
        />
        <GlassButton size="sm" onClick={() => store.set({ settingsOpen: false })}>Fermer</GlassButton>
      </div>
      <div className="scroll-glass max-h-[72vh] overflow-y-auto px-6 py-5">
        {tab === 'keys' && <KeysTab />}
        {tab === 'pad' && <PadTab />}
        {tab === 'gfx' && <GfxTab />}
        {tab === 'wx' && <WeatherTab />}
        {tab === 'audio' && <AudioTab />}
      </div>
    </Modal>
  );
}

function KeysTab() {
  const c = useStore((s) => s.settings.controls);
  const [capture, setCapture] = useState<{ action: Action; slot: number } | null>(null);
  const conflicts = useMemo(() => findConflicts(c.bindings), [c.bindings]);
  const conflictCodes = new Set(conflicts.map((x) => x.code));

  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { setCapture(null); return; }
      let next = c.bindings;
      if (e.code === 'Backspace' || e.code === 'Delete') {
        next = { ...c.bindings, [capture.action]: c.bindings[capture.action].filter((_, i) => i !== capture.slot) };
      } else next = assignKey(c.bindings, capture.action, capture.slot, e.code);
      updateSettings('controls', { bindings: next });
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capture, c.bindings]);

  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  return (
    <div className="grid grid-cols-[1fr_260px] gap-6">
      <div>
        {conflicts.length > 0 && (
          <div className="mb-3 rounded-2xl border border-[#ff3b30]/40 bg-[#ff3b30]/15 px-4 py-2 text-[12px] text-[#ffb3ad]">
            {conflicts.length} conflit(s) : {conflicts.map((x) => `${keyLabel(x.code)} → ${x.actions.map((a) => ACTIONS.find((i) => i.id === a)?.label).join(' / ')}`).join(' · ')}
          </div>
        )}
        {groups.map((g) => (
          <div key={g} className="mb-4">
            <SectionTitle>{g}</SectionTitle>
            <div className="space-y-1">
              {ACTIONS.filter((a) => a.group === g).map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-xl px-2 py-1 hover:bg-white/5">
                  <span className="text-[13px] text-white/80">{a.label}</span>
                  <div className="flex gap-1.5">
                    {[0, 1].map((slot) => {
                      const code = c.bindings[a.id]?.[slot];
                      const active = capture?.action === a.id && capture.slot === slot;
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setCapture({ action: a.id, slot })}
                          className={`min-w-[72px] rounded-lg border px-2 py-1 text-[12px] font-medium transition-all duration-300 ${
                            active ? 'animate-pulse border-[#0a84ff] bg-[#0a84ff]/30' : code && conflictCodes.has(code) ? 'border-[#ff3b30]/60 bg-[#ff3b30]/20' : 'border-white/20 bg-white/10 hover:bg-white/20'
                          }`}
                        >
                          {active ? '…' : code ? keyLabel(code) : '—'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <SectionTitle>Souris</SectionTitle>
        <GlassToggle label="Mode yoke souris" hint="Position du curseur = manche (tangage/roulis)" checked={c.mouseYoke} onChange={(v) => updateSettings('controls', { mouseYoke: v })} />
        <GlassSlider label="Sensibilité" value={c.mouseSensitivity} min={0.3} max={2.5} step={0.05} onChange={(v) => updateSettings('controls', { mouseSensitivity: v })} format={(v) => v.toFixed(2)} />
        <GlassSlider label="Zone morte" value={c.mouseDeadzone} min={0} max={0.25} step={0.01} onChange={(v) => updateSettings('controls', { mouseDeadzone: v })} format={(v) => `${Math.round(v * 100)} %`} />
        <SectionTitle>Clavier</SectionTitle>
        <GlassSlider label="Vitesse des axes clavier" value={c.keyboardRate} min={0.5} max={5} step={0.1} onChange={(v) => updateSettings('controls', { keyboardRate: v })} format={(v) => v.toFixed(1)} unit="/s" />
        <div className="text-[11px] text-white/45">Cliquez sur une case puis appuyez sur la touche. Échap annule, Retour arrière efface. Sauvegarde automatique (localStorage).</div>
        <GlassButton size="sm" onClick={() => updateSettings('controls', { bindings: defaultBindings() })}>Réinitialiser le clavier</GlassButton>
      </div>
    </div>
  );
}

function PadTab() {
  const g = useStore((s) => s.settings.controls.gamepad);
  const [pads, setPads] = useState<Gamepad[]>([]);
  const [live, setLive] = useState<number[]>([]);
  const [learn, setLearn] = useState<AxisName | null>(null);
  const [learnBtn, setLearnBtn] = useState<Action | null>(null);
  const baseline = useRef<number[]>([]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const ps = listGamepads();
      setPads(ps);
      const gp = g.deviceIndex >= 0 ? ps.find((p) => p.index === g.deviceIndex) : ps[0];
      if (gp) {
        const axes = [...gp.axes];
        setLive(axes);
        if (learn) {
          if (!baseline.current.length) baseline.current = axes;
          let best = -1, bestD = 0.5;
          axes.forEach((v, i) => { const d = Math.abs(v - (baseline.current[i] ?? 0)); if (d > bestD) { bestD = d; best = i; } });
          if (best >= 0) {
            updateSettings('controls', { gamepad: { ...g, axes: { ...g.axes, [learn]: { ...g.axes[learn], index: best } } } });
            setLearn(null);
            baseline.current = [];
          }
        }
        if (learnBtn) {
          const bi = gp.buttons.findIndex((b) => b.pressed);
          if (bi >= 0) {
            updateSettings('controls', { gamepad: { ...g, buttons: { ...g.buttons, [learnBtn]: bi } } });
            setLearnBtn(null);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [g, learn, learnBtn]);

  const curve = useMemo(() => {
    const x = Array.from({ length: 41 }, (_, i) => -1 + i / 20);
    return { x, y: x.map((v) => shapeAxis(v, g.deadzone, g.expo)) };
  }, [g.deadzone, g.expo]);
  const axisNames: [AxisName, string][] = [['pitch', 'Tangage'], ['roll', 'Roulis'], ['yaw', 'Lacet'], ['throttle', 'Gaz']];
  const btnActions: Action[] = ['gearToggle', 'flapsDown', 'flapsUp', 'brakes', 'speedbrakeToggle', 'hookToggle', 'catapult', 'cameraNext', 'cockpitToggle', 'pause', 'autopilot', 'fbwToggle'];

  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-3">
        <SectionTitle>Périphérique</SectionTitle>
        <GlassToggle label="Activer manette / joystick / HOTAS" checked={g.enabled} onChange={(v) => updateSettings('controls', { gamepad: { ...g, enabled: v } })} />
        {pads.length === 0 ? (
          <div className="text-[12px] text-white/50">Aucun périphérique détecté — branchez-le puis appuyez sur un bouton (Gamepad API).</div>
        ) : (
          <div className="space-y-1">
            {pads.map((p) => (
              <button key={p.index} type="button" onClick={() => updateSettings('controls', { gamepad: { ...g, deviceIndex: p.index } })}
                className={`block w-full truncate rounded-xl border px-3 py-1.5 text-left text-[12px] ${g.deviceIndex === p.index || (g.deviceIndex < 0 && p === pads[0]) ? 'border-[#0a84ff]/60 bg-[#0a84ff]/20' : 'border-white/15 bg-white/5'}`}>
                #{p.index} {p.id} <span className="text-white/40">({p.axes.length} axes, {p.buttons.length} boutons)</span>
              </button>
            ))}
          </div>
        )}
        <SectionTitle>Axes</SectionTitle>
        {axisNames.map(([k, label]) => {
          const m = g.axes[k];
          const v = m.index >= 0 ? live[m.index] ?? 0 : 0;
          return (
            <div key={k} className="flex items-center gap-2">
              <span className="w-16 text-[12px] text-white/75">{label}</span>
              <div className="relative h-2 flex-1 rounded-full bg-white/10">
                <div className="absolute top-0 h-2 rounded-full bg-[#64d2ff]" style={{ left: `${50 + Math.min(0, v) * 50}%`, width: `${Math.abs(v) * 50}%` }} />
              </div>
              <GlassButton size="sm" active={learn === k} onClick={() => { baseline.current = []; setLearn(learn === k ? null : k); }}>
                {learn === k ? 'Bougez…' : m.index >= 0 ? `Axe ${m.index}` : 'Assigner'}
              </GlassButton>
              <GlassButton size="sm" active={m.invert} onClick={() => updateSettings('controls', { gamepad: { ...g, axes: { ...g.axes, [k]: { ...m, invert: !m.invert } } } })}>Inv.</GlassButton>
            </div>
          );
        })}
        <GlassToggle label="Gaz sur axe bipolaire (−1..1)" checked={g.throttleBipolar} onChange={(v) => updateSettings('controls', { gamepad: { ...g, throttleBipolar: v } })} />
      </div>
      <div className="space-y-3">
        <SectionTitle>Réponse</SectionTitle>
        <GlassSlider label="Zone morte" value={g.deadzone} min={0} max={0.3} step={0.01} onChange={(v) => updateSettings('controls', { gamepad: { ...g, deadzone: v } })} format={(v) => `${Math.round(v * 100)} %`} />
        <GlassSlider label="Courbe exponentielle" value={g.expo} min={0} max={1} step={0.05} onChange={(v) => updateSettings('controls', { gamepad: { ...g, expo: v } })} format={(v) => v.toFixed(2)} />
        <LineChart series={[{ x: curve.x, y: curve.y, color: '#64d2ff' }, { x: [-1, 1], y: [-1, 1], color: 'rgba(255,255,255,0.25)', dashed: true }]} width={360} height={150} xLabel="entrée" yLabel="sortie" />
        <SectionTitle>Boutons</SectionTitle>
        <div className="grid grid-cols-2 gap-1.5">
          {btnActions.map((a) => (
            <button key={a} type="button" onClick={() => setLearnBtn(learnBtn === a ? null : a)}
              className={`flex justify-between rounded-lg border px-2 py-1 text-[11px] ${learnBtn === a ? 'animate-pulse border-[#0a84ff] bg-[#0a84ff]/25' : 'border-white/15 bg-white/5'}`}>
              <span className="truncate text-white/75">{ACTIONS.find((x) => x.id === a)?.label}</span>
              <span className="font-semibold">{learnBtn === a ? '…' : g.buttons[a] !== undefined ? `B${g.buttons[a]}` : '—'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function GfxTab() {
  const gx = useStore((s) => s.settings.graphics);
  const set = (p: Partial<typeof gx>) => updateSettings('graphics', p);
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-3">
        <SectionTitle>Qualité</SectionTitle>
        <Segmented<QualityPreset> value={gx.preset} onChange={(p) => set({ preset: p, ...presetValues(p) })}
          options={[{ value: 'eco', label: 'Éco' }, { value: 'medium', label: 'Moyen' }, { value: 'high', label: 'Élevé' }, { value: 'ultra', label: 'Ultra' }, { value: 'cinema', label: 'Cinéma' }]} />
        <GlassSlider label="Échelle de résolution interne" value={gx.renderScale} min={0.5} max={2} step={0.05} onChange={(v) => set({ renderScale: v })} format={(v) => `${Math.round(v * 100)} %`} hint="100 % × DPR 2 = 4K natif sur écran 4K ; >100 % = supersampling" />
        <GlassSlider label="DPR maximal" value={gx.maxPixelRatio} min={1} max={3} step={0.25} onChange={(v) => set({ maxPixelRatio: v })} format={(v) => v.toFixed(2)} />
        <GlassToggle label="Résolution dynamique (DRS)" hint={`Ajuste l'échelle pour tenir ${gx.targetFps} FPS`} checked={gx.drs} onChange={(v) => set({ drs: v })} />
        <GlassSlider label="Cible FPS" value={gx.targetFps} min={30} max={240} step={10} onChange={(v) => set({ targetFps: v })} />
        <GlassSlider label="Champ de vision (FOV)" value={gx.fov} min={40} max={100} step={1} onChange={(v) => set({ fov: v })} unit="°" />
      </div>
      <div className="space-y-3">
        <SectionTitle>Effets temps réel</SectionTitle>
        <GlassToggle label="Ombres cascadées (CSM)" checked={gx.shadows} onChange={(v) => set({ shadows: v })} />
        <GlassSlider label="Cascades" value={gx.shadowCascades} min={1} max={4} step={1} onChange={(v) => set({ shadowCascades: v })} />
        <GlassToggle label="SSAO (occlusion ambiante)" checked={gx.ssao} onChange={(v) => set({ ssao: v })} />
        <GlassToggle label="SSR (réflexions écran : eau, métal)" checked={gx.ssr} onChange={(v) => set({ ssr: v })} />
        <GlassToggle label="Bloom physique" checked={gx.bloom} onChange={(v) => set({ bloom: v })} />
        <GlassToggle label="Nuages volumétriques" checked={gx.clouds} onChange={(v) => set({ clouds: v })} />
        <Segmented<0.5 | 0.25> value={gx.cloudRes} onChange={(v) => set({ cloudRes: v })} options={[{ value: 0.5, label: 'Nuages ½ rés.' }, { value: 0.25, label: 'Nuages ¼ rés.' }]} />
        <SectionTitle>Ray tracing (Atelier & Mode photo)</SectionTitle>
        <GlassToggle label="Path tracing progressif" checked={gx.pathTracing} onChange={(v) => set({ pathTracing: v })} />
        <GlassSlider label="Rebonds" value={gx.ptBounces} min={1} max={12} step={1} onChange={(v) => set({ ptBounces: v })} />
        <GlassSlider label="Échantillons max" value={gx.ptMaxSamples} min={32} max={4096} step={32} onChange={(v) => set({ ptMaxSamples: v })} />
        <GlassToggle label="Panneau de métriques (FPS, ms, draw calls, mémoire GPU)" checked={gx.showMetrics} onChange={(v) => set({ showMetrics: v })} />
      </div>
    </div>
  );
}

function WeatherTab() {
  const w = useStore((s) => s.settings.weather);
  const set = (p: Partial<typeof w>) => updateSettings('weather', p);
  const tod = w.timeOfDay;
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-3">
        <SectionTitle>Vent</SectionTitle>
        <GlassSlider label="Direction (provenance)" value={w.windFrom} min={0} max={359} step={1} onChange={(v) => set({ windFrom: v })} unit="°" />
        <GlassSlider label="Force" value={w.windSpeedKt} min={0} max={45} step={1} onChange={(v) => set({ windSpeedKt: v })} unit="kt" />
        <GlassSlider label="Turbulence / rafales" value={w.turbulence} min={0} max={1} step={0.05} onChange={(v) => set({ turbulence: v })} format={(v) => `${Math.round(v * 100)} %`} />
        <GlassSlider label="Écart ISA" value={w.deltaIsa} min={-30} max={30} step={1} onChange={(v) => set({ deltaIsa: v })} unit="°C" />
        <GlassSlider label="État de la mer (houle porte-avions)" value={w.seaState} min={0} max={3} step={0.25} onChange={(v) => set({ seaState: v })} format={(v) => v.toFixed(2)} />
      </div>
      <div className="space-y-3">
        <SectionTitle>Ciel</SectionTitle>
        <Segmented<number> value={tod < 9 || tod > 20.5 ? 23 : tod > 17.5 ? 19 : 13} onChange={(v) => set({ timeOfDay: v === 19 ? 19.2 : v })}
          options={[{ value: 13, label: 'Jour' }, { value: 19, label: 'Golden Hour' }, { value: 23, label: 'Nuit' }]} />
        <GlassSlider label="Heure" value={w.timeOfDay} min={0} max={24} step={0.25} onChange={(v) => set({ timeOfDay: v })} format={(v) => `${Math.floor(v)}h${String(Math.round((v % 1) * 60)).padStart(2, '0')}`} />
        <GlassSlider label="Couverture nuageuse" value={w.cloudCover} min={0} max={1} step={0.05} onChange={(v) => set({ cloudCover: v })} format={(v) => `${Math.round(v * 8)}/8`} />
        <GlassSlider label="Base des nuages" value={w.cloudBase} min={300} max={4000} step={50} onChange={(v) => set({ cloudBase: v })} unit="m" />
      </div>
    </div>
  );
}

function AudioTab() {
  const a = useStore((s) => s.settings.audio);
  const set = (p: Partial<typeof a>) => updateSettings('audio', p);
  return (
    <div className="grid max-w-md grid-cols-1 gap-3">
      <GlassToggle label="Couper le son" checked={a.muted} onChange={(v) => set({ muted: v })} />
      <GlassSlider label="Volume général" value={a.master} min={0} max={1} step={0.01} onChange={(v) => set({ master: v })} format={(v) => `${Math.round(v * 100)} %`} />
      <GlassSlider label="Moteurs (piston, turbofan, PC)" value={a.engines} min={0} max={1} step={0.01} onChange={(v) => set({ engines: v })} format={(v) => `${Math.round(v * 100)} %`} />
      <GlassSlider label="Souffle aérodynamique & ambiance" value={a.ambience} min={0} max={1} step={0.01} onChange={(v) => set({ ambience: v })} format={(v) => `${Math.round(v * 100)} %`} />
      <GlassSlider label="Alarmes (GPWS, décrochage)" value={a.alerts} min={0} max={1} step={0.01} onChange={(v) => set({ alerts: v })} format={(v) => `${Math.round(v * 100)} %`} />
      <GlassSlider label="Clics cockpit" value={a.cockpit} min={0} max={1} step={0.01} onChange={(v) => set({ cockpit: v })} format={(v) => `${Math.round(v * 100)} %`} />
      <Badge tone="info">Synthèse Web Audio 100 % procédurale</Badge>
    </div>
  );
}
