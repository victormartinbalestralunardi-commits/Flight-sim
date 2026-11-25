/**
 * Check-list « Cold & Dark » guidée : chaque étape est validée par l'état physique réel
 * (batterie, APU, pompes, régime moteur, avionique, feux) publié par le worker.
 */
import type { AircraftSpec } from '../aircraft/types';
import { O, LIGHT } from '../physics/layout';
import type { CockpitAction } from './Cockpit3D';

export interface ChecklistStep {
  id: string;
  label: string;
  hint: string;
  action: CockpitAction;
  done: (s: Float64Array) => boolean;
}

export function coldDarkChecklist(spec: AircraftSpec): ChecklistStep[] {
  const steps: ChecklistStep[] = [
    { id: 'bat', label: 'Batterie principale', hint: 'BAT → ON', action: 'battery', done: (s) => s[O.BATTERY] > 0.5 },
  ];
  if (spec.engines[0].type === 'turbofan') {
    steps.push({ id: 'apu', label: 'APU', hint: 'APU → START (air de démarrage)', action: 'apu', done: (s) => s[O.APU] > 0.5 });
  } else if (spec.engines[0].type === 'turbojet_ab') {
    steps.push({ id: 'apu', label: 'Démarreur JFS / IPP', hint: 'JFS → ON', action: 'apu', done: (s) => s[O.APU] > 0.5 });
  }
  steps.push({ id: 'pumps', label: 'Pompes carburant', hint: 'FUEL PUMPS → ON', action: 'pumps', done: (s) => s[O.PUMPS] > 0.5 });
  spec.engines.forEach((_, i) => {
    steps.push({
      id: `eng${i}`, label: `Allumage moteur ${i + 1}`, hint: `START ${i + 1} → attendre la stabilisation au ralenti`,
      action: `start${i}` as CockpitAction, done: (s) => (s[O.ENG_RUN] & (1 << i)) !== 0,
    });
  });
  steps.push({ id: 'avio', label: 'Avionique', hint: 'AVIONICS → ON', action: 'avionics', done: (s) => s[O.AVIONICS] > 0.5 });
  steps.push({ id: 'nav', label: 'Feux NAV + BEACON', hint: 'NAV → ON, BEACON → ON', action: 'lightNav', done: (s) => (s[O.LIGHTS] & LIGHT.NAV) !== 0 && (s[O.LIGHTS] & LIGHT.BEACON) !== 0 });
  steps.push({ id: 'park', label: 'Frein de parc desserré — prêt au roulage', hint: 'PARK BRAKE → OFF', action: 'parking', done: (s) => s[O.PARKING] < 0.5 });
  return steps;
}

/** Première étape non réalisée (les étapes sont séquentielles). */
export function nextStep(steps: ChecklistStep[], s: Float64Array): number {
  for (let i = 0; i < steps.length; i++) if (!steps[i].done(s)) return i;
  return steps.length;
}
