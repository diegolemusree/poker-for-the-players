// El cuarto de juego: chico, sucio y acogedor. Paredes café rojizo con lambrín de madera,
// piso caqui con manchas, tapete redondo gastado, cuadros de planetas raros, una puerta
// y la lámpara de domo mostaza con su cono de luz. Fuera de la luz todo se oscurece (ver toon.js).

import * as THREE from 'three';
import { mesh, toon, wobble, glow, INK, LAMP } from './toon.js';

const ROOM = { x: 2.25, back: -2.4, front: 2.7, h: 2.6 };
const WAINSCOT = 0.95;
const DOOR = { x: 1.3, w: 0.86, h: 2.0 };
const decal = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };

function box(parent, w, h, d, color, x, y, z, ry = 0, wob = 0.006) {
  const geo = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.round(w * 3)), Math.max(1, Math.round(h * 3)), 1);
  const m = mesh(wob ? wobble(geo, wob, x * 3 + z) : geo, color);
  m.position.set(x, y, z); m.rotation.y = ry;
  parent.add(m);
  return m;
}
function blob(r, seed, segs = 24) {
  const g = new THREE.CircleGeometry(r, segs);
  const p = g.getAttribute('position');
  for (let i = 1; i < p.count; i++) {
    const a = Math.atan2(p.getY(i), p.getX(i));
    const k = 1 + Math.sin(a * 3 + seed) * 0.2 + Math.sin(a * 7 + seed * 1.3) * 0.07;
    p.setXY(i, p.getX(i) * k, p.getY(i) * k);
  }
  return g;
}

// Un muro con lambrín. `along` es su largo; se construye en el plano local XY mirando hacia +z.
function wall(parent, along, pos, ry, gaps = []) {
  const g = new THREE.Group();
  g.position.copy(pos); g.rotation.y = ry;
  parent.add(g);
  box(g, along, ROOM.h, 0.12, '#6b3a2a', 0, ROOM.h / 2, -0.06, 0, 0.004);
  // tramos de lambrín entre huecos (la puerta)
  const cuts = [-along / 2, ...gaps.flat(), along / 2];
  for (let i = 0; i < cuts.length; i += 2) {
    const [a, b] = [cuts[i], cuts[i + 1]], w = b - a, cx = (a + b) / 2;
    if (w < 0.05) continue;
    box(g, w, WAINSCOT, 0.03, '#5a4030', cx, WAINSCOT / 2, 0.015, 0, 0.003);
    box(g, w, 0.06, 0.06, '#4a3324', cx, WAINSCOT + 0.02, 0.03, 0, 0.004);
    box(g, w, 0.1, 0.045, '#3d2a1e', cx, 0.05, 0.025, 0, 0.003);
    for (let x = a + 0.22; x < b - 0.1; x += 0.42) box(g, 0.03, WAINSCOT - 0.18, 0.012, '#5a4030', x, WAINSCOT / 2 + 0.03, 0.036, 0, 0.002);
  }
  // manchas de humedad en la pared
  for (let i = 0; i < 2; i++) {
    const s = new THREE.Mesh(blob(0.18 + i * 0.08, along + i * 4), toon('#5e3224', { ...decal }));
    s.position.set((i ? 0.3 : -0.4) * along, WAINSCOT + 0.5 + i * 0.6, 0.002);
    s.scale.set(1.3, 0.8, 1);
    g.add(s);
  }
  return g;
}

