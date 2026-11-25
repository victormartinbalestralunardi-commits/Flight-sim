import { describe, expect, it } from 'vitest';
import { createAtmo, isa, tasToCas, pressureAltitude } from './isa';
import { DEG, eulerFromQuat, quatFromEuler, quatRotate, quatRotateInv, KT } from './math';
import { FlightModel, type FlightConfig } from './flightModel';
import { IN_SIZE, I, O, OUT_SIZE, LIGHT } from './layout';
import { getAircraft } from '../aircraft/specs';
import { computeDerivatives, npPercent } from '../cfd/derivatives';
import type { AircraftId } from '../aircraft/types';
import type { AirportId, StartMode } from '../airports/airports';
import { carrierPose, createCarrierPose, createSurfaceInfo, getAirport, getSurfaceInfo, ilsDeviation, approachRef, SURF_DECK, SURF_RUNWAY, papiWhiteCount } from '../airports/airports';

describe('ISA', () => {
  it('valeurs de référence OACI', () => {
    const a = createAtmo();
    isa(0, a);
    expect(a.T).toBeCloseTo(288.15, 2);
    expect(a.p).toBeCloseTo(101325, 0);
    expect(a.rho).toBeCloseTo(1.225, 3);
    expect(a.a).toBeCloseTo(340.29, 1);
    isa(11000, a);
    expect(a.T).toBeCloseTo(216.65, 2);
    expect(a.p).toBeCloseTo(22632, -1);
    isa(5000, a);
    expect(a.rho).toBeCloseTo(0.7364, 3);
    expect(pressureAltitude(a.p)).toBeCloseTo(5000, 0);
  });
  it('CAS = TAS au niveau de la mer, CAS < TAS en altitude', () => {
    const a = createAtmo();
    isa(0, a);
    expect(tasToCas(100, a)).toBeCloseTo(100, 1);
    isa(10000, a);
    expect(tasToCas(250, a)).toBeLessThan(160);
  });
});

describe('Quaternions et angles', () => {
  it('cap/assiette/inclinaison aller-retour', () => {
    const q = new Float64Array(4), e = new Float64Array(3);
    for (const [h, p, b] of [[0, 0, 0], [90, 10, 0], [220, -5, 30], [143, 3, -45]]) {
      quatFromEuler(h * DEG, p * DEG, b * DEG, q, 0);
      eulerFromQuat(q, 0, e, 0);
      expect(e[0] / DEG).toBeCloseTo(h, 6);
      expect(e[1] / DEG).toBeCloseTo(p, 6);
      expect(e[2] / DEG).toBeCloseTo(b, 6);
    }
  });
  it('nez au cap 90 pointe vers l\'Est (+X) ; rotation inverse', () => {
    const q = new Float64Array(4), v = new Float64Array([1, 0, 0]), o = new Float64Array(3), r = new Float64Array(3);
    quatFromEuler(90 * DEG, 0, 0, q, 0);
    quatRotate(q, 0, v, 0, o, 0);
    expect(o[0]).toBeCloseTo(1, 9);
    expect(o[2]).toBeCloseTo(0, 9);
    quatFromEuler(0, 0, 0, q, 0);
    quatRotate(q, 0, v, 0, o, 0);
    expect(o[2]).toBeCloseTo(-1, 9); // Nord = −Z
    quatRotateInv(q, 0, o, 0, r, 0);
    expect(r[0]).toBeCloseTo(1, 9);
  });
});

