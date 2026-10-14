// Motor de Texas Hold'em No Limit en formato de torneo. Puro: recibe un estado y una acción,
// modifica el estado y lanza errores en español. Nada de red ni de sockets aquí dentro.
//
// Garantía: cualquier función que lance un error lo hace ANTES de tocar el estado,
// así que un intento ilegal nunca deja la mesa a medias.
//
// Torneo: todos empiezan con `start` fichas, las ciegas suben cada `levelMs`, cada jugador
// tiene una recompra, y el torneo termina cuando solo queda un jugador en pie.

import { randomInt } from 'node:crypto';
import { RANKS, SUITS, bestHand, bestFive, cmp, handName, describeHand } from './hands.js';

export const START = 5000;
export const MAXP = 7; // yo más 6 rivales, como en la composición de la mesa
export const TURN_LIMIT = 45000;
// Cuánto se ve el resultado de una mano antes de repartir la siguiente (antes, si todos tocan Listo).
export const RESULT_MS = 8000;      // cuando se enseñan cartas
export const RESULT_FOLD_MS = 4000; // cuando todos se retiraron: no hay cartas que ver
export const LEVEL_MINUTES = 15;
export const REBUYS = 1;
// La ficha más chica es de 10, pero con fichas de 10 y 25 se forma cualquier múltiplo de 5 desde 20:
// por eso las apuestas van en múltiplos de 5 (salvo el all-in) y los botes se reparten en unidades de 5.
export const CHIP_UNIT = 5;
export const BETTING = ['preflop', 'flop', 'turn', 'river'];
// [ciega chica, ciega grande]. 19 niveles de 15 min = ~4h45; el último se repite.
export const BLINDS = [
  [25, 50], [50, 100], [75, 150], [100, 200], [125, 250], [150, 300], [200, 400], [250, 500], [300, 600],
  [400, 800], [500, 1000], [600, 1200], [800, 1600], [1000, 2000], [1250, 2500], [1500, 3000],
  [2000, 4000], [2500, 5000], [3000, 6000],
];

/* ---------- ayudas ---------- */

export const label = p => p.nick || ('Asiento ' + (p.seat + 1));
export const sorted = s => s.players.slice().sort((a, b) => a.seat - b.seat);
export const live = s => s.players.filter(p => p.inHand && !p.folded);
export const canAct = p => p.inHand && !p.folded && !p.allIn;
export const isBetting = s => BETTING.includes(s.phase);

export function newDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function nextFrom(s, seat, pred) {
  const ps = sorted(s);
  for (let k = 1; k <= MAXP; k++) {
    const t = (seat + k + MAXP) % MAXP;
    const p = ps.find(x => x.seat === t);
    if (p && pred(p)) return p;
  }
  return null;
}

function addLog(s, text) {
  s.log.push(text);
  if (s.log.length > 40) s.log = s.log.slice(-40);
}

// Última jugada de cada quien (para mostrarla en la mesa) y un contador para animar la más reciente.
function mark(s, p, type, amount = 0) {
  s.actionNo = (s.actionNo || 0) + 1;
  p.lastAction = { type, amount, allIn: !!p.allIn, n: s.actionNo };
  s.lastAction = { id: p.id, ...p.lastAction };
}
const CARD = c => (c[0] === 'T' ? '10' : c[0]) + { s: '♠', h: '♥', d: '♦', c: '♣' }[c[1]];

function post(p, amt) {
  const a = Math.max(0, Math.min(amt, p.stack));
  p.stack -= a; p.bet += a; p.total += a;
  if (p.stack === 0) p.allIn = true;
  return a;
}

/* ---------- mesa y asientos ---------- */

// opts: { start, levels, levelMinutes, levelMs, rebuys }
export function createState(opts = {}) {
  const levels = opts.levels || BLINDS;
  return {
    config: {
      start: opts.start || START,
      levels,
      levelMs: opts.levelMs || (opts.levelMinutes || LEVEL_MINUTES) * 60000,
      rebuys: opts.rebuys ?? REBUYS,
    },
    players: [], phase: 'lobby', deck: [], board: [], dealerSeat: -1, toAct: null,
    level: 0, sb: levels[0][0], bb: levels[0][1], levelEndsAt: null,
    currentBet: 0, minRaise: levels[0][1], handNo: 0, log: [], results: null, turnAt: 0,
    finished: false, winner: null,
  };
}

