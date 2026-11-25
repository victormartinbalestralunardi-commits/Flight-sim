/**
 * Enregistreur de vol (« boîte noire ») : échantillonnage à 10 Hz (≥ 1 point par seconde exigé)
 * de la trajectoire, de l'attitude, de α, du facteur de charge, de V_z et de l'écart à l'axe ;
 * analyse automatique de l'atterrissage (taux de chute, distance de freinage, écart latéral).
 */
import { O } from '../physics/layout';
import type { AircraftId } from '../aircraft/types';
import type { AirportId } from '../airports/airports';
import { approachRef, dirFromHeading, getAirport } from '../airports/airports';
import { FT, KT } from '../physics/math';

export const REC_FIELDS = ['t', 'x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'alpha', 'nz', 'vs', 'tas', 'lat', 'agl', 'gear', 'flaps', 'onGround', 'elev', 'ail', 'rud', 'gs'] as const;
export type RecField = (typeof REC_FIELDS)[number];
const NF = REC_FIELDS.length;
const IDX = Object.fromEntries(REC_FIELDS.map((f, i) => [f, i])) as Record<RecField, number>;

export interface TouchdownInfo {
  t: number;
  vsFpm: number;
  lateral: number;
  distanceFromThreshold: number;
  gForce: number;
}

export interface LandingAnalysis {
  touchdown: TouchdownInfo | null;
  brakingDistance: number | null;
  stopped: boolean;
  maxG: number;
  minG: number;
  maxAlpha: number;
  wire: number;
  verdict: string;
}

export interface FlightRecord {
  aircraft: AircraftId;
  airport: AirportId;
  data: Float32Array; // n × NF
  n: number;
  hz: number;
  crashed: string | null;
  analysis: LandingAnalysis;
}

export class BlackBox {
  private buf: Float32Array;
  private n = 0;
  private acc = 0;
  readonly hz = 10;
  private readonly ap;
  private tdDone = false;
  private td: TouchdownInfo | null = null;
  private stopT: number | null = null;
  private rollDist = 0;
  private maxG = 1;
  private minG = 1;
  private maxAlpha = 0;
  private wire = 0;
  crashed: string | null = null;
  private wasGround = true;

  constructor(readonly aircraft: AircraftId, readonly airport: AirportId, maxSeconds = 3600) {
    this.buf = new Float32Array(maxSeconds * this.hz * NF);
    this.ap = getAirport(airport);
  }

  /** Appelé à chaque frame avec l'état interpolé ; enregistre à 10 Hz. */
  record(s: Float64Array, dt: number): void {
    this.maxG = Math.max(this.maxG, s[O.NZ]);
    this.minG = Math.min(this.minG, s[O.NZ]);
    this.maxAlpha = Math.max(this.maxAlpha, s[O.ALPHA]);
    if (s[O.WIRE] > 0) this.wire = s[O.WIRE];
    const onGround = s[O.ON_GROUND] > 0;
    // toucher : première transition air → sol après un vol
    if (onGround && !this.wasGround && !this.tdDone) {
      const ref = approachRef(this.ap, s[O.SIM_TIME]);
      const [dx, dz] = dirFromHeading(ref.heading);
      const px = s[O.PX] - ref.x, pz = s[O.PZ] - ref.z;
      const lateral = px * -dz + pz * dx;
      const along = px * dx + pz * dz;
      const thr = this.ap.runways[0];
      const distThr = thr ? (s[O.PX] - thr.thrX) * dx + (s[O.PZ] - thr.thrZ) * dz : along;
      this.td = { t: s[O.SIM_TIME], vsFpm: (s[O.TD_VS] / FT) * 60, lateral, distanceFromThreshold: distThr, gForce: s[O.NZ] };
      this.tdDone = true;
    }
    this.wasGround = onGround;
    const relSpeed = Math.hypot(s[O.VX] - s[O.SURF_VX], s[O.VZ] - s[O.SURF_VZ]);
    if (this.tdDone && this.stopT === null) {
      // distance parcourue relativement à la surface (suit le pont mobile)
      this.rollDist += relSpeed * dt;
      if (onGround && relSpeed < 3 * KT) this.stopT = s[O.SIM_TIME];
    }
    this.acc += dt;
    if (this.acc < 1 / this.hz) return;
    this.acc -= 1 / this.hz;
    if ((this.n + 1) * NF > this.buf.length) return;
    const o = this.n * NF;
    const b = this.buf;
    const ref = approachRef(this.ap, s[O.SIM_TIME]);
    const [dx, dz] = dirFromHeading(ref.heading);
    b[o + IDX.t] = s[O.SIM_TIME];
    b[o + IDX.x] = s[O.PX]; b[o + IDX.y] = s[O.PY]; b[o + IDX.z] = s[O.PZ];
    b[o + IDX.qx] = s[O.QX]; b[o + IDX.qy] = s[O.QY]; b[o + IDX.qz] = s[O.QZ]; b[o + IDX.qw] = s[O.QW];
    b[o + IDX.alpha] = s[O.ALPHA]; b[o + IDX.nz] = s[O.NZ]; b[o + IDX.vs] = s[O.VS]; b[o + IDX.tas] = s[O.TAS];
    b[o + IDX.lat] = (s[O.PX] - ref.x) * -dz + (s[O.PZ] - ref.z) * dx;
    b[o + IDX.agl] = s[O.AGL]; b[o + IDX.gear] = s[O.GEAR]; b[o + IDX.flaps] = s[O.FLAPS]; b[o + IDX.onGround] = s[O.ON_GROUND];
    b[o + IDX.elev] = s[O.ELEV]; b[o + IDX.ail] = s[O.AIL]; b[o + IDX.rud] = s[O.RUD]; b[o + IDX.gs] = s[O.GS];
    this.n++;
  }

  finish(): FlightRecord {
    const braking: number | null = this.stopT !== null ? this.rollDist : null;
    const td = this.td;
    let verdict = 'Pas de toucher enregistré.';
    if (this.crashed) verdict = `Accident : ${this.crashed}`;
    else if (td) {
      const v = -Math.abs(td.vsFpm);
      if (Math.abs(td.vsFpm) < 240) verdict = 'Atterrissage « kiss » — excellent.';
      else if (Math.abs(td.vsFpm) < 480) verdict = 'Atterrissage ferme mais correct.';
      else if (Math.abs(td.vsFpm) < 700) verdict = 'Atterrissage dur — inspection du train recommandée.';
      else verdict = `Atterrissage très dur (${v.toFixed(0)} ft/min).`;
      if (this.wire) verdict += ` Brin n°${this.wire} accroché.`;
    }
    return {
      aircraft: this.aircraft, airport: this.airport, data: this.buf.slice(0, this.n * NF), n: this.n, hz: this.hz, crashed: this.crashed,
      analysis: { touchdown: td, brakingDistance: braking, stopped: this.stopT !== null, maxG: this.maxG, minG: this.minG, maxAlpha: this.maxAlpha, wire: this.wire, verdict },
    };
  }
}

export function recField(r: FlightRecord, i: number, f: RecField): number {
  return r.data[i * NF + IDX[f]];
}

export const REC_STRIDE = NF;
export const REC_INDEX = IDX;
