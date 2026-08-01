import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHabitatLensEvent,
  createHabitatLensState,
  foldHabitatLens,
  type HabitatLifecycleEvent,
} from '../src/observability/habitat-lens';

test('habitat lens folds authoritative lifecycle health without inventing runtime state', () => {
  const state = foldHabitatLens([
    event(1, 'control_acquired', {
      owner: { world: 'world-1', state: 'stopped_verified' },
    }),
    event(2, 'run_configured', {
      runId: 'world-1-7',
      world: { id: 'world-1' },
      population: { residents: [{ entityId: 'Elm' }, { entityId: 'Pine' }] },
    }),
    event(3, 'server_ready', { pid: 400 }),
    event(4, 'controller_ready', { entityId: 'Elm' }),
    event(5, 'controller_ready', { entityId: 'Pine' }),
    event(6, 'resident_release_observed', { entityId: 'Elm' }),
    event(7, 'resident_release_observed', { entityId: 'Pine' }),
    event(8, 'run_ready', { serverPid: 400 }),
    event(9, 'resident_cognition_control_requested', { state: 'paused' }),
    event(10, 'resident_cognition_control_acknowledged', { state: 'paused' }),
    event(11, 'resident_cognition_control_requested', { state: 'running' }),
    event(12, 'resident_cognition_control_acknowledged', { state: 'running' }),
    event(13, 'run_stopping', { reason: 'owner_stop' }),
    event(14, 'residents_stopped', { residentCount: 2 }),
    event(15, 'server_save_acknowledged', {}),
    event(16, 'server_stopped', {}),
    event(17, 'run_terminal_world_state', { tree: { digest: 'world-digest' } }),
    event(18, 'run_stopped', { reason: 'owner_stop' }),
  ]);

  assert.equal(state.worldId, 'world-1');
  assert.equal(state.runId, 'world-1-7');
  assert.equal(state.phase, 'stopped');
  assert.deepEqual(state.population, {
    configured: ['Elm', 'Pine'],
    ready: ['Elm', 'Pine'],
    released: ['Elm', 'Pine'],
    stopped: 2,
  });
  assert.deepEqual(state.server, {
    pid: 400,
    ready: true,
    saveAcknowledged: true,
    stopped: true,
  });
  assert.deepEqual(state.cognition, {
    state: 'running',
    requested: null,
    at: new Date(12_000).toISOString(),
    error: null,
  });
  assert.deepEqual(state.terminal, {
    reason: 'owner_stop',
    worldDigest: 'world-digest',
    error: null,
  });
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.population));
});

test('habitat lens exposes lifecycle gaps and ignores replayed envelopes', () => {
  const initial = createHabitatLensState();
  const started = applyHabitatLensEvent(
    initial,
    event(2, 'run_configured', {
      runId: 'run-2',
      world: { id: 'world-2' },
      population: { residents: [] },
    }),
  );
  assert.match(started.unavailable.lifecycle ?? '', /sequence gap/);
  assert.equal(applyHabitatLensEvent(started, event(2, 'run_ready', {})), started);
});

function event(sequence: number, type: string, data: any): HabitatLifecycleEvent {
  return {
    sequence,
    at: new Date(sequence * 1_000).toISOString(),
    type,
    data,
  };
}
