import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { MAXP } from '../server/engine.js';
import { CAST } from '../server/bots.js';

// Don Tentáculos ocupa dos sillas: en práctica se sienta al centro del fondo del jugador y, en mesas con amigos, al
// centro de quien creó la mesa (cada quien ve la mesa girada desde su asiento: solo se puede para uno).
const LARGO = 60 * 60 * 1000, tk = n => 'token-de-prueba-' + String(n).padStart(16, '0');
const GRANDE = CAST.find(c => c.sillas > 1);
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
// Los demás jugadores como los acomoda la pantalla de quien está en `seat` (client/stage/index.js): en el orden de
// juego desde su asiento; con n rivales, el del centro del fondo es el n-ésimo de en medio (con n par, el de la
// izquierda de los dos de en medio).
const desde = (players, seat) => players.filter(p => p.seat !== seat)
  .sort((a, b) => ((a.seat - seat + MAXP) % MAXP) - ((b.seat - seat + MAXP) % MAXP));
const centro = lista => Math.floor((lista.length - 1) / 2);

test('Don Tentáculos es el único personaje de dos sillas', () => {
  assert.equal(GRANDE.id, 'pulpo');
  assert.equal(GRANDE.name, 'Don Tentáculos');
  assert.ok(CAST.filter(c => c.id !== 'pulpo').every(c => c.sillas === 1));
});

test('en práctica, cuando sale, Don Tentáculos se sienta al centro del fondo del jugador', () => {
  for (let n = 1; n < MAXP; n++) {
    let salio = 0;
    for (let seed = 1; seed <= 80 && salio < 3; seed++) {
      const r = mesa(`P${n}x${seed}`, true);
      conAzar(seed, () => { r.sit(tk(1), 'Diego', 0); r.addBots(tk(1), n, 'facil'); r.start(tk(1)); });
      const otros = desde(r.snapshot(tk(1)).view.players, 0);
      const i = otros.findIndex(p => p.character === GRANDE.id);
      if (i >= 0) {
        salio++;
        assert.equal(i, centro(otros), `${n} rivales: quedó en el lugar ${i} de ${otros.length}`);
        assert.equal(otros[i].nick, GRANDE.name, 'conserva su nombre');
      }
      r.close();
    }
    assert.ok(salio > 0, `con ${n} rivales nunca salió Don Tentáculos`);
  }
});

test('en mesas con amigos, al centro de quien creó la mesa; a los humanos no se les mueve; ya empezado no cambia', () => {
  // la creadora en el asiento 3, un humano en el 5 y otro en el 0; los 4 bots en el 1, 2, 4 y 6.
  // Desde el 3: 4, 5, 6, 0, 1, 2 (6 rivales): el centro es el 6 (un bot)
  let probado = 0;
  for (let seed = 1; seed <= 80 && probado < 2; seed++) {
    const r = mesa(`A${seed}`, false);
    conAzar(seed, () => {
      r.sit(tk(1), 'Ana', 3); r.sit(tk(2), 'Beto', 5); r.sit(tk(3), 'Caro', 0);
      r.addBots(tk(1), 4, 'normal');
    });
    const ps = r.snapshot(tk(1)).view.players;
    const pulpo = ps.find(p => p.character === GRANDE.id && p.isBot);
    if (pulpo) {
      probado++;
      assert.equal(pulpo.seat, 6, 'Don Tentáculos no quedó al centro de la creadora');
      assert.equal(pulpo.nick, GRANDE.name);
      assert.deepEqual(['Ana', 'Beto', 'Caro'].map(n => ps.find(p => p.nick === n).seat), [3, 5, 0], 'se movió a un humano');
      // ya empezado, nada cambia aunque la mesa se vuelva a acomodar
      r.start(tk(1));
      const antes = r.state.players.map(p => [p.id, p.seat]);
      r.changed();
      assert.deepEqual(r.state.players.map(p => [p.id, p.seat]), antes);
    }
    r.close();
  }
  assert.ok(probado > 0, 'Don Tentáculos nunca salió entre los bots');
});

test('si a quien creó la mesa le queda un humano al centro, Don Tentáculos va al asiento de bot más cercano', () => {
  // la creadora en el 3 y un humano en el 6 (su centro con 6 rivales); 5 bots en el 0, 1, 2, 4 y 5.
  // Desde el 3: 4, 5, 6 (humano), 0, 1, 2: el más cercano al centro es el 0 (el otro de en medio)
  let probado = 0;
  for (let seed = 1; seed <= 80 && probado < 2; seed++) {
    const r = mesa(`B${seed}`, false);
    conAzar(seed, () => { r.sit(tk(1), 'Ana', 3); r.sit(tk(2), 'Beto', 6); r.addBots(tk(1), 5, 'normal'); });
    const ps = r.snapshot(tk(2)).view.players; // cualquiera ve lo mismo
    const pulpo = ps.find(p => p.character === GRANDE.id && p.isBot);
    if (pulpo) {
      probado++;
      assert.equal(pulpo.seat, 0);
      assert.equal(ps.find(p => p.nick === 'Beto').seat, 6);
    }
    r.close();
  }
  assert.ok(probado > 0, 'Don Tentáculos nunca salió entre los bots');
});

test('si ningún bot es Don Tentáculos, lo usa el humano que le queda más al centro a quien creó la mesa', () => {
  // sin bots: desde la creadora (asiento 0), los demás son el 2 y el 4; el del centro es el 2
  const r = mesa('HUMAN', false);
  r.sit(tk(1), 'Ana', 0); r.sit(tk(2), 'Beto', 2); r.sit(tk(3), 'Caro', 4);
  const ps = r.snapshot(tk(1)).view.players;
  const de = n => ps.find(p => p.nick === n).character;
  assert.equal(de('Beto'), GRANDE.id);
  assert.notEqual(de('Ana'), GRANDE.id);
  assert.notEqual(de('Caro'), GRANDE.id);
  assert.equal(new Set(ps.map(p => p.character)).size, 3, 'cada humano con un personaje distinto');
  r.close();
});
