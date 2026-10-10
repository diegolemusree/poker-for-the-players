// Motor de Texas Hold'em No Limit. Puro: recibe un estado y una acción, modifica el estado
// y lanza errores en español. Nada de red ni de sockets aquí dentro.
//
// Garantía: cualquier función que lance un error lo hace ANTES de tocar el estado,
// así que un intento ilegal nunca deja la mesa a medias.

import { randomInt } from 'node:crypto';
import { RANKS, SUITS, bestHand, cmp, handName } from './hands.js';

export const SB = 10;
export const BB = 20;
export const START = 1000;
export const MAXP = 8;
export const TURN_LIMIT = 45000;
export const BETTING = ['preflop', 'flop', 'turn', 'river'];

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

function post(p, amt) {
  const a = Math.max(0, Math.min(amt, p.stack));
  p.stack -= a; p.bet += a; p.total += a;
  if (p.stack === 0) p.allIn = true;
  return a;
}

/* ---------- mesa y asientos ---------- */

export function createState() {
  return {
    players: [], phase: 'lobby', deck: [], board: [], dealerSeat: -1, toAct: null,
    currentBet: 0, minRaise: BB, handNo: 0, log: [], results: null, turnAt: 0,
  };
}

export function addPlayer(s, { id, nick = '', seat }) {
  if (!id) throw new Error('Falta el identificador del jugador.');
  if (!Number.isInteger(seat) || seat < 0 || seat >= MAXP) throw new Error('Ese asiento no existe.');
  if (s.players.some(p => p.id === id)) throw new Error('Ya estás sentado.');
  if (s.players.some(p => p.seat === seat)) throw new Error('Ese asiento ya está ocupado.');
  const p = {
    id, nick: String(nick || '').trim().slice(0, 16), seat, stack: START,
    bet: 0, total: 0, cards: [], folded: false, allIn: false, acted: false, inHand: false,
  };
  s.players.push(p);
  addLog(s, `${label(p)} se sienta con ${START} fichas.`);
  return p;
}

export function removePlayer(s, id) {
  const p = s.players.find(x => x.id === id);
  if (!p) throw new Error('No estás sentado en esta mesa.');
  addLog(s, `${label(p)} se levanta.`);
  if (isBetting(s) && p.inHand) {
    foldOut(s, p);
    if (isBetting(s)) { p.leaving = true; return; } // se va al terminar la mano
  }
  s.players = s.players.filter(x => x.id !== id);
}

export function rebuy(s, id) {
  const p = s.players.find(x => x.id === id);
  if (!p) throw new Error('No estás sentado en esta mesa.');
  if (p.stack > 0) throw new Error('Solo puedes recargar cuando te quedas sin fichas.');
  if (isBetting(s) && p.inHand) throw new Error('Espera a que termine la mano para recargar.');
  p.stack = START;
  addLog(s, `${label(p)} recarga ${START}.`);
}

/* ---------- reglas del juego ---------- */

