// Cliente 2D sencillo. Todo texto de usuarios se pone con textContent / nodos de texto, nunca con innerHTML.

const MAXP = 8;
const GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_NAME = { s: 'picas', h: 'corazones', d: 'diamantes', c: 'tréboles' };
const BETTING = ['preflop', 'flop', 'turn', 'river'];
const DIF = { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil' };
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
  kids.flat().forEach(c => { if (c != null && c !== false) e.append(c); });
  return e;
}
const fmt = n => Number(n).toLocaleString('es-MX');
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

const logo = () => h('h1', { class: 'logo' }, 'Poker for the Players', h('small', {}, '♠ ♥ torneo entre amigos ♦ ♣'));

function drawHome() {
  const nickIn = h('input', { type: 'text', maxLength: 16, id: 'nick', value: nick, placeholder: 'Tu apodo', autocomplete: 'off' });
  nickIn.addEventListener('input', () => { nick = nickIn.value; store.set('ppt-nick', nick); });
  const need = () => { if (!nick.trim()) { error = 'Escribe tu apodo primero.'; draw(); nickIn.focus(); return false; } return true; };

  const bots = h('select', { id: 'bots', 'aria-label': 'Número de rivales' }, [1, 2, 3, 4, 5, 6, 7].map(n => h('option', { value: n, selected: n === 3 }, `${n} ${n === 1 ? 'rival' : 'rivales'}`)));
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
      pot > 0 && h('div', { class: 'pot' }, h('span', { class: 'chip' }), fmt(pot)), msg));

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
      table.append(h('div', { class: 'bet', style: `left:${50 + rx * .62 * Math.cos(ang)}%;top:${50 + ry * .58 * Math.sin(ang)}%` }, h('span', { class: 'chip' }), fmt(p.bet)));
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
    return p ? (p.id === snap.you ? 'Te toca' : `Turno de ${p.nick}`) : '';
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
function actionBar() {
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

  if (betting() && v.toAct === snap.you) { turnControls(inner, mine); return h('div', { class: 'bar' }, inner); }

  if (betting()) {
    const cur = v.players.find(p => p.id === v.toAct);
    hint(cur ? `Esperando a ${cur.nick}…` : 'Esperando…');
  } else hint(v.phase === 'showdown' ? 'La siguiente mano se reparte sola.' : 'Esperando…');
  inner.append(h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => confirm('Te retirarás de cada mano (pagando ciegas) hasta que vuelvas. ¿Ausentarte?') && run('resign') }, 'Ausentarme')));
  return h('div', { class: 'bar' }, inner);
}

function lobbyControls(inner) {
  const v = snap.view;
  const link = `${location.origin}/?mesa=${snap.code}`;
  inner.append(
    h('p', { class: 'hint' }, `Mesa ${snap.code}. Pásales este link a tus amigos y siéntense. Torneo: ${fmt(5000)} fichas, ciegas cada ${snap.levelMinutes} min, una recompra por persona; termina cuando alguien tenga todas las fichas.`),
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

function turnControls(inner, mine) {
  const v = snap.view;
  const toCall = v.currentBet - mine.bet;
  const maxT = mine.bet + mine.stack;
  const minT = Math.min(maxT, v.currentBet === 0 ? v.bb : v.currentBet + v.minRaise);
  const pot = potOf(v);
  const r1 = h('div', { class: 'row' },
    h('button', { class: 'btn', onclick: () => run('act', { type: 'fold' }) }, 'Retirarse'),
    toCall <= 0
      ? h('button', { class: 'btn go', onclick: () => run('act', { type: 'check' }) }, 'Pasar')
      : h('button', { class: 'btn go', onclick: () => run('act', { type: 'call' }) }, toCall >= mine.stack ? `All-in ${fmt(mine.stack)}` : `Igualar ${fmt(toCall)}`),
    snap.turnLeftMs != null && h('span', { class: 'hint' }, 'Te quedan ', deadline(snap.turnLeftMs, 'low')));
  inner.append(r1);
  if (!(maxT > v.currentBet && mine.stack > toCall)) return;

  const key = `${v.handNo}:${v.phase}:${v.toAct}`;
  if (raise.key !== key) raise = { key, value: minT };
  const clamp = x => Math.max(minT, Math.min(maxT, Math.round(x) || minT));
  const rng = h('input', { type: 'range', min: minT, max: maxT, step: Math.max(1, Math.round(v.sb / 5)), value: clamp(raise.value), 'aria-label': 'Cantidad' });
  const num = h('input', { type: 'number', min: minT, max: maxT, step: 1, value: clamp(raise.value), 'aria-label': 'Cantidad' });
  const verb = v.currentBet === 0 ? 'Apostar' : 'Subir a';
  const go = h('button', { class: 'btn hot', onclick: () => run('act', { type: 'raise', amount: clamp(+num.value) }) });
  const setV = x => { x = clamp(x); raise.value = x; rng.value = x; num.value = x; go.textContent = x >= maxT ? `All-in ${fmt(x)}` : `${verb} ${fmt(x)}`; };
  rng.addEventListener('input', () => setV(+rng.value));
  num.addEventListener('change', () => setV(+num.value));
  const potBet = f => v.currentBet + Math.round((pot + toCall) * f / v.sb) * v.sb;
  setV(raise.value);
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
function draw() {
  const y = scrollY;
  const focus = document.activeElement && document.activeElement.id;
  const val = focus && document.activeElement.value;
  const view = screen === 'access' ? drawAccess() : screen === 'home' ? drawHome() : screen === 'table' && snap ? drawTable() : h('main', { class: 'home' }, logo(), h('p', { class: 'tagline' }, error || 'Conectando…'));
  $app.replaceChildren(view);
  if (focus) { const el = document.getElementById(focus); if (el) { el.focus(); if (val != null && 'value' in el && el.type !== 'range') el.value = val; } }
  scrollTo(0, y);
}
addEventListener('resize', () => { if (screen === 'table') draw(); });
setInterval(() => { // cuentas regresivas
  const now = performance.now();
  document.querySelectorAll('.cd').forEach(e => { e.textContent = mmss(Number(e.dataset.end) - now); });
}, 250);

/* ---------- arranque ---------- */
(async () => {
  draw();
  try { accessRequired = (await (await fetch('/api/config')).json()).accessRequired; } catch { /* sigue */ }
  if (accessRequired && !store.get('ppt-access')) { screen = 'access'; draw(); }
  connectSocket();
  if (screen === 'access') socket.disconnect();
})();
