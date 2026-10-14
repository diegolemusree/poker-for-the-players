import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createApp } from '../server/index.js';

const TUNING = { turnLimitMs: 400, resultMs: 20, resultFoldMs: 20, rebuyWindowMs: 300, botDelay: () => 0, levelMs: 1500 };

function cliente(url, token, accessCode) {
  const socket = connect(url, { auth: { token, accessCode }, reconnection: false, forceNew: true });
  const c = { socket, state: null, history: [] };
  socket.on('state', st => { c.state = st; c.history.push(st); c.waiters?.forEach(w => w()); });
  c.waiters = new Set();
  c.emit = (ev, data) => new Promise(res => socket.emit(ev, data, res));
  c.until = (pred, ms = 5000) => new Promise((res, rej) => {
    const check = () => { if (c.state && pred(c.state)) { c.waiters.delete(check); clearTimeout(t); res(c.state); } };
    const t = setTimeout(() => { c.waiters.delete(check); rej(new Error('tiempo agotado esperando el estado')); }, ms);
    c.waiters.add(check); check();
  });
  c.ready = new Promise((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
  return c;
}
const tk = (n) => 'token-de-prueba-' + n.padStart(16, '0');

// Lo que ve un cliente nunca debe incluir cartas ajenas ni el mazo (salvo showdown real).
function revisar(st) {
  const v = st.view;
  assert.ok(!('deck' in v), 'llegó el mazo al cliente');
  const reveladas = v.phase === 'showdown' && v.results && !v.results.fold ? v.results.shown : [];
  for (const p of v.players) {
    if (p.id === st.you || reveladas.includes(p.id)) continue;
    assert.ok(p.cards.every(c => c === null), 'llegaron cartas ajenas al cliente');
  }
}

describe('servidor', () => {
  let srv, url;
  before(async () => { srv = createApp({ tuning: TUNING }); url = `http://localhost:${await srv.listen(0)}`; });
  after(async () => { await srv.close(); });

  test('/api/config indica si hace falta código', async () => {
    const r = await fetch(url + '/api/config');
    assert.deepEqual(await r.json(), { accessRequired: false });
  });

  test('práctica en solitario: un torneo completo contra bots termina con un campeón con todas las fichas', async () => {
    const c = cliente(url, tk('1')); await c.ready;
    const r = await c.emit('room:create', { nick: 'Diego', solo: true, bots: 3, difficulty: 'facil', levelMinutes: 2 });
    assert.ok(r.ok, r.error);
    assert.match(r.code, /^[A-Z]{5}$/);

    // el humano juega pasivo: iguala todo
    let manos = new Set();
    const juega = (st) => {
      revisar(st);
      manos.add(st.view.handNo);
      if (st.view.toAct === st.you) c.socket.emit('act', { type: st.view.currentBet - st.view.players.find(p => p.id === st.you).bet > 0 ? 'call' : 'check' }, () => {});
      const yo = st.view.players.find(p => p.id === st.you);
      if (st.view.phase === 'showdown' && yo.stack === 0 && !yo.out && yo.rebuysLeft > 0) c.socket.emit('rebuy', {}, () => {});
    };
    c.socket.on('state', juega);
    const fin = await c.until(st => st.view.finished, 90000);
    const vivos = fin.view.players.filter(p => !p.out);
    assert.equal(vivos.length, 1);
    const totalEsperado = 5000 * (4 + fin.view.players.reduce((a, p) => a + (1 - p.rebuysLeft), 0));
    assert.equal(vivos[0].stack, totalEsperado, 'el campeón debe tener todas las fichas');
    assert.equal(fin.view.winner, vivos[0].id);
    assert.ok(manos.size > 3);
    assert.ok(fin.view.players.every(p => p.rebuysLeft >= 0 && p.rebuysLeft <= 1), 'nadie recompra más de una vez');
    c.socket.close();
  });

  test('mesa con amigos: cada quien ve solo sus cartas, valida turnos y se reconecta con su token', async () => {
    const a = cliente(url, tk('a')); const b = cliente(url, tk('b'));
    await Promise.all([a.ready, b.ready]);
    const r = await a.emit('room:create', { nick: 'Ana', solo: false });
    assert.ok(r.ok, r.error);
    assert.ok((await b.emit('room:join', { code: r.code.toLowerCase() })).ok);
    assert.ok((await b.emit('sit', { nick: '<b>Beto</b>', seat: 4 })).ok);
    assert.equal((await b.emit('sit', { nick: 'Otra vez', seat: 5 })).ok, undefined, 'no se puede sentar dos veces');
    assert.ok((await b.emit('room:join', { code: 'ZZZZZ' })).error, 'mesa inexistente');

    await a.until(st => st.view.players.length === 2);
    assert.equal(a.state.view.players.find(p => p.seat === 4).nick, 'bBeto/b', 'los < > se eliminan del apodo');
    assert.ok((await a.emit('start', {})).ok);
    await Promise.all([a.until(st => st.view.phase === 'preflop'), b.until(st => st.view.phase === 'preflop')]);

    for (const c of [a, b]) {
      revisar(c.state);
      const yo = c.state.view.players.find(p => p.id === c.state.you);
      assert.ok(yo.cards.every(x => typeof x === 'string'), 'cada quien ve sus propias cartas');
    }
    const turno = a.state.view.toAct === a.state.you ? a : b;
    const otro = turno === a ? b : a;
    assert.ok((await otro.emit('act', { type: 'call' })).error, 'fuera de turno debe rechazarse');
    assert.ok((await turno.emit('act', { type: 'raise', amount: 'mucho' })).error, 'monto inválido');
    assert.ok((await turno.emit('act', { type: 'call' })).ok);

    // un espectador no ve ninguna carta
    const e = cliente(url, tk('e')); await e.ready;
    await e.emit('room:join', { code: r.code });
    await e.until(st => st.view.players.length === 2);
    assert.ok(e.state.view.players.every(p => p.cards.every(x => x === null)));
    assert.equal(e.state.you, null);
    assert.ok((await e.emit('act', { type: 'fold' })).error);

    // reconexión: mismo token, nuevo socket, recupera asiento y cartas
    const misCartas = b.state.view.players.find(p => p.id === b.state.you).cards;
    b.socket.close();
    const b2 = cliente(url, tk('b')); await b2.ready;
    await b2.emit('room:join', { code: r.code });
    await b2.until(st => st.you);
    assert.deepEqual(b2.state.view.players.find(p => p.id === b2.state.you).cards, misCartas);

    // si nadie juega, el servidor retira o pasa por ellos y reparte la siguiente mano
    await a.until(st => st.view.handNo >= 2, 10000);
    [a, b2, e].forEach(c => c.socket.close());
  });

  test('quien no juega dos turnos seguidos queda ausente y la mesa sigue', async () => {
    const a = cliente(url, tk('x')); await a.ready;
    const r = await a.emit('room:create', { nick: 'Solo', solo: false });
    await a.emit('bots:add', { count: 1, difficulty: 'facil' });
    assert.ok((await a.emit('start', {})).ok);
    await a.until(st => st.view.players.find(p => p.id === st.you).sittingOut, 15000);
    await a.until(st => st.view.handNo >= 3, 15000); // los bots siguen jugando sin esperarlo
    assert.ok((await a.emit('sitin', {})).ok);
    a.socket.close();
    assert.ok(r.ok);
  });

  test('validaciones: bots, torneo iniciado y práctica privada', async () => {
    const a = cliente(url, tk('v1')); const b = cliente(url, tk('v2'));
    await Promise.all([a.ready, b.ready]);
    assert.ok((await a.emit('room:create', { nick: 'X', solo: true, bots: 9, difficulty: 'normal' })).error);
    assert.ok((await a.emit('room:create', { nick: 'X', solo: true, bots: 2, difficulty: 'imposible' })).error);
    const r = await a.emit('room:create', { nick: 'X', solo: false });
    assert.ok((await a.emit('bots:add', { count: 20, difficulty: 'normal' })).error);
    assert.ok((await a.emit('bots:add', { count: 2, difficulty: 'normal' })).ok);
    assert.ok((await a.emit('start', {})).ok);
    assert.ok((await a.emit('bots:add', { count: 1, difficulty: 'normal' })).error, 'no se agregan bots con el torneo en marcha');
    await b.emit('room:join', { code: r.code });
    assert.ok((await b.emit('sit', { nick: 'Tarde', seat: 3 })).error, 'no se puede entrar una vez iniciado');

    const s = await a.emit('room:create', { nick: 'X', solo: true, bots: 2, difficulty: 'facil' });
    assert.ok((await b.emit('room:join', { code: s.code })).error, 'las prácticas son privadas');
    [a, b].forEach(c => c.socket.close());
  });
});

describe('código de acceso', () => {
  test('se valida en el servidor', async () => {
    const srv = createApp({ accessCode: 'noche-de-poker', tuning: TUNING });
    const url = `http://localhost:${await srv.listen(0)}`;
    assert.deepEqual(await (await fetch(url + '/api/config')).json(), { accessRequired: true });
    await assert.rejects(cliente(url, tk('1')).ready, /Código de acceso/);
    await assert.rejects(cliente(url, tk('2'), 'otro').ready, /Código de acceso/);
    const ok = cliente(url, tk('3'), 'noche-de-poker');
    await ok.ready;
    ok.socket.close();
    await srv.close();
  });
});

describe('final de la mano por sockets', () => {
  test('cada mensaje a cada quien: cartas ajenas solo al final, nunca las de quien se retiró; con el Listo de todos se reparte', async () => {
    const LARGO = 60000;
    const srv = createApp({ tuning: { ...TUNING, turnLimitMs: LARGO, resultMs: LARGO, resultFoldMs: LARGO } });
    const url = `http://localhost:${await srv.listen(0)}`;
    const [ana, beto, carla, mira] = ['s1', 's2', 's3', 's4'].map(n => cliente(url, tk(n)));
    await Promise.all([ana, beto, carla, mira].map(c => c.ready));
    const r = await ana.emit('room:create', { nick: 'Ana', solo: false });
    for (const [c, nick, seat] of [[beto, 'Beto', 1], [carla, 'Carla', 2]]) {
      await c.emit('room:join', { code: r.code });
      assert.ok((await c.emit('sit', { nick, seat })).ok);
    }
    await mira.emit('room:join', { code: r.code }); // espectador
    // cómo juega cada quien: en la mano 1 Beto se retira y Ana y Carla pasan o igualan hasta el final;
    // en la 2 Beto sube y los demás se retiran
    const plan = { Ana: n => (n === 1 ? 'pasa' : 'fold'), Beto: n => (n === 1 ? 'fold' : 'sube'), Carla: n => (n === 1 ? 'pasa' : 'fold') };
    for (const [c, nick] of [[ana, 'Ana'], [beto, 'Beto'], [carla, 'Carla']]) {
      c.socket.on('state', st => {
        const v = st.view, yo = v.players.find(p => p.id === st.you);
        if (v.toAct !== st.you || !['preflop', 'flop', 'turn', 'river'].includes(v.phase)) return;
        const quiere = plan[nick](v.handNo);
        const jugada = quiere === 'fold' ? { type: 'fold' } : quiere === 'sube' ? { type: 'raise', amount: 200 } : { type: v.currentBet - yo.bet > 0 ? 'call' : 'check' };
        c.socket.emit('act', jugada, () => {});
      });
    }
    assert.ok((await ana.emit('start', {})).ok);
    const room = srv.rooms.get(r.code);
    const final = n => st => st.view.handNo === n && st.view.phase === 'showdown';
    await Promise.all([ana, beto, carla, mira].map(c => c.until(final(1))));
    assert.ok(!room.state.results.fold);
    const cartas = () => Object.fromEntries(room.state.players.map(p => [p.id, p.cards.slice()]));
    const id = nick => room.state.players.find(p => p.nick === nick).id;
    const manos = { 1: cartas() };

    // el resultado se queda hasta que los tres tocan Listo; el espectador no puede
    assert.equal((await mira.emit('ready', { hand: 1 })).error, 'No estás sentado en esta mesa.');
    for (const c of [ana, beto]) assert.ok((await c.emit('ready', { hand: 1 })).ok);
    await new Promise(res => setTimeout(res, 50));
    assert.equal(room.state.handNo, 1, 'falta el Listo de Carla');
    assert.deepEqual(ana.state.waitIds, [id('Carla')]);
    assert.ok((await carla.emit('ready', { hand: 1 })).ok);
    await Promise.all([ana, beto, carla, mira].map(c => c.until(final(2))));
    assert.ok(room.state.results.fold);
    manos[2] = cartas();

    // todo lo que recibió cada quien, mano por mano, sin fiarse de lo que el servidor dice que enseñó
    const llegaron = { 1: [id('Ana'), id('Carla')], 2: [] };
    for (const c of [ana, beto, carla, mira]) {
      for (const st of c.history) {
        const v = st.view, json = JSON.stringify(st);
        assert.ok(!('deck' in v), 'llegó el mazo');
        if (!manos[v.handNo]) continue;
        const alFinal = v.phase === 'showdown' && v.results && !v.results.fold;
        for (const [dueño, suyas] of Object.entries(manos[v.handNo])) {
          if (dueño === st.you) continue;
          const vp = v.players.find(p => p.id === dueño);
          if (alFinal && llegaron[v.handNo].includes(dueño)) { assert.deepEqual(vp.cards, suyas); continue; }
          assert.ok(vp.cards.every(x => x === null), `mano ${v.handNo}: llegaron cartas de ${dueño} (${v.phase})`);
          for (const x of suyas) assert.ok(!json.includes(`"${x}"`), `mano ${v.handNo}: llegó ${x} de ${dueño} (${v.phase})`);
        }
      }
    }
    [ana, beto, carla, mira].forEach(c => c.socket.close());
    await srv.close();
  });
});

describe('mesas vacías', () => {
  test('se borran de memoria después del tiempo sin jugadores', async () => {
    const srv = createApp({ tuning: TUNING, emptyTtlMs: 0 });
    const url = `http://localhost:${await srv.listen(0)}`;
    const c = cliente(url, tk('9')); await c.ready;
    const r = await c.emit('room:create', { nick: 'X', solo: false });
    assert.ok(srv.rooms.has(r.code));
    c.socket.close();
    await new Promise(res => setTimeout(res, 100));
    assert.equal(srv.rooms.get(r.code).connections, 0);
    await srv.close();
  });
});