// Cuadros de paisajes de planetas raros, pintados en un canvas con colores apagados.
const PAINTINGS = [
  (g, W, H) => { // dunas ocre con planeta anillado
    g.fillStyle = '#6f8f8a'; g.fillRect(0, 0, W, H);
    shape(g, '#c9b48a', () => g.arc(W * 0.66, H * 0.36, H * 0.22, 0, Math.PI * 2));
    shape(g, '#a5583c', () => g.ellipse(W * 0.66, H * 0.36, H * 0.42, H * 0.07, -0.25, 0, Math.PI * 2), true);
    shape(g, '#8a6a5a', () => g.arc(W * 0.2, H * 0.22, H * 0.07, 0, Math.PI * 2));
    shape(g, '#a88a4a', () => { g.moveTo(0, H * 0.7); g.quadraticCurveTo(W * 0.3, H * 0.52, W * 0.55, H * 0.72); g.quadraticCurveTo(W * 0.8, H * 0.6, W, H * 0.68); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); });
    shape(g, '#8c6f3c', () => { g.moveTo(0, H * 0.86); g.quadraticCurveTo(W * 0.5, H * 0.74, W, H * 0.9); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); });
  },
  (g, W, H) => { // bosque de hongos bajo tres soles chiquitos
    g.fillStyle = '#8b8f72'; g.fillRect(0, 0, W, H);
    for (const [x, y, r] of [[0.18, 0.2, 0.06], [0.32, 0.14, 0.04], [0.8, 0.22, 0.05]]) shape(g, '#d9b45a', () => g.arc(W * x, H * y, H * r, 0, Math.PI * 2));
    shape(g, '#5d6b45', () => { g.moveTo(0, H * 0.75); g.lineTo(W, H * 0.68); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); });
    for (const [x, h, r] of [[0.25, 0.42, 0.14], [0.55, 0.3, 0.1], [0.78, 0.5, 0.17]]) {
      shape(g, '#d8c9a3', () => g.rect(W * x - 6, H * (0.75 - h), 12, H * h));
      shape(g, '#a4452f', () => g.ellipse(W * x, H * (0.75 - h), H * r, H * r * 0.55, 0, Math.PI, 0));
    }
  },
  (g, W, H) => { // mar quieto con un planeta-ojo que mira con flojera
    g.fillStyle = '#3e4a5c'; g.fillRect(0, 0, W, H);
    shape(g, '#d8cdb0', () => g.arc(W * 0.5, H * 0.42, H * 0.26, 0, Math.PI * 2));
    shape(g, '#2f3f5c', () => g.arc(W * 0.53, H * 0.47, H * 0.06, 0, Math.PI * 2));
    shape(g, '#9c8a6a', () => { g.arc(W * 0.5, H * 0.42, H * 0.26, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); });
    shape(g, '#4f6b6b', () => g.rect(0, H * 0.68, W, H * 0.32));
    g.strokeStyle = '#6f8a86'; g.lineWidth = 3;
    for (const y of [0.78, 0.88]) { g.beginPath(); g.moveTo(W * 0.15, H * y); g.lineTo(W * 0.45, H * y); g.moveTo(W * 0.6, H * y + 6); g.lineTo(W * 0.85, H * y + 6); g.stroke(); }
  },
];
function shape(g, fill, path, strokeOnly = false) {
  g.beginPath(); path();
  g.lineWidth = 4; g.strokeStyle = INK; g.fillStyle = fill;
  if (strokeOnly) { g.lineWidth = 10; g.strokeStyle = fill; g.stroke(); g.lineWidth = 3; g.strokeStyle = INK; }
  else g.fill();
  g.stroke();
}
function painting(parent, i, w, h, x, y, z, ry, tilt) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = Math.round(256 * h / w);
  const g = c.getContext('2d');
  PAINTINGS[i](g, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const fr = new THREE.Group();
  fr.position.set(x, y, z); fr.rotation.set(0, ry, tilt);
  box(fr, w + 0.1, h + 0.1, 0.035, '#8a6a3a', 0, 0, 0.018, 0, 0.004);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), toon('#ffffff', { map: tex }));
  art.position.z = 0.037;
  fr.add(art);
  parent.add(fr);
}

function door(parent) {
  const g = new THREE.Group();
  g.position.set(DOOR.x, 0, ROOM.back);
  parent.add(g);
  const frame = '#4a3324';
  box(g, 0.08, DOOR.h + 0.06, 0.06, frame, -DOOR.w / 2 - 0.04, (DOOR.h + 0.06) / 2, 0.03);
  box(g, 0.08, DOOR.h + 0.06, 0.06, frame, DOOR.w / 2 + 0.04, (DOOR.h + 0.06) / 2, 0.03);
  box(g, DOOR.w + 0.16, 0.08, 0.06, frame, 0, DOOR.h + 0.04, 0.03);
  box(g, DOOR.w, DOOR.h, 0.04, '#6e5238', 0, DOOR.h / 2, 0.02, 0, 0.005);
  for (const y of [0.55, 1.4]) box(g, DOOR.w - 0.26, 0.62, 0.015, '#634830', 0, y, 0.045, 0, 0.003);
  const knob = mesh(new THREE.SphereGeometry(0.03, 10, 8), '#b08a3a');
  knob.position.set(DOOR.w / 2 - 0.1, 1.0, 0.07);
  g.add(knob);
  // letrero chueco clavado en la puerta
  const sign = box(g, 0.32, 0.12, 0.012, '#d8c9a3', 0, 1.78, 0.05, 0, 0.004);
  sign.rotation.z = 0.07;
}

