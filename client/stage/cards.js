// Caras y reversos de las cartas dibujados en canvas (se hacen una vez y se reusan). Papel blanco cálido, palos de forma
// clásica en dos colores (client/ui/suits.js), la distribución tradicional de los palos del 2 al 10 (los de la mitad de
// abajo, de cabeza) e índices grandes en Chewy, para que se lean aunque la carta mida 27 px de ancho en el celular. El
// reverso y las figuras llevan arte (public/assets/arte/carta-*.webp, de scripts/generar-baraja.py y
// scripts/optimizar-arte.py baraja): cargarArte() lo precarga con lo demás. Cada imagen es opcional: la que no cargue se
// dibuja solo con código.

import { SUIT_PATH, SUIT_COLOR } from '../ui/suits.js';
import { INK } from './table.js';
import { loadImage } from './characters.js';
import DATOS from './baraja.json' with { type: 'json' };

export const CARD_PX = [256, 368];
export const PAPEL = '#f8f2e4';   // el mismo papel de scripts/generar-baraja.py (PAPEL)
const NUM = '"Chewy", "Marker Felt", "Comic Sans MS", cursive';
const [W, H] = CARD_PX;
const R = 26;          // radio de las esquinas
const BORDE = 7;       // contorno de tinta
const MITAD = H / 2;

// La etiqueta del logo: un rectángulo rojo con el nombre en letras blancas, sin contorno. La misma función (etiqueta)
// la dibuja en el reverso, grande y al centro, y en los ases, chica abajo del palo: el logo se va a rediseñar y así se
// cambian los dos a la vez. Aquí van el texto, los colores y, de cada lugar, el ángulo (grados, subiendo hacia la
// derecha) y el tamaño (largo y grueso, en fracción del ancho de la carta). En el reverso, si con ese ángulo el largo
// tocaría el marco, se acorta solo (la zona libre de adentro del marco viene con el arte); las letras se acomodan al
// tamaño de la etiqueta.
export const ETIQUETA = {
  texto: 'Poker for the Players',
  color: '#9f3626',
  letras: '#fbf6ea',
  reverso: { angulo: 0, largo: 0.8, grueso: 0.14 },
  as: { angulo: 0, largo: 0.5, grueso: 0.075 },
};
// El as: el palo grande al centro (un poco arriba) y la etiqueta abajo de él, arriba del índice de abajo a la derecha;
// los cuatro iguales.
const AS = { y: 152, tam: 108, etiqueta: 223 };

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

// El arte: { reverso: Image (el marco, con su papel y margen), libre: { columnas, filas, celdas } (adentro del marco,
// donde cabe la etiqueta: filas de arriba abajo, "1" = libre), figuras: { K: { h, d, c, s } } (la mitad de arriba de
// cada figura en su panel, una por palo con la túnica de su color), adornos: { flor, banda } (las volutas del reverso
// para el marco de las figuras) }. Al cambiar, se vuelven a dibujar las cartas.
let arte = { libre: DATOS.libre };
export function setArt(a) { arte = { ...arte, ...a }; faces.clear(); }

// Carga y decodifica el arte de la baraja (se llama con la precarga de la mesa). Nunca falla: lo que no cargue se queda
// sin arte y esa carta se dibuja solo con código.
export function cargarArte() {
  const opcional = nombre => loadImage(`/assets/arte/carta-${nombre}.webp`).catch(() => null);
  const figuras = Object.entries(DATOS.figuras).flatMap(([rank, nombre]) => [...'hdcs'].map(s => [rank, s, nombre]));
  return Promise.all([opcional('reverso'), opcional('adorno-flor'), opcional('adorno-banda'),
    ...figuras.map(([, s, nombre]) => opcional(`${nombre}-${s}`))]).then(([reverso, flor, banda, ...imgs]) => {
    const porRango = {};
    figuras.forEach(([rank, s], i) => { if (imgs[i]) (porRango[rank] = porRango[rank] || {})[s] = imgs[i]; });
    setArt({ reverso, adornos: flor && banda ? { flor, banda } : null, figuras: porRango });
  });
}

