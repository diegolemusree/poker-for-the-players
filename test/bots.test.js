import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decide, makeBots, DIFFICULTIES, BOT_NAMES } from '../server/bots.js';
import {
  BLINDS, createState, addPlayer, startHand, act, viewFor, isBetting, pendingRebuys, rebuy, declineRebuy,
} from '../server/engine.js';

const ITER = 15; // pocas repeticiones Monte Carlo para que las pruebas sean rápidas

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Revisa que lo que se le entrega a un bot no contenga ninguna carta que no le toca.
function assertSoloLoSuyo(s, id) {
  const v = viewFor(s, id);
  assert.ok(!('deck' in v), 'el bot recibió el mazo');
  const json = JSON.stringify(v);
  const ajenas = new Set(s.deck);
  s.players.filter(p => p.id !== id).forEach(p => p.cards.forEach(c => ajenas.add(c)));
  for (const c of ajenas) assert.ok(!json.includes(`"${c}"`), `el bot vio la carta ${c}`);
  return v;
}

function torneoDeBots(semilla, dificultades, maxManos = 400) {
  const r = rng(semilla);
  const n = dificultades.length;
  const s = createState({ start: 5000, levels: BLINDS, levelMs: 15 * 60000 });
  const bots = new Map();
  const info = makeBots(n, 'normal', [], r);
  dificultades.forEach((d, i) => {
    const p = addPlayer(s, { id: 'b' + i, nick: info[i].name, seat: i });
    bots.set(p.id, { difficulty: d, style: info[i].style });
  });
  const total = 5000 * n;
  let recompras = 0, ahora = 0;
  for (let h = 0; h < maxManos && !s.finished; h++) {
    for (const p of pendingRebuys(s)) { if (p.rebuysLeft > 0) { rebuy(s, p.id); recompras++; } else declineRebuy(s, p.id); }
    if (s.finished) break;
    ahora += 2 * 60000; // cada mano simulada "dura" 2 minutos para que suban las ciegas
    startHand(s, ahora);
    let pasos = 0;
    while (isBetting(s)) {
      assert.ok(++pasos < 300, `semilla ${semilla}: mano atorada`);
      const id = s.toAct;
      const v = assertSoloLoSuyo(s, id);
      const antes = JSON.stringify(v);
      const { type, amount } = decide(v, id, { ...bots.get(id), rng: r, iterations: ITER });
      assert.equal(JSON.stringify(v), antes, 'decide modificó la vista');
      assert.ok(['fold', 'check', 'call', 'raise'].includes(type));
      act(s, id, type, amount); // si fuera ilegal, act() lanzaría error y la prueba fallaría
    }
    const enMesa = s.players.reduce((a, p) => a + p.stack, 0);
    assert.equal(enMesa, total + recompras * 5000, `semilla ${semilla}: las fichas cambiaron`);
  }
  return s;
}

describe('bots', () => {
  test('hay nombres divertidos y no se repiten', () => {
    const bots = makeBots(5, 'normal', ['Don Chepe']);
    assert.equal(new Set(bots.map(b => b.name)).size, 5);
    assert.ok(!bots.some(b => b.name === 'Don Chepe'));
    assert.ok(BOT_NAMES.length >= 8);
  });

  for (const dif of DIFFICULTIES) {
    test(`mesas solo de bots (${dif}): jugadas siempre legales, sin ver cartas ajenas y fichas intactas`, () => {
      let terminados = 0;
      for (let g = 0; g < 12; g++) {
        const n = 2 + (g % 5);
        const s = torneoDeBots(500 + g, Array(n).fill(dif));
        if (s.finished) terminados++;
      }
      assert.ok(terminados >= 6, `solo terminaron ${terminados} de 12 torneos`);
    });
  }

  test('mesas mezcladas de dificultades', () => {
    for (let g = 0; g < 10; g++) {
      const n = 3 + (g % 4);
      torneoDeBots(900 + g, Array.from({ length: n }, (_, i) => DIFFICULTIES[(i + g) % 3]));
    }
  });

  test('la decisión no depende de las cartas ajenas ni del mazo', () => {
    const s = createState({ start: 5000, levels: BLINDS });
    for (let i = 0; i < 4; i++) addPlayer(s, { id: 'b' + i, nick: 'B' + i, seat: i });
    startHand(s);
    const id = s.toAct;
    // gemelo del estado donde TODO lo oculto es distinto: mazo y manos de los demás
    const gemelo = structuredClone(s);
    const pool = [...s.deck, ...s.players.filter(p => p.id !== id).flatMap(p => p.cards)];
    gemelo.deck = pool.slice().reverse().slice(0, s.deck.length);
    const rest = pool.filter(c => !gemelo.deck.includes(c));
    gemelo.players.filter(p => p.id !== id).forEach((p, i) => { p.cards = [rest[2 * i], rest[2 * i + 1]]; });
    for (const dif of DIFFICULTIES) {
      for (let seed = 1; seed <= 5; seed++) {
        const a = decide(viewFor(s, id), id, { difficulty: dif, rng: rng(seed), iterations: 40 });
        const b = decide(viewFor(gemelo, id), id, { difficulty: dif, rng: rng(seed), iterations: 40 });
        assert.deepEqual(a, b);
      }
    }
  });

  test('no decide con cartas ajenas a la vista: se niega si le faltan las suyas', () => {
    const s = createState({ start: 5000, levels: BLINDS });
    for (let i = 0; i < 3; i++) addPlayer(s, { id: 'b' + i, nick: 'B' + i, seat: i });
    startHand(s);
    const otro = s.players.find(p => p.id !== s.toAct).id;
    assert.throws(() => decide(viewFor(s, otro), s.toAct), /cartas propias/);
  });

  test('un bot difícil con una mano muy fuerte sube o iguala, y con basura ante una apuesta enorme se retira', () => {
    const s = createState({ start: 5000, levels: BLINDS });
    for (let i = 0; i < 2; i++) addPlayer(s, { id: 'b' + i, nick: 'B' + i, seat: i });
    startHand(s);
    const id = s.toAct;
    const yo = s.players.find(p => p.id === id);
    yo.cards = ['Ah', 'Ad'];
    const fuerte = decide(viewFor(s, id), id, { difficulty: 'dificil', rng: rng(3), iterations: 200 });
    assert.ok(fuerte.type === 'raise' || fuerte.type === 'call');
    yo.cards = ['7c', '2d'];
    const otro = s.players.find(p => p.id !== id);
    otro.bet = 2000; otro.total = 2000; s.currentBet = 2000; otro.stack -= 2000;
    const debil = decide(viewFor(s, id), id, { difficulty: 'dificil', rng: rng(3), iterations: 200 });
    assert.equal(debil.type, 'fold');
  });
});
