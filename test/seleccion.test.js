// Selección de personaje en una mesa (Room), sin sockets: elegir personaje es sentarse, en el siguiente asiento libre;
// si alguien ya lo tiene, se rechaza con su nombre; levantarse (o salir antes de empezar) lo deja libre, y también
// quien se desconecta y no vuelve a tiempo; la sala se llena con el máximo de la mesa o con tantos como personajes haya;
// en práctica los bots toman los que sobran y nunca el tuyo. (La carrera de dos al mismo tiempo, por sockets, está en
// server.test.js.)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Room, CAPACITY, RELEASE_MS } from '../server/room.js';
import { MAXP } from '../server/engine.js';
import { CAST, BOT_NAMES } from '../server/bots.js';

const LARGO = 60 * 60 * 1000, tk = n => 'token-de-prueba-' + String(n).padStart(16, '0');
// las mesas se cierran al final aunque una prueba falle (si no, sus relojes dejan la prueba colgada)
const abiertas = [];
after(() => abiertas.forEach(r => r.close()));
function mesa(opts = {}, tuning = {}) {
  const r = new Room({ code: 'ELIGE', solo: false, ...opts }, { turnLimitMs: LARGO, botDelay: () => LARGO, ...tuning });
  abiertas.push(r);
  return r;
}
const ids = CAST.map(c => c.id);
const personajeDe = (r, t) => r.snapshot(t).view.players.find(p => p.id === r.playerIdOf(t))?.character ?? null;
const espera = ms => new Promise(res => setTimeout(res, ms));

test('la mesa es de 6 o de tantos como personajes haya; quien se desconecta conserva su lugar 5 minutos', () => {
  assert.equal(MAXP, 6);
  assert.equal(CAPACITY, Math.min(MAXP, CAST.length));
  assert.equal(RELEASE_MS, 5 * 60 * 1000);
});

test('quien crea la mesa se sienta con su personaje; los demás ven cuál está ocupado y por quién', () => {
  const r = mesa();
  r.sit(tk(1), 'Ana', 'turista');
  assert.equal(personajeDe(r, tk(1)), 'turista');
  assert.equal(r.ownerId, r.playerIdOf(tk(1)));
  // lo que ve alguien que acaba de entrar (todavía sin asiento)
  const { cast } = r.snapshot(tk(9));
  assert.deepEqual(cast.map(c => c.id), ids, 'en el orden de personajes.json');
  assert.equal(cast.find(c => c.id === 'turista').holder, r.playerIdOf(tk(1)));
  assert.ok(cast.filter(c => c.id !== 'turista').every(c => c.holder === null), 'los demás, libres');
  r.sit(tk(2), 'Beto', 'alien');
  r.sit(tk(3), 'Caro', 'pulpo');
  assert.deepEqual(r.state.players.map(p => p.seat), [0, 1, 2], 'cada quien en el siguiente asiento libre');
});

test('un personaje ocupado se rechaza con el nombre de quien lo tiene, y quien llegó después elige otro', () => {
  const r = mesa();
  r.sit(tk(1), 'Ana', 'turista');
  assert.throws(() => r.sit(tk(2), 'Beto', 'turista'), e => e.code === 'ocupado' && /^Ana ya eligió a La Güera\. Elige otro/.test(e.message));
  assert.equal(r.playerIdOf(tk(2)), null, 'no quedó sentado');
  r.sit(tk(2), 'Beto', 'robot');
  assert.equal(personajeDe(r, tk(2)), 'robot');
  assert.throws(() => r.sit(tk(2), 'Beto', 'nerd'), /Ya estás sentado/);
});

test('un personaje inventado, retirado o vacío se rechaza', () => {
  const r = mesa();
  for (const malo of ['inventado', 'blorp', '', undefined, null, 7, {}, ['alien']]) {
    assert.throws(() => r.sit(tk(1), 'Ana', malo), e => e.code === 'personaje', `aceptó ${JSON.stringify(malo)}`);
  }
  assert.equal(r.state.players.length, 0);
});

test('levantarse o salir de la mesa antes de empezar deja libre el personaje; ya empezado, no', () => {
  const r = mesa();
  r.sit(tk(1), 'Ana', 'turista'); r.sit(tk(2), 'Beto', 'robot'); r.sit(tk(3), 'Caro', 'nerd');
  r.leave(tk(2));
  assert.equal(r.holderOf('robot'), null, 'Levantarme');
  r.exit(tk(3));
  assert.equal(r.holderOf('nerd'), null, 'Salir de la mesa');
  assert.equal(r.playerIdOf(tk(3)), null);
  r.sit(tk(4), 'Dani', 'robot'); // ya libre: lo toma otro
  assert.equal(personajeDe(r, tk(4)), 'robot');
  r.start(tk(1));
  r.leave(tk(4)); r.exit(tk(1));
  assert.equal(personajeDe(r, tk(4)), 'robot', 'ya empezado, se ausenta con su personaje');
  assert.ok(r.player(r.playerIdOf(tk(4))).sittingOut);
  assert.equal(personajeDe(r, tk(1)), 'turista', 'ya empezado, salir no lo levanta');
});

test('si quien creó la mesa se levanta, la mesa pasa al siguiente humano', () => {
  const r = mesa();
  r.sit(tk(1), 'Ana', 'turista'); r.sit(tk(2), 'Beto', 'robot');
  r.leave(tk(1));
  assert.equal(r.ownerId, r.playerIdOf(tk(2)));
});

