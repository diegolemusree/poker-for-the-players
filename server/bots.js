// Bots de póker. Viven aparte del motor y solo reciben la vista filtrada de viewFor():
// su propia mano, el tablero y los datos públicos de la mesa. Nunca ven el mazo ni cartas ajenas.
//
// decide(view, myId, opts) -> { type: 'fold' | 'check' | 'call' | 'raise', amount? }
// La jugada siempre es legal; se aplica con el mismo act() del motor que usan los humanos.

import { readFileSync } from 'node:fs';
import { RANKS, SUITS, bestHand, cmp } from './hands.js';
import { CHIP_UNIT, MAXP } from './engine.js';

export const DIFFICULTIES = ['facil', 'normal', 'dificil'];

// Qué tan bien juega cada nivel. `iters` = repeticiones de la simulación Monte Carlo.
const LEVELS = {
  facil:   { iters: 300, noise: 0.30, callMargin: -0.12, looseCall: 0.25, raiseQ: 0.75, betQ: 0.70, aggr: 0.35, bluff: 0,    pushBBs: 0,  delay: [1000, 2500] },
  normal:  { iters: 400, noise: 0.12, callMargin: 0.02,  looseCall: 0.05, raiseQ: 0.55, betQ: 0.45, aggr: 0.65, bluff: 0.06, pushBBs: 7,  delay: [1000, 3000] },
  dificil: { iters: 800, noise: 0.04, callMargin: 0.04,  looseCall: 0,    raiseQ: 0.50, betQ: 0.38, aggr: 0.80, bluff: 0.12, pushBBs: 12, delay: [1000, 3000] },
};

// Los personajes del cuarto (client/stage/personajes.json, el mismo registro que dibuja el juego), cada uno con
// el nombre que lleva el bot que lo usa y cuántas sillas ocupa (Don Tentáculos, 2: se sienta al centro). Los
// marcados "retirado" ya no salen.
const REGISTRO = JSON.parse(readFileSync(new URL('../client/stage/personajes.json', import.meta.url), 'utf8'));
export const CAST = Object.entries(REGISTRO).filter(([, c]) => !c.retirado).map(([id, c]) => ({ id, name: c.name, sillas: c.sillas || 1 }));

// Nombres de repuesto, por si un bot se queda sin personaje (más bots que personajes, o un humano ya usa
// el nombre de uno).
export const BOT_NAMES = [
  'Don Chepe', 'Doña Chuy', 'La Comadre Xyla', 'Chato Quark', 'Mamá Tentáculos', 'El Licenciado Bzzt', 'Güero Nebulón',
];

export function botDelay(difficulty, rng = Math.random) {
  const [a, b] = (LEVELS[difficulty] || LEVELS.normal).delay;
  return a + rng() * (b - a);
}

// Bots nuevos: cada uno con un personaje distinto, al azar entre los que nadie usa en la mesa, y el nombre de ese
// personaje. `taken`: apodos ya usados en la mesa; `used`: personajes que ya tienen otros (el que eligió el jugador
// y los de otros bots); `cast`: los personajes en uso. Primero salen los personajes cuyo nombre nadie usa; si un
// humano se puso de apodo el nombre de uno y hace falta ese personaje, el bot lo lleva con un nombre de repuesto.
export function makeBots(count, difficulty, taken = [], rng = Math.random, used = [], cast = CAST) {
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const free = cast.filter(c => !used.includes(c.id));
  const looks = [...shuffle(free.filter(c => !taken.includes(c.name))), ...shuffle(free.filter(c => taken.includes(c.name)))];
  const spare = shuffle(BOT_NAMES.filter(n => !taken.includes(n)));
  let s = 0;
  return Array.from({ length: count }, (_, i) => {
    const c = looks[i];
    return {
      name: c && !taken.includes(c.name) ? c.name : spare[s++] || `Bot ${i + 1}`,
      character: c ? c.id : null,
      difficulty,
      style: { loose: (rng() - 0.5) * 0.1, aggr: 0.8 + rng() * 0.4 }, // cada bot con su carácter
    };
  });
}

// Los bots recompran casi siempre.
export const botWantsRebuy = (rng = Math.random) => rng() < 0.85;

