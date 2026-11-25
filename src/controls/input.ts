/**
 * Agrégateur d'entrées : clavier (remappable), souris-yoke, manette/HOTAS, clics cockpit.
 * Produit l'état « pilote » et l'écrit dans le Float64Array de commandes du pont physique.
 */
import type { AircraftSpec } from '../aircraft/types';
import { I, LIGHT } from '../physics/layout';
import { ACTIONS, type Action, type Bindings } from './bindings';
import { sampleGamepad, type GamepadConfig, type GamepadSample } from './gamepad';
import { clamp } from '../physics/math';

export interface InputSettings {
  bindings: Bindings;
  mouseYoke: boolean;
  mouseSensitivity: number;
  mouseDeadzone: number;
  keyboardRate: number;
  gamepad: GamepadConfig;
}

/** État pilote (leviers, interrupteurs) — modifiable par le clavier ET le cockpit 3D. */
export interface PilotState {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  flapIndex: number;
  gearDown: boolean;
  speedbrake: boolean;
  spoilerArm: boolean;
  brakes: number;
  parking: boolean;
  hook: boolean;
  trim: number;
  lawDirect: boolean;
  apHdg: boolean;
  apAlt: boolean;
  apAthr: boolean;
  hdgTarget: number;
  altTarget: number;
  spdTarget: number;
  lights: number;
  battery: boolean;
  apu: boolean;
  pumps: boolean;
  avionics: boolean;
  engineStart: number;
  catapult: boolean;
  failEngine: number;
  failFbw: number;
  windshear: boolean;
  engineCut: number;
  stovl: boolean;
  nozzle: number;
}

const HOLD = new Set(ACTIONS.filter((a) => a.hold).map((a) => a.id));

export class InputManager {
  readonly pilot: PilotState;
  private settings: InputSettings;
  private spec: AircraftSpec;
  private down = new Set<string>();
  private codeToActions = new Map<string, Action[]>();
  private mouseX = 0;
  private mouseY = 0;
  private gp: GamepadSample = { connected: false, pitch: 0, roll: 0, yaw: 0, throttle: null, pressed: new Set() };
  private gpPrev = new Set<Action>();
  private lastThrottleAxis: number | null = null;
  onAction: ((a: Action) => void) | null = null;
  /** bloque les entrées clavier (ex. saisie de remapping) */
  enabled = true;
  private attached: HTMLElement | null = null;

  constructor(spec: AircraftSpec, settings: InputSettings, cold: boolean) {
    this.spec = spec;
    this.settings = settings;
    const det = spec.perf.flapDetents;
    this.pilot = {
      pitch: 0, roll: 0, yaw: 0, throttle: 0, flapIndex: cold ? 0 : Math.min(1, det.length - 1), gearDown: true, speedbrake: false,
      spoilerArm: false, brakes: 0, parking: cold, hook: false, trim: 0, lawDirect: false, apHdg: false, apAlt: false, apAthr: false,
      hdgTarget: 0, altTarget: 3000, spdTarget: spec.perf.vApp, lights: cold ? 0 : LIGHT.NAV | LIGHT.BEACON | LIGHT.STROBE,
      battery: !cold, apu: false, pumps: !cold, avionics: !cold, engineStart: 0, catapult: false, failEngine: 0, failFbw: 0, windshear: false, engineCut: 0, stovl: false, nozzle: 0,
    };
    this.rebuildMap();
  }

  setSettings(s: InputSettings): void {
    this.settings = s;
    this.rebuildMap();
  }

