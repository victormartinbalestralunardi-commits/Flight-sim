/**
 * HUD collimaté (conformal) : la symbologie est projetée avec la caméra de rendu, donc
 * superposée exactement au monde (vecteur vitesse, échelle de tangage, horizon, axe ILS,
 * boule FLOLS). Dessiné dans un canvas 2D par-dessus le WebGL.
 */
import * as THREE from 'three';
import type { AircraftSpec } from '../aircraft/types';
import { O, AP } from '../physics/layout';
import { DEG, FT, KT } from '../physics/math';
import type { IlsDeviation } from '../airports/airports';

const V = new THREE.Vector3();
const C = new THREE.Vector3();

function project(cam: THREE.Camera, dir: THREE.Vector3, w: number, h: number, out: { x: number; y: number; vis: boolean }): void {
  V.copy(dir).multiplyScalar(5000).add(cam.getWorldPosition(C));
  V.project(cam);
  out.vis = V.z < 1 && V.z > -1;
  out.x = (V.x * 0.5 + 0.5) * w;
  out.y = (-V.y * 0.5 + 0.5) * h;
}

const P = { x: 0, y: 0, vis: false };
const Q = { x: 0, y: 0, vis: false };
const D = new THREE.Vector3();
const SIDE = new THREE.Vector3();
const QA = new THREE.Quaternion();

export interface HudExtras {
  ils: IlsDeviation | null;
  flols: number | null;
  gpwsText: string | null;
  miniMap: HTMLCanvasElement | null;
}

