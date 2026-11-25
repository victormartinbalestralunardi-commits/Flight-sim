import { describe, expect, it } from 'vitest';
import { cpCritical, runStreamlines, runTunnel, type TunnelRequest } from './tunnel';
import { DEFAULT_MODS } from '../aircraft/mods';

const base: TunnelRequest = { id: 1, aircraft: 'b787', mods: DEFAULT_MODS, xcgPct: 38, alphaDeg: 4, betaDeg: 0, mach: 0.3, altitude: 0, flap: 0, massKg: 200000, fuelKg: 50000, streamlines: true };

describe('Soufflerie numérique', () => {
  it('Cp* critique : −0,30 à M=0,85 et −0,78 à M=0,7 (isentropique)', () => {
    expect(cpCritical(0.85)).toBeCloseTo(-0.3, 1);
    expect(cpCritical(0.7)).toBeCloseTo(-0.78, 1);
  });
  it('extrados en dépression, intrados en surpression, pas de choc à M=0,3', () => {
    const r = runTunnel(base);
    let up = 0, lo = 0;
    for (let i = 0; i < r.geometry.n; i++) { up += r.cpUpper[i]; lo += r.cpLower[i]; }
    expect(up).toBeLessThan(lo);
    expect(r.shock.length).toBe(0);
    expect(r.polar.alpha.length).toBe(31);
    expect(r.CL).toBeGreaterThan(0.3);
  });
  it('onde de choc transsonique détectée à M=0,88', () => {
    const r = runTunnel({ ...base, id: 2, mach: 0.88, altitude: 11000, alphaDeg: 3 });
    expect(r.shock.length).toBeGreaterThan(0);
  });
  it('lignes de courant générées', () => {
    const s = runStreamlines(base);
    expect(s.offsets.length).toBeGreaterThan(20);
    expect(s.points.length).toBeGreaterThan(3000);
    console.log('streamlines ms', s.elapsedMs.toFixed(0));
  });

  it('couche limite, frottement, contraintes et Vmax cohérents (787)', () => {
    const r = runTunnel({ ...base, id: 5, mach: 0.8, altitude: 11000, alphaDeg: 2 });
    expect(r.bl.CDf).toBeGreaterThan(0.004);
    expect(r.bl.CDf).toBeLessThan(0.02);
    expect(r.bl.laminarFraction).toBeGreaterThan(0.02);
    expect(r.bl.laminarFraction).toBeLessThan(0.8);
    expect(r.stress.sigmaMax).toBeGreaterThan(1e6);
    expect(r.stress.safetyFactor).toBeGreaterThan(1);
    expect(r.stress.tipDeflection).toBeGreaterThan(0.2);
    expect(r.vmax.mach).toBeGreaterThan(0.8);
    expect(r.vmax.mach).toBeLessThanOrEqual(0.9);
    console.log('787 CDf', r.bl.CDf.toFixed(4), 'lam', r.bl.laminarFraction.toFixed(2), 'σmax MPa', (r.stress.sigmaMax / 1e6).toFixed(0), 'FS', r.stress.safetyFactor.toFixed(2), 'tip', r.stress.tipDeflection.toFixed(2), 'n', r.stress.loadFactor.toFixed(2), 'Vmax', r.vmax.mach.toFixed(2), r.vmax.limitedBy, 'Mprop', r.vmax.machPropulsive.toFixed(2));
  });
  it('F-22 supersonique : Vmax > Mach 1,5 ; Rafale : tourbillons de bord d\'attaque à α=18°', () => {
    const f22 = runTunnel({ ...base, id: 6, aircraft: 'f22', xcgPct: 22, mach: 0.9, altitude: 11000, alphaDeg: 2, massKg: 29000, fuelKg: 4000 });
    console.log('F22 Vmax', f22.vmax.mach.toFixed(2), f22.vmax.limitedBy, f22.vmax.machPropulsive.toFixed(2));
    expect(f22.vmax.mach).toBeGreaterThan(1.5);
    const raf = runStreamlines({ ...base, id: 7, aircraft: 'rafale', xcgPct: 25, mach: 0.25, alphaDeg: 18, massKg: 14000, fuelKg: 2000 });
    expect(raf.leVortex.length).toBe(24);
    let vortexPts = 0, turb = 0;
    for (const g of raf.regime) { if (g === 2) vortexPts++; if (g === 1 || g === 3) turb++; }
    expect(vortexPts).toBeGreaterThan(20);
    expect(turb).toBeGreaterThan(20);
  });
});
