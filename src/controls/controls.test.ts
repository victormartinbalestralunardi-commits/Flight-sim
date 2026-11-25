import { describe, expect, it } from 'vitest';
import { assignKey, defaultBindings, findConflicts, keyLabel } from './bindings';
import { shapeAxis } from './gamepad';

describe('Mapping clavier', () => {
  it('aucun conflit dans le mapping par défaut', () => {
    expect(findConflicts(defaultBindings())).toEqual([]);
  });
  it('détecte un conflit après remapping', () => {
    const b = assignKey(defaultBindings(), 'gearToggle', 0, 'KeyF');
    const c = findConflicts(b);
    expect(c).toHaveLength(1);
    expect(c[0].actions.sort()).toEqual(['flapsDown', 'gearToggle']);
  });
  it('libellés lisibles', () => {
    expect(keyLabel('KeyG')).toBe('G');
    expect(keyLabel('ArrowUp')).toBe('↑');
  });
});

describe('Courbes manette', () => {
  it('zone morte et expo', () => {
    expect(shapeAxis(0.05, 0.08, 0.3)).toBe(0);
    expect(shapeAxis(1, 0.08, 0.3)).toBeCloseTo(1, 9);
    expect(shapeAxis(-1, 0.08, 0.3)).toBeCloseTo(-1, 9);
    // expo : réponse plus douce au centre
    expect(shapeAxis(0.5, 0, 1)).toBeCloseTo(0.125, 9);
    expect(shapeAxis(0.5, 0, 0)).toBeCloseTo(0.5, 9);
  });
});