  private rebuildMap(): void {
    this.codeToActions.clear();
    for (const [a, codes] of Object.entries(this.settings.bindings) as [Action, string[]][]) {
      for (const c of codes) {
        const l = this.codeToActions.get(c) ?? [];
        l.push(a);
        this.codeToActions.set(c, l);
      }
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const actions = this.codeToActions.get(e.code);
    if (!actions) return;
    e.preventDefault();
    if (this.down.has(e.code)) return; // répétition auto
    this.down.add(e.code);
    for (const a of actions) if (!HOLD.has(a)) this.trigger(a);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    const w = window.innerWidth, h = window.innerHeight;
    this.mouseX = (e.clientX / w) * 2 - 1;
    this.mouseY = (e.clientY / h) * 2 - 1;
  };

  private onBlur = () => this.down.clear();

  attach(el: HTMLElement): void {
    this.attached = el;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.onBlur);
    this.attached = null;
  }

  isAttached(): boolean {
    return this.attached !== null;
  }

  private held(a: Action): boolean {
    for (const c of this.settings.bindings[a] ?? []) if (this.down.has(c)) return true;
    return this.gp.pressed.has(a);
  }

  /** Déclenche une action impulsionnelle (clavier, manette ou clic cockpit). */
  trigger(a: Action): void {
    const p = this.pilot;
    const det = this.spec.perf.flapDetents;
    switch (a) {
      case 'flapsDown': p.flapIndex = Math.min(det.length - 1, p.flapIndex + 1); break;
      case 'flapsUp': p.flapIndex = Math.max(0, p.flapIndex - 1); break;
      case 'gearToggle': p.gearDown = !p.gearDown; break;
      case 'speedbrakeToggle': p.speedbrake = !p.speedbrake; break;
      case 'spoilerArm': p.spoilerArm = !p.spoilerArm; break;
      case 'parkingBrake': p.parking = !p.parking; break;
      case 'hookToggle': if (this.spec.hasHook) p.hook = !p.hook; break;
      case 'catapult': p.catapult = true; break;
      case 'stovlToggle': if (this.spec.stovl) { p.stovl = !p.stovl; if (!p.stovl) p.nozzle = 0; } break;
      case 'throttleIdle': p.throttle = 0; break;
      case 'throttleMax': p.throttle = 1; break;
      case 'fbwToggle': if (this.spec.fcs === 'fbw') p.lawDirect = !p.lawDirect; break;
      case 'autopilot': {
        const on = !(p.apHdg || p.apAlt);
        p.apHdg = on; p.apAlt = on; p.apAthr = on;
        break;
      }
      case 'landingLights': p.lights ^= LIGHT.LANDING; break;
      default: break;
    }
    this.onAction?.(a);
  }

  /** Mise à jour par frame : intègre les axes clavier, souris, manette. */
  update(dt: number): void {
    const p = this.pilot;
    const s = this.settings;
    const gp = sampleGamepad(s.gamepad, this.gp);
    // boutons manette : fronts montants pour les actions impulsionnelles
    for (const a of gp.pressed) if (!this.gpPrev.has(a) && !HOLD.has(a)) this.trigger(a);
    this.gpPrev.clear();
    for (const a of gp.pressed) this.gpPrev.add(a);

    const rate = s.keyboardRate * dt;
    const axis = (cur: number, pos: boolean, neg: boolean) => {
      if (pos && !neg) return Math.min(1, cur + rate);
      if (neg && !pos) return Math.max(-1, cur - rate);
      // retour au neutre
      const back = rate * 1.6;
      return Math.abs(cur) < back ? 0 : cur - Math.sign(cur) * back;
    };
    let kp = axis(this.kp, this.held('pitchUp'), this.held('pitchDown'));
    let kr = axis(this.kr, this.held('rollRight'), this.held('rollLeft'));
    let ky = axis(this.ky, this.held('yawRight'), this.held('yawLeft'));
    this.kp = kp; this.kr = kr; this.ky = ky;
    if (s.mouseYoke) {
      const dz = s.mouseDeadzone;
      const f = (v: number) => (Math.abs(v) < dz ? 0 : clamp(((Math.abs(v) - dz) / (1 - dz)) * Math.sign(v) * s.mouseSensitivity, -1, 1));
      kp = clamp(kp + f(this.mouseY), -1, 1);
      kr = clamp(kr + f(this.mouseX), -1, 1);
    }
    p.pitch = clamp(kp + gp.pitch, -1, 1);
    p.roll = clamp(kr + gp.roll, -1, 1);
    p.yaw = clamp(ky + gp.yaw, -1, 1);
    // gaz : clavier incrémental, axe manette absolu (seulement s'il bouge)
    if (this.held('throttleUp')) p.throttle = Math.min(1, p.throttle + 0.5 * dt);
    if (this.held('throttleDown')) p.throttle = Math.max(0, p.throttle - 0.5 * dt);
    if (gp.throttle !== null) {
      if (this.lastThrottleAxis === null || Math.abs(gp.throttle - this.lastThrottleAxis) > 0.01) {
        p.throttle = gp.throttle;
        this.lastThrottleAxis = gp.throttle;
      }
    }
    if (this.held('trimUp')) p.trim = Math.min(1, p.trim + 0.12 * dt);
    if (this.held('trimDown')) p.trim = Math.max(-1, p.trim - 0.12 * dt);
    p.brakes = this.held('brakes') ? 1 : 0;
    if (p.stovl) {
      if (this.held('nozzleDown')) p.nozzle = Math.min(1, p.nozzle + 0.35 * dt);
      if (this.held('nozzleUp')) p.nozzle = Math.max(0, p.nozzle - 0.35 * dt);
    }
  }
  private kp = 0;
  private kr = 0;
  private ky = 0;