describe('getSurfaceInfo', () => {
  it('piste LFBO : plan exact, normale verticale', () => {
    const ap = getAirport('lfbo');
    const s = createSurfaceInfo();
    getSurfaceInfo(ap, 50 * Math.sin(143 * DEG), -50 * Math.cos(143 * DEG), 0, s);
    expect(s.kind).toBe(SURF_RUNWAY);
    expect(s.height).toBeCloseTo(152, 0);
    expect(s.ny).toBeGreaterThan(0.9999);
  });
  it('taxiways et aires de trafic : surfaces revêtues continues, parking sur l\'aire', () => {
    for (const id of ['lfbo', 'lflj', 'tffj'] as const) {
      const ap = getAirport(id);
      const s = createSurfaceInfo();
      for (const t of ap.taxiways) {
        const [ax, az] = t.pts[0], [bx, bz] = t.pts[t.pts.length - 1];
        getSurfaceInfo(ap, (ax + bx) / 2, (az + bz) / 2, 0, s);
        expect(s.kind, `${id} ${t.id}`).toBe(SURF_RUNWAY);
        // pente faible sur toute voie de circulation
        expect(Math.hypot(s.nx, s.nz) / s.ny, `${id} ${t.id}`).toBeLessThan(0.05);
      }
      getSurfaceInfo(ap, ap.parking.x, ap.parking.z, 0, s);
      expect(s.kind, id).toBe(SURF_RUNWAY);
      expect(s.ny).toBeGreaterThan(0.999);
    }
  });
  it('Courchevel : pente de 18,6 % sur la partie haute', () => {
    const ap = getAirport('lflj');
    const r = ap.runways[0];
    const s = createSurfaceInfo();
    const d = 450;
    getSurfaceInfo(ap, r.thrX + Math.sin(r.heading * DEG) * d, r.thrZ - Math.cos(r.heading * DEG) * d, 0, s);
    const slope = Math.hypot(s.nx, s.nz) / s.ny;
    expect(slope).toBeCloseTo(0.186, 3);
    expect(s.kind).toBe(SURF_RUNWAY);
  });
  it('porte-avions : pont mobile à 25 kt, vitesse de surface transmise', () => {
    const ap = getAirport('cvn');
    const pose = carrierPose(ap.carrier!, 10, createCarrierPose());
    const s = createSurfaceInfo();
    getSurfaceInfo(ap, pose.x, pose.z, 10, s);
    expect(s.kind).toBe(SURF_DECK);
    expect(s.height).toBeGreaterThan(17);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(25 * KT, 3);
    // hors du pont : océan
    getSurfaceInfo(ap, pose.x + 400, pose.z, 10, s);
    expect(s.height).toBe(0);
  });
  it('ILS : sur l\'axe et le plan → écarts nuls ; PAPI 2 blancs/2 rouges', () => {
    const ap = getAirport('lfbo');
    const ref = approachRef(ap, 0);
    const d = 5000;
    const x = ref.x - Math.sin(143 * DEG) * d, z = ref.z + Math.cos(143 * DEG) * d;
    const y = ref.y + d * Math.tan(3 * DEG);
    const dev = ilsDeviation(ref, x, y, z, { loc: 0, gs: 0, locDeg: 0, gsDeg: 0, distance: 0, valid: false });
    expect(dev.valid).toBe(true);
    expect(Math.abs(dev.loc)).toBeLessThan(0.01);
    expect(Math.abs(dev.gs)).toBeLessThan(0.01);
    expect(papiWhiteCount(ref, x, y, z)).toBe(2);
    expect(papiWhiteCount(ref, x, y + 100, z)).toBe(4);
  });
});

function cfg(id: AircraftId, airport: AirportId, startMode: StartMode, xcgPct?: number): FlightConfig {
  const spec = getAircraft(id);
  const aero = computeDerivatives(spec);
  return {
    spec, aero, airport, startMode, fuelKg: spec.mass.fuelMax * 0.4, payloadKg: spec.mass.payloadMax * 0.3,
    xcgPct: xcgPct ?? spec.xcgDefault, wind: { fromDeg: 0, speed: 0, turbulence: 0 }, deltaIsa: 0, seaState: 1,
  };
}

function inputs(throttle: number, flaps: number, gear = 1): Float64Array {
  const inp = new Float64Array(IN_SIZE);
  inp[I.THROTTLE] = throttle;
  inp[I.FLAPS] = flaps;
  inp[I.GEAR] = gear;
  inp[I.BATTERY] = 1; inp[I.PUMPS] = 1; inp[I.AVIONICS] = 1; inp[I.APU] = 0;
  inp[I.LIGHTS] = LIGHT.NAV;
  inp[I.TIME_SCALE] = 1;
  return inp;
}

