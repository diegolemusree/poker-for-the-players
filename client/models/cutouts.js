// Rivales como recortes 2D de serie animada: cada personaje se dibuja a mano en un canvas
// (contorno de tinta, color plano y una sola sombra) y se pone en la escena como un cartón
// que siempre mira a la cámara, recargado en la mesa. Se pintan tres cuadros por personaje
// (ojos abiertos, parpadeo y mirada de reojo) y se alternan con movimientos secos y sutiles.
// Todos son originales.

import * as THREE from 'three';
import { toon, INK } from '../scene/toon.js';

const W = 512, H = 640;
export const CUT_W = 0.6, CUT_H = CUT_W * H / W;
export const CUTOUTS = ['gelatino', 'humo', 'cuatroojos', 'robot', 'nervios', 'pulpo'];
const WHITE = '#fbf6e6';

/* ---------- utilidades de dibujo ---------- */
function stroke(g, w = 5) { g.lineWidth = w; g.strokeStyle = INK; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
function fill(g, c) { g.fillStyle = c; g.fill(); }
// curva cerrada y suave que pasa cerca de los puntos
function smooth(g, pts) {
  const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  g.beginPath();
  const m = mid(pts[n - 1], pts[0]);
  g.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) { const p = pts[i], q = mid(pts[i], pts[(i + 1) % n]); g.quadraticCurveTo(p[0], p[1], q[0], q[1]); }
  g.closePath();
}
// línea abierta y suave
function curve(g, pts, w = 5) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) { const q = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]; g.quadraticCurveTo(pts[i][0], pts[i][1], q[0], q[1]); }
  const l = pts[pts.length - 1]; g.lineTo(l[0], l[1]);
  stroke(g, w);
}
// pieza con color, una sombra plana recortada a su forma y su contorno
function part(g, pts, color, shade, shadePts) {
  smooth(g, pts); fill(g, color);
  if (shade) { g.save(); smooth(g, pts); g.clip(); smooth(g, shadePts); fill(g, shade); g.restore(); }
  smooth(g, pts); stroke(g);
}
function circle(g, x, y, r, color, w = 5) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); fill(g, color); if (w) stroke(g, w); }
// ojo grande de pupila chiquita y párpado caído; f.blink lo cierra, f.side lo hace mirar de reojo
function eye(g, x, y, rx, ry, f, o = {}) {
  const lid = o.lid ?? 0.45, tilt = o.tilt || 0, skin = o.skin;
  const shape = () => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };
  shape(); fill(g, WHITE);
  g.save(); shape(); g.clip();
  if (f.blink) {
    g.fillStyle = skin; g.fillRect(x - rx - 4, y - ry - 4, rx * 2 + 8, ry * 2 + 8);
    g.restore();
    curve(g, [[x - rx, y + ry * 0.05], [x, y + ry * 0.45], [x + rx, y + ry * 0.05]], 4);
  } else {
    const px = x + f.side * rx * 0.5 + (o.look || 0) * rx * 0.3, py = y + ry * 0.22;
    g.beginPath(); g.arc(px, py, Math.min(rx, ry) * (o.pupil || 0.2), 0, Math.PI * 2); fill(g, INK);
    const ly = y - ry + 2 * ry * lid;
    if (lid > 0) {
      g.beginPath(); g.moveTo(x - rx - 4, y - ry - 4); g.lineTo(x + rx + 4, y - ry - 4); g.lineTo(x + rx + 4, ly + tilt); g.lineTo(x - rx - 4, ly - tilt); g.closePath();
      fill(g, skin);
    }
    g.restore();
    if (lid > 0) curve(g, [[x - rx, ly - tilt], [x + rx, ly + tilt]], 4.5);
  }
  shape(); stroke(g, 5);
}
function brow(g, x0, y0, x1, y1) { curve(g, [[x0, y0], [(x0 + x1) / 2, Math.min(y0, y1) - 4], [x1, y1]], 9); }

