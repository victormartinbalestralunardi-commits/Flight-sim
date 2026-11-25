/**
 * Animation d'un modèle d'avion (procédural OU GLTF externe) à partir de l'état physique,
 * par convention de nommage : gouvernes, train (rétraction + compression), hélice/disque,
 * soufflantes, tuyères (vectorielle / STOVL), postcombustion (+ anneaux de Mach > 85 %),
 * verrière, crosse, aérofreins, feux réglementaires (NAV, STROBE double flash, BEACON,
 * LANDING), flexion d'aile, porte de soufflante STOVL. Aucune allocation par frame.
 */
import * as THREE from 'three';
import type { AircraftSpec, ControlKind } from './types';
import { O, LIGHT } from '../physics/layout';

interface Hinge {
  node: THREE.Object3D;
  base: THREE.Quaternion;
  kind: ControlKind | 'spoiler';
  side: number;
  sign: number;
  maxRad: number;
}

const AX = new THREE.Vector3(1, 0, 0);
const TQ = new THREE.Quaternion();

/** Correspondance nom de nœud (GLTF ou procédural) → type de gouverne. */
function kindFromName(n: string): ControlKind | 'spoiler' | null {
  const s = n.toLowerCase();
  if (s.includes('aileron')) return 'aileron';
  if (s.includes('elevon')) return 'elevon';
  if (s.includes('elevator')) return 'elevator';
  if (s.includes('canard')) return 'canard';
  if (s.includes('rudder')) return 'rudder';
  if (s.includes('flap')) return 'flap';
  if (s.includes('spoiler')) return 'spoiler';
  return null;
}

function sideFromName(n: string): number {
  if (/_l(_|$)/i.test(n)) return -1;
  if (/_r(_|$)/i.test(n)) return 1;
  return 0;
}

export class AircraftAnimator {
  private hinges: Hinge[] = [];
  private gear: { node: THREE.Object3D; strut: THREE.Object3D | null; base: THREE.Quaternion; axis: THREE.Vector3; ang: number; idx: number }[] = [];
  private props: THREE.Object3D[] = [];
  private propDisc: THREE.Mesh | null = null;
  private fans: THREE.Object3D[] = [];
  private nozzles: THREE.Object3D[] = [];
  private abs: THREE.Mesh[] = [];
  private canopy: THREE.Object3D | null = null;
  private canopyBase = new THREE.Vector3();
  private hook: THREE.Object3D | null = null;
  private flex: THREE.Object3D[] = [];
  private lights: Record<string, THREE.Object3D[]> = { nav: [], strobe: [], beacon: [], landing: [] };
  private spot: THREE.SpotLight | null = null;
  private door: THREE.Object3D | null = null;
  private fanAngle = 0;
  private propAngle = 0;
  private t = 0;
  readonly spec: AircraftSpec;

  constructor(root: THREE.Object3D, spec: AircraftSpec) {
    this.spec = spec;
    const maxOf = (k: string) => {
      for (const s of spec.surfaces) for (const c of s.controls) if (c.kind === k) return (c.maxDeg * Math.PI) / 180;
      return (25 * Math.PI) / 180;
    };
    root.traverse((o) => {
      const n = o.name;
      if (!n) return;
      if (n.endsWith('__hinge')) {
        const pivotName = n.replace('__hinge', '');
        const kind = kindFromName(pivotName);
        const p = o.parent!;
        if (kind) this.hinges.push({
          node: o, base: o.quaternion.clone(), kind, side: (p.userData.side as number) ?? sideFromName(pivotName),
          sign: (p.userData.hingeSign as number) ?? 1, maxRad: ((p.userData.maxDeg as number) ?? 25) * (Math.PI / 180),
        });
        return;
      }
      // nœuds GLTF externes : rotation autour de l'axe X local
      const kind = kindFromName(n);
      if (kind && !o.getObjectByName(`${n}__hinge`) && !(o.parent?.name && kindFromName(o.parent.name))) {
        if (o.children.some((c) => c.name.endsWith('__hinge'))) return;
        const side = sideFromName(n);
        this.hinges.push({ node: o, base: o.quaternion.clone(), kind, side, sign: side < 0 ? -1 : 1, maxRad: maxOf(kind) });
        return;
      }
      if (/^gear_(front|main_l|main_r)$/i.test(n)) {
        const idx = /front/i.test(n) ? 0 : /_l$/i.test(n) ? 1 : 2;
        const strut = o.getObjectByName(`gear_strut_${n.replace(/^gear_/i, '')}`) ?? null;
        const axis = idx === 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        const ang = idx === 0 ? -Math.PI / 2 : (idx === 1 ? 1 : -1) * Math.PI / 2;
        this.gear.push({ node: o, strut, base: o.quaternion.clone(), axis, ang, idx });
      } else if (n === 'propeller') this.props.push(o);
      else if (n === 'prop_disc') this.propDisc = o as THREE.Mesh;
      else if (n.startsWith('fan_')) this.fans.push(o);
      else if (n.startsWith('nozzle')) this.nozzles.push(o);
      else if (n.startsWith('afterburner')) this.abs.push(o as THREE.Mesh);
      else if (n === 'canopy') { this.canopy = o; this.canopyBase.copy(o.position); }
      else if (n === 'hook') this.hook = o;
      else if (n.startsWith('flex_')) this.flex.push(o);
      else if (n === 'liftfan_door') this.door = o;
      else if (n.startsWith('light_nav')) this.lights.nav.push(o);
      else if (n.startsWith('light_strobe')) this.lights.strobe.push(o);
      else if (n.startsWith('light_beacon')) this.lights.beacon.push(o);
      else if (n === 'light_landing') {
        this.lights.landing.push(o);
        o.traverse((c) => { if ((c as THREE.SpotLight).isSpotLight) this.spot = c as THREE.SpotLight; });
      }
    });
  }

