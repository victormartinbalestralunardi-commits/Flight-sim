/**
 * Modèle de vol 6 degrés de liberté — intégration RK4 à pas fixe (240 Hz).
 *
 * État S (13) : position monde (3), vitesse monde (3), quaternion corps→monde (4),
 * vitesse angulaire corps ω (3). Le point de référence est le centre de gravité.
 *
 * Efforts : aérodynamique (dérivées VLM + stall + compressibilité + effet de sol McCormick),
 * propulsion (poussée vectorielle, asymétrie), train (ressort-amortisseur + frottement
 * longitudinal/latéral + direction + freins), points de structure (crash), catapulte,
 * brins d'arrêt, gravité. Aucune allocation dans step()/derivative().
 */
import type { AircraftSpec } from '../aircraft/types';
import type { AeroDerivatives } from '../cfd/derivatives';
import { xcgFromPercent } from '../cfd/derivatives';
import {
  approachRef, carrierPose, createCarrierPose, createSurfaceInfo, getAirport, getSurfaceInfo, shipToWorld, startPose,
  worldToShip, deckHeightAt, SURF_WATER, SURF_DECK, type AirportDef, type AirportId, type CarrierPose, type StartMode,
  type ApproachRef,
} from '../airports/airports';
import { AB_DETENT, createEngine, leverForThrust, updateEngine, IDLE_N1, type EngineEnv, type EngineState } from './engine';
import { FlightControlSystem, LAW_DIRECT, type FcsContext, type PilotCmd } from './fcs';
import { createAtmo, isa, tasToCas, type AtmoState } from './isa';
import { clamp, DEG, eulerFromQuat, FT, G0, KT, lerp, quatDerivative, quatFromEuler, quatNormalize, quatRotate, quatRotateInv, smoothstep } from './math';
import { AP, I, LIGHT, O } from './layout';
import { Wind, type WindConfig } from './wind';

export interface FlightConfig {
  spec: AircraftSpec;
  aero: AeroDerivatives;
  airport: AirportId;
  startMode: StartMode;
  fuelKg: number;
  payloadKg: number;
  xcgPct: number;
  wind: WindConfig;
  deltaIsa: number;
  seaState: number;
}

export type FlightEvent =
  | { type: 'touchdown'; vs: number; t: number; gear: string }
  | { type: 'crash'; reason: string; t: number }
  | { type: 'wire'; wire: number; t: number }
  | { type: 'catapult'; t: number }
  | { type: 'engine'; index: number; running: boolean };

const N = 13;

/** Coefficients aéro (scratch réutilisé). */
interface AeroOut {
  CL: number; CD: number; CY: number; Cl: number; Cm: number; Cn: number;
  CmOther: number; ClOther: number; CnOther: number;
  Cmde: number; Clda: number; Cndr: number;
  stall: number; alphaStall: number; CLvortex: number;
}

export class FlightModel {
  readonly spec: AircraftSpec;
  readonly aero: AeroDerivatives;
  readonly ap: AirportDef;
  readonly cfg: FlightConfig;
  readonly fcs: FlightControlSystem;
  readonly wind: Wind;
  readonly engines: EngineState[];

  // état
  readonly S = new Float64Array(N);
  private k1 = new Float64Array(N);
  private k2 = new Float64Array(N);
  private k3 = new Float64Array(N);
  private k4 = new Float64Array(N);
  private Stmp = new Float64Array(N);
  t = 0;

  // masse
  fuel: number;
  payload: number;
  mass = 0;
  Ixx = 0; Iyaw = 0; Ipitch = 0;
  readonly xcg: number;
  readonly xcgPct: number;

  // géométrie corps (rel. CG)
  private gearB: Float64Array;
  private gearK: Float64Array;
  private gearC: Float64Array;
  private structB: Float64Array;
  private engB: Float64Array;
  private hookB = new Float64Array(3);
  readonly nGear: number;

  // actionneurs
  elev = 0; ail = 0; rud = 0; flap = 0; gearPos = 1; spoiler = 0; speedbrake = 0; hook = 0; nozzle = 0;
  brakeL = 0; brakeR = 0; steer = 0; trimBase = 0;
  readonly gearComp = new Float64Array(3);
  onGroundMask = 0;
  private airborneTime = 0;
  private wowPrev = false;

  // systèmes
  battery = true; apu = false; pumps = true; avionics = true; lights = 0;

  // événements
  crashed = false;
  crashReason = '';
  tdVs = 0;
  tdCount = 0;
  wire = -1;
  private wireVEng = 0;
  private prevHookAxis = -1e9;
  catState = 0; // 0 libre, 1 attelé, 2 lancement, 3 lancé
  catIndex = -1;
  private catS = 0;
  private catV = 0;
  private catEndV = 0;
  readonly events: FlightEvent[] = [];

  // dérivés pour la sortie
  readonly atmo: AtmoState = createAtmo();
  private ac: AeroOut = { CL: 0, CD: 0, CY: 0, Cl: 0, Cm: 0, Cn: 0, CmOther: 0, ClOther: 0, CnOther: 0, Cmde: 0, Clda: 0, Cndr: 0, stall: 0, alphaStall: 0, CLvortex: 0 };
  alpha = 0; beta = 0; tas = 0; mach = 0; qbar = 0;
  nx = 0; ny = 0; nz = 1;
  agl = 100; groundH = 0; surfKind = 0;
  blackout = 0; redout = 0;
  gpws = 0;
  private gpwsTimer = 0;
  stallWarn = 0; buffet = 0;
  readonly euler = new Float64Array(3);
  readonly pose: CarrierPose = createCarrierPose();
  private readonly surf = createSurfaceInfo();
  private readonly apRef: ApproachRef;
  private readonly windW = new Float64Array(3);

  // scratch
  private readonly tv = new Float64Array(3);
  private readonly tv2 = new Float64Array(3);
  private readonly tv3 = new Float64Array(3);
  private readonly rbS = new Float64Array(3);
  private readonly Fw = new Float64Array(3);
  private readonly Mb = new Float64Array(3);
  private readonly Fb = new Float64Array(3);
  private readonly nzAcc = new Float64Array(3);
  private readonly sp = { s: 0, l: 0 };
  private readonly ww = [0, 0];
  private recording = false;
  private readonly fcsCtx: FcsContext;
  private readonly pilot: PilotCmd;
  private readonly engEnv: EngineEnv = { sigma: 1, mach: 0, V: 0, battery: true, apu: false, pumps: true, fuel: 1 };

