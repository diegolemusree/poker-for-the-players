// Mesa ovalada: fieltro verde chillón con manchas sospechosas, línea de apuestas
// y riel acolchado de piel alienígena con costuras amarillas.

import * as THREE from 'three';
import { mesh, toon } from '../scene/toon.js';

export const TABLE_A = 1.55, TABLE_B = 0.92, FELT_Y = 0.76;
const RAIL_R = 0.085;

class EllipsePath extends THREE.Curve {
  constructor(a, b, y) { super(); this.a = a; this.b = b; this.y = y; }
  getPoint(t, target = new THREE.Vector3()) {
    const ang = t * Math.PI * 2;
    return target.set(this.a * Math.cos(ang), this.y, this.b * Math.sin(ang));
  }
}

function ellipseShape(a, b, hole) {
  const s = new THREE.Shape();
  s.absellipse(0, 0, a, b, 0, Math.PI * 2, false);
  if (hole) { const h = new THREE.Path(); h.absellipse(0, 0, hole[0], hole[1], 0, Math.PI * 2, true); s.holes.push(h); }
  return s;
}
function slab(shape, depth, color, y, kind = 'big') {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 64 });
  geo.rotateX(-Math.PI / 2);
  const m = mesh(geo, color, kind);
  m.position.y = y;
  return m;
}

export function makeTable() {
  const g = new THREE.Group();

  // base y pedestal
  const base = slab(ellipseShape(TABLE_A - 0.05, TABLE_B - 0.05), 0.16, '#3b1f4f', FELT_Y - 0.22);
  g.add(base);
  const ped = mesh(new THREE.CylinderGeometry(0.28, 0.5, FELT_Y - 0.22, 20), '#2a1638');
  ped.position.y = (FELT_Y - 0.22) / 2;
  g.add(ped);

  const felt = slab(ellipseShape(TABLE_A, TABLE_B), 0.05, '#27d65f', FELT_Y - 0.05, null);
  felt.receiveShadow = true;
  g.add(felt);

  const line = slab(ellipseShape(TABLE_A * 0.56, TABLE_B * 0.56, [TABLE_A * 0.56 - 0.018, TABLE_B * 0.56 - 0.018]), 0.001, '#b8ff9a', FELT_Y, null);
  g.add(line);

  // manchas sospechosas
  const stains = [[-0.62, 0.22, 0.13, '#1fa84a'], [0.7, -0.32, 0.09, '#8f3fbf'], [0.42, 0.5, 0.06, '#d9b52c'], [-0.34, -0.55, 0.08, '#1a9440'], [1.05, 0.14, 0.05, '#c2410c']];
  stains.forEach(([x, z, r, col], i) => {
    const s = new THREE.Mesh(new THREE.CircleGeometry(r, 18), toon(col, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    s.rotation.x = -Math.PI / 2; s.rotation.z = i;
    s.scale.set(1, 0.7 + (i % 3) * 0.15, 1);
    s.position.set(x, FELT_Y + 0.0006, z);
    s.receiveShadow = true;
    g.add(s);
  });

  // riel acolchado
  const railGeo = new THREE.TubeGeometry(new EllipsePath(TABLE_A + 0.06, TABLE_B + 0.06, FELT_Y + 0.03), 160, RAIL_R, 14, true);
  const rail = mesh(railGeo, '#b8327f');
  rail.castShadow = rail.receiveShadow = true;
  g.add(rail);

  // costuras
  const N = 120;
  const stitch = new THREE.InstancedMesh(new THREE.BoxGeometry(0.026, 0.006, 0.007), toon('#ffe36e'), N);
  const o = new THREE.Object3D(), path = new EllipsePath(TABLE_A + 0.06, TABLE_B + 0.06, FELT_Y + 0.03 + RAIL_R + 0.001);
  for (let i = 0; i < N; i++) {
    const t = i / N;
    path.getPoint(t, o.position);
    const tan = path.getTangent(t);
    o.rotation.set(0, -Math.atan2(tan.z, tan.x), 0);
    o.updateMatrix();
    stitch.setMatrixAt(i, o.matrix);
  }
  g.add(stitch);
  return g;
}

// Punto del óvalo: ángulo `t` y fracción `f` del radio (1 = borde del fieltro).
export function feltPoint(t, f, y = FELT_Y) {
  return new THREE.Vector3(TABLE_A * f * Math.cos(t), y, TABLE_B * f * Math.sin(t));
}
// Dirección a lo largo del borde en el ángulo `t`.
export function feltTangent(t) {
  return new THREE.Vector3(-TABLE_A * Math.sin(t), 0, TABLE_B * Math.cos(t)).normalize();
}
