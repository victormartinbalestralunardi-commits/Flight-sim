/**
 * Instruments dessinés en Canvas 2D à partir de l'état physique (aucune valeur simulée) :
 * PFD (horizon, badin, altimètre, variomètre, cap, FMA, ILS, incidence), ND / carte mobile
 * (relief, aéroports, axes ILS, route du porte-avions, trace), EICAS (N1/N2/RPM, EGT, débit),
 * planche analogique « six pack » + GPS (DR-400).
 */
import type { AircraftSpec } from '../aircraft/types';
import { O, AP } from '../physics/layout';
import { DEG, FT, KT } from '../physics/math';
import { type AirportDef, type IlsDeviation, terrainHeight, dirFromHeading } from '../airports/airports';

const GREEN = '#3cff6a';
const MAGENTA = '#ff4dff';
const CYAN = '#4ee6ff';
const AMBER = '#ffb020';
const WHITE = '#f2f5f8';

const LAW = ['NORMAL', 'ALTN', 'DIRECT'];

function txt(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color = WHITE, size = 14, align: CanvasTextAlign = 'center', weight = 600): void {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "SF Mono", Menlo, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

// ───────────────────────────── PFD ─────────────────────────────

export function drawPFD(ctx: CanvasRenderingContext2D, w: number, h: number, s: Float64Array, spec: AircraftSpec, ils: IlsDeviation | null): void {
  ctx.save();
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.47;
  const R = Math.min(w, h) * 0.32;
  const pitch = s[O.PITCH], bank = s[O.BANK];
  const ppd = R / 22; // pixels par degré
  // horizon
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - R * 1.05, cy - R * 1.05, R * 2.1, R * 2.1);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-bank);
  const off = (pitch / DEG) * ppd;
  ctx.fillStyle = '#2f7fd6';
  ctx.fillRect(-R * 3, -R * 3 + off, R * 6, R * 3);
  ctx.fillStyle = '#7a4a22';
  ctx.fillRect(-R * 3, off, R * 6, R * 3);
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-R * 3, off); ctx.lineTo(R * 3, off); ctx.stroke();
  for (let p = -30; p <= 30; p += 2.5) {
    if (p === 0) continue;
    const y = off - p * ppd;
    const big = p % 10 === 0, mid = p % 5 === 0;
    const L = big ? R * 0.45 : mid ? R * 0.25 : R * 0.1;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-L / 2, y); ctx.lineTo(L / 2, y); ctx.stroke();
    if (big) { txt(ctx, `${Math.abs(p)}`, -L / 2 - 14, y, WHITE, 12); txt(ctx, `${Math.abs(p)}`, L / 2 + 14, y, WHITE, 12); }
  }
  ctx.restore();
  // maquette avion + échelle de roulis
  ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(cx - R * 0.6, cy); ctx.lineTo(cx - R * 0.2, cy); ctx.lineTo(cx - R * 0.2, cy + 10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + R * 0.6, cy); ctx.lineTo(cx + R * 0.2, cy); ctx.lineTo(cx + R * 0.2, cy + 10); ctx.stroke();
  ctx.fillStyle = '#ffd400'; ctx.fillRect(cx - 4, cy - 4, 8, 8);
  ctx.strokeStyle = WHITE; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.0, -Math.PI / 2 - (60 * Math.PI) / 180, -Math.PI / 2 + (60 * Math.PI) / 180); ctx.stroke();
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const r0 = R, r1 = R + (Math.abs(a) % 30 === 0 ? 14 : 8);
    const t = -Math.PI / 2 + (a * Math.PI) / 180;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0); ctx.lineTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1); ctx.stroke();
  }
  const tb = -Math.PI / 2 - bank;
  ctx.fillStyle = '#ffd400';
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(tb) * (R - 2), cy + Math.sin(tb) * (R - 2));
  ctx.lineTo(cx + Math.cos(tb - 0.05) * (R - 16), cy + Math.sin(tb - 0.05) * (R - 16));
  ctx.lineTo(cx + Math.cos(tb + 0.05) * (R - 16), cy + Math.sin(tb + 0.05) * (R - 16));
  ctx.fill();
  // ILS
  if (ils && ils.valid) {
    ctx.fillStyle = MAGENTA;
    const gy = cy - Math.max(-2.4, Math.min(2.4, ils.gs)) * (R * 0.35);
    ctx.beginPath(); ctx.moveTo(cx + R * 1.12, gy - 8); ctx.lineTo(cx + R * 1.18, gy); ctx.lineTo(cx + R * 1.12, gy + 8); ctx.lineTo(cx + R * 1.06, gy); ctx.fill();
    const lx = cx + Math.max(-2.4, Math.min(2.4, -ils.loc)) * (R * 0.35);
    ctx.beginPath(); ctx.moveTo(lx - 8, cy + R * 1.12); ctx.lineTo(lx, cy + R * 1.18); ctx.lineTo(lx + 8, cy + R * 1.12); ctx.lineTo(lx, cy + R * 1.06); ctx.fill();
    ctx.strokeStyle = WHITE;
    for (const k of [-2, -1, 1, 2]) {
      ctx.beginPath(); ctx.arc(cx + R * 1.12, cy - k * R * 0.35, 3, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + k * R * 0.35, cy + R * 1.12, 3, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // bande de vitesse
  const kt = s[O.CAS] / KT;
  tape(ctx, 8, cy - R, 70, R * 2, kt, 10, 4, (v) => `${Math.round(v)}`, true);
  txt(ctx, `M ${s[O.MACH].toFixed(2)}`, 43, cy + R + 22, GREEN, 13);
  // vitesse de référence (Vapp)
  const vy = cy - (spec.perf.vApp - kt) * 4;
  if (vy > cy - R && vy < cy + R) { ctx.fillStyle = MAGENTA; ctx.fillRect(78, vy - 3, 10, 6); }
  // bande d'altitude
  const ft = s[O.ALT] / FT;
  tape(ctx, w - 88, cy - R, 80, R * 2, ft, 100, 0.4, (v) => `${Math.round(v)}`, false);
  // variomètre
  const fpm = (s[O.VS] / FT) * 60;
  ctx.strokeStyle = WHITE; ctx.lineWidth = 1;
  ctx.strokeRect(w - 6, cy - R, 4, R * 2);
  ctx.fillStyle = GREEN;
  const vsy = Math.max(-R, Math.min(R, -(Math.sign(fpm) * Math.sqrt(Math.abs(fpm)) * R) / 70));
  ctx.fillRect(w - 6, cy + Math.min(0, vsy), 4, Math.abs(vsy));
  txt(ctx, `${fpm >= 0 ? '+' : ''}${Math.round(fpm / 10) * 10}`, w - 48, cy + R + 22, GREEN, 13);
  // cap
  const hdg = (s[O.HEADING] / DEG + 360) % 360;
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - R, h - 44, R * 2, 40); ctx.clip();
  ctx.fillStyle = '#20262e'; ctx.fillRect(cx - R, h - 44, R * 2, 40);
  ctx.strokeStyle = WHITE;
  for (let d = -40; d <= 40; d += 5) {
    const v = Math.round(hdg / 5) * 5 + d;
    const x = cx + (v - hdg) * (R / 40);
    ctx.beginPath(); ctx.moveTo(x, h - 44); ctx.lineTo(x, h - 44 + (v % 10 === 0 ? 12 : 6)); ctx.stroke();
    if (v % 10 === 0) txt(ctx, `${((v % 360) + 360) % 360 / 10}`.padStart(2, '0').slice(0, 2), x, h - 22, WHITE, 12);
  }
  ctx.restore();
  ctx.strokeStyle = '#ffd400'; ctx.beginPath(); ctx.moveTo(cx, h - 46); ctx.lineTo(cx, h - 30); ctx.stroke();
  // FMA
  const apf = s[O.AP_FLAGS];
  txt(ctx, `${apf & AP.ATHR ? 'SPEED' : 'MAN THR'}`, w * 0.2, 14, apf & AP.ATHR ? GREEN : WHITE, 12);
  txt(ctx, `${apf & AP.ALT ? 'ALT' : '—'}`, w * 0.42, 14, apf & AP.ALT ? GREEN : WHITE, 12);
  txt(ctx, `${apf & AP.HDG ? 'HDG' : '—'}`, w * 0.6, 14, apf & AP.HDG ? GREEN : WHITE, 12);
  const law = s[O.FCS_LAW] | 0;
  txt(ctx, spec.fcs === 'fbw' ? LAW[law] : 'MAN', w * 0.84, 14, law === 0 ? CYAN : AMBER, 12);
  // incidence + radioaltimètre
  txt(ctx, `α ${(s[O.ALPHA] / DEG).toFixed(1)}°`, cx - R * 0.8, cy - R - 14, s[O.STALL_WARN] ? '#ff3b30' : CYAN, 13);
  if (s[O.AGL] < 2500 * FT) txt(ctx, `${Math.round(s[O.AGL] / FT)}`, cx, cy + R * 0.72, s[O.AGL] < 200 * FT ? AMBER : GREEN, 16);
  txt(ctx, `G ${s[O.NZ].toFixed(1)}`, cx + R * 0.8, cy - R - 14, WHITE, 13);
  if (s[O.STALL_WARN]) txt(ctx, 'STALL', cx, cy - R * 0.55, '#ff3b30', 22, 'center', 800);
  ctx.restore();
}

function tape(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number, step: number, ppu: number, fmt: (v: number) => string, left: boolean): void {
  ctx.save();
  ctx.fillStyle = '#20262e';
  ctx.fillRect(x, y, w, h);
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const cy = y + h / 2;
  const scale = ppu; // px par unité
  ctx.strokeStyle = WHITE; ctx.lineWidth = 1;
  const base = Math.round(v / step) * step;
  for (let k = -20; k <= 20; k++) {
    const val = base + k * step;
    const yy = cy - (val - v) * scale;
    if (yy < y - 10 || yy > y + h + 10) continue;
    ctx.beginPath();
    if (left) { ctx.moveTo(x + w - 10, yy); ctx.lineTo(x + w, yy); } else { ctx.moveTo(x, yy); ctx.lineTo(x + 10, yy); }
    ctx.stroke();
    if (Math.round(val / step) % 2 === 0) txt(ctx, fmt(val), left ? x + w / 2 - 4 : x + w / 2 + 4, yy, WHITE, 12);
  }
  ctx.restore();
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#ffd400';
  ctx.fillRect(x + 2, cy - 13, w - 4, 26);
  ctx.strokeRect(x + 2, cy - 13, w - 4, 26);
  txt(ctx, fmt(v), x + w / 2, cy, GREEN, 15, 'center', 700);
}

// ───────────────────────────── Carte mobile (ND / MFD) ─────────────────────────────

export interface MapContext {
  ap: AirportDef;
  relief: HTMLCanvasElement;
  radius: number; // m couverts par l'image (± radius)
  trail: Float32Array; // x,z
  trailLen: number;
}

/** Image de relief ombré de l'aéroport (calculée une fois). */
export function buildRelief(ap: AirportDef, radius: number, size = 384): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const step = (2 * radius) / size;
  const ocean = ap.oceanLevel;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -radius + i * step, z = -radius + j * step;
      const hgt = ap.id === 'cvn' ? -30 : terrainHeight(ap, x, z);
      const hx = ap.id === 'cvn' ? 0 : terrainHeight(ap, x + step, z) - hgt;
      const shade = Math.max(0.35, Math.min(1.2, 0.85 - hx / (step * 0.6)));
      let r: number, gg: number, b: number;
      if (ocean !== null && hgt < ocean) { r = 16; gg = 70; b = 120; }
      else {
        const t = Math.min(1, Math.max(0, (hgt - (ap.elevation - 150)) / 1800));
        r = 70 + 120 * t; gg = 110 + 70 * t; b = 60 + 140 * t;
        if (hgt > 2400) { r = gg = b = 230; }
        r *= shade; gg *= shade; b *= shade;
      }
      const o = 4 * (j * size + i);
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function drawND(ctx: CanvasRenderingContext2D, w: number, h: number, s: Float64Array, map: MapContext, rangeNm: number): void {
  ctx.save();
  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.68;
  const pxPerM = (h * 0.6) / (rangeNm * 1852);
  const hdg = s[O.HEADING];
  const px = s[O.PX], pz = s[O.PZ];
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-hdg);
  // relief
  const R = map.radius;
  ctx.globalAlpha = 0.85;
  ctx.drawImage(map.relief, (-R - px) * pxPerM, (-R - pz) * pxPerM, 2 * R * pxPerM, 2 * R * pxPerM);
  ctx.globalAlpha = 1;
  // pistes + axes ILS (feather)
  for (const r of map.ap.runways) {
    const [dx, dz] = dirFromHeading(r.heading);
    const x0 = (r.thrX - px) * pxPerM, z0 = (r.thrZ - pz) * pxPerM;
    ctx.strokeStyle = WHITE; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x0, z0); ctx.lineTo(x0 + dx * r.length * pxPerM, z0 + dz * r.length * pxPerM); ctx.stroke();
    if (r.ils) {
      ctx.strokeStyle = CYAN; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(x0, z0); ctx.lineTo(x0 - dx * 18520 * pxPerM, z0 - dz * 18520 * pxPerM); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // porte-avions et route
  if (map.ap.carrier) {
    const sx = (s[O.CARRIER_X] - px) * pxPerM, sz = (s[O.CARRIER_Z] - pz) * pxPerM;
    const ch = s[O.CARRIER_HDG];
    ctx.strokeStyle = AMBER; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(sx, sz); ctx.lineTo(sx + Math.sin(ch) * 20000 * pxPerM, sz - Math.cos(ch) * 20000 * pxPerM); ctx.stroke();
    ctx.setLineDash([]);
    ctx.save(); ctx.translate(sx, sz); ctx.rotate(ch);
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(-Math.max(3, 38 * pxPerM), -Math.max(8, 166 * pxPerM), Math.max(6, 76 * pxPerM), Math.max(16, 332 * pxPerM));
    ctx.restore();
    // axe d'appontage (ICLS)
    const la = ch - 9 * DEG;
    ctx.strokeStyle = CYAN; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(sx, sz); ctx.lineTo(sx - Math.sin(la) * 18520 * pxPerM, sz + Math.cos(la) * 18520 * pxPerM); ctx.stroke();
    ctx.setLineDash([]);
  }
  // trace parcourue
  ctx.strokeStyle = MAGENTA; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < map.trailLen; i++) {
    const x = (map.trail[2 * i] - px) * pxPerM, z = (map.trail[2 * i + 1] - pz) * pxPerM;
    if (i === 0) ctx.moveTo(x, z); else ctx.lineTo(x, z);
  }
  ctx.stroke();
  ctx.restore();
  // rose et anneaux de distance
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
  for (const k of [0.5, 1]) { ctx.beginPath(); ctx.arc(cx, cy, h * 0.6 * k, Math.PI, 2 * Math.PI); ctx.stroke(); }
  txt(ctx, `${rangeNm / 2}`, cx + h * 0.3 + 12, cy - 6, WHITE, 11);
  txt(ctx, `${rangeNm}`, cx + h * 0.6 + 12, cy - 6, WHITE, 11);
  // symbole avion
  ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 12); ctx.moveTo(cx - 12, cy - 2); ctx.lineTo(cx + 12, cy - 2); ctx.moveTo(cx - 5, cy + 10); ctx.lineTo(cx + 5, cy + 10); ctx.stroke();
  const hdgDeg = Math.round((hdg / DEG + 360) % 360);
  ctx.fillStyle = '#000'; ctx.fillRect(cx - 30, 6, 60, 24);
  ctx.strokeStyle = WHITE; ctx.strokeRect(cx - 30, 6, 60, 24);
  txt(ctx, `${String(hdgDeg).padStart(3, '0')}°`, cx, 18, GREEN, 15);
  txt(ctx, `GS ${Math.round(s[O.GS] / KT)}  TAS ${Math.round(s[O.TAS] / KT)}`, 10, 18, WHITE, 12, 'left');
  const wdir = Math.atan2(-s[O.WIND_X], s[O.WIND_Z]);
  txt(ctx, `${Math.round(((wdir / DEG) + 360) % 360)}°/${Math.round(Math.hypot(s[O.WIND_X], s[O.WIND_Z]) / KT)} kt`, 10, 36, CYAN, 12, 'left');
  txt(ctx, map.ap.icao, w - 10, 18, MAGENTA, 13, 'right');
  ctx.restore();
}

