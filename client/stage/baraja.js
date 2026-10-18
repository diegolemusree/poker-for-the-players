// Baraja nueva dibujada en canvas (en revisión: el juego la usa solo con ?baraja=nueva en la dirección; sin eso
// sigue con cards.js). Papel blanco cálido, palos de forma clásica en dos colores (client/ui/palos.js), la
// distribución tradicional de los palos del 2 al 10 (los de la mitad de abajo, de cabeza) e índices grandes en Chewy,
// para que se lean aunque la carta mida 27 px de ancho en el celular. El reverso, las figuras y el as de picas llevan
// arte de scripts/generar-baraja.py; mientras no esté cargado, se dibujan sin él.

import { PALOS, COLOR_PALO } from '../ui/palos.js';
import { INK } from './table.js';

export const CARD_PX = [256, 368];
export const PAPEL = '#f8f2e4';   // el mismo papel de scripts/generar-baraja.py (PAPEL)
const NUM = '"Chewy", "Marker Felt", "Comic Sans MS", cursive';
const [W, H] = CARD_PX;
const R = 26;          // radio de las esquinas
const BORDE = 7;       // contorno de tinta
const MITAD = H / 2;

// La etiqueta del reverso: un rectángulo rojo atravesado en diagonal por el centro, con el nombre en letras blancas.
// El logo se va a rediseñar: aquí se cambian el texto, el ángulo (grados, subiendo hacia la derecha) y el tamaño (largo
// y grueso, en fracción del ancho de la carta). Si con ese ángulo el largo tocaría el marco, se acorta solo (la zona
// libre de adentro del marco viene con el arte); las letras se acomodan al tamaño de la etiqueta.
export const ETIQUETA = {
  texto: 'Poker for the Players',
  angulo: 40,
  largo: 0.95,
  grueso: 0.16,
  color: '#9f3626',
  letras: '#fbf6ea',
};

// Índice de la esquina (el número o letra y abajo su palo, del color del palo) y dónde van los palos del 2 al 10: tres
// columnas y filas entre ARRIBA y su espejo abajo (los de abajo, de cabeza). El índice va al 85 % de grande para que
// las columnas queden abiertas, como en la distribución tradicional.
const INDICE = { x: 40, base: 82, tam: 80, palo: 112, paloTam: 40 };
const COL = { L: 90, C: 128, R: 166 }, ARRIBA = 74, PIP = 42;

function lugares(n) {
  const A = ARRIBA, B = H - ARRIBA, fila4 = k => A + (k * (B - A)) / 3;
  return {
    2: [['C', A], ['C', B]],
    3: [['C', A], ['C', MITAD], ['C', B]],
    4: [['L', A], ['R', A], ['L', B], ['R', B]],
    5: [['L', A], ['R', A], ['C', MITAD], ['L', B], ['R', B]],
    6: [['L', A], ['R', A], ['L', MITAD], ['R', MITAD], ['L', B], ['R', B]],
    7: [['L', A], ['R', A], ['C', (A + MITAD) / 2], ['L', MITAD], ['R', MITAD], ['L', B], ['R', B]],
    8: [['L', A], ['R', A], ['C', (A + MITAD) / 2], ['L', MITAD], ['R', MITAD], ['C', (MITAD + B) / 2], ['L', B], ['R', B]],
    9: [0, 1, 2, 3].flatMap(k => [['L', fila4(k)], ['R', fila4(k)]]).concat([['C', MITAD]]),
    10: [0, 1, 2, 3].flatMap(k => [['L', fila4(k)], ['R', fila4(k)]])
      .concat([['C', (fila4(0) + fila4(1)) / 2], ['C', (fila4(2) + fila4(3)) / 2]]),
  }[n];
}
// Para las pruebas: cuántos palos lleva cada carta y dónde (en px de la carta).
export const pipLayout = n => lugares(n).map(([c, y]) => ({ x: COL[c], y, flip: y > MITAD + 0.5 }));

// Arte de scripts/generar-baraja.py: { reverso: Image (el marco, con su papel y margen), libre: { columnas, filas,
// celdas } (adentro del marco, donde cabe la etiqueta: filas de arriba abajo, "1" = libre), figuras: { K: { h, d, c, s }
// } (la mitad de arriba de cada figura en su panel, una por palo con la túnica de su color) }. Al cambiar, se vuelven a
// dibujar las cartas.
let arte = {};
export function setArt(a) { arte = { ...arte, ...a }; faces.clear(); }

