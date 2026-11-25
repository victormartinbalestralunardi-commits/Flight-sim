/**
 * Manette / joystick / HOTAS via la Gamepad API : détection, assignation d'axes et de
 * boutons, zone morte, courbe exponentielle.
 */
import type { Action } from './bindings';

export type AxisName = 'pitch' | 'roll' | 'yaw' | 'throttle';

export interface AxisMap {
  index: number; // −1 = non assigné
  invert: boolean;
}

export interface GamepadConfig {
  enabled: boolean;
  deviceIndex: number; // −1 = premier détecté
  axes: Record<AxisName, AxisMap>;
  deadzone: number;
  expo: number; // 0 = linéaire, 1 = cubique
  /** gaz sur axe bipolaire (−1..1 → 0..1) */
  throttleBipolar: boolean;
  buttons: Partial<Record<Action, number>>;
}

export function defaultGamepadConfig(): GamepadConfig {
  return {
    enabled: true,
    deviceIndex: -1,
    axes: {
      roll: { index: 0, invert: false },
      pitch: { index: 1, invert: false },
      yaw: { index: 2, invert: false },
      throttle: { index: 3, invert: true },
    },
    deadzone: 0.08,
    expo: 0.35,
    throttleBipolar: true,
    buttons: { gearToggle: 3, flapsDown: 1, flapsUp: 2, brakes: 0, speedbrakeToggle: 4, hookToggle: 5, cameraNext: 9, pause: 8 },
  };
}

/** Zone morte rééchelonnée + courbe expo : y = (1−e)x + e x³. */
export function shapeAxis(v: number, deadzone: number, expo: number): number {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  const x = Math.min(1, (a - deadzone) / (1 - deadzone));
  const y = (1 - expo) * x + expo * x * x * x;
  return Math.sign(v) * y;
}

export function listGamepads(): Gamepad[] {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
  return (navigator.getGamepads() ?? []).filter((g): g is Gamepad => !!g && g.connected);
}

export function pickGamepad(cfg: GamepadConfig): Gamepad | null {
  const pads = listGamepads();
  if (!pads.length) return null;
  if (cfg.deviceIndex >= 0) return pads.find((p) => p.index === cfg.deviceIndex) ?? null;
  return pads[0];
}

export interface GamepadSample {
  connected: boolean;
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number | null;
  pressed: Set<Action>;
}

/** Échantillonne la manette (axes façonnés + boutons appuyés). */
export function sampleGamepad(cfg: GamepadConfig, out: GamepadSample): GamepadSample {
  out.pressed.clear();
  const gp = cfg.enabled ? pickGamepad(cfg) : null;
  out.connected = !!gp;
  if (!gp) {
    out.pitch = 0; out.roll = 0; out.yaw = 0; out.throttle = null;
    return out;
  }
  const ax = (m: AxisMap) => (m.index >= 0 && m.index < gp.axes.length ? (m.invert ? -1 : 1) * gp.axes[m.index] : 0);
  // pitch : manche tiré (axe +) = cabrer
  out.pitch = shapeAxis(ax(cfg.axes.pitch), cfg.deadzone, cfg.expo);
  out.roll = shapeAxis(ax(cfg.axes.roll), cfg.deadzone, cfg.expo);
  out.yaw = shapeAxis(ax(cfg.axes.yaw), cfg.deadzone, cfg.expo * 0.5);
  if (cfg.axes.throttle.index >= 0 && cfg.axes.throttle.index < gp.axes.length) {
    const t = ax(cfg.axes.throttle);
    out.throttle = cfg.throttleBipolar ? (t + 1) / 2 : Math.max(0, t);
  } else out.throttle = null;
  for (const [action, bi] of Object.entries(cfg.buttons) as [Action, number][]) {
    if (bi !== undefined && gp.buttons[bi]?.pressed) out.pressed.add(action);
  }
  return out;
}
