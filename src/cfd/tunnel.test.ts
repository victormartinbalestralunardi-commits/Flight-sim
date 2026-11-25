import { describe, expect, it } from 'vitest';
import { cpCritical, runStreamlines, runTunnel, type TunnelRequest } from './tunnel';
import { DEFAULT_MODS } from '../aircraft/mods';

const base: TunnelRequest = { id: 1, aircraft: 'b787', mods: DEFAULT_MODS, xcgPct: 38, alphaDeg: 4, betaDeg: 0, mach: 0.3, altitude: 0, flap: 0, massKg: 200000, streamlines: true };

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
});