export function addPlayer(s, { id, nick = '', seat }) {
  if (s.handNo > 0) throw new Error('El torneo ya empezó, no se pueden sentar más jugadores.');
  if (!id) throw new Error('Falta el identificador del jugador.');
  if (!Number.isInteger(seat) || seat < 0 || seat >= MAXP) throw new Error('Ese asiento no existe.');
  if (s.players.some(p => p.id === id)) throw new Error('Ya estás sentado.');
  if (s.players.some(p => p.seat === seat)) throw new Error('Ese asiento ya está ocupado.');
  const p = {
    id, nick: String(nick || '').trim().slice(0, 16), seat, stack: s.config.start,
    bet: 0, total: 0, cards: [], folded: false, allIn: false, acted: false, inHand: false,
    rebuysLeft: s.config.rebuys, out: false, place: null, sittingOut: false, startStack: 0,
  };
  s.players.push(p);
  addLog(s, `${label(p)} se sienta con ${p.stack} fichas.`);
  return p;
}

// Solo antes de que empiece el torneo. Después se usa resign().
export function removePlayer(s, id) {
  const p = s.players.find(x => x.id === id);
  if (!p) throw new Error('No estás sentado en esta mesa.');
  if (s.handNo > 0) throw new Error('El torneo ya empezó. Puedes retirarte, pero tu lugar se queda en la mesa.');
  addLog(s, `${label(p)} se levanta.`);
  s.players = s.players.filter(x => x.id !== id);
}

// Dejar de jugar sin salirse: se retira de cada mano (y paga ciegas) hasta que vuelva con sitIn().
export function resign(s, id) {
  const p = s.players.find(x => x.id === id);
  if (!p) throw new Error('No estás sentado en esta mesa.');
  if (p.out) throw new Error('Ya quedaste fuera del torneo.');
  p.sittingOut = true;
  addLog(s, `${label(p)} se ausenta.`);
  foldOut(s, p);
}

export function sitIn(s, id) {
  const p = s.players.find(x => x.id === id);
  if (!p) throw new Error('No estás sentado en esta mesa.');
  if (p.sittingOut) { p.sittingOut = false; addLog(s, `${label(p)} vuelve a la mesa.`); }
}

// Jugadores sin fichas que todavía pueden decidir si recompran.
export function pendingRebuys(s) {
  if (s.finished || isBetting(s)) return [];
  return s.players.filter(p => !p.out && p.stack === 0);
}

export function rebuy(s, id) {
  const p = s.players.find(x => x.id === id);
  if (!p) throw new Error('No estás sentado en esta mesa.');
  if (p.out) throw new Error('Ya quedaste fuera del torneo.');
  if (p.stack > 0) throw new Error('Solo puedes recomprar cuando te quedas sin fichas.');
  if (isBetting(s) && p.inHand) throw new Error('Espera a que termine la mano para recomprar.');
  if (p.rebuysLeft <= 0) throw new Error('Ya usaste tu recompra.');
  p.rebuysLeft--; p.stack = s.config.start;
  addLog(s, `${label(p)} recompra ${s.config.start} fichas.`);
}

// Renunciar a la recompra: quedas fuera.
export function declineRebuy(s, id) {
  const p = s.players.find(x => x.id === id);
  if (!p) throw new Error('No estás sentado en esta mesa.');
  if (p.out) throw new Error('Ya quedaste fuera del torneo.');
  if (p.stack > 0) throw new Error('Todavía tienes fichas.');
  if (isBetting(s) && p.inHand) throw new Error('Espera a que termine la mano.');
  eliminate(s, p);
  checkEnd(s);
}