// El panel de las figuras: la mitad de arriba (su cintura en la línea del centro) y abajo la misma, girada 180°, como en
// las barajas de siempre. Va entre los dos índices; el palo, junto a la cabeza. Con los adornos del reverso (arte.adornos:
// { flor, banda }), el marco es de doble línea con una flor en cada esquina y la línea del centro es una franja con la
// banda de volutas, para que el frente combine con el reverso. Las flores van en las dos esquinas libres (arriba a la
// derecha y, girada, abajo a la izquierda); en las otras dos está el palo junto a la cabeza, lejos de los índices.
const PANEL = { x: 64, y: 26, w: 128, h: 158 };
const FRANJA = 14, FLOR = 20;
function figura(g, s, img) {
  const { x, y, w, h } = PANEL;
  // el dibujo (128 × 162 a 3×) a lo ancho del panel, con la cintura en la línea del centro: le sobra un poco de aire arriba
  const sy = img.height - (h * img.width) / w;
  g.drawImage(img, 0, sy, img.width, img.height - sy, x, y, w, h);
  g.save(); g.translate(x + w / 2, y + h * 1.5); g.rotate(Math.PI);
  g.drawImage(img, 0, sy, img.width, img.height - sy, -w / 2, -h / 2, w, h); g.restore();
  g.strokeStyle = INK;
  const ad = arte.adornos;
  if (ad) {
    // la línea del centro: una franja de papel con la banda de volutas repetida, entre dos líneas
    const yb = y + h - FRANJA / 2, alto = FRANJA - 4;
    const n = Math.max(1, Math.round((w - 6) / ((alto * ad.banda.width) / ad.banda.height))), ancho = (w - 6) / n;
    g.fillStyle = PAPEL; g.fillRect(x, yb, w, FRANJA);
    for (let i = 0; i < n; i++) g.drawImage(ad.banda, x + 3 + i * ancho, yb + 2, ancho, alto);
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x, yb); g.lineTo(x + w, yb); g.moveTo(x, yb + FRANJA); g.lineTo(x + w, yb + FRANJA); g.stroke();
    // marco de doble línea y las flores, con las hojas hacia afuera
    g.lineWidth = 2.5; g.strokeRect(x, y, w, 2 * h);
    g.lineWidth = 1.2; g.strokeRect(x + 4, y + 4, w - 8, 2 * h - 8);
    for (const [cx, cy, giro] of [[x + w, y, -1], [x, y + 2 * h, 1]]) {
      g.save(); g.translate(cx, cy); g.scale(giro, -giro);
      g.drawImage(ad.flor, -FLOR * 0.8, -FLOR * 0.8, FLOR, FLOR);
      g.restore();
    }
  } else {
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w, y + h); g.stroke();
    g.lineWidth = 3; g.strokeRect(x, y, w, 2 * h);
  }
  drawPip(g, s, x + 15, y + 17, 22);
  drawPip(g, s, x + w - 15, y + 2 * h - 17, 22, true);
}

const paths = {};
const palo = s => (paths[s] = paths[s] || new Path2D(PALOS[s]));
// Un palo centrado en (x, y), de `size` px de alto (la caja de 100), de cabeza si `flip`.
export function drawPip(g, s, x, y, size, flip = false, color = COLOR_PALO[s]) {
  g.save();
  g.translate(x, y);
  if (flip) g.rotate(Math.PI);
  g.scale(size / 100, size / 100);
  g.translate(-50, -50);
  g.fillStyle = color;
  g.fill(palo(s));
  g.restore();
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function papel(g) {
  g.fillStyle = PAPEL; roundRect(g, 0, 0, W, H, R); g.fill();
}
function borde(g) {
  g.lineJoin = 'round'; g.lineWidth = BORDE; g.strokeStyle = INK;
  roundRect(g, BORDE / 2, BORDE / 2, W - BORDE, H - BORDE, R - BORDE / 2); g.stroke();
}

// El índice de arriba a la izquierda (y, girado, el de abajo a la derecha): el 10 va angosto para que quepa.
function indice(g, rank, s) {
  const una = () => {
    g.save();
    g.translate(INDICE.x, INDICE.base);
    if (rank === '10') g.scale(0.74, 1);
    g.font = `${INDICE.tam}px ${NUM}`;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = COLOR_PALO[s];
    g.fillText(rank, 0, 0);
    g.restore();
    drawPip(g, s, INDICE.x, INDICE.palo, INDICE.paloTam);
  };
  una();
  g.save(); g.translate(W, H); g.rotate(Math.PI); una(); g.restore();
}

// Figura sin arte todavía: el marco y el palo grande al centro, apagado.
function figuraPendiente(g, s) {
  const x0 = 70, x1 = W - 70, y0 = 30, y1 = H - 30;
  g.save();
  g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0);
  g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
  g.clip();
  g.globalAlpha = 0.22;
  drawPip(g, s, W / 2, H / 2 - 62, 84);
  drawPip(g, s, W / 2, H / 2 + 62, 84, true);
  g.restore();
}

