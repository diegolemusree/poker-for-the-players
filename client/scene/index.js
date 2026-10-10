// Escena 3D en primera persona: la cámara son los ojos del jugador sentado.
// Recibe la misma vista filtrada del servidor que la versión 2D y la acomoda en la mesa.
// Los nombres y las fichas de cada rival son etiquetas HTML que siguen su posición 3D.

import * as THREE from 'three';
import { toon, addFlatLights, INK } from './toon.js';
import { createInk } from './ink.js';
import { buildRoom } from './room.js';
import { makeTable, makeTableProps, makeChair, feltPoint, feltTangent, FELT_Y, TABLE_R } from '../models/table.js';
import { makeCard, setCard, setAnisotropy, CARD_H } from '../models/cards.js';
import { ChipField } from '../models/chipStacks.js';

const MAXP = 6;
const BETTING = ['preflop', 'flop', 'turn', 'river'];
export const QUALITIES = ['alta', 'media', 'baja'];
const DEG = Math.PI / 180;
const RING = TABLE_R + 0.44;
const HEAD_TOP = 1.5; // altura de la etiqueta sobre cada asiento
const LOOK = { yaw: 40 * DEG, pitch: 15 * DEG };
const MY_CARD_TILT = 0.38;
const LABEL_TOP = 74;
// lugares fijos frente a mí y en el centro; las cartas comunitarias van más grandes para leerlas de lejos
const MY = { cards: TABLE_R * 0.6, stack: new THREE.Vector3(0.27, FELT_Y, TABLE_R * 0.68), bet: TABLE_R * 0.36, pot: 0.14, board: -0.07 };
const BOARD_SCALE = 1.2;

// Mi asiento queda enfrente de la cámara; los otros 5 se reparten en el arco lejano (de 190° a 350°)
// para que los vecinos de al lado se vean a los costados y no queden detrás de mí.
export function seatAngle(rel) { return rel === 0 ? Math.PI / 2 : (190 + (rel - 1) * 40) * DEG; }
const ringPoint = t => new THREE.Vector3(RING * Math.cos(t), 0, RING * Math.sin(t));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