function eliminate(s, p) {
  p.out = true;
  p.place = s.players.filter(x => !x.out).length + 1;
  p.sittingOut = false;
  addLog(s, `${label(p)} queda fuera del torneo en el lugar ${p.place}.`);
}

function checkEnd(s) {
  const alive = s.players.filter(p => !p.out);
  if (s.handNo > 0 && alive.length === 1 && !s.finished) {
    s.finished = true; s.winner = alive[0].id; alive[0].place = 1;
    addLog(s, `${label(alive[0])} gana el torneo.`);
  }
}

// Al terminar una mano: elimina a quien se quedó sin fichas y ya no tiene recompra.
function afterHand(s) {
  const busted = s.players.filter(p => p.inHand && p.stack === 0 && !p.out && p.rebuysLeft <= 0)
    .sort((a, b) => a.startStack - b.startStack); // el que llegó con menos, queda peor
  for (const p of busted) eliminate(s, p);
  checkEnd(s);
}

/* ---------- reglas del juego ---------- */

export function levelAt(s, now) {
  const last = s.config.levels.length - 1;
  while (s.levelEndsAt !== null && now >= s.levelEndsAt && s.level < last) {
    s.level++; s.levelEndsAt += s.config.levelMs;
  }
  return s.config.levels[s.level];
}

export function startHand(s, now = Date.now()) {
  if (s.finished) throw new Error('El torneo ya terminó.');
  if (!['lobby', 'showdown'].includes(s.phase)) throw new Error('Ya hay una mano en juego.');
  const withChips = s.players.filter(p => p.stack > 0);
  if (withChips.length < 2) throw new Error('Se necesitan al menos 2 jugadores con fichas.');
  if (withChips.every(p => p.sittingOut)) throw new Error('Todos los jugadores están ausentes.');

  if (s.levelEndsAt === null) s.levelEndsAt = now + s.config.levelMs; // el reloj arranca con la primera mano
  const prevLevel = s.level;
  [s.sb, s.bb] = levelAt(s, now);
  if (s.level !== prevLevel) addLog(s, `Suben las ciegas a ${s.sb}/${s.bb}.`);

  s.players.forEach(p => Object.assign(p, { bet: 0, total: 0, cards: [], folded: false, allIn: false, acted: false, inHand: p.stack > 0, startStack: p.stack, lastAction: null }));
  const ins = s.players.filter(p => p.inHand);
  const dealer = nextFrom(s, s.dealerSeat, p => p.inHand);
  s.dealerSeat = dealer.seat;
  // heads-up: el dealer pone la ciega chica
  const sb = ins.length === 2 ? dealer : nextFrom(s, dealer.seat, p => p.inHand);
  const bb = nextFrom(s, sb.seat, p => p.inHand);
  post(sb, s.sb); post(bb, s.bb);
  mark(s, sb, 'sb', sb.bet); mark(s, bb, 'bb', bb.bet);
  s.deck = newDeck(); s.board = []; s.results = null;
  for (let r = 0; r < 2; r++) {
    let p = dealer;
    for (let i = 0; i < ins.length; i++) { p = nextFrom(s, p.seat, x => x.inHand); p.cards.push(s.deck.pop()); }
  }
  s.currentBet = s.bb; s.minRaise = s.bb; s.phase = 'preflop'; s.handNo++;
  addLog(s, `Mano ${s.handNo}: reparte ${label(dealer)}. Ciegas de ${label(sb)} y ${label(bb)}.`);
  progress(s, bb.seat);
  settleSitters(s);
}

function roundDone(s) {
  const actors = s.players.filter(canAct);
  if (actors.length <= 1) {
    const maxBet = Math.max(0, ...live(s).map(p => p.bet));
    return actors.length === 0 || actors[0].bet >= maxBet;
  }
  return actors.every(p => p.acted && p.bet === s.currentBet);
}

