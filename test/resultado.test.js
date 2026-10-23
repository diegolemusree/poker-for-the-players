// Resultado de la mano en una mesa (Room), sin sockets: lo que se le mandaría a cada quien
// (snapshot, lo mismo que emite el servidor) y el botón Listo para pasar a la siguiente mano.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { CAST } from '../server/bots.js';

const LARGO = 60 * 60 * 1000;
const tk = n => 'token-de-prueba-' + String(n).padStart(16, '0');
const ESPECTADOR = tk('espectador');
// las mesas se cierran al final aunque una prueba falle (si no, sus relojes dejan la prueba colgada)
const abiertas = [];
after(() => abiertas.forEach(r => r.close()));
const espera = ms => new Promise(r => setTimeout(r, ms));
async function hasta(pred, ms = 2000) {
  for (const fin = Date.now() + ms; Date.now() < fin; await espera(5)) if (pred()) return;
  assert.fail('tiempo agotado');
}

// Mesa con amigos (cada quien con un personaje; se sientan en los asientos 0, 1, 2…; reparte el primero). Guarda todo lo que se le mandaría a cada
// jugador y a un espectador, desde que se acomodan las cartas.
function mesa(nombres, tuning = {}) {
  const tokens = nombres.map((_, i) => tk(i + 1));
  const emitido = new Map([...tokens, ESPECTADOR].map(t => [t, []]));
  const room = new Room({ code: 'PRUEB', solo: false },
    { turnLimitMs: LARGO, resultMs: LARGO, resultFoldMs: LARGO, botDelay: () => LARGO, ...tuning },
    r => { for (const [t, lista] of emitido) lista.push(r.snapshot(t)); });
  abiertas.push(room);
  nombres.forEach((n, i) => room.sit(tokens[i], n, CAST[i].id));
  room.start(tokens[0]);
  const t = Object.fromEntries(nombres.map((n, i) => [n, tokens[i]]));
  const id = n => room.playerIdOf(t[n]);
  return { room, t, id, emitido };
}
// Cartas de cada quien y tablero que saldrá; desde aquí se guarda lo que se emite.
function arreglar({ room, id, emitido }, manos, tablero) {
  for (const [n, cartas] of Object.entries(manos)) room.state.players.find(p => p.id === id(n)).cards = cartas;
  room.state.deck = [...tablero].reverse();
  for (const lista of emitido.values()) lista.length = 0;
  room.changed();
}

// Revisa todo lo emitido sin fiarse de lo que el servidor dice que se enseñó: las cartas de `manos` solo
// pueden llegarle a otro (o al espectador) si su dueño está en `llegaron` y la mano ya terminó con cartas
// enseñadas; si no, nunca, ni en el resultado ni en el historial.
function revisarEmitido({ room, emitido }, manos, llegaron) {
  let enseñadas = 0;
  for (const [t, lista] of emitido) {
    const yo = room.playerIdOf(t);
    for (const st of lista) {
      const v = st.view, json = JSON.stringify(st);
      assert.ok(!('deck' in v), 'llegó el mazo');
      const final = v.phase === 'showdown' && v.results && !v.results.fold;
      for (const [dueño, cartas] of Object.entries(manos)) {
        if (dueño === yo) continue;
        const vp = v.players.find(p => p.id === dueño);
        if (final && llegaron.includes(dueño)) { assert.deepEqual(vp.cards, cartas, 'no se enseñaron las cartas de quien llegó'); enseñadas++; continue; }
        assert.ok(vp.cards.every(c => c === null), `a ${yo ?? 'espectador'} le llegaron cartas de ${dueño} (${v.phase})`);
        for (const c of cartas) assert.ok(!json.includes(`"${c}"`), `a ${yo ?? 'espectador'} le llegó ${c} de ${dueño} (${v.phase})`);
        if (v.results) for (const k of ['hands', 'desc', 'best']) assert.ok(!(v.results[k] && dueño in v.results[k]), `${k} de ${dueño}`);
      }
    }
  }
  return enseñadas;
}

