/** Atelier : choix de l'appareil, masse, carburant, centrage, géométrie, performances instantanées. */
import { lazy, Suspense, useMemo } from 'react';
import { AIRCRAFT_IDS, getAircraft } from '../aircraft/specs';
import { applyMods, DEFAULT_MODS } from '../aircraft/mods';
import { computeDerivatives, npPercent, staticMargin, verdict, xcgFromPercent } from '../cfd/derivatives';
import { createAtmo, isa } from '../physics/isa';
import { G0 } from '../physics/math';
import { defaultLoadout, store, useStore } from './store';
import { Badge, GlassButton, GlassPanel, GlassSlider, SectionTitle, Stat } from './glass';
import { Planform } from './Planform';

const HangarViewport = lazy(() => import('./HangarViewport'));

const CAT: Record<string, string> = { fighter: 'Chasseur', airliner: 'Long-courrier', bizjet: 'Jet d\'affaires', ga: 'Aviation légère' };

export function Hangar() {
  const id = useStore((s) => s.aircraft);
  const lo = useStore((s) => s.loadout);
  const mods = useStore((s) => s.mods);
  const base = useMemo(() => getAircraft(id), [id]);
  const spec = useMemo(() => applyMods(base, mods), [base, mods]);
  const aero = useMemo(() => computeDerivatives(spec), [spec]);
  const mass = spec.mass.empty + lo.fuelKg + lo.payloadKg;
  const atmo = isa(0, createAtmo());
  const thrust = spec.engines.reduce((a, e) => a + (e.type === 'piston' ? (0.8 * e.thrustDry) / 32 : Math.max(e.thrustDry, e.thrustAB)), 0);
  const twr = thrust / (mass * G0);
  const wl = mass / spec.wingArea;
  const clmax = aero.CL0 + aero.CLa * ((spec.perf.alphaStall - 1.5) * Math.PI / 180);
  const clmaxF = clmax + aero.CLflap;
  const vs = Math.sqrt((2 * mass * G0) / (atmo.rho * spec.wingArea * clmax)) / 0.514444;
  const vsF = Math.sqrt((2 * mass * G0) / (atmo.rho * spec.wingArea * clmaxF)) / 0.514444;
  const sm = staticMargin(aero, lo.xcgPct) * 100;
  const v = verdict(aero, lo.xcgPct, spec.fcs === 'fbw');
  const overMtow = mass > spec.mass.mtow;
  const set = (p: Partial<typeof lo>) => store.set((s) => ({ loadout: { ...s.loadout, ...p } }));
  const setM = (p: Partial<typeof mods>) => store.set((s) => ({ mods: { ...s.mods, ...p } }));

  return (
    <div className="relative h-full w-full">
      <Suspense fallback={<div className="absolute inset-0 bg-gradient-to-b from-[#1b2333] to-[#0b0f17]" />}>
        <HangarViewport aircraft={id} mods={mods} xcgPct={lo.xcgPct} />
      </Suspense>

      {/* Sélecteur d'appareil */}
      <div className="absolute left-0 right-0 top-0 flex justify-center p-4">
        <GlassPanel className="flex gap-1.5 p-1.5">
          {AIRCRAFT_IDS.map((a) => {
            const s = getAircraft(a);
            return (
              <button key={a} type="button"
                onClick={() => store.set({ aircraft: a, loadout: defaultLoadout(a), mods: { ...DEFAULT_MODS } })}
                className={`rounded-2xl px-3.5 py-2 text-left transition-all duration-500 ${a === id ? 'bg-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]' : 'hover:bg-white/10'}`}
                style={{ transitionTimingFunction: 'var(--spring)' }}>
                <div className="text-[13px] font-semibold leading-tight">{s.name}</div>
                <div className="text-[10px] text-white/50">{s.manufacturer}</div>
              </button>
            );
          })}
        </GlassPanel>
      </div>

      {/* Chargement & centrage */}
      <GlassPanel className="absolute left-4 top-24 w-[300px] space-y-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold tracking-tight">{spec.name}</div>
            <div className="text-[11px] text-white/50">{CAT[spec.category]} · {spec.fcs === 'fbw' ? 'Commandes électriques (FBW)' : 'Commandes directes (câbles)'}</div>
          </div>
        </div>
        <SectionTitle>Masse & centrage</SectionTitle>
        <GlassSlider label="Carburant" value={lo.fuelKg} min={0} max={spec.mass.fuelMax} step={Math.max(1, spec.mass.fuelMax / 200)} onChange={(v) => set({ fuelKg: v })} format={(v) => (v / 1000).toFixed(v > 10000 ? 0 : 2)} unit="t" />
        <GlassSlider label="Charge utile" value={lo.payloadKg} min={0} max={spec.mass.payloadMax} step={Math.max(1, spec.mass.payloadMax / 200)} onChange={(v) => set({ payloadKg: v })} format={(v) => (v / 1000).toFixed(v > 10000 ? 0 : 2)} unit="t" />
        <GlassSlider label="Centrage X_cg" value={lo.xcgPct} min={spec.xcgRange[0] - 10} max={spec.xcgRange[1] + 15} step={0.5} onChange={(v) => set({ xcgPct: v })} format={(v) => v.toFixed(1)} unit="% MAC" hint={`Plage certifiée ${spec.xcgRange[0]}–${spec.xcgRange[1]} % · foyer ${npPercent(aero).toFixed(1)} %`} />
        <SectionTitle>Ajustements géométriques</SectionTitle>
        <GlassSlider label="Envergure" value={mods.wingSpan} min={0.85} max={1.15} step={0.01} onChange={(v) => setM({ wingSpan: v })} format={(v) => `${Math.round(v * 100)} %`} />
        <GlassSlider label="Flèche additionnelle" value={mods.wingSweep} min={-5} max={5} step={0.5} onChange={(v) => setM({ wingSweep: v })} unit="°" />
        <GlassSlider label="Dièdre additionnel" value={mods.dihedral} min={-4} max={4} step={0.5} onChange={(v) => setM({ dihedral: v })} unit="°" />
        <GlassSlider label={spec.surfaces.some((s) => s.role === 'canard') ? 'Aire des canards' : 'Aire de l\'empennage horizontal'} value={mods.tailArea} min={0.6} max={1.4} step={0.02} onChange={(v) => setM({ tailArea: v })} format={(v) => `${Math.round(v * 100)} %`} />
        <GlassSlider label="Aire des dérives" value={mods.finArea} min={0.6} max={1.4} step={0.02} onChange={(v) => setM({ finArea: v })} format={(v) => `${Math.round(v * 100)} %`} />
      </GlassPanel>

      {/* Performances */}
      <GlassPanel className="absolute right-4 top-24 w-[330px] space-y-3 p-5">
        <SectionTitle>Calcul instantané</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Masse" value={(mass / 1000).toFixed(mass > 10000 ? 1 : 3)} unit="t" tone={overMtow ? 'bad' : 'default'} />
          <Stat label="T/W" value={twr.toFixed(2)} tone={twr > 1 ? 'good' : 'default'} />
          <Stat label="Charge alaire" value={wl.toFixed(0)} unit="kg/m²" />
          <Stat label="Vs lisse" value={vs.toFixed(0)} unit="kt" />
          <Stat label="Vs volets" value={vsF.toFixed(0)} unit="kt" />
          <Stat label="Marge stat." value={`${sm >= 0 ? '+' : ''}${sm.toFixed(1)}`} unit="%" tone={v.verdict === 'stable' ? 'good' : v.verdict === 'limite' ? 'warn' : 'bad'} />
          <Stat label="CLα" value={aero.CLa.toFixed(2)} unit="/rad" small />
          <Stat label="Allongement" value={aero.aspect.toFixed(2)} small />
          <Stat label="Oswald e" value={aero.oswald.toFixed(2)} small />
        </div>
        {overMtow && <Badge tone="bad">Au-dessus de la MTOW ({(spec.mass.mtow / 1000).toFixed(1)} t)</Badge>}
        <div className="flex justify-center rounded-2xl bg-black/15 py-2">
          <Planform spec={spec} xcg={xcgFromPercent(aero, lo.xcgPct)} xnp={aero.xnp} width={290} height={250} />
        </div>
        <div className="text-[11px] leading-snug text-white/55">{spec.notes}</div>
        <div className="flex gap-2 pt-1">
          <GlassButton variant="primary" size="lg" className="flex-1" onClick={() => store.set({ screen: 'tunnel' })}>Soufflerie CFD →</GlassButton>
          <GlassButton size="lg" onClick={() => store.set({ screen: 'menu' })}>Menu</GlassButton>
        </div>
      </GlassPanel>
    </div>
  );
}