/* ---------- personajes ---------- */
const DRAW = {
  // blob gelatinoso azul grisáceo con gorra de camionero, muy sonriente para ser alguien que va perdiendo
  gelatino(g, f) {
    const skin = '#7aa7b5', shade = '#6290a0';
    part(g, [[80, 600], [70, 470], [80, 330], [150, 205], [256, 168], [362, 205], [432, 330], [442, 470], [432, 600], [256, 610]], skin, shade,
      [[330, 190], [455, 330], [470, 640], [370, 640], [395, 420], [350, 250]]);
    for (const [x, y, r] of [[410, 420, 14], [104, 470, 11], [380, 520, 9]]) {
      smooth(g, [[x, y - r * 1.8], [x + r, y], [x, y + r], [x - r, y]]); fill(g, shade); stroke(g, 3.5);
    }
    // gorra
    part(g, [[150, 222], [150, 150], [200, 112], [256, 102], [330, 116], [366, 160], [366, 222], [256, 205]], '#e3d6b8', '#cbbd9c', [[300, 100], [380, 150], [380, 230], [320, 214]]);
    part(g, [[255, 210], [330, 196], [430, 205], [445, 225], [380, 236], [262, 232]], '#a4452f');
    circle(g, 252, 162, 26, '#c99a35', 4.5);
    curve(g, [[222, 168], [252, 152], [284, 156]], 4);
    eye(g, 204, 285, 48, 54, f, { lid: 0.32, skin, pupil: 0.2 });
    eye(g, 312, 290, 46, 52, f, { lid: 0.36, skin, pupil: 0.2 });
    // sonrisa enorme con dientes
    const mouth = [[168, 384], [256, 404], [348, 380], [318, 440], [256, 462], [196, 440]];
    smooth(g, mouth); fill(g, '#4a2a24');
    g.save(); smooth(g, mouth); g.clip(); g.fillStyle = WHITE; g.fillRect(150, 370, 220, 28);
    g.lineWidth = 3; g.strokeStyle = INK; for (let x = 196; x < 340; x += 28) { g.beginPath(); g.moveTo(x, 380); g.lineTo(x, 400); g.stroke(); }
    g.beginPath(); g.moveTo(150, 398); g.lineTo(370, 398); g.stroke();
    g.restore(); smooth(g, mouth); stroke(g);
    // bracitos sobre la mesa
    part(g, [[90, 540], [60, 600], [80, 640], [190, 640], [175, 590], [130, 560]], skin, shade, [[60, 610], [190, 625], [190, 660], [60, 660]]);
    part(g, [[422, 540], [452, 600], [432, 640], [322, 640], [337, 590], [382, 560]], skin, shade, [[322, 610], [452, 625], [452, 660], [322, 660]]);
  },

  // señora cansadísima, fleco despeinado, ojeras y cigarro en la boca
  humo(g, f) {
    const skin = '#d9a988', sh = '#c4906f', hair = '#6b4a32', hairSh = '#57392a';
    part(g, [[156, 146], [118, 270], [128, 400], [176, 436], [204, 300], [308, 300], [336, 436], [384, 400], [394, 270], [356, 146], [256, 92]], hair, hairSh, [[300, 100], [400, 270], [380, 440], [330, 440], [330, 280]]);
    part(g, [[118, 640], [124, 480], [176, 414], [256, 402], [336, 414], [388, 480], [394, 640]], skin, sh, [[300, 400], [400, 480], [400, 640], [340, 640]]);
    part(g, [[166, 640], [172, 480], [206, 428], [256, 452], [306, 428], [340, 480], [346, 640]], '#6f7a3c', '#5d6732', [[290, 440], [350, 480], [350, 640], [300, 640]]);
    curve(g, [[206, 430], [196, 410]], 6); curve(g, [[306, 430], [316, 410]], 6);
    part(g, [[232, 330], [280, 330], [284, 410], [228, 410]], skin, sh, [[262, 330], [290, 330], [290, 410], [262, 410]]);
    part(g, [[256, 150], [326, 178], [340, 262], [312, 334], [256, 354], [200, 334], [172, 262], [186, 178]], skin, sh, [[300, 160], [350, 262], [320, 340], [276, 352], [314, 262]]);
    part(g, [[176, 214], [194, 142], [256, 118], [322, 142], [342, 222], [306, 180], [270, 200], [236, 172], [206, 196]], hair, hairSh, [[300, 130], [350, 222], [306, 186]]);
    curve(g, [[200, 150], [184, 120], [170, 112]], 5); curve(g, [[300, 128], [330, 98], [346, 100]], 5);
    eye(g, 224, 252, 25, 19, f, { lid: 0.62, skin, pupil: 0.24, tilt: 2 });
    eye(g, 290, 252, 25, 19, f, { lid: 0.62, skin, pupil: 0.24, tilt: -2 });
    curve(g, [[204, 276], [224, 284], [242, 278]], 3); curve(g, [[270, 278], [290, 284], [308, 276]], 3);
    curve(g, [[258, 266], [250, 296], [264, 298]], 4.5);
    curve(g, [[234, 320], [256, 316], [280, 318]], 5);
    // cigarro con la brasa
    smooth(g, [[276, 314], [346, 296], [349, 307], [279, 325]]); fill(g, '#efe4c8'); stroke(g, 4);
    smooth(g, [[338, 298], [354, 294], [357, 305], [341, 309]]); fill(g, '#a4452f'); stroke(g, 4);
    part(g, [[128, 520], [98, 600], [116, 640], [196, 640], [176, 575]], skin, sh, [[98, 615], [196, 625], [196, 660], [98, 660]]);
    part(g, [[384, 520], [414, 600], [396, 640], [316, 640], [336, 575]], skin, sh, [[316, 615], [414, 625], [414, 660], [316, 660]]);
  },

  // alien verde de cuatro ojos y antenas, con cara de "ya sé que estás blofeando"
  cuatroojos(g, f) {
    const skin = '#8fae5a', sh = '#789549';
    part(g, [[128, 640], [140, 476], [204, 424], [308, 424], [372, 476], [384, 640]], '#c9a03a', '#ad8a2e', [[300, 430], [380, 480], [384, 640], [320, 640]]);
    part(g, [[234, 380], [278, 380], [284, 440], [228, 440]], skin, sh, [[262, 380], [290, 380], [290, 440], [262, 440]]);
    curve(g, [[222, 148], [206, 104], [190, 72]], 7); curve(g, [[290, 148], [306, 104], [322, 72]], 7);
    circle(g, 188, 66, 15, skin); circle(g, 324, 66, 15, skin);
    part(g, [[256, 120], [342, 150], [372, 250], [346, 352], [256, 396], [166, 352], [140, 250], [170, 150]], skin, sh, [[310, 140], [380, 250], [350, 360], [290, 390], [340, 260]]);
    brow(g, 186, 186, 240, 200); brow(g, 326, 186, 272, 200);
    eye(g, 214, 222, 27, 22, f, { lid: 0.5, skin, tilt: 4 });
    eye(g, 298, 222, 27, 22, f, { lid: 0.5, skin, tilt: -4 });
    eye(g, 222, 286, 20, 17, f, { lid: 0.45, skin });
    eye(g, 290, 286, 20, 17, f, { lid: 0.45, skin });
    curve(g, [[218, 350], [256, 334], [294, 350]], 5.5);
    // brazos cruzados sobre la mesa
    part(g, [[120, 600], [150, 560], [320, 575], [392, 600], [380, 640], [130, 640]], skin, sh, [[120, 625], [392, 625], [392, 660], [120, 660]]);
    part(g, [[150, 585], [180, 548], [380, 585], [372, 622], [250, 610]], skin, sh, [[300, 600], [380, 600], [380, 640], [300, 640]]);
  },

  // robot de visor con un foquito de antena; "parpadea" bajando la luz del visor
  robot(g, f) {
    const metal = '#a8b0b2', sh = '#8d9597';
    part(g, [[138, 640], [150, 484], [204, 444], [308, 444], [362, 484], [374, 640]], metal, sh, [[300, 450], [370, 490], [374, 640], [320, 640]]);
    part(g, [[208, 504], [304, 504], [304, 586], [208, 586]], '#7d8a86');
    circle(g, 234, 532, 13, '#e3d6b8', 4); circle(g, 278, 532, 13, '#a4452f', 4);
    curve(g, [[222, 566], [290, 566]], 4);
    for (const x of [234, 278]) { smooth(g, [[x - 9, 384], [x + 9, 384], [x + 9, 450], [x - 9, 450]]); fill(g, '#7d8a86'); stroke(g, 4); }
    curve(g, [[256, 156], [256, 96]], 6); circle(g, 256, 88, 13, f.blink ? '#8a6a2a' : '#e0b552');
    part(g, [[256, 148], [344, 172], [370, 258], [350, 340], [256, 372], [162, 340], [142, 258], [168, 172]], metal, sh, [[310, 160], [378, 258], [350, 350], [300, 366], [338, 260]]);
    smooth(g, [[160, 236], [256, 226], [352, 236], [360, 288], [256, 298], [152, 288]]); fill(g, '#2b2622'); stroke(g, 5);
    const sx = 256 + f.side * 50;
    smooth(g, [[sx - (f.side ? 50 : 82), 254], [sx + (f.side ? 50 : 82), 254], [sx + (f.side ? 50 : 82), 270], [sx - (f.side ? 50 : 82), 270]]);
    fill(g, f.blink ? '#6b5226' : '#e0b552');
    curve(g, [[222, 330], [290, 330]], 5); curve(g, [[230, 344], [282, 344]], 4);
    part(g, [[140, 530], [110, 600], [130, 640], [200, 640], [186, 580]], metal, sh, [[110, 615], [200, 625], [200, 660], [110, 660]]);
    part(g, [[372, 530], [402, 600], [382, 640], [312, 640], [326, 580]], metal, sh, [[312, 615], [402, 625], [402, 660], [312, 660]]);
  },

  // flaco nervioso de lentes gigantes, gota de sudor y corbata chueca
  nervios(g, f) {
    const skin = '#e2b996', sh = '#cfa27e', hair = '#6b4a32';
    part(g, [[138, 640], [150, 484], [204, 434], [308, 434], [362, 484], [374, 640]], '#d8c9a3', '#c2b28c', [[300, 440], [370, 490], [374, 640], [320, 640]]);
    part(g, [[248, 444], [264, 444], [282, 560], [258, 596], [236, 556]], '#a4452f', '#8a3826', [[262, 444], [282, 560], [262, 596]]);
    part(g, [[236, 370], [276, 370], [280, 444], [232, 444]], skin, sh, [[262, 370], [284, 370], [284, 444], [262, 444]]);
    part(g, [[256, 152], [324, 172], [344, 252], [330, 334], [256, 372], [182, 334], [168, 252], [188, 172]], skin, sh, [[304, 166], [350, 252], [330, 340], [290, 366], [326, 252]]);
    part(g, [[172, 210], [166, 146], [214, 108], [290, 102], [342, 136], [346, 206], [320, 166], [292, 182], [262, 156], [228, 182], [200, 162]], hair, '#57392a', [[300, 100], [350, 140], [346, 206], [320, 166]]);
    eye(g, 222, 262, 21, 21, f, { lid: 0.12, skin, pupil: 0.3 });
    eye(g, 292, 262, 21, 21, f, { lid: 0.12, skin, pupil: 0.3 });
    g.lineWidth = 7; g.strokeStyle = INK;
    for (const x of [190, 260]) { g.beginPath(); g.roundRect(x, 230, 62, 62, 16); g.stroke(); }
    curve(g, [[252, 254], [260, 250]], 6); curve(g, [[190, 252], [172, 246]], 6); curve(g, [[322, 252], [342, 246]], 6);
    smooth(g, [[342, 196], [352, 222], [342, 232], [332, 222]]); fill(g, '#b9cfd6'); stroke(g, 3.5);
    curve(g, [[224, 334], [240, 326], [256, 336], [272, 326], [288, 334]], 4.5);
    part(g, [[140, 530], [110, 600], [130, 640], [200, 640], [186, 580]], skin, sh, [[110, 615], [200, 625], [200, 660], [110, 660]]);
    part(g, [[372, 530], [402, 600], [382, 640], [312, 640], [326, 580]], skin, sh, [[312, 615], [402, 625], [402, 660], [312, 660]]);
  },

  // pulpo gruñón de chaleco, con los tentáculos regados por la mesa
  pulpo(g, f) {
    const skin = '#9a7088', sh = '#845d74';
    part(g, [[108, 640], [120, 476], [192, 424], [320, 424], [392, 476], [404, 640]], '#6a4530', '#57392a', [[300, 430], [400, 480], [404, 640], [330, 640]]);
    curve(g, [[256, 430], [256, 640]], 4);
    part(g, [[256, 108], [372, 140], [416, 250], [382, 362], [256, 398], [130, 362], [96, 250], [140, 140]], skin, sh, [[330, 130], [420, 250], [380, 370], [310, 392], [370, 260]]);
    for (const [x, y, r] of [[180, 160, 12], [330, 175, 9], [150, 230, 8], [360, 120, 7], [300, 140, 6]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); fill(g, sh); }
    brow(g, 172, 228, 238, 252); brow(g, 340, 228, 274, 252);
    eye(g, 210, 278, 30, 24, f, { lid: 0.5, skin, tilt: 6 });
    eye(g, 302, 278, 30, 24, f, { lid: 0.5, skin, tilt: -6 });
    // tentáculos: trazo grueso de tinta y encima el color
    const tents = [[[200, 372], [150, 470], [96, 570], [70, 630]], [[236, 388], [222, 500], [186, 630]], [[276, 388], [292, 500], [330, 630]], [[312, 372], [372, 470], [424, 560], [452, 620]]];
    for (const t of tents) {
      g.beginPath(); g.moveTo(t[0][0], t[0][1]);
      for (let i = 1; i < t.length; i++) g.lineTo(t[i][0], t[i][1]);
      g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = 46; g.strokeStyle = INK; g.stroke(); g.lineWidth = 36; g.strokeStyle = skin; g.stroke();
    }
    for (const t of tents) for (let i = 1; i < t.length; i++) { circle(g, (t[i - 1][0] + t[i][0]) / 2 + 6, (t[i - 1][1] + t[i][1]) / 2, 5, '#c8a6b6', 3); }
  },
};