  constructor(cfg: FlightConfig) {
    this.cfg = cfg;
    this.spec = cfg.spec;
    this.aero = cfg.aero;
    this.ap = getAirport(cfg.airport);
    this.apRef = approachRef(this.ap, 0);
    this.fcs = new FlightControlSystem(cfg.spec);
    this.wind = new Wind(cfg.wind);
    this.fuel = clamp(cfg.fuelKg, 0, cfg.spec.mass.fuelMax);
    this.payload = clamp(cfg.payloadKg, 0, cfg.spec.mass.payloadMax);
    this.xcgPct = cfg.xcgPct;
    this.xcg = xcgFromPercent(cfg.aero, cfg.xcgPct);
    const spec = this.spec;

    // géométrie relative au CG
    this.nGear = spec.gear.length;
    this.gearB = new Float64Array(3 * this.nGear);
    this.gearK = new Float64Array(this.nGear);
    this.gearC = new Float64Array(this.nGear);
    const mRef = spec.mass.empty + spec.mass.fuelMax * 0.5 + spec.mass.payloadMax * 0.5;
    // répartition statique de charge (bras de levier par rapport au CG)
    const xn = spec.gear[0].pos[0] - this.xcg, xm = spec.gear[1].pos[0] - this.xcg;
    const shareNose = clamp(xm / (xm - xn), 0.04, 0.3);
    spec.gear.forEach((g, i) => {
      this.gearB[3 * i] = g.pos[0] - this.xcg;
      this.gearB[3 * i + 1] = g.pos[1];
      this.gearB[3 * i + 2] = g.pos[2];
      const share = i === 0 ? shareNose : (1 - shareNose) / 2;
      const k = (mRef * G0 * share) / (0.45 * g.travel);
      this.gearK[i] = k;
      this.gearC[i] = 2 * 0.65 * Math.sqrt(k * mRef * share);
    });
    // points de structure : nez, queue, saumons, sommet dérive, ventre, nacelles
    const wing = spec.surfaces[0];
    const tip = wing.stations[wing.stations.length - 1];
    const vt = spec.surfaces.find((s) => s.role === 'vtail');
    const vtTop = vt ? vt.stations[vt.stations.length - 1] : null;
    const belly = -spec.fuselage.height / 2;
    const pts: number[] = [
      0, 0, 0,
      -spec.length * 0.98, belly * 0.4, 0,
      tip.le[0] - tip.chord * 0.5, tip.le[1], tip.le[2],
      tip.le[0] - tip.chord * 0.5, tip.le[1], -tip.le[2],
      -spec.length * 0.45, belly, 0,
      -spec.length * 0.15, belly * 0.9, 0,
    ];
    if (vtTop) pts.push(vtTop.le[0] - vtTop.chord * 0.5, vtTop.le[1], vtTop.le[2]);
    for (const e of spec.engines) if (e.type === 'turbofan' && Math.abs(e.pos[2]) > 1.5) pts.push(e.pos[0] + 3, e.pos[1] - 1.2, e.pos[2]);
    this.structB = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i += 3) {
      this.structB[i] = pts[i] - this.xcg;
      this.structB[i + 1] = pts[i + 1];
      this.structB[i + 2] = pts[i + 2];
    }
    this.engB = new Float64Array(3 * spec.engines.length);
    spec.engines.forEach((e, i) => {
      this.engB[3 * i] = e.pos[0] - this.xcg;
      this.engB[3 * i + 1] = e.pos[1];
      this.engB[3 * i + 2] = e.pos[2];
    });
    const gy = spec.gear[1].pos[1];
    this.hookB[0] = -spec.length * 0.9 - this.xcg;
    this.hookB[1] = gy + 0.15;
    this.hookB[2] = 0;

    const cold = cfg.startMode === 'cold';
    this.engines = spec.engines.map((d) => createEngine(d, !cold));
    if (cold) {
      this.battery = false; this.apu = false; this.pumps = false; this.avionics = false; this.lights = 0;
    } else {
      this.lights = LIGHT.NAV | LIGHT.BEACON | LIGHT.STROBE | (cfg.startMode === 'final' ? LIGHT.LANDING : 0);
    }