// ¿Cabe la etiqueta (centrada en la carta) con este largo sin salirse de la zona libre? Se revisan puntos de toda ella.
function cabe(largo, e, libre) {
  const a = (-e.angulo * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
  const L = (largo * W) / 2, G = (e.grueso * W) / 2;
  for (let i = -10; i <= 10; i++) {
    for (let j = -2; j <= 2; j++) {
      const x = W / 2 + (ux * L * i) / 10 - (uy * G * j) / 2, y = H / 2 + (uy * L * i) / 10 + (ux * G * j) / 2;
      const c = Math.floor((x / W) * libre.columnas), f = Math.floor((y / H) * libre.filas);
      if (f < 0 || f >= libre.filas || c < 0 || c >= libre.columnas || libre.celdas[f][c] !== '1') return false;
    }
  }
  return true;
}
// El largo de la etiqueta: el de ETIQUETA o, si así tocaría el marco, el mayor que cabe.
export function largoEtiqueta(e = ETIQUETA, libre = arte.libre) {
  if (!libre || cabe(e.largo, e, libre)) return e.largo;
  let lo = 0.2, hi = e.largo;
  for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (cabe(m, e, libre)) lo = m; else hi = m; }
  return lo;
}

// Reverso: el marco (arte de Gemini, sin nada adentro) y la etiqueta con el nombre, de código. Sin arte: un marco
// sencillo de código.
function reverso(g) {
  papel(g);
  if (arte.reverso) {
    g.save(); roundRect(g, 0, 0, W, H, R); g.clip();
    g.drawImage(arte.reverso, 0, 0, W, H);
    g.restore();
  } else {
    g.lineWidth = 9; g.strokeStyle = ETIQUETA.color; roundRect(g, 22, 22, W - 44, H - 44, 14); g.stroke();
    g.lineWidth = 3; roundRect(g, 34, 34, W - 68, H - 68, 8); g.stroke();
  }
  const e = ETIQUETA, largo = largoEtiqueta(e, arte.reverso ? arte.libre : null) * W, grueso = e.grueso * W;
  g.save();
  g.translate(W / 2, H / 2); g.rotate((-e.angulo * Math.PI) / 180);
  g.fillStyle = e.color; g.fillRect(-largo / 2, -grueso / 2, largo, grueso);
  g.lineWidth = 2.5; g.strokeStyle = INK; g.strokeRect(-largo / 2, -grueso / 2, largo, grueso);
  // las letras: del grueso de la etiqueta o, si no caben a lo largo, más chicas
  let tam = grueso * 0.62;
  g.font = `${tam}px ${NUM}`;
  const ancho = g.measureText(e.texto).width;
  if (ancho > largo * 0.86) { tam *= (largo * 0.86) / ancho; g.font = `${tam}px ${NUM}`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = e.letras;
  g.fillText(e.texto, 0, tam * 0.06);
  g.restore();
  borde(g);
}

const faces = new Map();
// Cara de una carta ('Ah', 'Td'...) o el reverso (code = null), a CARD_PX por `k` (1 en el juego).
export function cardImage(code, k = 1) {
  const key = (code || 'back') + '@' + k;
  if (faces.has(key)) return faces.get(key);
  const c = document.createElement('canvas');
  c.width = W * k; c.height = H * k;
  const g = c.getContext('2d');
  g.scale(k, k);
  if (!code) reverso(g);
  else {
    const rank = code[0] === 'T' ? '10' : code[0], s = code[1];
    papel(g);
    const fig = arte.figuras && arte.figuras[rank] && arte.figuras[rank][s];
    if ('JQK'.includes(rank)) (fig ? figura(g, s, fig) : figuraPendiente(g, s));
    else if (rank === 'A') drawPip(g, s, W / 2, MITAD, s === 's' ? 132 : 118);
    else for (const p of pipLayout(Number(rank))) drawPip(g, s, p.x, p.y, PIP, p.flip);
    indice(g, rank, s);
    borde(g);
  }
  faces.set(key, c);
  return c;
}