export function drawHUD(ctx: CanvasRenderingContext2D, w: number, h: number, s: Float64Array, cam: THREE.Camera, spec: AircraftSpec, clip: { x: number; y: number; w: number; h: number } | null, ex: HudExtras): void {
  const col = '#5dff8a';
  ctx.save();
  if (clip) { ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip(); }
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 1.6;
  ctx.shadowColor = 'rgba(80,255,140,0.7)';
  ctx.shadowBlur = 6;
  ctx.font = '600 15px "SF Mono", Menlo, monospace';
  ctx.textBaseline = 'middle';
  const hdg = s[O.HEADING];
  const sh = Math.sin(hdg), chh = -Math.cos(hdg);
  // échelle de tangage conforme
  for (let p = -30; p <= 30; p += 5) {
    const pr = p * DEG;
    D.set(sh * Math.cos(pr), Math.sin(pr), chh * Math.cos(pr));
    project(cam, D, w, h, P);
    if (!P.vis) continue;
    // direction latérale pour orienter le barreau
    SIDE.set(-chh, 0, sh);
    D.addScaledVector(SIDE, 0.05);
    project(cam, D, w, h, Q);
    const dx = Q.x - P.x, dy = Q.y - P.y;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const half = p === 0 ? w * 0.4 : 70, gap = p === 0 ? 0 : 22;
    ctx.setLineDash(p < 0 ? [8, 6] : []);
    ctx.beginPath();
    ctx.moveTo(P.x - ux * half, P.y - uy * half); ctx.lineTo(P.x - ux * gap, P.y - uy * gap);
    ctx.moveTo(P.x + ux * gap, P.y + uy * gap); ctx.lineTo(P.x + ux * half, P.y + uy * half);
    ctx.stroke();
    ctx.setLineDash([]);
    if (p !== 0) { ctx.textAlign = 'left'; ctx.fillText(`${p}`, P.x + ux * (half + 8), P.y + uy * (half + 8)); }
  }
  // vecteur vitesse (FPV)
  const vx = s[O.VX] - s[O.SURF_VX] * 0, vy = s[O.VY], vz = s[O.VZ];
  const vl = Math.hypot(vx, vy, vz);
  if (vl > 5) {
    D.set(vx / vl, vy / vl, vz / vl);
    project(cam, D, w, h, P);
    if (P.vis) {
      ctx.beginPath(); ctx.arc(P.x, P.y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(P.x - 22, P.y); ctx.lineTo(P.x - 9, P.y); ctx.moveTo(P.x + 9, P.y); ctx.lineTo(P.x + 22, P.y); ctx.moveTo(P.x, P.y - 9); ctx.lineTo(P.x, P.y - 18); ctx.stroke();
      // indexeur d'incidence (chasseurs)
      if (spec.category === 'fighter') {
        const aoa = s[O.ALPHA] / DEG;
        const on = Math.abs(aoa - (spec.perf.alphaStall * 0.5)) < 1.5;
        ctx.textAlign = 'left';
        ctx.fillText(on ? 'AoA ●' : aoa > spec.perf.alphaStall * 0.5 ? 'AoA ▼' : 'AoA ▲', P.x + 30, P.y);
      }
    }
  }
  // boresight (axe avion)
  QA.set(s[O.QX], s[O.QY], s[O.QZ], s[O.QW]);
  D.set(1, 0, 0).applyQuaternion(QA);
  project(cam, D, w, h, P);
  if (P.vis) { ctx.beginPath(); ctx.moveTo(P.x - 10, P.y); ctx.lineTo(P.x + 10, P.y); ctx.moveTo(P.x, P.y - 4); ctx.lineTo(P.x, P.y + 4); ctx.stroke(); }
  // bandes de vitesse / altitude (zone centrale)
  const cx = clip ? clip.x + clip.w / 2 : w / 2;
  const cy = clip ? clip.y + clip.h * 0.5 : h / 2;
  const box = (x: number, y: number, t: string) => { ctx.strokeRect(x - 42, y - 13, 84, 26); ctx.textAlign = 'center'; ctx.fillText(t, x, y + 1); };
  const span = clip ? clip.w * 0.36 : w * 0.24;
  box(cx - span, cy, `${Math.round(s[O.CAS] / KT)}`);
  box(cx + span, cy, `${Math.round(s[O.ALT] / FT)}`);
  ctx.textAlign = 'center';
  ctx.fillText(`M ${s[O.MACH].toFixed(2)}   G ${s[O.NZ].toFixed(1)}   α ${(s[O.ALPHA] / DEG).toFixed(1)}°`, cx - span, cy + 32);
  const fpm = (s[O.VS] / FT) * 60;
  ctx.fillText(`${fpm >= 0 ? '+' : ''}${Math.round(fpm / 10) * 10} ft/min`, cx + span, cy + 32);
  if (s[O.AGL] < 1500 * FT) ctx.fillText(`R ${Math.round(s[O.AGL] / FT)}`, cx + span, cy + 54);
  ctx.fillText(`${String(Math.round((hdg / DEG + 360) % 360)).padStart(3, '0')}`, cx, clip ? clip.y + 20 : 40);
  const ap = s[O.AP_FLAGS];
  if (ap) { ctx.fillText(`${ap & AP.HDG ? 'HDG ' : ''}${ap & AP.ALT ? 'ALT ' : ''}${ap & AP.ATHR ? 'ATHR' : ''}`, cx, clip ? clip.y + 42 : 62); }
  if (s[O.AB] > 0.05) ctx.fillText('PC', cx - span, cy - 30);
  // ILS (barres d'écart)
  if (ex.ils && ex.ils.valid) {
    const k = 28;
    ctx.beginPath();
    ctx.moveTo(cx - ex.ils.loc * k, cy - 60); ctx.lineTo(cx - ex.ils.loc * k, cy + 60);
    ctx.moveTo(cx - 60, cy + ex.ils.gs * k); ctx.lineTo(cx + 60, cy + ex.ils.gs * k);
    ctx.stroke();
  }
  // FLOLS (boule) sur porte-avions
  if (ex.flols !== null) {
    const bx = cx + span * 0.55, by = cy - 70;
    ctx.strokeRect(bx - 10, by - 50, 20, 100);
    ctx.fillStyle = Math.abs(ex.flols) < 2.4 ? '#ffb020' : '#ff3030';
    ctx.beginPath(); ctx.arc(bx, by - ex.flols * 18, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.fillRect(bx - 40, by - 2, 25, 4); ctx.fillRect(bx + 15, by - 2, 25, 4);
  }
  if (ex.gpwsText) { ctx.fillStyle = '#ff4030'; ctx.font = '800 24px "SF Mono", Menlo, monospace'; ctx.fillText(ex.gpwsText, cx, cy - 110); }
  // mini-carte HUD
  if (ex.miniMap && spec.category === 'fighter') {
    ctx.globalAlpha = 0.85;
    ctx.drawImage(ex.miniMap, (clip ? clip.x + clip.w : w) - 150, (clip ? clip.y + clip.h : h) - 150, 140, 140);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
