// Lo que va sobre el fieltro, dibujado en perspectiva con el mismo estilo de la mesa:
// pilas de fichas por denominación (con franjas en el canto y el valor en la ficha de arriba),
// cartas, y el botón del dealer. Cada cosa lleva una sola sombra plana y contorno de tinta.

import { CHIPS, stackBreakdown, chipInfo } from '../chips.js';
import { cardImage, roundRect, CARD_PX } from './cards.js';
import { INK } from './table.js';
import { mulberry } from './projection.js';

// medidas en unidades de la mesa (la mesa es grande: radio 1 hasta los lados)
export const CHIP_R = 0.027, CHIP_H = 0.008;
export const CARD_W = 0.1, CARD_H = 0.143;
const PER_COLUMN = 12, GAP = CHIP_R * 2 + 0.005;
const INLAY = { 1000: '#ddb760', 500: '#4d5d78', 100: '#4a423b', 50: '#bd6a52', 25: '#8b955a', 10: '#cbbd9c' };
const STRIPE = { 10: '#a4452f' };
const SHADOW = 'rgba(14,20,8,0.34)';
const NUM = '"Chewy", "Marker Felt", "Comic Sans MS", cursive';
const shade = (hex, k) => { // mismo color un poco más oscuro (la sombra plana del canto)
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.round(c * k).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
};
const SIDE = Object.fromEntries(CHIPS.map(c => [c.value, shade(c.color, 0.78)]));

// Columnas de una pila: `amount` sobre `at`, columnas a lo largo de `across`, filas hacia `back`.
// `messy`: un montón desordenado (el bote), con las columnas regadas y de distintas alturas.
function stackColumns(amount, at, across, back, seed, messy) {
  const cols = [];
  for (const c of stackBreakdown(amount).chips) {
    for (let left = c.count; left > 0; left -= PER_COLUMN) cols.push({ value: c.value, n: Math.min(PER_COLUMN, left) });
  }
  const rnd = mulberry(seed * 9973 + Math.round(amount));
  if (messy) { // se parten las columnas altas y se riegan alrededor de `at`, como fichas aventadas
    const loose = [];
    for (const c of cols) for (let left = c.n; left > 0;) { const k = Math.min(left, 2 + Math.floor(rnd() * 6)); loose.push({ value: c.value, n: k }); left -= k; }
    cols.length = 0; cols.push(...loose);
  }
  const perRow = Math.min(messy ? 6 : 5, cols.length);
  cols.forEach((col, i) => {
    const row = Math.floor(i / perRow), k = i % perRow;
    const inRow = Math.min(perRow, cols.length - row * perRow);
    const j = messy ? 0.03 : 0.004, rows = Math.ceil(cols.length / perRow);
    const u = (k - (inRow - 1) / 2) * GAP * (messy ? 0.85 : 1) + (rnd() - 0.5) * j;
    const w = (messy ? (row - (rows - 1) / 2) * GAP * 0.8 : row * GAP * 0.95) + (rnd() - 0.5) * j;
    col.x = at.x + across.x * u + back.x * w;
    col.z = at.z + across.z * u + back.z * w;
  });
  return cols;
}

// Dónde caen sobre la mesa las columnas de una pila (el aro de turno la rodea).
export const stackFootprint = it => stackColumns(it.amount, it.at, it.across, it.back, it.seed, it.messy);

