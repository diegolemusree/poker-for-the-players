// Mesa ilustrada por capas, como una animación de televisión (de atrás hacia adelante):
//   1. fondo del garaje (imagen, recortada por los lados en pantallas verticales)
//   2. la mesa: la ilustración en la computadora, la de código en vertical o si no cargó (se redibuja solo al
//      cambiar el tamaño)
//   3. cartas, bote y fichas sobre el fieltro (se redibujan con cada jugada)
//   4. los rivales ilustrados; la mesa los tapa de la cintura para abajo (se animan)
//   5. etiquetas y montos en HTML, y encima la interfaz (main.js)
// Recibe la misma vista filtrada del servidor que la vista 2D simple.

import {
  CHARACTERS, characterFor, artOf, angleOf, needsMirror, visibleSpan, backgroundUrl, preloadArt, BACKGROUND, tableArtUrl, loadImage,
  loadedImage,
} from './characters.js';
import { makeView, fit, headTop, frontRegion, edgeYAt, belowRow, rimPoint, RAIL_Y, NEAR_Z, DEG } from './projection.js';
import { CAMERAS, LAYOUTS, BACKDROP } from './config.js';
import { drawTable, INK } from './table.js';
import { drawItems, cardCorners, stackFootprint, CARD_W, CARD_H, CHIP_R, CHIP_H } from './items.js';
import { cardImage, roundRect, CARD_PX, cargarArte } from './cards.js';
import { RivalAnim, poseCanvas, clearPoseCache } from './rivals.js';
import { isPhone } from '../ui/phone.js';
import { winningCards } from '../ui/hand.js';

