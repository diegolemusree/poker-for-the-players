// Rivales como recortes 2D de serie animada: cada personaje se dibuja a mano en un canvas
// con contorno de tinta, color de base, luz de borde arriba, sombra recortada, un degradado suave
// hacia abajo y detalles (arrugas, ojeras, manchas). Se pone en la escena como un cartón que siempre
// mira a la cámara, recargado en la orilla de la mesa con los brazos encima.
// Se pintan tres cuadros por personaje (ojos abiertos, parpadeo, mirada de reojo) y una capa aparte
// con las cartas en la mano, que se esconde cuando se retira. Todos son originales.

import * as THREE from 'three';
import { toon, INK } from '../scene/toon.js';

const W = 640, H = 800;
export const CUT_W = 0.82, CUT_H = CUT_W * H / W;
export const CUTOUTS = ['gelatino', 'humo', 'cuatroojos', 'robot', 'nervios', 'pulpo'];
const WHITE = '#fbf6e6', LIGHT = '#fff1cf';

/* ---------- utilidades de dibujo ---------- */
function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixc(a, b, t) { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; }
function stroke(g, w = 6) { g.lineWidth = w; g.strokeStyle = INK; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
function fill(g, c) { g.fillStyle = c; g.fill(); }
function smooth(g, pts) {
  const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  g.beginPath();
  const m = mid(pts[n - 1], pts[0]);
  g.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) { const p = pts[i], q = mid(pts[i], pts[(i + 1) % n]); g.quadraticCurveTo(p[0], p[1], q[0], q[1]); }
  g.closePath();
}
function curve(g, pts, w = 6, color = INK) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) { const q = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]; g.quadraticCurveTo(pts[i][0], pts[i][1], q[0], q[1]); }
  const l = pts[pts.length - 1]; g.lineTo(l[0], l[1]);
  g.lineWidth = w; g.strokeStyle = color; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();
}
// Pieza ilustrada: base, luz de borde (arriba a la izquierda), sombra recortada, degradado suave
// hacia abajo, detalles dentro de la forma y contorno de tinta.
function part(g, pts, color, o = {}) {
  const ys = pts.map(p => p[1]), top = Math.min(...ys), bottom = Math.max(...ys);
  smooth(g, pts); fill(g, color);
  g.save(); smooth(g, pts); g.clip();
  if (o.rim !== false) {
    g.fillStyle = mixc(color.startsWith('#') ? color : '#888888', LIGHT, 0.42); g.fillRect(0, 0, W, H);
    g.translate(o.rimX ?? 7, o.rimY ?? 9); smooth(g, pts); fill(g, color); g.translate(-(o.rimX ?? 7), -(o.rimY ?? 9));
  }
  if (o.shade) { smooth(g, o.shade); fill(g, o.shadeColor || mixc(color, '#2a1a20', 0.28)); }
  const grd = g.createLinearGradient(0, top, 0, bottom);
  grd.addColorStop(0, 'rgba(40,20,15,0)'); grd.addColorStop(1, `rgba(40,20,15,${o.dark ?? 0.3})`);
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  if (o.detail) o.detail(g);
  g.restore();
  smooth(g, pts); stroke(g, o.lw || 6);
}
function circle(g, x, y, r, color, w = 5) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); fill(g, color); if (w) stroke(g, w); }
function spots(g, list, color) { for (const [x, y, r] of list) { g.beginPath(); g.ellipse(x, y, r, r * 0.8, 0.4, 0, Math.PI * 2); fill(g, color); } }
// ojo grande de pupila chiquita y párpado caído; f.blink lo cierra, f.side lo hace mirar de reojo
function eye(g, x, y, rx, ry, f, o = {}) {
  const lid = o.lid ?? 0.45, tilt = o.tilt || 0, skin = o.skin;
  const shape = () => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };
  shape(); fill(g, o.white || WHITE);
  g.save(); shape(); g.clip();
  // sombrita del párpado sobre el ojo
  g.fillStyle = 'rgba(60,40,30,0.12)'; g.fillRect(x - rx, y - ry, rx * 2, ry * 0.9);
  if (f.blink) {
    g.fillStyle = skin; g.fillRect(x - rx - 4, y - ry - 4, rx * 2 + 8, ry * 2 + 8);
    g.restore();
    curve(g, [[x - rx, y + ry * 0.05], [x, y + ry * 0.45], [x + rx, y + ry * 0.05]], 5);
  } else {
    const px = x + f.side * rx * 0.5 + (o.look || 0) * rx * 0.3, py = y + ry * 0.22, pr = Math.min(rx, ry) * (o.pupil || 0.2);
    if (o.iris) { g.beginPath(); g.arc(px, py, pr * 2, 0, Math.PI * 2); fill(g, o.iris); }
    g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); fill(g, INK);
    const ly = y - ry + 2 * ry * lid;
    if (lid > 0) {
      g.beginPath(); g.moveTo(x - rx - 4, y - ry - 4); g.lineTo(x + rx + 4, y - ry - 4); g.lineTo(x + rx + 4, ly + tilt); g.lineTo(x - rx - 4, ly - tilt); g.closePath();
      fill(g, skin);
    }
    g.restore();
    if (lid > 0) curve(g, [[x - rx, ly - tilt], [x + rx, ly + tilt]], 5.5);
  }
  shape(); stroke(g, 6);
}
function brow(g, x0, y0, x1, y1, w = 11) { curve(g, [[x0, y0], [(x0 + x1) / 2, Math.min(y0, y1) - 6], [x1, y1]], w); }
// brazo: trazo grueso con contorno, luz y sombra a lo largo
function limb(g, pts, width, color) {
  const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i++) { const q = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]; g.quadraticCurveTo(pts[i][0], pts[i][1], q[0], q[1]); } g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); };
  g.lineJoin = 'round'; g.lineCap = 'round';
  path(); g.lineWidth = width + 12; g.strokeStyle = INK; g.stroke();
  path(); g.lineWidth = width; g.strokeStyle = mixc(color, '#2a1a20', 0.25); g.stroke();
  g.save(); g.translate(-width * 0.18, -width * 0.12); path(); g.lineWidth = width * 0.62; g.strokeStyle = color; g.stroke(); g.restore();
}
// mano de caricatura (cuatro dedos) en (x, y), girada `a`; s escala
function hand(g, x, y, s, a, color, flip = 1) {
  g.save(); g.translate(x, y); g.rotate(a); g.scale(s * flip, s);
  const lw = 6 / s;
  for (const [fx, fy, fl] of [[18, -20, 26], [26, -6, 30], [26, 8, 28], [18, 20, 22]]) {
    smooth(g, [[fx - 6, fy - 7], [fx + fl, fy - 6], [fx + fl + 6, fy], [fx + fl, fy + 6], [fx - 6, fy + 7]]); fill(g, color); stroke(g, lw);
  }
  smooth(g, [[-34, -24], [10, -30], [30, -12], [30, 14], [10, 28], [-34, 24], [-42, 0]]); fill(g, color);
  g.save(); smooth(g, [[-34, -24], [10, -30], [30, -12], [30, 14], [10, 28], [-34, 24], [-42, 0]]); g.clip();
  smooth(g, [[-40, 6], [30, 2], [30, 30], [-40, 30]]); fill(g, mixc(color, '#2a1a20', 0.25)); g.restore();
  smooth(g, [[-34, -24], [10, -30], [30, -12], [30, 14], [10, 28], [-34, 24], [-42, 0]]); stroke(g, lw);
  smooth(g, [[-6, -26], [8, -46], [22, -44], [18, -26]]); fill(g, color); stroke(g, lw);
  g.restore();
}

