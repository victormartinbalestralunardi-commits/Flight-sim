/** Choix de l'aéroport et du mode de départ avant le vol. */
import { AIRPORT_IDS, getAirport, type AirportId, type StartMode } from '../airports/airports';
import { getAircraft } from '../aircraft/specs';
import { store, useStore } from './store';
import { Badge, GlassButton, GlassPanel, SectionTitle } from './glass';

const MODES: { id: StartMode; title: string; desc: string }[] = [
  { id: 'cold', title: 'Parking « Cold & Dark »', desc: 'Avion éteint, check-list guidée : batterie → APU → pompes → moteurs → avionique.' },
  { id: 'runway', title: 'Seuil de piste', desc: 'Prêt au décollage, moteurs allumés et configurés (catapulte sur porte-avions).' },
  { id: 'final', title: 'Finale à 5 NM', desc: 'En vol, aligné et stabilisé sur le plan de descente à la vitesse d\'approche.' },
];

export function FlightSetup() {
  const ap = useStore((s) => s.airport);
  const mode = useStore((s) => s.startMode);
  const id = useStore((s) => s.aircraft);
  const spec = getAircraft(id);
  const warnCarrier = ap === 'cvn' && !spec.hasHook && !spec.stovl;
  return (
    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(ellipse_at_bottom,#23406b_0%,#0c1320_60%,#05070c_100%)] p-8">
      <GlassPanel className="w-[960px] max-w-full p-8">
        <div className="flex items-baseline justify-between">
          <div className="text-2xl font-bold tracking-tight">Préparation du vol — {spec.name}</div>
          <Badge tone="info">{spec.fcs === 'fbw' ? 'FBW C*' : 'Loi directe'}</Badge>
        </div>
        <SectionTitle>Aéroport</SectionTitle>
        <div className="grid grid-cols-4 gap-3">
          {AIRPORT_IDS.map((a) => {
            const d = getAirport(a);
            const sel = a === ap;
            return (
              <button key={a} type="button" onClick={() => store.set({ airport: a as AirportId })}
                className={`rounded-2xl border p-4 text-left transition-all duration-500 ${sel ? 'scale-[1.02] border-white/50 bg-white/20' : 'border-white/15 bg-white/5 hover:bg-white/10'}`}
                style={{ transitionTimingFunction: 'var(--spring)' }}>
                <div className="text-[11px] font-semibold tracking-[0.15em] text-white/50">{d.icao}</div>
                <div className="text-[15px] font-semibold leading-tight">{d.name}</div>
                <div className="mt-2 text-[11px] leading-snug text-white/60">{d.description}</div>
              </button>
            );
          })}
        </div>
        <SectionTitle>Mode de départ</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          {MODES.map((m) => (
            <button key={m.id} type="button" onClick={() => store.set({ startMode: m.id })}
              className={`rounded-2xl border p-4 text-left transition-all duration-500 ${m.id === mode ? 'scale-[1.02] border-white/50 bg-white/20' : 'border-white/15 bg-white/5 hover:bg-white/10'}`}
              style={{ transitionTimingFunction: 'var(--spring)' }}>
              <div className="text-[15px] font-semibold">{m.title}</div>
              <div className="mt-1 text-[11px] leading-snug text-white/60">{m.desc}</div>
            </button>
          ))}
        </div>
        {ap === 'cvn' && spec.stovl && <div className="mt-4 text-[12px] text-[#9fd0ff]">F-35B : pas de crosse — décollage court (STO) depuis l'arrière du pont, appontage vertical (Y = mode STOVL, « . » / « , » = tuyère, levier = vitesse verticale).</div>}
        {warnCarrier && <div className="mt-4 text-[12px] text-[#ffd25a]">⚠ {spec.name} n'a pas de crosse : l'appontage sera impossible (seul le décollage catapulté reste possible).</div>}
        <div className="mt-6 flex justify-end gap-2">
          <GlassButton onClick={() => store.set({ settingsOpen: true })}>Météo & paramètres</GlassButton>
          <GlassButton onClick={() => store.set({ screen: 'hangar' })}>Atelier</GlassButton>
          <GlassButton variant="success" size="lg" onClick={() => store.set((s) => ({ screen: 'flight', flightId: s.flightId + 1 }))}>Décoller</GlassButton>
        </div>
      </GlassPanel>
    </div>
  );
}
