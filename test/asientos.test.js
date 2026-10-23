import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { MAXP } from '../server/engine.js';
import { CAST } from '../server/bots.js';
import { LAYOUTS, layoutFor, seatPlan } from '../client/stage/config.js';

// Asientos: la mesa ilustrada tiene un acomodo para cada cantidad de jugadores y cada quien ve a los demás en el orden
// de juego desde su asiento, con el personaje que eligieron (seatPlan, la misma función que usa la escena). Don
// Tentáculos ocupa dos sillas: en práctica, cuando sale entre los bots (al azar, como cualquiera), se sienta al
// centro del fondo del jugador; si el jugador lo eligió, el centro es para otro. En la sala privada nadie se mueve.
const LARGO = 60 * 60 * 1000, tk = n => 'token-de-prueba-' + String(n).padStart(16, '0');
const GRANDE = CAST.find(c => c.sillas > 1);
const CHICOS = CAST.filter(c => c.sillas === 1);
const mesa = (code, solo) => new Room({ code, solo }, { turnLimitMs: LARGO, botDelay: () => LARGO });

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// los bots toman su personaje al azar: con una semilla, siempre el mismo
function conAzar(seed, fn) {
  const antes = Math.random;
  Math.random = rng(seed);
  try { return fn(); } finally { Math.random = antes; }
}
// Los demás como los acomoda la pantalla de quien está en `seat`: de izquierda a derecha según su lugar en el acomodo.
function enPantalla(players, seat) {
  const plan = seatPlan(players, seat, MAXP);
  const spots = layoutFor(plan.size + 1);
  return players.filter(p => plan.has(p.seat)).sort((a, b) => spots.indexOf(plan.get(a.seat)) - spots.indexOf(plan.get(b.seat)));
}
// el del centro del fondo: el de en medio (con un número par de rivales, el de la izquierda de los dos de en medio)
const centro = lista => lista[Math.floor((lista.length - 1) / 2)];

test('hay un acomodo para cada cantidad de jugadores, hasta el máximo de la mesa', () => {
  assert.equal(MAXP, 6, 'la mesa es de 6 por ahora');
  assert.ok(LAYOUTS.length >= MAXP, `falta el acomodo de ${LAYOUTS.length + 1} jugadores en client/stage/config.js`);
  for (let n = 1; n <= LAYOUTS.length; n++) {
    const spots = layoutFor(n);
    assert.equal(spots.length, n - 1, `con ${n} jugadores hacen falta ${n - 1} lugares`);
    // de mi izquierda a mi derecha, por el fondo: el orden de juego
    for (let i = 1; i < spots.length; i++) assert.ok(spots[i].ang > spots[i - 1].ang, `${n} jugadores: lugares fuera de orden`);
  }
});

test('desde cada asiento, cada quien ve a los demás en el orden de juego y con el personaje que eligieron', () => {
  for (let n = 2; n <= MAXP; n++) {
    const r = mesa(`V${n}`, false);
    CAST.slice(0, MAXP).forEach((c, i) => r.sit(tk(i + 1), 'J' + i, c.id));
    // con menos que el máximo, los que se levantan dejan huecos (asientos salteados)
    for (const k of [2, 4, 3, 5, 6, 1]) if (r.state.players.length > n) r.leave(tk(k));
    const eligio = new Map(r.state.players.map(p => [p.id, r.chars.get(p.id)]));
    for (const [t, id] of r.tokens) {
      const yo = r.player(id);
      const vista = r.snapshot(t).view.players;
      // cada jugador con el personaje que eligió, igual para todos
      for (const p of vista) assert.equal(p.character, eligio.get(p.id), `${n} jugadores: ${p.nick} no se ve con su personaje`);
      const otros = enPantalla(vista, yo.seat);
      assert.equal(otros.length, n - 1, `${n} jugadores: desde el asiento ${yo.seat} falta alguien`);
      // el primero (a mi izquierda) es el que habla después de mí; el último (a mi derecha), el que habla antes
      const orden = vista.filter(p => p.id !== yo.id).sort((a, b) => ((a.seat - yo.seat + MAXP) % MAXP) - ((b.seat - yo.seat + MAXP) % MAXP));
      assert.deepEqual(otros.map(p => p.id), orden.map(p => p.id), `${n} jugadores: desde el asiento ${yo.seat} el orden no es el de juego`);
    }
    r.close();
  }
});

