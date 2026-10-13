// Cliente: pantallas de inicio, mesa ilustrada por capas (client/stage/) con la interfaz encima,
// y la vista 2D simple de respaldo (si el jugador la elige o si la mesa ilustrada no carga). Todo texto de usuarios se pone con textContent / nodos de texto, nunca con innerHTML.

import { io } from 'socket.io-client';
import { breakdown, chipInfo, STARTING_CHIPS, CHIPS } from './chips.js';
import { handLabel } from './ui/hand.js';
import { isPhone, phoneQuery } from './ui/phone.js';

const MAXP = 7;
const GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_NAME = { s: 'picas', h: 'corazones', d: 'diamantes', c: 'tréboles' };
const BETTING = ['preflop', 'flop', 'turn', 'river'];
const DIF = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil' };
const PHASE = { preflop: 'Antes del flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Se enseñan cartas' };
const $app = document.getElementById('app');

/* ---------- utilidades ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v);
  }
  kids.flat(Infinity).forEach(c => { if (c != null && c !== false) e.append(c); });
  return e;
}
const fmt = n => Number(n).toLocaleString('es-MX');
// Pilas de fichas de colores para un monto (máximo 5 por pila, solo es visual).
function chipStack(amount, big) {
  const cols = breakdown(amount).chips.slice(0, 4).map(c => {
    const info = chipInfo(c.value);
    const col = h('span', { class: 'col', title: `${c.count} × ${fmt(c.value)}` });
    for (let i = 0; i < Math.min(c.count, 5); i++) col.append(h('span', { class: 'disc', style: `background:${info.color};border-color:${info.edge}` }));
    return col;
  });
  return h('span', { class: 'chips' + (big ? ' big' : ''), 'aria-hidden': 'true' }, cols);
}
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

let token = store.get('ppt-token');
if (!token) {
  token = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
  store.set('ppt-token', token);
}

/* ---------- estado de la pantalla ---------- */
let socket = null, snap = null, snapAt = 0;
let screen = 'boot';          // boot | access | home | table
let error = '', toast = '';
let accessRequired = false;
let nick = store.get('ppt-nick') || '';
let raise = { key: '', value: 0 };
let prevBoard = { hand: 0, len: 0 };
let showSide = false;
let raiseOpen = false;        // celular: el panel de Subir está abierto en lugar de los tres botones
// celular: un solo aviso a la vez (la última jugada, un error), que se borra solo
let note = null, noteTimer = 0, lastLogKey = null, lastLog = [];
const NOTE_MS = 4500;
function notify(text, kind) {
  note = { text, kind, until: performance.now() + NOTE_MS };
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { if (screen === 'table') draw(); }, NOTE_MS + 50);
}

/* ---------- mesa ilustrada ---------- */
// Se usa salvo que el jugador elija la vista 2D simple. Si algo falla al cargarla o crearla, queda la 2D.
let sceneMod = null, sceneLoading = null, sceneFailed = false;
let scene = null, shell = null, hudEl = null;
const useStage = () => !sceneFailed && store.get('ppt-view') !== '2d';
function loadScene() {
  if (sceneMod || sceneLoading || !useStage()) return;
  // las cartas se pintan con la letra de caricatura: se espera a que cargue antes de crear la escena,
  // y las ilustraciones se precargan y decodifican antes de enseñar la mesa
  const font = document.fonts ? Promise.race([document.fonts.load('64px "Chewy"'), new Promise(r => setTimeout(r, 2500))]).catch(() => {}) : Promise.resolve();
  sceneLoading = Promise.all([import('./stage/index.js').then(m => m.preload().then(() => m)), font])
    .then(([m]) => { sceneMod = m; if (screen === 'table') draw(); })
    .catch(e => { console.error(e); sceneFailed = true; draw(); });
}

/* ---------- conexión ---------- */
function connectSocket() {
  socket = io({ auth: { token, accessCode: store.get('ppt-access') || '' }, reconnectionDelay: 800 });
  socket.on('connect', () => {
    error = ''; toast = '';
    const fromUrl = new URLSearchParams(location.search).get('mesa');
    const code = fromUrl || store.get('ppt-room');
    if (code) joinRoom(code, !fromUrl); // también al reconectar tras perder la red: recupera asiento y cartas
    else { screen = 'home'; draw(); }
  });
  socket.on('connect_error', (e) => {
    if (/acceso/i.test(e.message)) { store.del('ppt-access'); screen = 'access'; error = store.get('ppt-access-tried') ? e.message : ''; draw(); socket.disconnect(); }
    else { error = 'No hay conexión con el servidor. Reintentando…'; draw(); }
  });
  socket.on('state', (st) => { snap = st; snapAt = performance.now(); screen = 'table'; draw(); });
  socket.on('disconnect', () => { toast = 'Se perdió la conexión. Reconectando…'; draw(); });
}
const send = (ev, data) => new Promise(res => socket.emit(ev, data || {}, res));
async function run(ev, data) {
  const r = await send(ev, data);
  error = r && r.error ? r.error : '';
  if (error && isPhone()) notify(error, 'err');
  if (error) draw();
  return r;
}
async function joinRoom(code, silent) {
  const r = await send('room:join', { code });
  if (r.error) {
    store.del('ppt-room');
    history.replaceState(null, '', location.pathname);
    screen = 'home'; error = silent ? 'Tu mesa anterior ya no existe. Puedes crear otra.' : r.error; draw();
    return;
  }
  store.set('ppt-room', r.code);
}

