/**
 * Store applicatif minimal (pattern external store + useSyncExternalStore).
 * Paramètres persistés dans localStorage (lecture/écriture protégées).
 */
import { useSyncExternalStore } from 'react';
import type { AircraftId } from '../aircraft/types';
import { DEFAULT_MODS, type GeometryMods } from '../aircraft/mods';
import type { AirportId, StartMode } from '../airports/airports';
import { getAircraft } from '../aircraft/specs';
import { defaultBindings, type Bindings } from '../controls/bindings';
import { defaultGamepadConfig, type GamepadConfig } from '../controls/gamepad';
import type { FlightRecord } from '../replay/blackbox';

export type Screen = 'menu' | 'hangar' | 'tunnel' | 'setup' | 'flight' | 'replay';
export type QualityPreset = 'eco' | 'medium' | 'high' | 'ultra' | 'cinema';

export interface GraphicsSettings {
  preset: QualityPreset;
  /** échelle de résolution interne (1 = natif, max 2 pour supersampling) */
  renderScale: number;
  /** résolution dynamique (DRS) */
  drs: boolean;
  targetFps: number;
  maxPixelRatio: number;
  shadows: boolean;
  shadowCascades: number;
  ssao: boolean;
  ssr: boolean;
  bloom: boolean;
  clouds: boolean;
  cloudRes: 0.5 | 0.25;
  pathTracing: boolean;
  ptBounces: number;
  ptMaxSamples: number;
  fov: number;
  showMetrics: boolean;
}

export interface WeatherSettings {
  windFrom: number;
  windSpeedKt: number;
  turbulence: number;
  cloudCover: number; // 0..1
  cloudBase: number; // m
  timeOfDay: number; // heures 0..24
  deltaIsa: number;
  seaState: number;
}

export interface AudioSettings {
  master: number;
  engines: number;
  ambience: number;
  alerts: number;
  cockpit: number;
  muted: boolean;
}

export interface ControlSettings {
  bindings: Bindings;
  mouseYoke: boolean;
  mouseSensitivity: number;
  mouseDeadzone: number;
  keyboardRate: number;
  gamepad: GamepadConfig;
}

export interface Settings {
  graphics: GraphicsSettings;
  weather: WeatherSettings;
  audio: AudioSettings;
  controls: ControlSettings;
}

export interface Loadout {
  fuelKg: number;
  payloadKg: number;
  xcgPct: number;
}

export interface AppState {
  screen: Screen;
  aircraft: AircraftId;
  loadout: Loadout;
  mods: GeometryMods;
  airport: AirportId;
  startMode: StartMode;
  settingsOpen: boolean;
  lastFlight: FlightRecord | null;
  settings: Settings;
  /** incrémenté à chaque (re)lancement de vol */
  flightId: number;
}

const PRESETS: Record<QualityPreset, Partial<GraphicsSettings>> = {
  eco: { renderScale: 0.75, shadows: false, shadowCascades: 1, ssao: false, ssr: false, bloom: false, clouds: true, cloudRes: 0.25, maxPixelRatio: 1 },
  medium: { renderScale: 1, shadows: true, shadowCascades: 2, ssao: false, ssr: false, bloom: true, clouds: true, cloudRes: 0.25, maxPixelRatio: 1.5 },
  high: { renderScale: 1, shadows: true, shadowCascades: 3, ssao: true, ssr: false, bloom: true, clouds: true, cloudRes: 0.5, maxPixelRatio: 2 },
  ultra: { renderScale: 1, shadows: true, shadowCascades: 4, ssao: true, ssr: true, bloom: true, clouds: true, cloudRes: 0.5, maxPixelRatio: 2 },
  cinema: { renderScale: 1.5, shadows: true, shadowCascades: 4, ssao: true, ssr: true, bloom: true, clouds: true, cloudRes: 0.5, maxPixelRatio: 2 },
};

export function presetValues(p: QualityPreset): Partial<GraphicsSettings> {
  return PRESETS[p];
}

export function defaultSettings(): Settings {
  return {
    graphics: {
      preset: 'high', renderScale: 1, drs: true, targetFps: 120, maxPixelRatio: 2, shadows: true, shadowCascades: 3, ssao: true, ssr: false,
      bloom: true, clouds: true, cloudRes: 0.5, pathTracing: true, ptBounces: 5, ptMaxSamples: 512, fov: 62, showMetrics: true,
    },
    weather: { windFrom: 140, windSpeedKt: 8, turbulence: 0.15, cloudCover: 0.45, cloudBase: 1400, timeOfDay: 14, deltaIsa: 0, seaState: 1 },
    audio: { master: 0.8, engines: 0.9, ambience: 0.6, alerts: 0.9, cockpit: 0.7, muted: false },
    controls: { bindings: defaultBindings(), mouseYoke: false, mouseSensitivity: 1, mouseDeadzone: 0.04, keyboardRate: 2.2, gamepad: defaultGamepadConfig() },
  };
}

const LS_KEY = 'aerosim3d.settings.v1';

function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      graphics: { ...d.graphics, ...s.graphics },
      weather: { ...d.weather, ...s.weather },
      audio: { ...d.audio, ...s.audio },
      controls: {
        ...d.controls, ...s.controls,
        bindings: { ...d.controls.bindings, ...(s.controls?.bindings ?? {}) },
        gamepad: { ...d.controls.gamepad, ...(s.controls?.gamepad ?? {}) },
      },
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible : ignoré */
  }
}

export function defaultLoadout(id: AircraftId): Loadout {
  const s = getAircraft(id);
  return { fuelKg: Math.round(s.mass.fuelMax * 0.45), payloadKg: Math.round(s.mass.payloadMax * 0.4), xcgPct: s.xcgDefault };
}

type Listener = () => void;

class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor() {
    const aircraft: AircraftId = 'rafale';
    this.state = {
      screen: 'menu', aircraft, loadout: defaultLoadout(aircraft), mods: { ...DEFAULT_MODS }, airport: 'lfbo', startMode: 'runway',
      settingsOpen: false, lastFlight: null, settings: loadSettings(), flightId: 0,
    };
  }

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    if (p.settings) saveSettings(this.state.settings);
    for (const l of this.listeners) l();
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const store = new Store();

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()), () => sel(store.get()));
}

export function updateSettings<K extends keyof Settings>(key: K, patch: Partial<Settings[K]>): void {
  store.set((s) => ({ settings: { ...s.settings, [key]: { ...s.settings[key], ...patch } } }));
}
