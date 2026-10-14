import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { score5, bestHand, bestFive, cmp, handName, describeHand } from '../server/hands.js';
import {
  MAXP, BLINDS, createState, addPlayer, removePlayer, rebuy, declineRebuy, resign, sitIn, autoAct,
  pendingRebuys, startHand, act, viewFor, canAct, isBetting,
} from '../server/engine.js';

// Mesas de prueba: fichas y ciegas chicas, para que los números sean fáciles de leer.
const START = 1000, BB = 20;
const CFG = { start: START, levels: [[10, 20]] };

/* ---------- evaluador de manos ---------- */

describe('evaluador de manos', () => {
  test('escalera real', () => {
    const s = score5(['As', 'Ks', 'Qs', 'Js', 'Ts']);
    assert.deepEqual(s, [8, 14]);
    assert.equal(handName(s), 'Escalera real');
    // encontrada entre 7 cartas
    assert.equal(handName(bestHand(['Ah', 'Kh', '2c', 'Qh', 'Jh', 'Th', '9d'])), 'Escalera real');
  });

  test('escalera de color baja no se llama real', () => {
    const s = score5(['5d', '4d', '3d', '2d', 'Ad']);
    assert.deepEqual(s, [8, 5]);
    assert.equal(handName(s), 'Escalera de color');
  });

  test('escalera baja A-2-3-4-5 vale 5 y pierde contra 2-3-4-5-6', () => {
    const rueda = score5(['Ah', '2c', '3d', '4s', '5h']);
    const seis = score5(['2h', '3c', '4d', '5s', '6h']);
    assert.deepEqual(rueda, [4, 5]);
    assert.equal(handName(rueda), 'Escalera');
    assert.ok(cmp(seis, rueda) > 0);
  });

  test('la escalera baja le gana a un trío y pierde contra un color', () => {
    const rueda = score5(['Ah', '2c', '3d', '4s', '5h']);
    assert.ok(cmp(rueda, score5(['9h', '9c', '9d', '4s', '5h'])) > 0);
    assert.ok(cmp(rueda, score5(['2h', '9h', '3h', 'Kh', '5h'])) < 0);
  });

  test('no existe escalera "dando la vuelta" (Q-K-A-2-3)', () => {
    assert.equal(handName(score5(['Qh', 'Kc', 'Ad', '2s', '3h'])), 'Carta alta');
  });

  test('full le gana a color', () => {
    const full = bestHand(['Kh', 'Kd', 'Ks', '2c', '2d', '9h', '4s']);
    const color = bestHand(['Ah', 'Jh', '8h', '5h', '3h', 'Kc', '2s']);
    assert.equal(handName(full), 'Full');
    assert.equal(handName(color), 'Color');
    assert.ok(cmp(full, color) > 0);
    assert.ok(cmp(color, full) < 0);
  });

  test('póker le gana a full y escalera de color a póker', () => {
    const poker = score5(['9h', '9c', '9d', '9s', '2h']);
    assert.ok(cmp(poker, score5(['Ah', 'Ac', 'Ad', 'Ks', 'Kh'])) > 0);
    assert.ok(cmp(score5(['5d', '4d', '3d', '2d', 'Ad']), poker) > 0);
  });

  test('empate exacto cuando juega el tablero', () => {
    const board = ['Ah', 'Kh', 'Qh', 'Jh', 'Th'];
    const a = bestHand(['2c', '3d', ...board]);
    const b = bestHand(['9s', '8s', ...board]);
    assert.equal(cmp(a, b), 0);
  });

  test('empate con el mismo par y los mismos kickers aunque cambien los palos', () => {
    const a = bestHand(['Ah', '2c', 'Ks', 'Kd', '7c', '8c', '9h']);
    const b = bestHand(['Ad', '2d', 'Ks', 'Kd', '7c', '8c', '9h']);
    assert.equal(cmp(a, b), 0);
  });

  test('un solo kicker decide', () => {
    const board = ['Ks', 'Kd', '7c', '8c', '2h'];
    const kQ = bestHand(['Ah', 'Qc', ...board]);
    const kJ = bestHand(['Ad', 'Jc', ...board]);
    assert.ok(cmp(kQ, kJ) > 0);
  });

  test('doble par: gana el par más alto, luego el segundo, luego el kicker', () => {
    assert.ok(cmp(score5(['Ah', 'Ac', '2d', '2s', '9h']), score5(['Kh', 'Kc', 'Qd', 'Qs', 'Jh'])) > 0);
    assert.ok(cmp(score5(['Kh', 'Kc', 'Qd', 'Qs', '9h']), score5(['Kd', 'Ks', 'Jd', 'Jc', 'Ah'])) > 0);
    assert.ok(cmp(score5(['Kh', 'Kc', 'Qd', 'Qs', '9h']), score5(['Kd', 'Ks', 'Qh', 'Qc', '8h'])) > 0);
  });

  test('las categorías están en orden', () => {
    const manos = [
      ['2h', '5c', '7d', '9s', 'Jh'], ['2h', '2c', '7d', '9s', 'Jh'], ['2h', '2c', '7d', '7s', 'Jh'],
      ['2h', '2c', '2d', '9s', 'Jh'], ['2h', '3c', '4d', '5s', '6h'], ['2h', '5h', '7h', '9h', 'Jh'],
      ['2h', '2c', '2d', '9s', '9h'], ['2h', '2c', '2d', '2s', 'Jh'], ['2h', '3h', '4h', '5h', '6h'],
    ].map(score5);
    for (let i = 1; i < manos.length; i++) assert.ok(cmp(manos[i], manos[i - 1]) > 0, `categoría ${i}`);
  });

  test('nombres para los jugadores: el color dice su palo y la escalera de dónde a dónde', () => {
    const nombre = (hole, board) => { const b = bestFive(hole, board); return describeHand(b.score, b.cards); };
    assert.equal(nombre(['Ah', '9h'], ['4h', 'Th', '2h', 'Qc', '8s']), 'Color de corazones');
    assert.equal(nombre(['Kh', 'Kd'], ['Ks', '2c', '2d', '9h', '4s']), 'Full de reyes y doses');
    assert.equal(nombre(['9h', '5c'], ['6d', '7s', '8h', 'Kc', '2d']), 'Escalera del 5 al 9');
    assert.equal(nombre(['Ah', '2c'], ['3d', '4s', '5h', 'Kc', '9d']), 'Escalera del A al 5');
    assert.equal(nombre(['Ah', 'Kd'], ['Qs', 'Jh', 'Th', '4c', '2s']), 'Escalera del 10 al A');
    assert.equal(nombre(['As', 'Ks'], ['Qs', 'Js', 'Ts', '2h', '3d']), 'Escalera real de picas');
    assert.equal(nombre(['5d', '6d'], ['7d', '8d', '9d', 'Kc', '2h']), 'Escalera de color del 5 al 9');
    assert.equal(nombre(['9h', '9c'], ['9d', '9s', '2h', 'Kc', '4d']), 'Póker de nueves');
    assert.equal(nombre(['7h', '7c'], ['7d', 'As', '2h', 'Kc', '4d']), 'Trío de sietes');
    assert.equal(nombre(['Ah', 'Kc'], ['Ad', 'Ks', '2h', '8c', '4d']), 'Doble par: ases y reyes');
    assert.equal(nombre(['Qh', 'Qc'], ['3d', '8s', '2h', 'Kc', '4d']), 'Par de reinas');
    assert.equal(nombre(['Kh', 'Jc'], ['4h', 'Th', '2h', 'Qc', '8s']), 'Carta alta: K');
  });

  test('las 5 cartas de la mejor mano: si da igual, usa las propias', () => {
    const recta = bestFive(['9h', '2c'], ['9d', '5s', '6c', '7d', '8h']);
    assert.deepEqual(recta.cards.slice().sort(), ['5s', '6c', '7d', '8h', '9h']);
    // el tablero juega: las 5 son de la mesa
    assert.deepEqual(bestFive(['2c', '3d'], ['Ah', 'Kh', 'Qh', 'Jh', 'Th']).cards.slice().sort(), ['Ah', 'Jh', 'Kh', 'Qh', 'Th']);
  });

  test('bestFive da el mismo puntaje que bestHand', () => {
    const r = rng(7);
    const mazo = [...'23456789TJQKA'].flatMap(x => [...'shdc'].map(y => x + y));
    for (let i = 0; i < 2000; i++) {
      const m = mazo.slice().sort(() => r() - 0.5).slice(0, 7);
      const b = bestFive(m.slice(0, 2), m.slice(2));
      assert.equal(cmp(b.score, bestHand(m)), 0, m.join(' '));
      assert.equal(cmp(score5(b.cards), b.score), 0, m.join(' '));
    }
  });
});

