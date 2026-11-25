/**
 * Ajustements géométriques de l'Atelier, appliqués à la fiche de l'appareil AVANT le calcul
 * VLM (donc répercutés sur les dérivées injectées dans le modèle de vol).
 */
import type { AircraftSpec, LiftingSurface } from './types';
import { getAircraft } from './specs';
import type { AircraftId } from './types';

export interface GeometryMods {
  /** facteur d'envergure de l'aile (0,85..1,15) */
  wingSpan: number;
  /** flèche additionnelle de l'aile (deg, −5..+5) */
  wingSweep: number;
  /** facteur d'aire de l'empennage horizontal / canard (0,6..1,4) */
  tailArea: number;
  /** facteur d'aire des dérives (0,6..1,4) */
  finArea: number;
  /** dièdre additionnel (deg, −4..+4) */
  dihedral: number;
}

export const DEFAULT_MODS: GeometryMods = { wingSpan: 1, wingSweep: 0, tailArea: 1, finArea: 1, dihedral: 0 };

function scaleSurface(s: LiftingSurface, k: number): LiftingSurface {
  // homothétie de facteur √k autour de la station d'emplanture (aire × k)
  const f = Math.sqrt(k);
  const r = s.stations[0];
  return {
    ...s,
    stations: s.stations.map((st, i) => ({
      ...st,
      chord: st.chord * f,
      le: i === 0 ? ([...st.le] as [number, number, number]) : [
        r.le[0] + (st.le[0] - r.le[0]) * f,
        r.le[1] + (st.le[1] - r.le[1]) * f,
        r.le[2] + (st.le[2] - r.le[2]) * f,
      ],
    })),
  };
}

export function applyMods(base: AircraftSpec, m: GeometryMods): AircraftSpec {
  const spec: AircraftSpec = JSON.parse(JSON.stringify(base));
  spec.surfaces = spec.surfaces.map((s) => {
    if (s.role === 'wing') {
      const r = s.stations[0];
      const tanS = Math.tan((m.wingSweep * Math.PI) / 180);
      const tanD = Math.tan((m.dihedral * Math.PI) / 180);
      return {
        ...s,
        stations: s.stations.map((st, i) => {
          if (i === 0) return st;
          const dz = (st.le[2] - r.le[2]) * m.wingSpan;
          return {
            ...st,
            le: [r.le[0] + (st.le[0] - r.le[0]) * m.wingSpan - dz * tanS, r.le[1] + (st.le[1] - r.le[1]) * m.wingSpan + dz * tanD, r.le[2] + dz] as [number, number, number],
          };
        }),
      };
    }
    if (s.role === 'htail' || s.role === 'canard') return scaleSurface(s, m.tailArea);
    if (s.role === 'vtail') return scaleSurface(s, m.finArea);
    return s;
  });
  spec.span = base.span * m.wingSpan;
  spec.wingArea = base.wingArea * m.wingSpan;
  return spec;
}

export function buildSpec(id: AircraftId, mods: GeometryMods = DEFAULT_MODS): AircraftSpec {
  return applyMods(getAircraft(id), mods);
}
