/**
 * Cockpit 3D interactif : planche de bord avec écrans (CanvasTexture rafraîchies à 30 Hz),
 * commandes cliquables (raycasting, info-bulle, clic sonore) et manche/palonniers animés.
 * Chaque commande porte `userData.action` (identifiant) et `userData.tip` (info-bulle).
 */
import * as THREE from 'three';
import type { AircraftSpec } from '../aircraft/types';
import { O } from '../physics/layout';
import { DEG } from '../physics/math';

export type CockpitAction =
  | 'throttle' | 'gear' | 'flapsUp' | 'flapsDown' | 'speedbrake' | 'parking' | 'hook' | 'lightNav' | 'lightStrobe' | 'lightLanding' | 'lightBeacon'
  | 'apHdg' | 'apAlt' | 'apAthr' | 'fbwLaw' | 'battery' | 'apu' | 'pumps' | 'avionics' | 'start0' | 'start1' | 'start2' | 'start3' | 'stovl' | 'spoilerArm';

export interface Display {
  name: 'pfd' | 'nd' | 'eicas' | 'analog';
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

export class Cockpit3D {
  readonly group = new THREE.Group();
  readonly displays: Display[] = [];
  readonly clickables: THREE.Mesh[] = [];
  private throttle: THREE.Object3D | null = null;
  private stick: THREE.Object3D | null = null;
  private pedals: THREE.Object3D[] = [];
  private gearKnob: THREE.Mesh | null = null;
  private highlight: THREE.Mesh | null = null;
  private t = 0;
  /** position de l'œil (repère physique, origine CG) */
  readonly eye = new THREE.Vector3();
  /** combinateur HUD (repère cockpit) */
  readonly hudRect = { present: false };
  readonly spec: AircraftSpec;

  constructor(spec: AircraftSpec, xcg: number) {
    this.spec = spec;
    this.eye.set(spec.eye[0] - xcg, spec.eye[1], spec.eye[2]);
    this.group.position.copy(this.eye);
    this.build();
  }

  private mat(c: number, r = 0.8, m = 0.2): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  }

