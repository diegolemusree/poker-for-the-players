// La baraja: los palos de cada carta del 2 al 10 (cuántos, dónde y simétricos al girar la carta), los dos colores, el
// arte exportado (si falta, esa carta se dibuja solo con código, pero el juego espera tenerlo) y la zona libre del reverso
// donde va la etiqueta del logo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pipLayout, CARD_PX, ETIQUETA, largoEtiqueta } from '../client/stage/cards.js';
import { SUIT_PATH, SUIT_COLOR } from '../client/ui/suits.js';

const [W, H] = CARD_PX;
const DATOS = JSON.parse(readFileSync(new URL('../client/stage/baraja.json', import.meta.url), 'utf8'));
const arte = nombre => new URL(`../public/assets/arte/carta-${nombre}.webp`, import.meta.url);
// los índices de las esquinas (el número y su palo; el más ancho es el 10, angosto, hasta x = 67): arriba a la
// izquierda y, girado, abajo a la derecha
const INDICES = [{ x0: 10, y0: 20, x1: 68, y1: 134 }, { x0: W - 68, y0: H - 134, x1: W - 10, y1: H - 20 }];
const MEDIO_PIP = 19;   // los palos (de 42 px) ocupan el 90 % de su caja

test('cada carta del 2 al 10 lleva tantos palos como su número, adentro de la carta y sin tocar los índices', () => {
  for (let n = 2; n <= 10; n++) {
    const pips = pipLayout(n);
    assert.equal(pips.length, n, `el ${n}`);
    for (const p of pips) {
      assert.ok(p.x - MEDIO_PIP > 0 && p.x + MEDIO_PIP < W && p.y - MEDIO_PIP > 0 && p.y + MEDIO_PIP < H, `el ${n}: un palo se sale`);
      for (const c of INDICES) {
        const toca = p.x + MEDIO_PIP > c.x0 && p.x - MEDIO_PIP < c.x1 && p.y + MEDIO_PIP > c.y0 && p.y - MEDIO_PIP < c.y1;
        assert.ok(!toca, `el ${n}: el palo de (${p.x}, ${p.y}) se encima con un índice`);
      }
    }
  }
});

test('la distribución es la de siempre: igual al girar la carta, y los de la mitad de abajo van de cabeza', () => {
  for (let n = 2; n <= 10; n++) {
    const pips = pipLayout(n);
    for (const p of pips) {
      const espejo = pips.find(q => Math.abs(q.x - (W - p.x)) < 0.5 && Math.abs(q.y - (H - p.y)) < 0.5);
      // el 7 de siempre lleva su palo de en medio solo en la mitad de arriba
      if (n === 7 && !espejo && p.x === W / 2 && p.y < H / 2) continue;
      assert.ok(espejo, `el ${n}: el palo de (${p.x}, ${p.y}) no tiene pareja al girar la carta`);
      if (Math.abs(p.y - H / 2) > 0.5) assert.equal(espejo.flip, !p.flip, `el ${n}: (${p.x}, ${p.y})`);
      assert.equal(p.flip, p.y > H / 2 + 0.5, `el ${n}: solo los de abajo van de cabeza`);
    }
  }
});

test('palos clásicos en dos colores: corazones y diamantes rojos, picas y tréboles de tinta', () => {
  assert.deepEqual(Object.keys(SUIT_PATH).sort(), ['c', 'd', 'h', 's']);
  assert.equal(SUIT_COLOR.h, SUIT_COLOR.d);
  assert.equal(SUIT_COLOR.s, SUIT_COLOR.c);
  assert.notEqual(SUIT_COLOR.h, SUIT_COLOR.s);
});

test('el arte de la baraja está exportado: el reverso, cada figura en sus cuatro palos y los adornos', () => {
  const nombres = ['reverso', 'adorno-flor', 'adorno-banda',
    ...Object.values(DATOS.figuras).flatMap(f => [...'hdcs'].map(s => `${f}-${s}`))];
  assert.equal(nombres.length, 15);
  for (const n of nombres) assert.ok(existsSync(arte(n)), `falta public/assets/arte/carta-${n}.webp`);
  assert.deepEqual(Object.keys(DATOS.figuras).sort(), ['J', 'K', 'Q']);
});

test('la etiqueta del reverso cabe adentro del marco (se acorta sola si con su tamaño lo tocaría)', () => {
  const { columnas, filas, celdas } = DATOS.libre;
  assert.equal(celdas.length, filas);
  assert.ok(celdas.every(f => f.length === columnas && /^[01]+$/.test(f)));
  assert.equal(celdas[Math.floor(filas / 2)][Math.floor(columnas / 2)], '1', 'el centro del reverso está libre');
  const largo = largoEtiqueta(ETIQUETA.reverso, DATOS.libre);
  assert.ok(largo >= 0.4 && largo <= ETIQUETA.reverso.largo, `largo ${largo}`);
  assert.ok(ETIQUETA.as.largo * W <= W - 2 * 64, 'la etiqueta de los ases no llega a los índices');
});
