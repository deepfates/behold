import test from 'node:test';
import assert from 'node:assert/strict';
import { restrictNavigationToLocomotion } from '../src/bot';

test('normal navigation cannot silently dig or place scaffolding', () => {
  const movements = {
    canDig: true,
    allow1by1towers: true,
    scafoldingBlocks: [1, 4],
  };

  assert.equal(restrictNavigationToLocomotion(movements), movements);
  assert.equal(movements.canDig, false);
  assert.equal(movements.allow1by1towers, false);
  assert.deepEqual(movements.scafoldingBlocks, []);
});