// ───────────────────────────── EICAS ─────────────────────────────

function dial(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, frac: number, label: string, value: string, warn = false): void {
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
  ctx.strokeStyle = '#ff3b30';
  ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 2.05, Math.PI * 2.25); ctx.stroke();
  const a = Math.PI * 0.75 + Math.min(1.05, Math.max(0, frac)) * Math.PI * 1.5;
  ctx.strokeStyle = warn ? AMBER : WHITE; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9); ctx.stroke();
  txt(ctx, value, x + r * 0.15, y + r * 0.55, warn ? AMBER : GREEN, 13);
  txt(ctx, label, x, y + r + 12, CYAN, 11);
}

export function drawEICAS(ctx: CanvasRenderingContext2D, w: number, h: number, s: Float64Array, spec: AircraftSpec): void {
  ctx.save();
  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, w, h);
  const n = spec.engines.length;
  const r = Math.min(w / (n * 2.6), h * 0.16);
  const piston = spec.engines[0].type === 'piston';
  for (let i = 0; i < n; i++) {
    const x = (w / (n + 1)) * (i + 1);
    const run = (s[O.ENG_RUN] & (1 << i)) !== 0;
    if (piston) dial(ctx, x, h * 0.2, r, s[O.PROP_RPM] / 2800, 'RPM', `${Math.round(s[O.PROP_RPM])}`, !run);
    else dial(ctx, x, h * 0.2, r, s[O.N1 + i], 'N1 %', `${(s[O.N1 + i] * 100).toFixed(1)}`, !run);
    dial(ctx, x, h * 0.5, r * 0.85, (s[O.EGT + i] - 100) / 900, 'EGT', `${Math.round(s[O.EGT + i])}`, s[O.EGT + i] > 900);
    txt(ctx, `N2 ${(s[O.N2 + i] * 100).toFixed(0)}`, x, h * 0.67, WHITE, 11);
    txt(ctx, `FF ${Math.round(s[O.FF + i])}`, x, h * 0.72, WHITE, 11);
  }
  txt(ctx, `CARBURANT ${Math.round(s[O.FUEL])} kg`, 12, h * 0.8, GREEN, 13, 'left');
  txt(ctx, `MASSE ${(s[O.MASS] / 1000).toFixed(1)} t`, 12, h * 0.85, WHITE, 12, 'left');
  const gear = s[O.GEAR];
  txt(ctx, gear > 0.98 ? 'TRAIN ▼ 3 VERTS' : gear < 0.02 ? 'TRAIN ▲' : 'TRAIN EN TRANSIT', 12, h * 0.9, gear > 0.98 ? GREEN : gear < 0.02 ? WHITE : AMBER, 12, 'left');
  txt(ctx, `VOLETS ${Math.round(s[O.FLAPS] * spec.perf.flapMaxDeg)}°`, w - 12, h * 0.8, WHITE, 12, 'right');
  if (spec.stovl) txt(ctx, `STOVL ${s[O.STOVL] > 0.95 ? 'ON' : s[O.STOVL] > 0.05 ? 'CONV' : 'OFF'}  TUYÈRE ${Math.round(s[O.NOZZLE_ANGLE] / DEG)}°`, w - 12, h * 0.85, s[O.STOVL] > 0.5 ? CYAN : WHITE, 12, 'right');
  if (spec.hasHook) txt(ctx, s[O.HOOK] > 0.9 ? 'CROSSE SORTIE' : 'CROSSE RENTRÉE', w - 12, h * 0.9, s[O.HOOK] > 0.9 ? AMBER : WHITE, 12, 'right');
  txt(ctx, `TRIM ${(s[O.TRIM] * 100).toFixed(0)}%  FREIN PARC ${s[O.PARKING] > 0.5 ? 'SERRÉ' : 'DESSERRÉ'}`, 12, h * 0.95, s[O.PARKING] > 0.5 ? AMBER : WHITE, 12, 'left');
  ctx.restore();
}