/* ---------- cartas ---------- */
const cardName = c => `${c[0] === 'T' ? '10' : c[0]} de ${SUIT_NAME[c[1]]}`;
function cardEl(c, o = {}) {
  if (!c) return h('div', { class: 'card ' + (o.back ? 'back' : 'slot') });
  const rank = c[0] === 'T' ? '10' : c[0];
  return h('div', { class: 'card' + ('hd'.includes(c[1]) ? ' red' : '') + (o.fresh ? ' deal' : ''), role: 'img', 'aria-label': `${rank} de ${SUIT_NAME[c[1]]}` },
    h('span', { class: 'r' }, rank), h('span', { class: 's' }, GLYPH[c[1]]));
}

/* ---------- pantallas ---------- */
function drawAccess() {
  const inp = h('input', { type: 'password', id: 'acc', autocomplete: 'off', 'aria-label': 'Código de acceso' });
  const go = () => { if (!inp.value.trim()) return; store.set('ppt-access', inp.value.trim()); store.set('ppt-access-tried', '1'); error = ''; socket.auth = { token, accessCode: inp.value.trim() }; socket.connect(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  return h('main', { class: 'home' }, logo(),
    h('div', { class: 'card-panel' },
      h('h2', {}, 'Acceso del grupo'),
      h('p', { class: 'note' }, 'Escribe el código que te pasó quien organiza la noche de póker.'),
      error && h('p', { class: 'err', role: 'alert' }, error),
      inp, h('button', { class: 'btn go', onclick: go }, 'Entrar')));
}

// Logo rotulado a mano: letras chuecas y la "o" de Poker es un ojo de párpado caído que parpadea.
const EYE = '<svg class="eye" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="21" r="16" fill="#fbf6e6" stroke="#1d1611" stroke-width="3.5"/><circle cx="23" cy="25" r="4.5" fill="#1d1611"/><path class="lid" d="M4 19 A16 16 0 0 1 36 19 Z" fill="#e0b552" stroke="#1d1611" stroke-width="3.5" stroke-linejoin="round"/></svg>';
const letters = (t) => [...t].map(c => h('span', { class: 'l' }, c));
function logo() {
  const eye = h('span', { class: 'l' });
  eye.innerHTML = EYE; // SVG fijo del código, sin texto de usuarios
  return h('h1', { class: 'logo', 'aria-label': 'Poker for the Players' },
    h('span', { class: 'w', 'aria-hidden': 'true' }, letters('P'), eye, letters('ker')),
    h('span', { class: 'w mid', 'aria-hidden': 'true' }, 'for the'),
    h('span', { class: 'w', 'aria-hidden': 'true' }, letters('Players')),
    h('small', {}, '♠ ♥ torneo entre amigos ♦ ♣'));
}

function drawHome() {
  const nickIn = h('input', { type: 'text', maxLength: 16, id: 'nick', value: nick, placeholder: 'Tu apodo', autocomplete: 'off' });
  nickIn.addEventListener('input', () => { nick = nickIn.value; store.set('ppt-nick', nick); });
  const need = () => { if (!nick.trim()) { error = 'Escribe tu apodo primero.'; draw(); nickIn.focus(); return false; } return true; };

  const bots = h('select', { id: 'bots', 'aria-label': 'Número de rivales' }, [1, 2, 3, 4, 5, 6].map(n => h('option', { value: n, selected: n === 3 }, `${n} ${n === 1 ? 'rival' : 'rivales'}`)));
  const dif = h('select', { id: 'dif', 'aria-label': 'Dificultad' }, Object.entries(DIF).map(([v, t]) => h('option', { value: v, selected: v === 'normal' }, t)));
  const lvlSolo = levelSelect(5), lvlMesa = levelSelect(15);
  const code = h('input', { type: 'text', maxLength: 5, id: 'code', placeholder: 'ABCDE', autocomplete: 'off', style: 'text-transform:uppercase;letter-spacing:.2em' });

  return h('main', { class: 'home' }, logo(),
    h('p', { class: 'tagline' }, 'Torneo de Texas Hold\'em con fichas virtuales. 5,000 fichas, una recompra y gana quien se quede con todas.'),
    error && h('p', { class: 'err', role: 'alert' }, error),
    h('label', { class: 'field' }, 'Tu apodo', nickIn),
    h('section', { class: 'card-panel' },
      h('h2', {}, 'Jugar contra la compu'),
      h('div', { class: 'row' }, bots, dif),
      h('label', { class: 'field' }, 'Cada nivel de ciegas dura', lvlSolo),
      h('button', { class: 'btn go', onclick: () => need() && run('room:create', { nick, solo: true, bots: +bots.value, difficulty: dif.value, levelMinutes: +lvlSolo.value }).then(afterCreate) }, 'Empezar práctica')),
    h('section', { class: 'card-panel' },
      h('h2', {}, 'Crear mesa'),
      h('p', { class: 'note' }, 'Te damos un código de 5 letras para pasárselo a tus amigos.'),
      h('label', { class: 'field' }, 'Cada nivel de ciegas dura', lvlMesa),
      h('button', { class: 'btn gold', onclick: () => need() && run('room:create', { nick, solo: false, levelMinutes: +lvlMesa.value }).then(afterCreate) }, 'Crear mesa')),
    h('section', { class: 'card-panel' },
      h('h2', {}, 'Unirme con código'),
      h('div', { class: 'row' }, code, h('button', { class: 'btn', onclick: () => code.value.trim() && joinRoom(code.value.trim().toUpperCase(), false) }, 'Unirme'))));
}
function levelSelect(def) {
  return h('select', { 'aria-label': 'Minutos por nivel' }, [2, 5, 10, 15, 20, 30].map(m => h('option', { value: m, selected: m === def }, `${m} minutos`)));
}
function afterCreate(r) { if (r && r.ok) { store.set('ppt-room', r.code); history.replaceState(null, '', '?mesa=' + r.code); } }

/* ---------- mesa ---------- */
const me = () => snap.view.players.find(p => p.id === snap.you);
const potOf = v => v.players.reduce((a, p) => a + (p.total || 0), 0);
const started = () => snap.view.handNo > 0;
const betting = () => BETTING.includes(snap.view.phase);

function deadline(ms, cls) { // cuenta regresiva que se actualiza sola
  return h('span', { class: 'timer cd ' + (cls || ''), 'data-end': String(snapAt + ms) }, mmss(ms));
}

function drawTable() {
  const v = snap.view, mine = me();
  document.title = (mine && v.toAct === snap.you ? '¡Te toca! ' : '') + 'Poker for the Players';
  const ended = v.finished;

  const top = h('header', { class: 'top' },
    h('span', { class: 'brand' }, 'Poker for the Players'),
    h('span', { class: 'stat' }, 'Mesa ', h('b', {}, snap.code)),
    started() && h('span', { class: 'stat' }, 'Mano ', h('b', {}, v.handNo)),
    h('span', { class: 'stat' }, 'Ciegas ', h('b', {}, `${fmt(v.sb)}/${fmt(v.bb)}`)),
    snap.levelLeftMs != null && h('span', { class: 'stat' }, 'Sube a ', h('b', {}, `${fmt(snap.nextBlinds[0])}/${fmt(snap.nextBlinds[1])}`), ' en ', deadline(snap.levelLeftMs)),
    started() && h('span', { class: 'stat' }, 'En pie ', h('b', {}, `${v.players.filter(p => !p.out).length}/${v.players.length}`)),
    h('span', { class: 'spacer' }),
    !sceneFailed && h('button', { class: 'linkbtn', onclick: () => { store.del('ppt-view'); draw(); } }, 'Vista ilustrada'),
    h('button', { class: 'linkbtn', onclick: exitRoom }, 'Salir de la mesa'));

  const notice = h('div', { class: 'notice' },
    error && h('p', { class: 'err', role: 'alert' }, error),
    toast && h('p', { class: 'note' }, toast));

  // tablero y bote
  const board = h('div', { class: 'board' });
  const fresh = v.handNo !== prevBoard.hand ? 0 : prevBoard.len;
  for (let i = 0; i < 5; i++) board.append(cardEl(v.board[i], { fresh: i >= fresh && v.board[i] }));
  prevBoard = { hand: v.handNo, len: v.board.length };
  const pot = potOf(v);
  const msg = h('div', { class: 'msg', 'aria-live': 'polite' }, centerMessage());
  const table = h('div', { class: 'table' }, h('div', { class: 'felt' }),
    h('div', { class: 'center' }, board,
      pot > 0 && h('div', { class: 'pot' }, chipStack(pot, true), fmt(pot)), msg));

  // asientos
  const base = mine ? mine.seat : 0;
  const portrait = matchMedia('(max-width:640px)').matches;
  for (let seat = 0; seat < MAXP; seat++) {
    const ang = Math.PI / 2 + ((seat - base + MAXP) % MAXP) * (2 * Math.PI / MAXP);
    const rx = portrait ? 44 : 46, ry = portrait ? 45 : 44;
    const el = h('div', { class: 'seat', style: `left:${50 + rx * Math.cos(ang)}%;top:${50 + ry * Math.sin(ang)}%` });
    const p = v.players.find(q => q.seat === seat);
    if (!p) {
      if (!mine && !started()) el.append(h('button', { class: 'sit', onclick: () => sit(seat) }, 'Sentarme aquí'));
      else el.append(h('div', { class: 'emptyseat' }, 'Libre'));
      table.append(el); continue;
    }
    seatContent(el, p, v);
    table.append(el);
    if (p.bet > 0 && BETTING.includes(v.phase)) {
      table.append(h('div', { class: 'bet', style: `left:${50 + rx * .62 * Math.cos(ang)}%;top:${50 + ry * .58 * Math.sin(ang)}%` }, chipStack(p.bet), fmt(p.bet)));
    }
  }

  const side = h('section', { class: 'side' },
    h('div', {}, h('h2', {}, 'Posiciones'), h('ol', {}, standings(v))),
    h('div', {}, h('h2', {}, 'Últimas jugadas'), h('ul', {}, v.log.slice(-10).reverse().map(t => h('li', {}, t)))));

  return h('div', {}, top, notice, h('main', { class: 'stage' }, table), actionBar(), side, ended && finishOverlay());
}

function standings(v) {
  const vivos = v.players.filter(p => !p.out).sort((a, b) => b.stack - a.stack);
  const fuera = v.players.filter(p => p.out).sort((a, b) => a.place - b.place);
  return [...vivos.map(p => h('li', {}, p.nick + (p.isBot ? ' (bot)' : ''), h('span', {}, fmt(p.stack)))),
    ...fuera.map(p => h('li', {}, `${p.place}.º ${p.nick}`, h('span', {}, 'fuera')))];
}

function centerMessage() {
  const v = snap.view;
  if (!started()) return v.players.length < 2 ? 'Esperando jugadores' : 'Listos para empezar';
  if (v.finished) return '¡Torneo terminado!';
  if (v.phase === 'showdown' && v.results) {
    const nodes = [];
    v.results.winners.forEach((w, i) => {
      if (i) nodes.push(h('br'));
      nodes.push(h('strong', {}, w.name), ` gana ${fmt(w.amount)}${w.hand ? ' con ' + w.hand.toLowerCase() : ''}`);
    });
    if (snap.dealLeftMs != null) nodes.push(h('br'), 'Siguiente mano en ', deadline(snap.dealLeftMs));
    return nodes;
  }
  if (v.toAct) {
    const p = v.players.find(x => x.id === v.toAct);
    if (!p) return '';
    if (p.id !== snap.you) return ['Turno de ', h('strong', {}, p.nick), '…'];
    const toCall = Math.min(Math.max(0, v.currentBet - p.bet), p.stack);
    return toCall > 0 ? ['¡Te toca! Para seguir tienes que igualar ', h('strong', {}, fmt(toCall)), '.'] : ['¡Te toca! Nadie ha apostado: puedes ', h('strong', {}, 'pasar'), ' o apostar.'];
  }
  return '';
}

function seatContent(el, p, v) {
  const isMe = p.id === snap.you;
  const shown = v.phase === 'showdown' && v.results && v.results.shown.includes(p.id);
  const winner = v.phase === 'showdown' && v.results && v.results.winners.some(w => w.id === p.id);
  if (isMe) el.classList.add('me');
  if (v.toAct === p.id) el.classList.add('turn');
  if (p.inHand && p.folded) el.classList.add('folded');
  if (p.out) el.classList.add('out');
  if (winner) el.classList.add('win');
  const hand = h('div', { class: 'hand' });
  if (p.inHand && p.cards.length && !(p.folded && !isMe)) p.cards.forEach(c => hand.append(c ? cardEl(c) : cardEl(null, { back: true })));
  const name = h('div', { class: 'name', title: p.nick }, p.nick + (isMe ? ' (tú)' : ''));
  const box = h('div', { class: 'box' }, name, h('div', { class: 'stack' }, `${fmt(p.stack)} fichas`,
    p.isBot && h('span', { class: 'bot', title: 'Controlado por la computadora' }, 'BOT')));
  let tag = '';
  if (p.out) tag = `Fuera (${p.place}.º)`;
  else if (p.sittingOut) tag = 'Ausente';
  else if (p.stack === 0 && started()) tag = 'Sin fichas';
  else if (p.inHand && p.folded) tag = 'Retirado';
  else if (p.allIn) tag = 'All-in';
  if (shown && v.results.hands && v.results.hands[p.id]) box.append(h('div', { class: 'handname' }, v.results.hands[p.id]));
  else if (tag) box.append(h('div', { class: 'tag' }, tag));
  if (v.toAct === p.id && !p.isBot && snap.turnLeftMs != null) box.append(h('div', { class: 'tag' }, deadline(snap.turnLeftMs, 'low')));
  if (v.dealerSeat === p.seat && started()) box.append(h('div', { class: 'dealer', title: 'Reparte' }, 'D'));
  if (p.isBot && !started() && me()) box.append(h('button', { class: 'linkbtn', onclick: () => run('bots:remove', { seat: p.seat }) }, 'Quitar'));
  el.append(hand, box);
}

/* ---------- barra de acciones ---------- */
// `phone`: panel compacto del celular (solo en la mesa ilustrada; la vista 2D simple se queda como está)
function actionBar(phone = false) {
  const v = snap.view, mine = me();
  const inner = h('div', { class: 'in' });
  const hint = t => inner.append(h('p', { class: 'hint' }, t));
  const row = () => h('div', { class: 'row' });

  if (!mine) {
    if (started()) hint('El torneo ya empezó. Estás mirando la mesa.');
    else {
      hint('Escribe tu apodo y elige un asiento libre en la mesa.');
      const inp = h('input', { type: 'text', id: 'nick', maxLength: 16, value: nick, placeholder: 'Tu apodo', 'aria-label': 'Tu apodo' });
      inp.addEventListener('input', () => { nick = inp.value; store.set('ppt-nick', nick); });
      inner.append(h('div', { class: 'row' }, inp));
    }
    return h('div', { class: 'bar' }, inner);
  }

  if (!started()) { lobbyControls(inner); return h('div', { class: 'bar' }, inner); }
  if (v.finished) { hint(v.winner === snap.you ? '¡Ganaste el torneo!' : 'El torneo terminó.'); return h('div', { class: 'bar' }, inner); }

  if (mine.out) { hint(`Quedaste fuera en el lugar ${mine.place}. Puedes seguir mirando la mesa.`); return h('div', { class: 'bar' }, inner); }

  // sin fichas: recompra única
  if (mine.stack === 0 && !(betting() && mine.inHand)) {
    hint(mine.rebuysLeft > 0 ? `Te quedaste sin fichas. Tienes una recompra de ${fmt(5000)}.` : 'Te quedaste sin fichas.');
    const r = row();
    if (mine.rebuysLeft > 0) {
      r.append(h('button', { class: 'btn gold', onclick: () => run('rebuy') }, 'Recomprar 5,000'),
        h('button', { class: 'btn', onclick: () => confirm('¿Quedarte fuera del torneo?') && run('decline') }, 'Quedarme fuera'));
      if (snap.rebuyLeftMs != null) r.append(h('span', { class: 'hint' }, 'Decide en ', deadline(snap.rebuyLeftMs, 'low')));
    }
    inner.append(r);
    return h('div', { class: 'bar' }, inner);
  }

  if (mine.sittingOut) {
    hint('Estás ausente: te retiras de cada mano mientras tanto.');
    inner.append(h('div', { class: 'row' }, h('button', { class: 'btn go', onclick: () => run('sitin') }, 'Volver a la mesa')));
    return h('div', { class: 'bar' }, inner);
  }

  if (betting() && v.toAct === snap.you) { turnControls(inner, mine, phone); return h('div', { class: 'bar myturn' + (raiseOpen && phone ? ' raising' : '') }, inner); }

  // mientras otro piensa: lo de arriba ya dice de quién es el turno; aquí solo queda ausentarse
  const wait = betting() ? (mine.inHand && !mine.folded ? 'Cuando te toque, aquí aparecen tus botones.' : 'Te retiraste de esta mano. Espera la siguiente.')
    : v.phase === 'showdown' ? 'La siguiente mano se reparte sola.' : 'Esperando…';
  inner.append(h('div', { class: 'row waitrow' }, h('p', { class: 'hint' }, wait), h('button', { class: 'btn small quiet', onclick: () => confirm('Te retirarás de cada mano (pagando ciegas) hasta que vuelvas. ¿Ausentarte?') && run('resign') }, 'Ausentarme')));
  return h('div', { class: 'bar' }, inner);
}

function lobbyControls(inner) {
  const v = snap.view;
  const link = `${location.origin}/?mesa=${snap.code}`;
  inner.append(
    h('p', { class: 'hint' }, `Mesa ${snap.code}. Pásales este link a tus amigos y siéntense. Torneo: ${fmt(5000)} fichas, ciegas cada ${snap.levelMinutes} min, una recompra por persona; termina cuando alguien tenga todas las fichas.`),
    h('p', { class: 'hint startchips' }, 'Cada quien recibe 32 fichas: ',
      STARTING_CHIPS.map((c, i) => [i ? (i === STARTING_CHIPS.length - 1 ? ' y ' : ', ') : '', chipStack(c.value), ` ${c.count} de ${fmt(c.value)}`]), '.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => copy(link) }, 'Copiar link'),
      h('span', { class: 'hint' }, `${v.players.length}/${snap.maxPlayers} jugadores`)));
  const dif = h('select', { 'aria-label': 'Dificultad del bot' }, Object.entries(DIF).map(([k, t]) => h('option', { value: k, selected: k === 'normal' }, t)));
  const libres = snap.maxPlayers - v.players.length;
  inner.append(h('div', { class: 'row' }, dif,
    h('button', { class: 'btn small', disabled: libres < 1, onclick: () => run('bots:add', { count: 1, difficulty: dif.value }) }, 'Agregar bot'),
    h('button', { class: 'btn small', onclick: () => run('leave') }, 'Levantarme'),
    h('button', { class: 'btn go', disabled: v.players.length < 2, onclick: () => run('start') }, 'Empezar torneo')));
}

function turnControls(inner, mine, phone) {
  const v = snap.view;
  const toCall = v.currentBet - mine.bet;
  const maxT = mine.bet + mine.stack;
  // las apuestas van en múltiplos de 5 (se forman con fichas de 10 y 25); el all-in puede ser cualquier monto
  const minT = Math.min(maxT, Math.ceil((v.currentBet === 0 ? v.bb : v.currentBet + v.minRaise) / 5) * 5);
  const pot = potOf(v);
  const canRaise = maxT > v.currentBet && mine.stack > toCall;
  const key = `${v.handNo}:${v.phase}:${v.toAct}`;
  if (raise.key !== key) { raise = { key, value: minT }; raiseOpen = false; }
  // retirarse cuando se puede pasar gratis casi siempre es un error de dedo: se pide confirmación
  const fold = () => (toCall > 0 || confirm('Puedes pasar gratis, ¿seguro que te retiras?')) && run('act', { type: 'fold' });
  const clock = snap.turnLeftMs != null && h('span', { class: 'hint clock' }, '⏱ ', deadline(snap.turnLeftMs, 'low'));
  const callBtn = toCall <= 0
    ? h('button', { class: 'btn go', onclick: () => run('act', { type: 'check' }) }, 'Pasar')
    : h('button', { class: 'btn go', onclick: () => run('act', { type: 'call' }) }, toCall >= mine.stack ? `All-in ${fmt(mine.stack)}` : `Igualar ${fmt(toCall)}`);
  const verb = v.currentBet === 0 ? 'Apostar' : 'Subir a';

  // celular: una fila con tres botones; Subir cambia la fila por el panel de la cantidad
  if (phone && !raiseOpen) {
    inner.append(h('p', { class: 'hint turnhint' }, toCall > 0 ? ['¡Te toca! Para seguir, iguala ', h('b', {}, fmt(Math.min(toCall, mine.stack))), '.'] : '¡Te toca! Puedes pasar gratis.'),
      h('div', { class: 'row acts' },
      h('button', { class: 'btn fold', onclick: fold }, 'Retirarse'), callBtn,
      canRaise && h('button', { class: 'btn hot', onclick: () => { raiseOpen = true; draw(); } }, v.currentBet === 0 ? 'Apostar' : 'Subir')), clock);
    return;
  }
  if (!phone) inner.append(h('div', { class: 'row' }, h('button', { class: 'btn fold', onclick: fold }, 'Retirarse'), callBtn, clock));
  if (!canRaise) return;

  const clamp = x => { x = Math.round((x || minT) / 5) * 5; return x >= maxT ? maxT : Math.max(minT, x); };
  const rng = h('input', { type: 'range', min: minT, max: maxT, step: 5, value: clamp(raise.value), 'aria-label': 'Cantidad' });
  const num = h('input', { type: 'number', min: minT, max: maxT, step: 5, value: clamp(raise.value), 'aria-label': 'Cantidad' });
  const go = h('button', { class: 'btn hot', onclick: () => run('act', { type: 'raise', amount: clamp(+num.value) }) });
  // celular: − y + mueven la cantidad de una ciega grande en una ciega grande (el slider con el dedo es impreciso)
  const less = h('button', { class: 'btn small step', 'aria-label': 'Una ciega grande menos', onclick: () => setV(raise.value - v.bb) }, '−');
  const more = h('button', { class: 'btn small step', 'aria-label': 'Una ciega grande más', onclick: () => setV(raise.value + v.bb) }, '+');
  const setV = x => {
    x = clamp(x); raise.value = x; rng.value = x; num.value = x;
    go.textContent = x >= maxT ? `All-in ${fmt(x)}` : `${verb} ${fmt(x)}`;
    less.disabled = x <= minT; more.disabled = x >= maxT;
  };
  rng.addEventListener('input', () => setV(+rng.value));
  num.addEventListener('change', () => setV(+num.value));
  const potBet = f => v.currentBet + Math.round((pot + toCall) * f / v.sb) * v.sb;
  setV(raise.value);
  if (phone) {
    inner.append(
      h('div', { class: 'row quick' },
        h('button', { class: 'btn small', onclick: () => setV(potBet(.5)) }, '½ bote'),
        h('button', { class: 'btn small', onclick: () => setV(potBet(1)) }, 'Bote'),
        h('button', { class: 'btn small', onclick: () => setV(maxT) }, 'Todo'),
        h('button', { class: 'btn small cancel', 'aria-label': 'Cerrar sin subir', onclick: () => { raiseOpen = false; draw(); } }, '✕')),
      h('div', { class: 'row amount' }, less, rng, more, go), clock);
    return;
  }
  inner.append(h('div', { class: 'raise' },
    h('button', { class: 'btn small', onclick: () => setV(potBet(.5)) }, '½ bote'),
    h('button', { class: 'btn small', onclick: () => setV(potBet(1)) }, 'Bote'),
    h('button', { class: 'btn small', onclick: () => setV(maxT) }, 'Todo'),
    rng, num, go));
}

/* ---------- final del torneo ---------- */
function finishOverlay() {
  const v = snap.view;
  const campeon = v.players.find(p => p.id === v.winner);
  const orden = v.players.slice().sort((a, b) => a.place - b.place);
  return h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Torneo terminado' },
    h('div', { class: 'card-panel' },
      h('p', { class: 'big' }, campeon ? `${campeon.nick} gana el torneo` : 'Torneo terminado'),
      h('ol', { class: 'note', style: 'padding-left:20px' }, orden.map(p => h('li', {}, `${p.place}.º ${p.nick}${p.isBot ? ' (bot)' : ''}`))),
      h('button', { class: 'btn go', onclick: exitRoom }, 'Volver al inicio')));
}

/* ---------- acciones ---------- */
function sit(seat) {
  if (!nick.trim()) { error = 'Escribe tu apodo abajo antes de sentarte.'; draw(); return; }
  run('sit', { nick, seat });
}
async function exitRoom() {
  await send('room:exit');
  store.del('ppt-room'); snap = null; error = ''; screen = 'home';
  history.replaceState(null, '', location.pathname);
  draw();
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast = 'Link copiado.'; } catch { toast = text; }
  draw(); setTimeout(() => { toast = ''; if (screen === 'table') draw(); }, 3000);
}

