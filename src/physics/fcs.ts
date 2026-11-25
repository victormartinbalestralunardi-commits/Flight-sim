/**
 * Lois de commandes de vol.
 *
 * - DIRECT : manche → gouvernes (+ compensateur), aucune augmentation (DR-400, ou dégradé).
 * - FBW NORMALE (C*) : inversion dynamique non linéaire (NDI, comme le F-35) sur un
 *   critère C* = n_z + (V_co/g)·q, auto-trim en n_z (intégrateur), compensation
 *   d'inclinaison jusqu'à 33°, protection d'incidence α_max, protection d'inclinaison
 *   (67° liners), commande de taux de roulis avec maintien d'inclinaison, amortisseur de
 *   lacet + coordination de virage. Poussée vectorielle (F-22) à basse pression dynamique.
 * - FBW ALTERNATE : C* sans protections α / inclinaison, roulis direct + amortisseur de lacet.
 *
 * Pilote automatique : cap (HDG), altitude (ALT) et auto-manette (A/THR) générant les
 * consignes envoyées au noyau NDI.
 */
import type { AircraftSpec } from '../aircraft/types';
import { clamp, DEG, G0 } from './math';

export const LAW_NORMAL = 0;
export const LAW_ALTERNATE = 1;
export const LAW_DIRECT = 2;

/** Grandeurs nécessaires à l'inversion dynamique (calculées par le modèle de vol). */
export interface FcsContext {
  dt: number;
  V: number;
  qbar: number;
  S: number;
  c: number;
  b: number;
  Ixx: number;
  Iyaw: number;
  Ipitch: number;
  mass: number;
  nz: number;
  p: number; // roulis rad/s
  q: number; // tangage rad/s
  r: number; // lacet std (nez à droite) rad/s
  alpha: number;
  beta: number;
  pitch: number;
  bank: number;
  heading: number;
  altitude: number;
  vs: number;
  cas: number;
  onGround: boolean;
  /** coefficients aérodynamiques hors gouverne concernée */
  CmOther: number;
  ClOther: number;
  CnOther: number;
  /** efficacités (par unité de commande) */
  Cmde: number;
  Clda: number;
  Cndr: number;
  /** poussée totale et bras de levier vectoriel (m) */
  thrust: number;
  vectorArm: number;
  vectorMax: number; // rad
}

export interface PilotCmd {
  pitch: number;
  roll: number;
  yaw: number;
  trim: number;
  lawRequest: number;
  apHdg: boolean;
  apAlt: boolean;
  apAthr: boolean;
  hdgTarget: number; // rad
  altTarget: number; // m
  spdTarget: number; // m/s CAS
  throttle: number;
}

export interface FcsOutput {
  elev: number;
  ail: number;
  rud: number;
  nozzle: number; // rad
  throttle: number;
  law: number;
  alphaLimiting: boolean;
}

export class FlightControlSystem {
  readonly spec: AircraftSpec;
  law: number;
  failLaw = 0; // dégradation imposée par panne
  private qInt = 0;
  private holdBank = 0;
  private bankHeld = false;
  private athrInt = 0;
  private altInt = 0;
  private ydFilt = 0;
  readonly out: FcsOutput = { elev: 0, ail: 0, rud: 0, nozzle: 0, throttle: 0, law: 0, alphaLimiting: false };
  private readonly pMax: number;
  private readonly omegaQ: number;
  private readonly omegaP: number;
  private readonly vco: number;

  constructor(spec: AircraftSpec) {
    this.spec = spec;
    this.law = spec.fcs === 'fbw' ? LAW_NORMAL : LAW_DIRECT;
    const fighter = spec.category === 'fighter';
    this.pMax = fighter ? 4.2 : spec.category === 'ga' ? 1.2 : spec.category === 'bizjet' ? 0.45 : 0.27;
    this.omegaQ = fighter ? 6 : spec.category === 'ga' ? 3 : 2.2;
    this.omegaP = fighter ? 9 : 3.2;
    this.vco = fighter ? 90 : 120;
  }

  reset(): void {
    this.qInt = 0;
    this.athrInt = 0;
    this.altInt = 0;
    this.bankHeld = false;
  }

