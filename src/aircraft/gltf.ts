/**
 * Chargeur de modèles externes .glb / .gltf. Tout modèle respectant la convention de
 * nommage (aileron_L, elevator_L, rudder, canard_L, flap_L, spoiler_L, gear_front,
 * gear_main_L/R, gear_strut_*, canopy, hook, nozzle*, afterburner*, fan_*, propeller,
 * light_*) est animé automatiquement par AircraftAnimator.
 *
 * Convention géométrique attendue : nez vers +X, dessus +Y, aile droite +Z, mètres,
 * origine au nez (le modèle est ensuite décalé de x_cg), gouvernes pivotant autour de leur X local.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const REQUIRED_NODE_HINTS = [
  'aileron_L', 'aileron_R', 'elevator_L', 'elevator_R', 'rudder', 'canard_L', 'flap_L', 'spoiler_L',
  'gear_front', 'gear_main_L', 'gear_main_R', 'canopy',
];

export interface GltfReport {
  object: THREE.Group;
  found: string[];
  missing: string[];
}

export async function loadGltfAircraft(url: string, xcg: number): Promise<GltfReport> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
  });
  const names = new Set<string>();
  model.traverse((o) => o.name && names.add(o.name));
  const has = (h: string) => [...names].some((n) => n === h || n.endsWith(`_${h}`) || n.startsWith(h));
  const found = REQUIRED_NODE_HINTS.filter(has);
  const missing = REQUIRED_NODE_HINTS.filter((h) => !has(h));
  model.position.x = -xcg;
  const object = new THREE.Group();
  object.add(model);
  return { object, found, missing };
}