function nextStreet(s) {
  s.players.forEach(p => { p.bet = 0; p.acted = false; if (p.lastAction && p.lastAction.type !== 'fold') p.lastAction = null; });
  s.currentBet = 0; s.minRaise = s.bb;
  if (s.phase === 'preflop') { s.board.push(s.deck.pop(), s.deck.pop(), s.deck.pop()); s.phase = 'flop'; addLog(s, `Sale el flop: ${s.board.map(CARD).join(' ')}.`); }
  else if (s.phase === 'flop') { s.board.push(s.deck.pop()); s.phase = 'turn'; addLog(s, `Sale el turn: ${CARD(s.board[3])}.`); }
  else if (s.phase === 'turn') { s.board.push(s.deck.pop()); s.phase = 'river'; addLog(s, `Sale el river: ${CARD(s.board[4])}.`); }
}

function progress(s, lastSeat) {
  if (live(s).length === 1) return winByFold(s);
  if (roundDone(s)) {
    if (s.phase === 'river') return showdown(s);
    nextStreet(s);
    if (s.players.filter(canAct).length <= 1) {
      while (s.phase !== 'river') nextStreet(s);
      return showdown(s);
    }
    const first = nextFrom(s, s.dealerSeat, canAct);
    s.toAct = first.id; s.turnAt = Date.now();
    return;
  }
  const nxt = nextFrom(s, lastSeat, p => canAct(p) && (!p.acted || p.bet < s.currentBet));
  if (!nxt) { // red de seguridad
    s.players.forEach(p => { if (canAct(p)) p.acted = true; });
    return progress(s, lastSeat);
  }
  s.toAct = nxt.id; s.turnAt = Date.now();
}

// Resultado de la mano (lo ven todos, así que solo trae cartas y manos de quienes las enseñaron):
//   fold     true si ganó porque los demás se retiraron (entonces no enseña sus cartas)
//   shown    quienes llegaron al final y enseñan sus cartas, de la mejor mano a la peor
//   hands    nombre corto de la mano de cada uno ('Color'); desc, el completo ('Color de corazones')
//   best     las 5 cartas de la mano de cada uno (las propias que usó y las de la mesa)
//   pots     cada bote: monto, quiénes podían ganarlo (eligible), quién lo ganó (winners), cuánto le
//            tocó a cada quien (shares) y con qué mano (hand). El primero es el principal.
//   refunds  lo que alguien apostó y nadie pudo igualar: se le regresa, no es premio
//   winners  quién ganó algo y cuánto en total (sin devoluciones)
function winByFold(s) {
  const w = live(s)[0];
  const pot = s.players.reduce((a, p) => a + p.total, 0);
  w.stack += pot;
  s.results = {
    fold: true, shown: [], refunds: [],
    pots: [{ amount: pot, eligible: [w.id], winners: [w.id], shares: { [w.id]: pot }, hand: '' }],
    winners: [{ id: w.id, name: label(w), amount: pot, hand: '' }],
  };
  s.phase = 'showdown'; s.toAct = null;
  addLog(s, `${label(w)} gana ${pot} (los demás se retiraron).`);
  afterHand(s);
}

const lowerFirst = t => t.charAt(0).toLowerCase() + t.slice(1);

