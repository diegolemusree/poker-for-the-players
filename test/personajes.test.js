import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { CHARACTERS, POSES, poseFile, hasPose, characterFor, needsMirror } from '../client/stage/characters.js';
import { RivalAnim } from '../client/stage/rivals.js';

const arte = file => new URL(`../public/assets/arte/${file}.webp`, import.meta.url);
const registrados = Object.entries(CHARACTERS); // los de personajes.json en uso (antes de agregar los de prueba)
const REGISTRO = JSON.parse(readFileSync(new URL('../client/stage/personajes.json', import.meta.url), 'utf8'));

test('cada personaje registrado tiene frente con espera, solo cuadros conocidos y sus imágenes', () => {
  assert.ok(registrados.length > 0, 'no hay personajes en uso');
  for (const [id, c] of registrados) {
    assert.ok(c.angles.frente, `${id} sin frente`);
    for (const [angle, a] of Object.entries(c.angles)) {
      assert.ok(a.frames.includes('espera'), `${id} ${angle} sin espera`);
      for (const f of a.frames) {
        assert.ok(POSES.includes(f), `${id} ${angle}: cuadro desconocido ${f}`);
        assert.ok(existsSync(arte(`${id}-${angle}-${f}`)), `falta ${id}-${angle}-${f}.webp`);
        assert.ok(existsSync(arte(`${id}-${angle}-${f}-chico`)), `falta ${id}-${angle}-${f}-chico.webp`);
      }
    }
  }
});

test('los retirados se quedan en el registro pero el juego no los usa', () => {
  const retirados = Object.keys(REGISTRO).filter(id => REGISTRO[id].retirado);
  assert.ok(retirados.includes('blorp'), 'Madame Blorp debería estar retirada');
  for (const id of retirados) assert.ok(!(id in CHARACTERS), `${id} está retirado y se sigue usando`);
  // el juego dibuja el personaje que le asigna el servidor; si no existe (o es un retirado), el primero
  const primero = Object.keys(CHARACTERS)[0];
  assert.equal(characterFor({ character: 'nerd' }), 'nerd');
  assert.equal(characterFor({ character: 'blorp' }), primero);
  assert.equal(characterFor({}), primero);
  assert.equal(characterFor(null), primero);
});

test('cada personaje dice hacia dónde mira su imagen y cuántas sillas ocupa', () => {
  for (const [id, c] of registrados) {
    for (const [angle, a] of Object.entries(c.angles)) {
      assert.ok(['izquierda', 'derecha', 'frente'].includes(a.mira), `${id} ${angle}: falta "mira" o no es izquierda, derecha ni frente`);
    }
    assert.ok(Number.isInteger(c.sillas) && c.sillas >= 1, `${id}: sillas`);
  }
  assert.equal(CHARACTERS.pulpo.sillas, 2, 'Don Tentáculos ocupa dos sillas');
});

test('cada quien ve hacia el centro de la mesa: en espejo solo si su imagen ve hacia el otro lado', () => {
  // La Güera ve a la derecha: a la izquierda del centro, tal cual; a la derecha, en espejo; al centro, tal cual
  assert.equal(REGISTRO.turista.angles.frente.mira, 'derecha');
  assert.equal(needsMirror('turista', 'frente', -0.8), false);
  assert.equal(needsMirror('turista', 'frente', 0.8), true);
  assert.equal(needsMirror('turista', 'frente', 0), false);
  // El Profe ve de frente: nunca en espejo, tampoco en el lado derecho
  assert.equal(needsMirror('nerd', 'frente', 0.8), false);
  assert.equal(needsMirror('nerd', 'lado', 0.8), false); // sin imagen de lado se usa la de frente
  // una imagen de lado ve a la derecha por regla: la del lado derecho va en espejo
  CHARACTERS.deLado = { name: 'De lado', angles: { frente: { mira: 'frente', poses: {} }, lado: { poses: {} } } };
  assert.equal(needsMirror('deLado', 'lado', -0.9), false);
  assert.equal(needsMirror('deLado', 'lado', 0.9), true);
  delete CHARACTERS.deLado;
});

// personajes de prueba: uno con todos los cuadros, uno con retirarse y sin espia ni apuesta, uno con solo espera
const todos = (p) => Object.fromEntries(POSES.map(c => [c, `${p}-${c}`]));
CHARACTERS.completo = { name: 'Completo', angles: { frente: { poses: todos('c') } } };
CHARACTERS.prueba = { name: 'Prueba', angles: { frente: { poses: { espera: 'p-espera', parpadeo: 'p-parpadeo', retirarse: 'p-retirarse' } } } };
CHARACTERS.soloEspera = { name: 'Solo espera', angles: { frente: { poses: { espera: 's-espera' } } } };