// Equidad aproximada de mi mano contra manos al azar, usando solo lo que veo.
function equity(me, board, nOpp, iters, rng) {
  const known = new Set([...me.cards, ...board]);
  const rest = [];
  for (const r of RANKS) for (const s of SUITS) if (!known.has(r + s)) rest.push(r + s);
  const need = 2 * nOpp + (5 - board.length);
  let acc = 0;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < need; i++) { // mezcla parcial: solo las cartas que se usan
      const j = i + Math.floor(rng() * (rest.length - i));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const full = board.concat(rest.slice(2 * nOpp, need));
    const mine = bestHand([...me.cards, ...full]);
    let beaten = true, ties = 0;
    for (let o = 0; o < nOpp && beaten; o++) {
      const c = cmp(mine, bestHand([rest[2 * o], rest[2 * o + 1], ...full]));
      if (c < 0) beaten = false; else if (c === 0) ties++;
    }
    if (beaten) acc += 1 / (ties + 1);
  }
  return acc / iters;
}

export function decide(view, myId, { difficulty = 'normal', rng = Math.random, iterations, style = {} } = {}) {
  const cfg = LEVELS[difficulty] || LEVELS.normal;
  const me = view.players.find(p => p.id === myId);
  if (!me || !me.cards.length || me.cards.some(c => typeof c !== 'string')) throw new Error('El bot no tiene cartas propias que ver.');

  const toCall = view.currentBet - me.bet;
  const pot = view.players.reduce((a, p) => a + p.total, 0);
  const rivals = view.players.filter(p => p.id !== myId && p.inHand && !p.folded);
  const n = Math.max(1, rivals.length);
  const maxT = me.bet + me.stack;
  const minT = view.currentBet === 0 ? view.bb : view.currentBet + view.minRaise;
  const low = Math.min(minT, maxT);
  const canRaise = me.stack > toCall;
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const bbs = me.stack / view.bb;

  // posición: 0 = primero en hablar después del dealer, 1 = el dealer
  const order = view.players.filter(p => p.inHand && !p.folded)
    .sort((a, b) => ((a.seat - view.dealerSeat - 1 + MAXP) % MAXP) - ((b.seat - view.dealerSeat - 1 + MAXP) % MAXP));
  const late = order.length > 1 ? order.findIndex(p => p.id === myId) / (order.length - 1) : 1;

  const e = equity(me, view.board, n, iterations || cfg.iters, rng);
  const fair = 1 / (n + 1);
  const noise = (rng() - 0.5) * cfg.noise + (style.loose || 0);
  const q = (e - fair) / (1 - fair) + noise; // 0 = mano promedio, 1 = invencible
  const aggr = Math.min(0.95, cfg.aggr * (style.aggr || 1));
  const call = () => ({ type: toCall > 0 ? 'call' : 'check' });
  const shove = () => ({ type: 'raise', amount: maxT });
  const sizing = (frac) => { // sube a currentBet + fracción del bote
    let target = view.currentBet + (pot + toCall) * frac;
    target = Math.ceil(Math.max(low, target) / CHIP_UNIT) * CHIP_UNIT; // se forma con fichas reales
    if (target >= maxT || maxT - target < view.bb * 2) target = maxT; // no dejar un sobrante ridículo
    return { type: 'raise', amount: target };
  };
  const fraction = difficulty === 'dificil'
    ? (q > 0.7 ? 0.7 + rng() * 0.4 : 0.33 + rng() * 0.3)
    : difficulty === 'normal' ? (rng() < 0.5 ? 0.5 : 0.75) : 0.5;

  // pocas ciegas: se juega empujando o retirándose
  if (cfg.pushBBs && bbs < cfg.pushBBs) {
    const need = Math.max(fair + 0.10 + late * -0.04, potOdds + 0.05);
    if (canRaise && e > need) return shove();
    if (toCall > 0) return e > potOdds + 0.12 ? call() : { type: 'fold' };
    return { type: 'check' };
  }

  if (toCall > 0) {
    if (canRaise && q > cfg.raiseQ && rng() < aggr) return sizing(fraction);
    if (e + noise > potOdds + cfg.callMargin) return call();
    if (rng() < cfg.looseCall) return call();
    return { type: 'fold' };
  }
  if (canRaise && q > cfg.betQ && rng() < aggr) return sizing(fraction);
  if (canRaise && n <= 2 && rng() < cfg.bluff * (0.6 + late * 0.8)) return sizing(0.5);
  return { type: 'check' };
}
