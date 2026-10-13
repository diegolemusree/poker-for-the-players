// Mesa ilustrada por capas, como una animación de televisión (de atrás hacia adelante):
//   1. fondo del garaje (imagen, recortada por los lados en pantallas verticales)
//   2. la mesa dibujada con canvas (se redibuja solo al cambiar el tamaño)
//   3. cartas, bote y fichas sobre el fieltro (se redibujan con cada jugada)
//   4. los rivales ilustrados; la mesa los tapa de la cintura para abajo (se animan)
//   5. etiquetas y montos en HTML, y encima la interfaz (main.js)
// Recibe la misma vista filtrada del servidor que la vista 2D simple.

import { CHARACTERS, characterFor, artOf, angleOf, backgroundUrl, preloadArt, BACKGROUND } from './characters.js';
import { makeView, fit, headTop, tableOutline, frontRegion, edgeYAt, belowRow, rimPoint, RAIL_Y, NEAR_Z } from './projection.js';
import { CAMERAS, LAYOUTS, BACKDROP } from './config.js';
import { drawTable } from './table.js';
import { drawItems, cardCorners, stackFootprint, CARD_W, CARD_H, CHIP_R, CHIP_H } from './items.js';
import { cardImage, roundRect, CARD_PX } from './cards.js';
import { RivalAnim, poseCanvas, clearPoseCache } from './rivals.js';
import { isPhone } from '../ui/phone.js';

