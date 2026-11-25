/**
 * Matériaux PBR différenciés par appareil :
 * - revêtement furtif RAM mat absorbant (F-22, F-35) ;
 * - peinture brillante à vernis (clearcoat) pour A380 / 787 / Global 8000 / DR-400 ;
 * - aluminium brossé anisotrope sur les bords d'attaque ;
 * - verrières (teinte or ITO pour les chasseurs furtifs), caoutchouc, métal chaud.
 */
import * as THREE from 'three';
import type { AircraftSpec } from './types';

export interface AircraftMaterials {
  skin: THREE.MeshPhysicalMaterial;
  secondary: THREE.MeshPhysicalMaterial;
  accent: THREE.MeshPhysicalMaterial;
  leadingEdge: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  window: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  metalDark: THREE.MeshStandardMaterial;
  metalHot: THREE.MeshStandardMaterial;
  strut: THREE.MeshStandardMaterial;
  intake: THREE.MeshStandardMaterial;
}

export function createMaterials(spec: AircraftSpec): AircraftMaterials {
  const stealth = spec.id === 'f22' || spec.id === 'f35';
  const fighter = spec.category === 'fighter';
  const paint = (color: number) =>
    stealth
      ? new THREE.MeshPhysicalMaterial({ color, roughness: 0.84, metalness: 0.12, sheen: 0.35, sheenRoughness: 0.85, sheenColor: new THREE.Color(0x2b3036) })
      : fighter
        ? new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, metalness: 0.2, clearcoat: 0.25, clearcoatRoughness: 0.4 })
        : new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05 });
  const skin = paint(spec.livery.primary);
  const secondary = paint(spec.livery.secondary);
  const accent = paint(spec.livery.accent);
  const leadingEdge = stealth
    ? skin
    : new THREE.MeshPhysicalMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.3, clearcoat: 0.3, clearcoatRoughness: 0.15 }); // aluminium brossé
  const goldTint = stealth;
  const glass = new THREE.MeshPhysicalMaterial({
    color: goldTint ? 0xc9a85a : 0x8fa6b8,
    metalness: goldTint ? 0.35 : 0.0,
    roughness: 0.04,
    transmission: 0.85,
    ior: 1.5,
    thickness: 0.02,
    transparent: true,
    opacity: goldTint ? 0.55 : 0.32,
    side: THREE.DoubleSide,
    envMapIntensity: 1.4,
  });
  return {
    skin, secondary, accent, leadingEdge, glass,
    window: new THREE.MeshStandardMaterial({ color: 0x10161e, roughness: 0.1, metalness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92, metalness: 0 }),
    metalDark: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.45, metalness: 0.9 }),
    metalHot: new THREE.MeshStandardMaterial({ color: 0x4a3a32, roughness: 0.5, metalness: 0.85, emissive: new THREE.Color(0x000000) }),
    strut: new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.25, metalness: 0.95 }),
    intake: new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }),
  };
}