describe('seguridad del resultado (lo que se emite a cada quien)', () => {
  test('al final se enseñan las cartas de quienes llegaron y nunca las de quien se retiró', () => {
    const m = mesa(['Ana', 'Beto', 'Carla']);
    const manos = { [m.id('Ana')]: ['Ah', 'Kh'], [m.id('Beto')]: ['Qs', 'Qd'], [m.id('Carla')]: ['7c', '2d'] };
    arreglar(m, { Ana: manos[m.id('Ana')], Beto: manos[m.id('Beto')], Carla: manos[m.id('Carla')] }, ['4h', 'Th', '2h', '9s', '8c']);
    // reparte Ana; ciegas de Beto y Carla. Beto se retira; Ana y Carla pasan hasta el final
    m.room.act(m.t.Ana, 'call');
    m.room.act(m.t.Beto, 'fold');
    m.room.act(m.t.Carla, 'check');
    for (let i = 0; i < 3; i++) { m.room.act(m.t.Carla, 'check'); m.room.act(m.t.Ana, 'check'); }
    const s = m.room.state;
    assert.equal(s.phase, 'showdown');
    assert.ok(!s.results.fold);
    const enseñadas = revisarEmitido(m, manos, [m.id('Ana'), m.id('Carla')]);
    assert.ok(enseñadas > 0, 'nadie recibió el resultado');
    assert.match(s.log.at(-1), /^Ana gana 125 con color de corazones\.$/);
    m.room.close();
  });

  test('si todos se retiran, nadie ve las cartas del ganador', () => {
    const m = mesa(['Ana', 'Beto', 'Carla']);
    const manos = { [m.id('Ana')]: ['Ah', 'Kh'], [m.id('Beto')]: ['Qs', 'Qd'], [m.id('Carla')]: ['7c', '2d'] };
    arreglar(m, { Ana: manos[m.id('Ana')], Beto: manos[m.id('Beto')], Carla: manos[m.id('Carla')] }, ['4h', 'Th', '2h', '9s', '8c']);
    m.room.act(m.t.Ana, 'raise', 100);
    m.room.act(m.t.Beto, 'fold');
    m.room.act(m.t.Carla, 'fold');
    assert.ok(m.room.state.results.fold);
    revisarEmitido(m, manos, []);
    m.room.close();
  });

  test('con all-in las cartas se enseñan hasta que termina la mano', () => {
    const m = mesa(['Ana', 'Beto', 'Carla']);
    const manos = { [m.id('Ana')]: ['Ah', 'Ad'], [m.id('Beto')]: ['Ks', 'Kd'], [m.id('Carla')]: ['7c', '2d'] };
    arreglar(m, { Ana: manos[m.id('Ana')], Beto: manos[m.id('Beto')], Carla: manos[m.id('Carla')] }, ['4h', 'Th', '2h', '9s', '8c']);
    m.room.act(m.t.Ana, 'raise', 5000);
    m.room.act(m.t.Beto, 'call');
    m.room.act(m.t.Carla, 'fold');
    assert.equal(m.room.state.phase, 'showdown');
    revisarEmitido(m, manos, [m.id('Ana'), m.id('Beto')]);
    m.room.close();
  });
});

// Juega la mano actual hasta el final pasando o igualando (los ausentes se retiran solos).
function hastaElFinal(room) {
  for (let i = 0; i < 50 && ['preflop', 'flop', 'turn', 'river'].includes(room.state.phase); i++) {
    const s = room.state, p = s.players.find(x => x.id === s.toAct);
    const token = [...room.tokens].find(([, id]) => id === p.id)[0];
    room.act(token, s.currentBet - p.bet > 0 ? 'call' : 'check');
  }
  assert.equal(room.state.phase, 'showdown');
}