/* ---------- personajes ---------- */
const DRAW = {
  // blob gelatinoso azul cielo con gorra de camionero, sonrisota y babitas
  gelatino(g, f) {
    const skin = '#7ec3e0';
    limb(g, [[150, 520], [110, 640], [190, 720]], 70, skin);
    limb(g, [[490, 520], [530, 640], [450, 720]], 70, skin);
    part(g, [[110, 760], [90, 600], [110, 420], [190, 270], [320, 220], [450, 270], [530, 420], [550, 600], [530, 760], [320, 780]], skin, {
      shade: [[420, 250], [560, 420], [570, 780], [440, 780], [480, 540], [430, 330]],
      detail: (c) => { spots(c, [[160, 560, 16], [470, 480, 12], [420, 640, 18], [200, 420, 10], [380, 700, 10]], '#69adcb'); },
    });
    for (const [x, y, r] of [[500, 520, 16], [130, 600, 13], [460, 650, 11], [300, 470, 9]]) {
      smooth(g, [[x, y - r * 2], [x + r, y], [x, y + r * 1.1], [x - r, y]]); fill(g, '#9fd6ea'); stroke(g, 4);
    }
    // gorra con un planetita bordado
    part(g, [[188, 290], [186, 196], [250, 142], [320, 128], [410, 146], [458, 200], [460, 290], [320, 268]], '#e9e3d4', { shade: [[380, 130], [470, 200], [470, 300], [400, 280]] });
    part(g, [[188, 290], [190, 240], [250, 236], [250, 286]], '#2f3f5c', { rim: false });
    part(g, [[392, 286], [392, 236], [458, 240], [460, 290]], '#2f3f5c', { rim: false });
    part(g, [[300, 278], [400, 262], [520, 274], [540, 300], [460, 314], [306, 306]], '#2f3f5c', { dark: 0.4 });
    circle(g, 318, 200, 34, '#7ec3e0', 5); curve(g, [[278, 206], [318, 186], [360, 192]], 5, '#c99a35');
    eye(g, 252, 370, 62, 68, f, { lid: 0.28, skin, pupil: 0.16, iris: '#e8d76a' });
    eye(g, 392, 376, 58, 64, f, { lid: 0.32, skin, pupil: 0.16, iris: '#e8d76a' });
    // sonrisa enorme con dientes y lengua
    const mouth = [[200, 490], [320, 518], [446, 486], [410, 566], [320, 596], [236, 566]];
    smooth(g, mouth); fill(g, '#4a1f24');
    g.save(); smooth(g, mouth); g.clip();
    g.fillStyle = WHITE; g.fillRect(180, 476, 290, 34);
    g.lineWidth = 3.5; g.strokeStyle = INK; for (let x = 240; x < 430; x += 34) { g.beginPath(); g.moveTo(x, 486); g.lineTo(x, 510); g.stroke(); }
    g.beginPath(); g.moveTo(180, 510); g.lineTo(470, 510); g.stroke();
    smooth(g, [[270, 600], [300, 556], [360, 552], [390, 600]]); fill(g, '#c4566a');
    g.restore(); smooth(g, mouth); stroke(g);
    hand(g, 200, 726, 1.25, -0.5, skin); hand(g, 440, 726, 1.25, Math.PI + 0.5, skin, 1);
  },

  // señora cansadísima de pelo esponjado, ojeras y cigarro entre los dedos
  humo(g, f) {
    const skin = '#e8b48f', hair = '#7a5236', top = '#4a4744';
    part(g, [[176, 160], [124, 300], [120, 470], [176, 540], [214, 380], [426, 380], [464, 540], [520, 470], [516, 300], [464, 160], [320, 96]], hair, {
      shade: [[400, 110], [530, 300], [520, 540], [460, 540], [440, 330]],
      detail: (c) => { for (const [x, y, x2, y2] of [[200, 200, 170, 360], [240, 150, 220, 300], [430, 170, 470, 360], [470, 260, 490, 420]]) curve(c, [[x, y], [(x + x2) / 2 + 12, (y + y2) / 2], [x2, y2]], 3.5); },
    });
    part(g, [[118, 800], [122, 600], [196, 520], [320, 506], [444, 520], [518, 600], [522, 800]], skin, { shade: [[400, 510], [530, 600], [530, 800], [450, 800]] });
    part(g, [[178, 800], [184, 600], [226, 540], [320, 572], [414, 540], [456, 600], [462, 800]], top, { shade: [[380, 550], [470, 600], [470, 800], [400, 800]], dark: 0.4 });
    curve(g, [[228, 544], [214, 510]], 7); curve(g, [[412, 544], [426, 510]], 7);
    part(g, [[290, 420], [350, 420], [356, 520], [284, 520]], skin, { rim: false, shade: [[322, 420], [362, 420], [362, 520], [322, 520]] });
    part(g, [[320, 186], [408, 222], [426, 330], [392, 422], [320, 448], [248, 422], [214, 330], [232, 222]], skin, {
      shade: [[380, 200], [436, 330], [400, 430], [348, 446], [396, 330]],
      detail: (c) => { c.fillStyle = 'rgba(190,90,80,0.22)'; c.beginPath(); c.ellipse(262, 362, 26, 14, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(384, 362, 26, 14, 0, 0, Math.PI * 2); c.fill(); },
    });
    part(g, [[222, 276], [244, 180], [320, 150], [400, 178], [426, 286], [386, 230], [340, 254], [296, 214], [256, 246]], hair, { shade: [[380, 160], [436, 286], [388, 236]] });
    curve(g, [[250, 190], [228, 150], [208, 140]], 6); curve(g, [[376, 162], [412, 122], [432, 124]], 6);
    eye(g, 284, 318, 32, 24, f, { lid: 0.62, skin, pupil: 0.22, tilt: 3 });
    eye(g, 366, 318, 32, 24, f, { lid: 0.62, skin, pupil: 0.22, tilt: -3 });
    curve(g, [[254, 348], [284, 360], [308, 350]], 4); curve(g, [[342, 350], [366, 360], [394, 348]], 4);
    curve(g, [[258, 362], [284, 372], [304, 366]], 3, 'rgba(29,22,17,0.5)'); curve(g, [[346, 366], [366, 372], [392, 362]], 3, 'rgba(29,22,17,0.5)');
    curve(g, [[322, 334], [312, 372], [330, 376]], 5);
    curve(g, [[292, 404], [320, 398], [350, 402]], 6);
    // brazo levantado con el cigarro y el otro sobre la mesa
    limb(g, [[470, 620], [520, 700], [470, 560], [420, 420]], 46, skin);
    hand(g, 412, 408, 0.9, -2.0, skin);
    smooth(g, [[396, 380], [470, 344], [476, 356], [402, 392]]); fill(g, '#efe4c8'); stroke(g, 4.5);
    smooth(g, [[462, 346], [480, 338], [486, 350], [468, 358]]); fill(g, '#c4482f'); stroke(g, 4.5);
    limb(g, [[170, 620], [130, 690], [220, 730]], 46, skin);
    hand(g, 232, 730, 1.0, 0.2, skin);
  },

  // alien verde de cuatro ojos anaranjados, antenas y cara de "sé que estás blofeando"
  cuatroojos(g, f) {
    const skin = '#9cc85a';
    part(g, [[150, 800], [162, 600], [236, 534], [404, 534], [478, 600], [490, 800]], '#b8a24a', { shade: [[390, 540], [490, 600], [490, 800], [410, 800]], dark: 0.35 });
    curve(g, [[250, 560], [320, 610], [390, 560]], 5);
    part(g, [[292, 470], [348, 470], [356, 550], [284, 550]], skin, { rim: false, shade: [[322, 470], [362, 470], [362, 550], [322, 550]] });
    curve(g, [[268, 170], [246, 110], [222, 70]], 9); curve(g, [[372, 170], [394, 110], [418, 70]], 9);
    circle(g, 218, 62, 19, skin, 6); circle(g, 422, 62, 19, skin, 6);
    part(g, [[320, 142], [428, 178], [466, 300], [434, 432], [320, 488], [206, 432], [174, 300], [212, 178]], skin, {
      shade: [[390, 166], [476, 300], [440, 440], [372, 480], [430, 310]],
      detail: (c) => { for (const y of [182, 200]) curve(c, [[280, y], [320, y - 8], [360, y]], 3.5); curve(c, [[236, 420], [258, 440]], 3.5); curve(c, [[404, 420], [382, 440]], 3.5); },
    });
    brow(g, 222, 236, 300, 258); brow(g, 418, 236, 340, 258);
    eye(g, 264, 282, 33, 27, f, { lid: 0.48, skin, tilt: 5, iris: '#e0883a', pupil: 0.16 });
    eye(g, 376, 282, 33, 27, f, { lid: 0.48, skin, tilt: -5, iris: '#e0883a', pupil: 0.16 });
    eye(g, 272, 352, 25, 21, f, { lid: 0.42, skin, iris: '#e0883a', pupil: 0.16 });
    eye(g, 368, 352, 25, 21, f, { lid: 0.42, skin, iris: '#e0883a', pupil: 0.16 });
    curve(g, [[300, 384], [320, 396], [340, 384]], 4);
    curve(g, [[268, 438], [320, 418], [372, 438]], 7);
    limb(g, [[176, 620], [140, 690], [250, 724]], 44, skin);
    limb(g, [[464, 620], [500, 690], [390, 724]], 44, skin);
    hand(g, 262, 724, 1.05, 0.15, skin); hand(g, 378, 724, 1.05, Math.PI - 0.15, skin, 1);
  },

  // robot de visor con una franja de luz; "parpadea" bajando la luz
  robot(g, f) {
    const metal = '#c9d1d6', dark = '#5f686a';
    part(g, [[160, 800], [172, 610], [240, 552], [400, 552], [468, 610], [480, 800]], metal, {
      shade: [[390, 560], [480, 610], [480, 800], [410, 800]],
      detail: (c) => { curve(c, [[200, 640], [440, 640]], 3.5); curve(c, [[320, 560], [320, 800]], 3.5); },
    });
    part(g, [[262, 620], [378, 620], [378, 720], [262, 720]], '#7d8a86', { rim: false });
    circle(g, 296, 656, 15, '#e3d6b8', 4.5); circle(g, 344, 656, 15, '#c4482f', 4.5);
    curve(g, [[278, 696], [362, 696]], 4.5);
    for (const x of [292, 348]) part(g, [[x - 12, 470], [x + 12, 470], [x + 12, 560], [x - 12, 560]], dark, { rim: false });
    curve(g, [[320, 180], [320, 110]], 7); circle(g, 320, 98, 16, f.blink ? '#8a6a2a' : '#f2c84a');
    part(g, [[320, 168], [432, 196], [466, 306], [438, 410], [320, 452], [202, 410], [174, 306], [208, 196]], metal, {
      shade: [[390, 186], [476, 306], [440, 420], [372, 448], [430, 310]],
    });
    smooth(g, [[196, 290], [320, 276], [444, 290], [454, 356], [320, 370], [186, 356]]); fill(g, '#24211f'); stroke(g, 6);
    const sx = 320 + f.side * 62, half = f.side ? 62 : 104;
    smooth(g, [[sx - half, 314], [sx + half, 314], [sx + half, 336], [sx - half, 336]]);
    fill(g, f.blink ? '#6b5226' : '#f2c84a');
    g.fillStyle = 'rgba(242,200,74,0.25)'; g.fillRect(sx - half - 10, 306, half * 2 + 20, 38);
    curve(g, [[280, 404], [360, 404]], 6); curve(g, [[290, 422], [350, 422]], 4.5);
    limb(g, [[180, 640], [146, 700], [252, 726]], 34, metal);
    limb(g, [[460, 640], [494, 700], [388, 726]], 34, metal);
    hand(g, 262, 724, 0.95, 0.1, '#a8b0b2'); hand(g, 378, 724, 0.95, Math.PI - 0.1, '#a8b0b2', 1);
  },

  // flaco nervioso de lentes gigantes, ojeras, barba de tres días, gota de sudor y corbata chueca
  nervios(g, f) {
    const skin = '#e8c09a', hair = '#6b4a32';
    part(g, [[160, 800], [172, 610], [240, 546], [400, 546], [468, 610], [480, 800]], '#c8c9a0', {
      shade: [[390, 552], [478, 610], [480, 800], [410, 800]],
      detail: (c) => { c.fillStyle = 'rgba(140,120,60,0.35)'; c.beginPath(); c.ellipse(230, 690, 26, 18, 0.3, 0, Math.PI * 2); c.fill(); curve(c, [[250, 560], [300, 600]], 3.5); curve(c, [[390, 560], [340, 600]], 3.5); },
    });
    part(g, [[310, 556], [330, 556], [352, 700], [322, 740], [296, 696]], '#a4452f', { rim: false });
    part(g, [[294, 470], [346, 470], [350, 556], [290, 556]], skin, { rim: false, shade: [[322, 470], [356, 470], [356, 556], [322, 556]] });
    part(g, [[320, 188], [404, 214], [430, 316], [410, 418], [320, 466], [230, 418], [210, 316], [236, 214]], skin, {
      shade: [[378, 206], [440, 316], [414, 426], [362, 460], [406, 316]],
      detail: (c) => { c.fillStyle = 'rgba(80,60,50,0.35)'; for (let i = 0; i < 40; i++) { const a = (i * 2.399) % Math.PI, r = 70 + ((i * 37) % 30); c.fillRect(320 + Math.cos(a) * r * 0.9, 380 + Math.sin(a) * r * 0.55, 2.5, 2.5); } }, // barba de tres días (fija entre cuadros)
    });
    part(g, [[214, 264], [206, 186], [266, 138], [360, 130], [426, 172], [432, 258], [400, 206], [364, 226], [326, 192], [284, 226], [250, 202]], hair, { shade: [[370, 130], [436, 176], [432, 258], [400, 206]] });
    eye(g, 276, 330, 27, 27, f, { lid: 0.12, skin, pupil: 0.28 });
    eye(g, 364, 330, 27, 27, f, { lid: 0.12, skin, pupil: 0.28 });
    curve(g, [[252, 362], [276, 370], [300, 362]], 3.5, 'rgba(90,50,60,0.6)'); curve(g, [[340, 362], [364, 370], [388, 362]], 3.5, 'rgba(90,50,60,0.6)');
    g.lineWidth = 9; g.strokeStyle = INK;
    for (const x of [236, 324]) { g.beginPath(); g.roundRect(x, 290, 80, 80, 20); g.stroke(); }
    curve(g, [[316, 318], [324, 312]], 8); curve(g, [[236, 316], [214, 308]], 8); curve(g, [[404, 316], [428, 308]], 8);
    smooth(g, [[430, 250], [444, 284], [430, 296], [416, 284]]); fill(g, '#b9dbe6'); stroke(g, 4);
    // boca abierta de susto con dientitos
    const mouth = [[282, 414], [320, 402], [360, 414], [350, 438], [320, 446], [290, 438]];
    smooth(g, mouth); fill(g, '#4a1f24'); g.save(); smooth(g, mouth); g.clip(); g.fillStyle = WHITE; g.fillRect(280, 400, 80, 16); g.restore(); smooth(g, mouth); stroke(g, 5);
    limb(g, [[184, 640], [152, 700], [256, 724]], 38, skin);
    limb(g, [[456, 640], [488, 700], [384, 724]], 38, skin);
    hand(g, 266, 724, 0.95, 0.1, skin); hand(g, 374, 724, 0.95, Math.PI - 0.1, skin, 1);
  },

  // pulpo gruñón morado de chaleco, con los tentáculos regados sobre la mesa
  pulpo(g, f) {
    const skin = '#b07cc6';
    part(g, [[130, 800], [142, 600], [226, 534], [414, 534], [498, 600], [510, 800]], '#7a5232', {
      shade: [[400, 540], [508, 600], [510, 800], [420, 800]], dark: 0.4,
      detail: (c) => { curve(c, [[320, 540], [320, 800]], 4); for (const y of [620, 680]) { circle(c, 300, y, 7, '#c99a35', 3); } },
    });
    part(g, [[320, 110], [452, 146], [504, 280], [462, 410], [320, 452], [178, 410], [136, 280], [188, 146]], skin, {
      shade: [[410, 136], [512, 280], [468, 420], [384, 448], [446, 296]],
      detail: (c) => { spots(c, [[226, 186, 16], [400, 200, 12], [190, 270, 10], [430, 136, 9], [350, 160, 8], [260, 140, 7]], '#9a64b0'); },
    });
    brow(g, 210, 270, 296, 302, 13); brow(g, 430, 270, 344, 302, 13);
    eye(g, 262, 330, 38, 30, f, { lid: 0.5, skin, tilt: 7, iris: '#e8c84a', pupil: 0.15 });
    eye(g, 378, 330, 38, 30, f, { lid: 0.5, skin, tilt: -7, iris: '#e8c84a', pupil: 0.15 });
    // tentáculos: trazo grueso de tinta, color y luz encima
    const tents = [[[240, 428], [170, 540], [110, 660], [150, 730], [200, 712]], [[286, 446], [268, 590], [236, 740]], [[354, 446], [372, 590], [410, 740]], [[400, 428], [470, 540], [530, 660], [490, 730], [440, 712]]];
    for (const t of tents) limb(g, t, 48, skin);
    for (const t of tents) for (let i = 1; i < t.length; i++) circle(g, (t[i - 1][0] + t[i][0]) / 2 + 8, (t[i - 1][1] + t[i][1]) / 2 + 4, 6, '#e0c4ec', 3);
  },
};

// Cartas en la mano: dos reversos en abanico con un pulgar encima (capa aparte, se esconde al retirarse).
const HOLD = {
  gelatino: [320, 720, 1.0], humo: [270, 716, 0.95], cuatroojos: [320, 716, 1.0],
  robot: [320, 712, 1.0], nervios: [320, 706, 1.05], pulpo: [320, 690, 1.05],
};
const SKIN = { gelatino: '#7ec3e0', humo: '#e8b48f', cuatroojos: '#9cc85a', robot: '#a8b0b2', nervios: '#e8c09a', pulpo: '#b07cc6' };
function drawHeld(g, type) {
  const [x, y, s] = HOLD[type];
  for (const [dx, a] of [[-26, -0.22], [26, 0.18]]) {
    g.save(); g.translate(x + dx * s, y); g.rotate(a); g.scale(s, s);
    smooth(g, [[-40, -64], [40, -64], [44, -60], [44, 60], [40, 64], [-40, 64], [-44, 60], [-44, -60]]); fill(g, '#2f3f5c'); stroke(g, 6);
    g.beginPath(); g.roundRect(-32, -52, 64, 104, 8); g.lineWidth = 4; g.strokeStyle = '#efe4c8'; g.stroke();
    g.beginPath(); g.arc(0, -4, 18, 0, Math.PI * 2); fill(g, '#e0b552'); stroke(g, 4);
    g.restore();
  }
  hand(g, x - 6, y + 40, 0.75 * s, -1.4, SKIN[type]);
}

/* ---------- texturas y escena ---------- */
function canvasTexture(draw) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const textures = new Map();
function texturesFor(type) {
  if (!textures.has(type)) {
    const frames = [{ blink: false, side: 0 }, { blink: true, side: 0 }, { blink: false, side: 1 }].map(f => canvasTexture(g => DRAW[type](g, f)));
    textures.set(type, { frames, held: canvasTexture(g => drawHeld(g, type)) });
  }
  return textures.get(type);
}
// punto del cigarro (para el humo), en coordenadas del canvas
export const SMOKE_AT = { humo: [484, 344] };

const plane = new THREE.PlaneGeometry(CUT_W, CUT_H).translate(0, CUT_H / 2, 0);

// Un rival recortado. El origen queda en la orilla de abajo del cartón.
export function makeCutout(seat) {
  const type = CUTOUTS[seat % CUTOUTS.length];
  const { frames, held } = texturesFor(type);
  const mat = toon('#ffffff', { map: frames[0], alphaTest: 0.5 });
  const m = new THREE.Mesh(plane, mat);
  const cards = new THREE.Mesh(plane, toon('#ffffff', { map: held, alphaTest: 0.5 }));
  cards.position.z = 0.004;
  const group = new THREE.Group();
  group.add(m, cards);
  const rnd = (a, b) => a + Math.random() * (b - a);
  let nextBlink = rnd(1, 4), blinkEnd = -1, sideUntil = -1, nextSide = rnd(5, 12);
  return {
    type, group, mesh: m, cards,
    // movimientos secos: respirar, parpadear y de vez en cuando mirar de reojo
    tick(t, calm) {
      if (t > nextBlink) { blinkEnd = t + 0.13; nextBlink = t + rnd(2.5, 6); }
      if (t > nextSide) { sideUntil = t + rnd(1, 2); nextSide = t + rnd(7, 15); }
      const want = t < blinkEnd ? frames[1] : t < sideUntil ? frames[2] : frames[0];
      if (mat.map !== want) mat.map = want;
      const breathe = calm ? 1 : 1 + Math.sin(t * 1.3 + seat) * 0.007;
      m.scale.y = breathe; cards.scale.y = breathe;
      m.rotation.z = calm ? 0 : Math.sin(t * 0.4 + seat * 2) * 0.01;
    },
    smokeAt() {
      const p = SMOKE_AT[type];
      return p ? new THREE.Vector3((p[0] / W - 0.5) * CUT_W, (1 - p[1] / H) * CUT_H, 0.01) : null;
    },
  };
}

/* ---------- mi mano sosteniendo las cartas ---------- */
function handCanvas(front) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const skin = '#e8b48f';
  if (!front) {
    part(g, [[300, 150], [360, 120], [420, 140], [440, 190], [420, 260], [360, 300], [300, 280]], skin, { shade: [[380, 140], [450, 190], [420, 270], [390, 260]] });
    for (const [x, y] of [[360, 132], [400, 160], [420, 210]]) curve(g, [[x - 30, y + 10], [x, y]], 4);
    part(g, [[0, 512], [0, 380], [120, 300], [240, 250], [320, 270], [340, 330], [260, 420], [150, 512]], skin, { shade: [[200, 380], [340, 330], [260, 430], [180, 512]] });
    part(g, [[0, 512], [0, 420], [80, 380], [170, 450], [130, 512]], '#2f3f5c', { shade: [[100, 420], [170, 450], [130, 512], [90, 512]] });
  } else {
    part(g, [[150, 380], [190, 320], [250, 280], [292, 272], [306, 296], [270, 330], [220, 380], [190, 410]], skin, { shade: [[240, 330], [300, 290], [270, 340], [220, 390]] });
    curve(g, [[268, 284], [284, 300]], 3.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function makeHand() {
  const size = 0.3;
  const geo = new THREE.PlaneGeometry(size, size);
  const back = new THREE.Mesh(geo, toon('#ffffff', { map: handCanvas(false), alphaTest: 0.5, pool: false }));
  const front = new THREE.Mesh(geo, toon('#ffffff', { map: handCanvas(true), alphaTest: 0.5, pool: false }));
  return { back, front, size };
}