// ───────────────────────────── Planche analogique (DR-400) ─────────────────────────────

function gaugeFace(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#555'; ctx.lineWidth = 4; ctx.stroke();
}

function needle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, color = WHITE): void {
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(a) * r, y - Math.cos(a) * r); ctx.stroke();
  ctx.fillStyle = '#888'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
}

export function drawAnalogPanel(ctx: CanvasRenderingContext2D, w: number, h: number, s: Float64Array, ils: IlsDeviation | null): void {
  ctx.save();
  ctx.fillStyle = '#2a2d31';
  ctx.fillRect(0, 0, w, h);
  const r = Math.min(w / 6.6, h / 4.6);
  const cols = [w * 0.18, w * 0.5, w * 0.82];
  const rows = [h * 0.28, h * 0.72];
  // badin (kt)
  const kt = s[O.CAS] / KT;
  gaugeFace(ctx, cols[0], rows[0], r);
  ctx.lineWidth = 6;
  const arc = (a0: number, a1: number, c: string) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(cols[0], rows[0], r * 0.82, a0, a1); ctx.stroke(); };
  const kA = (v: number) => -Math.PI / 2 + (v / 180) * Math.PI * 1.7;
  arc(kA(47), kA(110), '#ddd'); arc(kA(55), kA(140), '#2ecc40'); arc(kA(140), kA(166), '#ffdc00');
  needle(ctx, cols[0], rows[0], r * 0.85, (kt / 180) * Math.PI * 1.7);
  txt(ctx, 'KT', cols[0], rows[0] + r * 0.4, WHITE, 11);
  // horizon
  gaugeFace(ctx, cols[1], rows[0], r);
  ctx.save();
  ctx.beginPath(); ctx.arc(cols[1], rows[0], r * 0.9, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cols[1], rows[0]); ctx.rotate(-s[O.BANK]);
  const off = (s[O.PITCH] / DEG) * (r / 25);
  ctx.fillStyle = '#3d86c6'; ctx.fillRect(-r * 2, -r * 2 + off, r * 4, r * 2);
  ctx.fillStyle = '#6b4523'; ctx.fillRect(-r * 2, off, r * 4, r * 2);
  ctx.strokeStyle = WHITE; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-r, off); ctx.lineTo(r, off); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#ffa500'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cols[1] - r * 0.5, rows[0]); ctx.lineTo(cols[1] - r * 0.15, rows[0]); ctx.moveTo(cols[1] + r * 0.15, rows[0]); ctx.lineTo(cols[1] + r * 0.5, rows[0]); ctx.stroke();
  // altimètre
  const ft = s[O.ALT] / FT;
  gaugeFace(ctx, cols[2], rows[0], r);
  for (let k = 0; k < 10; k++) txt(ctx, `${k}`, cols[2] + Math.sin((k / 10) * Math.PI * 2) * r * 0.75, rows[0] - Math.cos((k / 10) * Math.PI * 2) * r * 0.75, WHITE, 12);
  needle(ctx, cols[2], rows[0], r * 0.85, ((ft % 1000) / 1000) * Math.PI * 2);
  needle(ctx, cols[2], rows[0], r * 0.5, ((ft % 10000) / 10000) * Math.PI * 2, '#ccc');
  txt(ctx, `${Math.round(ft)} ft`, cols[2], rows[0] + r * 0.45, GREEN, 11);
  // coordinateur de virage
  gaugeFace(ctx, cols[0], rows[1], r);
  const rate = -s[O.WY] / DEG; // °/s nez à droite
  needle(ctx, cols[0], rows[1], r * 0.8, Math.max(-1, Math.min(1, rate / 6)) * 0.9 - 0, WHITE);
  const ball = Math.max(-1, Math.min(1, s[O.NY] * 4));
  ctx.fillStyle = '#000'; ctx.fillRect(cols[0] - r * 0.5, rows[1] + r * 0.45, r, r * 0.18);
  ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(cols[0] + ball * r * 0.4, rows[1] + r * 0.54, r * 0.08, 0, Math.PI * 2); ctx.fill();
  // conservateur de cap + ILS
  gaugeFace(ctx, cols[1], rows[1], r);
  ctx.save(); ctx.translate(cols[1], rows[1]); ctx.rotate(-s[O.HEADING]);
  for (let d = 0; d < 360; d += 30) txt(ctx, d % 90 === 0 ? 'NESW'[d / 90] : `${d / 10}`, Math.sin((d * Math.PI) / 180) * r * 0.75, -Math.cos((d * Math.PI) / 180) * r * 0.75, WHITE, 12);
  ctx.restore();
  ctx.strokeStyle = '#ffa500'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cols[1], rows[1] - r * 0.4); ctx.lineTo(cols[1], rows[1] + r * 0.3); ctx.stroke();
  if (ils && ils.valid) {
    ctx.strokeStyle = MAGENTA;
    ctx.beginPath(); ctx.moveTo(cols[1] - ils.loc * r * 0.18, rows[1] - r * 0.5); ctx.lineTo(cols[1] - ils.loc * r * 0.18, rows[1] + r * 0.5); ctx.stroke();
  }
  // variomètre
  gaugeFace(ctx, cols[2], rows[1], r);
  const fpm = (s[O.VS] / FT) * 60;
  needle(ctx, cols[2], rows[1], r * 0.85, -Math.PI / 2 + Math.max(-1, Math.min(1, fpm / 2000)) * Math.PI * 0.8);
  txt(ctx, 'VS ×100', cols[2] + r * 0.2, rows[1] + r * 0.4, WHITE, 10);
  // tachymètre + GPS
  txt(ctx, `RPM ${Math.round(s[O.PROP_RPM])}   CARB ${(s[O.FUEL] / 0.72).toFixed(0)} L   EGT ${Math.round(s[O.EGT])}°`, w / 2, h * 0.97, GREEN, 12);
  if (s[O.STALL_WARN]) txt(ctx, 'AVERTISSEUR DE DÉCROCHAGE', w / 2, h * 0.5, '#ff3b30', 16, 'center', 800);
  ctx.restore();
}