test('un cuadro que falta se dibuja con espera', () => {
  assert.equal(poseFile('prueba', 'frente', 'espia'), 'p-espera');
  assert.equal(poseFile('prueba', 'lado', 'retirarse'), 'p-retirarse'); // sin lado usa frente
  assert.equal(hasPose('prueba', 'frente', 'apuesta'), false);
});

test('solo espera parpadea', () => {
  const a = new RivalAnim('completo', 0);
  a.blinkAt = 100;
  assert.equal(a.frame(100, false), 'parpadeo');
  a.play('apuesta', 2000, 120);
  a.blinkAt = 130;
  assert.equal(a.frame(130, false), 'apuesta');
});

test('con solo el cuadro espera: no parpadea, no espía, no apuesta ni se retira, y no falla', () => {
  const a = new RivalAnim('soloEspera', 0);
  a.blinkAt = 100; a.peekAt = 100;
  for (let t = 100; t < 20000; t += 50) assert.equal(a.frame(t, true), 'espera');
  for (const jugada of ['call', 'bet', 'raise', 'fold', 'check']) {
    a.react(jugada, 'frente', false, 30000);
    assert.equal(a.frame(30010, true), 'espera', jugada);
  }
  a.play('espia', 1700, 31000, 300); // al repartir
  a.win('frente', 31000, 8000);      // al ganar
  assert.equal(a.frame(31500, true), 'espera');
  assert.ok(!a.folding(31500));
  // cuando llegan los demás cuadros, se usan solos
  CHARACTERS.soloEspera.angles.frente.poses.parpadeo = 's-parpadeo';
  a.blinkAt = 32000;
  assert.equal(a.frame(32000, true), 'parpadeo');
});

test('al retirarse muestra retirarse y no se apaga hasta que termina', () => {
  const a = new RivalAnim('prueba', 0);
  a.blinkAt = Infinity;
  a.react('fold', 'frente', false, 1000);
  assert.equal(a.frame(1000, false), 'retirarse');
  assert.ok(a.folding(2000));
  assert.equal(a.frame(2500, false), 'espera');
  assert.ok(!a.folding(2500));
});

test('gana es un cuadro opcional: con él, el que gana lo enseña mientras dura el resultado', () => {
  assert.ok(POSES.includes('gana'));
  CHARACTERS.ganador = { name: 'Ganador', angles: { frente: { poses: { espera: 'g-espera', parpadeo: 'g-parpadeo', gana: 'g-gana' } } } };
  const a = new RivalAnim('ganador', 0);
  a.blinkAt = Infinity;
  a.win('lado', 1000, 8000, 500); // sin lado usa frente; empieza cuando se resalta la mano ganadora
  assert.equal(a.frame(1200, true), 'espera');
  assert.equal(a.frame(1600, true), 'gana');
  a.blinkAt = 2000;
  assert.equal(a.frame(2000, true), 'gana', 'en gana no parpadea');
  assert.equal(a.frame(9400, true), 'gana');
  assert.equal(a.frame(9600, true), 'espera', 'al acabarse el resultado regresa a espera');
});

test('sin cuadro gana se queda en espera, y con mano nueva deja de celebrar', () => {
  const sin = new RivalAnim('prueba', 0); // tiene retirarse pero no gana
  sin.blinkAt = Infinity;
  sin.win('frente', 0, 8000);
  assert.equal(sin.frame(100, true), 'espera');
  const a = new RivalAnim('ganador', 0);
  a.blinkAt = Infinity;
  a.win('frente', 0, 8000);
  assert.equal(a.frame(100, true), 'gana');
  a.calm(); // se cerró el resultado con Listo y ya hay mano nueva
  assert.equal(a.frame(200, true), 'espera');
  const b = new RivalAnim('ganador', 0);
  b.blinkAt = Infinity;
  b.win('frente', 0, 8000, 1000);
  b.calm(); // ni siquiera empezó
  assert.equal(b.frame(1500, true), 'espera');
});

test('sin cuadro retirarse, o ausente, no hay pose de retirarse', () => {
  const sin = new RivalAnim('soloEspera', 0);
  sin.react('fold', 'frente', false, 0);
  assert.equal(sin.pose, 'espera');
  const ausente = new RivalAnim('completo', 0);
  ausente.react('fold', 'frente', true, 0);
  assert.equal(ausente.pose, 'espera');
  ausente.react('raise', 'frente', false, 0);
  assert.equal(ausente.pose, 'apuesta');
});
