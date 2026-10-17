import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { TABLE_EDGE, CAMERAS } from '../client/stage/config.js';
import { TABLE_ART, RAIL_Y, APRON, FELT_R, makeView, fit, artOutline, frontRegion, edgeYAt } from '../client/stage/projection.js';
import { CHARACTERS } from '../client/stage/characters.js';

// La mesa ilustrada se dibuja con su propia proyección y todo lo demás (fichas, cartas, asientos, el recorte de los
// rivales) con la de config.js: si no coinciden, nada cae en su lugar. Los dos salen de scripts/calcar-mesa.py.
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('la cámara y la orilla del juego son las de la mesa ilustrada', () => {
  const cam = CAMERAS.landscape;
  assert.ok(cam.art, 'la cámara de la computadora usa la mesa ilustrada');
  assert.ok(near(cam.pitch, TABLE_ART.camara.pitch) && near(cam.dist, TABLE_ART.camara.dist),
    `config.js (pitch ${cam.pitch}, dist ${cam.dist}) no es la cámara con que se calcó la mesa (${JSON.stringify(TABLE_ART.camara)})`);
  const m = TABLE_ART.mesa;
  assert.equal(TABLE_EDGE.length, m.TABLE_EDGE.length);
  TABLE_EDGE.forEach((p, i) => assert.ok(near(p.x, m.TABLE_EDGE[i].x) && near(p.z, m.TABLE_EDGE[i].z),
    `TABLE_EDGE[${i}] es ${JSON.stringify(p)} y en la mesa calcada ${JSON.stringify(m.TABLE_EDGE[i])}`));
  assert.ok(near(RAIL_Y, m.RAIL_Y) && near(APRON, m.APRON) && near(FELT_R, m.FELT_R),
    `RAIL_Y, APRON y FELT_R (${RAIL_Y}, ${APRON}, ${FELT_R}) no son los calcados (${m.RAIL_Y}, ${m.APRON}, ${m.FELT_R})`);
});

test('las imágenes de la mesa existen y el frente cortado nunca se ve en pantallas horizontales', () => {
  for (const [w] of TABLE_ART.sizes) assert.ok(existsSync(new URL(`../public/assets/arte/${TABLE_ART.file}-${w}.webp`, import.meta.url)), `falta mesa-${w}.webp`);
  const [, h] = TABLE_ART.sizes[TABLE_ART.sizes.length - 1];
  // la cabeza más alta, como la calcula la escena (index.js)
  const headWorld = Math.max(...Object.values(CHARACTERS).map(c => c.angles.frente.height * c.angles.frente.waist[1])) * (CAMERAS.landscape.rivals || 1);
  for (const [W, H] of [[1280, 800], [1366, 768], [1440, 900], [1920, 1080], [2560, 1080], [1024, 768]]) {
    const v = fit(makeView({ W, H, top: 80, reserve: Math.min(210, Math.max(130, H * 0.21)), portrait: false, cam: CAMERAS.landscape }), headWorld, CAMERAS.landscape);
    const bottom = v.cy + (h - TABLE_ART.cy) * (v.F / TABLE_ART.F);
    assert.ok(bottom >= H - 0.5, `${W}x${H}: la orilla de abajo del dibujo queda en ${bottom.toFixed(1)}, arriba de la de la pantalla`);
    // y a los rivales se les recorta en la orilla dibujada: la línea de arriba de la silueta cruza toda la pantalla
    const front = frontRegion(artOutline(v));
    for (const x of [0, W / 2, W]) assert.ok(edgeYAt(front, x) !== null, `${W}x${H}: sin orilla en x = ${x}`);
  }
});
