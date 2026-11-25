/**
 * Porte-avions nucléaire (classe Nimitz) : coque extrudée depuis le contour EXACT du pont
 * (`CarrierDef.deck`, partagé avec la physique), marquages du pont oblique, catapultes,
 * 4 brins d'arrêt, île avec radars rotatifs, miroir d'appontage FLOLS (« meatball ») piloté
 * par la position de l'œil, feux de bord de pont. Animé selon la pose (houle) du worker.
 */
import * as THREE from 'three';
import type { CarrierDef } from './airports';

export interface CarrierScene {
  group: THREE.Group;
  /** FLOLS : boule (5 cellules), barres de datum vertes, feux de vague-off */
  setBall(cell: number, visible: boolean): void;
  update(dt: number): void;
}

function deckTexture(c: CarrierDef, size: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 2048;
  const g = cv.getContext('2d')!;
  const S = 2048 / size;
  const X = (s: number) => 1024 - s * S; // s (avant) → vers le haut de l'image
  const Y = (l: number) => 1024 + l * S;
  g.fillStyle = '#4b4e52';
  g.fillRect(0, 0, 2048, 2048);
  for (let i = 0; i < 40000; i++) {
    const v = 60 + Math.random() * 25;
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(Math.random() * 2048, Math.random() * 2048, 2, 2);
  }
  const ang = (c.landingAngle * Math.PI) / 180;
  const [ls, ll] = c.landingOrigin;
  g.save();
  g.translate(Y(ll), X(ls));
  g.rotate(-ang);
  // bandes de la piste oblique
  g.fillStyle = '#e8e8e8';
  g.fillRect(-12 * S, -230 * S, 0.8 * S, 230 * S);
  g.fillRect(11.2 * S, -230 * S, 0.8 * S, 230 * S);
  g.fillStyle = '#e8e800';
  for (let s = 10; s < 230; s += 12) g.fillRect(-0.4 * S, -(s + 6) * S, 0.8 * S, 6 * S);
  g.fillStyle = '#e8e8e8';
  g.fillRect(-12 * S, -2 * S, 24 * S, 1.2 * S);
  g.restore();
  // catapultes d'étrave
  g.fillStyle = '#2c2f33';
  for (const [s0, l, s1] of c.catapults) g.fillRect(Y(l) - 0.4 * S, X(s1), 0.8 * S, (s1 - s0) * S);
  g.fillStyle = '#e8e8e8';
  for (const [s0, l] of c.catapults) g.fillRect(Y(l) - 3 * S, X(s0), 6 * S, 0.6 * S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildCarrier(c: CarrierDef): CarrierScene {
  const group = new THREE.Group();
  group.name = 'carrier';
  const size = 340;
  // coque : extrusion du contour du pont, avec rétrécissement vers la ligne de flottaison
  const shape = new THREE.Shape(c.deck.map(([s, l]) => new THREE.Vector2(s, l)));
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: c.deckHeight + 9, bevelEnabled: false, steps: 1 });
  // repère : shape (x = s avant, y = l tribord) ; extrusion le long de +Z → on le couche
  hullGeo.rotateX(Math.PI / 2);
  // désormais : x = s, z = l, y = −profondeur … on remonte pour que le pont soit à deckHeight
  hullGeo.translate(0, c.deckHeight, 0);
  const pos = hullGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < c.deckHeight - 0.5) {
      // flancs rentrants : coque étroite (≈ 41 m) sous le débord du pont
      const f = Math.min(1, (c.deckHeight - y) / 8);
      pos.setZ(i, pos.getZ(i) * (1 - 0.42 * f));
      pos.setX(i, pos.getX(i) * (1 - 0.04 * f));
    }
  }
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: 0x5d646c, roughness: 0.75, metalness: 0.35 }));
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);
  // pont texturé
  const deckGeo = new THREE.ShapeGeometry(shape);
  deckGeo.rotateX(Math.PI / 2);
  const uv = deckGeo.getAttribute('uv') as THREE.BufferAttribute;
  const dp = deckGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + dp.getZ(i) / size, 0.5 + dp.getX(i) / size);
  deckGeo.translate(0, c.deckHeight + 0.03, 0);
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ map: deckTexture(c, size), roughness: 0.9, side: THREE.DoubleSide }));
  deck.receiveShadow = true;
  group.add(deck);
  // l'axe z du groupe doit correspondre à « tribord » (l) : on applique un miroir cohérent
  // (ShapeGeometry tournée : y→z) ; aucune correction supplémentaire nécessaire.
  // brins d'arrêt
  const ang = (c.landingAngle * Math.PI) / 180;
  const [ls, ll] = c.landingOrigin;
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.8 });
  for (const w of c.wires) {
    const s = ls + Math.cos(ang) * w, l = ll + Math.sin(ang) * w;
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, c.wireHalfLength * 2, 6), wireMat);
    wire.rotation.set(Math.PI / 2, -ang, 0, 'YXZ');
    wire.position.set(s, c.deckHeight + 0.12, l);
    group.add(wire);
  }
  // île
  const [x0, x1, z0, z1, h] = c.island;
  const island = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), new THREE.MeshStandardMaterial({ color: 0x6a727b, roughness: 0.7, metalness: 0.3 }));
  island.position.set((x0 + x1) / 2, c.deckHeight + h / 2, (z0 + z1) / 2);
  island.castShadow = true;
  group.add(island);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 14, 8), new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.5 }));
  mast.position.set((x0 + x1) / 2, c.deckHeight + h + 7, (z0 + z1) / 2);
  group.add(mast);
  const radar = new THREE.Group();
  radar.position.set((x0 + x1) / 2, c.deckHeight + h + 15, (z0 + z1) / 2);
  const ant = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2, 8), new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 0.4 }));
  radar.add(ant);
  group.add(radar);
  // FLOLS (bâbord) : boîtier, 5 cellules, barres de datum
  const flols = new THREE.Group();
  flols.position.set(c.flols[0], c.deckHeight + 1.5, c.flols[1] - 2);
  flols.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 4.4, 1.4), new THREE.MeshStandardMaterial({ color: 0x222222 })));
  const ballMat = new THREE.MeshBasicMaterial({ color: 0xffa000 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), ballMat);
  ball.position.x = -0.45;
  flols.add(ball);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0x10ff40 }));
      d.position.set(-0.45, 0, side * (1.3 + k * 0.9));
      flols.add(d);
    }
  }
  flols.rotation.y = -ang;
  group.add(flols);
  // feux de bord de pont
  const edge = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(c.deck.map(([s, l]) => new THREE.Vector3(s, c.deckHeight + 0.3, l))),
    new THREE.PointsMaterial({ color: 0xffffcc, size: 3, sizeAttenuation: false }),
  );
  group.add(edge);
  return {
    group,
    setBall(cell: number, visible: boolean) {
      ball.visible = visible;
      ball.position.y = Math.max(-2, Math.min(2, cell)) * 0.8;
      ballMat.color.setHex(cell < -2.3 ? 0xff1010 : 0xffa000);
    },
    update(dt: number) {
      radar.rotation.y += dt * 1.6;
    },
  };
}
