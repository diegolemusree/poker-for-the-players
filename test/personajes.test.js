import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CHARACTERS, POSES, poseFile, hasPose } from '../client/stage/characters.js';
import { RivalAnim } from '../client/stage/rivals.js';

const arte = file => new URL(`../public/assets/arte/${file}.webp`, import.meta.url);
const registrados = Object.entries(CHARACTERS); // los de personajes.json (antes de agregar los de prueba)

test('cada personaje registrado tiene frente con espera, solo cuadros conocidos y sus imágenes', () => {
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

// personaje de prueba con retirarse y sin espia
CHARACTERS.prueba = { name: 'Prueba', angles: { frente: { poses: { espera: 'p-espera', parpadeo: 'p-parpadeo', retirarse: 'p-retirarse' } } } };

test('un cuadro que falta se dibuja con espera', () => {
  assert.equal(poseFile('prueba', 'frente', 'espia'), 'p-espera');
  assert.equal(poseFile('prueba', 'lado', 'retirarse'), 'p-retirarse'); // sin lado usa frente
  assert.equal(hasPose('prueba', 'frente', 'apuesta'), false);
});

test('solo espera parpadea', () => {
  const a = new RivalAnim('prueba', 0);
  a.blinkAt = 100;
  assert.equal(a.frame(100, false), 'parpadeo');
  a.play('apuesta', 2000, 120);
  a.blinkAt = 130;
  assert.equal(a.frame(130, false), 'apuesta');
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

test('sin cuadro retirarse, o ausente, no hay pose de retirarse', () => {
  CHARACTERS.prueba2 = { name: 'Prueba 2', angles: { frente: { poses: { espera: 'q-espera' } } } };
  const sin = new RivalAnim('prueba2', 0);
  sin.react('fold', 'frente', false, 0);
  assert.equal(sin.pose, 'espera');
  const ausente = new RivalAnim('prueba', 0);
  ausente.react('fold', 'frente', true, 0);
  assert.equal(ausente.pose, 'espera');
  ausente.react('raise', 'frente', false, 0);
  assert.equal(ausente.pose, 'apuesta');
});
