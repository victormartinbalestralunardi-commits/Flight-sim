/** Routage des écrans. */
import { lazy, Suspense } from 'react';
import { useStore } from './store';
import { MainMenu } from './MainMenu';
import { Hangar } from './Hangar';
import { WindTunnel } from './WindTunnel';
import { FlightSetup } from './FlightSetup';
import { SettingsModal } from './Settings';

const FlightView = lazy(() => import('./FlightView'));

export function App() {
  const screen = useStore((s) => s.screen);
  const flightId = useStore((s) => s.flightId);
  return (
    <div className="relative h-full w-full bg-black text-white">
      {screen === 'menu' && <MainMenu />}
      {screen === 'hangar' && <Hangar />}
      {screen === 'tunnel' && <WindTunnel />}
      {screen === 'setup' && <FlightSetup />}
      {(screen === 'flight' || screen === 'replay') && (
        <Suspense fallback={<div className="flex h-full items-center justify-center text-white/60">Chargement du monde…</div>}>
          <FlightView key={flightId} />
        </Suspense>
      )}
      <SettingsModal />
    </div>
  );
}