/* ---------- mesas controladas ---------- */

function mesa(jugadores, cfg = CFG) {
  const s = createState(cfg);
  for (const j of jugadores) {
    const p = addPlayer(s, { id: j.id, nick: j.id, seat: j.seat });
    if (j.stack !== undefined) p.stack = j.stack;
  }
  return s;
}

// Fija las cartas de los jugadores y el tablero que saldrá (flop, turn, river).
function arreglar(s, manos, tablero) {
  for (const [id, cartas] of Object.entries(manos)) s.players.find(p => p.id === id).cards = cartas;
  s.deck = [...tablero].reverse();
}

function jugarPasivo(s) {
  let guard = 0;
  while (isBetting(s)) {
    assert.ok(++guard < 100, 'mano atorada');
    const p = s.players.find(x => x.id === s.toAct);
    act(s, p.id, s.currentBet - p.bet > 0 ? 'call' : 'check');
  }
}

describe('reglas de la mesa', () => {
  test('heads-up: el dealer pone la ciega chica y habla primero preflop; postflop habla primero la ciega grande', () => {
    const s = mesa([{ id: 'A', seat: 3 }, { id: 'B', seat: 5 }]);
    startHand(s);
    assert.equal(s.dealerSeat, 3);
    const A = s.players.find(p => p.id === 'A'), B = s.players.find(p => p.id === 'B');
    assert.equal(A.bet, 10);
    assert.equal(B.bet, 20);
    assert.equal(s.toAct, 'A');
    act(s, 'A', 'call');
    assert.equal(s.toAct, 'B', 'la ciega grande tiene su opción');
    act(s, 'B', 'check');
    assert.equal(s.phase, 'flop');
    assert.equal(s.toAct, 'B', 'postflop habla primero quien no es dealer');
    // la siguiente mano el dealer rota
    jugarPasivo(s);
    startHand(s);
    assert.equal(s.dealerSeat, 5);
  });

  test('empate con ficha impar: la sobra va al primer asiento después del dealer', () => {
    // dealer = A (asiento 0), ciega chica = C (asiento 1, solo tiene 5), ciega grande = B (asiento 2)
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'C', seat: 1, stack: 5 }, { id: 'B', seat: 2 }]);
    startHand(s);
    assert.equal(s.dealerSeat, 0);
    arreglar(s,
      { A: ['Ah', '2c'], B: ['Ad', '2d'], C: ['3h', '4h'] },
      ['Ks', 'Kd', '7c', '8c', '9h']);
    jugarPasivo(s);
    const por = Object.fromEntries(s.results.winners.map(w => [w.id, w.amount]));
    // bote 45: 15 entre A y B en unidades de 5 (10 y 5, la sobra a B) + 30 entre A y B (15 y 15)
    assert.deepEqual(por, { B: 25, A: 20 });
    const stack = id => s.players.find(p => p.id === id).stack;
    assert.equal(stack('A') + stack('B') + stack('C'), 2 * START + 5);
    assert.equal(stack('C'), 0);
    // cada bote por separado: el principal (C también podía ganarlo) y el secundario, solo de A y B
    assert.deepEqual(s.results.pots.map(p => [p.amount, p.eligible.slice().sort().join(), p.shares, p.hand]),
      [[15, 'A,B,C', { B: 10, A: 5 }, 'Par de reyes'], [30, 'A,B', { B: 15, A: 15 }, 'Par de reyes']]);
    assert.deepEqual(s.results.refunds, []);
  });

  test('botes secundarios con tres all-in de distinto tamaño', () => {
    const s = mesa([{ id: 'A', seat: 0, stack: 100 }, { id: 'B', seat: 1, stack: 300 }, { id: 'C', seat: 2, stack: 500 }]);
    startHand(s);
    arreglar(s,
      { A: ['Ah', 'Ad'], B: ['Kh', 'Kd'], C: ['Qh', 'Qd'] },
      ['2c', '5d', '8s', 'Js', '3h']);
    act(s, 'A', 'raise', 100);
    act(s, 'B', 'raise', 300);
    act(s, 'C', 'raise', 500);
    assert.equal(s.phase, 'showdown');
    const stack = id => s.players.find(p => p.id === id).stack;
    assert.equal(stack('A'), 300); // bote principal: 3 x 100
    assert.equal(stack('B'), 400); // bote lateral: 2 x 200
    assert.equal(stack('C'), 200); // lo que nadie igualó regresa
    const r = s.results;
    assert.deepEqual(r.pots.map(p => [p.amount, p.winners]), [[300, ['A']], [400, ['B']]]);
    assert.deepEqual(r.refunds, [{ id: 'C', amount: 200 }]);
    // lo que se le regresa a C no es un premio: no aparece entre los ganadores
    assert.deepEqual(r.winners.map(w => [w.id, w.amount, w.hand]), [['A', 300, 'Par de ases'], ['B', 400, 'Par de reyes']]);
    assert.ok(s.log.includes('A C se le regresan 200 que nadie igualó.'));
    assert.ok(s.log.includes('A gana 300 con par de ases.'));
    assert.deepEqual(r.shown, ['A', 'B', 'C'], 'de la mejor mano a la peor');
  });

  test('lo que deja quien se retira no hace bote secundario', () => {
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'B', seat: 1 }, { id: 'C', seat: 2 }]);
    startHand(s);
    // A reparte; B pone 10 de ciega y se retira, C iguala la subida de A
    act(s, 'A', 'raise', 60);
    act(s, 'B', 'fold');
    act(s, 'C', 'call');
    jugarPasivo(s);
    assert.equal(s.results.pots.length, 1);
    assert.equal(s.results.pots[0].amount, 130);
    assert.deepEqual(s.results.pots[0].eligible, ['A', 'C']);
    assert.deepEqual(s.results.refunds, []);
  });

  test('ciegas parciales: quien no alcanza la ciega queda all-in', () => {
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'B', seat: 1, stack: 7 }]);
    startHand(s);
    // heads-up: A es dealer y pone 10; B pone la ciega grande con solo 7
    // A solo puede igualar 7: los 3 de más le regresan y la mano se resuelve sola
    const B = s.players.find(p => p.id === 'B');
    assert.equal(B.total, 7);
    assert.ok(B.allIn);
    assert.equal(s.phase, 'showdown');
    assert.equal(s.players.reduce((a, p) => a + p.stack, 0), START + 7);
  });

  test('un intento ilegal no cambia el estado', () => {
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'B', seat: 1 }, { id: 'C', seat: 2 }]);
    startHand(s);
    const antes = JSON.stringify(s);
    const quien = s.toAct;
    const otro = s.players.find(p => p.id !== quien).id;
    const intentos = [
      () => act(s, otro, 'call'),
      () => act(s, 'fantasma', 'fold'),
      () => act(s, quien, 'check'),
      () => act(s, quien, 'raise', NaN),
      () => act(s, quien, 'raise', 55.5),
      () => act(s, quien, 'raise', -40),
      () => act(s, quien, 'raise', '100'),
      () => act(s, quien, 'raise', BB),
      () => act(s, quien, 'raise', BB + 5),
      () => act(s, quien, 'raise', 2 * BB + 3), // no es múltiplo de 5
      () => act(s, quien, 'allin'),
      () => startHand(s),
      () => rebuy(s, quien),
      () => addPlayer(s, { id: 'A', seat: 7 }),
      () => addPlayer(s, { id: 'Z', seat: 0 }),
      () => addPlayer(s, { id: 'Z', seat: 9 }),
      () => removePlayer(s, 'fantasma'),
    ];
    for (const [i, f] of intentos.entries()) {
      assert.throws(f, Error, `intento ${i}`);
      assert.equal(JSON.stringify(s), antes, `el intento ${i} cambió el estado`);
    }
  });

  test('ausentarse en plena mano retira al jugador y después se retira solo en cada mano', () => {
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'B', seat: 1 }, { id: 'C', seat: 2 }]);
    startHand(s);
    const quien = s.players.find(p => p.id !== s.toAct).id;
    resign(s, quien);
    assert.ok(s.players.find(p => p.id === quien).folded);
    jugarPasivo(s);
    assert.equal(s.phase, 'showdown');
    assert.equal(s.players.reduce((a, p) => a + p.stack, 0), 3 * START);
    // la siguiente mano no se detiene a esperar al ausente
    startHand(s);
    let guard = 0;
    while (isBetting(s) && s.toAct !== null) {
      assert.ok(++guard < 100);
      assert.notEqual(s.toAct, quien, 'el ausente nunca se queda con el turno');
      const p = s.players.find(x => x.id === s.toAct);
      act(s, p.id, s.currentBet - p.bet > 0 ? 'call' : 'check');
    }
    sitIn(s, quien);
    assert.equal(s.players.find(p => p.id === quien).sittingOut, false);
  });

  test('autoAct se retira si hay apuesta y pasa si no', () => {
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'B', seat: 1 }, { id: 'C', seat: 2 }]);
    startHand(s);
    const quien = s.toAct;
    autoAct(s);
    assert.ok(s.players.find(p => p.id === quien).folded);
    act(s, s.toAct, 'call');
    const bb = s.toAct;
    autoAct(s); // la ciega grande ya iguala: pasa
    assert.ok(!s.players.find(p => p.id === bb).folded);
  });

  test('no se puede sentar ni levantar nadie una vez que empezó el torneo', () => {
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'B', seat: 1 }]);
    startHand(s);
    assert.throws(() => addPlayer(s, { id: 'Z', seat: 4 }), /ya empezó/);
    assert.throws(() => removePlayer(s, 'A'), /ya empezó/);
  });
});