test('la sala se llena en el máximo, o con tantos como personajes haya si son menos', () => {
  const r = mesa();
  ids.slice(0, CAPACITY).forEach((id, i) => r.sit(tk(i + 1), 'J' + i, id));
  assert.equal(r.state.players.length, CAPACITY);
  assert.throws(() => r.sit(tk(99), 'Tarde', ids[0]), e => e.code === 'llena');
  // con un personaje menos (como si uno estuviera retirado), se llena con 5
  const cinco = mesa({ cast: CAST.slice(0, 5) });
  assert.equal(cinco.capacity, 5);
  CAST.slice(0, 5).forEach((c, i) => cinco.sit(tk(i + 1), 'J' + i, c.id));
  assert.throws(() => cinco.sit(tk(99), 'Tarde', CAST[5].id), e => e.code === 'llena');
  assert.equal(cinco.snapshot(tk(99)).capacity, 5);
  assert.equal(cinco.snapshot(tk(99)).cast.length, 5, 'el selector solo ofrece los personajes en uso');
});

test('quien se desconecta antes de empezar conserva su lugar; si no vuelve a tiempo, su personaje queda libre', async () => {
  const r = mesa({}, { releaseMs: 40 });
  r.connect(tk(1)); r.sit(tk(1), 'Ana', 'turista');
  r.connect(tk(2)); r.sit(tk(2), 'Beto', 'robot');
  // Beto recarga la página: se va y vuelve antes de que se acabe el tiempo
  r.disconnect(tk(2)); await espera(10); r.connect(tk(2)); await espera(60);
  assert.equal(personajeDe(r, tk(2)), 'robot', 'recargar no lo saca');
  // con dos pestañas, cerrar una no cuenta
  r.connect(tk(2)); r.disconnect(tk(2)); await espera(60);
  assert.equal(personajeDe(r, tk(2)), 'robot', 'le queda otra pestaña');
  // se va y no vuelve
  r.disconnect(tk(2)); await espera(20);
  assert.equal(personajeDe(r, tk(2)), 'robot', 'todavía está en su tiempo');
  await espera(50);
  assert.equal(r.playerIdOf(tk(2)), null, 'se le levanta');
  assert.equal(r.holderOf('robot'), null, 'su personaje queda libre');
  // quien mira sin asiento (o está eligiendo) no aparta nada: irse no cambia la mesa
  r.connect(tk(3)); r.disconnect(tk(3)); await espera(60);
  assert.deepEqual(r.state.players.map(p => p.nick), ['Ana']);
  assert.equal(r.connections, 1);
});

test('ya empezado el torneo, desconectarse no libera nada', async () => {
  const r = mesa({}, { releaseMs: 30 });
  r.connect(tk(1)); r.sit(tk(1), 'Ana', 'turista');
  r.connect(tk(2)); r.sit(tk(2), 'Beto', 'robot');
  r.disconnect(tk(2)); // su tiempo empieza a correr...
  r.start(tk(1));      // ...pero el torneo empieza antes
  r.disconnect(tk(1));
  await espera(60);
  assert.deepEqual(r.state.players.map(p => [p.nick, r.chars.get(p.id)]), [['Ana', 'turista'], ['Beto', 'robot']]);
});

test('en práctica los bots toman personajes que sobran, nunca el tuyo, cada uno con su nombre', () => {
  for (const mio of ids) {
    for (let n = 1; n <= CAPACITY - 1; n++) {
      const r = mesa({ solo: true });
      r.sit(tk(1), 'Diego', mio);
      r.addBots(tk(1), n, 'facil');
      const ps = r.snapshot(tk(1)).view.players;
      const bots = ps.filter(p => p.isBot);
      assert.equal(bots.length, n);
      assert.ok(bots.every(p => p.character && p.character !== mio), `${mio} con ${n} rivales: un bot tomó tu personaje o se quedó sin uno`);
      assert.equal(new Set(ps.map(p => p.character)).size, n + 1, 'todos distintos');
      for (const p of bots) assert.equal(p.nick, CAST.find(c => c.id === p.character).name);
      r.close();
    }
  }
});

test('en práctica caben de 1 a 5 rivales, y la sala privada es solo de humanos', () => {
  const r = mesa({ solo: true });
  r.sit(tk(1), 'Diego', ids[0]);
  assert.throws(() => r.addBots(tk(1), CAPACITY, 'facil'), /No hay tantos asientos/);
  r.addBots(tk(1), CAPACITY - 1, 'facil');
  assert.equal(r.state.players.length, CAPACITY);
  const amigos = mesa();
  amigos.sit(tk(2), 'Ana', ids[0]);
  assert.throws(() => amigos.addBots(tk(2), 1, 'facil'), /solo para humanos/);
});

test('si tu apodo es el nombre de un personaje, el bot que lo lleva usa un nombre de repuesto', () => {
  const r = mesa({ solo: true });
  r.sit(tk(1), CAST[1].name, ids[0]); // se llama como el segundo personaje, pero eligió el primero
  r.addBots(tk(1), CAPACITY - 1, 'facil');
  const ps = r.snapshot(tk(1)).view.players;
  assert.equal(new Set(ps.map(p => p.character)).size, CAPACITY, 'nadie se queda sin personaje');
  assert.equal(new Set(ps.map(p => p.nick)).size, CAPACITY, 'ni con un nombre repetido');
  assert.ok(BOT_NAMES.includes(ps.find(p => p.isBot && p.character === ids[1]).nick));
});
