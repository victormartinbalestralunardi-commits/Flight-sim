import { describe, expect, it } from 'vitest';
import { BlackBox, recField } from './blackbox';
import { O, OUT_SIZE } from '../physics/layout';
import { FT } from '../physics/math';
import { coldDarkChecklist, nextStep } from '../cockpit/checklist';
import { getAircraft } from '../aircraft/specs';
import { O as OO, LIGHT } from '../physics/layout';

describe('Boîte noire', () => {
  it('enregistre à 10 Hz et analyse le toucher (taux de chute, distance de freinage)', () => {
    const bb = new BlackBox('a380', 'lfbo');
    const s = new Float64Array(OUT_SIZE);
    const dt = 1 / 60;
    let t = 0, x = 0, v = 70;
    for (let i = 0; i < 60 * 60; i++) {
      t += dt;
      const ground = t > 10;
      if (ground) v = Math.max(0, v - 2.5 * dt);
      x += v * dt;
      s[O.SIM_TIME] = t; s[O.PX] = x * 0.6; s[O.PZ] = x * 0.8; s[O.VX] = v * 0.6; s[O.VZ] = v * 0.8;
      s[O.ON_GROUND] = ground ? 7 : 0; s[O.TD_VS] = 1.5; s[O.NZ] = ground ? 1.3 : 1; s[O.TAS] = v;
      bb.record(s, dt);
    }
    const r = bb.finish();
    expect(r.n).toBeGreaterThan(590);
    expect(recField(r, 100, 't')).toBeCloseTo(10.0, 0);
    expect(r.analysis.touchdown).not.toBeNull();
    expect(r.analysis.touchdown!.vsFpm).toBeCloseTo((1.5 / FT) * 60, 0);
    // v² / 2a = 70² / 5 = 980 m
    expect(r.analysis.brakingDistance!).toBeGreaterThan(900);
    expect(r.analysis.brakingDistance!).toBeLessThan(1020);
    expect(r.analysis.verdict).toContain('ferme');
  });
});

describe('Check-list Cold & Dark', () => {
  it('séquence validée par l\'état physique', () => {
    const steps = coldDarkChecklist(getAircraft('a380'));
    expect(steps.map((s) => s.id)).toEqual(['bat', 'apu', 'pumps', 'eng0', 'eng1', 'eng2', 'eng3', 'avio', 'nav', 'park']);
    const s = new Float64Array(OUT_SIZE);
    s[OO.PARKING] = 1;
    expect(nextStep(steps, s)).toBe(0);
    s[OO.BATTERY] = 1; s[OO.APU] = 1; s[OO.PUMPS] = 1;
    expect(nextStep(steps, s)).toBe(3);
    s[OO.ENG_RUN] = 15; s[OO.AVIONICS] = 1; s[OO.LIGHTS] = LIGHT.NAV | LIGHT.BEACON; s[OO.PARKING] = 0;
    expect(nextStep(steps, s)).toBe(steps.length);
    expect(coldDarkChecklist(getAircraft('dr400')).some((x) => x.id === 'apu')).toBe(false);
  });
});