/* ---------- pintado ---------- */
function keepFocus(fn) {
  const focus = document.activeElement && document.activeElement.id;
  const val = focus && document.activeElement.value;
  fn();
  if (focus) { const el = document.getElementById(focus); if (el) { el.focus(); if (val != null && 'value' in el && el.type !== 'range') el.value = val; } }
}

function draw() {
  if (screen === 'table' && snap && useStage() && drawStage()) return;
  if (scene) scene.setActive(false);
  const y = scrollY;
  const focus = document.activeElement && document.activeElement.id;
  const val = focus && document.activeElement.value;
  const view = screen === 'access' ? drawAccess() : screen === 'home' ? drawHome() : screen === 'table' && snap ? drawTable() : h('main', { class: 'home' }, logo(), h('p', { class: 'tagline' }, error || 'Conectando…'));
  $app.replaceChildren(view);
  if (focus) { const el = document.getElementById(focus); if (el) { el.focus(); if (val != null && 'value' in el && el.type !== 'range') el.value = val; } }
  scrollTo(0, y);
}
addEventListener('resize', () => { if (screen === 'table' && !(scene && $app.firstChild === shell)) draw(); });
phoneQuery.addEventListener('change', () => { raiseOpen = false; if (screen === 'table') draw(); });

// Mesa ilustrada: las capas se crean una vez y se quedan; solo la interfaz de encima se vuelve a pintar.
function drawStage() {
  if (!sceneMod) {
    loadScene();
    $app.replaceChildren(h('main', { class: 'home' }, logo(), h('p', { class: 'tagline' }, 'Abriendo el garaje…')));
    return true;
  }
  if (!scene) {
    const stage = h('div', { class: 'scene-stage' });
    hudEl = h('div', { class: 'hud' });
    shell = h('div', { class: 'scene-shell' }, stage, hudEl);
    $app.replaceChildren(shell);
    try {
      scene = sceneMod.createTableScene(stage, {
        h, fmt, deadline,
        onSit: sit,
        onRemoveBot: seat => run('bots:remove', { seat }),
      });
    } catch (e) {
      console.error(e);
      sceneFailed = true; scene = null; shell = null;
      return false;
    }
  }
  keepFocus(() => {
    if ($app.firstChild !== shell) $app.replaceChildren(shell);
    hudEl.replaceChildren(...drawHud());
  });
  scene.update(snap);
  scene.setActive(true);
  return true;
}

