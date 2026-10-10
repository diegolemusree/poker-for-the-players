// Fichas 3D en pilas reales por denominación. Un InstancedMesh por color: pocas llamadas de dibujo
// aunque haya cientos de fichas en la mesa. Cada ficha tiene franjas en el canto y un centro que brilla.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHIPS, stackBreakdown } from '../chips.js';
import { gradientMap, outline } from '../scene/toon.js';

export const CHIP_R = 0.027, CHIP_H = 0.009;
const PER_COLUMN = 15;
const GAP = CHIP_R * 2 + 0.005;
const INLAY = { 1000: '#fff6a8', 500: '#e2b8ff', 100: '#5ef2c2', 50: '#ffe0d6', 25: '#d6ffb0', 10: '#ff5fb5' };
const STRIPE = { 10: '#3aa0ff' };

function paint(geo, fn) {
  const g = geo.toNonIndexed();
  const pos = g.getAttribute('position'), col = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), color = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(b.clone().sub(a)).normalize();
    const mid = a.clone().add(b).add(c).divideScalar(3);
    color.set(fn(mid, n));
    for (let k = 0; k < 3; k++) color.toArray(col, (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function chipGeometry(info) {
  const stripe = STRIPE[info.value] || '#fffaf0';
  const body = paint(new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 24, 1), (mid, n) => {
    if (Math.abs(n.y) > 0.7) return info.color;
    const seg = Math.floor(((Math.atan2(mid.z, mid.x) + Math.PI) / (Math.PI * 2)) * 24);
    return seg % 4 < 2 ? stripe : info.color;
  });
  const inlay = paint(new THREE.CylinderGeometry(CHIP_R * 0.6, CHIP_R * 0.6, CHIP_H + 0.0018, 18, 1), () => INLAY[info.value]);
  // el "símbolo alienígena": un ojito en el centro
  const eye = paint(new THREE.CylinderGeometry(CHIP_R * 0.22, CHIP_R * 0.22, CHIP_H + 0.0026, 10, 1), () => info.edge);
  return mergeGeometries([body, inlay, eye]);
}

export class ChipField {
  constructor(parent, capacity = 700) {
    this.meshes = new Map();
    for (const info of CHIPS) {
      const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap(), emissive: info.color, emissiveIntensity: 0.16 });
      const m = new THREE.InstancedMesh(chipGeometry(info), mat, capacity);
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      outline(m, 'small');
      parent.add(m);
      this.meshes.set(info.value, m);
    }
    this.tmp = new THREE.Object3D();
  }
  begin() { for (const m of this.meshes.values()) m.count = 0; }

  // Pone `amount` como pilas sobre `origin` (en la mesa), con las columnas a lo largo de `across`
  // y las filas hacia `back`. `seed` hace que el desorden de cada pila sea estable entre redibujos.
  addStack(amount, origin, across, back, seed = 1) {
    if (!(amount > 0)) return;
    const cols = [];
    for (const c of stackBreakdown(amount).chips) {
      for (let left = c.count; left > 0; left -= PER_COLUMN) cols.push({ value: c.value, n: Math.min(PER_COLUMN, left) });
    }
    const perRow = Math.min(5, cols.length);
    const rnd = mulberry(seed * 9973 + Math.round(amount));
    cols.forEach((col, i) => {
      const row = Math.floor(i / perRow), k = i % perRow;
      const inRow = Math.min(perRow, cols.length - row * perRow);
      const x = (k - (inRow - 1) / 2) * GAP, z = row * GAP * 0.95;
      const mesh = this.meshes.get(col.value);
      for (let j = 0; j < col.n && mesh.count < mesh.instanceMatrix.count; j++) {
        this.tmp.position.copy(origin).addScaledVector(across, x + (rnd() - .5) * .003).addScaledVector(back, z + (rnd() - .5) * .003);
        this.tmp.position.y += CHIP_H / 2 + j * CHIP_H;
        this.tmp.rotation.set(0, rnd() * Math.PI * 2, 0);
        this.tmp.updateMatrix();
        mesh.setMatrixAt(mesh.count++, this.tmp.matrix);
      }
    });
  }
  end() {
    for (const m of this.meshes.values()) {
      m.instanceMatrix.needsUpdate = true;
      if (m.userData.outline) m.userData.outline.count = m.count;
    }
  }
}

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