describe('Listo y tiempo del resultado', () => {
  test('el resultado dura RESULT_MS con cartas y RESULT_FOLD_MS si todos se retiraron', () => {
    const m = mesa(['Ana', 'Beto'], { resultMs: 50000, resultFoldMs: 20000 });
    hastaElFinal(m.room);
    const a = m.room.snapshot(m.t.Ana);
    assert.ok(a.dealLeftMs > 49000 && a.dealLeftMs <= 50000, `con cartas: ${a.dealLeftMs}`);
    assert.equal(a.resultMs, 50000);
    m.room.close();

    const f = mesa(['Ana', 'Beto'], { resultMs: 50000, resultFoldMs: 20000 });
    f.room.act(f.t.Ana, 'fold'); // heads-up: el que reparte habla primero
    const b = f.room.snapshot(f.t.Beto);
    assert.ok(b.view.results.fold);
    assert.ok(b.dealLeftMs > 19000 && b.dealLeftMs <= 20000, `todos se retiraron: ${b.dealLeftMs}`);
    assert.equal(b.resultMs, 20000);
    f.room.close();
  });

  test('con amigos se reparte cuando todos tocan Listo; un Listo de otra mano no cuenta', async () => {
    const m = mesa(['Ana', 'Beto', 'Carla']);
    hastaElFinal(m.room);
    const mano = m.room.state.handNo;
    m.room.ready(m.t.Ana, mano);
    m.room.ready(m.t.Beto, mano - 1); // tardío: no cuenta
    let st = m.room.snapshot(m.t.Ana);
    assert.deepEqual(st.readyIds, [m.id('Ana')]);
    assert.deepEqual(st.waitIds.sort(), [m.id('Beto'), m.id('Carla')].sort());
    assert.ok(st.canReady);
    m.room.ready(m.t.Beto, mano);
    await espera(30);
    assert.equal(m.room.state.handNo, mano, 'no debía repartir: falta Carla');
    m.room.ready(m.t.Carla, mano);
    await hasta(() => m.room.state.handNo === mano + 1);
    st = m.room.snapshot(m.t.Ana);
    assert.deepEqual([st.readyIds, st.waitIds, st.canReady], [[], [], false], 'en plena mano no hay Listo');
    m.room.close();
  });

  test('no se espera a ausentes ni a espectadores; si alguien se ausenta durante el resultado, ya no se le espera', async () => {
    const m = mesa(['Ana', 'Beto', 'Carla']);
    m.room.resign(m.t.Carla);
    hastaElFinal(m.room);
    const mano = m.room.state.handNo;
    const carla = m.room.snapshot(m.t.Carla);
    assert.equal(carla.canReady, false, 'el Listo de un ausente no cuenta');
    assert.deepEqual(carla.waitIds.sort(), [m.id('Ana'), m.id('Beto')].sort());
    assert.throws(() => m.room.ready(ESPECTADOR, mano), /No estás sentado/);
    m.room.ready(m.t.Ana, mano);
    m.room.resign(m.t.Beto);
    await hasta(() => m.room.state.handNo === mano + 1);
    m.room.close();
  });

  test('en práctica, Listo reparte de inmediato (también si ya quedaste fuera y ves a los bots)', async () => {
    const room = new Room({ code: 'SOLO1', solo: true }, { turnLimitMs: LARGO, resultMs: LARGO, resultFoldMs: LARGO, botDelay: () => LARGO });
    abiertas.push(room);
    room.connections = 1; // la práctica se congela si nadie la está viendo
    const t = tk('solo');
    room.sit(t, 'Diego', CAST[0].id);
    room.addBots(t, 2, 'facil');
    room.start(t);
    // Diego se retira en cuanto le toca; a los bots se les adelanta el turno para no esperar su tiempo
    const terminarMano = () => {
      for (let i = 0; i < 80 && ['preflop', 'flop', 'turn', 'river'].includes(room.state.phase); i++) {
        if (room.bots.has(room.state.toAct)) room.botTurn(room.state.toAct, room.turnKey);
        else room.act(t, 'fold');
      }
      assert.equal(room.state.phase, 'showdown');
    };
    terminarMano();
    const mano = room.state.handNo;
    assert.ok(room.snapshot(t).canReady);
    room.ready(t, mano);
    await hasta(() => room.state.handNo === mano + 1);

    // ya fuera del torneo: nadie más cuenta, así que su Listo también pasa a la siguiente mano de los bots
    terminarMano();
    Object.assign(room.state.players.find(p => p.id === room.playerIdOf(t)), { out: true, stack: 0 });
    assert.deepEqual(room.snapshot(t).waitIds, []);
    assert.ok(room.snapshot(t).canReady);
    room.ready(t, mano + 1);
    await hasta(() => room.state.handNo === mano + 2);
    room.close();
  });
});