function showdown(s) {
  const L = live(s), sc = {}, five = {};
  L.forEach(p => { sc[p.id] = bestHand([...p.cards, ...s.board]); five[p.id] = bestFive(p.cards, s.board).cards; });
  const desc = id => describeHand(sc[id], five[id]);
  const contrib = s.players.filter(p => p.total > 0);
  const levels = [...new Set(contrib.map(p => p.total))].sort((a, b) => a - b);
  const won = {};
  const pots = [], refunds = []; // solo para explicar el reparto: no cambian lo que recibe cada quien
  let prev = 0, carry = 0;
  const seatOrder = p => (p.seat - s.dealerSeat - 1 + MAXP) % MAXP;
  for (const lv of levels) {
    let amt = carry; carry = 0;
    const payers = contrib.filter(p => p.total > prev);
    contrib.forEach(p => { amt += Math.max(0, Math.min(p.total, lv) - prev); });
    prev = lv;
    const elig = L.filter(p => p.total >= lv);
    if (!elig.length) { carry = amt; continue; }
    let top = null, ws = [];
    elig.forEach(p => {
      const c = top ? cmp(sc[p.id], top) : 1;
      if (c > 0) { top = sc[p.id]; ws = [p]; } else if (c === 0) ws.push(p);
    });
    ws.sort((a, b) => seatOrder(a) - seatOrder(b));
    // reparto en unidades de 5; lo que sobra va al primer ganador después del dealer
    const units = Math.floor(amt / CHIP_UNIT);
    const share = Math.floor(units / ws.length);
    let rem = units - share * ws.length, loose = amt - units * CHIP_UNIT;
    const shares = {};
    ws.forEach(p => {
      let a = share * CHIP_UNIT;
      if (rem > 0) { a += CHIP_UNIT; rem--; }
      a += loose; loose = 0;
      won[p.id] = (won[p.id] || 0) + a;
      shares[p.id] = a;
    });
    // lo que solo puso uno y nadie igualó se le regresa; los niveles seguidos con los mismos jugadores
    // con derecho son un solo bote (lo que dejó quien se retiró no hace bote aparte, solo un all-in)
    const ids = elig.map(p => p.id), last = pots[pots.length - 1];
    if (payers.length === 1 && ids.length === 1 && payers[0].id === ids[0]) refunds.push({ id: ids[0], amount: amt });
    else if (last && last.eligible.join() === ids.join()) {
      last.amount += amt;
      for (const [id, a] of Object.entries(shares)) last.shares[id] += a;
    } else pots.push({ amount: amt, eligible: ids, winners: ws.map(p => p.id), shares, hand: desc(ws[0].id) });
  }
  if (carry) { // lo que dejó en lo más alto quien se retiró: a la mejor mano (gana el bote principal)
    const top = L.slice().sort((a, b) => cmp(sc[b.id], sc[a.id]))[0];
    won[top.id] = (won[top.id] || 0) + carry;
    pots[0].amount += carry; pots[0].shares[top.id] += carry;
  }
  for (const [id, amt] of Object.entries(won)) s.players.find(x => x.id === id).stack += amt;
  // ganadores: lo que se llevó cada quien de los botes (en el orden de los botes), sin devoluciones
  const winners = [];
  for (const pot of pots) {
    for (const [id, a] of Object.entries(pot.shares)) {
      const w = winners.find(x => x.id === id);
      if (w) w.amount += a;
      else winners.push({ id, name: label(s.players.find(x => x.id === id)), amount: a, hand: desc(id) });
    }
  }
  winners.forEach(w => addLog(s, `${w.name} gana ${w.amount} con ${lowerFirst(w.hand)}.`));
  refunds.forEach(r => addLog(s, `A ${label(s.players.find(x => x.id === r.id))} se le regresan ${r.amount} que nadie igualó.`));
  const order = L.slice().sort((a, b) => cmp(sc[b.id], sc[a.id]) || seatOrder(a) - seatOrder(b));
  s.results = {
    fold: false, shown: order.map(p => p.id),
    hands: Object.fromEntries(L.map(p => [p.id, handName(sc[p.id])])),
    desc: Object.fromEntries(L.map(p => [p.id, desc(p.id)])),
    best: Object.fromEntries(L.map(p => [p.id, five[p.id]])),
    pots, refunds, winners,
  };
  s.phase = 'showdown'; s.toAct = null;
  afterHand(s);
}

