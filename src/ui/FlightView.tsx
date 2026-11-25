/** Vue de vol (implémentée au Sprint 3/4). */
import { store } from './store';
import { GlassButton, GlassPanel } from './glass';

export default function FlightView() {
  return (
    <div className="flex h-full items-center justify-center">
      <GlassPanel className="p-8">
        <div className="mb-4">Vue de vol : Sprint 3.</div>
        <GlassButton onClick={() => store.set({ screen: 'menu' })}>Menu</GlassButton>
      </GlassPanel>
    </div>
  );
}
