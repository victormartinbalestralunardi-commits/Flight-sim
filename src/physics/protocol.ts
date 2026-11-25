/** Messages échangés entre le thread principal et le worker physique. */
import type { AircraftId } from '../aircraft/types';
import type { GeometryMods } from '../aircraft/mods';
import type { AirportId, StartMode } from '../airports/airports';
import type { AeroDerivatives } from '../cfd/derivatives';
import type { FlightEvent } from './flightModel';
import type { WindConfig } from './wind';

export interface SimConfig {
  aircraft: AircraftId;
  mods: GeometryMods;
  xcgPct: number;
  fuelKg: number;
  payloadKg: number;
  airport: AirportId;
  startMode: StartMode;
  wind: WindConfig;
  deltaIsa: number;
  seaState: number;
}

export type ToWorker =
  | { type: 'init'; config: SimConfig; sab: SharedArrayBuffer | null }
  | { type: 'input'; data: Float64Array }
  | { type: 'recycle'; buf: Float64Array }
  | { type: 'stop' };

export interface ReadyInfo {
  aero: AeroDerivatives;
  initialThrottle: number;
  xcg: number;
  mass: number;
  mode: 'sab' | 'postMessage';
  trimElev: number;
}

export type FromWorker =
  | { type: 'ready'; info: ReadyInfo }
  | { type: 'state'; buf: Float64Array }
  | { type: 'events'; events: FlightEvent[] }
  | { type: 'error'; message: string };
