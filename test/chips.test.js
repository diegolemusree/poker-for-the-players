import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHIPS, STARTING_CHIPS, breakdown } from '../client/chips.js';
import { START, BLINDS } from '../server/engine.js';

const total = list => list.reduce((a, c) => a + c.value * c.count, 0);

test('las denominaciones son 10, 25, 50, 100, 500 y 1000, cada una de un color distinto', () => {
  assert.deepEqual(CHIPS.map(c => c.value).sort((a, b) => a - b), [10, 25, 50, 100, 500, 1000]);
  assert.equal(new Set(CHIPS.map(c => c.color)).size, CHIPS.length);
});

test('el reparto inicial suma exactamente las fichas de inicio y trae de todas', () => {
  assert.equal(total(STARTING_CHIPS), START);
  assert.equal(STARTING_CHIPS.length, 6);
  assert.ok(STARTING_CHIPS.every(c => c.count > 0));
});

test('todas las ciegas se pueden pagar con fichas', () => {
  for (const [sb, bb] of BLINDS) {
    assert.equal(breakdown(sb).rest, 0, `ciega chica ${sb}`);
    assert.equal(breakdown(bb).rest, 0, `ciega grande ${bb}`);
  }
});

test('cualquier múltiplo de 5 desde 20 (y el 10) se forma exacto', () => {
  for (let x = 20; x <= 60000; x += 5) {
    const { chips, rest } = breakdown(x);
    assert.equal(rest, 0, `no se pudo formar ${x}`);
    assert.equal(total(chips), x);
  }
  assert.deepEqual(breakdown(10).chips, [{ value: 10, count: 1 }]);
});

test('usa pocas fichas: 5,000 son 5 amarillas y 175 son 100 + 50 + 25', () => {
  assert.deepEqual(breakdown(5000).chips, [{ value: 1000, count: 5 }]);
  assert.deepEqual(breakdown(175).chips, [{ value: 100, count: 1 }, { value: 50, count: 1 }, { value: 25, count: 1 }]);
});

test('lo que no se puede formar se reporta como resto', () => {
  assert.equal(breakdown(15).rest, 5);
  assert.equal(breakdown(7).rest, 7);
  assert.equal(breakdown(0).chips.length, 0);
});