  private display(name: Display['name'], w: number, h: number, px: number, pos: THREE.Vector3, tilt: number, yaw = 0): void {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(px);
    canvas.height = Math.round((px * h) / w);
    const ctx = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    m.position.copy(pos);
    // l'avion regarde vers +X : les écrans font face à −X (vers le pilote)
    m.rotation.set(0, -Math.PI / 2 + yaw, 0);
    m.rotateX(-tilt);
    this.group.add(m);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.01, h + 0.02, w + 0.02), this.mat(0x15171a));
    bezel.position.copy(pos).add(new THREE.Vector3(0.006, 0, 0));
    bezel.rotation.copy(m.rotation);
    this.group.add(bezel);
    this.displays.push({ name, canvas, ctx, texture });
  }

  private button(action: CockpitAction, tip: string, pos: THREE.Vector3, size = 0.022, color = 0x30343a): THREE.Mesh {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.012, size, size * 1.4), this.mat(color, 0.5, 0.3));
    b.position.copy(pos);
    b.userData = { action, tip };
    this.group.add(b);
    this.clickables.push(b);
    return b;
  }

  private build(): void {
    const s = this.spec;
    const fighter = s.category === 'fighter', ga = s.category === 'ga';
    const D = fighter ? 0.62 : ga ? 0.65 : 0.75; // distance œil → planche
    const panelW = fighter ? 0.62 : ga ? 1.0 : 1.5;
    const panelY = -0.32;
    // planche et casquette
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, panelW + 0.1), this.mat(ga ? 0x3a3a3a : 0x24272c, 0.9, 0.05));
    panel.position.set(D + 0.03, panelY, 0);
    this.group.add(panel);
    const glare = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, panelW + 0.1), this.mat(0x18191b, 0.95, 0));
    glare.position.set(D - 0.08, panelY + 0.19, 0);
    this.group.add(glare);
    // écrans
    if (ga) {
      this.display('analog', 0.6, 0.3, 900, new THREE.Vector3(D, panelY, 0.05), 0.12);
      this.display('nd', 0.18, 0.13, 420, new THREE.Vector3(D, panelY - 0.02, -0.38), 0.12);
    } else if (s.id === 'f35') {
      this.display('nd', 0.25, 0.2, 600, new THREE.Vector3(D, panelY, -0.13), 0.15);
      this.display('pfd', 0.25, 0.2, 600, new THREE.Vector3(D, panelY, 0.13), 0.15);
      this.display('eicas', 0.12, 0.1, 360, new THREE.Vector3(D - 0.03, panelY - 0.15, 0), 0.6);
    } else if (fighter) {
      this.display('eicas', 0.17, 0.17, 420, new THREE.Vector3(D, panelY, -0.2), 0.15);
      this.display('nd', 0.2, 0.2, 512, new THREE.Vector3(D, panelY - 0.02, 0), 0.15);
      this.display('pfd', 0.17, 0.17, 420, new THREE.Vector3(D, panelY, 0.2), 0.15);
    } else {
      this.display('pfd', 0.22, 0.22, 512, new THREE.Vector3(D, panelY, -0.48), 0.1);
      this.display('nd', 0.22, 0.22, 512, new THREE.Vector3(D, panelY, -0.24), 0.1);
      this.display('eicas', 0.22, 0.22, 512, new THREE.Vector3(D, panelY, 0.05), 0.1, 0.12);
    }
    this.hudRect.present = fighter || s.id === 'b787' || s.id === 'g8000';
    if (this.hudRect.present) {
      const comb = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.14), new THREE.MeshPhysicalMaterial({ color: 0x88ffaa, transparent: true, opacity: 0.08, roughness: 0, metalness: 0.2 }));
      comb.position.set(D - 0.12, panelY + 0.3, fighter ? 0 : -0.48 + 0.0);
      comb.rotation.set(0, -Math.PI / 2, 0);
      comb.rotateX(-0.35);
      this.group.add(comb);
    }
    // manche / mini-manche / yoke
    const stickBase = new THREE.Group();
    if (ga || s.category === 'airliner' && s.id === 'b787') {
      // yoke
      stickBase.position.set(D - 0.25, panelY - 0.05, ga ? -0.25 : -0.48);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 8), this.mat(0x222222));
      col.rotation.z = Math.PI / 2;
      col.position.x = 0.12;
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 24, Math.PI * 1.2), this.mat(0x111111, 0.6));
      wheel.rotation.y = Math.PI / 2;
      wheel.rotation.z = -Math.PI * 0.1;
      stickBase.add(col, wheel);
    } else {
      // mini-manche latéral (Airbus, Rafale côté droit, F-22/F-35 latéral droit)
      stickBase.position.set(D - 0.35, panelY - 0.2, s.category === 'airliner' || s.id === 'g8000' ? -0.62 : 0.28);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.14, 10), this.mat(0x1a1a1a));
      st.position.y = 0.07;
      stickBase.add(st);
    }
    this.stick = stickBase;
    this.group.add(stickBase);
    // palonniers
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.08), this.mat(0x2a2a2a));
      p.position.set(D - 0.05, panelY - 0.55, (ga || fighter ? 0 : -0.48) + side * 0.12);
      this.group.add(p);
      this.pedals.push(p);
    }
    // manette des gaz (console gauche) — clic + glisser vertical
    const thrBase = new THREE.Group();
    thrBase.position.set(D - 0.35, panelY - 0.18, fighter || ga ? -0.3 : 0.25);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.03 * Math.max(1, s.engines.length * 0.6)), this.mat(0x111111, 0.5));
    lever.position.y = 0.06;
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.04 * Math.max(1, s.engines.length * 0.6)), this.mat(ga ? 0x111111 : 0x303030, 0.4));
    knob.position.y = 0.13;
    knob.userData = { action: 'throttle', tip: 'Manette des gaz (cliquer-glisser ; cran PC au-delà de 95 %)' };
    lever.userData = knob.userData;
    thrBase.add(lever, knob);
    this.clickables.push(knob, lever);
    this.throttle = thrBase;
    this.group.add(thrBase);
    // levier de train
    const gx = D - 0.02, gy = panelY - 0.02, gz = ga ? 0.4 : fighter ? -0.27 : 0.4;
    const gearLever = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 8), this.mat(0xcccccc, 0.3, 0.8));
    gearLever.position.set(gx - 0.03, gy, gz);
    gearLever.rotation.z = Math.PI / 2;
    this.group.add(gearLever);
    this.gearKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 16), this.mat(0xf0f0f0, 0.5));
    this.gearKnob.position.set(gx - 0.07, gy, gz);
    this.gearKnob.rotation.z = Math.PI / 2;
    this.gearKnob.userData = { action: 'gear', tip: 'Levier de train d\'atterrissage' };
    this.group.add(this.gearKnob);
    this.clickables.push(this.gearKnob);
    // rangée de commandes / interrupteurs
    const row = (y: number, items: [CockpitAction, string, number?][], z0: number, dz: number, x = D - 0.005) =>
      items.forEach(([a, tip, c], i) => this.button(a, tip, new THREE.Vector3(x, y, z0 + i * dz), 0.022, c));
    if (s.perf.flapDetents.length > 1) row(panelY - 0.1, [['flapsUp', 'Volets : rentrer un cran', 0x3a5a9a], ['flapsDown', 'Volets : sortir un cran', 0x3a5a9a]], gz - 0.06, 0.04);
    row(panelY + 0.15, [
      ['apHdg', 'Pilote automatique : maintien de cap (HDG)', 0x1f4f2f], ['apAlt', 'Pilote automatique : maintien d\'altitude (ALT)', 0x1f4f2f],
      ['apAthr', 'Auto-manette (A/THR)', 0x1f4f2f], ['fbwLaw', s.fcs === 'fbw' ? 'Bascule loi FBW Normale / Directe' : 'Commandes directes', 0x5a3a1a],
    ], -0.09, 0.06, D - 0.1);
    // panneau plafonnier / console : systèmes et feux
    const sysZ = fighter || ga ? 0.32 : -0.1;
    const sysX = D - 0.25, sysY = panelY - 0.17;
    const sys: [CockpitAction, string, number?][] = [
      ['battery', 'Batterie principale', 0x5a1a1a], ['apu', s.category === 'fighter' ? 'Démarreur JFS / IPP' : 'APU (groupe auxiliaire)', 0x5a1a1a],
      ['pumps', 'Pompes carburant', 0x5a1a1a], ['avionics', 'Avionique', 0x1a3a5a],
    ];
    s.engines.forEach((_, i) => sys.push([`start${i}` as CockpitAction, `Démarrage moteur ${i + 1}`, 0x6a5a10]));
    sys.forEach(([a, tip, c], i) => this.button(a, tip, new THREE.Vector3(sysX + (i % 4) * 0.04, sysY, sysZ + Math.floor(i / 4) * 0.045), 0.024, c).rotation.z = Math.PI / 2);
    const lights: [CockpitAction, string, number?][] = [
      ['lightNav', 'Feux de navigation (NAV)', 0x404040], ['lightStrobe', 'Feux à éclats (STROBE)', 0x404040],
      ['lightBeacon', 'Feu anticollision (BEACON)', 0x404040], ['lightLanding', 'Phares d\'atterrissage (LANDING)', 0x404040],
    ];
    lights.forEach(([a, tip, c], i) => this.button(a, tip, new THREE.Vector3(D - 0.005, panelY - 0.13, (ga ? -0.45 : fighter ? 0.12 : 0.28) + i * 0.035), 0.02, c));
    this.button('parking', 'Frein de parc', new THREE.Vector3(D - 0.005, panelY - 0.1, ga ? 0.32 : fighter ? -0.16 : 0.5), 0.03, 0x7a1010);
    this.button('speedbrake', 'Aérofreins', new THREE.Vector3(D - 0.3, panelY - 0.12, fighter || ga ? -0.36 : 0.34), 0.026, 0x505050);
    if (s.hasHook) this.button('hook', 'Crosse d\'appontage', new THREE.Vector3(D - 0.005, panelY - 0.06, -0.3), 0.03, 0xb08010);
    if (s.stovl) this.button('stovl', 'Mode STOVL (portes de soufflante)', new THREE.Vector3(D - 0.005, panelY - 0.06, -0.24), 0.03, 0x10608a);
    if (s.category === 'airliner' || s.id === 'g8000') this.button('spoilerArm', 'Armement des spoilers sol', new THREE.Vector3(D - 0.3, panelY - 0.12, 0.38), 0.022, 0x505050);
    // siège et montants (cadre de verrière)
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), this.mat(0x1d1f22, 0.95));
    seat.position.set(-0.35, -0.55, 0);
    this.group.add(seat);
    if (!fighter && !ga) {
      for (const z of [-0.85, 0.85]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), this.mat(0x2b2e33));
        pillar.position.set(D + 0.1, 0.05, z * 0.7);
        pillar.rotation.z = 0.5;
        this.group.add(pillar);
      }
    }
    // surbrillance de l'étape de check-list
    this.highlight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0x00e0ff, transparent: true, opacity: 0.5, depthTest: false }));
    this.highlight.renderOrder = 20;
    this.highlight.visible = false;
    this.group.add(this.highlight);
  }

  /** Met en surbrillance (pulsation) la commande associée à une action. */
  setHighlight(action: CockpitAction | null): void {
    if (!this.highlight) return;
    const m = action ? this.clickables.find((c) => c.userData.action === action) : null;
    this.highlight.visible = !!m;
    if (m) {
      this.highlight.position.copy(m.getWorldPosition(new THREE.Vector3()));
      this.group.worldToLocal(this.highlight.position);
    }
  }

  /** Anime manche, palonniers, manette, levier de train. */
  update(s: Float64Array, dt: number): void {
    this.t += dt;
    if (this.stick) this.stick.rotation.set(s[O.STICK_R] * 0.25, 0, -s[O.STICK_P] * 0.3);
    this.pedals[0].position.x = this.pedals[1].position.x = this.pedals[0].position.x;
    const pd = s[O.PEDALS] * 0.04;
    if (this.pedals.length === 2) {
      this.pedals[0].userData.base ??= this.pedals[0].position.x;
      this.pedals[1].userData.base ??= this.pedals[1].position.x;
      this.pedals[0].position.x = (this.pedals[0].userData.base as number) + pd;
      this.pedals[1].position.x = (this.pedals[1].userData.base as number) - pd;
    }
    if (this.throttle) this.throttle.rotation.z = -0.7 + s[O.THROTTLE] * 1.2;
    if (this.gearKnob) this.gearKnob.position.y = -0.34 + (s[O.GEAR] > 0.5 ? -0.03 : 0.03);
    if (this.highlight?.visible) (this.highlight.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(this.t * 6));
    void DEG;
  }
}
