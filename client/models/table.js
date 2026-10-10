// Mesa redonda chica de madera para 6: fieltro verde gastado (más claro bajo la lámpara),
// riel de cuero café, una sola pata central con base de cruz. También las sillas de madera.

import * as THREE from 'three';
import { mesh, toon, wobble } from '../scene/toon.js';

export const TABLE_R = 0.74, FELT_Y = 0.76;
const decal = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };

function put(parent, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
// mancha plana e irregular sobre una superficie horizontal
function blob(r, seed, segs = 22) {
  const g = new THREE.CircleGeometry(r, segs);
  const p = g.getAttribute('position');
  for (let i = 1; i < p.count; i++) {
    const a = Math.atan2(p.getY(i), p.getX(i));
    const k = 1 + Math.sin(a * 3 + seed) * 0.16 + Math.sin(a * 5 + seed * 2.1) * 0.08;
    p.setXY(i, p.getX(i) * k, p.getY(i) * k);
  }
  g.rotateX(-Math.PI / 2);
  return g;
}

export function makeTable() {
  const g = new THREE.Group();
  const wood = '#7a4a2c', woodDark = '#5e3a24';

  // pata central y base de cruz
  put(g, mesh(wobble(new THREE.CylinderGeometry(0.075, 0.095, FELT_Y - 0.16, 10, 3), 0.004, 2), woodDark), 0, (FELT_Y - 0.16) / 2 + 0.06, 0);
  put(g, mesh(wobble(new THREE.CylinderGeometry(0.13, 0.15, 0.08, 10), 0.004, 3), wood), 0, 0.1, 0);
  for (const a of [Math.PI / 4, -Math.PI / 4]) put(g, mesh(wobble(new THREE.BoxGeometry(0.98, 0.06, 0.1, 4, 1, 1), 0.006, 4 + a), woodDark), 0, 0.03, 0, 0, a, 0);

  // cubierta: faldón, tabla, fieltro y riel
  put(g, mesh(wobble(new THREE.CylinderGeometry(0.82, 0.8, 0.09, 40, 1, true), 0.005, 5), toon(woodDark, { side: THREE.DoubleSide })), 0, FELT_Y - 0.075, 0);
  put(g, mesh(wobble(new THREE.CylinderGeometry(0.87, 0.86, 0.045, 40), 0.003, 6), wood), 0, FELT_Y - 0.04, 0);
  put(g, mesh(new THREE.CylinderGeometry(TABLE_R + 0.03, TABLE_R + 0.03, 0.02, 48), toon('#5f9a3a', { edge: 'felt' })), 0, FELT_Y - 0.01, 0);
  const rail = put(g, mesh(wobble(new THREE.TorusGeometry(TABLE_R + 0.06, 0.055, 10, 64), 0.003, 7), '#4b2e22'), 0, FELT_Y + 0.018, 0, Math.PI / 2);
  rail.scale.z = 0.75;

  // parche claro bajo la lámpara y desgaste del fieltro (mismo trazo que el fieltro: sin línea)
  put(g, mesh(blob(0.46, 1.3, 40), toon('#86b84e', { edge: 'felt', ...decal })), 0, FELT_Y + 0.0006, -0.02);
  [[-0.5, 0.25, 0.07, 2], [0.42, -0.44, 0.05, 5], [0.55, 0.3, 0.04, 8], [-0.2, -0.6, 0.05, 11]].forEach(([x, z, r, s]) => {
    put(g, mesh(blob(r, s), toon('#53873a', { edge: 'felt', ...decal })), x, FELT_Y + 0.0009, z);
  });
  return g;
}

// Utilería sobre la mesa: una botella y un cenicero con una colilla.
export function makeTableProps() {
  const g = new THREE.Group();
  const bottle = new THREE.Group();
  const profile = [[0, 0], [0.042, 0], [0.045, 0.01], [0.044, 0.14], [0.03, 0.17], [0.014, 0.2], [0.014, 0.25], [0.017, 0.26], [0, 0.26]].map(([x, y]) => new THREE.Vector2(x, y));
  put(bottle, mesh(wobble(new THREE.LatheGeometry(profile, 14), 0.002, 9), '#4e5a34'), 0, 0, 0);
  put(bottle, mesh(new THREE.CylinderGeometry(0.0455, 0.0455, 0.06, 14, 1, true), toon('#d8c9a3', { side: THREE.DoubleSide })), 0, 0.075, 0);
  put(g, bottle, 0.5, FELT_Y, 0.3, 0, 0, 0.02);

  const tray = new THREE.Group();
  put(tray, mesh(wobble(new THREE.CylinderGeometry(0.07, 0.062, 0.025, 16), 0.003, 10), '#7d8a86'), 0, 0.0125, 0);
  put(tray, mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.004, 16), '#3b3a36'), 0, 0.024, 0);
  put(tray, mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.055, 6), '#e3d6b8'), 0.02, 0.03, 0.01, 0, 0, Math.PI / 2 - 0.2);
  put(g, tray, -0.47, FELT_Y, 0.33);
  return g;
}

// Silla de madera algo chueca; mira hacia +z (hacia la mesa), con el origen en el piso.
export function makeChair() {
  const g = new THREE.Group();
  const wood = '#6a4530', dark = '#523525';
  put(g, mesh(wobble(new THREE.BoxGeometry(0.46, 0.05, 0.42, 2, 1, 2), 0.006, 12), wood), 0, 0.46, -0.04);
  for (const [x, z] of [[-0.19, 0.13], [0.19, 0.13], [-0.19, -0.2], [0.19, -0.2]]) {
    put(g, mesh(new THREE.CylinderGeometry(0.02, 0.017, 0.44, 6), dark), x, 0.22, z, 0, 0, x * 0.08);
  }
  for (const x of [-0.19, 0.19]) put(g, mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 6), dark), x, 0.72, -0.22, -0.08);
  for (const y of [0.78, 0.92]) put(g, mesh(wobble(new THREE.BoxGeometry(0.42, 0.07, 0.025, 3, 1, 1), 0.005, y * 10), wood), 0, y, -0.23, -0.08);
  return g;
}

// Punto del fieltro: ángulo `t` y fracción `f` del radio (1 = borde del fieltro).
export function feltPoint(t, f, y = FELT_Y) {
  return new THREE.Vector3(TABLE_R * f * Math.cos(t), y, TABLE_R * f * Math.sin(t));
}
// Dirección a lo largo del borde en el ángulo `t`.
export function feltTangent(t) {
  return new THREE.Vector3(-Math.sin(t), 0, Math.cos(t));
}