// Una columna de `col.n` fichas de `col.value` sobre (col.x, col.z); `col.y`: a qué altura empieza (0, sobre el fieltro;
// más, en el aire: la ficha que brinca de mi mano, en arms.js).
export function chipColumn(g, v, col, line) {
  const info = chipInfo(col.value), y0 = col.y || 0;
  const b = v.project(col.x, y0, col.z), t = v.project(col.x, y0 + col.n * CHIP_H, col.z);
  const rx = CHIP_R * b.s;
  const ry = Math.abs(v.project(col.x, y0, col.z + CHIP_R).y - v.project(col.x, y0, col.z - CHIP_R).y) / 2;
  const dh = (b.y - t.y) / col.n;
  const stripe = STRIPE[col.value] || '#e3d6b8';
  for (let j = 0; j < col.n; j++) {
    const yb = b.y - j * dh, yt = yb - dh;
    // canto: entre la mitad de abajo de la ficha y la mitad de abajo de su cara de arriba
    g.beginPath();
    g.moveTo(b.x + rx, yt); g.lineTo(b.x + rx, yb);
    g.ellipse(b.x, yb, rx, ry, 0, 0, Math.PI);
    g.lineTo(b.x - rx, yt);
    g.ellipse(b.x, yt, rx, ry, 0, Math.PI, 0, true);
    g.fillStyle = SIDE[col.value]; g.fill();
    g.fillStyle = stripe;
    for (const a of [-1.05, -0.35, 0.35, 1.05]) {
      const x = b.x + rx * Math.sin(a), w = rx * 0.2 * Math.cos(a), oy = ry * Math.cos(a);
      g.fillRect(x - w / 2, yt + oy, w, dh * 0.92);
    }
    g.beginPath(); g.ellipse(b.x, yb, rx, ry, 0, 0.12, Math.PI - 0.12);
    g.lineWidth = line * 0.55; g.strokeStyle = INK; g.stroke();
  }
  // cara de arriba con el valor rotulado
  const yt = b.y - col.n * dh;
  g.beginPath(); g.ellipse(b.x, yt, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = info.color; g.fill();
  g.beginPath(); g.ellipse(b.x, yt, rx * 0.62, ry * 0.62, 0, 0, Math.PI * 2);
  g.fillStyle = INLAY[col.value]; g.fill();
  if (rx > 6) {
    const text = col.value >= 1000 ? '1K' : String(col.value);
    const dark = col.value === 10 || col.value === 1000;
    g.save();
    g.translate(b.x, yt); g.scale(1, ry / rx);
    g.font = `${rx * (text.length > 2 ? 0.68 : 0.82)}px ${NUM}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = Math.max(1, rx * 0.12); g.strokeStyle = dark ? '#efe4c8' : INK;
    g.strokeText(text, 0, rx * 0.06);
    g.fillStyle = dark ? INK : '#efe4c8'; g.fillText(text, 0, rx * 0.06);
    g.restore();
  }
  // contorno de la columna completa
  g.beginPath();
  g.ellipse(b.x, yt, rx, ry, 0, 0, Math.PI * 2);
  g.moveTo(b.x - rx, yt); g.lineTo(b.x - rx, b.y);
  g.ellipse(b.x, b.y, rx, ry, 0, Math.PI, 0, true);
  g.lineTo(b.x + rx, yt);
  g.lineWidth = line; g.strokeStyle = INK; g.stroke();
}

// Esquinas de una carta en el mundo: `at` es la mitad de su orilla de abajo (la más cercana a mí),
// `tilt` la levanta hacia mí (0 = acostada) y `yaw` la gira sobre la mesa.
export function cardCorners(at, w, h, tilt, yaw, lift = 0) {
  const r = { x: Math.cos(yaw), z: -Math.sin(yaw) }, f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const up = { x: f.x * Math.cos(tilt), y: Math.sin(tilt), z: f.z * Math.cos(tilt) };
  const pt = (u, t) => ({ x: at.x + r.x * u + up.x * t, y: lift + up.y * t, z: at.z + r.z * u + up.z * t });
  return { tl: pt(-w / 2, h), tr: pt(w / 2, h), bl: pt(-w / 2, 0), br: pt(w / 2, 0) };
}

// `flip` (0 a 1): qué tan ancha se ve mientras se voltea. `mark`: 'win' si es de la mano ganadora (contorno
// mostaza, plano como el aro de turno) o 'dim' si no (apagada, como un rival retirado). `down`: boca abajo (se ve el
// reverso; `code` es la carta de verdad) y `fold` (0 a 1): cuánto va de asomarse: aquí se dibuja solo lo que se queda
// en la mesa, y lo levantado con drawFlap (ver FOLD).
export function drawCard(g, v, it, line) {
  const w = CARD_W * (it.scale || 1) * (it.flip ?? 1), h = CARD_H * (it.scale || 1);
  const c = cardCorners(it.at, w, h, it.tilt || 0, it.yaw || 0, 0.002);
  const P = p => v.project(p.x, p.y, p.z);
  // sombra plana: la huella de la carta sobre el fieltro, corrida un poco
  const foot = [c.tl, c.tr, c.br, c.bl].map(p => P({ x: p.x + 0.012, y: 0, z: p.z + (p.y > 0.01 ? 0.03 : 0.012) }));
  g.beginPath(); foot.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
  g.fillStyle = SHADOW; g.fill();
  const tl = P(c.tl), tr = P(c.tr), bl = P(c.bl);
  const [W, H] = CARD_PX;
  g.save();
  g.transform((tr.x - tl.x) / W, (tr.y - tl.y) / W, (bl.x - tl.x) / H, (bl.y - tl.y) / H, tl.x, tl.y);
  if (it.down && it.fold > 0) { // lo que se queda en la mesa: de la línea del doblez para allá
    const { A, B } = foldLine();
    g.save();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(B.x, B.y); g.lineTo(A.x, A.y); g.closePath(); g.clip();
    g.drawImage(cardImage(null), 0, 0);
    g.restore();
    g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y);
    g.lineCap = 'round'; g.lineWidth = (line * W) / Math.max(1, Math.hypot(tr.x - tl.x, tr.y - tl.y)); g.strokeStyle = INK; g.stroke();
  } else g.drawImage(cardImage(it.down ? null : it.code), 0, 0);
  if (it.mark) roundRect(g, 0, 0, W, H, 30); // la orilla de la carta, ya en perspectiva
  g.restore();
  // (el trazo va con el grueso de la pantalla, no el de la carta, para que sea parejo)
  if (it.mark === 'dim') { g.fillStyle = 'rgba(29,22,17,0.52)'; g.fill(); }
  else if (it.mark === 'win') {
    g.lineJoin = 'round';
    g.lineWidth = line * 4.4; g.strokeStyle = INK; g.stroke();
    g.lineWidth = line * 2.4; g.strokeStyle = '#d9a441'; g.stroke();
  }
}

// Asomarse a una carta boca abajo: la parte de mi lado, de una línea que sube más del lado izquierdo (como al levantar
// la esquina) para acá, gira sobre esa línea y se levanta hasta quedar casi de frente a mí (`angulo`). drawCard dibuja lo
// que se queda en la mesa y drawFlap lo levantado, que va encima de la mano (en el aire está más cerca de mí). Boca
// abajo la cara va en espejo y, levantada, su orilla de abajo queda arriba: el índice de abajo a la derecha (en la cara
// va de cabeza) se ve derecho, del lado izquierdo. `izquierda` y `derecha`: cuánto de la carta se levanta de cada lado.
export const FOLD = { izquierda: 0.46, derecha: 0.3, angulo: 115 };
// la línea del doblez en px de la carta (y = H es la orilla de mi lado)
function foldLine() {
  const [W, H] = CARD_PX;
  return { A: { x: 0, y: H * (1 - FOLD.izquierda) }, B: { x: W, y: H * (1 - FOLD.derecha) } };
}
export function drawFlap(g, v, it, line) {
  if (!(it.down && it.fold > 0)) return;
  const [W, H] = CARD_PX;
  const c = cardCorners(it.at, CARD_W * (it.scale || 1), CARD_H * (it.scale || 1), it.tilt || 0, it.yaw || 0, 0.002);
  // de px de la carta (u a lo ancho, t de la orilla de allá a la mía) al mundo
  const P = (u, t) => {
    const a = u / W, b = t / H;
    return { x: c.tl.x + (c.tr.x - c.tl.x) * a + (c.bl.x - c.tl.x) * b, y: c.tl.y + (c.tr.y - c.tl.y) * a + (c.bl.y - c.tl.y) * b,
      z: c.tl.z + (c.tr.z - c.tl.z) * a + (c.bl.z - c.tl.z) * b };
  };
  const { A: Al, B: Bl } = foldLine();
  const A = P(Al.x, Al.y), B = P(Bl.x, Bl.y), D = P(0, H);
  // gira sobre la línea AB (Rodrigues), hacia arriba
  const n = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z), k = { x: (B.x - A.x) / n, y: (B.y - A.y) / n, z: (B.z - A.z) / n };
  const rot = (p, ang) => {
    const r = { x: p.x - A.x, y: p.y - A.y, z: p.z - A.z }, co = Math.cos(ang), si = Math.sin(ang), kr = k.x * r.x + k.y * r.y + k.z * r.z;
    const cx = k.y * r.z - k.z * r.y, cy = k.z * r.x - k.x * r.z, cz = k.x * r.y - k.y * r.x;
    return { x: A.x + r.x * co + cx * si + k.x * kr * (1 - co), y: A.y + r.y * co + cy * si + k.y * kr * (1 - co), z: A.z + r.z * co + cz * si + k.z * kr * (1 - co) };
  };
  const ang = it.fold * FOLD.angulo * Math.PI / 180;
  const up = rot(D, ang), down = rot(D, -ang), Dr = up.y >= down.y ? up : down;
  const S = p => v.project(p.x, p.y, p.z);
  const sA = S(A), sB = S(B), sD = S(Dr), sD0 = S(D);
  // de px de la carta a la pantalla, por tres puntos: A, B y la esquina de mi lado ya levantada
  const q = Bl.y - Al.y, p = H - Al.y;
  const f1 = { x: sB.x - sA.x, y: sB.y - sA.y }, f2 = { x: sD.x - sA.x, y: sD.y - sA.y };
  const a = (f1.x * p - f2.x * q) / (W * p), b = (f1.y * p - f2.y * q) / (W * p), cc = f2.x / p, d = f2.y / p;
  // si lo levantado quedó al revés en la pantalla, ya se ve su cara
  const cross = (u, w) => u.x * w.y - u.y * w.x;
  const cara = Math.sign(cross(f1, f2)) !== Math.sign(cross(f1, { x: sD0.x - sA.x, y: sD0.y - sA.y }));
  g.save();
  g.transform(a, b, cc, d, sA.x - (a * Al.x + cc * Al.y), sA.y - (b * Al.x + d * Al.y));
  g.beginPath(); g.moveTo(Al.x, Al.y); g.lineTo(Bl.x, Bl.y); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.clip();
  if (cara) { g.transform(-1, 0, 0, 1, W, 0); g.drawImage(cardImage(it.code), 0, 0); }
  else g.drawImage(cardImage(null), 0, 0);
  g.restore();
  g.beginPath(); g.moveTo(sA.x, sA.y); g.lineTo(sB.x, sB.y);
  g.lineCap = 'round'; g.lineWidth = line; g.strokeStyle = INK; g.stroke();
}

function drawDealer(g, v, it, line) {
  const r = 0.032, hgt = 0.012;
  const b = v.project(it.at.x, 0, it.at.z), t = v.project(it.at.x, hgt, it.at.z);
  const rx = r * b.s, ry = Math.abs(v.project(it.at.x, 0, it.at.z + r).y - v.project(it.at.x, 0, it.at.z - r).y) / 2;
  g.beginPath(); g.ellipse(b.x + rx * 0.25, b.y + ry * 0.35, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = SHADOW; g.fill();
  g.beginPath();
  g.moveTo(b.x - rx, t.y); g.lineTo(b.x - rx, b.y); g.ellipse(b.x, b.y, rx, ry, 0, Math.PI, 0, true); g.lineTo(b.x + rx, t.y);
  g.fillStyle = '#c4b490'; g.fill();
  g.beginPath(); g.ellipse(b.x, t.y, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = '#efe4c8'; g.fill();
  g.save(); g.translate(b.x, t.y); g.scale(1, ry / rx);
  g.font = `${rx * 1.1}px ${NUM}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK;
  g.fillText('D', 0, rx * 0.08);
  g.restore();
  g.beginPath();
  g.ellipse(b.x, t.y, rx, ry, 0, 0, Math.PI * 2);
  g.moveTo(b.x - rx, t.y); g.lineTo(b.x - rx, b.y); g.ellipse(b.x, b.y, rx, ry, 0, Math.PI, 0, true); g.lineTo(b.x + rx, t.y);
  g.lineWidth = line; g.strokeStyle = INK; g.stroke();
}

// items: [{ kind: 'stack', amount, at, across, back, seed, messy } | { kind: 'card', code, at, tilt, yaw, scale, flip, mark, down, fold } | { kind: 'dealer', at }]
export function drawItems(g, v, items, line) {
  g.lineJoin = 'round'; g.lineCap = 'round';
  const parts = [];
  for (const it of items) {
    if (it.kind === 'stack') {
      if (!(it.amount > 0)) continue;
      const cols = stackColumns(it.amount, it.at, it.across, it.back, it.seed, it.messy);
      // una sola sombra plana bajo toda la pila
      g.beginPath();
      for (const c of cols) {
        const p = v.project(c.x + CHIP_R * 0.35, 0, c.z + CHIP_R * 0.3);
        const ry = Math.abs(v.project(c.x, 0, c.z + CHIP_R).y - v.project(c.x, 0, c.z - CHIP_R).y) / 2;
        g.moveTo(p.x + CHIP_R * p.s * 1.08, p.y); g.ellipse(p.x, p.y, CHIP_R * p.s * 1.08, ry * 1.08, 0, 0, Math.PI * 2);
      }
      g.fillStyle = SHADOW; g.fill('nonzero');
      for (const c of cols) parts.push({ z: c.z, draw: () => chipColumn(g, v, c, line) });
    } else if (it.kind === 'card') parts.push({ z: it.at.z, draw: () => drawCard(g, v, it, line) });
    else if (it.kind === 'dealer') parts.push({ z: it.at.z, draw: () => drawDealer(g, v, it, line) });
  }
  // de atrás para adelante
  parts.sort((a, b) => a.z - b.z).forEach(p => p.draw());
}