/* ---------- viewFor ---------- */

// Revisa que `viewerId` no pueda ver ninguna carta que no le toca.
function revisarSinFugas(s, viewerId, ctx) {
  const v = viewFor(s, viewerId);
  assert.ok(!('deck' in v), `${ctx}: la vista trae el mazo`);
  const reveladas = s.phase === 'showdown' && s.results && !s.results.fold ? s.results.shown : [];
  const prohibidas = new Set(s.deck);
  for (const p of s.players) {
    const vp = v.players.find(x => x.id === p.id);
    assert.equal(vp.cards.length, p.cards.length, `${ctx}: cambió la cantidad de cartas`);
    if (p.id === viewerId || reveladas.includes(p.id)) {
      assert.deepEqual(vp.cards, p.cards, `${ctx}: faltan cartas que sí le tocan`);
    } else {
      assert.ok(vp.cards.every(c => c === null), `${ctx}: cartas ajenas sin ocultar`);
      p.cards.forEach(c => prohibidas.add(c));
    }
  }
  const json = JSON.stringify(v);
  for (const c of prohibidas) assert.ok(!json.includes(`"${c}"`), `${ctx}: se filtró la carta ${c}`);
  assert.deepEqual(v.board, s.board, `${ctx}: el tablero no coincide`);
}

