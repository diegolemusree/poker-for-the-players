import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decide, makeBots, DIFFICULTIES, BOT_NAMES, CAST } from '../server/bots.js';
import {
  MAXP, BLINDS, createState, addPlayer, startHand, act, viewFor, isBetting, pendingRebuys, rebuy, declineRebuy,
} from '../server/engine.js';
import { Room } from '../server/room.js';

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

describe('personajes de los bots', () => {
  // el nombre de cada personaje es siempre el de su bot (personajes.json)
  const NOMBRES = { alien: 'El Compadre Zorg', blob: 'Tío Glub', turista: 'La Güera', robot: 'La Chispa', nerd: 'El Profe', pulpo: 'Don Tentáculos' };
  const nombreDe = id => CAST.find(c => c.id === id).name;

  test('cada personaje tiene siempre el mismo nombre de bot, y Madame Blorp ya no sale', () => {
    for (const [id, nombre] of Object.entries(NOMBRES)) assert.equal(nombreDe(id), nombre);
    assert.ok(!CAST.some(c => c.id === 'blorp'));
    assert.ok(![...BOT_NAMES, ...CAST.map(c => c.name)].includes('Madame Blorp'));
  });

  test(`con ${MAXP - 1} bots o menos, cada uno con un personaje distinto y el nombre de ese personaje`, () => {
    for (let n = 1; n <= MAXP - 1; n++) {
      for (let k = 0; k < 20; k++) {
        const bots = makeBots(n, 'normal', ['Ana'], rng(n * 100 + k));
        assert.equal(new Set(bots.map(b => b.character)).size, n, `${n} bots: personaje repetido`);
        for (const b of bots) assert.equal(b.name, nombreDe(b.character));
      }
    }
  });

  test('no repite el personaje de otro bot ni un nombre que ya se use; sin personajes, nombres de repuesto', () => {
    const bots = makeBots(3, 'normal', ['La Güera'], rng(7), ['alien', 'robot']);
    assert.ok(bots.every(b => !['alien', 'robot', 'turista'].includes(b.character)));
    const sobran = makeBots(MAXP - 1, 'normal', ['Don Chepe'], rng(8), CAST.map(c => c.id));
    assert.ok(sobran.every(b => b.character === null && BOT_NAMES.includes(b.name) && b.name !== 'Don Chepe'));
    assert.equal(new Set(sobran.map(b => b.name)).size, MAXP - 1);
    assert.ok(BOT_NAMES.length >= MAXP - 1, 'faltan nombres de repuesto para una mesa llena');
  });

  test('los nombres de los bots (los de los personajes y los de repuesto) caben completos en un apodo', () => {
    // addPlayer (engine.js) corta el apodo a 16 caracteres: un nombre más largo se vería cortado en la mesa
    const s = createState();
    [...CAST.map(c => c.name), ...BOT_NAMES].forEach((nombre, i) => {
      assert.ok(nombre.length <= 16, `"${nombre}" tiene ${nombre.length} caracteres (máximo 16)`);
      addPlayer(s, { id: 'b' + i, nick: nombre, seat: i % MAXP });
      assert.equal(s.players.find(p => p.id === 'b' + i).nick, nombre);
      s.players.length = 0;
    });
  });

  test('en la mesa: los bots con su personaje y los humanos con el que eligieron; todos ven lo mismo', () => {
    const LARGO = 60 * 60 * 1000, tk = n => 'token-de-prueba-' + String(n).padStart(16, '0');
    const solo = new Room({ code: 'SOLOX', solo: true }, { turnLimitMs: LARGO, botDelay: () => LARGO });
    solo.sit(tk(1), 'Diego', 'nerd');
    solo.addBots(tk(1), MAXP - 1, 'facil');
    let vista = solo.snapshot(tk(1)).view.players;
    const bots = vista.filter(p => p.isBot);
    assert.equal(new Set(bots.map(p => p.character)).size, MAXP - 1, `en práctica con ${MAXP - 1} rivales se repitió un personaje`);
    for (const p of bots) assert.equal(p.nick, nombreDe(p.character));
    assert.equal(vista.find(p => p.id === solo.playerIdOf(tk(1))).character, 'nerd', 'el humano no se ve con el que eligió');
    assert.ok(!bots.some(p => p.character === 'nerd'), 'un bot tomó el personaje del humano');
    solo.close();

    // sala privada: solo humanos, cada uno con el que eligió
    const amigos = new Room({ code: 'AMIGO', solo: false }, { turnLimitMs: LARGO, botDelay: () => LARGO });
    amigos.sit(tk(2), 'Ana', 'pulpo');
    amigos.sit(tk(3), 'Beto', 'turista');
    amigos.sit(tk(4), 'Caro', 'alien');
    vista = amigos.snapshot(tk(2)).view.players;
    assert.deepEqual(vista.map(p => [p.nick, p.character, p.isBot]), [['Ana', 'pulpo', false], ['Beto', 'turista', false], ['Caro', 'alien', false]]);
    for (const t of [tk(3), tk(4), tk(9)]) {
      assert.deepEqual(amigos.snapshot(t).view.players.map(p => p.character), vista.map(p => p.character), 'todos ven lo mismo');
    }
    amigos.close();
  });
});

describe('bots', () => {

  for (const dif of DIFFICULTIES) {
    test(`mesas solo de bots (${dif}): jugadas siempre legales, sin ver cartas ajenas y fichas intactas`, () => {
      let terminados = 0;
      for (let g = 0; g < 12; g++) {
        const n = 2 + (g % (MAXP - 1)); // de 2 a MAXP jugadores
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