// El panel de las figuras: la mitad de arriba (su cintura en la línea del centro) y abajo la misma, girada 180°, como en
// las barajas de siempre. Va entre los dos índices; el palo, junto a la cabeza. Con los adornos del reverso (arte.adornos:
// { flor, banda }), el marco es de doble línea con una flor en cada esquina y la línea del centro es una franja con la
// banda de volutas, para que el frente combine con el reverso. Las flores van en las dos esquinas libres (arriba a la
// derecha y, girada, abajo a la izquierda); en las otras dos está el palo junto a la cabeza, lejos de los índices.
const PANEL = { x: 64, y: 26, w: 128, h: 158 };
const FRANJA = 14, FLOR = 20;
function figura(g, s, img) {
  const { x, y, w, h } = PANEL;
  // el dibujo (128 × 162 a 2×) a lo ancho del panel, con la cintura en la línea del centro: le sobra un poco de aire arriba
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
const palo = s => (paths[s] = paths[s] || new Path2D(SUIT_PATH[s]));
// Un palo centrado en (x, y), de `size` px de alto (la caja de 100), de cabeza si `flip`.
export function drawPip(g, s, x, y, size, flip = false, color = SUIT_COLOR[s]) {
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

// Una carta derecha (sin perspectiva), con su centro en (cx, cy), `w` px de ancho y girada `angulo` radianes: las mías
// en el celular (.mycards) y en la mano de mi brazo (arms.js). `mark`: 'win' (contorno mostaza, de la mano ganadora) o
// 'dim' (apagada), como las de la mesa; `line`: el grueso de la línea de tinta de la escena; `sombra`: su sombra plana.
export function drawFlatCard(g, code, cx, cy, w, angulo = 0, { mark = null, line = 1.5, sombra = true } = {}) {
  const h = (w * H) / W;
  g.save();
  g.translate(cx, cy); g.rotate(angulo);
  if (sombra) { g.fillStyle = 'rgba(14,8,4,0.45)'; roundRect(g, -w / 2 + 4, -h / 2 + 5, w, h, w * 0.1); g.fill(); }
  g.drawImage(cardImage(code), -w / 2, -h / 2, w, h);
  if (mark) {
    roundRect(g, -w / 2, -h / 2, w, h, w * 0.117);
    if (mark === 'dim') { g.fillStyle = 'rgba(29,22,17,0.52)'; g.fill(); }
    else { g.lineJoin = 'round'; g.lineWidth = line * 4.4; g.strokeStyle = INK; g.stroke(); g.lineWidth = line * 2.4; g.strokeStyle = '#d9a441'; g.stroke(); }
  }
  g.restore();
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
    g.fillStyle = SUIT_COLOR[s];
    g.fillText(rank, 0, 0);
    g.restore();
    drawPip(g, s, INDICE.x, INDICE.palo, INDICE.paloTam);
  };
  una();
  g.save(); g.translate(W, H); g.rotate(Math.PI); una(); g.restore();
}

// Figura sin su arte (si no cargó): el mismo marco, la letra grande en cada mitad (la de abajo, de cabeza) y el palo.
function figuraSinArte(g, rank, s) {
  const { x, y, w, h } = PANEL;
  g.strokeStyle = INK;
  g.lineWidth = 3; g.strokeRect(x, y, w, 2 * h);
  g.lineWidth = 2; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w, y + h); g.stroke();
  const una = () => {
    g.font = `${h * 0.7}px ${NUM}`;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = SUIT_COLOR[s];
    g.globalAlpha = 0.3; g.fillText(rank, x + w / 2, y + h * 0.82); g.globalAlpha = 1;
    drawPip(g, s, x + 15, y + 17, 22);
  };
  una();
  g.save(); g.translate(2 * x + w, 2 * y + 2 * h); g.rotate(Math.PI); una(); g.restore();
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
// El largo de la etiqueta del reverso: el de ETIQUETA o, si así tocaría el marco, el mayor que cabe. Sin el arte, el
// marco sencillo de código deja 0.66 del ancho.
export function largoEtiqueta(e = ETIQUETA.reverso, libre = arte.libre) {
  if (!libre) return Math.min(e.largo, 0.66);
  if (cabe(e.largo, e, libre)) return e.largo;
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
  const e = ETIQUETA.reverso;
  etiqueta(g, W / 2, H / 2, largoEtiqueta(e, arte.reverso ? arte.libre : null) * W, e.grueso * W, e.angulo);
  borde(g);
}

// La etiqueta del logo centrada en (cx, cy), de `largo` × `grueso` px, girada `angulo` grados (ETIQUETA).
export function etiqueta(g, cx, cy, largo, grueso, angulo = 0) {
  g.save();
  g.translate(cx, cy); g.rotate((-angulo * Math.PI) / 180);
  g.fillStyle = ETIQUETA.color; g.fillRect(-largo / 2, -grueso / 2, largo, grueso);
  // las letras: del grueso de la etiqueta o, si no caben a lo largo, más chicas
  let tam = grueso * 0.62;
  g.font = `${tam}px ${NUM}`;
  const ancho = g.measureText(ETIQUETA.texto).width;
  if (ancho > largo * 0.86) { tam *= (largo * 0.86) / ancho; g.font = `${tam}px ${NUM}`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = ETIQUETA.letras;
  g.fillText(ETIQUETA.texto, 0, tam * 0.06);
  g.restore();
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
    if ('JQK'.includes(rank)) (fig ? figura(g, s, fig) : figuraSinArte(g, rank, s));
    else if (rank === 'A') {
      drawPip(g, s, W / 2, AS.y, AS.tam);
      etiqueta(g, W / 2, AS.etiqueta, ETIQUETA.as.largo * W, ETIQUETA.as.grueso * W, ETIQUETA.as.angulo);
    }
    else for (const p of pipLayout(Number(rank))) drawPip(g, s, p.x, p.y, PIP, p.flip);
    indice(g, rank, s);
    borde(g);
  }
  faces.set(key, c);
  return c;
}