describe('viewFor', () => {
  test('no muestra mazo ni cartas ajenas en ninguna calle antes del showdown', () => {
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'B', seat: 1 }, { id: 'C', seat: 2 }, { id: 'D', seat: 4 }]);
    startHand(s);
    const calles = new Set();
    let guard = 0;
    while (isBetting(s)) {
      assert.ok(++guard < 100);
      calles.add(s.phase);
      for (const id of [...s.players.map(p => p.id), null, 'desconocido']) revisarSinFugas(s, id, `${s.phase}/${id}`);
      const p = s.players.find(x => x.id === s.toAct);
      act(s, p.id, s.currentBet - p.bet > 0 ? 'call' : 'check');
    }
    assert.deepEqual([...calles], ['preflop', 'flop', 'turn', 'river']);
  });

  test('al terminar por retiros nadie ve cartas ajenas', () => {
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'B', seat: 1 }, { id: 'C', seat: 2 }]);
    startHand(s);
    act(s, s.toAct, 'fold');
    act(s, s.toAct, 'fold');
    assert.equal(s.phase, 'showdown');
    assert.ok(s.results.fold);
    for (const id of [...s.players.map(p => p.id), null]) revisarSinFugas(s, id, `retiros/${id}`);
    // el ganador no enseña: el resultado no trae su mano ni sus cartas
    const ganador = s.players.find(p => !p.folded);
    assert.deepEqual(s.results.shown, []);
    for (const k of ['hands', 'desc', 'best']) assert.ok(!(k in s.results), `el resultado trae ${k}`);
    assert.deepEqual(s.results.winners.map(w => [w.id, w.hand]), [[ganador.id, '']]);
    for (const id of s.players.filter(p => p !== ganador).map(p => p.id).concat(null)) {
      assert.ok(viewFor(s, id).players.find(p => p.id === ganador.id).cards.every(c => c === null), 'se vieron las cartas del ganador');
    }
  });

  test('en el showdown se revelan solo las manos de quienes llegaron', () => {
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'B', seat: 1 }, { id: 'C', seat: 2 }]);
    startHand(s);
    act(s, s.toAct, 'fold'); // se retira el primero en hablar
    const retirado = s.players.find(p => p.folded);
    jugarPasivo(s);
    assert.equal(s.phase, 'showdown');
    assert.ok(!s.results.fold);
    const vista = viewFor(s, null); // espectador
    for (const p of vista.players) {
      if (p.id === retirado.id) assert.ok(p.cards.every(c => c === null), 'el retirado no muestra');
      else assert.deepEqual(p.cards, s.players.find(x => x.id === p.id).cards);
    }
    for (const k of ['hands', 'desc', 'best']) assert.ok(!(retirado.id in vista.results[k]), `${k} del retirado`);
    for (const id of [...s.players.map(p => p.id), null]) revisarSinFugas(s, id, `showdown/${id}`);
  });

  test('el resultado nunca trae la mano de quien se retiró, aunque se colara en el estado', () => {
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'B', seat: 1 }, { id: 'C', seat: 2 }]);
    startHand(s);
    act(s, s.toAct, 'fold');
    const retirado = s.players.find(p => p.folded);
    jugarPasivo(s);
    // como si el motor se equivocara y guardara la mano del retirado
    s.results.best[retirado.id] = retirado.cards.slice();
    s.results.desc[retirado.id] = 'Par de ases';
    s.results.hands[retirado.id] = 'Par';
    for (const id of s.players.filter(p => p !== retirado).map(p => p.id).concat(null)) {
      const v = viewFor(s, id);
      for (const k of ['hands', 'desc', 'best']) assert.ok(!(retirado.id in v.results[k]), `${k} del retirado para ${id}`);
      for (const c of retirado.cards) assert.ok(!JSON.stringify(v).includes(`"${c}"`), `se filtró ${c} para ${id}`);
    }
  });

  test('no modifica el estado original', () => {
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'B', seat: 1 }]);
    startHand(s);
    const antes = JSON.stringify(s);
    viewFor(s, 'A');
    viewFor(s, null);
    assert.equal(JSON.stringify(s), antes);
    assert.equal(s.deck.length, 52 - 4);
  });
});

