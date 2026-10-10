// El garaje-taller donde se juega: chico, sucio y acogedor, pintado como fondo de serie animada.
// Paredes de tablas con mugre y grietas, tablero perforado con herramientas, repisa metálica con
// frascos raros (algunos brillan apenas), póster original, lavadora vieja, banco de trabajo,
// piso de concreto con manchas de aceite y la lámpara de domo mostaza sobre la mesa.
// Fuera de la luz de la lámpara todo se oscurece (toon.js).

import * as THREE from 'three';
import { mesh, toon, wobble, glow, flatShadow, roundBox, INK, LAMP } from './toon.js';

const ROOM = { x: 2.25, back: -2.4, front: 2.7, h: 2.6 };
const HAND = '"Chewy", "Marker Felt", "Comic Sans MS", cursive';

/* ---------- utilidades de dibujo ---------- */
function rng(seed) {
  let a = Math.floor(seed * 9973) | 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function wobblyLine(g, pts, r, jitter = 2) {
  g.beginPath();
  pts.forEach(([x, y], i) => { const jx = (r() - 0.5) * jitter, jy = (r() - 0.5) * jitter; if (i) g.lineTo(x + jx, y + jy); else g.moveTo(x, y); });
  g.stroke();
}
function stain(g, x, y, rad, fill, line, r) {
  g.beginPath();
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI * 2, k = rad * (0.75 + r() * 0.45);
    const px = x + Math.cos(a) * k * 1.3, py = y + Math.sin(a) * k;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
  g.fillStyle = fill; g.fill();
  if (line) { g.strokeStyle = line; g.lineWidth = 2; g.stroke(); }
}
function crack(g, x, y, len, r) {
  g.strokeStyle = '#2a1f16'; g.lineWidth = 2.2; g.lineCap = 'round';
  const pts = [[x, y]];
  let a = Math.PI / 2 + (r() - 0.5);
  for (let i = 0; i < 6; i++) { a += (r() - 0.5) * 1.1; const [px, py] = pts[pts.length - 1]; pts.push([px + Math.cos(a) * len / 6, py + Math.sin(a) * len / 6]); }
  wobblyLine(g, pts, r, 1);
}
// contorno de tinta grueso y relleno encima (como se rotula en caricatura)
function inked(g, text, x, y, size, fill, line = size * 0.12) {
  g.font = `${size}px ${HAND}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = line; g.strokeStyle = INK; g.strokeText(text, x, y);
  g.fillStyle = fill; g.fillText(text, x, y);
}
function shape(g, fill, path, w = 4) { g.beginPath(); path(); g.fillStyle = fill; g.fill(); g.lineWidth = w; g.strokeStyle = INK; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }

/* ---------- texturas ---------- */
// Tablas verticales de madera vieja con juntas, clavos, manchas y grietas.
function plankTexture(wm, hm, seed, glowAt) {
  const W = 1024, H = Math.round(1024 * hm / wm), ppm = W / wm, pw = 0.17 * ppm;
  return canvasTex(W, H, (g) => {
    const r = rng(seed);
    for (let x = 0, i = 0; x < W; x += pw, i++) { g.fillStyle = ['#75614c', '#6d5946', '#7b6650'][i % 3]; g.fillRect(x, 0, pw + 1, H); }
    if (glowAt != null) { // resplandor de la lámpara en la pared
      g.fillStyle = 'rgba(190, 120, 70, 0.32)';
      g.beginPath(); g.ellipse(glowAt * ppm, H - 1.75 * ppm, 1.1 * ppm, 0.55 * ppm, 0, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = '#3b2f24'; g.lineWidth = 2.5;
    for (let x = pw; x < W; x += pw) wobblyLine(g, [[x, 0], [x, H / 2], [x, H]], r, 1.5);
    g.strokeStyle = 'rgba(59, 47, 36, 0.5)'; g.lineWidth = 1.5;
    for (let i = 0; i < 40; i++) { const x = r() * W, y = r() * H; wobblyLine(g, [[x, y], [x + (r() - 0.5) * 6, y + 30 + r() * 60]], r, 2); }
    g.fillStyle = INK;
    for (let x = pw / 2; x < W; x += pw) for (const y of [0.15, 0.55, 0.92]) { g.beginPath(); g.arc(x + (r() - 0.5) * 8, H * y, 2.5, 0, Math.PI * 2); g.fill(); }
    for (let i = 0; i < 4; i++) stain(g, r() * W, H * (0.2 + r() * 0.7), (0.1 + r() * 0.15) * ppm, 'rgba(50, 38, 28, 0.32)', 'rgba(35, 26, 18, 0.4)', r);
    for (let i = 0; i < 2; i++) crack(g, r() * W, r() * H * 0.5, (0.3 + r() * 0.3) * ppm, r);
  });
}
// Concreto con manchas de aceite, grietas y una coladera.
function concreteTexture(wm, dm) {
  const W = 1024, H = Math.round(1024 * dm / wm), ppm = W / wm;
  return canvasTex(W, H, (g) => {
    const r = rng(6.3);
    g.fillStyle = '#77705f'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 14; i++) stain(g, r() * W, r() * H, (0.1 + r() * 0.25) * ppm, 'rgba(95, 88, 72, 0.45)', null, r);
    for (let i = 0; i < 5; i++) stain(g, r() * W, r() * H, (0.08 + r() * 0.14) * ppm, 'rgba(40, 36, 30, 0.45)', 'rgba(29, 22, 17, 0.5)', r);
    g.strokeStyle = 'rgba(29, 22, 17, 0.55)'; g.lineWidth = 2.5;
    for (let y = 1.3 * ppm; y < H; y += 1.3 * ppm) wobblyLine(g, [[0, y], [W / 3, y + 3], [W * 2 / 3, y - 2], [W, y]], r, 2);
    for (let i = 0; i < 5; i++) crack(g, r() * W, r() * H, (0.3 + r() * 0.4) * ppm, r);
    for (let i = 0; i < 6; i++) {
      g.save(); g.translate(r() * W, r() * H); g.rotate(r() * 6);
      g.fillStyle = '#e3d6b8'; g.strokeStyle = INK; g.lineWidth = 1.5; g.fillRect(-6, -2, 12, 4); g.strokeRect(-6, -2, 12, 4);
      g.restore();
    }
  });
}
// Tablero perforado con herramientas colgadas.
const pegboardTex = () => canvasTex(512, 384, (g, W, H) => {
  g.fillStyle = '#b39a6e'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#7a6648';
  for (let y = 14; y < H; y += 24) for (let x = 14; x < W; x += 24) { g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill(); }
  const metal = '#a8b0b2', handle = '#a4452f', handle2 = '#c99a35';
  // llave inglesa
  shape(g, metal, () => { g.moveTo(60, 60); g.lineTo(78, 60); g.lineTo(76, 250); g.lineTo(62, 250); g.closePath(); });
  shape(g, metal, () => { g.arc(69, 52, 22, Math.PI * 0.15, Math.PI * 1.85, false); g.lineTo(80, 50); g.lineTo(72, 42); g.closePath(); });
  // desarmadores
  for (const [x, c] of [[130, handle], [170, handle2], [205, '#6f7a3c']]) {
    shape(g, c, () => { g.roundRect(x - 11, 50, 22, 70, 9); });
    shape(g, metal, () => { g.rect(x - 4, 120, 8, 90); });
  }
  // martillo
  shape(g, '#8a6a3a', () => { g.roundRect(268, 90, 18, 170, 7); });
  shape(g, '#5f686a', () => { g.roundRect(240, 60, 76, 36, 10); });
  // pinzas
  shape(g, handle, () => { g.moveTo(360, 150); g.quadraticCurveTo(350, 230, 340, 290); g.lineTo(356, 292); g.quadraticCurveTo(368, 230, 372, 150); g.closePath(); });
  shape(g, handle, () => { g.moveTo(388, 150); g.quadraticCurveTo(396, 230, 404, 290); g.lineTo(420, 288); g.quadraticCurveTo(410, 230, 400, 150); g.closePath(); });
  shape(g, metal, () => { g.moveTo(362, 150); g.lineTo(380, 70); g.lineTo(398, 150); g.closePath(); });
  // serrucho
  shape(g, metal, () => { g.moveTo(440, 60); g.lineTo(496, 60); g.lineTo(486, 330); g.lineTo(452, 300); g.closePath(); });
  shape(g, '#8a6a3a', () => { g.roundRect(436, 40, 64, 30, 10); });
  g.strokeStyle = INK; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
});
// Póster original: la campaña de cuidado del cerebro en frasco.
const posterTex = () => canvasTex(300, 400, (g, W, H) => {
  g.fillStyle = '#e3d6b8'; g.fillRect(0, 0, W, H);
  inked(g, 'MES DEL', W / 2, 46, 40, '#a4452f', 7);
  inked(g, 'CEREBRO', W / 2, 92, 52, '#a4452f', 8);
  inked(g, 'EN FRASCO', W / 2, 140, 40, '#a4452f', 7);
  // frasco con cerebro de ojos caídos
  shape(g, '#b9cfd6', () => { g.roundRect(80, 170, 140, 170, 30); }, 6);
  shape(g, '#c08a7a', () => { g.ellipse(150, 260, 52, 44, 0, 0, Math.PI * 2); }, 5);
  g.strokeStyle = INK; g.lineWidth = 3;
  for (const [a, b] of [[110, 245], [140, 232], [170, 248], [128, 280], [165, 285]]) { g.beginPath(); g.arc(a, b, 10, 0, Math.PI); g.stroke(); }
  for (const x of [134, 166]) {
    g.fillStyle = '#fbf6e6'; g.beginPath(); g.arc(x, 262, 9, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#c08a7a'; g.beginPath(); g.arc(x, 262, 9, Math.PI, 0); g.fill(); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(x + 1, 266, 2.5, 0, Math.PI * 2); g.fill();
  }
  shape(g, '#7d8a86', () => { g.roundRect(70, 160, 160, 22, 8); }, 5);
  inked(g, '¡Háblale bonito!', W / 2, 372, 30, '#2f3f5c', 6);
  g.strokeStyle = INK; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
});
// Rejilla de ventilación.
const ventTex = () => canvasTex(160, 120, (g, W, H) => {
  g.fillStyle = '#8d9597'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#3e4648';
  for (let y = 16; y < H - 10; y += 16) g.fillRect(14, y, W - 28, 7);
  g.strokeStyle = INK; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
});

/* ---------- piezas ---------- */
function box(parent, w, h, d, color, x, y, z, ry = 0, wob = 0.006) {
  const geo = roundBox(w, h, d);
  const m = mesh(wob ? wobble(geo, wob, x * 3 + z) : geo, color);
  m.position.set(x, y, z); m.rotation.y = ry;
  parent.add(m);
  return m;
}
function plane(parent, w, h, tex, x, y, z, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), toon('#ffffff', { map: tex }));
  m.position.set(x, y, z); m.rotation.set(0, ry, rz);
  parent.add(m);
  return m;
}
function wall(parent, along, pos, ry, seed, glowAt) {
  const g = new THREE.Group();
  g.position.copy(pos); g.rotation.y = ry;
  parent.add(g);
  plane(g, along, ROOM.h, plankTexture(along, ROOM.h, seed, glowAt), 0, ROOM.h / 2, 0);
  box(g, along, 0.1, 0.04, '#4a3a2c', 0, 0.05, 0.02, 0, 0.003);
  return g;
}

// Frasco de laboratorio: perfil torneado con su líquido; los que "brillan" no se oscurecen con la luz.
function flask(parent, x, y, z, kind, liquid, glowing) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const prof = {
    matraz: [[0, 0], [0.07, 0], [0.075, 0.03], [0.03, 0.12], [0.022, 0.2], [0, 0.2]],
    bola: [[0, 0], [0.04, 0], [0.065, 0.05], [0.06, 0.1], [0.02, 0.13], [0.02, 0.2], [0, 0.2]],
    frasco: [[0, 0], [0.055, 0], [0.058, 0.16], [0.045, 0.18], [0, 0.18]],
  }[kind].map(([a, b]) => new THREE.Vector2(a, b));
  const glass = mesh(wobble(new THREE.LatheGeometry(prof, 14), 0.002, x * 9), '#b9cfd6');
  g.add(glass);
  const fill = mesh(new THREE.LatheGeometry(prof.slice(0, kind === 'frasco' ? 3 : 3).map(v => new THREE.Vector2(v.x * 0.93, v.y * 0.7)).concat([new THREE.Vector2(0, prof[2].y * 0.7)]), 14),
    glowing ? toon('#000000', { emissive: liquid, pool: false }) : liquid);
  fill.position.y = 0.004;
  g.add(fill);
  if (kind === 'frasco') { const lid = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.025, 12), '#7d8a86'); lid.position.y = 0.19; g.add(lid); }
  else { const cork = mesh(new THREE.CylinderGeometry(0.02, 0.017, 0.035, 8), '#a88a5a'); cork.position.y = 0.215; g.add(cork); }
  return g;
}

// Repisa metálica con frascos, cajas y cachivaches.
function shelving(parent, cx, z, w) {
  const g = new THREE.Group();
  g.position.set(cx, 0, z);
  parent.add(g);
  const metal = '#7d8a86', d = 0.32;
  for (const x of [-w / 2, w / 2]) for (const zz of [0.03, d - 0.03]) box(g, 0.035, 2.05, 0.035, metal, x, 1.025, zz, 0, 0.002);
  const levels = [0.55, 1.1, 1.62, 2.02];
  for (const y of levels) box(g, w + 0.04, 0.03, d, '#8d9597', 0, y, d / 2, 0, 0.003);
  flask(g, -0.3, 1.115, 0.15, 'matraz', '#8fbf5a', true);
  flask(g, -0.12, 1.115, 0.18, 'frasco', '#b0603f');
  flask(g, 0.08, 1.115, 0.14, 'bola', '#c48aa8', true);
  flask(g, 0.28, 1.115, 0.17, 'frasco', '#d6c194');
  flask(g, -0.25, 1.635, 0.15, 'frasco', '#6f7a3c');
  flask(g, 0.02, 1.635, 0.17, 'matraz', '#9ab8c4');
  box(g, 0.24, 0.16, 0.22, '#a88a5a', 0.26, 1.715, 0.16, 0.1, 0.005);
  box(g, 0.3, 0.2, 0.24, '#a88a5a', -0.2, 0.66, 0.16, -0.08, 0.006);
  box(g, 0.22, 0.14, 0.2, '#a4452f', 0.18, 0.63, 0.16, 0.12, 0.005);
  flask(g, 0.3, 2.035, 0.14, 'bola', '#8fbf5a', true);
  box(g, 0.32, 0.12, 0.2, '#6f7a3c', -0.15, 2.095, 0.16, 0, 0.004);
  return g;
}

// Lavadora vieja de carga frontal.
function washer(parent, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  parent.add(g);
  box(g, 0.62, 0.86, 0.6, '#d8d4c8', 0, 0.43, 0, 0, 0.006);
  box(g, 0.6, 0.12, 0.05, '#bdb8aa', 0, 0.78, 0.29, 0, 0.003);
  for (const [kx, c] of [[-0.18, '#a4452f'], [-0.06, '#7d8a86']]) { const k = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), c); k.rotation.x = Math.PI / 2; k.position.set(kx, 0.78, 0.32); g.add(k); }
  const ring = mesh(new THREE.TorusGeometry(0.18, 0.035, 8, 24), '#a8b0b2');
  ring.position.set(0, 0.4, 0.305); g.add(ring);
  const glassD = mesh(new THREE.CircleGeometry(0.17, 24), '#3e4a5c');
  glassD.position.set(0, 0.4, 0.302); g.add(glassD);
  const sock = mesh(new THREE.CircleGeometry(0.05, 12), '#c48aa8');
  sock.position.set(0.04, 0.34, 0.304); g.add(sock);
  g.add(flatShadow(0.36, 0.34));
  return g;
}

// Banco de trabajo con tornillo de banco, caja de herramientas y un aparato con un foquito.
function workbench(parent) {
  const g = new THREE.Group();
  g.position.set(-ROOM.x + 0.32, 0, -1.45);
  g.rotation.y = Math.PI / 2;
  parent.add(g);
  box(g, 1.2, 0.06, 0.55, '#8a6a3a', 0, 0.9, 0, 0, 0.005);
  for (const x of [-0.55, 0.55]) for (const zz of [-0.22, 0.22]) box(g, 0.06, 0.9, 0.06, '#6a4530', x, 0.45, zz, 0, 0.003);
  box(g, 1.1, 0.04, 0.5, '#6a4530', 0, 0.3, 0, 0, 0.004);
  box(g, 0.14, 0.12, 0.12, '#5f686a', -0.42, 0.99, 0.2, 0, 0.003);
  box(g, 0.34, 0.16, 0.18, '#a4452f', 0.3, 1.01, -0.05, 0.2, 0.004);
  box(g, 0.22, 0.12, 0.16, '#7d8a86', -0.05, 0.99, 0.05, -0.3, 0.004);
  const bulb = mesh(new THREE.SphereGeometry(0.035, 10, 8), toon('#000000', { emissive: '#8fbf5a', pool: false }));
  bulb.position.set(-0.05, 1.08, 0.05); g.add(bulb);
  const cable = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.05, 1.0, 0.1), new THREE.Vector3(0.1, 0.93, 0.25), new THREE.Vector3(0.3, 0.5, 0.3), new THREE.Vector3(0.4, 0.01, 0.45)]), 16, 0.008, 5);
  g.add(mesh(cable, '#2b2622'));
  g.add(flatShadow(0.7, 0.33, 0.006));
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
  const dome = mesh(wobble(new THREE.SphereGeometry(0.21, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0.004, 3), toon('#c9a03a', { pool: false }));
  dome.position.y = -drop + 0.02; dome.scale.y = 0.75;
  g.add(dome);
  const inner = mesh(new THREE.SphereGeometry(0.205, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#000000', { emissive: '#f3d58a', side: THREE.BackSide, pool: false }));
  inner.position.copy(dome.position); inner.scale.y = 0.74;
  g.add(inner);
  const bulb = mesh(new THREE.SphereGeometry(0.05, 12, 8), toon('#000000', { emissive: '#fff4d2', pool: false }));
  bulb.position.y = -drop + 0.06;
  g.add(bulb);
  const coneH = LAMP.y - 0.78;
  const cone = glow(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.72, coneH, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: '#1c160a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  cone.position.set(LAMP.x, LAMP.y - coneH / 2 + 0.02, LAMP.z);
  parent.add(cone);
  return g;
}

export function buildRoom(scene) {
  const g = new THREE.Group();
  scene.add(g);

  const depth = ROOM.front - ROOM.back;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x * 2, depth), toon('#ffffff', { map: concreteTexture(ROOM.x * 2, depth), edge: 'floor' }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = (ROOM.front + ROOM.back) / 2;
  g.add(floor);
  const tableShadow = flatShadow(0.95, 0.9, 0.006);
  tableShadow.position.x = 0.06; tableShadow.position.z = -0.05;
  g.add(tableShadow);

  wall(g, ROOM.x * 2, new THREE.Vector3(0, 0, ROOM.back), 0, 1.1, ROOM.x);
  wall(g, depth, new THREE.Vector3(-ROOM.x, 0, (ROOM.front + ROOM.back) / 2), Math.PI / 2, 2.3);
  wall(g, depth, new THREE.Vector3(ROOM.x, 0, (ROOM.front + ROOM.back) / 2), -Math.PI / 2, 3.7);
  wall(g, ROOM.x * 2, new THREE.Vector3(0, 0, ROOM.front), Math.PI, 4.9);
  box(g, ROOM.x * 2, 0.08, depth, '#3a2f26', 0, ROOM.h + 0.04, (ROOM.front + ROOM.back) / 2, 0, 0);
  for (const z of [-1.6, -0.4, 0.8]) box(g, ROOM.x * 2, 0.12, 0.14, '#5a4636', 0, ROOM.h - 0.06, z, 0, 0.006);

  // pared del fondo: tablero de herramientas, repisa, póster, rejilla y lavadora
  const peg = plane(g, 1.15, 0.86, pegboardTex(), -1.45, 1.55, ROOM.back + 0.02);
  peg.rotation.z = 0.01;
  shelving(g, 0.15, ROOM.back + 0.02, 0.9);
  plane(g, 0.45, 0.6, posterTex(), 1.15, 1.62, ROOM.back + 0.015, 0, -0.04);
  plane(g, 0.32, 0.24, ventTex(), 1.8, 2.25, ROOM.back + 0.015);
  washer(g, 1.82, ROOM.back + 0.34);
  workbench(g);

  // bote de basura con papeles
  const bin = new THREE.Group();
  bin.position.set(-1.95, 0, ROOM.back + 0.3);
  g.add(bin);
  const can = mesh(wobble(new THREE.CylinderGeometry(0.17, 0.13, 0.42, 14, 2, true), 0.006, 31), toon('#6f7a6e', { side: THREE.DoubleSide }));
  can.position.y = 0.21; bin.add(can);
  for (const [x, z, r] of [[0.02, 0.03, 0.07], [-0.06, -0.02, 0.06], [0.06, -0.05, 0.05]]) {
    const p = mesh(wobble(new THREE.IcosahedronGeometry(r, 0), 0.01, x * 40), '#e3d6b8');
    p.position.set(x, 0.42, z); bin.add(p);
  }
  bin.add(flatShadow(0.2, 0.17));

  const lampG = lamp(g);
  let calm = false;
  return {
    setQuality(q, reducedMotion) { calm = reducedMotion; },
    tick(t) {
      lampG.rotation.z = calm ? 0 : Math.sin(t * 0.5) * 0.012;
      lampG.rotation.x = calm ? 0 : Math.cos(t * 0.37) * 0.008;
    },
  };
}
