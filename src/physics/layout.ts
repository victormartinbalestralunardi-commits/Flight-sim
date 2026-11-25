/**
 * Layout des buffers partagés main ⇄ worker.
 * OUT : snapshot d'état publié par le worker (Float64Array).
 * IN  : commandes publiées par le thread principal (Float64Array).
 */

export const O = {
  SIM_TIME: 0,
  WALL_TIME: 1,
  PX: 2, PY: 3, PZ: 4,
  QX: 5, QY: 6, QZ: 7, QW: 8,
  VX: 9, VY: 10, VZ: 11,
  WX: 12, WY: 13, WZ: 14,
  ALPHA: 15,
  BETA: 16,
  TAS: 17,
  CAS: 18,
  MACH: 19,
  NZ: 20,
  NX: 21,
  NY: 22,
  ALT: 23,
  AGL: 24,
  VS: 25,
  HEADING: 26,
  PITCH: 27,
  BANK: 28,
  THRUST: 29,
  N1: 30, // 4 moteurs : 30..33
  EGT: 34, // 34..37
  FF: 38, // 38..41 (kg/h)
  FUEL: 42,
  MASS: 43,
  ELEV: 44,
  AIL: 45,
  RUD: 46,
  FLAPS: 47,
  GEAR: 48,
  SPOILER: 49,
  SPEEDBRAKE: 50,
  HOOK: 51,
  BRAKE: 52,
  AB: 53,
  NOZZLE: 54,
  CANARD: 55,
  ON_GROUND: 56,
  COMP_N: 57,
  COMP_L: 58,
  COMP_R: 59,
  STALL_WARN: 60,
  BUFFET: 61,
  FCS_LAW: 62,
  AP_FLAGS: 63,
  CRASHED: 64,
  WIRE: 65,
  CAT_STATE: 66,
  WIND_X: 67, WIND_Y: 68, WIND_Z: 69,
  BLACKOUT: 70,
  REDOUT: 71,
  CL: 72,
  CD: 73,
  QDYN: 74,
  SURF_VX: 75,
  SURF_VZ: 76,
  PROP_RPM: 77,
  TD_VS: 78,
  TD_COUNT: 79,
  ENG_RUN: 80,
  APU: 81,
  BATTERY: 82,
  AVIONICS: 83,
  PUMPS: 84,
  STICK_P: 85,
  STICK_R: 86,
  PEDALS: 87,
  THROTTLE: 88,
  GPWS: 89,
  CARRIER_X: 90, CARRIER_Z: 91, CARRIER_HDG: 92, CARRIER_PITCH: 93, CARRIER_ROLL: 94, CARRIER_HEAVE: 95,
  LIGHTS: 96,
  PARKING: 97,
  WING_FLEX: 98,
  GS: 99,
  N2: 100, // 100..103
  TRIM: 104,
  AOA_LIMIT: 105,
  GROUND_H: 106,
  SURF_KIND: 107,
  STALLED: 108,
  WIND_SHEAR: 109,
  STOVL: 110, // 0..1 ouverture portes soufflante
  NOZZLE_ANGLE: 111, // rad
  CAT_S: 112, // course de la navette de catapulte (m)
  CAT_INDEX: 113, // catapulte utilisée (−1 aucune)
  WIRE_PULL: 114, // longueur de câble déroulée depuis l'engagement (m)
  CAT_V: 115, // vitesse de la navette (m/s)
} as const;
export const OUT_SIZE = 116;

export const I = {
  PITCH: 0,
  ROLL: 1,
  YAW: 2,
  THROTTLE: 3, // 3..6 par moteur
  FLAPS: 8,
  GEAR: 9,
  SPEEDBRAKE: 10,
  BRAKE_L: 11,
  BRAKE_R: 12,
  PARKING: 13,
  HOOK: 14,
  TRIM: 15,
  FCS_LAW_REQ: 16, // 0 normale, 1 alternate, 2 directe
  AP_HDG_ON: 17,
  AP_ALT_ON: 18,
  AP_ATHR_ON: 19,
  AP_HDG: 20,
  AP_ALT: 21,
  AP_SPD: 22,
  LIGHTS: 23,
  BATTERY: 24,
  APU: 25,
  PUMPS: 26,
  ENGINE_START: 27, // masque de bits
  AVIONICS: 28,
  CATAPULT: 29,
  PAUSED: 30,
  SPOILER_ARM: 31,
  TIME_SCALE: 32,
  FAIL_ENGINE: 33, // masque
  FAIL_FBW: 34, // 0 aucune, 1 alternate, 2 directe
  WINDSHEAR: 35,
  RESET: 36,
  ENGINE_CUT: 37, // masque coupure carburant manuelle
  STOVL: 38, // mode STOVL demandé (F-35B)
  NOZZLE: 39, // consigne tuyère 0..1 (0 = horizontale, 1 = 95°)
} as const;
export const IN_SIZE = 40;

/** Feux (masque). */
export const LIGHT = { NAV: 1, STROBE: 2, LANDING: 4, BEACON: 8, TAXI: 16 } as const;
/** Pilote automatique (masque O.AP_FLAGS). */
export const AP = { HDG: 1, ALT: 2, ATHR: 4 } as const;

/** Nombre de snapshots dans l'anneau SharedArrayBuffer. */
export const RING = 8;
/** Header Int32 : [seq, writing] */
export const HEADER_INTS = 4;

export function sabBytes(): number {
  return HEADER_INTS * 4 + RING * OUT_SIZE * 8 + IN_SIZE * 8;
}

export interface SabViews {
  header: Int32Array;
  ring: Float64Array; // RING * OUT_SIZE
  input: Float64Array;
}

export function sabViews(buf: SharedArrayBuffer | ArrayBuffer): SabViews {
  const header = new Int32Array(buf, 0, HEADER_INTS);
  const ring = new Float64Array(buf, HEADER_INTS * 4, RING * OUT_SIZE);
  const input = new Float64Array(buf, HEADER_INTS * 4 + RING * OUT_SIZE * 8, IN_SIZE);
  return { header, ring, input };
}