/* ---------- simulación de partidas aleatorias ---------- */

const PARTIDAS = 3000;

function rng(seed) { // mulberry32: así cualquier fallo se puede repetir con su semilla
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const suma = (s, f) => s.players.reduce((a, p) => a + f(p), 0);

// El resultado explica el reparto sin cambiarlo: botes + devoluciones = lo apostado, cada bote cuadra con
// lo que se llevó cada quien, y las manos (y sus 5 cartas) son solo de quienes llegaron al final.
function revisarResultado(s, ctx) {
  const r = s.results, apostado = suma(s, p => p.total);
  const monto = xs => xs.reduce((a, x) => a + x.amount, 0);
  assert.equal(monto(r.pots) + monto(r.refunds), apostado, `${ctx}: botes y devoluciones no suman lo apostado`);
  assert.equal(monto(r.winners) + monto(r.refunds), apostado, `${ctx}: el bote repartido no cuadra`);
  for (const pot of r.pots) {
    assert.equal(Object.values(pot.shares).reduce((a, b) => a + b, 0), pot.amount, `${ctx}: un bote no cuadra con su reparto`);
    assert.deepEqual(Object.keys(pot.shares).sort(), pot.winners.slice().sort(), `${ctx}: reparto de un bote a quien no lo ganó`);
    assert.ok(pot.winners.every(id => pot.eligible.includes(id)), `${ctx}: ganó un bote quien no podía`);
  }
  for (const w of r.winners) assert.equal(w.amount, r.pots.reduce((a, pot) => a + (pot.shares[w.id] || 0), 0), `${ctx}: lo ganado no cuadra`);
  // solo se le regresa a quien apostó más que todos, y solo lo que nadie más puso
  const [mayor, segundo] = s.players.slice().sort((a, b) => b.total - a.total);
  const debeRegresar = !r.fold && mayor.total > segundo.total && !mayor.folded;
  assert.deepEqual(r.refunds, debeRegresar ? [{ id: mayor.id, amount: mayor.total - segundo.total }] : [], `${ctx}: devolución incorrecta`);
  if (r.fold) return;
  const vivos = s.players.filter(p => p.inHand && !p.folded).map(p => p.id).sort();
  assert.deepEqual(r.shown.slice().sort(), vivos, `${ctx}: enseñan cartas quienes no llegaron`);
  for (const k of ['hands', 'desc', 'best']) assert.deepEqual(Object.keys(r[k]).sort(), vivos, `${ctx}: ${k} de quien no llegó`);
  assert.deepEqual(r.pots[0].eligible.slice().sort(), vivos, `${ctx}: el bote principal es de todos los que llegaron`);
  for (const id of vivos) {
    const p = s.players.find(x => x.id === id);
    assert.equal(new Set(r.best[id]).size, 5, `${ctx}: la mejor mano no tiene 5 cartas`);
    assert.ok(r.best[id].every(c => p.cards.includes(c) || s.board.includes(c)), `${ctx}: la mejor mano trae cartas ajenas`);
    assert.equal(cmp(score5(r.best[id]), bestHand([...p.cards, ...s.board])), 0, `${ctx}: esas 5 cartas no son su mejor mano`);
  }
}

function jugadaAleatoria(s, r) {
  const p = s.players.find(x => x.id === s.toAct);
  const toCall = s.currentBet - p.bet;
  const maxT = p.bet + p.stack;
  const minT = s.currentBet === 0 ? s.bb : s.currentBet + s.minRaise;
  const bajo = Math.min(Math.ceil(minT / 5) * 5, maxT);
  const x = r();
  if (toCall > 0 && x < 0.15) return [p.id, 'fold'];
  if (x < 0.6 || p.stack <= toCall) return [p.id, toCall > 0 ? 'call' : 'check'];
  const medio = Math.min(maxT, bajo + 5 * Math.floor(r() * ((maxT - bajo) / 5 + 1)));
  const monto = [bajo, medio, maxT, maxT + 1 + Math.floor(r() * 50)];
  return [p.id, 'raise', monto[Math.floor(r() * monto.length)]];
}

function intentoIlegal(s, r, ctx) {
  const id = s.toAct;
  const p = s.players.find(x => x.id === id);
  const maxT = p.bet + p.stack;
  const minT = s.currentBet === 0 ? s.bb : s.currentBet + s.minRaise;
  const otro = s.players.find(x => x.id !== id);
  const opciones = [
    () => act(s, 'fantasma', 'fold'),
    () => act(s, otro.id, 'call'),
    () => act(s, id, 'raise', NaN),
    () => act(s, id, 'raise', 1.5),
    () => act(s, id, 'raise', -5),
    () => act(s, id, 'raise', 0),
    () => act(s, id, 'raise', Infinity),
    () => act(s, id, 'raise', undefined),
    () => act(s, id, 'allin'),
  ];
  if (s.currentBet - p.bet > 0) opciones.push(() => act(s, id, 'check'));
  if (s.currentBet > 0) opciones.push(() => act(s, id, 'raise', 1 + Math.floor(r() * s.currentBet)));
  const impar = Math.ceil(minT / 5) * 5 + 1 + Math.floor(r() * 4); // no es múltiplo de 5
  if (impar < maxT) opciones.push(() => act(s, id, 'raise', impar));
  const lo = s.currentBet + 1, hi = Math.min(minT - 1, maxT - 1);
  if (lo <= hi) opciones.push(() => act(s, id, 'raise', lo + Math.floor(r() * (hi - lo + 1))));
  const antes = JSON.stringify(s);
  const f = opciones[Math.floor(r() * opciones.length)];
  assert.throws(f, Error, `${ctx}: una jugada ilegal no lanzó error`);
  assert.equal(JSON.stringify(s), antes, `${ctx}: una jugada ilegal cambió el estado`);
}

function simular(semilla) {
  const r = rng(semilla);
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  const ctx = `semilla ${semilla}`;
  // ciegas que suben muy rápido (cada "hora" simulada de 2.5 s) para recorrer varios niveles
  const s = createState({ start: START, levels: [[10, 20], [20, 40], [50, 100], [200, 400]], levelMs: 2500 });
  const n = ri(2, MAXP);
  const asientos = [...Array(MAXP).keys()].sort(() => r() - 0.5).slice(0, n);
  let total = 0;
  asientos.forEach((seat, i) => {
    const p = addPlayer(s, { id: 'p' + i, nick: 'J' + i, seat });
    p.stack = r() < 0.4 ? START : 5 * ri(1, 400); // mezcla de fichas cortas y profundas para forzar botes laterales
    total += p.stack;
  });

  const invariante = (donde) => {
    const enMesa = suma(s, p => p.stack) + (isBetting(s) ? suma(s, p => p.total) : 0);
    assert.equal(enMesa, total, `${ctx}: las fichas cambiaron (${donde})`);
  };
  const hayFuga = (id, donde) => revisarSinFugas(s, id, `${ctx}: ${donde}`);
  const activos = () => s.players.filter(p => !p.out);

  const manos = ri(3, 14);
  let bbPrevio = 0;
  for (let h = 0; h < manos && !s.finished; h++) {
    // entre manos: recompras (una sola por jugador), renuncias y ausencias
    for (const p of pendingRebuys(s)) {
      const x = r();
      if (x < 0.6 && p.rebuysLeft > 0) { rebuy(s, p.id); total += START; assert.throws(() => rebuy(s, p.id), Error, `${ctx}: segunda recompra`); }
      else if (x < 0.75) declineRebuy(s, p.id);
    }
    if (s.finished) break;
    for (const p of s.players) {
      if (!p.out && r() < 0.1) { p.sittingOut ? sitIn(s, p.id) : resign(s, p.id); }
    }
    if (s.players.filter(p => p.stack > 0).length < 2) { // solo queda uno en pie: los demás deciden
      for (const p of pendingRebuys(s)) declineRebuy(s, p.id);
      assert.ok(s.finished, `${ctx}: con un solo jugador con fichas el torneo debía terminar`);
      break;
    }
    if (s.players.filter(p => p.stack > 0).every(p => p.sittingOut)) {
      assert.throws(() => startHand(s, h * 1000), /ausentes/);
      sitIn(s, s.players.find(p => p.stack > 0).id);
    }
    startHand(s, h * 1000);
    assert.ok(s.bb >= bbPrevio, `${ctx}: las ciegas bajaron`);
    bbPrevio = s.bb;
    invariante('al repartir');

    let pasos = 0;
    while (isBetting(s)) {
      assert.ok(++pasos <= 200, `${ctx}: la mano ${s.handNo} se atoró`);
      const turno = s.players.find(p => p.id === s.toAct);
      assert.ok(turno && canAct(turno) && !turno.sittingOut, `${ctx}: el turno apunta a alguien que no puede actuar`);
      hayFuga(s.players[ri(0, s.players.length - 1)].id, `calle ${s.phase}`);
      if (r() < 0.25) intentoIlegal(s, r, ctx);

      if (r() < 0.03) { // alguien se ausenta en plena mano
        const p = s.players[ri(0, s.players.length - 1)];
        if (!p.out && !p.sittingOut && s.players.filter(q => q.stack > 0 && !q.sittingOut).length > 1) resign(s, p.id);
        invariante('tras ausentarse');
        continue;
      }
      act(s, ...jugadaAleatoria(s, r));
      invariante(`tras jugar en ${s.phase}`);
    }

    assert.equal(s.phase, 'showdown', `${ctx}: la mano no terminó`);
    assert.equal(s.toAct, null);
    revisarResultado(s, ctx);
    invariante('al terminar la mano');
    for (const p of s.players) hayFuga(p.id, 'showdown');
    hayFuga(null, 'showdown/espectador');

    // eliminaciones: sin fichas y sin recompra = fuera; con recompra = sigue pendiente
    for (const p of s.players) {
      if (p.inHand && p.stack === 0) assert.equal(p.out, p.rebuysLeft === 0, `${ctx}: eliminación incorrecta`);
      if (p.out) assert.equal(p.stack, 0);
      assert.equal(p.stack % 5, 0, `${ctx}: quedó un monto que no se forma con fichas`);
    }
    const puestos = s.players.filter(p => p.out).map(p => p.place);
    assert.equal(new Set(puestos).size, puestos.length, `${ctx}: puestos repetidos`);
    if (s.finished) {
      assert.equal(activos().length, 1);
      assert.equal(activos()[0].stack, total, `${ctx}: el campeón debe tener todas las fichas`);
      assert.equal(activos()[0].place, 1);
      assert.equal(s.winner, activos()[0].id);
    } else {
      assert.ok(activos().length >= 2, `${ctx}: el torneo debía haber terminado`);
    }
  }
}

test(`${PARTIDAS} partidas aleatorias de 2 a ${MAXP} jugadores: las fichas no cambian y ninguna mano se atora`, () => {
  for (let i = 0; i < PARTIDAS; i++) simular(1000 + i);
});

/* ---------- torneo ---------- */

describe('torneo', () => {
  test('la configuración por omisión: 5,000 fichas y ciegas que suben cada 15 minutos', () => {
    const s = createState();
    const p = addPlayer(s, { id: 'A', seat: 0 });
    assert.equal(p.stack, 5000);
    assert.equal(s.config.levelMs, 15 * 60000);
    assert.deepEqual([s.sb, s.bb], BLINDS[0]);
    for (let i = 1; i < BLINDS.length; i++) assert.ok(BLINDS[i][1] > BLINDS[i - 1][1]);
  });

  test('las ciegas suben con el reloj, no antes', () => {
    const s = mesa([{ id: 'A', seat: 0 }, { id: 'B', seat: 1 }], { start: 5000, levels: [[25, 50], [50, 100], [75, 150]], levelMs: 1000 });
    const t0 = 1_000_000;
    startHand(s, t0);
    assert.deepEqual([s.sb, s.bb], [25, 50]);
    jugarPasivo(s);
    startHand(s, t0 + 999);
    assert.deepEqual([s.sb, s.bb], [25, 50]);
    jugarPasivo(s);
    startHand(s, t0 + 1000);
    assert.deepEqual([s.sb, s.bb], [50, 100]);
    assert.equal(s.players.reduce((a, p) => a + p.bet, 0), 150);
    jugarPasivo(s);
    startHand(s, t0 + 9000); // se pasó de varios niveles: llega al último y ahí se queda
    assert.deepEqual([s.sb, s.bb], [75, 150]);
  });

  test('cada jugador recompra una sola vez; sin recompra queda fuera con su lugar', () => {
    const s = mesa([{ id: 'A', seat: 0, stack: 100 }, { id: 'B', seat: 1 }, { id: 'C', seat: 2 }]);
    startHand(s);
    // A se juega todo y pierde contra una mano arreglada
    arreglar(s, { A: ['2c', '3d'], B: ['Ah', 'Ad'], C: ['Kh', 'Kd'] }, ['7c', '8h', '9s', 'Js', '4h']);
    let guard = 0;
    while (isBetting(s)) {
      assert.ok(++guard < 50);
      const p = s.players.find(x => x.id === s.toAct);
      if (p.id === 'A') act(s, 'A', 'raise', 100);
      else act(s, p.id, 'call');
    }
    const A = s.players.find(p => p.id === 'A');
    assert.equal(A.stack, 0);
    assert.equal(A.out, false, 'todavía puede recomprar');
    assert.deepEqual(pendingRebuys(s).map(p => p.id), ['A']);
    rebuy(s, 'A');
    assert.equal(A.stack, START);
    assert.equal(A.rebuysLeft, 0);
    // segunda vez: se queda sin fichas otra vez (lo forzamos) y ya no hay recompra
    A.stack = 0;
    assert.throws(() => rebuy(s, 'A'), /usaste/);
    declineRebuy(s, 'A');
    assert.equal(A.out, true);
    assert.equal(A.place, 3);
  });

  test('el torneo termina cuando alguien tiene todas las fichas', () => {
    const s = mesa([{ id: 'A', seat: 0, stack: 300 }, { id: 'B', seat: 1, stack: 300 }]);
    s.players.forEach(p => { p.rebuysLeft = 0; });
    startHand(s);
    arreglar(s, { A: ['Ah', 'Ad'], B: ['2c', '7d'] }, ['Ks', '9d', '4c', '5h', '8s']);
    act(s, s.toAct, 'raise', 300);
    act(s, s.toAct, 'call');
    assert.equal(s.finished, true);
    assert.equal(s.winner, 'A');
    const A = s.players.find(p => p.id === 'A'), B = s.players.find(p => p.id === 'B');
    assert.equal(A.stack, 600);
    assert.equal(B.out, true);
    assert.equal(B.place, 2);
    assert.equal(A.place, 1);
    assert.throws(() => startHand(s), /terminó/);
  });

  test('si el último rival tiene recompra pendiente, el torneo espera su decisión', () => {
    const s = mesa([{ id: 'A', seat: 0, stack: 300 }, { id: 'B', seat: 1, stack: 300 }]);
    startHand(s);
    arreglar(s, { A: ['Ah', 'Ad'], B: ['2c', '7d'] }, ['Ks', '9d', '4c', '5h', '8s']);
    act(s, s.toAct, 'raise', 300);
    act(s, s.toAct, 'call');
    assert.equal(s.finished, false);
    assert.deepEqual(pendingRebuys(s).map(p => p.id), ['B']);
    assert.throws(() => startHand(s), /al menos 2/);
    declineRebuy(s, 'B');
    assert.equal(s.finished, true);
    assert.equal(s.winner, 'A');
    assert.equal(s.players.find(p => p.id === 'B').place, 2);
  });

  test('con recompra, el que se la juega y vuelve puede ganar el torneo completo', () => {
    const s = mesa([{ id: 'A', seat: 0, stack: 300 }, { id: 'B', seat: 1, stack: 300 }]);
    startHand(s);
    arreglar(s, { A: ['Ah', 'Ad'], B: ['2c', '7d'] }, ['Ks', '9d', '4c', '5h', '8s']);
    act(s, s.toAct, 'raise', 300);
    act(s, s.toAct, 'call');
    rebuy(s, 'B');
    assert.equal(s.players.find(p => p.id === 'B').stack, START);
    assert.equal(s.finished, false);
  });
});
