// Rivales: criaturas originales de la cintura para arriba, hechas con primitivas.
// Cada una se construye mirando hacia +z, con el origen en el piso bajo su silla.
// `tick` solo da un movimiento mínimo de reposo; las animaciones de jugadas son de la Fase 5.

import * as THREE from 'three';
import { mesh, toon } from '../scene/toon.js';

export const CREATURES = ['blob', 'robot', 'vegetal', 'tentaculos'];
export const HEAD_TOP = 1.62; // altura aproximada para la etiqueta flotante

const S = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
const C = (rt, rb, h, s = 16) => new THREE.CylinderGeometry(rt, rb, h, s);
const B = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const CAP = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 10);

function put(parent, m, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function eye(parent, x, y, z, r, look = 0.45) {
  const g = new THREE.Group();
  put(g, mesh(S(r), '#ffffff'), 0, 0, 0);
  put(g, new THREE.Mesh(S(r * look, 10, 8), toon('#16121f')), 0, 0, r * 0.78);
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function arm(parent, color, x, y, z, rx, rz, len = 0.26, r = 0.05) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  pivot.rotation.set(rx, 0, rz);
  put(pivot, mesh(CAP(r, len), color), 0, -len / 2, 0);
  put(pivot, mesh(S(r * 1.35, 12, 10), color), 0, -len - r * 0.6, 0);
  parent.add(pivot);
  return pivot;
}

const PALETTES = {
  blob: [['#7dff6a', '#3fbf3a'], ['#58e6ff', '#2a8fc2']],
  robot: [['#c9773a', '#7a3b17'], ['#9aa7b8', '#55606e']],
  vegetal: [['#7a3bc8', '#ff5fa2'], ['#e8572e', '#3ac6ff']],
  tentaculos: [['#ff9a3c', '#2ec4b6'], ['#b2f04a', '#ff4f6d']],
};

function blob([skin, spot]) {
  const g = new THREE.Group();
  const body = put(g, mesh(S(0.3, 24, 18), skin), 0, 0.95, 0, 0, 0, 0, 1, 1.15, 0.9);
  for (const [x, y, z, r] of [[-0.18, 0.86, 0.19, 0.05], [0.2, 1.06, 0.15, 0.04], [0.05, 0.78, 0.25, 0.035], [-0.1, 1.14, 0.18, 0.03]]) {
    put(g, new THREE.Mesh(S(r, 10, 8), toon(spot)), x, y, z, 0, 0, 0, 1, 1, 0.4);
  }
  const eyes = [eye(g, -0.13, 1.17, 0.2, 0.07), eye(g, 0.13, 1.17, 0.2, 0.07), eye(g, 0, 1.3, 0.17, 0.08)];
  put(g, mesh(new THREE.TorusGeometry(0.08, 0.016, 6, 14, Math.PI), '#2a0f22'), 0, 1.0, 0.27, 0, 0, Math.PI);
  const arms = [arm(g, skin, -0.27, 1.0, 0.05, 1.1, -0.35, 0.22, 0.055), arm(g, skin, 0.27, 1.0, 0.05, 1.1, 0.35, 0.22, 0.055)];
  return {
    group: g,
    tick(t) {
      const w = Math.sin(t * 3.1) * 0.035;
      body.scale.set(1 - w * 0.6, 1.15 + w, 0.9 - w * 0.4);
      eyes.forEach((e, i) => { e.position.y = (i === 2 ? 1.3 : 1.17) + w * 0.9; });
      arms[0].rotation.z = -0.35 + w * 2; arms[1].rotation.z = 0.35 - w * 2;
    },
  };
}

function robot([metal, rust]) {
  const g = new THREE.Group();
  put(g, mesh(B(0.46, 0.44, 0.3), metal), 0, 0.92, 0);
  for (const [x, y, w, h] of [[-0.12, 1.02, 0.12, 0.08], [0.14, 0.82, 0.1, 0.12], [0.02, 0.95, 0.06, 0.05]]) {
    put(g, new THREE.Mesh(B(w, h, 0.02), toon(rust)), x, y, 0.152);
  }
  put(g, mesh(C(0.06, 0.06, 0.08, 10), '#55606e'), 0, 1.17, 0);
  const head = new THREE.Group();
  head.position.set(0, 1.33, 0);
  g.add(head);
  put(head, mesh(B(0.34, 0.26, 0.28), metal), 0, 0, 0);
  put(head, mesh(C(0.075, 0.075, 0.03, 18), '#2b2f3a'), -0.06, 0.02, 0.145, Math.PI / 2);
  put(head, new THREE.Mesh(C(0.055, 0.055, 0.035, 18), toon('#5ff6ff', { emissive: '#3ad8ff', emissiveIntensity: 0.9 })), -0.06, 0.02, 0.15, Math.PI / 2);
  put(head, mesh(C(0.03, 0.03, 0.03, 12), '#2b2f3a'), 0.09, 0.03, 0.145, Math.PI / 2);
  put(head, mesh(B(0.18, 0.03, 0.02), '#2b2f3a'), 0.01, -0.08, 0.145);
  put(head, mesh(C(0.008, 0.008, 0.14, 6), '#2b2f3a'), -0.1, 0.2, 0);
  put(head, new THREE.Mesh(S(0.028, 10, 8), toon('#ff3b3b', { emissive: '#ff2020', emissiveIntensity: 0.6 })), -0.1, 0.28, 0);
  put(head, mesh(C(0.035, 0.04, 0.13, 10), rust), 0.1, 0.19, -0.04);
  const arms = [arm(g, '#55606e', -0.28, 1.08, 0.02, 1.15, -0.25, 0.26, 0.04), arm(g, '#55606e', 0.28, 1.08, 0.02, 1.15, 0.25, 0.26, 0.04)];
  // humo que sale de la chimenea
  const smokeMat = new THREE.MeshBasicMaterial({ color: '#cfc8d8', transparent: true, opacity: 0.7, depthWrite: false });
  const puffs = Array.from({ length: 5 }, (_, i) => { const p = new THREE.Mesh(S(0.04, 8, 6), smokeMat.clone()); p.userData.phase = i / 5; g.add(p); return p; });
  return {
    group: g,
    smoke: puffs,
    tick(t, low) {
      head.rotation.z = Math.sin(t * 0.9) * 0.06;
      head.rotation.y = Math.sin(t * 0.5) * 0.12;
      arms[0].rotation.x = 1.15 + Math.sin(t * 1.3) * 0.04;
      puffs.forEach((p, i) => {
        p.visible = !low || i < 2;
        const k = (t * 0.35 + p.userData.phase) % 1;
        p.position.set(0.1 + Math.sin(k * 6 + i) * 0.04 * k, 1.6 + k * 0.5, -0.04 - k * 0.1);
        p.scale.setScalar(0.6 + k * 2.2);
        p.material.opacity = 0.75 * (1 - k);
      });
    },
  };
}

function vegetal([veg, shirt]) {
  const g = new THREE.Group();
  put(g, mesh(C(0.2, 0.25, 0.44, 18), shirt), 0, 0.9, 0);
  for (const [x, y, a] of [[-0.12, 1.0, 0.4], [0.1, 0.85, 1.2], [0.0, 0.98, 2.4], [0.15, 1.04, 3.4], [-0.08, 0.8, 4.4]]) {
    put(g, new THREE.Mesh(S(0.03, 8, 6), toon('#ffe14d')), x, y, Math.cos(a) * 0.01 + 0.215, 0, 0, 0, 1, 1, 0.4);
  }
  put(g, mesh(C(0.05, 0.06, 0.1, 10), '#9ad14b'), 0, 1.16, 0);
  const head = new THREE.Group();
  head.position.set(0, 1.4, 0);
  g.add(head);
  put(head, mesh(S(0.17, 20, 16), veg), 0, 0, 0, 0, 0, 0.12, 1, 1.45, 1);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    put(head, mesh(new THREE.ConeGeometry(0.05, 0.16, 6), '#3fbf3a'), Math.cos(a) * 0.06, 0.25, Math.sin(a) * 0.06, Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
  }
  put(head, mesh(C(0.015, 0.02, 0.1, 6), '#2e8a2b'), 0.0, 0.32, 0);
  eye(head, -0.06, 0.04, 0.13, 0.045);
  eye(head, 0.07, 0.06, 0.13, 0.05);
  put(head, mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), '#2a0f22'), 0, -0.09, 0.15, 0, 0, Math.PI);
  arm(g, '#9ad14b', -0.24, 1.05, 0.02, 1.2, -0.3, 0.26, 0.045);
  arm(g, '#9ad14b', 0.24, 1.05, 0.02, 1.2, 0.3, 0.26, 0.045);
  return {
    group: g,
    tick(t) {
      head.rotation.z = Math.sin(t * 1.4) * 0.08;
      head.position.y = 1.4 + Math.abs(Math.sin(t * 2.8)) * 0.012;
    },
  };
}