const MAXP = 7;
const BETTING = ['preflop', 'flop', 'turn', 'river'];
export const QUALITIES = ['alta', 'media', 'baja'];
const FIXED = LAYOUTS[MAXP - 1]; // sin asiento y antes de empezar: cada asiento en su lugar
const [BG_W, BG_H] = BACKGROUND.sizes[BACKGROUND.sizes.length - 1];
const ACTION = {
  check: () => 'Pasa', call: a => `Iguala ${a}`, bet: a => `Apuesta ${a}`, raise: a => `Sube a ${a}`,
  fold: () => 'Se retira', sb: a => `Ciega ${a}`, bb: a => `Ciega ${a}`,
};
const ACTION_CLS = { check: 'a-check', call: 'a-call', bet: 'a-raise', raise: 'a-raise', fold: 'a-fold', sb: 'a-blind', bb: 'a-blind' };
const BET_POSE = ['call', 'bet', 'raise'];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function readMode() {
  const m = store.get('ppt-quality') || 'auto';
  return m === 'auto' || QUALITIES.includes(m) ? m : 'auto';
}
// En automático: calidad baja solo en equipos muy modestos (pocos núcleos o poca memoria).
const autoQuality = () => ((navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2 ? 'baja' : 'alta');
const qualityOf = m => (m === 'auto' ? autoQuality() : m);

// Se llama antes de crear la escena: carga y decodifica el fondo y todas las poses.
export function preload() { return preloadArt({ small: qualityOf(readMode()) === 'baja' }); }

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
  const dprOf = () => Math.min(window.devicePixelRatio || 1, quality === 'alta' ? 2 : quality === 'media' ? 1.5 : 1);

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
    const v = fit(makeView({ W, H, top: topMax, reserve, near, portrait, cam }), headWorld, cam);
    const back = placeBackdrop(W, H, headTop(v, headWorld));
    // la línea de tinta es tan gruesa como la del fondo ilustrado al tamaño en que se ve
    const line = Math.max(1.2, BG_W * back * 0.0011);
    const dpr = dprOf();
    for (const c of [tableCv, itemsCv, rivalsCv]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = tableCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTable(g, v, line);
    bg.style.backgroundImage = `url("${backgroundUrl(H, small() ? 1 : dpr)}")`;
    const outline = tableOutline(v);
    L = { W, H, v, line, dpr, portrait, phone, reserve, outline, front: frontRegion(outline) };
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
    // el rival de la derecha va en espejo (la imagen de lado ve hacia la derecha; mientras se usa la de
    // frente, el espejo deja a los dos de los lados simétricos)
    const mirror = seat.side === 'right';
    // `rim`: su lugar en la orilla (de ahí salen sus fichas); `at`: donde se sienta, `out` detrás de la orilla
    const rim = rimPoint(seat.ang), k = 1 + (seat.out || 0) / Math.hypot(rim.x, rim.z);
    const p = L.v.project(rim.x * k, RAIL_Y, rim.z * k);
    // recortado en la orilla: la cintura va justo en la línea de la orilla, en su columna
    const y = seat.cut === 'edge' ? edgeYAt(L.front, p.x) ?? p.y : p.y;
    const hpx = p.s * art.height * (seat.scale || 1) * L.v.grow * shrink, wpx = (hpx * art.size[0]) / art.size[1];
    const f = art.face;
    return placeAt({
      seat, rim, angle, mirror, hpx, wpx, x: p.x, y, depth: p.depth, waist: art.waist[1],
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
        b.x += dx;
        b.y = edgeYAt(L.front, b.x) ?? b.y;
        placeAt(b);
      }
    }
  }
  // Acomoda a todos los rivales. Si aun así alguno le tapa la cara a otro (pasa en pantallas angostas,
  // donde los del fondo quedan muy juntos), se achican todos un poco hasta que ya no.
  function placeSeats(seatOf, players) {
    let spots;
    for (let k = 0, shrink = 1; k < 15; k++, shrink *= 0.93) {
      spots = new Map();
      for (const [seat, cfg] of seatOf) {
        const p = players.find(q => q.seat === seat);
        spots.set(seat, seatPlace(cfg, p ? characterFor(p) : 'blorp', shrink));
      }
      protectFaces([...spots.values()]);
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
    const xCards = clamp(view.unproject(L.W * 0.2, meRow).x, -0.6, -0.2);
    const xStack = clamp(view.unproject(L.W * 0.78, meRow).x, 0.25, 0.6);
    // cartas comunitarias en fila al centro de la mesa; el bote, un montón cerca de mí abajo al centro
    const zBoard = clamp(zMe - 0.27, -0.3, 0), zPot = Math.max(zBoard + 0.2, zMe - 0.09);
    const items = [], amts = [];
    let betSum = 0, myCards = null;
    // cartas comunitarias (mismas medidas que dibuja items.js) y dónde caen en pantalla
    const boardScale = L.phone ? 1.4 : 1.08;
    const boardAt = i => ({ x: (i - 2) * (CARD_W * boardScale + 0.014), z: zBoard });
    boardQuads = v.board.map((_, i) => { const c = cardCorners(boardAt(i), CARD_W * boardScale, CARD_H * boardScale, 0.62, 0); return [c.tl, c.tr, c.br, c.bl].map(q => view.project(q.x, q.y, q.z)); });
    const amt = (at, y, text, cls) => amts.push({ at, y, text, cls });

    drawn = []; ring = null;
    const live = new Set(), fresh = new Set();
    for (const s of seats) {
      const p = v.players.find(q => q.seat === s.seat);
      const mine = !!me && s.seat === base;
      const isFront = !me && s.seat === base;
      const spot = spots.get(s.seat) || null;

      // rival dibujado
      if (p && spot && !p.out) {
        live.add(p.id);
        const charId = characterFor(p);
        let a = anims.get(p.id);
        if (!a || a.charId !== charId) { a = new RivalAnim(charId, now); anims.set(p.id, a); fresh.add(p.id); }
        // reparto nuevo: espía sus cartas (escalonado, como si fueran repartiendo)
        if (a.hand !== undefined && a.hand !== v.handNo && p.inHand) a.play('espia', 1700, now, 350 + rel(s.seat) * 220);
        a.hand = v.handNo;
        const la = p.lastAction;
        if (la && a.lastN !== undefined && la.n !== a.lastN && BET_POSE.includes(la.type)) a.play('apuesta', 2000, now);
        a.lastN = la ? la.n : a.lastN ?? null;
        const dim = (p.inHand && p.folded) || p.sittingOut;
        drawn.push({ id: p.id, charId, ...spot, dim, idle: p.inHand && !p.folded });
      }

      // fichas, apuesta, botón del dealer y cartas enseñadas
      if (p && !p.out) {
        // frente a cada rival, sobre la línea que va de su lugar en la orilla al centro (r = 1 es la orilla)
        const rim = spot ? spot.rim : { x: 0, z: 1 }, n = Math.hypot(rim.x, rim.z);
        const d = { x: rim.x / n, z: rim.z / n }, tan = { x: -d.z, z: d.x };
        const on = (r, t = 0) => ({ x: rim.x * r + tan.x * t, z: rim.z * r + tan.z * t });
        const myStack = { x: xStack, z: zMe - 0.03 };
        if (mine || isFront) items.push({ kind: 'stack', amount: p.stack, at: myStack, across: { x: 1, z: 0 }, back: { x: 0, z: -1 }, seed: s.seat + 1 });
        else if (spot) {
          const st = { kind: 'stack', amount: p.stack, at: on(0.74), across: tan, back: d, seed: s.seat + 1 };
          items.push(st);
          if (v.toAct === p.id && betting) ring = L.phone ? ringBeside(on) : ringAround(st);
        }
        if (betting && p.bet > 0 && (spot || mine || isFront)) {
          betSum += p.bet;
          const at = mine || isFront ? { x: 0.06, z: zMe - 0.24 } : on(0.5);
          items.push({ kind: 'stack', amount: p.bet, at, across: mine || isFront ? { x: 1, z: 0 } : tan, back: mine || isFront ? { x: 0, z: -1 } : { x: -d.x, z: -d.z }, seed: s.seat + 11 });
          amt(at, 0.05, ui.fmt(p.bet), mine ? 'mine' : '');
        }
        // en el celular mis cartas van fuera de la mesa: el botón del dealer se pasa junto a mi pila
        const myDealer = L.phone ? { x: xStack - 0.2, z: zMe - 0.03 } : { x: xCards + 0.3, z: zMe - 0.03 };
        if (started && v.dealerSeat === s.seat) items.push({ kind: 'dealer', at: mine || isFront ? myDealer : on(0.66, -0.2) });
        const holding = p.inHand && p.cards.length && !p.folded;
        if (holding && mine && L.phone) myCards = p.cards;
        else if (holding && mine) p.cards.forEach((code, i) => items.push({ kind: 'card', code, at: { x: xCards + i * 0.11, z: zMe + (i ? 0.004 : 0) }, tilt: 0.75, yaw: i ? -0.07 : 0.06, scale: 1.05 }));
        else if (holding && shown.includes(p.id)) {
          p.cards.forEach((code, i) => items.push({ kind: 'card', code, at: mine || isFront ? { x: xCards + i * 0.11, z: zMe } : on(0.6, (i - 0.5) * (CARD_W + 0.012)), tilt: 0.35, yaw: 0, scale: 0.95 }));
        }
      }

      // etiqueta sobre la cabeza (o donde iría la cabeza en un asiento libre)
      s.layer = spot ? layerOf(spot) : 0;
      if (isFront) { const q = view.project(0, 0.1, zMe); s.ax = q.x; s.ay = q.y; }
      else if (spot) { const f = faceBox(spot); s.ax = (f.x0 + f.x1) / 2; s.ay = p && !p.out ? f.y0 + spot.hpx * 0.02 : f.y0 + spot.hpx * 0.25; }
      s.show = fillLabel(s, p, { mine, me, started, v, shown, winners, empty: !p && (spot || isFront) });
      s.label.style.display = s.show ? '' : 'none';
    }
    for (const id of anims.keys()) if (!live.has(id)) anims.delete(id);
    // Al cerrar una ronda, el servidor borra la jugada de cada quien en el mismo instante: la última
    // igualada solo se ve en la última jugada de la mesa (v.lastAction), que no se borra.
    const ga = v.lastAction, last = ga && anims.get(ga.id);
    if (last && !fresh.has(ga.id) && last.lastN !== ga.n) {
      if (BET_POSE.includes(ga.type)) last.play('apuesta', 2000, now);
      last.lastN = ga.n;
    }

    // bote en el centro (las apuestas de la ronda siguen frente a cada quien)
    const pot = v.players.reduce((a, p) => a + (p.total || 0), 0) - (betting ? betSum : 0);
    if (pot > 0) {
      const at = { x: 0, z: zPot };
      items.push({ kind: 'stack', amount: pot, at, across: { x: 1, z: 0 }, back: { x: 0, z: -1 }, seed: 99, messy: true });
      amt(at, 0.06, `Bote ${ui.fmt(pot)}`, 'pot');
    }
    v.board.forEach((code, i) => items.push({ kind: 'card', code, at: boardAt(i), tilt: 0.62, yaw: 0, scale: boardScale }));

    // capa de fichas y cartas
    const g = itemsCv.getContext('2d');
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.clearRect(0, 0, L.W, L.H);
    drawItems(g, view, items, L.line);
    if (myCards) drawMyCards(g, myCards);

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
  function drawMyCards(g, cards) {
    const box = container.parentElement && container.parentElement.querySelector('.mc-cards');
    if (!box) return;
    const r = box.getBoundingClientRect(), c0 = container.getBoundingClientRect();
    const hgt = r.height * 0.92, w = (hgt * CARD_PX[0]) / CARD_PX[1];
    const x0 = r.left - c0.left + w * 0.08, y0 = r.top - c0.top + r.height * 0.06;
    cards.forEach((code, i) => {
      const cx = x0 + w / 2 + i * w * 0.86, cy = y0 + hgt / 2, a = (i ? 4 : -4) * Math.PI / 180;
      g.save();
      g.translate(cx, cy); g.rotate(a);
      g.fillStyle = 'rgba(14,8,4,0.45)'; // sombra plana
      roundRect(g, -w / 2 + 4, -hgt / 2 + 5, w, hgt, w * 0.1); g.fill();
      g.drawImage(cardImage(code), -w / 2, -hgt / 2, w, hgt);
      g.restore();
    });
  }

  // Etiquetas encima de cada rival. No se enciman entre sí ni tapan caras (los ojos: se permite pisar la
  // coronilla), no se salen de la pantalla ni se meten debajo de la franja de arriba. Cada una prueba
  // lugares en orden: sobre su rival, un poco de lado, más arriba (al espacio del garaje) y al final más
  // abajo. En el celular, si alguna no cabe justo encima de su rival, todas pasan a la versión compacta, y
  // se busca el lugar libre más cercano arriba o abajo de la cara (sobre el pecho, que sí se puede tapar).
  // Primero las de los del fondo y luego las de los lados (que van más cerca de las orillas).
  function placeLabels() {
    const labelTop = topMax + 8;
    const faces = drawn.map(r => { const f = faceBox(r); return { ...f, y0: f.y0 + (f.y1 - f.y0) * 0.25 }; });
    const order = seats.slice().sort((a, b) => a.layer - b.layer || b.ay - a.ay);
    const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    for (const compact of L.phone ? [false, true] : [false]) {
      labelLayer.classList.toggle('compact', compact);
      const placed = [];
      let clean = true;
      for (const s of order) {
        if (!s.show) continue;
        const lw = s.label.offsetWidth, lh = s.label.offsetHeight, half = lw / 2 + 4;
        const inside = x => clamp(x, half, Math.max(half, L.W - half));
        const y0 = Math.max(labelTop + lh, s.ay - 2), step = lh + 5;
        const ups = [], downs = [1, 2, 3, 4].map(k => y0 + k * step);
        for (let y = y0 - step; y - lh >= labelTop; y -= step) ups.push(y);
        const ys = [y0, ...(compact ? ups.flatMap((y, i) => [y, downs[i]]).concat(downs.slice(ups.length)).filter(y => y != null) : [...ups, ...downs.slice(0, 3)])];
        const dxs = compact ? [0, -0.15, 0.15, -0.3, 0.3, -0.5, 0.5] : [0, -0.15, 0.15, -0.3, 0.3];
        let best = null;
        for (const y of ys) {
          for (const dx of dxs) {
            const x = inside(s.ax + dx * lw);
            const box = { x0: x - lw / 2 - 2, x1: x + lw / 2 + 2, y0: y - lh - 2, y1: y + 2 };
            const cost = placed.reduce((a, o) => a + overlap(o, box), 0) + faces.reduce((a, f) => a + 3 * overlap(f, box), 0);
            if (!best || cost < best.cost) best = { x, y, box, cost };
            if (cost === 0) break;
          }
          if (best.cost === 0) break;
        }
        if (best.cost > 0 || (L.phone && !compact && best.y !== y0)) clean = false;
        placed.push(best.box);
        s.label.style.transform = `translate(${best.x}px,${best.y}px) translate(-50%,-100%)`;
      }
      if (clean) break;
    }
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
    if (v.toAct === p.id && BETTING.includes(v.phase)) lab.classList.add('turn');
    if (o.winners.includes(p.id)) lab.classList.add('win');
    if ((p.inHand && p.folded) || p.out || p.sittingOut) lab.classList.add('dim');
    let tag = '';
    if (p.out) tag = `Fuera (${p.place}.º)`;
    else if (p.sittingOut) tag = 'Ausente';
    else if (p.stack === 0 && o.started && !p.allIn) tag = 'Sin fichas';
    else if (p.inHand && p.folded) tag = 'Retirado';
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
      h('div', { class: 'nm', title: p.nick }, p.nick, p.isBot && h('span', { class: 'bot', title: 'Controlado por la computadora' }, 'BOT')),
      h('div', { class: 'stk' }, fmt(p.stack)),
      handName ? h('div', { class: 'hn' }, handName)
        : thinking ? h('div', { class: 'act a-think' }, 'Pensando…', !p.isBot && snap.turnLeftMs != null && [' ', deadline(snap.turnLeftMs, 'low')])
          : badge || (tag && h('div', { class: 'tg' }, tag)),
      o.started && v.dealerSeat === p.seat && h('span', { class: 'dl', title: 'Reparte' }, 'D'),
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
  function drawRivals(now) {
    if (!L) return;
    const g = rivalsCv.getContext('2d'), still = reduced.matches;
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.clearRect(0, 0, L.W, L.H);
    for (const r of drawn) {
      const a = anims.get(r.id);
      const pose = a ? a.frame(now, r.idle) : 'espera';
      const pxH = Math.round(r.hpx * L.dpr);
      const img = poseCanvas(r.charId, r.angle, pose, small(), pxH, r.dim) || poseCanvas(r.charId, r.angle, 'espera', small(), pxH, r.dim);
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
      if (r.dim) g.globalAlpha = 0.9;
      const b = still || !a ? 0 : a.breath(now / 1000);
      g.translate(r.x, r.y); g.scale(1, 1 + b); g.translate(-r.x, -r.y);
      if (r.mirror) { g.translate(r.left * 2 + r.wpx, 0); g.scale(-1, 1); } // espejo sobre su propia caja
      g.drawImage(img, r.left, r.top, r.wpx, r.hpx);
      g.restore();
    }
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