function applyAct(s, id, type, amount) {
  if (!isBetting(s) || s.toAct !== id) throw new Error('No es tu turno.');
  const p = s.players.find(x => x.id === id);
  const toCall = s.currentBet - p.bet;

  // 1) validar todo, sin tocar nada
  let target = 0;
  if (type === 'check') {
    if (toCall > 0) throw new Error('No puedes pasar, hay una apuesta.');
  } else if (type === 'raise') {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('El monto debe ser un número entero mayor que cero.');
    const maxT = p.bet + p.stack;
    target = Math.min(amount, maxT);
    const minT = s.currentBet === 0 ? s.bb : s.currentBet + s.minRaise;
    if (target <= s.currentBet) throw new Error(`Para subir tienes que superar ${s.currentBet}.`);
    if (target < minT && target < maxT) throw new Error(`La apuesta mínima es ${minT}.`);
    if (target < maxT && target % CHIP_UNIT !== 0) throw new Error(`Las apuestas van en múltiplos de ${CHIP_UNIT}.`);
  } else if (type !== 'fold' && type !== 'call') {
    throw new Error('Jugada no válida.');
  }

  // 2) aplicar
  if (type === 'fold') {
    p.folded = true;
    mark(s, p, 'fold');
    addLog(s, `${label(p)} se retira.`);
  } else if (type === 'check') {
    mark(s, p, 'check');
    addLog(s, `${label(p)} pasa.`);
  } else if (type === 'call') {
    if (toCall <= 0) { mark(s, p, 'check'); addLog(s, `${label(p)} pasa.`); }
    else { const a = post(p, toCall); mark(s, p, 'call', a); addLog(s, `${label(p)} iguala ${a}${p.allIn ? ' (all-in)' : ''}.`); }
  } else {
    const raiseBy = target - s.currentBet;
    const was = s.currentBet;
    post(p, target - p.bet);
    if (raiseBy >= s.minRaise) { s.minRaise = raiseBy; s.players.forEach(x => { if (x !== p) x.acted = false; }); }
    s.currentBet = target;
    mark(s, p, was === 0 ? 'bet' : 'raise', target);
    addLog(s, `${label(p)} ${was === 0 ? 'apuesta' : 'sube a'} ${target}${p.allIn ? ' (all-in)' : ''}.`);
  }
  p.acted = true;
  progress(s, p.seat);
}

// Los ausentes se retiran (o pasan) solos en cuanto les toca.
function settleSitters(s) {
  for (let guard = 0; guard < 100 && isBetting(s); guard++) {
    const p = s.players.find(x => x.id === s.toAct);
    if (!p || !p.sittingOut) return;
    applyAct(s, p.id, s.currentBet - p.bet > 0 ? 'fold' : 'check');
  }
}

// Jugada de `id`: type = 'fold' | 'check' | 'call' | 'raise'. En 'raise', `amount` es el
// total al que se sube (entero), no el incremento; si pasa de tus fichas, es all-in.
export function act(s, id, type, amount) {
  applyAct(s, id, type, amount);
  settleSitters(s);
}

// Lo que pasa cuando se acaba el tiempo del turno: se retira si hay apuesta, si no pasa.
export function autoAct(s) {
  const p = s.players.find(x => x.id === s.toAct);
  if (!isBetting(s) || !p) throw new Error('No hay turno pendiente.');
  act(s, p.id, s.currentBet - p.bet > 0 ? 'fold' : 'check');
}

// Retira a un jugador aunque no sea su turno (se ausentó o se desconectó).
export function foldOut(s, p) {
  if (!isBetting(s) || !p.inHand || p.folded) return;
  p.folded = true; p.acted = true;
  if (s.toAct === p.id) progress(s, p.seat);
  else if (live(s).length === 1) winByFold(s);
  settleSitters(s);
}

/* ---------- vista filtrada para cada jugador ---------- */

// Copia del estado que puede mandarse a `playerId` (o a un espectador si es null):
// sin mazo, y con las cartas ajenas ocultas (null) salvo las reveladas en un showdown real.
export function viewFor(state, playerId) {
  const v = structuredClone(state);
  delete v.deck;
  const reveal = v.phase === 'showdown' && v.results && !v.results.fold ? v.results.shown : [];
  for (const p of v.players) {
    if (p.id === playerId || reveal.includes(p.id)) continue;
    p.cards = p.cards.map(() => null);
  }
  // el resultado solo trae manos de quienes las enseñaron; se vuelve a filtrar aquí por si acaso
  for (const k of ['hands', 'desc', 'best']) {
    if (v.results && v.results[k]) v.results[k] = Object.fromEntries(Object.entries(v.results[k]).filter(([id]) => reveal.includes(id)));
  }
  return v;
}
