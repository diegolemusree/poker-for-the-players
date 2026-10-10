// El cuarto de juego: chico, sucio y acogedor, pintado como fondo de serie animada.
// Paredes con tapiz café rojizo de rayas, grietas y manchas dibujadas; lambrín de madera con vetas;
// piso de mosaico caqui mugroso; tapete gastado; cuadros de planetas raros; puerta con letrero;
// repisa con frascos raros, reloj de 13 horas, contacto con cables y bote de basura.
// La lámpara de domo mostaza cuelga sobre la mesa; fuera de su luz el cuarto es más oscuro (toon.js).

import * as THREE from 'three';
import { mesh, toon, wobble, glow, flatShadow, roundBox, INK, LAMP } from './toon.js';

const ROOM = { x: 2.25, back: -2.4, front: 2.7, h: 2.6 };
const WAINSCOT = 0.95;
const DOOR = { x: 1.35, w: 0.84, h: 1.98 };
const HAND = '"Marker Felt", "Chalkboard SE", "Comic Sans MS", cursive';

/* ---------- utilidades de dibujo ---------- */
function rng(seed) {
  let a = Math.floor(seed * 9973) | 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// línea temblorosa a mano entre varios puntos
function wobblyLine(g, pts, r, jitter = 2) {
  g.beginPath();
  pts.forEach(([x, y], i) => {
    const jx = (r() - 0.5) * jitter, jy = (r() - 0.5) * jitter;
    if (i) g.lineTo(x + jx, y + jy); else g.moveTo(x, y);
  });
  g.stroke();
}
// mancha irregular, con o sin contorno
function stain(g, x, y, rad, fill, line, r) {
  g.beginPath();
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, k = rad * (0.75 + r() * 0.45);
    const px = x + Math.cos(a) * k * 1.3, py = y + Math.sin(a) * k;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  }
  g.closePath();
  g.fillStyle = fill; g.fill();
  if (line) { g.strokeStyle = line; g.lineWidth = 2; g.stroke(); }
}
function crack(g, x, y, len, r) {
  g.strokeStyle = '#2a1a12'; g.lineWidth = 2.2; g.lineCap = 'round';
  const pts = [[x, y]];
  let a = Math.PI / 2 + (r() - 0.5);
  for (let i = 0; i < 6; i++) {
    a += (r() - 0.5) * 1.1;
    const [px, py] = pts[pts.length - 1];
    const next = [px + Math.cos(a) * len / 6, py + Math.sin(a) * len / 6];
    pts.push(next);
    if (r() < 0.3) wobblyLine(g, [next, [next[0] + (r() - 0.5) * len / 3, next[1] + r() * len / 5]], r);
  }
  wobblyLine(g, pts, r, 1);
}

