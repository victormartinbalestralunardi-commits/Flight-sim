/**
 * Livrées procédurales peintes dans une texture plaquée sur le fuselage (UV : u = position
 * le long du fuselage 0 nez → 1 queue, v = angle de section / 2π, 0 = flanc droit,
 * 0,25 = dos, 0,5 = flanc gauche, 0,75 = ventre). Hublots, pare-brise, cheatlines,
 * immatriculation, radôme, lignes de panneaux : un seul matériau, aucune géométrie ajoutée.
 */
import * as THREE from 'three';
import type { AircraftSpec } from './types';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export interface LiveryMaps {
  map: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
}

/** Angle de section (rad) pour une hauteur relative sinθ ; renvoie v droit et gauche. */
function vSides(sinTheta: number): [number, number] {
  const th = Math.asin(Math.max(-1, Math.min(1, sinTheta)));
  const vr = (th / (2 * Math.PI) + 1) % 1;
  const vl = 0.5 - th / (2 * Math.PI);
  return [vr, vl];
}

export function createLivery(spec: AircraftSpec): LiveryMaps {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = document.createElement('canvas');
  r.width = 512; r.height = 256;
  const gr = r.getContext('2d')!;
  const L = spec.fuselage.length;
  const U = (xFromNose: number) => (xFromNose / L) * W; // x en mètres depuis le nez
  const Vp = (v: number) => (1 - v) * H; // flipY de la texture
  const fighter = spec.category === 'fighter';
  const { primary, secondary, accent } = spec.livery;

  g.fillStyle = hex(primary);
  g.fillRect(0, 0, W, H);
  gr.fillStyle = fighter ? '#d0d0d0' : '#4a4a4a'; // rugosité (R=G=B)
  gr.fillRect(0, 0, 512, 256);

  const band = (v0: number, v1: number, x0: number, x1: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(U(x0), Math.min(Vp(v0), Vp(v1)), U(x1) - U(x0), Math.abs(Vp(v1) - Vp(v0)));
  };

  if (fighter) {
    // lignes de panneaux, trappes, radôme plus sombre
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 2;
    for (let x = 1.2; x < L; x += L / 14) { g.beginPath(); g.moveTo(U(x), 0); g.lineTo(U(x), H); g.stroke(); }
    for (const v of [0.12, 0.2, 0.3, 0.38, 0.62, 0.7, 0.8, 0.88]) { g.beginPath(); g.moveTo(0, Vp(v)); g.lineTo(W, Vp(v)); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let k = 0; k < 40; k++) g.fillRect(U(1 + ((k * 7.3) % (L - 2))), Vp(((k * 0.137) % 1)), U(0.6), H * 0.02);
    band(0, 1, 0, L * 0.06, hex(Math.max(0, secondary - 0x080808)));
    // ligne de marche (dos)
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.setLineDash([12, 10]);
    g.beginPath(); g.moveTo(U(L * 0.3), Vp(0.21)); g.lineTo(U(L * 0.65), Vp(0.21)); g.stroke();
    g.beginPath(); g.moveTo(U(L * 0.3), Vp(0.29)); g.lineTo(U(L * 0.65), Vp(0.29)); g.stroke();
    g.setLineDash([]);
    if (spec.id === 'rafale') {
      // cocardes tricolores à basse visibilité sur les flancs arrière
      for (const v of vSides(0.1)) {
        const cx = U(L * 0.62), cy = Vp(v);
        for (const [rr, col] of [[44, '#3a4a7a'], [30, '#e8e8e8'], [16, '#a83a3a']] as const) {
          g.fillStyle = col;
          g.beginPath(); g.ellipse(cx, cy, rr * 0.6, rr, 0, 0, Math.PI * 2); g.fill();
        }
      }
    }
    gr.fillStyle = '#e0e0e0';
    gr.fillRect(0, 0, 512, 256);
  } else {
    // ventre peint (secondaire) et cheatline (accent) pour l'aviation commerciale / affaires
    const winSin = spec.id === 'a380' ? -0.05 : spec.id === 'dr400' ? 0.2 : 0.1;
    if (spec.category === 'airliner') {
      band(0.66, 0.84, L * 0.08, L * 0.85, hex(secondary));
    }
    if (spec.id === 'dr400') {
      // bandes rouge et bleue classiques
      for (const v of vSides(-0.15)) band(v - 0.02, v + 0.02, 0.9, L * 0.98, hex(secondary));
      for (const v of vSides(-0.28)) band(v - 0.008, v + 0.008, 0.9, L * 0.98, hex(accent));
    } else {
      for (const v of vSides(winSin - 0.22)) band(v - 0.006, v + 0.006, L * 0.04, L * 0.82, hex(accent));
    }
    // hublots
    g.fillStyle = '#1a2230';
    const rows = spec.id === 'a380' ? [winSin, 0.45] : spec.id === 'dr400' ? [] : [winSin];
    const pitch = spec.id === 'g8000' ? 1.3 : 0.53;
    const wW = spec.id === 'g8000' ? 0.42 : 0.26, wH = spec.id === 'g8000' ? 0.55 : 0.36;
    const x0 = L * (spec.id === 'g8000' ? 0.18 : 0.13), x1 = L * (spec.id === 'g8000' ? 0.6 : 0.8);
    for (const sTh of rows) {
      const hgt = spec.fuselage.height / 2;
      for (const v of vSides(sTh)) {
        for (let x = x0; x < x1; x += pitch) {
          if (spec.category === 'airliner' && Math.abs(x - L * 0.42) < 1.2) continue; // portes d'issue
          const vh = wH / (2 * Math.PI * hgt);
          g.beginPath();
          g.ellipse(U(x), Vp(v), (U(wW) - U(0)) / 2, (vh * H) / 2, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    // portes (contours)
    if (spec.category !== 'ga') {
      g.strokeStyle = 'rgba(60,70,80,0.6)';
      g.lineWidth = 2;
      for (const xd of spec.category === 'airliner' ? [0.11, 0.42, 0.7, 0.82] : [0.1]) {
        for (const v of vSides(winSin - 0.05)) g.strokeRect(U(L * xd) - U(0.5), Vp(v) - H * 0.035, U(1.0) - U(0), H * 0.07);
      }
    }
    // pare-brise (dos avant)
    g.fillStyle = '#121a24';
    const wsX = Math.max(0.6, -spec.eye[0] - 1.1);
    for (const side of [1, -1]) {
      g.beginPath();
      const vc = 0.25 + side * 0.04;
      g.moveTo(U(wsX), Vp(vc - side * 0.035));
      g.lineTo(U(wsX + 1.4), Vp(vc - side * 0.03));
      g.lineTo(U(wsX + 1.6), Vp(vc + side * 0.06));
      g.lineTo(U(wsX + 0.3), Vp(vc + side * 0.065));
      g.closePath();
      g.fill();
    }
    // immatriculation / titre
    g.fillStyle = hex(spec.id === 'dr400' ? accent : secondary);
    g.font = `bold ${Math.round(H * 0.05)}px "SF Pro Display", Inter, Arial`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const reg = spec.id === 'dr400' ? 'F-GAER' : spec.id === 'g8000' ? 'C-GAER' : 'AÉROSIM';
    for (const v of vSides(spec.id === 'dr400' ? 0.05 : winSin + 0.28)) {
      g.save();
      g.translate(U(spec.id === 'dr400' ? L * 0.72 : L * 0.3), Vp(v));
      // flanc droit : lecture queue → nez ; flanc gauche : texte retourné verticalement
      if (v < 0.25 || v > 0.75) g.scale(-1, 1); else g.scale(1, -1);
      g.fillText(reg, 0, 0);
      g.restore();
    }
    // radôme gris
    if (spec.category === 'airliner') band(0, 1, 0, 0.9, '#c9cdd2');
    gr.fillStyle = '#3a3a3a';
    gr.fillRect(0, 0, 512, 256);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const roughness = new THREE.CanvasTexture(r);
  return { map, roughness };
}
