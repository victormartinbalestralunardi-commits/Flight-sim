/**
 * Actions de pilotage et mapping clavier remappable (KeyboardEvent.code), avec détection
 * de conflits. Persistance assurée par le store (localStorage).
 */

export type Action =
  | 'pitchUp' | 'pitchDown' | 'rollLeft' | 'rollRight' | 'yawLeft' | 'yawRight'
  | 'throttleUp' | 'throttleDown' | 'throttleIdle' | 'throttleMax'
  | 'flapsDown' | 'flapsUp' | 'gearToggle' | 'speedbrakeToggle' | 'brakes' | 'parkingBrake'
  | 'hookToggle' | 'trimUp' | 'trimDown' | 'fbwToggle' | 'autopilot' | 'catapult'
  | 'cameraNext' | 'cockpitToggle' | 'pause' | 'landingLights' | 'failuresPanel' | 'debugPanel'
  | 'photoMode' | 'spoilerArm' | 'stovlToggle' | 'nozzleDown' | 'nozzleUp';

export type Bindings = Record<Action, string[]>;

export interface ActionInfo {
  id: Action;
  label: string;
  group: 'Axes' | 'Moteurs' | 'Configuration' | 'Systèmes' | 'Caméras & interface';
  /** action continue (maintenue) ou impulsion */
  hold: boolean;
}

export const ACTIONS: ActionInfo[] = [
  { id: 'pitchUp', label: 'Tangage — cabrer', group: 'Axes', hold: true },
  { id: 'pitchDown', label: 'Tangage — piquer', group: 'Axes', hold: true },
  { id: 'rollLeft', label: 'Roulis gauche', group: 'Axes', hold: true },
  { id: 'rollRight', label: 'Roulis droite', group: 'Axes', hold: true },
  { id: 'yawLeft', label: 'Lacet gauche (palonnier)', group: 'Axes', hold: true },
  { id: 'yawRight', label: 'Lacet droite (palonnier)', group: 'Axes', hold: true },
  { id: 'throttleUp', label: 'Gaz +', group: 'Moteurs', hold: true },
  { id: 'throttleDown', label: 'Gaz −', group: 'Moteurs', hold: true },
  { id: 'throttleIdle', label: 'Gaz ralenti', group: 'Moteurs', hold: false },
  { id: 'throttleMax', label: 'Plein gaz / PC', group: 'Moteurs', hold: false },
  { id: 'flapsDown', label: 'Volets — sortir un cran', group: 'Configuration', hold: false },
  { id: 'flapsUp', label: 'Volets — rentrer un cran', group: 'Configuration', hold: false },
  { id: 'gearToggle', label: 'Train d\'atterrissage', group: 'Configuration', hold: false },
  { id: 'speedbrakeToggle', label: 'Aérofreins', group: 'Configuration', hold: false },
  { id: 'spoilerArm', label: 'Armement spoilers sol', group: 'Configuration', hold: false },
  { id: 'brakes', label: 'Freins de roues', group: 'Configuration', hold: true },
  { id: 'parkingBrake', label: 'Frein de parc', group: 'Configuration', hold: false },
  { id: 'hookToggle', label: 'Crosse d\'appontage', group: 'Configuration', hold: false },
  { id: 'catapult', label: 'Lancement catapulte', group: 'Configuration', hold: false },
  { id: 'stovlToggle', label: 'Mode STOVL (F-35B : portes soufflante)', group: 'Configuration', hold: false },
  { id: 'nozzleDown', label: 'Tuyère vers le bas (STOVL)', group: 'Configuration', hold: true },
  { id: 'nozzleUp', label: 'Tuyère vers l\'arrière (STOVL)', group: 'Configuration', hold: true },
  { id: 'trimUp', label: 'Trim cabreur', group: 'Systèmes', hold: true },
  { id: 'trimDown', label: 'Trim piqueur', group: 'Systèmes', hold: true },
  { id: 'fbwToggle', label: 'Bascule loi FBW (Normale / Directe)', group: 'Systèmes', hold: false },
  { id: 'autopilot', label: 'Pilote automatique (HDG/ALT/A-THR)', group: 'Systèmes', hold: false },
  { id: 'landingLights', label: 'Phares d\'atterrissage', group: 'Systèmes', hold: false },
  { id: 'cameraNext', label: 'Caméra suivante', group: 'Caméras & interface', hold: false },
  { id: 'cockpitToggle', label: 'Vue cockpit', group: 'Caméras & interface', hold: false },
  { id: 'pause', label: 'Pause', group: 'Caméras & interface', hold: false },
  { id: 'failuresPanel', label: 'Panneau des pannes', group: 'Caméras & interface', hold: false },
  { id: 'debugPanel', label: 'Panneau debug / métriques', group: 'Caméras & interface', hold: false },
  { id: 'photoMode', label: 'Mode photo (path tracing)', group: 'Caméras & interface', hold: false },
];

