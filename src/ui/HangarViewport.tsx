/** Vue 3D de l'atelier (remplacée au Sprint 3 par le modèle procédural PBR + path tracing). */
import type { AircraftId } from '../aircraft/types';
import type { GeometryMods } from '../aircraft/mods';

export default function HangarViewport(_props: { aircraft: AircraftId; mods: GeometryMods; xcgPct: number }) {
  return <div className="absolute inset-0 bg-gradient-to-b from-[#1b2333] to-[#0b0f17]" />;
}
