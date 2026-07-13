import assert from 'node:assert/strict';
import test from 'node:test';
import { findClientObservedWorldChange } from '../scripts/owned-world-proof-support';

const expected = {
  verb: 'dig',
  position: { x: 2, y: -60, z: 0 },
  before: 'gold_block',
  after: 'air',
  confirmationSource: 'mineflayer:blockUpdate',
};

test('owned-world proof recognizes the client-observed interpreter transition shape', () => {
  const change = {
    verb: 'dig',
    position: { x: 2, y: -60, z: 0 },
    before: 'gold_block',
    after: 'air',
    verified: true,
    observed: true,
    confirmation: { source: 'mineflayer:blockUpdate', observedAt: 123 },
  };
  assert.equal(findClientObservedWorldChange({ ok: true, changes: [change] }, expected), change);
});

test('owned-world proof rejects a top-level claim or the wrong physical transition', () => {
  assert.equal(
    findClientObservedWorldChange(
      { ok: true, confirmation: 'mineflayer:blockUpdate', changes: [] },
      expected,
    ),
    null,
  );
  assert.equal(
    findClientObservedWorldChange(
      {
        ok: true,
        changes: [
          {
            ...expected,
            position: { x: 3, y: -60, z: 0 },
            verified: true,
            observed: true,
            confirmation: { source: 'mineflayer:blockUpdate' },
          },
        ],
      },
      expected,
    ),
    null,
  );
});