const MAXP = 7;
// Final de la mano: las cartas de quienes llegaron se voltean una tras otra y luego se resalta la mano ganadora.
const FLIP_MS = 320, FLIP_GAP = 170, MARK_PAUSE = 180;
// Cuánto se levantan las cartas sobre la mesa (0 = acostadas): las comunitarias, las mías y las que enseña cada
// rival al final. Con una cámara más baja se levantan `lean` grados de más (config.js) para que se lean igual.
const TILT = { board: 0.62, mine: 0.75, shown: 0.35 };
// ?medidas en la dirección: dibuja la cintura y la cara de cada rival (ver drawMeasures)
const MEDIDAS = new URLSearchParams(location.search).has('medidas');
// El nombre de bot más largo (cada personaje lleva el suyo): con él se mide el lugar de las etiquetas.
const LONGEST_NAME = Object.values(CHARACTERS).map(c => c.name).reduce((a, b) => (b.length > a.length ? b : a), 'Don Chepe');
const BETTING = ['preflop', 'flop', 'turn', 'river'];
export const QUALITIES = ['alta', 'media', 'baja'];
const FIXED = LAYOUTS[MAXP - 1]; // sin asiento y antes de empezar: cada asiento en su lugar
const [BG_W, BG_H] = BACKGROUND.sizes[BACKGROUND.sizes.length - 1];
const ACTION = {
  check: () => 'Pasa', call: a => `Iguala ${a}`, bet: a => `Apuesta ${a}`, raise: a => `Sube a ${a}`,
  fold: () => 'Se retira', sb: a => `Ciega ${a}`, bb: a => `Ciega ${a}`,
};
const ACTION_CLS = { check: 'a-check', call: 'a-call', bet: 'a-raise', raise: 'a-raise', fold: 'a-fold', sb: 'a-blind', bb: 'a-blind' };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
// La línea de un lugar en la orilla al centro: `d` hacia afuera, `tan` de lado, y on(r, t) el punto a `r` de
// la orilla (1 = la orilla, 0 = el centro) recorrido `t` de lado.
function rimLine(rim) {
  const n = Math.hypot(rim.x, rim.z), d = { x: rim.x / n, z: rim.z / n }, tan = { x: -d.z, z: d.x };
  return { d, tan, on: (r, t = 0) => ({ x: rim.x * r + tan.x * t, z: rim.z * r + tan.z * t }) };
}
function readMode() {
  const m = store.get('ppt-quality') || 'auto';
  return m === 'auto' || QUALITIES.includes(m) ? m : 'auto';
}
// En automático: calidad baja solo en equipos muy modestos (pocos núcleos o poca memoria).
const autoQuality = () => ((navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2 ? 'baja' : 'alta');
const qualityOf = m => (m === 'auto' ? autoQuality() : m);
// Resolución de los canvas según la calidad (y con ella, qué tamaño del fondo y de la mesa se usa).
const dprFor = q => Math.min(window.devicePixelRatio || 1, q === 'alta' ? 2 : q === 'media' ? 1.5 : 1);

// Se llama antes de crear la escena: carga y decodifica el fondo, la mesa, todas las poses (los mismos tamaños que
// usará la escena) y el arte de la baraja (cada imagen de la baraja es opcional: si una falta, esa carta va de código).
export function preload() {
  const q = qualityOf(readMode());
  return Promise.all([preloadArt({ small: q === 'baja', dpr: q === 'baja' ? 1 : dprFor(q) }), cargarArte()]);
}

function el(tag, cls) { const e = document.createElement(tag); e.className = cls; if (tag === 'canvas') e.setAttribute('aria-hidden', 'true'); return e; }
function polyPath(g, pts) {
  if (!pts.length) return;
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
}

export function createTableScene(container, ui) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let mode = readMode(), quality = qualityOf(mode);
  const small = () => quality === 'baja';
  const dprOf = () => dprFor(quality);

  const bg = el('div', 'stage-bg');
  const tableCv = el('canvas', 'stage-cv'), itemsCv = el('canvas', 'stage-cv'), rivalsCv = el('canvas', 'stage-cv');
  const shade = el('div', 'stage-shade');
  const labelLayer = el('div', 'labels');
  container.append(bg, tableCv, itemsCv, rivalsCv, shade, labelLayer);

  const seats = Array.from({ length: MAXP }, (_, seat) => {
    const label = el('div', 'seat-tag');
    labelLayer.append(label);
    return { seat, label, show: false, ax: 0, ay: 0, layer: 0 };
  });
  const amounts = [];
  function amountLabel(i) {
    if (!amounts[i]) { const a = el('div', 'amt'); labelLayer.append(a); amounts[i] = { el: a, x: 0, y: 0, on: false }; }
    return amounts[i];
  }
  const seenAction = new Map();
  const anims = new Map();      // animación de cada rival, por id de jugador
  let snap = null, L = null, topMax = 0;
  let drawn = [], ring = null;  // rivales y aro de turno que dibuja el ciclo de animación
  let boardQuads = [];          // dónde quedan en pantalla las cartas comunitarias (el aro nunca las pisa)
  let betSpots = new Map(), betKey = '';   // dónde va la apuesta de cada rival (fijo para un acomodo)
  let labelSpots = new Map(), labelKey = ''; // y su etiqueta
  let itemList = [], myCardList = null, itemsRaf = 0; // lo que va sobre el fieltro (y mis cartas en el celular)
  let reveal = { hand: '', at: 0, marksAt: 0 };      // cuándo se voltean las cartas del final y se resalta la ganadora
  const ringCv = document.createElement('canvas'); // el aro se pinta aparte para borrarle lo que tapan fichas y cartas

  /* ---------- acomodo: perspectiva, mesa y fondo ---------- */
  const headWorld = Math.max(...Object.values(CHARACTERS).map(c => c.angles.frente.height * c.angles.frente.waist[1]));
  function measureTop() {
    const strip = container.parentElement && container.parentElement.querySelector('.strip');
    return strip ? strip.getBoundingClientRect().bottom - container.getBoundingClientRect().top : 70;
  }
  // Celular vertical: abajo van mis cartas (.mycards) y encima de ellas la barra; la mesa usa lo de arriba.
  // Devuelve cuánto ocupa eso desde la orilla de abajo y el alto de la franja de mis cartas.
  function measureBottom(H) {
    const slot = container.parentElement && container.parentElement.querySelector('.mycards');
    if (!slot) return { reserve: clamp(H * 0.36, 200, 320), cards: 100 };
    const r = slot.getBoundingClientRect();
    return { reserve: H - (r.top - container.getBoundingClientRect().top), cards: r.height };
  }
  function layout() {
    const W = container.clientWidth || innerWidth, H = container.clientHeight || innerHeight;
    if (!W || !H) return;
    const portrait = W / H < 0.9, phone = portrait && isPhone();
    topMax = Math.max(topMax, measureTop());
    // lo que ocupa la barra de acciones abajo (fijo, para que la mesa no brinque cuando cambia la barra);
    // en el celular, la barra y mis cartas: mi orilla de la mesa queda detrás de mis cartas
    const bottom = phone ? measureBottom(H) : null;
    const reserve = phone ? bottom.reserve : portrait ? clamp(H * 0.45, 250, 420) : clamp(H * 0.21, 130, 210);
    const near = phone ? H - reserve + bottom.cards * 0.45 : undefined;
    const cam = CAMERAS[portrait ? 'portrait' : 'landscape'];
    // `rivals`: cuánto más grandes se ven los rivales con esta cámara (con la de la mesa ilustrada, lejana, se verían
    // chicos junto a la mesa; en la referencia son grandes)
    const rivals = cam.rivals || 1;
    const v = fit(makeView({ W, H, top: topMax, reserve, near, portrait, cam }), headWorld * rivals, cam);
    const back = placeBackdrop(W, H, headTop(v, headWorld * rivals));
    // la línea de tinta es tan gruesa como la del fondo ilustrado al tamaño en que se ve
    const line = Math.max(1.2, BG_W * back * 0.0011);
    const dpr = dprOf();
    for (const c of [tableCv, itemsCv, rivalsCv]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = tableCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // la mesa ilustrada (en horizontal): si su imagen todavía no está, va la de código y se redibuja cuando llegue
    let art = null;
    if (!portrait && cam.art) {
      const url = tableArtUrl(W, small() ? 1 : dpr);
      art = loadedImage(url);
      if (!art) loadImage(url).then(() => layout(), () => {});
    }
    const outline = drawTable(g, v, line, art);
    bg.style.backgroundImage = `url("${backgroundUrl(H, small() ? 1 : dpr)}")`;
    // `lean`: lo que se levantan de más las cartas; `board`: tamaño de las comunitarias (en el celular, grandes) y
    // `boardZ`: lo más que se acercan a mí; `mine` y `mineX`: tamaño de mis cartas y dónde van (fracción del ancho)
    const board = cam.board || {}, mine = cam.mine || {};
    L = {
      W, H, v, line, dpr, portrait, phone, reserve, outline, front: frontRegion(outline), rivals,
      lean: (cam.lean || 0) * DEG, board: phone ? 1.4 : board.scale || 1.08, boardZ: board.z || 0,
      mine: mine.scale || 1.05, mineX: mine.x || 0.2,
    };
    betKey = ''; labelKey = '';
    clearPoseCache();
    place();
  }
  // Fondo: cubre la pantalla con la lámpara al centro y la orilla de abajo de su domo arriba de las cabezas
  // (config.js: BACKDROP). Devuelve la escala a la que se ve.
  function placeBackdrop(W, H, head) {
    const [lx, ly] = BACKDROP.lamp, want = head - BACKDROP.gap;
    const s = Math.max(W / BG_W, H / BG_H, ly < 1 ? (H - want) / ((1 - ly) * BG_H) : 0);
    const x = clamp(W / 2 - lx * BG_W * s, W - BG_W * s, 0);
    const y = clamp(want - ly * BG_H * s, H - BG_H * s, 0);
    bg.style.backgroundSize = `${BG_W * s}px ${BG_H * s}px`;
    bg.style.backgroundPosition = `${x}px ${y}px`;
    return s;
  }
  const ro = new ResizeObserver(() => { topMax = 0; layout(); });
  ro.observe(container);

  // Dónde y de qué tamaño va un rival sentado en el lugar `seat` (config.js): con la cintura en la orilla
  // de la mesa y del tamaño que le toca por su distancia a la cámara (`shrink` lo achica si hace falta).
  function seatPlace(seat, charId, shrink = 1) {
    if (L.portrait && seat.portrait) seat = { ...seat, ...seat.portrait, portrait: undefined };
    const want = seat.row === 'side' ? 'lado' : 'frente';
    const angle = angleOf(charId, want), art = artOf(charId, want);
    // `rim`: su lugar en la orilla (de ahí salen sus fichas); `at`: donde se sienta, `out` detrás de la orilla
    const rim = rimPoint(seat.ang), k = 1 + (seat.out || 0) / Math.hypot(rim.x, rim.z);
    // cada quien ve hacia el centro de la mesa: va en espejo si su imagen ve hacia el otro lado (`mira`)
    const mirror = needsMirror(charId, want, rim.x);
    const p = L.v.project(rim.x * k, RAIL_Y, rim.z * k);
    // recortado en la orilla: la cintura va justo en la línea de la orilla, en su columna
    const y = seat.cut === 'edge' ? edgeYAt(L.front, p.x) ?? p.y : p.y;
    const hpx = p.s * art.height * (seat.scale || 1) * L.rivals * L.v.grow * shrink, wpx = (hpx * art.size[0]) / art.size[1];
    const f = art.face;
    return placeAt({
      seat, charId, sillas: CHARACTERS[charId].sillas, rim, angle, mirror, hpx, wpx, x: p.x, y, depth: p.depth, waist: art.waist[1],
      wx: mirror ? 1 - art.waist[0] : art.waist[0],
      face: mirror ? [1 - f[2], f[1], 1 - f[0], f[3]] : f,
    });
  }
  // Recalcula la caja y el recorte después de acomodar x y y (la cintura).
  function placeAt(s) {
    s.left = s.x - s.wx * s.wpx;
    s.top = s.y - s.waist * s.hpx;
    // la mesa lo tapa de la cintura para abajo, o todo lo que cae debajo de la línea de la orilla (cut: 'edge')
    s.hidden = s.seat.cut === 'edge' ? L.front : belowRow(L.front, s.y);
    return s;
  }
  const faceBox = s => ({ x0: s.left + s.face[0] * s.wpx, x1: s.left + s.face[2] * s.wpx, y0: s.top + s.face[1] * s.hpx, y1: s.top + s.face[3] * s.hpx });
  // Lo que tapa un rival dibujado encima de otro: su cabeza y su torso (sin el aire a los lados de la cabeza).
  const coverBoxes = s => { const f = faceBox(s); return [f, { x0: s.left + s.wpx * 0.08, x1: s.left + s.wpx * 0.92, y0: f.y1, y1: s.y }]; };
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const covers = (front, back) => coverBoxes(front).some(c => hit(c, faceBox(back)));
  // Orden de dibujo: primero los del fondo (del más lejano al más cercano) y al final los de los lados.
  const layerOf = s => (s.seat.row === 'side' ? 1 : 0);
  const drawOrder = (a, b) => layerOf(a) - layerOf(b) || b.depth - a.depth;

  // Recorre a un rival sobre la orilla hasta la columna x: su cintura sigue en la línea de la orilla y, si es del fondo,
  // su lugar en la orilla (de ahí salen sus fichas y su apuesta) lo sigue. Los de los lados se sientan detrás de la
  // orilla, sobre la diagonal de mi lado: sus fichas se quedan donde estaban (si no, se irían junto a las mías).
  function slideTo(s, x) {
    s.x = x;
    s.y = edgeYAt(L.front, x) ?? s.y;
    if (s.seat.row === 'back') {
      const q = L.v.unproject(x, s.y, RAIL_Y);
      s.rim = rimPoint(Math.atan2(q.z, q.x) / DEG);
    }
    return placeAt(s);
  }

  // Los de los lados van delante y pueden tapar un poco los hombros de los del fondo, nunca la cara:
  // si la tapan, el del fondo se recorre hacia el centro sobre la orilla.
  function protectFaces(spots) {
    const sides = spots.filter(s => s.seat.row === 'side'), backs = spots.filter(s => s.seat.row === 'back');
    const gap = 6;
    for (const b of backs) {
      for (const s of sides) {
        const f = faceBox(b);
        const over = coverBoxes(s).filter(c => hit(c, f));
        if (!over.length) continue;
        const dx = s.seat.side === 'left' ? Math.max(...over.map(c => c.x1 + gap - f.x0)) : Math.min(...over.map(c => c.x0 - gap - f.x1));
        slideTo(b, b.x + dx);
      }
    }
  }

  // Don Tentáculos ocupa dos sillas (`sillas` en personajes.json): lo que se ve de él no se encima con lo que se ve
  // de sus vecinos. En la fila de rivales, de izquierda a derecha: si va en el fondo, se recorre sobre la orilla hacia
  // donde hay más espacio, y sus vecinos del fondo se recorren hacia afuera (cada uno, a lo más ROOM_MOVE de su
  // ancho, nunca hasta donde el de un lado le taparía la cara, y sin que su cabeza suba más que la más alta: en las
  // diagonales la orilla sube hacia el centro y arriba ya no cabría su etiqueta); si él va en un lado, se recorre hacia
  // la orilla de la pantalla mientras se le vea la cara, y los demás de los lados no se mueven. Si ni así cabe,
  // regresa [él, cuánto achicarlo]; si cabe, null.
  const ROOM_GAP = 6, ROOM_MOVE = 0.6, ROOM_MIN = 0.85;
  function makeRoom(spots) {
    const row = spots.slice().sort((a, b) => a.x - b.x), n = row.length;
    const j = row.findIndex(s => s.sillas > 1);
    if (j < 0) return null;
    // lo que se ve de cada uno (visibleSpan), relativo a su cintura
    const span = row.map(s => {
      const [a, b] = visibleSpan(s.charId, s.angle), [u, v] = s.mirror ? [1 - b, 1 - a] : [a, b];
      return [s.left + u * s.wpx - s.x, s.left + v * s.wpx - s.x];
    });
    const X = row.map(s => s.x);
    const lo = row.map(s => s.x - (s.seat.row === 'back' ? ROOM_MOVE * s.wpx : 0));
    const hi = row.map(s => s.x + (s.seat.row === 'back' ? ROOM_MOVE * s.wpx : 0));
    row.forEach((b, i) => {
      if (b.seat.row !== 'back') return;
      const f = faceBox(b);
      for (const s of row) {
        if (s.seat.row !== 'side') continue;
        const over = coverBoxes(s).filter(c => c.y0 < f.y1 && f.y0 < c.y1); // lo del de un lado a la altura de su cara
        if (!over.length) continue;
        if (s.seat.side === 'left') lo[i] = Math.max(lo[i], Math.max(...over.map(c => c.x1)) + ROOM_GAP - (f.x0 - b.x));
        else hi[i] = Math.min(hi[i], Math.min(...over.map(c => c.x0)) - ROOM_GAP - (f.x1 - b.x));
      }
      lo[i] = Math.min(lo[i], b.x); hi[i] = Math.max(hi[i], b.x); // donde ya está siempre se vale
    });
    // él, si va en un lado, puede irse un poco hacia la orilla de la pantalla, mientras se le vea toda la cara
    if (row[j].seat.row === 'side') {
      const f = faceBox(row[j]);
      if (row[j].seat.side === 'left') lo[j] = row[j].x - Math.max(0, f.x0 - 8);
      else hi[j] = row[j].x + Math.max(0, L.W - 8 - f.x1);
    }
    const top = Math.min(...row.map(s => faceBox(s).y0)); // la cabeza más alta
    const headAt = (s, x) => (edgeYAt(L.front, x) ?? s.y) - s.waist * s.hpx + s.face[1] * s.hpx;
    row.forEach((b, i) => {
      if (b.seat.row !== 'back') return;
      let a = b.x, c = b.x;
      while (a - 2 >= lo[i] && headAt(b, a - 2) >= top - 0.5) a -= 2;
      while (c + 2 <= hi[i] && headAt(b, c + 2) >= top - 0.5) c += 2;
      lo[i] = a; hi[i] = c;
    });
    const gap = i => X[i + 1] + span[i + 1][0] - (X[i] + span[i][1]); // entre el i y el que sigue
    // junto a él, ROOM_GAP; entre los demás, que no se encimen más que antes
    const need = row.slice(0, -1).map((_, i) => (i === j - 1 || i === j ? ROOM_GAP : Math.min(ROOM_GAP, gap(i))));
    const push = () => {
      // desde él hacia afuera, a cada lado, solo alejándose y cada quien hasta donde puede
      for (let i = j - 1; i >= 0; i--) X[i] = Math.max(lo[i], Math.min(X[i], X[i + 1] + span[i + 1][0] - need[i] - span[i][1]));
      for (let i = j + 1; i < n; i++) X[i] = Math.min(hi[i], Math.max(X[i], X[i - 1] + span[i - 1][1] + need[i - 1] - span[i][0]));
      // y de regreso: a quien ya no pudo recorrerse más no se le encima el siguiente (lo que falte, le falta a él)
      for (let i = 1; i < j; i++) X[i] = Math.max(X[i], X[i - 1] + span[i - 1][1] + need[i - 1] - span[i][0]);
      for (let i = n - 2; i > j; i--) X[i] = Math.min(X[i], X[i + 1] + span[i + 1][0] - need[i] - span[i][1]);
    };
    const short = () => [j > 0 ? need[j - 1] - gap(j - 1) : -Infinity, j < n - 1 ? need[j] - gap(j) : -Infinity];
    if (row[j].seat.row === 'back' && j > 0 && j < n - 1) { // entre sus vecinos, donde le sobre lo mismo de cada lado
      const mid = (X[j - 1] + span[j - 1][1] + X[j + 1] + span[j + 1][0]) / 2 - (span[j][0] + span[j][1]) / 2;
      X[j] = Math.max(lo[j], Math.min(hi[j], mid));
    }
    push();
    for (let t = 0; t < 3; t++) { // si de un lado no cupo y del otro sobra, se recorre él hacia allá
      const [fl, fr] = short();
      if (fl > 0.5 && fr < -0.5) X[j] = Math.min(hi[j], X[j] + Math.min(fl, -fr));
      else if (fr > 0.5 && fl < -0.5) X[j] = Math.max(lo[j], X[j] - Math.min(fr, -fl));
      else break;
      push();
    }
    row.forEach((s, i) => { if (Math.abs(X[i] - s.x) > 0.5) slideTo(s, X[i]); });
    const falta = short().reduce((a, f) => a + Math.max(0, f), 0);
    if (falta < 1) return null;
    const w = span[j][1] - span[j][0];
    return [row[j], Math.max(0, (w - falta) / w)];
  }

  // Acomoda a todos los rivales: el de dos sillas con su espacio (y, si no cabe, un poco más chico, hasta ROOM_MIN).
  // Si aun así alguno le tapa la cara a otro (pasa en pantallas angostas, donde los del fondo quedan muy juntos),
  // se achican todos un poco hasta que ya no.
  function placeSeats(seatOf, players) {
    let spots;
    const extra = new Map(); // asiento -> cuánto más chico va el de dos sillas
    for (let k = 0, shrink = 1; k < 15; k++, shrink *= 0.93) {
      for (let t = 0; t < 4; t++) {
        spots = new Map();
        for (const [seat, cfg] of seatOf) {
          const p = players.find(q => q.seat === seat);
          const s = seatPlace(cfg, characterFor(p), shrink * (extra.get(seat) || 1)); // un asiento vacío se acomoda como el primero
          s.key = seat;
          spots.set(seat, s);
        }
        protectFaces([...spots.values()]);
        const tight = makeRoom([...spots.values()]);
        if (!tight) break;
        const [big, f] = tight, now = extra.get(big.key) || 1;
        if (now <= ROOM_MIN + 1e-3) break;
        extra.set(big.key, Math.max(ROOM_MIN, now * f));
      }
      const list = [...spots.values()].sort(drawOrder);
      if (!list.some((a, i) => list.slice(i + 1).some(b => covers(b, a)))) break;
    }
    return spots;
  }

  /* ---------- acomodar la vista del servidor ---------- */
  function update(s) {
    snap = s;
    const H = container.clientHeight || innerHeight;
    if (!L || Math.abs(measureTop() - topMax) > 0.5 && measureTop() > topMax) layout();
    else if (L.phone !== (L.portrait && isPhone()) || L.phone && Math.abs(measureBottom(H).reserve - L.reserve) > 1) layout();
    else place();
  }

  function place() {
    if (!snap || !L) return;
    const v = snap.view, { v: view } = L;
    const now = performance.now();
    const me = v.players.find(p => p.id === snap.you);
    const started = v.handNo > 0, betting = BETTING.includes(v.phase);
    const showdown = v.phase === 'showdown' && v.results;
    const shown = showdown && !v.results.fold ? v.results.shown : [];
    const winners = showdown ? v.results.winners.map(w => w.id) : [];
    // al final, las cartas de quienes llegaron (menos las mías, que ya se ven) se voltean una tras otra en el
    // orden del resultado; luego se resaltan las 5 de la mano ganadora y se apagan todas las demás
    const flips = shown.filter(id => !me || id !== me.id), handKey = `${snap.code}:${v.handNo}`;
    if (shown.length && reveal.hand !== handKey) {
      const at = reduced.matches ? now - 60000 : now + 120;
      reveal = { hand: handKey, at, marksAt: at + Math.max(0, flips.length - 1) * FLIP_GAP + FLIP_MS + MARK_PAUSE };
    }
    const win5 = winningCards(showdown ? v.results : null);
    const markOf = code => (win5.size ? (win5.has(code) ? 'win' : 'dim') : null);
    // Sin asiento se mira desde un asiento libre para que nadie tape la mesa.
    const free = Array.from({ length: MAXP }, (_, i) => i).find(i => !v.players.some(p => p.seat === i));
    const base = me ? me.seat : free ?? 0;
    const rel = seat => (seat - base + MAXP) % MAXP;
    const front = !me ? v.players.find(p => p.seat === base) : null; // jugador en "mi" lugar si miro sin asiento
    const others = v.players.filter(p => p.seat !== base).sort((a, b) => rel(a.seat) - rel(b.seat));

    // dónde va cada asiento: el acomodo según cuántos rivales hay, en el orden real de juego
    // (el primero es el que habla después de mí, a mi izquierda)
    const seatOf = new Map();
    if (!me && !started) for (let r = 1; r < MAXP; r++) seatOf.set((base + r) % MAXP, FIXED[r - 1]);
    else others.slice(0, MAXP - 1).forEach((p, i) => seatOf.set(p.seat, LAYOUTS[Math.min(MAXP - 1, others.length)][i]));
    const spots = placeSeats(seatOf, v.players);

    // mi lugar: la fila de la mesa justo arriba de la barra de acciones; mis cartas abajo a la izquierda
    const meRow = L.H - L.reserve - 10;
    const zMe = clamp(view.unproject(L.W / 2, meRow).z, 0, NEAR_Z - 0.08);
    const xCards = clamp(view.unproject(L.W * L.mineX, meRow).x, -0.6, -0.2);
    const xStack = clamp(view.unproject(L.W * 0.78, meRow).x, 0.25, 0.6);
    // cartas comunitarias en fila al centro de la mesa; el bote, un montón cerca de mí abajo al centro
    const zBoard = clamp(zMe - 0.27, -0.3, L.boardZ), zPot = Math.max(zBoard + 0.2, zMe - 0.09);
    const items = [], amts = [];
    let betSum = 0, myCards = null;
    // cartas comunitarias (mismas medidas que dibuja items.js) y dónde caen en pantalla
    const boardScale = L.board;
    const boardAt = i => ({ x: (i - 2) * (CARD_W * boardScale + 0.014), z: zBoard });
    boardQuads = v.board.map((_, i) => { const c = cardCorners(boardAt(i), CARD_W * boardScale, CARD_H * boardScale, TILT.board + L.lean, 0); return [c.tl, c.tr, c.br, c.bl].map(q => view.project(q.x, q.y, q.z)); });
    const amt = (at, y, text, cls) => amts.push({ at, y, text, cls });
    const key = [zBoard, boardScale, xCards, xStack, ...[...spots].map(([seat, sp]) => `${seat}:${sp.rim.x},${sp.rim.z}`)].join('|');
    if (key !== betKey) { betKey = key; betSpots = planBets(spots, boardAt, CARD_W * boardScale, CARD_H * boardScale, zMe, zPot, xCards, xStack); }

    drawn = []; ring = null;
    const live = new Set(), fresh = new Set();
    for (const s of seats) {
      const p = v.players.find(q => q.seat === s.seat);
      const mine = !!me && s.seat === base;
      const isFront = !me && s.seat === base;
      const spot = spots.get(s.seat) || null;
      // quien quedó fuera del torneo ya no se dibuja, salvo mientras se ve el resultado de la mano en que llegó
      // al final (para que se vean sus cartas)
      const gone = p && p.out && !shown.includes(p.id);

      // rival dibujado
      if (p && spot && !gone) {
        live.add(p.id);
        const charId = characterFor(p);
        let a = anims.get(p.id);
        if (!a || a.charId !== charId) { a = new RivalAnim(charId, now); anims.set(p.id, a); fresh.add(p.id); }
        a.angle = spot.angle; // sus cuadros son los de este ángulo
        // reparto nuevo: deja de celebrar la mano anterior y espía sus cartas (escalonado, como si fueran repartiendo)
        if (a.hand !== undefined && a.hand !== v.handNo) a.calm();
        if (a.hand !== undefined && a.hand !== v.handNo && p.inHand) a.play('espia', 1700, now, 350 + rel(s.seat) * 220);
        a.hand = v.handNo;
        const la = p.lastAction;
        if (la && a.lastN !== undefined && la.n !== a.lastN) a.react(la.type, spot.angle, p.sittingOut, now);
        a.lastN = la ? la.n : a.lastN ?? null;
        const dim = (p.inHand && p.folded) || p.sittingOut;
        drawn.push({ id: p.id, charId, ...spot, dim, idle: p.inHand && !p.folded });
      }

      // fichas, apuesta, botón del dealer y cartas enseñadas
      if (p && !gone) {
        // frente a cada rival, sobre la línea que va de su lugar en la orilla al centro (r = 1 es la orilla)
        const { d, tan, on } = rimLine(spot ? spot.rim : { x: 0, z: 1 });
        const myStack = { x: xStack, z: zMe - 0.03 };
        if (mine || isFront) items.push({ kind: 'stack', amount: p.stack, at: myStack, across: { x: 1, z: 0 }, back: { x: 0, z: -1 }, seed: s.seat + 1 });
        else if (spot) {
          const st = { kind: 'stack', amount: p.stack, at: on(0.74), across: tan, back: d, seed: s.seat + 1 };
          items.push(st);
          if (v.toAct === p.id && betting) ring = L.phone ? ringBeside(on) : ringAround(st);
        }
        if (betting && p.bet > 0 && (spot || mine || isFront)) {
          betSum += p.bet;
          const at = betSpots.get(mine || isFront ? 'me' : s.seat);
          // la apuesta de un rival crece hacia él (no hacia las cartas comunitarias)
          items.push({ kind: 'stack', amount: p.bet, at, across: mine || isFront ? { x: 1, z: 0 } : tan, back: mine || isFront ? { x: 0, z: -1 } : d, seed: s.seat + 11 });
          amt(at, 0.05, ui.fmt(p.bet), mine ? 'mine' : '');
        }
        // el botón del dealer va justo a la derecha de mis cartas (en el celular mis cartas van fuera de la mesa: se
        // pasa junto a mi pila)
        const myDealer = L.phone ? { x: xStack - 0.2, z: zMe - 0.03 } : { x: xCards + 0.11 + (CARD_W * L.mine) / 2 + 0.075, z: zMe - 0.03 };
        if (started && v.dealerSeat === s.seat) items.push({ kind: 'dealer', at: mine || isFront ? myDealer : on(0.66, -0.2) });
        const holding = p.inHand && p.cards.length && !p.folded;
        if (holding && mine && L.phone) myCards = p.cards;
        else if (holding && mine) p.cards.forEach((code, i) => items.push({ kind: 'card', code, mark: markOf(code), at: { x: xCards + i * 0.11, z: zMe + (i ? 0.004 : 0) }, tilt: TILT.mine + L.lean, yaw: i ? -0.07 : 0.06, scale: L.mine }));
        else if (holding && shown.includes(p.id)) {
          // las cartas que enseña, frente a él (en el celular más grandes, para que se lean)
          const big = L.phone ? 1.3 : 1, turn = reveal.at + Math.max(0, flips.indexOf(p.id)) * FLIP_GAP;
          p.cards.forEach((code, i) => items.push({
            kind: 'card', code, mark: markOf(code), reveal: turn, tilt: TILT.shown + L.lean, yaw: 0, scale: 0.95 * big,
            at: isFront ? { x: xCards + i * 0.11, z: zMe } : on(0.6, (i - 0.5) * (CARD_W * big + 0.012)),
          }));
        }
      }

      // etiqueta sobre la cabeza (o donde iría la cabeza en un asiento libre)
      s.layer = spot ? layerOf(spot) : 0;
      s.anchored = !!(spot || isFront);
      s.face = null;
      if (isFront) { const q = view.project(0, 0.1, zMe); s.ax = q.x; s.ay = q.y; }
      else if (spot) { const f = faceBox(spot); s.face = f; s.ax = (f.x0 + f.x1) / 2; s.ay = p ? f.y0 + spot.hpx * 0.02 : f.y0 + spot.hpx * 0.25; }
      s.show = fillLabel(s, p, { mine, me, started, v, shown, winners, empty: !p && (spot || isFront) });
      s.label.style.display = s.show ? '' : 'none';
    }
    for (const id of anims.keys()) if (!live.has(id)) anims.delete(id);
    // Al cerrar una ronda, el servidor borra la jugada de cada quien en el mismo instante: la última
    // igualada solo se ve en la última jugada de la mesa (v.lastAction), que no se borra.
    const ga = v.lastAction, last = ga && anims.get(ga.id);
    if (last && !fresh.has(ga.id) && last.lastN !== ga.n) {
      const gd = drawn.find(d => d.id === ga.id), gp = v.players.find(q => q.id === ga.id);
      if (gd) last.react(ga.type, gd.angle, gp && gp.sittingOut, now);
      last.lastN = ga.n;
    }
    // quien gana enseña su cuadro de "gana" mientras se ve el resultado (si su personaje lo tiene), en cuanto
    // se resalta la mano ganadora; va después de las reacciones para que la última jugada no lo borre
    if (showdown) for (const id of winners) {
      const a = anims.get(id), d = drawn.find(x => x.id === id);
      if (!a || !d || a.wonHand === v.handNo) continue;
      a.wonHand = v.handNo;
      a.win(d.angle, now, snap.resultMs || 8000, Math.max(0, (shown.length ? reveal.marksAt : now + 200) - now));
    }

    // bote en el centro (las apuestas de la ronda siguen frente a cada quien)
    const pot = v.players.reduce((a, p) => a + (p.total || 0), 0) - (betting ? betSum : 0);
    if (pot > 0) {
      const at = { x: 0, z: zPot };
      items.push({ kind: 'stack', amount: pot, at, across: { x: 1, z: 0 }, back: { x: 0, z: -1 }, seed: 99, messy: true });
      amt(at, 0.06, `Bote ${ui.fmt(pot)}`, 'pot');
    }
    v.board.forEach((code, i) => items.push({ kind: 'card', code, mark: markOf(code), at: boardAt(i), tilt: TILT.board + L.lean, yaw: 0, scale: boardScale }));

    // capa de fichas y cartas
    itemList = items;
    myCardList = myCards && myCards.map(code => ({ code, mark: markOf(code) }));
    paintItems();

    // montos encima de cada apuesta y del bote
    amts.forEach((m, i) => {
      const a = amountLabel(i), q = view.project(m.at.x, m.y, m.at.z);
      a.on = true; a.el.className = 'amt ' + (m.cls || ''); a.el.textContent = m.text; a.el.style.display = '';
      a.el.style.transform = `translate(${q.x}px,${q.y}px) translate(-50%,-100%)`;
    });
    for (let i = amts.length; i < amounts.length; i++) { amounts[i].on = false; amounts[i].el.style.display = 'none'; }
    drawn.sort(drawOrder);
    placeLabels();
    wake();
  }

  // Capa de fichas y cartas: se pinta una vez por jugada y, al final de la mano, cuadro por cuadro mientras se
  // voltean las cartas y hasta que se resalta la mano ganadora.
  function paintItems() {
    cancelAnimationFrame(itemsRaf); itemsRaf = 0;
    if (!L) return;
    const now = performance.now(), marked = now >= reveal.marksAt;
    let busy = false;
    const list = itemList.map(it => {
      if (it.kind !== 'card') return it;
      let c = it;
      const t = it.reveal === undefined ? 1 : (now - it.reveal) / FLIP_MS;
      // boca abajo hasta su turno; a la mitad del giro ya se ve la cara
      if (t < 1) { busy = true; c = { ...c, code: t < 0.5 ? null : c.code, flip: t <= 0 ? 1 : Math.max(0.03, Math.abs(Math.cos(Math.PI * t))) }; }
      if (c.mark && !marked) { busy = true; c = { ...c, mark: null }; }
      return c;
    });
    const g = itemsCv.getContext('2d');
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.clearRect(0, 0, L.W, L.H);
    drawItems(g, L.v, list, L.line);
    if (myCardList) drawMyCards(g, myCardList.map(c => (marked ? c : { ...c, mark: null })));
    if (busy) itemsRaf = requestAnimationFrame(paintItems); // con la pestaña oculta espera a que se vea
  }

  // Dónde va la apuesta de cada rival. Sobre la línea de su lugar al centro, lo más cerca posible de la mitad,
  // sin tapar nunca las cartas comunitarias (los 5 lugares, aunque aún no salgan), el bote ni mis cartas, y de
  // ser posible tampoco su propia pila, mi pila, mi apuesta ni la apuesta de otro rival (con 6 rivales no
  // siempre caben); y sin cruzarse con las de sus vecinos. Para las cartas y el bote se mide con la apuesta
  // más ancha posible (5 columnas altas, con su monto encima); para lo demás, con una de 3 columnas. Así el
  // lugar es fijo para cada acomodo y no depende de cuánto apueste.
  function planBets(spots, boardAt, cw, ch, zMe, zPot, xCards, xStack) {
    const pad = b => ({ x0: b.x0 - 6, x1: b.x1 + 6, y0: b.y0 - 6, y1: b.y1 + 6 });
    const never = [0, 1, 2, 3, 4].map(i => { const c = cardCorners(boardAt(i), cw, ch, TILT.board + L.lean, 0); return pad(screenBox([c.tl, c.tr, c.br, c.bl])); });
    never.push(stackBox({ x: 0, z: zPot }, { x: 1, z: 0 }, { x: 0, z: -1 }, 3, 0.05));
    if (!L.phone) for (const i of [0, 1]) { // mis cartas (en el celular van fuera de la mesa)
      const c = cardCorners({ x: xCards + i * 0.11, z: zMe }, CARD_W * L.mine, CARD_H * L.mine, TILT.mine + L.lean, 0);
      never.push(pad(screenBox([c.tl, c.tr, c.br, c.bl])));
    }
    // mi apuesta: frente a mí, entre las comunitarias y el bote; un poco más acá o a la derecha si taparía algo
    let mine = null;
    for (let dz = 0; dz <= 0.121 && !mine; dz += 0.01) for (const x of [0.06, 0.12, 0.18]) {
      const at = { x, z: zMe - 0.24 + dz };
      if (!never.some(b => overlapArea(b, stackBox(at, { x: 1, z: 0 }, { x: 0, z: -1 }, 1, 0.05)))) { mine = at; break; }
    }
    mine = mine || { x: 0.06, z: zMe - 0.24 };
    const avoid = [stackBox(mine, { x: 1, z: 0 }, { x: 0, z: -1 }, 1, 0.05, 3), stackBox({ x: xStack, z: zMe - 0.03 }, { x: 1, z: 0 }, { x: 0, z: -1 }, 2, 0)];
    // lugares a probar: hacia él o hacia el centro y un poco de lado (poco, y cuesta más: que siga frente a su rival)
    const tries = [];
    for (let dr = -0.12; dr <= 0.241; dr += 0.02) for (let t = -0.15; t <= 0.151; t += 0.03) tries.push({ dr, t, cost: dr * dr + 3 * t * t });
    // en el orden en que están sentados alrededor de la mesa: las apuestas no se cruzan (vista desde el centro,
    // cada una queda entre las de sus vecinos), si no parecería la apuesta del de junto
    const angOf = p => (Math.atan2(p.z, p.x) * 180 / Math.PI + 360) % 360;
    const list = [...spots].map(([seat, spot]) => {
      const { d, tan, on } = rimLine(spot.rim);
      return { seat, d, tan, on, ang: angOf(spot.rim), own: stackBox(on(0.74), tan, d, 2, 0), best: null };
    }).sort((a, b) => a.ang - b.ang);
    // cada quien escoge su mejor lugar viendo dónde quedaron los demás; unas vueltas, para que el primero no
    // le gane el único hueco a su vecino
    for (let round = 0; round < 4; round++) {
      list.forEach((r, i) => {
        const others = list.filter(o => o !== r && o.best).map(o => o.best);
        const left = list.slice(0, i).reverse().find(o => o.best), right = list.slice(i + 1).find(o => o.best);
        let best = null;
        for (const { dr, t, cost } of tries) {
          const at = r.on(0.5 + dr, t), box = stackBox(at, r.tan, r.d, 1, 0.05), usual = stackBox(at, r.tan, r.d, 1, 0.05, 3), tag = amountBox(at);
          // tapar cartas o bote, nunca; que su monto pise otra apuesta (o al revés), casi nunca; meterse en su
          // propia pila (parecería parte de ella), poco; encimarse con otra cosa cuesta lo mismo que alejarse ~0.1
          // por cada 2000 px²
          const crossed = (left && angOf(at) < angOf(left.best.at) + 4) || (right && angOf(at) > angOf(right.best.at) - 4);
          const hits = never.reduce((a, b) => a + 1e6 * overlapArea(b, box), 0) + (crossed ? 1e8 : 0)
            + others.reduce((a, o) => a + 1e3 * (overlapArea(o.tag, usual) + overlapArea(o.usual, tag)) + overlapArea(o.usual, usual), 0)
            + 300 * overlapArea(r.own, usual) + avoid.reduce((a, b) => a + overlapArea(b, usual), 0) + cost * 2e5;
          if (!best || hits < best.hits) best = { at, box, usual, tag, hits };
        }
        r.best = best;
      });
    }
    return new Map([['me', mine], ...list.map(r => [r.seat, r.best.at])]);
  }
  // Caja en pantalla de una pila sobre `at`: `cols` columnas de 12 fichas a lo largo de `across` y `rows` filas
  // hacia `back`, más su monto escrito encima si `label` (la altura a la que va, como en amt()).
  function stackBox(at, across, back, rows, label, cols = 5) {
    const gap = CHIP_R * 2 + 0.005, u = ((cols - 1) / 2) * gap + CHIP_R, pts = [];
    for (const cu of [-u, u]) for (const cw of [-CHIP_R, (rows - 1) * gap + CHIP_R]) for (const y of [0, 12 * CHIP_H]) {
      pts.push({ x: at.x + across.x * cu + back.x * cw, y, z: at.z + across.z * cu + back.z * cw });
    }
    const b = screenBox(pts);
    if (!label) return b;
    const q = amountBox(at, label);
    return { x0: Math.min(b.x0, q.x0), x1: Math.max(b.x1, q.x1), y0: Math.min(b.y0, q.y0), y1: b.y1 };
  }
  // El monto escrito encima de una apuesta (como en amt()): ~64 px de ancho y ~24 de alto.
  function amountBox(at, y = 0.05) {
    const q = L.v.project(at.x, y, at.z);
    return { x0: q.x - 32, x1: q.x + 32, y0: q.y - 24, y1: q.y };
  }
  function screenBox(pts) {
    const ps = pts.map(p => L.v.project(p.x, p.y || 0, p.z));
    return { x0: Math.min(...ps.map(p => p.x)), x1: Math.max(...ps.map(p => p.x)), y0: Math.min(...ps.map(p => p.y)), y1: Math.max(...ps.map(p => p.y)) };
  }

  // Aro de turno: rodea la pila del rival que tiene el turno, centrado en ella (frente a él), como si
  // estuviera pintado en el fieltro: las fichas y las cartas comunitarias quedan encima.
  function ringAround(st) {
    const u = st.across, w = st.back, cols = stackFootprint(st);
    const loc = c => ({ u: (c.x - st.at.x) * u.x + (c.z - st.at.z) * u.z, w: (c.x - st.at.x) * w.x + (c.z - st.at.z) * w.z });
    const ls = cols.length ? cols.map(loc) : [{ u: 0, w: 0 }];
    const span = k => [Math.min(...ls.map(q => q[k])), Math.max(...ls.map(q => q[k]))];
    const [u0, u1] = span('u'), [w0, w1] = span('w'), pad = CHIP_R + 0.035;
    const c = { u: (u0 + u1) / 2, w: (w0 + w1) / 2 }, hu = (u1 - u0) / 2 + pad, hw = (w1 - w0) / 2 + pad;
    const at = { x: st.at.x + u.x * c.u + w.x * c.w, z: st.at.z + u.z * c.u + w.z * c.w };
    // lo que tapan las columnas de fichas: de la cara de arriba a la base
    const holes = cols.map(col => {
      const b = L.v.project(col.x, 0, col.z), t = L.v.project(col.x, col.n * CHIP_H, col.z), rx = CHIP_R * b.s;
      const ry = Math.abs(L.v.project(col.x, 0, col.z + CHIP_R).y - L.v.project(col.x, 0, col.z - CHIP_R).y) / 2;
      return { x: b.x - rx, y: t.y - ry, w: rx * 2, h: b.y - t.y + ry };
    });
    const points = k => Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2, cu = Math.cos(a) * hu * k, cw = Math.sin(a) * hw * k;
      return L.v.project(at.x + u.x * cu + w.x * cw, 0, at.z + u.z * cu + w.z * cw);
    });
    return { points, holes };
  }

  // En el celular el aro sigue como antes: a un lado de la pila, entre ella y la orilla; si tocaría las
  // cartas comunitarias (se ven más altas de lo que miden porque van inclinadas), se recorre hacia el rival.
  const RING_R = 0.1;
  const ringPoints = (at, r) => Array.from({ length: 32 }, (_, i) => L.v.project(at.x + Math.cos((i / 32) * Math.PI * 2) * r, 0, at.z + Math.sin((i / 32) * Math.PI * 2) * r));
  function ringBeside(on) {
    const boxes = boardQuads.map(q => ({ x0: Math.min(...q.map(p => p.x)) - 4, x1: Math.max(...q.map(p => p.x)) + 4, y0: Math.min(...q.map(p => p.y)) - 4, y1: Math.max(...q.map(p => p.y)) + 4 }));
    let at = null;
    for (let r = 0.8; r <= 1.001; r += 0.04) {
      at = on(r, -0.14);
      const pts = ringPoints(at, RING_R * 1.07);
      const box = { x0: Math.min(...pts.map(p => p.x)), x1: Math.max(...pts.map(p => p.x)), y0: Math.min(...pts.map(p => p.y)), y1: Math.max(...pts.map(p => p.y)) };
      if (!boxes.some(b => hit(b, box))) break;
    }
    return { points: k => ringPoints(at, RING_R * k), holes: [] };
  }

  // Celular: mis dos cartas grandes y derechas, en la franja entre la mesa y la barra (.mc-cards).
  // cards: [{ code, mark }] (mark: 'win' o 'dim' al final de la mano, como las de la mesa)
  function drawMyCards(g, cards) {
    const box = container.parentElement && container.parentElement.querySelector('.mc-cards');
    if (!box) return;
    const r = box.getBoundingClientRect(), c0 = container.getBoundingClientRect();
    const hgt = r.height * 0.92, w = (hgt * CARD_PX[0]) / CARD_PX[1];
    const x0 = r.left - c0.left + w * 0.08, y0 = r.top - c0.top + r.height * 0.06;
    cards.forEach(({ code, mark }, i) => {
      const cx = x0 + w / 2 + i * w * 0.86, cy = y0 + hgt / 2, a = (i ? 4 : -4) * Math.PI / 180;
      g.save();
      g.translate(cx, cy); g.rotate(a);
      g.fillStyle = 'rgba(14,8,4,0.45)'; // sombra plana
      roundRect(g, -w / 2 + 4, -hgt / 2 + 5, w, hgt, w * 0.1); g.fill();
      g.drawImage(cardImage(code), -w / 2, -hgt / 2, w, hgt);
      if (mark) {
        roundRect(g, -w / 2, -hgt / 2, w, hgt, w * 0.117);
        if (mark === 'dim') { g.fillStyle = 'rgba(29,22,17,0.52)'; g.fill(); }
        else { g.lineJoin = 'round'; g.lineWidth = L.line * 4.4; g.strokeStyle = INK; g.stroke(); g.lineWidth = L.line * 2.4; g.strokeStyle = '#d9a441'; g.stroke(); }
      }
      g.restore();
    });
  }

  // Etiquetas encima de cada rival. Cada asiento tiene un lugar fijo, pegado a su rival, que solo se
  // recalcula cuando cambia el acomodo (pantalla o asientos), nunca por lo que diga la etiqueta: se acomodan
  // todas con el tamaño de la etiqueta más grande posible y cada una se ancla por la orilla que da a su
  // rival, con un piquito que apunta a su cabeza; si la etiqueta crece o se encoge, ese punto no se mueve.
  // No se enciman entre sí ni tapan caras (los ojos: se permite pisar la coronilla), no se salen de la
  // pantalla ni se meten debajo de la franja de arriba. Cada una prueba lugares en orden: sobre su rival, un
  // poco de lado, más arriba (al espacio del garaje) y al final más abajo; en el celular (siempre compactas)
  // también abajo de la cara, sobre el pecho. Primero las de los del fondo y luego las de los lados.
  const TAIL = 7; // lo que sobresale el piquito
  const probe = el('div', 'seat-tag probe');
  probe.setAttribute('aria-hidden', 'true');
  labelLayer.append(probe);
  function placeLabels() {
    labelLayer.classList.toggle('compact', L.phone);
    // la etiqueta más grande posible: el nombre de bot más largo (en el celular, en dos renglones), fichas y
    // "Pensando…" con su tiempo
    if (!probe.firstChild) {
      const nm = el('div', 'nm'), bot = el('span', 'bot');
      nm.textContent = LONGEST_NAME; bot.textContent = 'BOT'; nm.append(bot);
      const stk = el('div', 'stk'), act = el('div', 'act a-think');
      stk.textContent = '5,000'; act.textContent = 'Pensando… 0:45';
      probe.append(nm, stk, act);
    }
    const lw = probe.offsetWidth, lh = probe.offsetHeight;
    const list = seats.filter(s => s.anchored);
    const key = [L.W, L.H, lw, lh, ...list.map(s => `${s.seat}:${Math.round(s.ax)},${Math.round(s.ay)}`)].join('|');
    if (key !== labelKey) { labelKey = key; labelSpots = planLabels(list, lw, lh); }
    for (const s of seats) {
      const at = labelSpots.get(s.seat);
      if (!s.show || !at) continue;
      // el piquito apunta al centro de su cabeza (sin salirse de la etiqueta)
      const w = s.label.offsetWidth;
      s.label.style.setProperty('--tail', `${clamp(s.ax - at.x, -w / 2 + 12, w / 2 - 12)}px`);
      s.label.classList.toggle('below', at.below);
      s.label.style.transform = `translate(${at.x}px,${at.below ? at.y + TAIL : at.y - TAIL}px) translate(-50%,${at.below ? '0' : '-100%'})`;
    }
  }
  function planLabels(list, lw, lh) {
    const labelTop = topMax + 8, half = lw / 2 + 4, H = lh + TAIL;
    const faces = drawn.map(r => { const f = faceBox(r); return { ...f, y0: f.y0 + (f.y1 - f.y0) * 0.25 }; });
    const inside = x => clamp(x, half, Math.max(half, L.W - half));
    const order = list.slice().sort((a, b) => a.layer - b.layer || b.ay - a.ay);
    const placed = [], out = new Map();
    for (const s of order) {
      // y: la orilla de la etiqueta que da a su rival (abajo si va arriba de él; arriba si va debajo)
      const y0 = Math.max(labelTop + H, s.ay - 2), step = H + 5;
      const ups = [];
      for (let y = y0 - step; y - H >= labelTop; y -= step) ups.push(y);
      const above = [y0, ...ups].map(y => ({ y, below: false }));
      let cands;
      if (L.phone) {
        // en el celular también abajo de la cara; los de los lados, antes que irse muy arriba (arriba de ellos
        // quedan las etiquetas de los del fondo y ya no se vería de quién es)
        const f = s.face || { y1: y0 };
        const below = [0, 1, 2].map(k => ({ y: f.y1 + 2 + k * step, below: true }));
        cands = s.layer ? [above[0], ...below, ...above.slice(1)] : [...above, ...below];
      } else cands = [...above, ...[1, 2, 3].map(k => ({ y: y0 + k * step, below: false }))];
      const dxs = L.phone ? [0, -0.15, 0.15, -0.3, 0.3, -0.5, 0.5] : [0, -0.15, 0.15, -0.3, 0.3];
      let best = null;
      for (const c of cands) {
        for (const dx of dxs) {
          const x = inside(s.ax + dx * lw);
          const box = c.below ? { x0: x - lw / 2 - 2, x1: x + lw / 2 + 2, y0: c.y - 2, y1: c.y + H + 2 } : { x0: x - lw / 2 - 2, x1: x + lw / 2 + 2, y0: c.y - H - 2, y1: c.y + 2 };
          const cost = placed.reduce((a, o) => a + overlapArea(o, box), 0) + faces.reduce((a, f) => a + 3 * overlapArea(f, box), 0)
            + (box.y1 > L.H - L.reserve ? 1e6 : 0); // nunca sobre la barra de abajo
          if (!best || cost < best.cost) best = { x, y: c.y, below: c.below, box, cost };
          if (cost === 0) break;
        }
        if (best.cost === 0) break;
      }
      placed.push(best.box);
      out.set(s.seat, best);
    }
    return out;
  }

  function fillLabel(s, p, o) {
    const { h, fmt, deadline } = ui;
    const lab = s.label;
    lab.className = 'seat-tag';
    if (o.mine) return false;
    if (!p) {
      if (o.started || !o.empty) return false;
      if (!o.me) lab.replaceChildren(h('button', { class: 'sit', onclick: () => ui.onSit(s.seat) }, 'Sentarme aquí'));
      else return false;
      return true;
    }
    const v = o.v;
    const name = () => h('div', { class: 'nm', title: p.nick }, p.nick, p.isBot && h('span', { class: 'bot', title: 'Controlado por la computadora' }, 'BOT'));
    const dealer = () => o.started && v.dealerSeat === p.seat && h('span', { class: 'dl', title: 'Reparte' }, 'D');
    // se retiró de esta mano: solo su nombre, apagado (sin fichas ni sello)
    if (p.inHand && p.folded && !p.out && !p.sittingOut) {
      lab.classList.add('dim', 'folded');
      lab.replaceChildren(...[name(), dealer()].filter(Boolean));
      return true;
    }
    if (v.toAct === p.id && BETTING.includes(v.phase)) lab.classList.add('turn');
    if (o.winners.includes(p.id)) lab.classList.add('win');
    if ((p.inHand && p.folded) || p.out || p.sittingOut) lab.classList.add('dim');
    let tag = '';
    if (p.out) tag = `Fuera (${p.place}.º)`;
    else if (p.sittingOut) tag = 'Ausente';
    else if (p.stack === 0 && o.started && !p.allIn) tag = 'Sin fichas';
    else if (p.allIn) tag = 'All-in';
    const handName = o.shown.includes(p.id) && v.results.hands && v.results.hands[p.id];
    // la última jugada de este rival, con un globito que salta cuando es nueva
    const la = p.lastAction && BETTING.includes(v.phase) && !p.out ? p.lastAction : null;
    let badge = null;
    if (la) {
      const text = la.allIn && la.type !== 'fold' && la.type !== 'check' ? `All-in ${fmt(la.amount)}` : ACTION[la.type](fmt(la.amount));
      badge = h('div', { class: `act ${la.allIn ? 'a-allin' : ACTION_CLS[la.type]}` }, text);
      if (seenAction.get(p.id) !== la.n) { seenAction.set(p.id, la.n); if (o.started) lab.classList.add('pop'); }
    }
    const thinking = v.toAct === p.id && BETTING.includes(v.phase);
    lab.replaceChildren(...[
      name(),
      h('div', { class: 'stk' }, fmt(p.stack)),
      handName ? h('div', { class: 'hn' }, handName)
        : thinking ? h('div', { class: 'act a-think' }, 'Pensando…', !p.isBot && snap.turnLeftMs != null && [' ', deadline(snap.turnLeftMs, 'low')])
          : badge || (tag && h('div', { class: 'tg' }, tag)),
      dealer(),
      p.isBot && !o.started && o.me && h('button', { class: 'linkbtn', onclick: () => ui.onRemoveBot(p.seat) }, 'Quitar'),
    ].filter(Boolean));
    return true;
  }

  /* ---------- ciclo de animación de los rivales (se pausa si la pestaña no se ve) ---------- */
  let raf = 0, active = false, lastDraw = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - lastDraw < 1000 / (quality === 'baja' ? 20 : 30) - 2) return;
    lastDraw = now;
    drawRivals(now);
  }
  // Con ?medidas en la dirección, sobre cada rival: el marco de su imagen, la caja de la cara (face: ninguna
  // etiqueta la tapa), la línea de la cintura con su punto (waist: de ahí para abajo lo tapa la mesa) y el id
  // del personaje. Sirve para ajustar a mano personajes.json.
  function drawMeasures(g) {
    g.save();
    g.lineWidth = 2;
    g.font = '15px "Patrick Hand", sans-serif';
    g.textBaseline = 'bottom';
    for (const r of drawn) {
      const f = faceBox(r);
      g.setLineDash([]);
      g.strokeStyle = 'rgba(239,228,200,0.55)'; g.strokeRect(r.left, r.top, r.wpx, r.hpx);
      g.strokeStyle = '#e0b552';
      g.beginPath(); g.moveTo(r.left, r.y); g.lineTo(r.left + r.wpx, r.y); g.stroke();
      g.beginPath(); g.arc(r.x, r.y, 5, 0, Math.PI * 2); g.stroke();
      g.setLineDash([6, 4]);
      g.strokeStyle = '#d24a2f'; g.strokeRect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0);
      g.fillStyle = '#efe4c8'; g.fillText(r.charId, f.x0 + 2, f.y1 - 2);
    }
    g.restore();
  }
  function drawRivals(now) {
    if (!L) return;
    const g = rivalsCv.getContext('2d'), still = reduced.matches;
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.clearRect(0, 0, L.W, L.H);
    for (const r of drawn) {
      const a = anims.get(r.id);
      const pose = a ? a.frame(now, r.idle) : 'espera';
      const dim = r.dim && !(a && a.folding(now)); // se apaga cuando termina de retirarse
      const pxH = Math.round(r.hpx * L.dpr);
      const img = poseCanvas(r.charId, r.angle, pose, small(), pxH, dim) || poseCanvas(r.charId, r.angle, 'espera', small(), pxH, dim);
      if (!img) continue;
      g.save();
      g.beginPath(); polyPath(g, L.outline); g.clip();
      if (r.seat.cut === 'edge') {
        // sombra suave sobre el riel donde "toca" la mesa, inclinada como la orilla, para que no flote
        const d = r.wpx * 0.25, a = Math.atan2((edgeYAt(L.front, r.x + d) ?? r.y) - (edgeYAt(L.front, r.x - d) ?? r.y), 2 * d);
        g.translate(r.x, r.y); g.rotate(a); g.scale(1, 0.2);
        const rad = r.wpx * 0.5, sh = g.createRadialGradient(0, 0, 0, 0, 0, rad);
        sh.addColorStop(0, 'rgba(14,8,4,0.6)'); sh.addColorStop(0.6, 'rgba(14,8,4,0.28)'); sh.addColorStop(1, 'rgba(14,8,4,0)');
        g.fillStyle = sh; g.fillRect(-rad, -rad, rad * 2, rad * 2);
      } else {
        // sombra plana de contacto sobre la mesa, justo debajo de la cintura: se ve recargado en la mesa
        g.beginPath(); g.ellipse(r.x, r.y + r.hpx * 0.012, r.wpx * 0.3, r.hpx * 0.035, 0, 0, Math.PI * 2);
        g.fillStyle = 'rgba(12,16,6,0.3)'; g.fill();
      }
      g.restore();
      g.save();
      // la mesa tapa al rival de la cintura para abajo: se recorta lo que cae sobre la mesa debajo de su cintura
      g.beginPath(); g.rect(0, 0, L.W, L.H); polyPath(g, r.hidden); g.clip('evenodd');
      // retirado o ausente: apagado y un poco transparente
      if (dim) g.globalAlpha = 0.9;
      const b = still || !a ? 0 : a.breath(now / 1000);
      g.translate(r.x, r.y); g.scale(1, 1 + b); g.translate(-r.x, -r.y);
      if (r.mirror) { g.translate(r.left * 2 + r.wpx, 0); g.scale(-1, 1); } // espejo sobre su propia caja
      g.drawImage(img, r.left, r.top, r.wpx, r.hpx);
      g.restore();
    }
    if (MEDIDAS) drawMeasures(g);
    if (ring) { // aro mostaza alrededor de la pila de quien está pensando (late, salvo con movimiento reducido)
      const k = 1 + (still ? 0 : Math.sin(now / 200) * 0.06);
      const pts = ring.points(k), pad = L.line * 3;
      const x0 = Math.floor(Math.min(...pts.map(p => p.x)) - pad), y0 = Math.floor(Math.min(...pts.map(p => p.y)) - pad);
      const w = Math.ceil(Math.max(...pts.map(p => p.x)) + pad) - x0, h = Math.ceil(Math.max(...pts.map(p => p.y)) + pad) - y0;
      const cw = Math.max(1, Math.round(w * L.dpr)), ch = Math.max(1, Math.round(h * L.dpr));
      if (ringCv.width < cw || ringCv.height < ch) { ringCv.width = Math.max(ringCv.width, cw); ringCv.height = Math.max(ringCv.height, ch); }
      const o = ringCv.getContext('2d');
      o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, ringCv.width, ringCv.height);
      o.setTransform(L.dpr, 0, 0, L.dpr, -x0 * L.dpr, -y0 * L.dpr);
      o.beginPath(); polyPath(o, pts);
      o.lineJoin = 'round';
      o.lineWidth = L.line * 4; o.strokeStyle = '#1d1611'; o.stroke();
      o.lineWidth = L.line * 2.2; o.strokeStyle = '#d9a441'; o.stroke();
      // lo que queda detrás de las fichas de la pila y de las cartas comunitarias no se ve
      o.globalCompositeOperation = 'destination-out';
      ring.holes.forEach(r => o.fillRect(r.x, r.y, r.w, r.h));
      boardQuads.forEach(q => { o.beginPath(); polyPath(o, q); o.fill(); });
      o.globalCompositeOperation = 'source-over';
      g.drawImage(ringCv, 0, 0, cw, ch, x0, y0, w, h);
    }
  }
  function sync() {
    const run = active && !document.hidden;
    if (run && !raf) { lastDraw = 0; raf = requestAnimationFrame(frame); }
    else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  function wake() { if (active && !document.hidden && !raf) sync(); }
  document.addEventListener('visibilitychange', sync);

  return {
    update,
    setActive(on) { active = on; sync(); },
    get quality() { return quality; },
    get mode() { return mode; },
    setMode(m) {
      mode = m;
      store.set('ppt-quality', m);
      quality = qualityOf(m);
      preloadArt({ small: small() }).then(layout, layout);
    },
  };
}