  /** Écrit l'état pilote dans le tableau de commandes du worker. */
  write(inp: Float64Array): void {
    const p = this.pilot;
    const det = this.spec.perf.flapDetents;
    inp[I.PITCH] = p.pitch;
    inp[I.ROLL] = p.roll;
    inp[I.YAW] = p.yaw;
    inp[I.THROTTLE] = p.throttle;
    inp[I.FLAPS] = det[p.flapIndex] ?? 0;
    inp[I.GEAR] = p.gearDown ? 1 : 0;
    inp[I.SPEEDBRAKE] = p.speedbrake ? 1 : 0;
    inp[I.BRAKE_L] = p.brakes;
    inp[I.BRAKE_R] = p.brakes;
    inp[I.PARKING] = p.parking ? 1 : 0;
    inp[I.HOOK] = p.hook ? 1 : 0;
    inp[I.TRIM] = p.trim;
    inp[I.FCS_LAW_REQ] = p.lawDirect ? 2 : 0;
    inp[I.AP_HDG_ON] = p.apHdg ? 1 : 0;
    inp[I.AP_ALT_ON] = p.apAlt ? 1 : 0;
    inp[I.AP_ATHR_ON] = p.apAthr ? 1 : 0;
    inp[I.AP_HDG] = p.hdgTarget;
    inp[I.AP_ALT] = p.altTarget;
    inp[I.AP_SPD] = p.spdTarget;
    inp[I.LIGHTS] = p.lights;
    inp[I.BATTERY] = p.battery ? 1 : 0;
    inp[I.APU] = p.apu ? 1 : 0;
    inp[I.PUMPS] = p.pumps ? 1 : 0;
    inp[I.AVIONICS] = p.avionics ? 1 : 0;
    inp[I.ENGINE_START] = p.engineStart;
    inp[I.CATAPULT] = p.catapult ? 1 : 0;
    inp[I.SPOILER_ARM] = p.spoilerArm ? 1 : 0;
    inp[I.FAIL_ENGINE] = p.failEngine;
    inp[I.FAIL_FBW] = p.failFbw;
    inp[I.WINDSHEAR] = p.windshear ? 1 : 0;
    inp[I.ENGINE_CUT] = p.engineCut;
    inp[I.STOVL] = p.stovl ? 1 : 0;
    inp[I.NOZZLE] = p.nozzle;
  }
}