/* ---------- texturas pintadas ---------- */
// Tapiz: rayas verticales desteñidas, rombitos, manchas de humedad, grietas y hoyitos de clavo.
function wallTexture(wm, hm, seed, glowAt) {
  const W = 1024, H = Math.round(1024 * hm / wm), ppm = W / wm;
  return canvasTex(W, H, (g) => {
    const r = rng(seed);
    g.fillStyle = '#74402d'; g.fillRect(0, 0, W, H);
    const stripe = 0.2 * ppm;
    for (let x = 0; x < W; x += stripe * 2) { g.fillStyle = '#6b3a2a'; g.fillRect(x, 0, stripe, H); }
    g.fillStyle = '#7f4a34';
    for (let x = stripe * 1.5; x < W; x += stripe * 2) for (let y = 12; y < H; y += stripe * 0.8) {
      g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5, y); g.lineTo(x, y + 6); g.lineTo(x - 5, y); g.closePath(); g.fill();
    }
    // resplandor rojizo de la lámpara: una forma más clara de borde duro
    if (glowAt != null) {
      g.fillStyle = 'rgba(176, 96, 62, 0.45)';
      g.beginPath(); g.ellipse(glowAt * ppm, H - 1.75 * ppm, 1.05 * ppm, 0.5 * ppm, 0, 0, Math.PI * 2); g.fill();
    }
    const top = H - WAINSCOT * ppm; // abajo de esto lo tapa el lambrín
    for (let i = 0; i < 3; i++) stain(g, r() * W, r() * top * 0.8 + top * 0.05, (0.12 + r() * 0.12) * ppm, 'rgba(70, 34, 22, 0.35)', 'rgba(45, 22, 14, 0.45)', r);
    // escurrimientos desde el techo
    g.strokeStyle = 'rgba(60, 30, 20, 0.35)'; g.lineWidth = 6;
    for (let i = 0; i < 3; i++) { const x = r() * W; wobblyLine(g, [[x, 0], [x + 3, 30 + r() * 80], [x - 2, 60 + r() * 120]], r, 3); }
    for (let i = 0; i < 3; i++) crack(g, r() * W, r() * top * 0.3, (0.25 + r() * 0.3) * ppm, r);
    g.fillStyle = INK;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(r() * W, r() * top, 2.5, 0, Math.PI * 2); g.fill(); }
  });
}
// Mosaico caqui a cuadros de dos tonos, juntas oscuras, losetas rotas, mugre y colillas.
function floorTexture(wm, dm) {
  const W = 1024, H = Math.round(1024 * dm / wm), ppm = W / wm, tile = 0.45 * ppm;
  return canvasTex(W, H, (g) => {
    const r = rng(4.2);
    for (let y = 0, j = 0; y < H; y += tile, j++) for (let x = 0, i = 0; x < W; x += tile, i++) {
      g.fillStyle = (i + j) % 2 ? '#7d7350' : '#747056';
      g.fillRect(x, y, tile, tile);
    }
    g.strokeStyle = '#4f4733'; g.lineWidth = 2;
    for (let x = 0; x < W; x += tile) wobblyLine(g, [[x, 0], [x, H / 2], [x, H]], r, 1.5);
    for (let y = 0; y < H; y += tile) wobblyLine(g, [[0, y], [W / 2, y], [W, y]], r, 1.5);
    for (let i = 0; i < 9; i++) stain(g, r() * W, r() * H, (0.08 + r() * 0.16) * ppm, 'rgba(70, 62, 40, 0.4)', null, r);
    g.strokeStyle = '#3b3526'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(r() * W / tile) * tile, y = Math.floor(r() * H / tile) * tile;
      wobblyLine(g, [[x + 4, y + tile * r()], [x + tile * 0.4, y + tile * 0.5], [x + tile - 4, y + tile * r()]], r, 3);
    }
    for (let i = 0; i < 6; i++) {
      g.save(); g.translate(r() * W, r() * H); g.rotate(r() * 6);
      g.fillStyle = '#e3d6b8'; g.strokeStyle = INK; g.lineWidth = 1.5;
      g.fillRect(-6, -2, 12, 4); g.strokeRect(-6, -2, 12, 4);
      g.restore();
    }
  });
}
// Madera: vetas onduladas y algún nudo.
const grain = canvasTex(256, 256, (g, W, H) => {
  const r = rng(7.7);
  g.fillStyle = '#5a4030'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#4a3324'; g.lineWidth = 2;
  for (let x = 6; x < W; x += 10 + r() * 14) {
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= H; y += 16) g.lineTo(x + Math.sin(y * 0.04 + x) * 3, y);
    g.stroke();
  }
  for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(r() * W, r() * H, 5, 11, 0, 0, Math.PI * 2); g.stroke(); }
}, true);
function grainMat(rx, ry, tint = '#ffffff') {
  const map = grain.clone();
  map.repeat.set(rx, ry);
  map.needsUpdate = true;
  return toon(tint, { map });
}