  private rotHinge(h: Hinge, rad: number): void {
    TQ.setFromAxisAngle(AX, rad * h.sign);
    h.node.quaternion.copy(h.base).multiply(TQ);
  }

  /** Applique l'état interpolé `s` (layout O). */
  update(s: Float64Array, dt: number): void {
    this.t += dt;
    const spec = this.spec;
    const e = s[O.ELEV], a = s[O.AIL], r = s[O.RUD], f = s[O.FLAPS], sp = s[O.SPOILER], sb = s[O.SPEEDBRAKE];
    for (const h of this.hinges) {
      let d = 0; // + = BF bas / vers +Z
      switch (h.kind) {
        case 'elevator': d = -e * h.maxRad; break;
        case 'canard': d = e * h.maxRad; break;
        case 'aileron': d = (h.side >= 0 ? -a : a) * h.maxRad; break;
        case 'elevon': d = Math.max(-h.maxRad, Math.min(h.maxRad, -e * h.maxRad * 0.8 + (h.side >= 0 ? -a : a) * h.maxRad * 0.6)); break;
        case 'rudder': d = r * h.maxRad + (spec.category === 'fighter' && h.side !== 0 ? h.side * sb * 0.5 : 0); break;
        case 'flap': d = f * h.maxRad; break;
        case 'spoiler': d = -Math.max(sp, sb * 0.6) * 0.9; break;
        default: break;
      }
      this.rotHinge(h, d);
    }
    // train : sortie/rentrée puis compression des amortisseurs
    const gearPos = s[O.GEAR];
    for (const g of this.gear) {
      TQ.setFromAxisAngle(g.axis, g.ang * (1 - gearPos));
      g.node.quaternion.copy(g.base).multiply(TQ);
      g.node.visible = gearPos > 0.02;
      if (g.strut) g.strut.position.y = s[O.COMP_N + g.idx];
    }
    // hélice : rotation réelle puis disque de flou au-delà de ~600 tr/min
    const rpm = s[O.PROP_RPM];
    this.propAngle = (this.propAngle + (rpm / 60) * Math.PI * 2 * dt) % (Math.PI * 2);
    const blur = Math.min(1, Math.max(0, (rpm - 500) / 900));
    for (const p of this.props) {
      p.rotation.x = this.propAngle;
      p.children.forEach((c) => { if (c.name === 'prop_blade') c.visible = blur < 0.85; });
    }
    if (this.propDisc) (this.propDisc.material as THREE.MeshBasicMaterial).opacity = blur * 0.38;
    // soufflantes : N1
    this.fanAngle = (this.fanAngle + s[O.N1] * 60 * dt) % (Math.PI * 2);
    for (const fan of this.fans) fan.rotation.x = this.fanAngle;
    // tuyères vectorielles / STOVL
    for (const n of this.nozzles) {
      if (spec.stovl) n.rotation.z = -s[O.NOZZLE_ANGLE];
      else if (n.userData.vector) n.rotation.z = -s[O.NOZZLE];
    }
    if (this.door) this.door.rotation.z = -s[O.STOVL] * 1.2;
    // postcombustion : intensité ∝ fraction PC, anneaux de Mach au-delà de 85 % du régime PC
    const ab = s[O.AB];
    const thr = s[O.THROTTLE];
    for (const m of this.abs) {
      const mat = m.material as THREE.ShaderMaterial;
      const dry = Math.max(0, (s[O.N1] - 0.75) * 0.6);
      mat.uniforms.uIntensity.value = Math.max(ab, dry * 0.35);
      mat.uniforms.uRings.value = ab > 0.05 && thr > 0.85 ? Math.min(1, ab * 1.2) : 0;
      mat.uniforms.uTime.value = this.t;
      m.scale.x = 2 + 6 * ab + dry * 2;
      m.visible = ab > 0.01 || dry > 0.02;
    }
    // verrière (DR-400 : coulissante) / crosse
    if (this.canopy && this.canopy.userData.slide) this.canopy.position.x = this.canopyBase.x - (s[O.ON_GROUND] && s[O.ENG_RUN] === 0 ? 0.7 : 0);
    if (this.hook) this.hook.rotation.z = s[O.HOOK] * 0.55;
    // flexion d'aile : rotations réparties le long des segments
    const flex = s[O.WING_FLEX];
    const semi = spec.span / 2;
    for (const fl of this.flex) {
      const k = fl.userData.flexIndex as number;
      const side = fl.userData.flexSide as number;
      const dTheta = (flex / semi) * (0.25 + 0.35 * k);
      fl.rotation.x = -side * dTheta;
    }
    // feux réglementaires
    const L = s[O.LIGHTS];
    const nav = (L & LIGHT.NAV) !== 0;
    for (const o of this.lights.nav) o.visible = nav;
    const ts = this.t % 1.2;
    const strobeOn = (L & LIGHT.STROBE) !== 0 && (ts < 0.05 || (ts > 0.15 && ts < 0.2));
    for (const o of this.lights.strobe) o.visible = strobeOn;
    const beaconOn = (L & LIGHT.BEACON) !== 0 && this.t % 1.0 < 0.12;
    for (const o of this.lights.beacon) o.visible = beaconOn;
    const landOn = (L & LIGHT.LANDING) !== 0;
    for (const o of this.lights.landing) o.visible = landOn;
    if (this.spot) this.spot.intensity = landOn ? 300 : 0;
  }
}