export function defaultBindings(): Bindings {
  return {
    pitchUp: ['ArrowDown', 'KeyS'],
    pitchDown: ['ArrowUp', 'KeyW'],
    rollLeft: ['ArrowLeft', 'KeyA'],
    rollRight: ['ArrowRight', 'KeyD'],
    yawLeft: ['KeyQ', 'Numpad0'],
    yawRight: ['KeyE', 'NumpadEnter'],
    throttleUp: ['ShiftLeft', 'Equal', 'NumpadAdd'],
    throttleDown: ['ControlLeft', 'Minus', 'NumpadSubtract'],
    throttleIdle: ['Digit1'],
    throttleMax: ['Digit0'],
    flapsDown: ['KeyF'],
    flapsUp: ['KeyR'],
    gearToggle: ['KeyG'],
    speedbrakeToggle: ['KeyB'],
    spoilerArm: ['KeyJ'],
    brakes: ['Space'],
    parkingBrake: ['KeyK'],
    hookToggle: ['KeyH'],
    catapult: ['KeyT'],
    stovlToggle: ['KeyY'],
    nozzleDown: ['Period'],
    nozzleUp: ['Comma'],
    trimUp: ['BracketRight'],
    trimDown: ['BracketLeft'],
    fbwToggle: ['KeyL'],
    autopilot: ['KeyZ'],
    landingLights: ['KeyN'],
    cameraNext: ['KeyC'],
    cockpitToggle: ['KeyV'],
    pause: ['KeyP', 'Escape'],
    failuresPanel: ['F8'],
    debugPanel: ['F3'],
    photoMode: ['F9'],
  };
}

export interface Conflict {
  code: string;
  actions: Action[];
}

/** Liste des touches assignées à plusieurs actions. */
export function findConflicts(b: Bindings): Conflict[] {
  const map = new Map<string, Action[]>();
  for (const [a, codes] of Object.entries(b) as [Action, string[]][]) {
    for (const c of codes) {
      const list = map.get(c) ?? [];
      list.push(a);
      map.set(c, list);
    }
  }
  return [...map.entries()].filter(([, l]) => l.length > 1).map(([code, actions]) => ({ code, actions }));
}

/** Assigne une touche (remplace l'emplacement `slot`), retourne le nouveau mapping. */
export function assignKey(b: Bindings, action: Action, slot: number, code: string): Bindings {
  const next: Bindings = { ...b, [action]: [...b[action]] };
  next[action][slot] = code;
  next[action] = next[action].filter(Boolean);
  return next;
}

/**
 * Disposition réelle du clavier (AZERTY, QWERTZ…) via `navigator.keyboard.getLayoutMap()`
 * (Chrome / Edge). Les liaisons utilisent les POSITIONS physiques (KeyboardEvent.code) :
 * sur AZERTY, « WASD » se trouve sous les touches imprimées « ZQSD ». Cette table sert à
 * afficher la touche réellement imprimée.
 */
let layoutMap: Map<string, string> | null = null;
export let keyboardLayout: 'azerty' | 'qwertz' | 'qwerty' | 'inconnue' = 'inconnue';

export async function initKeyboardLayout(): Promise<void> {
  const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  if (!kb?.getLayoutMap) return;
  try {
    const m = await kb.getLayoutMap();
    layoutMap = new Map(m);
    const q = layoutMap.get('KeyQ'), y = layoutMap.get('KeyY');
    keyboardLayout = q === 'a' ? 'azerty' : y === 'z' ? 'qwertz' : 'qwerty';
  } catch {
    /* API indisponible (Firefox, Safari) : libellés QWERTY */
  }
}

/** Libellé lisible d'un KeyboardEvent.code (touche imprimée si la disposition est connue). */
export function keyLabel(code: string): string {
  const printed = layoutMap?.get(code);
  if (printed && printed.trim() && (code.startsWith('Key') || code.startsWith('Digit') || /^(Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Backquote|Backslash|IntlBackslash)$/.test(code))) {
    return printed.toUpperCase();
  }
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Pavé ' + code.slice(6);
  const map: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Espace', ShiftLeft: 'Maj G', ShiftRight: 'Maj D',
    ControlLeft: 'Ctrl G', ControlRight: 'Ctrl D', Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Escape: 'Échap',
    Enter: 'Entrée', Tab: 'Tab', AltLeft: 'Alt', Backquote: '²', Comma: ',', Period: '.', Slash: '/',
  };
  return map[code] ?? code;
}