const QUALITY_NAME = { auto: 'Auto', alta: 'Alta', media: 'Media', baja: 'Baja' };
function drawHud() {
  const v = snap.view, mine = me();
  document.title = (mine && v.toAct === snap.you ? '¡Te toca! ' : '') + 'Poker for the Players';
  const pot = potOf(v);
  const inPlay = mine && betting() && mine.inHand && !mine.folded;
  const toCall = inPlay ? Math.min(Math.max(0, v.currentBet - mine.bet), mine.stack) : 0;
  const cell = (label, value, cls, extra) => h('div', { class: 'cell ' + (cls || '') }, h('span', {}, label), h('b', {}, value), extra && h('small', {}, extra));
  const phone = isPhone();

  // una sola franja: bote, lo que te toca, tus fichas, ciegas y ronda
  const sound = store.get('ppt-sound') === 'on';
  const strip = h('header', { class: 'strip' },
    h('div', { class: 'cells' },
      cell('Bote', fmt(pot), 'c-pot'),
      inPlay && cell('Para igualar', toCall > 0 ? fmt(toCall) : '—', toCall > 0 ? 'c-call' : ''),
      mine && cell('Tus fichas', fmt(mine.stack)),
      cell('Ciegas', `${fmt(v.sb)}/${fmt(v.bb)}`, 'wide', snap.levelLeftMs != null && ['suben en ', deadline(snap.levelLeftMs)]),
      started() && cell('Ronda', PHASE[v.phase] || '—', 'wide')),
    h('div', { class: 'tools' },
      h('span', { class: 'hud-code' }, 'Mesa ', h('b', {}, snap.code)),
      phone ? tool('Menú', '≡', () => { showSide = !showSide; draw(); }, { 'aria-expanded': String(showSide), class: 'tool menu' })
        : tool('Posiciones', '☰', () => { showSide = !showSide; draw(); }, { 'aria-expanded': String(showSide) }),
      ...options(sound, 'opt'),
      tool('Salir', '✕', exitRoom)));

  // el nombre de tu mano (las cartas de la mesa ya se ven en la mesa)
  const myCards = mine && mine.inHand && !mine.folded && mine.cards.length === 2 ? mine.cards : null;
  const hand = myCards && handLabel(myCards, v.board);
  const info = started() && hand && h('div', { class: 'tableinfo' },
    h('div', { class: 'myhand' }, h('span', {}, 'Tu mano'), h('b', {}, hand)));

  // lo que acaba de pasar, en palabras (abajo a la izquierda, junto a la barra; lo más nuevo hasta abajo)
  const recent = v.log.slice(-4).reverse();
  const ticker = started() && recent.length > 0 && h('div', { class: 'ticker', 'aria-live': 'polite' },
    recent.slice(0, 3).reverse().map((t, i, all) => h('p', { class: i === all.length - 1 ? 'new' : 'old' }, t)));

  // celular: la última jugada (o un error) en una sola línea junto a mis cartas, y se borra sola
  if (phone) {
    const logKey = `${v.handNo}:${v.log.length}:${v.log[v.log.length - 1] || ''}`;
    if (logKey !== lastLogKey && v.log.length) {
      // lo nuevo desde la vez pasada (el historial guarda solo las últimas 40); con varios ganadores
      // (bote dividido o botes secundarios) se dicen todos
      const at = lastLog.length ? v.log.lastIndexOf(lastLog[lastLog.length - 1]) : -1;
      const fresh = v.log.slice(at + 1);
      const wins = fresh.filter(t => / gana /.test(t));
      notify(wins.length > 1 ? wins.join(' · ') : fresh[fresh.length - 1] || v.log[v.log.length - 1], 'log');
    }
    lastLogKey = logKey; lastLog = v.log;
  }
  const lost = toast && socket && !socket.connected; // sin conexión: el aviso se queda hasta que vuelva
  const noteLine = lost ? h('p', { class: 'note-line err' }, toast)
    : note && note.until > performance.now() && h('p', { class: 'note-line ' + note.kind, role: note.kind === 'err' ? 'alert' : null, 'aria-live': 'polite' }, note.text);

  const notice = (error || toast) && !(phone && started()) && h('div', { class: 'hud-notice' },
    error && h('p', { class: 'err', role: 'alert' }, error),
    toast && h('p', { class: 'note' }, toast));
  // el aviso del centro (turno, ganadores) va arriba de la barra de acciones para no tapar a los rivales
  const msg = centerMessage();
  const bar = actionBar(phone);
  // en pantallas angostas la última jugada va dentro de la barra (el historial no cabe junto a ella)
  // (en el celular no: ahí el turno lo dicen el aro y la barra en mostaza, y las jugadas van junto a mis cartas)
  if (!phone && started() && recent.length) bar.firstChild.prepend(h('p', { class: 'lastline' }, recent[0]));
  if (!phone && msg && (!Array.isArray(msg) || msg.length)) bar.firstChild.prepend(h('div', { class: 'hud-banner', 'aria-live': 'polite' }, msg));
  // celular: mis dos cartas grandes van en esta franja entre la mesa y la barra (las dibuja la escena dentro
  // de .mc-cards); a un lado el nombre de mi mano y el aviso
  const mycards = phone && h('div', { class: 'mycards' + (started() ? '' : ' idle') },
    h('div', { class: 'mc-cards', 'aria-label': myCards ? myCards.map(cardName).join(' y ') : null, role: myCards ? 'img' : null }),
    h('div', { class: 'mc-side' },
      started() && hand && h('div', { class: 'myhand' }, h('span', {}, 'Tu mano'), h('b', {}, hand)),
      started() && noteLine));
  const li = (label, ...value) => h('li', {}, h('span', {}, label), h('b', {}, ...value));
  const side = showSide && h('aside', { class: 'hud-side' },
    phone && h('div', { class: 'side-info' }, h('h2', {}, 'Mesa'), h('ul', {},
      li('Código', snap.code),
      li('Ciegas', `${fmt(v.sb)}/${fmt(v.bb)}`),
      snap.levelLeftMs != null && li('Suben a', `${fmt(snap.nextBlinds[0])}/${fmt(snap.nextBlinds[1])} en `, deadline(snap.levelLeftMs)),
      started() && li('Ronda', PHASE[v.phase] || '—'),
      started() && li('Mano', String(v.handNo)))),
    h('div', { class: 'side-opts' }, h('h2', {}, 'Opciones'), h('div', { class: 'row' }, options(sound, ''))),
    h('div', {}, h('h2', {}, 'Posiciones'), h('ol', {}, standings(v))),
    h('div', {}, h('h2', {}, 'Valor de las fichas'), h('ul', { class: 'legend' }, CHIPS.slice().reverse().map(c => h('li', {}, h('span', { class: 'dot', style: `background:${c.color};` }), h('span', {}, fmt(c.value)))))),
    h('div', {}, h('h2', {}, 'Últimas jugadas'), h('ul', {}, v.log.slice(-12).reverse().map(t => h('li', {}, t)))),
    phone && h('button', { class: 'btn small side-exit', onclick: exitRoom }, 'Salir de la mesa'));
  if (info && !phone) strip.insertBefore(info, strip.lastChild);
  return [strip, ticker, notice, side, mycards, bar, v.finished && finishOverlay()].filter(Boolean);
}
// Calidad, sonido y vista 2D: en la franja en pantallas anchas, dentro del panel en el celular.
function options(sound, cls) {
  return [
    tool(`Calidad: ${QUALITY_NAME[scene.mode]}${scene.mode === 'auto' ? ' (' + scene.quality + ')' : ''}`, '⚙', cycleQuality, { title: 'Calidad gráfica: Auto, Alta, Media o Baja', class: 'tool ' + cls }),
    h('button', { class: 'tool ' + cls, 'aria-label': sound ? 'Silenciar' : 'Activar sonido', title: 'El sonido llega en una fase siguiente', onclick: () => { store.set('ppt-sound', sound ? 'off' : 'on'); draw(); } }, sound ? '🔊' : '🔇'),
    tool('Vista 2D', '2D', () => { store.set('ppt-view', '2d'); draw(); }, { class: 'tool ' + cls }),
  ];
}
// Botón de la barra de arriba: texto completo en pantallas anchas, ícono en el celular.
function tool(text, icon, onclick, props) {
  return h('button', { class: 'tool', onclick, 'aria-label': text, ...props }, h('span', { class: 'long' }, text), h('span', { class: 'short', 'aria-hidden': 'true' }, icon));
}
function cycleQuality() {
  const order = ['auto', 'alta', 'media', 'baja'];
  scene.setMode(order[(order.indexOf(scene.mode) + 1) % order.length]);
  draw();
}
setInterval(() => { // cuentas regresivas
  const now = performance.now();
  document.querySelectorAll('.cd').forEach(e => { e.textContent = mmss(Number(e.dataset.end) - now); });
}, 250);

/* ---------- arranque ---------- */
(async () => {
  loadScene();
  draw();
  try { accessRequired = (await (await fetch('/api/config')).json()).accessRequired; } catch { /* sigue */ }
  if (accessRequired && !store.get('ppt-access')) { screen = 'access'; draw(); }
  connectSocket();
  if (screen === 'access') socket.disconnect();
})();