    this.fcsCtx = {
      dt: 1 / 240, V: 0, qbar: 0, S: this.aero.Sref, c: this.aero.cref, b: this.aero.bref, Ixx: 1, Iyaw: 1, Ipitch: 1, mass: 1,
      nz: 1, p: 0, q: 0, r: 0, alpha: 0, beta: 0, pitch: 0, bank: 0, heading: 0, altitude: 0, vs: 0, cas: 0, onGround: true,
      CmOther: 0, ClOther: 0, CnOther: 0, Cmde: 1, Clda: 1, Cndr: 1, thrust: 0, vectorArm: 0, vectorMax: 0,
    };
    this.pilot = { pitch: 0, roll: 0, yaw: 0, trim: 0, lawRequest: 0, apHdg: false, apAlt: false, apAthr: false, hdgTarget: 0, altTarget: 0, spdTarget: 0, throttle: 0 };
    this.updateMass();
    this.initPose();
  }

  updateMass(): void {
    const s = this.spec;
    this.mass = s.mass.empty + this.fuel + this.payload;
    const m = this.mass;
    this.Ixx = m * Math.pow((s.mass.kxx * s.span) / 2, 2);
    this.Ipitch = m * Math.pow((s.mass.kzz * s.length) / 2, 2);
    this.Iyaw = m * Math.pow((s.mass.kyy * (s.span + s.length)) / 4, 2);
  }

  // ───────────────────────────── Initialisation ─────────────────────────────

  private initPose(): void {
    const spec = this.spec;
    const sp = startPose(this.ap, this.cfg.startMode, spec.perf.vApp * KT, undefined, !!spec.stovl);
    const S = this.S;
    const hdg = sp.heading * DEG;
    if (sp.airborne) {
      // conditions d'approche : volets pleins, train sorti, trim
      this.flap = spec.perf.flapDetents[spec.perf.flapDetents.length - 1];
      this.gearPos = 1;
      this.hook = spec.hasHook && this.ap.id === 'cvn' ? 1 : 0;
      const V = sp.speed;
      const trim = this.trim(V, sp.gamma, sp.y);
      S[0] = sp.x; S[1] = sp.y; S[2] = sp.z;
      const ch = Math.cos(sp.gamma);
      S[3] = Math.sin(hdg) * V * ch;
      S[4] = Math.sin(sp.gamma) * V;
      S[5] = -Math.cos(hdg) * V * ch;
      quatFromEuler(hdg, sp.gamma + trim.alpha, 0, S, 6);
      this.elev = trim.elev;
      this.trimBase = this.fcs.law === LAW_DIRECT ? trim.elev : 0;
      for (const e of this.engines) {
        e.n1 = IDLE_N1 + (1 - IDLE_N1) * (trim.lever / AB_DETENT);
        e.n2 = 0.6 + 0.4 * e.n1;
        e.running = true;
      }
      this.initialThrottle = trim.lever;
      this.wowPrev = false;
      this.airborneTime = 10;
    } else {
      this.flap = spec.perf.flapDetents[Math.min(1, spec.perf.flapDetents.length - 1)];
      if (this.cfg.startMode === 'cold') this.flap = 0;
      this.gearPos = 1;
      // posé : hauteur = surface − y contact train (compression statique ≈ 45 % course)
      getSurfaceInfo(this.ap, sp.x, sp.z, 0, this.surf);
      const gy = spec.gear[1].pos[1];
      const comp = 0.45 * spec.gear[1].travel;
      // assiette au sol : ligne nez/principal
      const dyGear = spec.gear[0].pos[1] - spec.gear[1].pos[1];
      const dxGear = spec.gear[0].pos[0] - spec.gear[1].pos[0];
      const pitch0 = Math.atan2(-dyGear, dxGear);
      // pente piste (projetée sur l'axe)
      const slope = Math.atan2(-(this.surf.nx * Math.sin(hdg) - this.surf.nz * Math.cos(hdg)), this.surf.ny);
      S[0] = sp.x; S[2] = sp.z;
      S[1] = this.surf.height - gy - comp + 0.02;
      quatFromEuler(hdg, pitch0 + slope, 0, S, 6);
      S[3] = this.surf.vx; S[4] = 0; S[5] = this.surf.vz;
      if (sp.onCatapult >= 0) {
        this.catState = 1;
        this.catIndex = sp.onCatapult;
        this.flap = spec.perf.flapDetents[Math.min(1, spec.perf.flapDetents.length - 1)];
      }
      this.wowPrev = true;
      this.airborneTime = 0;
      this.initialThrottle = 0;
    }
  }

  /** Throttle initial issu du trim (consommé par le thread principal à l'init). */
  initialThrottle = 0;

  /**
   * Trim en descente/palier : résout α, profondeur, levier tels que L = W cosγ, Cm = 0,
   * T = D + W sinγ. Retourne aussi le levier pour l'interface.
   */
  trim(V: number, gamma: number, alt: number): { alpha: number; elev: number; lever: number } {
    isa(alt, this.atmo, this.cfg.deltaIsa);
    const q = 0.5 * this.atmo.rho * V * V;
    const S = this.aero.Sref;
    const W = this.mass * G0;
    let alpha = 4 * DEG, elev = 0, T = 0;
    const M = V / this.atmo.a;
    for (let it = 0; it < 60; it++) {
      this.coefficients(alpha, 0, 0, 0, 0, V, M, elev, 0, 0, this.agl);
      const CLreq = (W * Math.cos(gamma) - T * Math.sin(alpha)) / (q * S);
      // Newton sur α
      const cl1 = this.ac.CL;
      const dCLda = Math.max(0.5, (cl1 - this.coefficientsCL(alpha - 0.05 * DEG, V, M, elev)) / (0.05 * DEG));
      this.ac.CL = cl1;
      alpha = clamp(alpha + (CLreq - this.ac.CL) / dCLda * 0.8, -5 * DEG, 20 * DEG);
      // profondeur pour Cm = 0
      this.coefficients(alpha, 0, 0, 0, 0, V, M, elev, 0, 0, this.agl);
      elev = clamp(elev - this.ac.Cm / Math.max(1e-3, this.ac.Cmde), -1, 1);
      T = Math.max(0, this.ac.CD * q * S + W * Math.sin(gamma));
    }
    const nEng = this.engines.length;
    const lever = clamp(leverForThrust(this.spec.engines[0], T / nEng, this.atmo.sigma, M, V), 0, AB_DETENT);
    return { alpha, elev, lever };
  }

  private coefficientsCL(alpha: number, V: number, M: number, elev: number): number {
    this.coefficients(alpha, 0, 0, 0, 0, V, M, elev, 0, 0, this.agl);
    return this.ac.CL;
  }

  // ───────────────────────────── Aérodynamique ─────────────────────────────

  /**
   * Coefficients aérodynamiques complets (convention aéronautique standard).
   * p, q, r en rad/s (r = lacet nez à droite).
   */
  coefficients(alpha: number, beta: number, p: number, q: number, r: number, V: number, M: number, elev: number, ail: number, rud: number, hGear: number): AeroOut {
    const d = this.aero;
    const spec = this.spec;
    const perf = spec.perf;
    const o = this.ac;
    const Vs = Math.max(V, 5);
    const qh = (q * d.cref) / (2 * Vs);
    const ph = (p * d.bref) / (2 * Vs);
    const rh = (r * d.bref) / (2 * Vs);
    const f = this.flap;

    // compressibilité (Prandtl-Glauert subsonique, Ackeret supersonique)
    const pg = (m: number) => 1 / Math.sqrt(1 - Math.min(m, 0.92) ** 2);
    const base = pg(d.mach);
    let kc: number;
    if (M < 0.92) kc = pg(M) / base;
    else {
      const sub = pg(0.92) / base;
      const sup = (4 / Math.sqrt(Math.max(1.08 * 1.08, M * M) - 1)) / d.CLa;
      kc = M < 1.08 ? lerp(sub, Math.min(sub, sup), (M - 0.92) / 0.16) : Math.min(sub, sup);
    }
    const CLa = d.CLa * kc;

    // effet de sol (McCormick) : hauteur de l'aile ≈ hauteur des roues + garde au sol
    const hw = Math.max(0.1, hGear + Math.abs(spec.gear[1].pos[1]) * 0.6);
    const x16 = (16 * hw) / d.bref;
    const phiGe = (x16 * x16) / (1 + x16 * x16);
    const geLift = 1 + 0.12 * (1 - phiGe) * (d.aspect > 4 ? 1 : 0.6);

    // décrochage
    const aStall = lerp(perf.alphaStall, perf.alphaStallFlaps, f) * DEG;
    o.alphaStall = aStall;
    const sig = 1 / (1 + Math.exp(-(Math.abs(alpha) - aStall) / (1.6 * DEG)));
    o.stall = sig;
    const CLlin = (d.CL0 + CLa * alpha + d.CLflap * f * (1 - 0.3 * Math.min(1, M / 0.6))) * geLift;
    const CLpost = 1.05 * Math.sin(2 * alpha);
    // portance tourbillonnaire de bord d'attaque (Polhamus), éclatement au-delà du décrochage
    const sa = Math.sin(Math.abs(alpha));
    const CLvort = d.Kv * sa * sa * Math.cos(alpha) * Math.sign(alpha) * (1 - sig) * (M < 1 ? 1 : 0.5);
    o.CLvortex = CLvort;
    const CLwb = (1 - sig) * CLlin + sig * CLpost + CLvort;
    const spoilerFactor = 1 - 0.35 * this.spoiler;
    const CLtailQ = d.CLq * qh;
    const CL = (CLwb * spoilerFactor) + CLtailQ + d.CLde * elev * (1 - 0.4 * sig);

    // traînée
    const K = phiGe / (Math.PI * d.aspect * d.oswald);
    const mdd = perf.mdd;
    const mcr = mdd - 0.108;
    const cdwMax = spec.category === 'fighter' ? 0.028 : 0.06;
    let cdw = 0;
    if (M > mcr) {
      if (M < 1.05) cdw = Math.min(cdwMax, 20 * Math.pow(M - mcr, 4));
      else cdw = cdwMax * Math.pow(Math.sqrt(1.05 * 1.05 - 1) / Math.sqrt(M * M - 1), 0.6);
    }
    const CD = perf.cd0 + perf.cdGear * this.gearPos + perf.cdFlaps * f + perf.cdSpeedbrake * this.speedbrake +
      0.03 * this.spoiler + K * (CLwb - CLvort) * (CLwb - CLvort) + Math.abs(CLvort * Math.tan(alpha)) + cdw + sig * 1.1 * Math.sin(alpha) ** 2 + 0.4 * beta * beta;

    // latéral
    const CY = d.CYb * beta + d.CYdr * rud + d.CYp * ph + d.CYr * rh;
    const ClpEff = d.Clp * (1 - 1.8 * sig);
    const ClOther = d.Clb * beta * (1 + 0.5 * sig) + ClpEff * ph + d.Clr * rh + d.Cldr * rud;
    const Clda = d.Clda * (1 - 0.5 * sig) * (1 - 0.3 * Math.max(0, M - 0.8));
    const Cl = ClOther + Clda * ail;
    const CnbEff = d.Cnb * (1 - 0.7 * sig * (spec.category === 'fighter' ? 1 : 0.5));
    const CnOther = CnbEff * beta + d.Cnp * ph + d.Cnr * rh + d.Cnda * ail;
    const Cn = CnOther + d.Cndr * rud;

    // tangage autour du CG
    const cbar = d.cref;
    const supShift = 0.12 * smoothstep(0.92, 1.25, M);
    const xnp = d.xnp - supShift * cbar;
    const tuck = spec.category === 'fighter' ? 0 : -0.1 * smoothstep(mcr, mcr + 0.14, M);
    const CmqCg = d.Cmq - ((this.xcg - d.xref) / cbar) * d.CLq;
    const CmdeCg = (d.Cmde - ((this.xcg - d.xref) / cbar) * d.CLde) * (1 - 0.4 * sig);
    const pitchBreak = spec.id === 'g8000' ? 0.05 * sig : -0.12 * sig; // T-tail : tendance cabreuse (deep stall)
    const CmOther = d.CmNp + d.CmFlap * f + ((xnp - this.xcg) / cbar) * CLwb * spoilerFactor + CmqCg * qh + tuck + pitchBreak - 0.02 * (1 - phiGe);
    const Cm = CmOther + CmdeCg * elev;

    o.CL = CL; o.CD = CD; o.CY = CY; o.Cl = Cl; o.Cm = Cm; o.Cn = Cn;
    o.CmOther = CmOther; o.ClOther = ClOther; o.CnOther = CnOther;
    o.Cmde = CmdeCg; o.Clda = Clda; o.Cndr = d.Cndr;
    return o;
  }

  // ───────────────────────────── STOVL (F-35B) ─────────────────────────────

  /** Ouverture des portes de la soufflante (0..1), angle tuyère (rad), commandes de réaction. */
  fanDoor = 0;
  nozzleAng = 0;
  private hoverDp = 0;
  private hoverDr = 0;
  private hoverDy = 0;
  private hoverInt = 0;
  private vzInt = 0;
  private velIntF = 0;
  private velIntL = 0;

  /** Efforts propulsifs en configuration STOVL : tuyère pivotante + soufflante + roll posts. */
  private stovlForces(T: number, Fb: Float64Array, Mb: Float64Array): void {
    const sv = this.spec.stovl!;
    const k = this.fanDoor;
    const th = this.nozzleAng;
    const xcg = this.xcg;
    const addForce = (fx: number, fy: number, fz: number, x: number, y: number, z: number) => {
      Fb[0] += fx; Fb[1] += fy; Fb[2] += fz;
      const rx = x - xcg;
      Mb[0] += y * fz - z * fy;
      Mb[1] += z * fx - rx * fz;
      Mb[2] += rx * fy - y * fx;
    };
    // tuyère : pousse vers l'avant puis vers le haut quand elle pivote ; sortie interpolée
    const f = Math.min(1, th / (Math.PI / 2));
    const e0 = this.spec.engines[0].pos;
    const nx = e0[0] + (sv.nozzlePos[0] - e0[0]) * f, ny = e0[1] + (sv.nozzlePos[1] - e0[1]) * f;
    const Tn = T * (1 - k + k * sv.nozzleRatio) * (1 - k * this.hoverDp * 0.35);
    const yawA = this.hoverDy * 10 * DEG;
    addForce(Tn * Math.cos(th) * Math.cos(yawA), Tn * Math.sin(th) * Math.cos(yawA), -Tn * Math.sin(yawA), nx, ny, 0);
    if (k > 0) {
      const Tf = T * k * sv.liftFanRatio * (1 + this.hoverDp * 0.35);
      addForce(0, Tf, 0, sv.liftFanPos[0], sv.liftFanPos[1], 0);
      const rp = sv.rollPostPos;
      const Tp = T * k * sv.rollPostRatio;
      addForce(0, Tp * (1 - this.hoverDr), 0, rp[0], rp[1], rp[2]);
      addForce(0, Tp * (1 + this.hoverDr), 0, rp[0], rp[1], -rp[2]);
    }
  }

  /**
   * Loi de vol stationnaire « unifiée » (type F-35B) : manche = assiette/inclinaison,
   * palonnier = taux de lacet, levier = vitesse verticale (tuyère > 60°, V < 60 m/s).
   * Retourne le levier moteur calculé (ou −1 si le levier pilote est conservé).
   */
  private hoverControl(dt: number, stickP: number, stickR: number, pedal: number, lever: number): number {
    const sv = this.spec.stovl!;
    const S = this.S;
    const T = Math.max(1000, this.engines[0].thrust);
    const k = this.fanDoor;
    const w = k * smoothstep(35 * DEG, 65 * DEG, this.nozzleAng) * (1 - smoothstep(40, 75, this.tas));
    if (w <= 0.01) {
      this.hoverDp = 0; this.hoverDr = 0; this.hoverDy = 0; this.hoverInt = 0; this.vzInt = 0; this.velIntF = 0; this.velIntL = 0;
      return -1;
    }
    const pitch = this.euler[1], bank = this.euler[2];
    // commande de vitesse de translation (relative à la surface : suit le pont mobile)
    const hdg = this.euler[0];
    const fx = Math.sin(hdg), fz = -Math.cos(hdg);
    const vx = S[3] - this.surf.vx, vzH = S[5] - this.surf.vz;
    const vFwd = vx * fx + vzH * fz, vLat = vx * -fz + vzH * fx;
    const vFwdCmd = -stickP * 12, vLatCmd = stickR * 8;
    this.velIntF = clamp(this.velIntF + (vFwdCmd - vFwd) * dt * 0.15, -0.15, 0.15);
    this.velIntL = clamp(this.velIntL + (vLatCmd - vLat) * dt * 0.15, -0.15, 0.15);
    // tangage
    const thC = clamp(-0.035 * (vFwdCmd - vFwd) - this.velIntF, -12 * DEG, 14 * DEG);
    const eTh = thC - pitch;
    this.hoverInt = clamp(this.hoverInt + eTh * dt * 1.5, -0.6, 0.6);
    const qDot = 5 * eTh - 4.5 * S[12] + 3 * this.hoverInt;
    const armP = 0.35 * T * k * (sv.liftFanRatio * (sv.liftFanPos[0] - this.xcg) - sv.nozzleRatio * Math.sin(this.nozzleAng) * (sv.nozzlePos[0] - this.xcg));
    this.hoverDp = clamp((this.Ipitch * qDot) / Math.max(1, armP), -1, 1) * w;
    // roulis
    const phC = clamp(0.035 * (vLatCmd - vLat) + this.velIntL, -20 * DEG, 20 * DEG);
    const pDot = 7 * (phC - bank) - 5.5 * S[10];
    const armR = T * k * sv.rollPostRatio * sv.rollPostPos[2] * 2;
    this.hoverDr = clamp((this.Ixx * pDot) / Math.max(1, armR), -1, 1) * w;
    // lacet (déflexion latérale de la tuyère)
    const r = -S[11];
    const rDot = 3 * (pedal * 0.6 - r);
    const armY = T * sv.nozzleRatio * Math.sin(10 * DEG) * Math.abs(sv.nozzlePos[0] - this.xcg);
    this.hoverDy = clamp((this.Iyaw * rDot) / Math.max(1, armY), -1, 1) * w;
    // vitesse verticale commandée par le levier
    if (this.nozzleAng < 60 * DEG || this.tas > 60) return -1;
    const x = (lever - 0.5) * 2;
    const vzCmd = Math.abs(x) < 0.06 ? 0 : (x - Math.sign(x) * 0.06) * 6.5;
    const vz = S[4] - this.surf.vy;
    this.vzInt = clamp(this.vzInt + (vzCmd - vz) * dt * 0.8, -3, 3);
    const Fv = this.mass * (G0 + 1.6 * (vzCmd - vz) + this.vzInt);
    const eff = (k * (sv.liftFanRatio + 2 * sv.rollPostRatio) + (1 - k + k * sv.nozzleRatio) * Math.sin(this.nozzleAng)) *
      Math.max(0.5, Math.cos(pitch) * Math.cos(bank));
    return clamp(leverForThrust(this.spec.engines[0], Fv / eff, this.atmo.sigma, this.mach, this.tas), 0, AB_DETENT);
  }

  // ───────────────────────────── Dérivée d'état ─────────────────────────────

  private derivative(S: Float64Array, t: number, out: Float64Array): void {
    const spec = this.spec;
    const m = this.mass;
    const tv = this.tv, tv2 = this.tv2, tv3 = this.tv3;
    const Fw = this.Fw, Mb = this.Mb, Fb = this.Fb;
    Fw[0] = 0; Fw[1] = -m * G0; Fw[2] = 0;
    Mb[0] = 0; Mb[1] = 0; Mb[2] = 0;
    Fb[0] = 0; Fb[1] = 0; Fb[2] = 0;

    const wx = S[10], wy = S[11], wz = S[12];
    // ───── Aéro ─────
    isa(S[1], this.atmo, this.cfg.deltaIsa);
    tv[0] = S[3] - this.windW[0]; tv[1] = S[4] - this.windW[1]; tv[2] = S[5] - this.windW[2];
    quatRotateInv(S, 6, tv, 0, tv2, 0);
    const u = tv2[0], v = tv2[1], w = tv2[2];
    const V = Math.max(0.1, Math.hypot(u, v, w));
    const alpha = Math.atan2(-v, u);
    const beta = Math.asin(clamp(w / V, -1, 1));
    const qbar = 0.5 * this.atmo.rho * V * V;
    const M = V / this.atmo.a;
    const rStd = -wy;
    const hGear = this.agl;
    const ac = this.coefficients(alpha, beta, wx, wz, rStd, V, M, this.elev, this.ail, this.rud, hGear);
    const qS = qbar * this.aero.Sref;
    // directions : traînée opposée à l'air relatif, portance ⟂ dans le plan (X,Y)
    const vxh = u / V, vyh = v / V, vzh = w / V;
    // portance : Z × v̂ normalisé
    let lx = -vyh, ly = vxh;
    const ll = Math.hypot(lx, ly) || 1;
    lx /= ll; ly /= ll;
    Fb[0] += qS * (-ac.CD * vxh + ac.CL * lx);
    Fb[1] += qS * (-ac.CD * vyh + ac.CL * ly);
    Fb[2] += qS * (-ac.CD * vzh + ac.CY);
    Mb[0] += qS * this.aero.bref * ac.Cl;
    Mb[1] += -qS * this.aero.bref * ac.Cn;
    Mb[2] += qS * this.aero.cref * ac.Cm;

    // ───── Propulsion ─────
    const cn = Math.cos(this.nozzle), sn = Math.sin(this.nozzle);
    const sv = this.spec.stovl;
    for (let i = 0; i < this.engines.length; i++) {
      const T = this.engines[i].thrust;
      if (T <= 0) continue;
      if (sv && this.fanDoor > 0.01 || (sv && this.nozzleAng > 0.01)) {
        this.stovlForces(T, Fb, Mb);
        continue;
      }
      const vec = this.engines[i].def.vectorDeg ? 1 : 0;
      const fx = T * (vec ? cn : 1), fy = -T * (vec ? sn : 0);
      Fb[0] += fx; Fb[1] += fy;
      const rx = this.engB[3 * i], ry = this.engB[3 * i + 1], rz = this.engB[3 * i + 2];
      // r × F (F_z = 0)
      Mb[0] += ry * 0 - rz * fy;
      Mb[1] += rz * fx - rx * 0;
      Mb[2] += rx * fy - ry * fx;
    }

    // ───── Contacts (train + structure) ─────
    const pose = carrierPose(this.ap.carrier ?? DUMMY_CARRIER, t, POSE_SCRATCH, this.cfg.seaState);
    let mask = 0;
    const gearDown = this.gearPos > 0.95;
    const rbS = this.rbS;
    for (let i = 0; i < this.nGear; i++) {
      if (!gearDown) break;
      rbS[0] = this.gearB[3 * i]; rbS[1] = this.gearB[3 * i + 1]; rbS[2] = this.gearB[3 * i + 2];
      const pen = this.contact(S, t, rbS, pose, this.gearK[i], this.gearC[i], spec.gear[i].travel, i, Fw, Mb);
      if (pen > 0) mask |= 1 << i;
      if (this.recording) this.gearComp[i] = Math.max(0, pen);
    }
    if (this.recording) this.onGroundMask = mask;
    const kS = (m * G0) / 0.12, cS = 2 * 0.5 * Math.sqrt(kS * m);
    for (let i = 0; i < this.structB.length; i += 3) {
      rbS[0] = this.structB[i]; rbS[1] = this.structB[i + 1]; rbS[2] = this.structB[i + 2];
      this.contact(S, t, rbS, pose, kS, cS, -1, -1, Fw, Mb);
    }

    // ───── Catapulte / brins d'arrêt ─────
    if (this.ap.carrier && (this.catState === 1 || this.catState === 2)) {
      const c = this.ap.carrier;
      const cat = c.catapults[this.catIndex];
      shipToWorld(pose, cat[0] + this.catS, cat[1], this.ww);
      const hx = Math.sin(pose.heading), hz = -Math.cos(pose.heading);
      const vtx = pose.vx + hx * this.catV, vtz = pose.vz + hz * this.catV;
      const k = m * 220, cdamp = 2 * 0.8 * Math.sqrt(220) * m;
      // point d'attache : train avant
      quatRotate(S, 6, this.gearB, 0, tv3, 0);
      const ax = S[0] + tv3[0], az = S[2] + tv3[2];
      Fw[0] += k * (this.ww[0] - ax) + cdamp * (vtx - S[3]);
      Fw[2] += k * (this.ww[1] - az) + cdamp * (vtz - S[5]);
    }
    if (this.ap.carrier && this.wire >= 0) {
      const c = this.ap.carrier;
      const ang = pose.heading + c.landingAngle * DEG;
      const ax = Math.sin(ang), az = -Math.cos(ang);
      const vrel = (S[3] - pose.vx) * ax + (S[5] - pose.vz) * az;
      const decel = (this.wireVEng * this.wireVEng) / (2 * 95);
      const f = m * decel * clamp(vrel / 4, -0.3, 1) + m * 0.5 * vrel;
      Fw[0] -= f * ax;
      Fw[2] -= f * az;
    }

    // ───── Équations du mouvement ─────
    quatRotate(S, 6, Fb, 0, tv, 0);
    const ax = (Fw[0] + tv[0]) / m, ay = (Fw[1] + tv[1]) / m, az = (Fw[2] + tv[2]) / m;
    out[0] = S[3]; out[1] = S[4]; out[2] = S[5];
    out[3] = ax; out[4] = ay; out[5] = az;
    quatDerivative(S, 6, S, 10, out, 6);
    const Ix = this.Ixx, Iy = this.Iyaw, Iz = this.Ipitch;
    // ω̇ = I⁻¹ (M − ω × Iω)
    const hx = Ix * wx, hy = Iy * wy, hz = Iz * wz;
    out[10] = (Mb[0] - (wy * hz - wz * hy)) / Ix;
    out[11] = (Mb[1] - (wz * hx - wx * hz)) / Iy;
    out[12] = (Mb[2] - (wx * hy - wy * hx)) / Iz;

    if (this.recording) {
      this.alpha = alpha; this.beta = beta; this.tas = V; this.mach = M; this.qbar = qbar;
      // facteur de charge = force spécifique (hors gravité) en axes corps / g
      tv2[0] = ax; tv2[1] = ay + G0; tv2[2] = az;
      quatRotateInv(S, 6, tv2, 0, this.nzAcc, 0);
      this.nx = this.nzAcc[0] / G0; this.nz = this.nzAcc[1] / G0; this.ny = this.nzAcc[2] / G0;
    }
  }

  /**
   * Contact ressort-amortisseur d'un point corps avec la surface.
   * travel ≥ 0 : roue (frottement directionnel) ; travel < 0 : structure (frottement fort).
   * Retourne la pénétration (m).
   */
  private contact(S: Float64Array, t: number, rb: Float64Array, pose: CarrierPose, k: number, c: number, travel: number, gi: number, Fw: Float64Array, Mb: Float64Array): number {
    const tv3 = this.tv3;
    quatRotate(S, 6, rb, 0, tv3, 0);
    const px = S[0] + tv3[0], py = S[1] + tv3[1], pz = S[2] + tv3[2];
    const sf = getSurfaceInfo(this.ap, px, pz, t, this.surf, this.ap.carrier ? pose : undefined);
    const pen = (sf.height - py) * sf.ny;
    if (pen <= 0) return pen;
    if (sf.kind === SURF_DECK && sf.height - py > 3) {
      // sous le niveau du pont dans l'emprise du navire : impact avec la coque / rampe
      if (this.recording) this.structPen = 10;
      return 0;
    }
    // vitesse du point : v + ω×r (monde)
    const wx = S[10], wy = S[11], wz = S[12];
    const cx = wy * rb[2] - wz * rb[1], cy = wz * rb[0] - wx * rb[2], cz = wx * rb[1] - wy * rb[0];
    const wb = this.tv2;
    wb[0] = cx; wb[1] = cy; wb[2] = cz;
    const wwv = this.tv;
    quatRotate(S, 6, wb, 0, wwv, 0);
    const vx = S[3] + wwv[0] - sf.vx, vy = S[4] + wwv[1] - sf.vy, vz = S[5] + wwv[2] - sf.vz;
    const vn = vx * sf.nx + vy * sf.ny + vz * sf.nz;
    let fn = k * pen - c * vn;
    if (travel >= 0 && pen > travel) fn += k * 25 * (pen - travel);
    if (fn < 0) fn = 0;
    // tangentiel
    const tx = vx - vn * sf.nx, ty = vy - vn * sf.ny, tz = vz - vn * sf.nz;
    let fx: number, fy: number, fz: number;
    if (travel >= 0) {
      // direction de roulement : axe X corps (braqué pour le train avant) projeté
      const steerA = gi === 0 ? this.steer : 0;
      wb[0] = Math.cos(steerA); wb[1] = 0; wb[2] = Math.sin(steerA);
      quatRotate(S, 6, wb, 0, wwv, 0);
      let ex = wwv[0], ey = wwv[1], ez = wwv[2];
      const en = ex * sf.nx + ey * sf.ny + ez * sf.nz;
      ex -= en * sf.nx; ey -= en * sf.ny; ez -= en * sf.nz;
      const el = Math.hypot(ex, ey, ez) || 1;
      ex /= el; ey /= el; ez /= el;
      // latéral = n × e
      const lx = sf.ny * ez - sf.nz * ey, ly = sf.nz * ex - sf.nx * ez, lz = sf.nx * ey - sf.ny * ex;
      const vl = tx * ex + ty * ey + tz * ez;
      const vt = tx * lx + ty * ly + tz * lz;
      const brake = gi === 1 ? this.brakeL : gi === 2 ? this.brakeR : 0;
      const muRoll = sf.kind === SURF_WATER ? 0.3 : 0.018 + brake * sf.mu * 0.85;
      const muLat = sf.kind === SURF_WATER ? 0.3 : sf.mu;
      const fl = -muRoll * fn * (vl / Math.sqrt(vl * vl + 0.08 * 0.08));
      const ft = -muLat * fn * (vt / Math.sqrt(vt * vt + 0.25 * 0.25));
      fx = sf.nx * fn + ex * fl + lx * ft;
      fy = sf.ny * fn + ey * fl + ly * ft;
      fz = sf.nz * fn + ez * fl + lz * ft;
    } else {
      const vt = Math.hypot(tx, ty, tz);
      const mu = sf.kind === SURF_WATER ? 0.8 : 0.45;
      const s = vt > 1e-4 ? (mu * fn) / Math.sqrt(vt * vt + 0.04) : 0;
      fx = sf.nx * fn - tx * s;
      fy = sf.ny * fn - ty * s;
      fz = sf.nz * fn - tz * s;
      if (this.recording && pen > 0) {
        if (-vn > this.structHit) this.structHitIdx = rb[0];
        this.structHit = Math.max(this.structHit, -vn);
        this.structPen = Math.max(this.structPen, pen);
        if (sf.kind === SURF_WATER) this.waterHit = true;
      }
    }
    Fw[0] += fx; Fw[1] += fy; Fw[2] += fz;
    // moment corps : r × F_b
    wb[0] = fx; wb[1] = fy; wb[2] = fz;
    quatRotateInv(S, 6, wb, 0, wwv, 0);
    Mb[0] += rb[1] * wwv[2] - rb[2] * wwv[1];
    Mb[1] += rb[2] * wwv[0] - rb[0] * wwv[2];
    Mb[2] += rb[0] * wwv[1] - rb[1] * wwv[0];
    if (this.recording && travel >= 0) {
      this.gearVn[gi] = -vn;
      if (sf.kind === SURF_WATER) this.waterHit = true;
    }
    return pen;
  }
  private structHit = 0;
  structHitIdx = 0;
  private structPen = 0;
  private waterHit = false;
  private readonly gearVn = new Float64Array(3);

  // ───────────────────────────── Pas de temps ─────────────────────────────

  step(dt: number, inp: Float64Array): void {
    this.events.length = 0;
    if (this.crashed || inp[I.PAUSED] > 0.5) return;
    const spec = this.spec;
    const S = this.S;
    this.t += dt;

    // ───── Systèmes ─────
    this.battery = inp[I.BATTERY] > 0.5;
    this.apu = this.battery && inp[I.APU] > 0.5;
    this.pumps = this.battery && inp[I.PUMPS] > 0.5;
    this.avionics = this.battery && inp[I.AVIONICS] > 0.5;
    this.lights = this.battery ? inp[I.LIGHTS] : 0;

    // ───── Environnement ─────
    getSurfaceInfo(this.ap, S[0], S[2], this.t, this.surf);
    this.groundH = this.surf.height;
    this.surfKind = this.surf.kind;
    this.agl = S[1] + spec.gear[1].pos[1] - this.surf.height;
    isa(S[1], this.atmo, this.cfg.deltaIsa);
    if (inp[I.WINDSHEAR] > 0.5 && !this.wind.burstActive) {
      // microburst 1,8 km devant l'avion sur sa trajectoire
      const vh = Math.hypot(S[3], S[5]) || 1;
      this.wind.triggerBurst(S[0] + (S[3] / vh) * 1800, S[2] + (S[5] / vh) * 1800);
    }
    const ww = this.wind.sample(S[0], Math.max(0, this.agl), S[2], this.tas, dt);
    this.windW[0] = ww[0]; this.windW[1] = ww[1]; this.windW[2] = ww[2];
    if (this.ap.carrier) carrierPose(this.ap.carrier, this.t, this.pose, this.cfg.seaState);

    // ───── Commandes et actionneurs ─────
    const perf = spec.perf;
    const fighter = spec.category === 'fighter';
    const tauAct = fighter ? 0.04 : spec.category === 'ga' ? 0.06 : 0.1;
    const ka = clamp(dt / tauAct, 0, 1);
    const flapCmd = clamp(inp[I.FLAPS], 0, 1);
    const flapRate = spec.category === 'ga' ? 0.25 : 0.12;
    this.flap += clamp(flapCmd - this.flap, -flapRate * dt, flapRate * dt);
    const gearCmd = inp[I.GEAR] > 0.5 ? 1 : 0;
    const onGround = this.onGroundMask !== 0;
    if (!(onGround && gearCmd === 0)) this.gearPos += clamp(gearCmd - this.gearPos, -dt / 7, dt / 7);
    this.speedbrake += clamp(clamp(inp[I.SPEEDBRAKE], 0, 1) - this.speedbrake, -dt, dt);
    // spoilers sol automatiques : armés + toucher + manettes réduites
    const armed = inp[I.SPOILER_ARM] > 0.5;
    const thr0 = inp[I.THROTTLE];
    const ground = onGround && armed && thr0 < 0.1 && !fighter;
    this.spoiler += clamp((ground ? 1 : this.speedbrake * (fighter ? 0 : 0.5)) - this.spoiler, -dt * 2, dt * 2);
    this.hook += clamp((inp[I.HOOK] > 0.5 && spec.hasHook ? 1 : 0) - this.hook, -dt, dt);
    const park = inp[I.PARKING] > 0.5 ? 1 : 0;
    this.brakeL = Math.max(clamp(inp[I.BRAKE_L], 0, 1), park);
    this.brakeR = Math.max(clamp(inp[I.BRAKE_R], 0, 1), park);
    const gs = Math.hypot(S[3] - this.surf.vx, S[5] - this.surf.vz);
    const steerMax = lerp(55, 6, smoothstep(4, 30, gs)) * DEG;
    this.steer = clamp(inp[I.YAW], -1, 1) * steerMax;

    // ───── FCS (utilise les coefficients du pas précédent) ─────
    eulerFromQuat(S, 6, this.euler, 0);
    const ctx = this.fcsCtx;
    const cas = tasToCas(this.tas, this.atmo);
    ctx.dt = dt; ctx.V = this.tas; ctx.qbar = this.qbar; ctx.Ixx = this.Ixx; ctx.Iyaw = this.Iyaw; ctx.Ipitch = this.Ipitch;
    ctx.mass = this.mass; ctx.nz = this.nz; ctx.p = S[10]; ctx.q = S[12]; ctx.r = -S[11]; ctx.alpha = this.alpha; ctx.beta = this.beta;
    ctx.pitch = this.euler[1]; ctx.bank = this.euler[2]; ctx.heading = this.euler[0]; ctx.altitude = S[1]; ctx.vs = S[4]; ctx.cas = cas;
    ctx.onGround = onGround;
    const acNow = this.coefficients(this.alpha, this.beta, S[10], S[12], -S[11], this.tas, this.mach, this.elev, this.ail, this.rud, this.agl);
    ctx.CmOther = acNow.CmOther; ctx.ClOther = acNow.ClOther; ctx.CnOther = acNow.CnOther;
    ctx.Cmde = acNow.Cmde; ctx.Clda = acNow.Clda; ctx.Cndr = acNow.Cndr;
    let thrust = 0;
    for (const e of this.engines) thrust += e.thrust;
    ctx.thrust = thrust;
    const vecDeg = spec.engines[0].vectorDeg ?? 0;
    ctx.vectorMax = this.fcs.law === LAW_DIRECT ? 0 : vecDeg * DEG;
    ctx.vectorArm = Math.abs(this.engB[0]);
    const pc = this.pilot;
    pc.pitch = clamp(inp[I.PITCH], -1, 1); pc.roll = clamp(inp[I.ROLL], -1, 1); pc.yaw = clamp(inp[I.YAW], -1, 1);
    pc.trim = clamp(this.trimBase + inp[I.TRIM], -1, 1);
    pc.lawRequest = inp[I.FCS_LAW_REQ];
    pc.apHdg = inp[I.AP_HDG_ON] > 0.5 && this.avionics; pc.apAlt = inp[I.AP_ALT_ON] > 0.5 && this.avionics; pc.apAthr = inp[I.AP_ATHR_ON] > 0.5 && this.avionics;
    pc.hdgTarget = inp[I.AP_HDG] * DEG; pc.altTarget = inp[I.AP_ALT] * FT; pc.spdTarget = inp[I.AP_SPD] * KT;
    pc.throttle = thr0;
    this.fcs.failLaw = inp[I.FAIL_FBW];
    if (!this.battery) this.fcs.failLaw = 2;
    const fo = this.fcs.update(ctx, pc);
    this.elev += (fo.elev - this.elev) * ka;
    this.ail += (fo.ail - this.ail) * ka;
    this.rud += (fo.rud - this.rud) * ka;
    this.nozzle += (fo.nozzle - this.nozzle) * ka;
    this.athrLever = fo.throttle;

    // ───── Moteurs ─────
    const env = this.engEnv;
    env.sigma = this.atmo.sigma; env.mach = this.mach; env.V = this.tas;
    env.battery = this.battery; env.apu = this.apu; env.pumps = this.pumps; env.fuel = this.fuel;
    const startMask = inp[I.ENGINE_START] | 0;
    const failMask = inp[I.FAIL_ENGINE] | 0;
    const cutMask = inp[I.ENGINE_CUT] | 0;
    let ff = 0;
    let hoverLever = -1;
    const sv = spec.stovl;
    if (sv) {
      const want = inp[I.STOVL] > 0.5;
      this.fanDoor += clamp((want ? 1 : 0) - this.fanDoor, -dt / 4, dt / 4);
      const nzTarget = want ? clamp(inp[I.NOZZLE], 0, 1) * sv.nozzleMaxDeg * DEG : 0;
      this.nozzleAng += clamp(nzTarget - this.nozzleAng, -30 * DEG * dt, 30 * DEG * dt);
      hoverLever = this.hoverControl(dt, pc.pitch, pc.roll, pc.yaw, thr0);
    }
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i];
      const wasRunning = e.running;
      e.failed = (failMask & (1 << i)) !== 0;
      e.cut = (cutMask & (1 << i)) !== 0;
      let lever = clamp(pc.apAthr ? fo.throttle : thr0, 0, 1);
      if (sv && this.fanDoor > 0.05) lever = Math.min(lever, AB_DETENT); // PC interdite en STOVL
      if (hoverLever >= 0) lever = hoverLever;
      updateEngine(e, lever, (startMask & (1 << i)) !== 0, env, dt, sv && this.fanDoor > 0.5 ? 3 : 1);
      ff += e.ff;
      if (wasRunning !== e.running) this.events.push({ type: 'engine', index: i, running: e.running });
    }
    this.fuel = Math.max(0, this.fuel - (ff / 3600) * dt);
    this.updateMass();

    // ───── Catapulte ─────
    if (this.ap.carrier && this.catState === 1 && inp[I.CATAPULT] > 0.5) {
      this.catState = 2;
      this.catV = 0;
      this.catS = 0;
      this.catEndV = Math.max(55, perf.vR * KT * 1.02);
      this.events.push({ type: 'catapult', t: this.t });
    }
    if (this.catState === 2 && this.ap.carrier) {
      const cat = this.ap.carrier.catapults[this.catIndex];
      const len = cat[2] - cat[0];
      const a = (this.catEndV * this.catEndV) / (2 * len);
      this.catV += a * dt;
      this.catS += this.catV * dt;
      if (this.catS >= len) this.catState = 3;
    }

    // ───── RK4 ─────
    this.structHit = 0; this.structPen = 0; this.waterHit = false;
    this.recording = true;
    this.derivative(S, this.t - dt, this.k1);
    this.recording = false;
    const h2 = dt / 2;
    for (let i = 0; i < N; i++) this.Stmp[i] = S[i] + h2 * this.k1[i];
    this.derivative(this.Stmp, this.t - h2, this.k2);
    for (let i = 0; i < N; i++) this.Stmp[i] = S[i] + h2 * this.k2[i];
    this.derivative(this.Stmp, this.t - h2, this.k3);
    for (let i = 0; i < N; i++) this.Stmp[i] = S[i] + dt * this.k3[i];
    this.derivative(this.Stmp, this.t, this.k4);
    for (let i = 0; i < N; i++) S[i] += (dt / 6) * (this.k1[i] + 2 * this.k2[i] + 2 * this.k3[i] + this.k4[i]);
    quatNormalize(S, 6);

    this.postStep(dt, inp);
  }
  athrLever = 0;

  private postStep(dt: number, _inp: Float64Array): void {
    const spec = this.spec;
    const S = this.S;
    const onGround = this.onGroundMask !== 0;
    // toucher
    if (onGround && !this.wowPrev && this.airborneTime > 0.8) {
      let vs = 0;
      for (let i = 0; i < this.nGear; i++) vs = Math.max(vs, this.gearVn[i]);
      this.tdVs = vs;
      this.tdCount++;
      this.events.push({ type: 'touchdown', vs, t: this.t, gear: this.onGroundMask & 1 ? 'nose' : 'main' });
      if (vs > spec.perf.maxSinkRate * 1.7) this.crash(`Train arraché : taux de chute ${(vs / FT * 60).toFixed(0)} ft/min`);
    }
    this.airborneTime = onGround ? 0 : this.airborneTime + dt;
    this.wowPrev = onGround;
    // structure
    if (this.waterHit) this.crash(this.ap.carrier ? 'Amerrissage — impact avec l\'océan' : 'Amerrissage');
    else if (this.structHit > 3.0) this.crash(`Impact structure à ${this.structHit.toFixed(1)} m/s`);
    else if (this.structPen >= 10) this.crash('Impact avec la coque / rampe du porte-avions');
    else if (this.structPen > 0.8) this.crash('Contact structure / sol');
    if (this.gearPos < 0.95 && this.gearPos > 0.05 && onGround) this.crash('Train non verrouillé');
    if (this.nz > spec.perf.nzMax * 1.5 || this.nz < spec.perf.nzMin * 1.5) this.crash(`Rupture structurale (n = ${this.nz.toFixed(1)} g)`);

    // brins d'arrêt
    if (this.ap.carrier && this.wire < 0 && this.hook > 0.9 && this.catState === 0) {
      const c = this.ap.carrier;
      const tv = this.tv3;
      quatRotate(S, 6, this.hookB, 0, tv, 0);
      const hx = S[0] + tv[0], hy = S[1] + tv[1], hz = S[2] + tv[2];
      worldToShip(this.pose, hx, hz, this.sp);
      const ang = c.landingAngle * DEG;
      const ds = this.sp.s - c.landingOrigin[0], dl = this.sp.l - c.landingOrigin[1];
      const along = ds * Math.cos(ang) + dl * Math.sin(ang);
      const lat = -ds * Math.sin(ang) + dl * Math.cos(ang);
      const deckH = deckHeightAt(c, this.pose, this.sp.s, this.sp.l);
      if (hy - deckH < 0.6 && Math.abs(lat) < c.wireHalfLength) {
        for (let wi = 0; wi < c.wires.length; wi++) {
          const wpos = c.wires[wi];
          if (this.prevHookAxis < wpos && along >= wpos) {
            this.wire = wi;
            const hdg = this.pose.heading + ang;
            this.wireVEng = (S[3] - this.pose.vx) * Math.sin(hdg) + (S[5] - this.pose.vz) * -Math.cos(hdg);
            this.events.push({ type: 'wire', wire: wi + 1, t: this.t });
            break;
          }
        }
      }
      this.prevHookAxis = along;
    }

    // facteurs de charge physiologiques (voile noir / rouge)
    const fighter = spec.category === 'fighter';
    const tol = fighter ? 7.5 : 4.5;
    if (this.nz > tol) this.blackout = Math.min(1, this.blackout + ((this.nz - tol) / 4) * dt);
    else this.blackout = Math.max(0, this.blackout - 0.35 * dt);
    if (this.nz < -2.5) this.redout = Math.min(1, this.redout + ((-2.5 - this.nz) / 2) * dt);
    else this.redout = Math.max(0, this.redout - 0.4 * dt);

    // alarmes
    const airborne = !onGround;
    const aS = this.ac.alphaStall;
    this.stallWarn = airborne && this.alpha > aS - 2.5 * DEG && this.tas > 15 ? 1 : 0;
    if (spec.fcs === 'fbw' && this.fcs.law === 0 && spec.category !== 'fighter') this.stallWarn = airborne && this.alpha > aS - 1 * DEG ? 1 : 0;
    this.buffet = clamp(smoothstep(aS - 4 * DEG, aS + 3 * DEG, this.alpha) + smoothstep(spec.perf.mmo, spec.perf.mmo + 0.06, this.mach) * (fighter ? 0 : 1), 0, 1);
    this.gpwsTimer -= dt;
    if (this.gpwsTimer <= 0) {
      this.gpwsTimer = 0.1;
      this.gpws = this.computeGpws(airborne);
    }
  }

  private computeGpws(airborne: boolean): number {
    if (!airborne || this.crashed || !this.avionics) return 0;
    const S = this.S;
    const aglFt = this.agl / FT;
    const vsFpm = (S[4] - this.surf.vy) / FT * 60;
    if (this.stallWarn) return 7;
    if (aglFt < 2500) {
      const lim = 1000 + aglFt * 0.9;
      if (-vsFpm > lim * 1.35 && aglFt > 30) return 2;
      if (-vsFpm > lim && aglFt > 30) return 1;
      if (this.spec.category !== 'fighter') {
        if (aglFt < 500 && this.gearPos < 0.5 && this.tas < 100 && vsFpm < 0) return 3;
        if (Math.abs(this.euler[2]) > 40 * DEG) return 5;
      }
    }
    // terrain devant : projection 20 s
    const T = 20;
    const fx = S[0] + S[3] * T, fz = S[2] + S[5] * T, fy = S[1] + S[4] * T;
    getSurfaceInfo(this.ap, fx, fz, this.t + T, this.surf);
    const nearRunway = this.gearPos > 0.9 && this.flap > 0.2;
    if (!nearRunway && fy < this.surf.height + 60 && this.surf.kind !== SURF_WATER) return 2;
    return 0;
  }

  private crash(reason: string): void {
    if (this.crashed) return;
    this.crashed = true;
    this.crashReason = reason;
    this.events.push({ type: 'crash', reason, t: this.t });
  }

  /** Écrit le snapshot d'état dans out (layout O). */
  writeOut(out: Float64Array, wallMs: number): void {
    const S = this.S;
    out[O.SIM_TIME] = this.t;
    out[O.WALL_TIME] = wallMs;
    out[O.PX] = S[0]; out[O.PY] = S[1]; out[O.PZ] = S[2];
    out[O.QX] = S[6]; out[O.QY] = S[7]; out[O.QZ] = S[8]; out[O.QW] = S[9];
    out[O.VX] = S[3]; out[O.VY] = S[4]; out[O.VZ] = S[5];
    out[O.WX] = S[10]; out[O.WY] = S[11]; out[O.WZ] = S[12];
    out[O.ALPHA] = this.alpha; out[O.BETA] = this.beta; out[O.TAS] = this.tas;
    out[O.CAS] = tasToCas(this.tas, this.atmo); out[O.MACH] = this.mach;
    out[O.NZ] = this.nz; out[O.NX] = this.nx; out[O.NY] = this.ny;
    out[O.ALT] = S[1]; out[O.AGL] = this.agl; out[O.VS] = S[4];
    eulerFromQuat(S, 6, this.euler, 0);
    out[O.HEADING] = this.euler[0]; out[O.PITCH] = this.euler[1]; out[O.BANK] = this.euler[2];
    let T = 0, run = 0;
    for (let i = 0; i < 4; i++) {
      const e = this.engines[i];
      out[O.N1 + i] = e ? e.n1 : 0;
      out[O.N2 + i] = e ? e.n2 : 0;
      out[O.EGT + i] = e ? e.egt : 0;
      out[O.FF + i] = e ? e.ff : 0;
      if (e) { T += e.thrust; if (e.running) run |= 1 << i; }
    }
    out[O.THRUST] = T; out[O.ENG_RUN] = run;
    out[O.FUEL] = this.fuel; out[O.MASS] = this.mass;
    out[O.ELEV] = this.elev; out[O.AIL] = this.ail; out[O.RUD] = this.rud; out[O.FLAPS] = this.flap;
    out[O.GEAR] = this.gearPos; out[O.SPOILER] = this.spoiler; out[O.SPEEDBRAKE] = this.speedbrake; out[O.HOOK] = this.hook;
    out[O.BRAKE] = Math.max(this.brakeL, this.brakeR);
    out[O.AB] = this.engines.reduce((a, e) => Math.max(a, e.ab), 0);
    out[O.NOZZLE] = this.nozzle; out[O.CANARD] = this.elev;
    out[O.ON_GROUND] = this.onGroundMask;
    out[O.COMP_N] = this.gearComp[0]; out[O.COMP_L] = this.gearComp[1]; out[O.COMP_R] = this.gearComp[2];
    out[O.STALL_WARN] = this.stallWarn; out[O.BUFFET] = this.buffet; out[O.FCS_LAW] = this.fcs.law;
    out[O.AP_FLAGS] = (this.pilot.apHdg ? AP.HDG : 0) | (this.pilot.apAlt ? AP.ALT : 0) | (this.pilot.apAthr ? AP.ATHR : 0);
    out[O.CRASHED] = this.crashed ? 1 : 0;
    out[O.WIRE] = this.wire + 1; out[O.CAT_STATE] = this.catState;
    out[O.WIND_X] = this.windW[0]; out[O.WIND_Y] = this.windW[1]; out[O.WIND_Z] = this.windW[2];
    out[O.BLACKOUT] = this.blackout; out[O.REDOUT] = this.redout;
    out[O.CL] = this.ac.CL; out[O.CD] = this.ac.CD; out[O.QDYN] = this.qbar;
    out[O.SURF_VX] = this.surf.vx; out[O.SURF_VZ] = this.surf.vz;
    out[O.PROP_RPM] = this.engines[0]?.propRpm ?? 0;
    out[O.TD_VS] = this.tdVs; out[O.TD_COUNT] = this.tdCount;
    out[O.APU] = this.apu ? 1 : 0; out[O.BATTERY] = this.battery ? 1 : 0; out[O.AVIONICS] = this.avionics ? 1 : 0; out[O.PUMPS] = this.pumps ? 1 : 0;
    out[O.STICK_P] = this.pilot.pitch; out[O.STICK_R] = this.pilot.roll; out[O.PEDALS] = this.pilot.yaw;
    out[O.THROTTLE] = this.pilot.apAthr ? this.athrLever : this.pilot.throttle;
    out[O.GPWS] = this.gpws;
    out[O.CARRIER_X] = this.pose.x; out[O.CARRIER_Z] = this.pose.z; out[O.CARRIER_HDG] = this.pose.heading;
    out[O.CARRIER_PITCH] = this.pose.pitch; out[O.CARRIER_ROLL] = this.pose.roll; out[O.CARRIER_HEAVE] = this.pose.heave;
    out[O.LIGHTS] = this.lights; out[O.PARKING] = Math.min(this.brakeL, this.brakeR);
    out[O.WING_FLEX] = this.onGroundMask ? this.spec.perf.wingFlexPerG * 0.15 : this.spec.perf.wingFlexPerG * this.nz;
    out[O.GS] = Math.hypot(S[3], S[5]);
    out[O.TRIM] = this.pilot.trim;
    out[O.AOA_LIMIT] = this.fcs.out.alphaLimiting ? 1 : 0;
    out[O.GROUND_H] = this.groundH; out[O.SURF_KIND] = this.surfKind;
    out[O.STALLED] = this.ac.stall;
    out[O.WIND_SHEAR] = this.wind.burstActive ? 1 : 0;
    out[O.STOVL] = this.fanDoor;
    out[O.NOZZLE_ANGLE] = this.nozzleAng;
  }

  /** Référence d'approche courante (ILS/FLOLS). */
  approach(): ApproachRef {
    return approachRef(this.ap, this.t, 0, this.apRef);
  }

  isOnDeck(): boolean {
    return this.surf.kind === SURF_DECK;
  }
}

const DUMMY_CARRIER = {
  x0: 0, z0: 0, heading: 0, speed: 0, deckHeight: 0, deck: [] as [number, number][], landingOrigin: [0, 0] as [number, number], landingAngle: 0,
  wires: [], wireHalfLength: 0, catapults: [], flols: [0, 0] as [number, number], glideDeg: 3, island: [0, 0, 0, 0, 0] as [number, number, number, number, number],
};
const POSE_SCRATCH = createCarrierPose();