  update(ctx: FcsContext, cmd: PilotCmd): FcsOutput {
    const spec = this.spec;
    const o = this.out;
    // Loi effective : la plus dégradée entre demande pilote, panne et capacité appareil
    let law = spec.fcs === 'fbw' ? Math.max(cmd.lawRequest, this.failLaw) : LAW_DIRECT;
    const apOn = cmd.apHdg || cmd.apAlt;
    if (law === LAW_DIRECT && apOn && spec.fcs === 'direct') law = LAW_ALTERNATE; // servos du PA
    this.law = law;
    const V = Math.max(ctx.V, 1);
    const qS = Math.max(ctx.qbar * ctx.S, 1);

    // ───── Auto-manette ─────
    let throttle = cmd.throttle;
    if (cmd.apAthr && !ctx.onGround) {
      const err = cmd.spdTarget - ctx.cas;
      this.athrInt = clamp(this.athrInt + err * ctx.dt * 0.02, -0.6, 0.8);
      throttle = clamp(0.45 + err * 0.06 + this.athrInt, 0, spec.hasAfterburner ? 0.94 : 1);
    } else {
      this.athrInt = cmd.throttle - 0.45;
    }
    o.throttle = throttle;

    // ───── Consignes pilote automatique ─────
    let stickP = cmd.pitch, stickR = cmd.roll;
    let apNz: number | null = null, apBank: number | null = null;
    if (cmd.apHdg && !ctx.onGround) {
      let e = cmd.hdgTarget - ctx.heading;
      while (e > Math.PI) e -= 2 * Math.PI;
      while (e < -Math.PI) e += 2 * Math.PI;
      apBank = clamp(e * 2.2, -25 * DEG, 25 * DEG);
      stickR = 0;
    }
    if (cmd.apAlt && !ctx.onGround) {
      const eAlt = cmd.altTarget - ctx.altitude;
      const vsCmd = clamp(eAlt * 0.08, -12, 12);
      this.altInt = clamp(this.altInt + (vsCmd - ctx.vs) * ctx.dt * 0.01, -0.05, 0.05);
      const gammaErr = (vsCmd - ctx.vs) / V;
      apNz = Math.cos(ctx.pitch) / Math.max(0.5, Math.cos(ctx.bank)) + clamp(gammaErr * V * 0.35 / G0 + this.altInt, -0.4, 0.4);
      stickP = 0;
    }

    // ───── Tangage ─────
    let elev: number;
    let nozzle = 0;
    o.alphaLimiting = false;
    if (law === LAW_DIRECT) {
      elev = clamp(cmd.pitch + cmd.trim, -1, 1);
      this.qInt = 0;
    } else if (ctx.onGround && apNz === null) {
      // loi sol : commande directe, intégrateur gelé (comme Airbus « ground mode »)
      elev = clamp(cmd.pitch + cmd.trim * 0.5, -1, 1);
      this.qInt *= 0.98;
    } else {
      const n = spec.perf;
      const bankC = clamp(Math.abs(ctx.bank), 0, 33 * DEG);
      const nzFF = law === LAW_NORMAL ? Math.cos(ctx.pitch) / Math.cos(bankC) : Math.cos(ctx.pitch);
      let nzCmd = apNz ?? (stickP >= 0 ? nzFF + stickP * (n.nzMax - nzFF) : nzFF + stickP * (nzFF - n.nzMin));
      nzCmd = clamp(nzCmd, n.nzMin, n.nzMax);
      // consigne C* → q
      let qCmd = (G0 * (nzCmd - nzFF)) / V + (G0 / this.vco) * (nzCmd - ctx.nz) * 0.6;
      // protection α
      const aMax = n.alphaMaxFcs * DEG;
      if (law === LAW_NORMAL) {
        const aProt = aMax - 3 * DEG;
        if (ctx.alpha > aProt) {
          const qLim = 2.5 * (aMax - ctx.alpha);
          if (qCmd > qLim) {
            qCmd = qLim;
            o.alphaLimiting = true;
          }
        }
        if (ctx.alpha < -10 * DEG) qCmd = Math.max(qCmd, 2 * (-10 * DEG - ctx.alpha));
      }
      // intégrateur (auto-trim)
      const err = qCmd - ctx.q;
      this.qInt = clamp(this.qInt + err * ctx.dt * 2.0, -0.5, 0.5);
      const qDotDes = this.omegaQ * (err + this.qInt);
      const CmReq = (qDotDes * ctx.Ipitch) / (qS * ctx.c);
      elev = (CmReq - ctx.CmOther) / Math.max(1e-3, ctx.Cmde);
      // poussée vectorielle : complète l'autorité à basse pression dynamique
      if (ctx.vectorMax > 0 && ctx.thrust > 0) {
        const need = elev - clamp(elev, -1, 1);
        if (Math.abs(need) > 0 || ctx.qbar < 9000) {
          const momentNeeded = (CmReq - ctx.CmOther - clamp(elev, -1, 1) * ctx.Cmde) * qS * ctx.c;
          nozzle = clamp(Math.asin(clamp(momentNeeded / (ctx.thrust * ctx.vectorArm + 1), -1, 1)), -ctx.vectorMax, ctx.vectorMax);
        }
      }
      elev = clamp(elev, -1, 1);
    }

    // ───── Roulis ─────
    let ail: number;
    if (law === LAW_DIRECT || (ctx.onGround && apBank === null)) {
      ail = clamp(cmd.roll, -1, 1);
      this.bankHeld = false;
    } else {
      let pCmd: number;
      if (apBank !== null) {
        pCmd = clamp(1.2 * (apBank - ctx.bank), -0.15, 0.15);
      } else if (Math.abs(stickR) > 0.03) {
        pCmd = stickR * this.pMax;
        this.bankHeld = false;
        // protection d'inclinaison (liners 67°, bizjet 67°, chasseurs libres)
        if (law === LAW_NORMAL && spec.category !== 'fighter' && spec.category !== 'ga') {
          const lim = 67 * DEG;
          if (ctx.bank > lim && pCmd > 0) pCmd = 0.6 * (lim - ctx.bank);
          if (ctx.bank < -lim && pCmd < 0) pCmd = 0.6 * (-lim - ctx.bank);
        }
      } else {
        if (!this.bankHeld) {
          this.holdBank = Math.abs(ctx.bank) < 33 * DEG || spec.category === 'fighter' ? ctx.bank : Math.sign(ctx.bank) * 33 * DEG;
          this.bankHeld = true;
        }
        if (law === LAW_NORMAL && spec.category !== 'fighter' && Math.abs(this.holdBank) > 33 * DEG) this.holdBank = Math.sign(this.holdBank) * 33 * DEG;
        pCmd = law === LAW_NORMAL ? 1.5 * (this.holdBank - ctx.bank) : 0;
      }
      const pDotDes = this.omegaP * (pCmd - ctx.p);
      const ClReq = (pDotDes * ctx.Ixx) / (qS * ctx.b);
      ail = clamp((ClReq - ctx.ClOther) / Math.max(1e-3, ctx.Clda), -1, 1);
    }

    // ───── Lacet ─────
    let rud: number;
    if (law === LAW_DIRECT || ctx.onGround) {
      rud = clamp(cmd.yaw, -1, 1);
    } else {
      // coordination : r = g sinφ cosθ / V ; amortisseur filtré passe-haut
      const rCoord = (G0 * Math.sin(ctx.bank) * Math.cos(ctx.pitch)) / V;
      this.ydFilt += (ctx.r - this.ydFilt) * clamp(ctx.dt / 1.5, 0, 1);
      const rHp = ctx.r - this.ydFilt;
      const rCmd = rCoord + cmd.yaw * 0.25;
      const rDotDes = 2.5 * (rCmd - ctx.r) - 1.5 * rHp * 0 + 3.0 * ctx.beta * (law === LAW_NORMAL ? 1 : 0.5);
      const CnReq = (rDotDes * ctx.Iyaw) / (qS * ctx.b);
      rud = clamp((CnReq - ctx.CnOther) / Math.max(1e-3, ctx.Cndr) + cmd.yaw * 0.5, -1, 1);
    }

    o.elev = elev;
    o.ail = ail;
    o.rud = rud;
    o.nozzle = nozzle;
    o.law = law;
    return o;
  }
}
