/** Menu principal. */
import { store } from './store';
import { GlassButton, GlassPanel } from './glass';
import { sharedMemoryAvailable } from '../physics/bridge';

export function MainMenu() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_top,#2b4a7a_0%,#0e1626_55%,#05070c_100%)]">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[620px] w-[620px] rounded-full bg-[#0a84ff]/25 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 h-[520px] w-[520px] rounded-full bg-[#bf5af2]/20 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-10 left-1/3 h-[300px] w-[600px] rounded-full bg-[#ff9f0a]/10 blur-[100px]" />
      <GlassPanel className="w-[520px] p-10 text-center">
        <div className="text-[13px] font-semibold uppercase tracking-[0.3em] text-white/50">Studio de simulation</div>
        <div className="mt-2 text-5xl font-bold tracking-tight">AéroSim 3D</div>
        <div className="mt-3 text-[14px] text-white/60">Atelier · Soufflerie VLM couplée · Vol 6-DDL à 240 Hz</div>
        <div className="mt-8 flex flex-col gap-3">
          <GlassButton variant="primary" size="lg" onClick={() => store.set({ screen: 'hangar' })}>Atelier & choix de l'appareil</GlassButton>
          <GlassButton size="lg" onClick={() => store.set({ screen: 'tunnel' })}>Soufflerie CFD</GlassButton>
          <GlassButton size="lg" onClick={() => store.set({ screen: 'setup' })}>Vol rapide</GlassButton>
          <GlassButton size="lg" onClick={() => store.set({ settingsOpen: true })}>Paramètres</GlassButton>
        </div>
        <div className="mt-6 text-[11px] text-white/35">
          Physique : {sharedMemoryAvailable() ? 'SharedArrayBuffer (isolation cross-origin active)' : 'postMessage + buffers transférables (fallback)'}
        </div>
      </GlassPanel>
    </div>
  );
}