function lamp(parent) {
  const g = new THREE.Group();
  g.position.set(LAMP.x, ROOM.h, LAMP.z);
  parent.add(g);
  const drop = ROOM.h - LAMP.y;
  const cord = mesh(new THREE.CylinderGeometry(0.008, 0.008, drop - 0.2, 5), INK);
  cord.position.y = -(drop - 0.2) / 2;
  g.add(cord);
  const cap = mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.05, 10), toon('#8a6a2a', { pool: false }));
  cap.position.y = -(drop - 0.2);
  g.add(cap);
  // domo mostaza (por fuera) con el interior claro de la luz
  const dome = mesh(wobble(new THREE.SphereGeometry(0.21, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0.004, 3), toon('#c9a03a', { pool: false }));
  dome.position.y = -drop + 0.02;
  dome.scale.y = 0.75;
  g.add(dome);
  const inner = mesh(new THREE.SphereGeometry(0.205, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#000000', { emissive: '#f3d58a', side: THREE.BackSide, pool: false }));
  inner.position.copy(dome.position); inner.scale.y = 0.74;
  g.add(inner);
  const bulb = mesh(new THREE.SphereGeometry(0.05, 12, 8), toon('#000000', { emissive: '#fff4d2', pool: false }));
  bulb.position.y = -drop + 0.06;
  g.add(bulb);
  // cono de luz cálida: translúcido y plano, sin contorno
  const coneH = LAMP.y - 0.78;
  const cone = glow(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.72, coneH, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0.075, depthWrite: false })));
  cone.position.set(LAMP.x, LAMP.y - coneH / 2 + 0.02, LAMP.z);
  parent.add(cone);
  return g;
}

export function buildRoom(scene) {
  const g = new THREE.Group();
  scene.add(g);

  // piso, manchas y tapete gastado
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x * 2, ROOM.front - ROOM.back), toon('#7d7350', { edge: 'floor' }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = (ROOM.front + ROOM.back) / 2;
  g.add(floor);
  const flat = (geo, color, x, z, y, s = [1, 1], edge) => {
    const m = new THREE.Mesh(geo, toon(color, { edge, ...decal }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.scale.set(s[0], s[1], 1);
    g.add(m);
    return m;
  };
  [[-1.6, -1.7, 0.22], [1.7, 0.9, 0.16], [-1.2, 1.6, 0.3], [0.9, -1.9, 0.12]].forEach(([x, z, r], i) => flat(blob(r, i * 3.1), '#6b6243', x, z, 0.002, [1.4, 1], 'floor'));
  flat(blob(1.35, 0.7, 48), '#8c5b3b', 0, 0, 0.006);
  flat(new THREE.RingGeometry(1.06, 1.16, 48), '#6e4a33', 0, 0, 0.008, [1, 1], 'rug');
  [[0.55, 0.62, 0.3], [-0.7, -0.4, 0.22], [0.2, -0.85, 0.18]].forEach(([x, z, r], i) => flat(blob(r, 5 + i), '#9b6d48', x, z, 0.0075, [1.5, 1], 'rug'));

  // paredes (la de atrás con hueco para la puerta), techo y viga
  wall(g, ROOM.x * 2, new THREE.Vector3(0, 0, ROOM.back), 0, [[DOOR.x - DOOR.w / 2 - 0.08, DOOR.x + DOOR.w / 2 + 0.08]]);
  wall(g, ROOM.front - ROOM.back, new THREE.Vector3(-ROOM.x, 0, (ROOM.front + ROOM.back) / 2), Math.PI / 2);
  wall(g, ROOM.front - ROOM.back, new THREE.Vector3(ROOM.x, 0, (ROOM.front + ROOM.back) / 2), -Math.PI / 2);
  wall(g, ROOM.x * 2, new THREE.Vector3(0, 0, ROOM.front), Math.PI);
  box(g, ROOM.x * 2, 0.08, ROOM.front - ROOM.back, '#3a2a22', 0, ROOM.h + 0.04, (ROOM.front + ROOM.back) / 2, 0, 0);
  box(g, ROOM.x * 2, 0.14, 0.16, '#4a3324', 0, ROOM.h - 0.07, -0.9, 0, 0.006);

  door(g);
  painting(g, 0, 0.62, 0.44, -1.15, 1.62, ROOM.back + 0.01, 0, 0.03);
  painting(g, 1, 0.4, 0.52, 0.2, 1.78, ROOM.back + 0.01, 0, -0.02);
  painting(g, 2, 0.56, 0.42, -ROOM.x + 0.01, 1.6, -0.7, Math.PI / 2, -0.04);
  painting(g, 0, 0.36, 0.3, ROOM.x - 0.01, 1.7, 0.1, -Math.PI / 2, 0.05);

  const lampG = lamp(g);

  let calm = false;
  return {
    setQuality(q, reducedMotion) { calm = reducedMotion; },
    tick(t) {
      // la lámpara apenas se mece
      lampG.rotation.z = calm ? 0 : Math.sin(t * 0.5) * 0.012;
      lampG.rotation.x = calm ? 0 : Math.cos(t * 0.37) * 0.008;
    },
  };
}