/* ---------- texturas y escena ---------- */
const textures = new Map();
function texturesFor(type) {
  if (textures.has(type)) return textures.get(type);
  const frames = [{ blink: false, side: 0 }, { blink: true, side: 0 }, { blink: false, side: 1 }].map(f => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    DRAW[type](c.getContext('2d'), f);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
  textures.set(type, frames);
  return frames;
}
// punto del cigarro (para el humo), en coordenadas del canvas
export const SMOKE_AT = { humo: [356, 298] };

const plane = new THREE.PlaneGeometry(CUT_W, CUT_H).translate(0, CUT_H / 2, 0);

// Un rival recortado. El origen queda en la orilla de abajo del cartón (a la altura de la mesa).
export function makeCutout(seat) {
  const type = CUTOUTS[seat % CUTOUTS.length];
  const frames = texturesFor(type);
  const mat = toon('#ffffff', { map: frames[0], alphaTest: 0.5 });
  const m = new THREE.Mesh(plane, mat);
  const group = new THREE.Group();
  group.add(m);
  const rnd = (a, b) => a + Math.random() * (b - a);
  let nextBlink = rnd(1, 4), blinkEnd = -1, sideUntil = -1, nextSide = rnd(5, 12);
  return {
    type, group, mesh: m,
    // movimientos secos: respirar, parpadear y de vez en cuando mirar de reojo
    tick(t, calm) {
      if (t > nextBlink) { blinkEnd = t + 0.13; nextBlink = t + rnd(2.5, 6); }
      if (t > nextSide) { sideUntil = t + rnd(1, 2); nextSide = t + rnd(7, 15); }
      const want = t < blinkEnd ? frames[1] : t < sideUntil ? frames[2] : frames[0];
      if (mat.map !== want) mat.map = want;
      m.scale.y = calm ? 1 : 1 + Math.sin(t * 1.3 + seat) * 0.007;
      m.rotation.z = calm ? 0 : Math.sin(t * 0.4 + seat * 2) * 0.012;
    },
    // posición del cigarro en el espacio local del cartón
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
  const skin = '#d9a988', sh = '#c4906f';
  if (!front) {
    // dedos detrás de las cartas y la palma, con la manga
    part(g, [[300, 150], [360, 120], [420, 140], [440, 190], [420, 260], [360, 300], [300, 280]], skin, sh, [[380, 140], [450, 190], [420, 270], [390, 260]]);
    for (const [x, y] of [[360, 132], [400, 160], [420, 210]]) curve(g, [[x - 30, y + 10], [x, y]], 4);
    part(g, [[0, 512], [0, 380], [120, 300], [240, 250], [320, 270], [340, 330], [260, 420], [150, 512]], skin, sh, [[200, 380], [340, 330], [260, 430], [180, 512]]);
    part(g, [[0, 512], [0, 420], [80, 380], [170, 450], [130, 512]], '#2f3f5c', '#26334b', [[100, 420], [170, 450], [130, 512], [90, 512]]);
  } else {
    // el pulgar encima de las cartas
    part(g, [[150, 380], [190, 320], [250, 280], [292, 272], [306, 296], [270, 330], [220, 380], [190, 410]], skin, sh, [[240, 330], [300, 290], [270, 340], [220, 390]]);
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
