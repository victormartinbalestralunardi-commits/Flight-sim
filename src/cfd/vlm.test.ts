import { describe, expect, it } from 'vitest';
import type { AircraftSpec, LiftingSurface } from '../aircraft/types';
import { allAircraft, getAircraft } from '../aircraft/specs';
import { buildLattice, VlmSolver } from './vlm';
import { computeDerivatives, npPercent, staticMargin, verdict } from './derivatives';

function rectWing(AR: number, chord = 1): AircraftSpec {
  const semi = (AR * chord) / 2;
  const wing: LiftingSurface = {
    name: 'wing', role: 'wing', symmetric: true,
    airfoil: { name: 'flat', camber: 0, camberPos: 0.4, thickness: 0.1, clMax: 1.4 },
    stations: [{ le: [0, 0, 0], chord, twist: 0 }, { le: [0, 0, semi], chord, twist: 0 }],
    controls: [],
  };
  const base = getAircraft('dr400');
  return { ...base, surfaces: [wing], wingArea: 2 * semi * chord, span: 2 * semi };
}

describe('VLM — validations théoriques', () => {
  it('aile rectangulaire AR=6 : CLα ≈ Helmbold (±6 %)', () => {
    const spec = rectWing(6);
    const L = buildLattice(spec, { nc: 6, nsTotal: 16 });
    const s = new VlmSolver(L, spec.wingArea, 1, spec.span);
    const a = (4 * Math.PI) / 180;
    const r = s.solve({ alpha: a, beta: 0, p: 0, q: 0, r: 0, V: 50, mach: 0, rho: 1.225, ref: [-0.25, 0, 0] });
    const helmbold = (2 * Math.PI * 6) / (2 + Math.sqrt(36 + 4));
    expect(r.CL / a).toBeGreaterThan(helmbold * 0.94);
    expect(r.CL / a).toBeLessThan(helmbold * 1.06);
    // portance au 1/4 de corde : moment ≈ 0
    expect(Math.abs(r.Cm)).toBeLessThan(0.02);
    // traînée induite positive, Oswald plausible
    const e = (r.CL * r.CL) / (Math.PI * 6 * r.CD);
    expect(e).toBeGreaterThan(0.8);
    expect(e).toBeLessThan(1.05);
  });

  it('Prandtl-Glauert : CLα croît avec le Mach', () => {
    const spec = rectWing(8);
    const L = buildLattice(spec, { nc: 4, nsTotal: 12 });
    const s = new VlmSolver(L, spec.wingArea, 1, spec.span);
    const a = (3 * Math.PI) / 180;
    const c = { alpha: a, beta: 0, p: 0, q: 0, r: 0, V: 50, rho: 1.225, ref: [-0.25, 0, 0] as [number, number, number] };
    const lo = s.solve({ ...c, mach: 0 }).CL;
    const hi = s.solve({ ...c, mach: 0.7 }).CL;
    expect(hi / lo).toBeGreaterThan(1.15);
    expect(hi / lo).toBeLessThan(1 / Math.sqrt(1 - 0.49) + 0.02);
  });

  it('dérivées de stabilité : signes physiques pour les 7 appareils', () => {
    for (const spec of allAircraft()) {
      const d = computeDerivatives(spec);
      expect(d.CLa, spec.id).toBeGreaterThan(2);
      expect(d.CLa, spec.id).toBeLessThan(7.5);
      expect(d.Cmq, spec.id).toBeLessThan(0); // amortissement en tangage
      expect(d.Clp, spec.id).toBeLessThan(0); // amortissement en roulis
      expect(d.Cnr, spec.id).toBeLessThan(0); // amortissement en lacet
      expect(d.Cmde, spec.id).toBeGreaterThan(0); // commande cabreuse
      expect(d.Clda, spec.id).toBeGreaterThan(0); // roulis à droite
      expect(d.Cndr, spec.id).toBeGreaterThan(0); // nez à droite
      expect(d.Cnb, spec.id).toBeGreaterThan(0); // stabilité de girouette
      expect(d.Clb, spec.id).toBeLessThan(0.02); // effet dièdre (≤ ~0)
    }
  });

  it('foyer : les avions classiques sont stables au centrage par défaut', () => {
    for (const id of ['a380', 'b787', 'dr400', 'g8000'] as const) {
      const spec = getAircraft(id);
      const d = computeDerivatives(spec);
      const sm = staticMargin(d, spec.xcgDefault);
      expect(sm, `${id} np=${npPercent(d).toFixed(1)}%`).toBeGreaterThan(0.02);
    }
  });

  it('CG reculé derrière le foyer → verdict instable', () => {
    const spec = getAircraft('dr400');
    const d = computeDerivatives(spec);
    const np = npPercent(d);
    expect(verdict(d, np + 10, false).verdict).toBe('instable');
    expect(verdict(d, np - 15, false).verdict).toBe('stable');
  });
});