export function startHand(s) {
  if (!['lobby', 'showdown'].includes(s.phase)) throw new Error('Ya hay una mano en juego.');
  const stay = s.players.filter(p => !p.leaving);
  if (stay.filter(p => p.stack > 0).length < 2) throw new Error('Se necesitan al menos 2 jugadores con fichas.');

  s.players = stay;
  s.players.forEach(p => Object.assign(p, { bet: 0, total: 0, cards: [], folded: false, allIn: false, acted: false, inHand: p.stack > 0 }));
  const ins = s.players.filter(p => p.inHand);
  const dealer = nextFrom(s, s.dealerSeat, p => p.inHand);
  s.dealerSeat = dealer.seat;
  // heads-up: el dealer pone la ciega chica
  const sb = ins.length === 2 ? dealer : nextFrom(s, dealer.seat, p => p.inHand);
  const bb = nextFrom(s, sb.seat, p => p.inHand);
  post(sb, SB); post(bb, BB);
  s.deck = newDeck(); s.board = []; s.results = null;
  for (let r = 0; r < 2; r++) {
    let p = dealer;
    for (let i = 0; i < ins.length; i++) { p = nextFrom(s, p.seat, x => x.inHand); p.cards.push(s.deck.pop()); }
  }
  s.currentBet = BB; s.minRaise = BB; s.phase = 'preflop'; s.handNo = (s.handNo || 0) + 1;
  addLog(s, `Mano ${s.handNo}: reparte ${label(dealer)}. Ciegas de ${label(sb)} y ${label(bb)}.`);
  progress(s, bb.seat);
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
  s.players.forEach(p => { p.bet = 0; p.acted = false; });
  s.currentBet = 0; s.minRaise = BB;
  if (s.phase === 'preflop') { s.board.push(s.deck.pop(), s.deck.pop(), s.deck.pop()); s.phase = 'flop'; }
  else if (s.phase === 'flop') { s.board.push(s.deck.pop()); s.phase = 'turn'; }
  else if (s.phase === 'turn') { s.board.push(s.deck.pop()); s.phase = 'river'; }
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

function winByFold(s) {
  const w = live(s)[0];
  const pot = s.players.reduce((a, p) => a + p.total, 0);
  w.stack += pot;
  s.results = { fold: true, shown: [], winners: [{ id: w.id, name: label(w), amount: pot, hand: '' }] };
  s.phase = 'showdown'; s.toAct = null;
  addLog(s, `${label(w)} gana ${pot} (los demás se retiraron).`);
}

function showdown(s) {
  const L = live(s), sc = {};
  L.forEach(p => { sc[p.id] = bestHand([...p.cards, ...s.board]); });
  const contrib = s.players.filter(p => p.total > 0);
  const levels = [...new Set(contrib.map(p => p.total))].sort((a, b) => a - b);
  const won = {};
  let prev = 0, carry = 0;
  const seatOrder = p => (p.seat - s.dealerSeat - 1 + MAXP) % MAXP;
  for (const lv of levels) {
    let amt = carry; carry = 0;
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
    const share = Math.floor(amt / ws.length);
    let rem = amt - share * ws.length;
    ws.forEach(p => { const a = share + (rem > 0 ? 1 : 0); if (rem > 0) rem--; won[p.id] = (won[p.id] || 0) + a; });
  }
  if (carry) {
    const top = L.slice().sort((a, b) => cmp(sc[b.id], sc[a.id]))[0];
    won[top.id] = (won[top.id] || 0) + carry;
  }
  const winners = [];
  Object.entries(won).forEach(([id, amt]) => {
    const p = s.players.find(x => x.id === id);
    p.stack += amt;
    winners.push({ id, name: label(p), amount: amt, hand: handName(sc[id]) });
    addLog(s, `${label(p)} gana ${amt} con ${handName(sc[id]).toLowerCase()}.`);
  });
  s.results = { fold: false, shown: L.map(p => p.id), hands: Object.fromEntries(L.map(p => [p.id, handName(sc[p.id])])), winners };
  s.phase = 'showdown'; s.toAct = null;
}

// Jugada de `id`: type = 'fold' | 'check' | 'call' | 'raise'. En 'raise', `amount` es el
// total al que se sube (entero), no el incremento; si pasa de tus fichas, es all-in.
export function act(s, id, type, amount) {
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
    const minT = s.currentBet === 0 ? BB : s.currentBet + s.minRaise;
    if (target <= s.currentBet) throw new Error(`Para subir tienes que superar ${s.currentBet}.`);
    if (target < minT && target < maxT) throw new Error(`La apuesta mínima es ${minT}.`);
  } else if (type !== 'fold' && type !== 'call') {
    throw new Error('Jugada no válida.');
  }

  // 2) aplicar
  if (type === 'fold') {
    p.folded = true;
    addLog(s, `${label(p)} se retira.`);
  } else if (type === 'check') {
    addLog(s, `${label(p)} pasa.`);
  } else if (type === 'call') {
    if (toCall <= 0) addLog(s, `${label(p)} pasa.`);
    else { const a = post(p, toCall); addLog(s, `${label(p)} iguala ${a}${p.allIn ? ' (all-in)' : ''}.`); }
  } else {
    const raiseBy = target - s.currentBet;
    const was = s.currentBet;
    post(p, target - p.bet);
    if (raiseBy >= s.minRaise) { s.minRaise = raiseBy; s.players.forEach(x => { if (x !== p) x.acted = false; }); }
    s.currentBet = target;
    addLog(s, `${label(p)} ${was === 0 ? 'apuesta' : 'sube a'} ${target}${p.allIn ? ' (all-in)' : ''}.`);
  }
  p.acted = true;
  progress(s, p.seat);
}

// Retira a un jugador aunque no sea su turno (se levantó o se desconectó).
export function foldOut(s, p) {
  if (!isBetting(s) || !p.inHand || p.folded) return;
  p.folded = true; p.acted = true;
  if (s.toAct === p.id) progress(s, p.seat);
  else if (live(s).length === 1) winByFold(s);
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
  return v;
}
