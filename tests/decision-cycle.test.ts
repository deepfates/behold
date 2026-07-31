import test from 'node:test';
import assert from 'node:assert/strict';
import { createResidentDecisionCycle } from '../src/policy/decision-cycle';

test('decision-cycle state is volatile, immutable, and suspension-dominant', () => {
  let at = 10;
  const cycle = createResidentDecisionCycle(() => at++);
  const wake = { kind: 'initial' as const };

  cycle.enter('perceiving', { activeWake: wake, observationSequence: 7 });
  const perceived = cycle.snapshot(null, false);
  assert.equal(perceived.phase, 'perceiving');
  assert.equal(perceived.observationSequence, 7);
  assert.ok(Object.isFrozen(perceived));
  assert.ok(Object.isFrozen(perceived.activeWake));

  cycle.enter('suspended');
  cycle.enter('committing_turn', { observationSequence: 8 });
  assert.equal(cycle.snapshot(null, false).phase, 'suspended');
  cycle.enter('idle');
  cycle.enter('deciding');
  assert.equal(cycle.snapshot(null, false).phase, 'deciding');

  cycle.enter('stopped');
  cycle.enter('idle');
  assert.equal(cycle.snapshot(null, false).phase, 'stopped');
});

test('decision-cycle wake state coalesces diagnostics without becoming an event history', () => {
  const cycle = createResidentDecisionCycle(() => 1);
  cycle.queueWake({ kind: 'timer' });
  cycle.queueWake({
    kind: 'world_event',
    type: 'self_hurt',
    sequence: 9,
    salience: 'urgent',
  });

  assert.deepEqual(cycle.snapshot(null, false).queuedWake, {
    kind: 'world_event',
    type: 'self_hurt',
    sequence: 9,
    salience: 'urgent',
  });
  assert.equal(cycle.takeQueuedWake()?.kind, 'world_event');
  assert.equal(cycle.snapshot(null, true).queuedWake, null);
  assert.equal(cycle.snapshot(null, true).waitingFor, 'fixed_slot');
});