function sign(text, w, h, bg, size) {
  const k = 512 / Math.max(w, h);
  return canvasTex(Math.round(w * k), Math.round(h * k), (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = INK; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
    g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${size}px ${HAND}`;
    const lines = text.split('\n');
    lines.forEach((l, i) => g.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * size * 1.15));
  });
}

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

// Un muro con lambrín. Se construye en el plano local XY mirando hacia +z.
function wall(parent, along, pos, ry, seed, { gaps = [], glowAt } = {}) {
  const g = new THREE.Group();
  g.position.copy(pos); g.rotation.y = ry;
  parent.add(g);
  plane(g, along, ROOM.h, wallTexture(along, ROOM.h, seed, glowAt), 0, ROOM.h / 2, 0);
  const cuts = [-along / 2, ...gaps.flat(), along / 2];
  for (let i = 0; i < cuts.length; i += 2) {
    const [a, b] = [cuts[i], cuts[i + 1]], w = b - a, cx = (a + b) / 2;
    if (w < 0.05) continue;
    const panel = new THREE.Mesh(wobble(new THREE.BoxGeometry(w, WAINSCOT, 0.03, Math.ceil(w * 3), 3, 1), 0.003, seed + i), grainMat(w / 0.6, 1.5));
    panel.position.set(cx, WAINSCOT / 2, 0.015);
    g.add(panel);
    box(g, w, 0.06, 0.06, '#4a3324', cx, WAINSCOT + 0.02, 0.03, 0, 0.004);
    box(g, w, 0.1, 0.045, '#3d2a1e', cx, 0.05, 0.025, 0, 0.003);
    for (let x = a + 0.22; x < b - 0.1; x += 0.42) box(g, 0.03, WAINSCOT - 0.18, 0.012, '#4f3829', x, WAINSCOT / 2 + 0.03, 0.036, 0, 0.002);
  }
  return g;
}

// Cuadros de paisajes de planetas raros, pintados en un canvas con colores apagados.
const PAINTINGS = [
  (g, W, H) => { // dunas ocre con planeta anillado
    g.fillStyle = '#7f9c94'; g.fillRect(0, 0, W, H);
    shape(g, '#d6c194', () => g.arc(W * 0.66, H * 0.36, H * 0.22, 0, Math.PI * 2));
    shape(g, '#b0603f', () => g.ellipse(W * 0.66, H * 0.36, H * 0.42, H * 0.07, -0.25, 0, Math.PI * 2), true);
    shape(g, '#9a786a', () => g.arc(W * 0.2, H * 0.22, H * 0.07, 0, Math.PI * 2));
    shape(g, '#b89a56', () => { g.moveTo(0, H * 0.7); g.quadraticCurveTo(W * 0.3, H * 0.52, W * 0.55, H * 0.72); g.quadraticCurveTo(W * 0.8, H * 0.6, W, H * 0.68); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); });
    shape(g, '#977a44', () => { g.moveTo(0, H * 0.86); g.quadraticCurveTo(W * 0.5, H * 0.74, W, H * 0.9); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); });
  },
  (g, W, H) => { // bosque de hongos bajo tres soles chiquitos
    g.fillStyle = '#9a9c7c'; g.fillRect(0, 0, W, H);
    for (const [x, y, r] of [[0.18, 0.2, 0.06], [0.32, 0.14, 0.04], [0.8, 0.22, 0.05]]) shape(g, '#e0bd62', () => g.arc(W * x, H * y, H * r, 0, Math.PI * 2));
    shape(g, '#66744b', () => { g.moveTo(0, H * 0.75); g.lineTo(W, H * 0.68); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); });
    for (const [x, h, r] of [[0.25, 0.42, 0.14], [0.55, 0.3, 0.1], [0.78, 0.5, 0.17]]) {
      shape(g, '#e0d2ad', () => g.rect(W * x - 6, H * (0.75 - h), 12, H * h));
      shape(g, '#b04e35', () => g.ellipse(W * x, H * (0.75 - h), H * r, H * r * 0.55, 0, Math.PI, 0));
    }
  },
  (g, W, H) => { // mar quieto con un planeta-ojo que mira con flojera
    g.fillStyle = '#4a5870'; g.fillRect(0, 0, W, H);
    shape(g, '#e3d8bb', () => g.arc(W * 0.5, H * 0.42, H * 0.26, 0, Math.PI * 2));
    shape(g, '#2f3f5c', () => g.arc(W * 0.53, H * 0.47, H * 0.05, 0, Math.PI * 2));
    shape(g, '#a8956f', () => { g.arc(W * 0.5, H * 0.42, H * 0.26, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); });
    shape(g, '#58777a', () => g.rect(0, H * 0.68, W, H * 0.32));
    g.strokeStyle = '#7d9a94'; g.lineWidth = 3;
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
function painting(parent, i, w, h, x, y, z, tilt) {
  const tex = canvasTex(256, Math.round(256 * h / w), (g, W, H) => PAINTINGS[i](g, W, H));
  const fr = new THREE.Group();
  fr.position.set(x, y, z); fr.rotation.z = tilt;
  box(fr, w + 0.1, h + 0.1, 0.035, '#8a6a3a', 0, 0, 0.018, 0, 0.004);
  plane(fr, w, h, tex, 0, 0, 0.037);
  parent.add(fr);
}

// Reloj de pared con 13 horas y las manecillas trabadas.
function clock(parent, x, y, z) {
  const tex = canvasTex(256, 256, (g, W) => {
    g.fillStyle = '#e3d6b8'; g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `30px ${HAND}`;
    for (let i = 1; i <= 13; i++) { const a = (i / 13) * Math.PI * 2 - Math.PI / 2; g.fillText(String(i), W / 2 + Math.cos(a) * 92, W / 2 + Math.sin(a) * 92); }
    g.strokeStyle = INK; g.lineCap = 'round';
    g.lineWidth = 8; g.beginPath(); g.moveTo(W / 2, W / 2); g.lineTo(W / 2 + 40, W / 2 - 38); g.stroke();
    g.lineWidth = 5; g.beginPath(); g.moveTo(W / 2, W / 2); g.lineTo(W / 2 - 18, W / 2 + 70); g.stroke();
  });
  const rim = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 24), '#7a5a2c');
  rim.rotation.x = Math.PI / 2; rim.position.set(x, y, z + 0.02);
  parent.add(rim);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.145, 24), toon('#ffffff', { map: tex }));
  face.position.set(x, y, z + 0.041); face.rotation.z = 0.12;
  parent.add(face);
}

// Repisa con frascos (uno con un ojo flotando) y un radio de bulbos con antena chueca.
function shelf(parent) {
  const g = new THREE.Group();
  g.position.set(-ROOM.x, 1.32, -1.85); g.rotation.y = Math.PI / 2;
  parent.add(g);
  box(g, 0.8, 0.035, 0.22, '#5e3a24', 0, 0, 0.11, 0, 0.004);
  for (const x of [-0.3, 0.3]) box(g, 0.03, 0.12, 0.16, '#4a3324', x, -0.07, 0.08, 0, 0.003);
  const jar = (x, h, liquid, extra) => {
    const j = mesh(wobble(new THREE.CylinderGeometry(0.05, 0.055, h, 12), 0.003, x * 10), liquid);
    j.position.set(x, h / 2 + 0.018, 0.1);
    g.add(j);
    const lid = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 12), '#7d8a86');
    lid.position.set(x, h + 0.028, 0.1);
    g.add(lid);
    if (extra) extra(j);
  };
  jar(-0.28, 0.16, '#8a9a52', (j) => {
    const eye = mesh(new THREE.SphereGeometry(0.03, 12, 8), '#e3d6b8');
    eye.position.set(0, 0.01, 0.035); j.add(eye);
    const pupil = mesh(new THREE.SphereGeometry(0.009, 8, 6), INK);
    pupil.position.set(0.008, 0, 0.03); eye.add(pupil);
  });
  jar(-0.14, 0.11, '#b0603f');
  const radio = new THREE.Group();
  radio.position.set(0.15, 0.018, 0.1);
  g.add(radio);
  box(radio, 0.26, 0.15, 0.13, '#7a4a2c', 0, 0.075, 0, 0, 0.004);
  const grill = mesh(new THREE.CircleGeometry(0.045, 16), '#c9b48a');
  grill.position.set(-0.05, 0.08, 0.066); radio.add(grill);
  for (const x of [0.06, 0.1]) { const k = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10), '#d8c9a3'); k.rotation.x = Math.PI / 2; k.position.set(x, 0.07, 0.07); radio.add(k); }
  const ant = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 5), INK);
  ant.position.set(0.08, 0.28, -0.02); ant.rotation.z = -0.5; radio.add(ant);
  const tip = mesh(new THREE.SphereGeometry(0.014, 8, 6), '#a4452f');
  tip.position.set(0.155, 0.41, -0.02); radio.add(tip);
}

function door(parent) {
  const g = new THREE.Group();
  g.position.set(DOOR.x, 0, ROOM.back);
  parent.add(g);
  const frame = '#4a3324';
  box(g, 0.08, DOOR.h + 0.06, 0.06, frame, -DOOR.w / 2 - 0.04, (DOOR.h + 0.06) / 2, 0.03);
  box(g, 0.08, DOOR.h + 0.06, 0.06, frame, DOOR.w / 2 + 0.04, (DOOR.h + 0.06) / 2, 0.03);
  box(g, DOOR.w + 0.16, 0.08, 0.06, frame, 0, DOOR.h + 0.04, 0.03);
  const leaf = new THREE.Mesh(wobble(new THREE.BoxGeometry(DOOR.w, DOOR.h, 0.04, 3, 6, 1), 0.005, 21), grainMat(1.4, 3, '#d6c2a8'));
  leaf.position.set(0, DOOR.h / 2, 0.02);
  g.add(leaf);
  for (const y of [0.55, 1.4]) box(g, DOOR.w - 0.26, 0.62, 0.015, '#584030', 0, y, 0.045, 0, 0.003);
  const knob = mesh(new THREE.SphereGeometry(0.03, 10, 8), '#b08a3a');
  knob.position.set(DOOR.w / 2 - 0.1, 1.0, 0.07);
  g.add(knob);
  // letrero chueco clavado en la puerta
  plane(g, 0.46, 0.18, sign('HOY NO SE FÍA,\nMAÑANA SÍ', 0.46, 0.18, '#d8c9a3', 52), 0, 1.78, 0.056, 0, 0.06);
}

// Contacto con cables que bajan al piso, y un bote de basura con papeles.
function junk(parent) {
  const outlet = box(parent, 0.08, 0.12, 0.02, '#d8c9a3', 0.62, 0.42, ROOM.back + 0.045, 0, 0.002);
  for (const dx of [-0.015, 0.015]) { const h = mesh(new THREE.BoxGeometry(0.006, 0.02, 0.005), INK); h.position.set(dx, 0.01, 0.011); outlet.add(h); }
  const cable = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.62, 0.42, ROOM.back + 0.07), new THREE.Vector3(0.55, 0.25, ROOM.back + 0.12),
    new THREE.Vector3(0.5, 0.012, ROOM.back + 0.3), new THREE.Vector3(0.2, 0.012, ROOM.back + 0.45), new THREE.Vector3(-0.1, 0.012, ROOM.back + 0.35)]), 24, 0.01, 5);
  parent.add(mesh(cable, '#2b2622'));

  const bin = new THREE.Group();
  bin.position.set(1.95, 0, -2.08);
  parent.add(bin);
  const can = mesh(wobble(new THREE.CylinderGeometry(0.17, 0.13, 0.42, 14, 2, true), 0.006, 31), toon('#6f7a6e', { side: THREE.DoubleSide }));
  can.position.y = 0.21; bin.add(can);
  for (const [x, z, r] of [[0.02, 0.03, 0.07], [-0.06, -0.02, 0.06], [0.06, -0.05, 0.05]]) {
    const p = mesh(wobble(new THREE.IcosahedronGeometry(r, 0), 0.01, x * 40), '#e3d6b8');
    p.position.set(x, 0.42, z); bin.add(p);
  }
  bin.add(flatShadow(0.2, 0.17));
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
  // cono de luz cálida: se suma muy leve, plano y sin contorno
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

  // piso de mosaico, tapete gastado y la sombra de la mesa
  const depth = ROOM.front - ROOM.back;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x * 2, depth), toon('#ffffff', { map: floorTexture(ROOM.x * 2, depth), edge: 'floor' }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = (ROOM.front + ROOM.back) / 2;
  g.add(floor);
  const rugTex = canvasTex(512, 512, (c, W) => {
    const r = rng(2.5);
    c.fillStyle = '#8c5b3b'; c.beginPath(); c.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#6e4a33'; c.lineWidth = 18; c.beginPath(); c.arc(W / 2, W / 2, W * 0.42, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 4; c.beginPath(); c.arc(W / 2, W / 2, W * 0.33, 0, Math.PI * 2); c.stroke();
    for (let i = 0; i < 6; i++) stain(c, W * (0.2 + r() * 0.6), W * (0.2 + r() * 0.6), W * (0.04 + r() * 0.06), 'rgba(170, 120, 80, 0.5)', null, r);
    c.strokeStyle = '#5a3a28'; c.lineWidth = 3;
    for (let a = 0; a < Math.PI * 2; a += 0.09) { c.beginPath(); c.moveTo(W / 2 + Math.cos(a) * W * 0.47, W / 2 + Math.sin(a) * W * 0.47); c.lineTo(W / 2 + Math.cos(a) * W * 0.5, W / 2 + Math.sin(a) * W * 0.5); c.stroke(); }
  });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), toon('#ffffff', { map: rugTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.y = 0.004;
  g.add(rug);
  const tableShadow = flatShadow(0.95, 0.9, 0.008);
  tableShadow.position.x = 0.06; tableShadow.position.z = -0.05;
  g.add(tableShadow);

  // paredes (la de atrás con hueco en el lambrín para la puerta), techo y viga
  wall(g, ROOM.x * 2, new THREE.Vector3(0, 0, ROOM.back), 0, 1.1, { gaps: [[DOOR.x - DOOR.w / 2 - 0.08, DOOR.x + DOOR.w / 2 + 0.08]], glowAt: ROOM.x });
  wall(g, depth, new THREE.Vector3(-ROOM.x, 0, (ROOM.front + ROOM.back) / 2), Math.PI / 2, 2.3);
  wall(g, depth, new THREE.Vector3(ROOM.x, 0, (ROOM.front + ROOM.back) / 2), -Math.PI / 2, 3.7);
  wall(g, ROOM.x * 2, new THREE.Vector3(0, 0, ROOM.front), Math.PI, 4.9);
  box(g, ROOM.x * 2, 0.08, depth, '#3a2a22', 0, ROOM.h + 0.04, (ROOM.front + ROOM.back) / 2, 0, 0);
  box(g, ROOM.x * 2, 0.14, 0.16, '#4a3324', 0, ROOM.h - 0.07, -0.9, 0, 0.006);

  door(g);
  junk(g);
  shelf(g);
  clock(g, -1.95, 1.72, ROOM.back);
  painting(g, 0, 0.56, 0.4, -1.3, 1.5, ROOM.back + 0.01, 0.03);
  painting(g, 2, 0.42, 0.32, -0.55, 1.62, ROOM.back + 0.01, -0.04);
  painting(g, 1, 0.32, 0.42, 0.4, 1.55, ROOM.back + 0.01, -0.02);
  plane(g, 0.5, 0.2, sign('PROHIBIDO\nESCUPIR ÁCIDO', 0.5, 0.2, '#e3d6b8', 50), ROOM.x - 0.012, 1.45, -1.9, -Math.PI / 2, -0.05);

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