function tentaculos([skin, dress]) {
  const g = new THREE.Group();
  put(g, mesh(C(0.15, 0.27, 0.46, 18), dress), 0, 0.9, 0);
  put(g, mesh(C(0.05, 0.06, 0.08, 10), skin), 0, 1.16, 0);
  const head = new THREE.Group();
  head.position.set(0, 1.32, 0);
  g.add(head);
  put(head, mesh(S(0.15, 20, 16), skin), 0, 0, 0, 0, 0, 0, 1, 1.1, 1);
  // peinado de colmena
  put(head, mesh(S(0.15, 16, 12), '#ff4fd8'), 0, 0.17, -0.02, 0, 0, 0, 1, 0.9, 1);
  put(head, mesh(S(0.11, 16, 12), '#ff4fd8'), 0, 0.31, -0.02);
  put(head, mesh(S(0.07, 12, 10), '#ff4fd8'), 0, 0.42, -0.01);
  eye(head, -0.055, 0.03, 0.12, 0.04);
  eye(head, 0.055, 0.03, 0.12, 0.04);
  eye(head, 0, 0.1, 0.13, 0.03);
  for (const s of [-1, 1]) put(head, mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 16), '#1d1d22'), s * 0.055, 0.035, 0.155, 0, 0, s * 0.3, 1.15, 0.85, 1);
  put(head, mesh(S(0.035, 10, 8), '#e0153b'), 0, -0.08, 0.13, 0, 0, 0, 1.4, 0.6, 0.7);
  const arms = [
    arm(g, skin, -0.2, 1.1, 0.02, 1.1, -0.35, 0.24, 0.035), arm(g, skin, 0.2, 1.1, 0.02, 1.1, 0.35, 0.24, 0.035),
    arm(g, skin, -0.22, 0.95, 0.04, 0.9, -0.6, 0.22, 0.033), arm(g, skin, 0.22, 0.95, 0.04, 0.9, 0.6, 0.22, 0.033),
  ];
  return {
    group: g,
    tick(t) {
      arms.forEach((a, i) => { a.rotation.x = (i < 2 ? 1.1 : 0.9) + Math.sin(t * 1.7 + i * 1.3) * 0.12; });
      head.rotation.y = Math.sin(t * 0.7) * 0.15;
    },
  };
}

const BUILD = { blob, robot, vegetal, tentaculos };

// Una criatura por asiento: el tipo sale del asiento, y del 5.º en adelante cambia la paleta.
export function makeCreature(seat) {
  const type = CREATURES[seat % CREATURES.length];
  const pal = PALETTES[type][Math.floor(seat / CREATURES.length) % 2];
  const c = BUILD[type](pal);
  c.type = type;
  c.offset = seat * 1.7;
  return c;
}

// Silla de respaldo alto, también para los asientos vacíos.
export function makeChair() {
  const g = new THREE.Group();
  put(g, mesh(B(0.62, 0.78, 0.09), '#5a2a7a'), 0, 0.85, -0.3);
  put(g, mesh(B(0.5, 0.6, 0.04), '#ff7a3d'), 0, 0.87, -0.245);
  put(g, mesh(S(0.05, 10, 8), '#ffe14d'), -0.28, 1.27, -0.3);
  put(g, mesh(S(0.05, 10, 8), '#ffe14d'), 0.28, 1.27, -0.3);
  put(g, mesh(B(0.6, 0.1, 0.5), '#5a2a7a'), 0, 0.48, -0.08);
  return g;
}