describe('Modèle de vol 6-DDL (RK4 240 Hz)', () => {
  it('finale 5 NM trimée : la trajectoire reste stable 20 s (DR-400, loi directe)', () => {
    const m = new FlightModel(cfg('dr400', 'lfbo', 'final'));
    const inp = inputs(m.initialThrottle, m.flap);
    const out = new Float64Array(OUT_SIZE);
    const vs0 = m.S[4];
    for (let i = 0; i < 240 * 20; i++) m.step(1 / 240, inp);
    m.writeOut(out, 0);
    expect(out[O.CRASHED]).toBe(0);
    expect(Math.abs(out[O.VS] - vs0)).toBeLessThan(2.5);
    expect(Math.abs(out[O.BANK])).toBeLessThan(10 * DEG);
    expect(out[O.TAS]).toBeGreaterThan(55 * KT * 0.85);
  });

  it('finale A380 (FBW C*) : n_z ≈ 1, reste sur le plan sans action pilote', () => {
    const m = new FlightModel(cfg('a380', 'lfbo', 'final'));
    const inp = inputs(m.initialThrottle, m.flap);
    const out = new Float64Array(OUT_SIZE);
    for (let i = 0; i < 240 * 15; i++) m.step(1 / 240, inp);
    m.writeOut(out, 0);
    expect(out[O.CRASHED]).toBe(0);
    expect(out[O.NZ]).toBeGreaterThan(0.85);
    expect(out[O.NZ]).toBeLessThan(1.15);
    expect(out[O.FCS_LAW]).toBe(0);
  });

  it('au sol, frein de parc : l\'avion reste immobile et stable sur la piste', () => {
    const m = new FlightModel(cfg('b787', 'lfbo', 'runway'));
    const inp = inputs(0, 0.17);
    inp[I.PARKING] = 1;
    const out = new Float64Array(OUT_SIZE);
    const x0 = m.S[0], z0 = m.S[2];
    for (let i = 0; i < 240 * 8; i++) m.step(1 / 240, inp);
    m.writeOut(out, 0);
    expect(out[O.CRASHED]).toBe(0);
    expect(out[O.ON_GROUND]).toBe(7);
    expect(Math.hypot(m.S[0] - x0, m.S[2] - z0)).toBeLessThan(0.5);
    expect(Math.abs(out[O.PITCH])).toBeLessThan(3 * DEG);
  });

  it('décollage Rafale : gaz PC + rotation → en l\'air sous 40 s', () => {
    const m = new FlightModel(cfg('rafale', 'lfbo', 'runway'));
    const inp = inputs(1, 0);
    let airborne = -1;
    for (let i = 0; i < 240 * 40; i++) {
      inp[I.PITCH] = m.tas > 120 * KT ? 0.6 : 0;
      m.step(1 / 240, inp);
      if (m.onGroundMask === 0 && m.agl > 5 && airborne < 0) airborne = m.t;
    }
    expect(m.crashed).toBe(false);
    expect(airborne).toBeGreaterThan(0);
    expect(airborne).toBeLessThan(40);
  });

  it('CG derrière le foyer en loi directe → divergence en tangage (couplage VLM)', () => {
    const base = cfg('dr400', 'lfbo', 'final');
    const np = npPercent(base.aero);
    const stable = new FlightModel({ ...base, xcgPct: np - 12 });
    const unstable = new FlightModel({ ...base, xcgPct: np + 12 });
    const inpS = inputs(stable.initialThrottle, stable.flap);
    const inpU = inputs(unstable.initialThrottle, unstable.flap);
    let maxS = 0, maxU = 0;
    for (let i = 0; i < 240 * 8; i++) {
      // petite perturbation initiale de tangage
      inpS[I.PITCH] = i < 24 ? 0.15 : 0;
      inpU[I.PITCH] = i < 24 ? 0.15 : 0;
      stable.step(1 / 240, inpS);
      unstable.step(1 / 240, inpU);
      maxS = Math.max(maxS, Math.abs(stable.alpha));
      maxU = Math.max(maxU, Math.abs(unstable.alpha));
    }
    expect(maxU).toBeGreaterThan(maxS * 1.8);
  });

  it('appontage : crosse + brin → arrêt sur le pont mobile', () => {
    const m = new FlightModel(cfg('rafale', 'cvn', 'final'));
    const spec0 = m.spec;
    const inp = inputs(m.initialThrottle, m.flap);
    inp[I.HOOK] = 1;
    inp[I.AP_ATHR_ON] = 1;
    inp[I.AP_SPD] = m.spec.perf.vApp;
    // pilote auto simple : suit le FLOLS / axe en dérapage nul
    const out = new Float64Array(OUT_SIZE);
    let caught = false;
    for (let i = 0; i < 240 * 200 && !m.crashed; i++) {
      const ref = m.approach();
      const dev = ilsDeviation(ref, m.S[0], m.S[1], m.S[2], { loc: 0, gs: 0, locDeg: 0, gsDeg: 0, distance: 0, valid: false });
      m.writeOut(out, 0);
      const vsTarget = -Math.tan(3.5 * DEG) * (m.tas - 12.86) - dev.gsDeg * 1.5;
      void out;
      inp[I.PITCH] = Math.max(-0.5, Math.min(0.5, (vsTarget - m.S[4]) * 0.03));
      const hd = ref.heading * DEG, ddx = Math.sin(hd), ddz = -Math.cos(hd);
      const lat = (m.S[0] - ref.x) * -ddz + (m.S[2] - ref.z) * ddx;
      const latV = (m.S[3] - m.pose.vx) * -ddz + (m.S[5] - m.pose.vz) * ddx;
      const bankDes = Math.max(-0.25, Math.min(0.25, -(lat * 0.006 + latV * 0.08)));
      inp[I.ROLL] = Math.max(-0.5, Math.min(0.5, (bankDes - out[O.BANK]) * 2));
      inp[I.THROTTLE] = Math.max(0, Math.min(0.94, m.initialThrottle + (spec0.perf.vApp * KT - m.tas) * 0.05));
      if (m.onGroundMask) { inp[I.PITCH] = 0; inp[I.ROLL] = 0; inp[I.THROTTLE] = 0.9; inp[I.AP_ATHR_ON] = 0; }
      if (m.wire >= 0) inp[I.THROTTLE] = 0.1;
      m.step(1 / 240, inp);
      if (m.wire >= 0) caught = true;
      if (caught && Math.hypot(m.S[3] - m.pose.vx, m.S[5] - m.pose.vz) < 1.5) break;
    }
    expect(m.crashed, m.crashReason).toBe(false);
    expect(caught).toBe(true);
    expect(Math.hypot(m.S[3] - m.pose.vx, m.S[5] - m.pose.vz)).toBeLessThan(3);
  });

  it('F-35B STOVL : stationnaire stable (levier au neutre = V_z nulle), atterrissage vertical', () => {
    const m = new FlightModel(cfg('f35', 'lfbo', 'runway'));
    const inp = inputs(0.5, 0.5);
    inp[I.STOVL] = 1;
    inp[I.NOZZLE] = 1;
    // placer l'avion en l'air, immobile, configuration STOVL établie
    m.S[1] += 40;
    m.fanDoor = 1;
    m.nozzleAng = 95 * DEG;
    for (const e of m.engines) { e.n1 = 0.85; e.n2 = 0.9; }
    const y0 = m.S[1];
    for (let i = 0; i < 240 * 15; i++) m.step(1 / 240, inp);
    expect(m.crashed, m.crashReason).toBe(false);
    expect(Math.abs(m.S[1] - y0)).toBeLessThan(3);
    expect(Math.abs(m.euler[2])).toBeLessThan(3 * DEG);
    expect(Math.hypot(m.S[3], m.S[5])).toBeLessThan(4);
    // descente verticale : levier réduit → V_z ≈ −3 m/s, toucher doux
    inp[I.THROTTLE] = 0.27;
    for (let i = 0; i < 240 * 30 && m.onGroundMask === 0; i++) m.step(1 / 240, inp);
    expect(m.crashed, m.crashReason).toBe(false);
    expect(m.onGroundMask).not.toBe(0);
    expect(m.tdVs).toBeLessThan(3.7);
  });

  it('catapultage Rafale : refusé sans plein gaz, puis lancement à V_R en ~2 s et envol', () => {
    const m = new FlightModel(cfg('rafale', 'cvn', 'runway'));
    expect(m.catState).toBe(1);
    const inp = inputs(0.5, 0.5);
    inp[I.CATAPULT] = 1;
    for (let i = 0; i < 240; i++) m.step(1 / 240, inp);
    expect(m.catState).toBe(1); // gaz insuffisants : la retenue tient
    inp[I.THROTTLE] = 1;
    let tEnd = -1;
    for (let i = 0; i < 240 * 12 && !m.crashed; i++) {
      inp[I.PITCH] = m.catState === 3 ? 0.35 : 0;
      m.step(1 / 240, inp);
      if (m.catState === 3 && tEnd < 0) tEnd = m.t;
    }
    expect(m.crashed, m.crashReason).toBe(false);
    expect(tEnd).toBeGreaterThan(0);
    expect(m.S[1]).toBeGreaterThan(40); // au-dessus du pont (18,5 m)
  });
});