test('en práctica, cuando sale, Don Tentáculos se sienta al centro del fondo del jugador', () => {
  for (let n = 1; n < MAXP; n++) {
    let salio = 0;
    for (let seed = 1; seed <= 80 && salio < 3; seed++) {
      const r = mesa(`P${n}x${seed}`, true);
      conAzar(seed, () => { r.sit(tk(1), 'Diego', CHICOS[seed % CHICOS.length].id); r.addBots(tk(1), n, 'facil'); r.start(tk(1)); });
      const otros = enPantalla(r.snapshot(tk(1)).view.players, 0);
      const pulpo = otros.find(p => p.character === GRANDE.id);
      if (pulpo) {
        salio++;
        assert.equal(centro(otros), pulpo, `${n} rivales: no quedó al centro`);
        assert.equal(pulpo.nick, GRANDE.name, 'conserva su nombre');
        // ya empezado, nada cambia aunque la mesa se vuelva a acomodar
        const antes = r.state.players.map(p => [p.id, p.seat]);
        r.changed();
        assert.deepEqual(r.state.players.map(p => [p.id, p.seat]), antes);
      }
      r.close();
    }
    assert.ok(salio > 0, `con ${n} rivales nunca salió Don Tentáculos`);
  }
});

test('con menos de 5 rivales, Don Tentáculos sale al azar como cualquier bot; con 5, siempre (si no lo elegiste)', () => {
  for (let n = 1; n < MAXP; n++) {
    let veces = 0;
    const intentos = 60;
    for (let seed = 1; seed <= intentos; seed++) {
      const r = mesa(`R${n}x${seed}`, true);
      conAzar(seed, () => { r.sit(tk(1), 'Diego', CHICOS[0].id); r.addBots(tk(1), n, 'facil'); });
      if (r.snapshot(tk(1)).view.players.some(p => p.isBot && p.character === GRANDE.id)) veces++;
      r.close();
    }
    if (n === CHICOS.length) assert.equal(veces, intentos, 'con todos los que sobran, siempre sale');
    else assert.ok(veces > 0 && veces < intentos, `con ${n} rivales salió ${veces} de ${intentos} veces: no es al azar`);
  }
});

test('si el jugador eligió a Don Tentáculos, ningún bot lo es y el centro es para otro bot', () => {
  for (let n = 1; n < MAXP; n++) {
    for (let seed = 1; seed <= 5; seed++) {
      const r = mesa(`T${n}x${seed}`, true);
      conAzar(seed, () => { r.sit(tk(1), 'Diego', GRANDE.id); r.addBots(tk(1), n, 'facil'); });
      const vista = r.snapshot(tk(1)).view.players;
      assert.equal(vista.find(p => p.id === r.playerIdOf(tk(1))).character, GRANDE.id);
      const otros = enPantalla(vista, 0);
      assert.ok(otros.every(p => p.isBot && p.character !== GRANDE.id), 'un bot es Don Tentáculos');
      assert.ok(centro(otros).isBot, 'el centro quedó vacío');
      r.close();
    }
  }
});

test('en la sala privada nadie se mueve: cada quien queda en el asiento en que se sentó, aunque elija a Don Tentáculos', () => {
  const r = mesa('HUMAN', false);
  r.sit(tk(1), 'Ana', CHICOS[0].id); r.sit(tk(2), 'Beto', CHICOS[1].id); r.sit(tk(3), 'Caro', GRANDE.id); r.sit(tk(4), 'Dani', CHICOS[2].id);
  r.leave(tk(2)); // deja un hueco: el siguiente que llega lo toma
  r.sit(tk(5), 'Eli', CHICOS[3].id);
  const ps = r.snapshot(tk(1)).view.players;
  const de = n => ps.find(p => p.nick === n);
  assert.deepEqual(['Ana', 'Eli', 'Caro', 'Dani'].map(n => de(n).seat), [0, 1, 2, 3]);
  assert.equal(de('Caro').character, GRANDE.id);
  r.close();
});