export function createTableScene(container, ui) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let mode = store.get('ppt-quality') || 'auto';
  if (mode !== 'auto' && !QUALITIES.includes(mode)) mode = 'auto';
  // en automático se arranca con la última calidad que se detectó en este equipo
  const autoStart = () => (QUALITIES.includes(store.get('ppt-quality-auto')) ? store.get('ppt-quality-auto') : 'media');
  let quality = mode === 'auto' ? autoStart() : mode;

  // sin antialias propio: la escena se dibuja en un render target y los contornos los pone ink.js
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setClearColor('#120d0a');
  renderer.domElement.className = 'scene3d';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.append(renderer.domElement);
  setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  const labelLayer = document.createElement('div');
  labelLayer.className = 'labels3d';
  container.append(labelLayer);

  const scene = new THREE.Scene();
  addFlatLights(scene);
  const ink = createInk(renderer);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 12);
  camera.rotation.order = 'YXZ';

  const room = buildRoom(scene);
  scene.add(makeTable(), makeTableProps());
  const chips = new ChipField(scene);

  // asientos: silla, criatura (cuando hay alguien), dos cartas y etiqueta
  const seats = Array.from({ length: MAXP }, (_, seat) => {
    const chair = makeChair();
    scene.add(chair);
    const cards = [makeCard(), makeCard()];
    cards.forEach(c => scene.add(c));
    const label = document.createElement('div');
    label.className = 'seat3d';
    labelLayer.append(label);
    return { seat, chair, cards, label, anchor: new THREE.Vector3(), showLabel: false };
  });
  const board = Array.from({ length: 5 }, () => { const c = makeCard(); scene.add(c); return c; });

  const dealer = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 24), [toon('#e3d6b8'), dealerTop(), toon('#e3d6b8')]);
  dealer.rotation.y = Math.PI / 2; // para que la "D" se lea derecha
  scene.add(dealer);

  const turnRing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.01, 6, 40), toon('#d9a441', { pool: false }));
  turnRing.rotation.x = -Math.PI / 2;
  turnRing.scale.set(1, 0.75, 1);
  scene.add(turnRing);

  /* ---------- cámara ---------- */
  const rig = { pos: new THREE.Vector3(), pitch: 0, yaw: 0, lookYaw: 0, lookPitch: 0, spectator: false, aspect: 1 };
  function placeRig() {
    const portrait = rig.aspect < 1;
    // sentado: ojos a la altura de alguien en silla, mirando apenas hacia abajo
    const pos = rig.spectator ? new THREE.Vector3(0, 1.62, TABLE_R + 1.3) : new THREE.Vector3(0, 1.2, TABLE_R + 0.5);
    const target = rig.spectator ? new THREE.Vector3(0, 0.78, -0.1) : new THREE.Vector3(0, 0.82, -0.3);
    if (portrait) { pos.z += 0.35; pos.y += 0.18; }
    rig.pos.copy(pos);
    rig.pitch = Math.atan2(target.y - pos.y, pos.z - target.z);
  }

  let dragging = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { dragging = { x: e.clientX, y: e.clientY, id: e.pointerId }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => {
    if (!dragging || dragging.id !== e.pointerId) return;
    const k = 1.6 / Math.max(300, el.clientHeight);
    rig.lookYaw = THREE.MathUtils.clamp(rig.lookYaw + (e.clientX - dragging.x) * k, -LOOK.yaw, LOOK.yaw);
    rig.lookPitch = THREE.MathUtils.clamp(rig.lookPitch + (e.clientY - dragging.y) * k, -LOOK.pitch, LOOK.pitch);
    dragging.x = e.clientX; dragging.y = e.clientY;
  });
  const release = () => { dragging = null; };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);

  function resize() {
    const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    ink.setSize(w, h, renderer.getPixelRatio());
    rig.aspect = w / h;
    camera.aspect = rig.aspect;
    // lente de toma de serie (perspectiva plana, sin gran angular); en pantallas angostas se abre para que quepa la mesa
    camera.fov = THREE.MathUtils.clamp((2 * Math.atan(Math.tan(40 * DEG) / rig.aspect)) / DEG, 54, 88);
    camera.updateProjectionMatrix();
    placeRig();
    wake();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  /* ---------- calidad ---------- */
  function applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(quality === 'alta' ? Math.min(dpr, 2) : quality === 'media' ? Math.min(dpr, 1.25) : 1);
    room.setQuality(quality, reduced.matches);
    resize();
  }
  // En modo automático se miden los cuadros por segundo y se baja la calidad si el equipo no puede.
  const perf = { frames: 0, time: 0, warm: 1.5 };
  function measure(dt) {
    if (mode !== 'auto' || quality === 'baja') return;
    if (perf.warm > 0) { perf.warm -= dt; return; }
    perf.frames++; perf.time += dt;
    if (perf.time < 3) return;
    const fps = perf.frames / perf.time;
    Object.assign(perf, { frames: 0, time: 0, warm: 1 });
    if (fps < 42) { quality = QUALITIES[QUALITIES.indexOf(quality) + 1]; store.set('ppt-quality-auto', quality); applyQuality(); ui.onQuality && ui.onQuality(); }
  }

  /* ---------- ciclo de render (se pausa si la pestaña no se ve) ---------- */
  let raf = 0, active = false, last = 0, t = 0;
  const v3 = new THREE.Vector3();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (quality === 'baja' && now - last < 1000 / 30 - 2) return;
    const dt = Math.min(0.1, (now - last) / 1000 || 0.016);
    last = now; t += dt;
    measure(dt);

    if (!dragging) { const k = Math.exp(-dt * 2.2); rig.lookYaw *= k; rig.lookPitch *= k; }
    const breathe = reduced.matches ? 0 : 1;
    camera.position.copy(rig.pos);
    camera.position.y += Math.sin(t * 1.1) * 0.006 * breathe;
    camera.rotation.set(rig.pitch + rig.lookPitch + Math.sin(t * 1.1 + 0.6) * 0.004 * breathe, rig.yaw + rig.lookYaw, 0);

    room.tick(t, dt);
    if (turnRing.visible) { const p = 1 + Math.sin(t * 5) * 0.06; turnRing.scale.set(p, 0.75 * p, p); }

    ink.render(scene, camera);
    placeLabels();
  }
  function placeLabels() {
    const w = el.clientWidth, h = el.clientHeight;
    for (const s of seats) {
      if (!s.showLabel) continue;
      v3.copy(s.anchor).project(camera);
      const hide = v3.z > 1 || Math.abs(v3.x) > 1.3 || Math.abs(v3.y) > 1.3;
      s.label.style.visibility = hide ? 'hidden' : '';
      if (hide) continue;
      // las etiquetas no se salen de la pantalla ni se meten debajo de la barra de arriba
      const half = s.label.offsetWidth / 2 + 4;
      const x = THREE.MathUtils.clamp(((v3.x + 1) / 2) * w, half, Math.max(half, w - half));
      const y = Math.max(LABEL_TOP + s.label.offsetHeight, ((1 - v3.y) / 2) * h);
      s.label.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
    }
  }
  function sync() {
    const run = active && !document.hidden;
    if (run && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  function wake() { if (active && !document.hidden && !raf) sync(); }
  document.addEventListener('visibilitychange', sync);

  /* ---------- acomodar la vista del servidor ---------- */
  function update(snap) {
    const v = snap.view;
    const me = v.players.find(p => p.id === snap.you);
    const started = v.handNo > 0, betting = BETTING.includes(v.phase);
    const showdown = v.phase === 'showdown' && v.results;
    const shown = showdown && !v.results.fold ? v.results.shown : [];
    const winners = showdown ? v.results.winners.map(w => w.id) : [];
    // Sin asiento, la cámara de espectador mira desde un asiento libre para que nadie le tape la mesa.
    const free = Array.from({ length: MAXP }, (_, i) => i).find(i => !v.players.some(p => p.seat === i));
    const base = me ? me.seat : free ?? 0;
    if (rig.spectator !== !me) { rig.spectator = !me; placeRig(); }

    chips.begin();
    turnRing.visible = false;
    dealer.visible = false;
    let betSum = 0;

    for (const s of seats) {
      const rel = (s.seat - base + MAXP) % MAXP;
      const t = seatAngle(rel);
      const p = v.players.find(q => q.seat === s.seat);
      const mine = rel === 0 && !!me;
      const ring = ringPoint(t);
      const tan = feltTangent(t);
      const out = feltPoint(t, 1).setY(0).normalize();

      const front = rel === 0 && !me; // asiento junto al espectador: se oculta para que no estorbe
      s.chair.visible = !mine && !front;
      s.chair.position.copy(ring);
      s.chair.lookAt(0, 0, 0);

      const seated = p && !mine && !front && !p.out;

      // cartas
      const holding = p && p.inHand && p.cards.length && !p.folded;
      s.cards.forEach((c, i) => {
        c.visible = !!holding;
        if (!holding) return;
        const code = p.cards[i] || null;
        setCard(c, mine || shown.includes(p.id) ? code : null);
        if (mine) {
          c.position.set((i - 0.5) * 0.13, FELT_Y + 0.002 + (CARD_H / 2) * Math.sin(MY_CARD_TILT), MY.cards);
          c.rotation.set(MY_CARD_TILT, (0.5 - i) * 0.08, 0);
        } else {
          c.position.copy(feltPoint(t, 0.62, FELT_Y + 0.002 + i * 0.003)).addScaledVector(tan, (i - 0.5) * 0.07);
          c.rotation.set(0, (i - 0.5) * 0.12, 0);
        }
      });

      // fichas: pila propia y apuesta de esta ronda
      if (p && !p.out) {
        if (mine) chips.addStack(p.stack, MY.stack, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), s.seat + 1);
        else chips.addStack(p.stack, feltPoint(t, 0.84).addScaledVector(tan, -0.15), tan, out, s.seat + 1);
        if (betting && p.bet > 0) {
          betSum += p.bet;
          chips.addStack(p.bet, mine ? new THREE.Vector3(0, FELT_Y, MY.bet) : feltPoint(t, 0.42), mine ? new THREE.Vector3(1, 0, 0) : tan, mine ? new THREE.Vector3(0, 0, -1) : out.clone().negate(), s.seat + 11);
        }
      }
      if (p && v.toAct === p.id && betting) {
        turnRing.visible = true;
        turnRing.position.copy(mine ? new THREE.Vector3(0, FELT_Y + 0.003, MY.cards - 0.02) : feltPoint(t, 0.62, FELT_Y + 0.003));
      }
      if (started && v.dealerSeat === s.seat && p) {
        dealer.visible = true;
        dealer.position.copy(mine ? new THREE.Vector3(-0.24, FELT_Y + 0.006, MY.cards - 0.04) : feltPoint(t, 0.64, FELT_Y + 0.006).addScaledVector(tan, 0.15));
      }

      // etiqueta
      if (front) s.anchor.copy(feltPoint(t, 0.95, 0.95));
      else s.anchor.copy(ring).setY(p && seated ? HEAD_TOP : 1.12);
      s.showLabel = fillLabel(s, p, { mine, me, started, v, snap, shown, winners });
      s.label.style.display = s.showLabel ? '' : 'none';
    }

    // bote en el centro (las apuestas de la ronda siguen frente a cada quien)
    const pot = v.players.reduce((a, p) => a + (p.total || 0), 0) - (betting ? betSum : 0);
    chips.addStack(pot, new THREE.Vector3(0, FELT_Y, MY.pot), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), 99);
    chips.end();

    board.forEach((c, i) => {
      const code = v.board[i];
      c.visible = !!code;
      if (!code) return;
      setCard(c, code);
      c.position.set((i - 2) * 0.13 * BOARD_SCALE, FELT_Y + 0.003, MY.board);
      c.rotation.set(0, 0, 0);
      c.scale.setScalar(BOARD_SCALE);
    });
    wake();
  }

  function fillLabel(s, p, o) {
    const { h, fmt, deadline } = ui;
    const el = s.label;
    el.className = 'seat3d';
    if (o.mine) return false;
    if (!p) {
      if (o.started) return false;
      if (!o.me) el.replaceChildren(h('button', { class: 'sit', onclick: () => ui.onSit(s.seat) }, 'Sentarme aquí'));
      else el.replaceChildren(h('div', { class: 'emptyseat' }, 'Libre'));
      return true;
    }
    const v = o.v;
    if (v.toAct === p.id && BETTING.includes(v.phase)) el.classList.add('turn');
    if (o.winners.includes(p.id)) el.classList.add('win');
    if ((p.inHand && p.folded) || p.out || p.sittingOut) el.classList.add('dim');
    let tag = '';
    if (p.out) tag = `Fuera (${p.place}.º)`;
    else if (p.sittingOut) tag = 'Ausente';
    else if (p.stack === 0 && o.started && !p.allIn) tag = 'Sin fichas';
    else if (p.inHand && p.folded) tag = 'Retirado';
    else if (p.allIn) tag = 'All-in';
    const handName = o.shown.includes(p.id) && v.results.hands && v.results.hands[p.id];
    el.replaceChildren(...[
      h('div', { class: 'nm', title: p.nick }, p.nick, p.isBot && h('span', { class: 'bot', title: 'Controlado por la computadora' }, '🤖')),
      h('div', { class: 'stk' }, `${fmt(p.stack)} fichas`),
      handName ? h('div', { class: 'hn' }, handName) : tag && h('div', { class: 'tg' }, tag),
      v.toAct === p.id && !p.isBot && o.snap.turnLeftMs != null && h('div', { class: 'tg' }, deadline(o.snap.turnLeftMs, 'low')),
      o.started && v.dealerSeat === p.seat && h('span', { class: 'dl', title: 'Reparte' }, 'D'),
      p.isBot && !o.started && o.me && h('button', { class: 'linkbtn', onclick: () => ui.onRemoveBot(p.seat) }, 'Quitar'),
    ].filter(Boolean));
    return true;
  }

  applyQuality();

  return {
    update,
    setActive(on) { active = on; sync(); if (on) resize(); },
    get quality() { return quality; },
    get mode() { return mode; },
    setMode(m) {
      mode = m;
      store.set('ppt-quality', m);
      quality = m === 'auto' ? autoStart() : m;
      Object.assign(perf, { frames: 0, time: 0, warm: 1.5 });
      applyQuality();
    },
  };
}

function dealerTop() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#e3d6b8'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = INK; g.lineWidth = 6; g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.stroke();
  g.fillStyle = INK; g.font = '900 72px "Arial Rounded MT Bold", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('D', 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return toon('#ffffff', { map: t });
}
