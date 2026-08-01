import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyResidentLensEvent,
  createResidentLensState,
  foldResidentLens,
  type RunJournalEvent,
} from '../src/observability/resident-lens';

test('resident lens folds the safe causal path without exposing private controller frames', () => {
  const phaseChange = {
    sequence: 10,
    type: 'day_phase_changed',
    data: { previous: 'day', current: 'night' },
  };
  const observation = { ...humanObservation(10, 'before'), events: [phaseChange] };
  const nextObservation = {
    ...humanObservation(11, 'after'),
    events: [
      phaseChange,
      {
        sequence: 11,
        type: 'chat_received',
        data: { sender: 'Neighbor', message: 'hello' },
      },
    ],
  };
  const privateObservation = { secret: 'private-before' };
  const privateNextObservation = { secret: 'private-after' };
  const events: RunJournalEvent[] = [
    event(1, 'run_started', {
      runId: 'run-1',
      body: { username: 'ScoutBody' },
      controller: { paused: false },
    }),
    event(2, 'resident_decision_opportunity', {
      opportunityId: 'opp-1',
      phase: 'scheduled',
      at: 1_000,
    }),
    event(3, 'resident_decision_opportunity', {
      opportunityId: 'opp-1',
      phase: 'terminal',
      terminal: 'success',
      at: 1_375,
    }),
    event(4, 'model_turn', {
      observation,
      assistant: { content: 'I will test the stone.' },
      intent: {
        id: 'intent-1',
        tool: 'dig_block',
        input: { target: 'stone ahead' },
        source: 'llm',
      },
    }),
    event(5, 'intent_enqueued', {
      intent: { id: 'intent-1', tool: 'dig_block', input: {}, source: 'llm' },
    }),
    event(
      6,
      'action_started',
      { intent: { id: 'intent-1', tool: 'dig_block', input: {}, source: 'llm' } },
      1_500,
    ),
    event(7, 'action_completed', {
      intent: { id: 'intent-1', tool: 'dig_block' },
      result: { ok: true, changed: 'stone became air' },
    }),
    event(8, 'entity_turn', {
      protocol: 'behold.entity-turn.v1',
      id: 'Scout:turn:41',
      sequence: 41,
      parentId: 'Scout:turn:40',
      observation: privateObservation,
      nextObservation: privateNextObservation,
      observationPresentation: {
        protocol: 'behold.entity-turn-observation-presentation.v1',
        bodyProfile: 'minecraft-human-semantic-v1',
        observation,
        nextObservation,
      },
      utterance: { assistant: { content: 'I will test the stone.' } },
      action: {
        id: 'intent-1',
        name: 'dig_block',
        input: { target: 'stone ahead' },
        source: 'llm',
      },
      outcome: {
        ok: true,
        eventType: 'action_completed',
        result: {
          ok: true,
          changes: [
            {
              verb: 'dig',
              before: 'stone',
              after: 'air',
              verified: true,
              observed: true,
              confirmation: { source: 'mineflayer:blockUpdate', observedAt: 1_700 },
            },
          ],
        },
      },
    }),
  ];

  const deciding = foldResidentLens(events.slice(0, 2));
  assert.equal(deciding.phase, 'deciding');

  const acting = foldResidentLens(events.slice(0, 6));
  assert.equal(acting.phase, 'acting');
  assert.deepEqual(acting.doing, {
    intentId: 'intent-1',
    name: 'dig_block',
    status: 'started',
    startedAt: 1_500,
  });

  const chosen = foldResidentLens(events.slice(0, 4));
  assert.equal(chosen.phase, 'chosen');

  const state = foldResidentLens(events);
  assert.equal(state.runId, 'run-1');
  assert.equal(state.entityId, 'Scout');
  assert.equal(state.bodyUsername, 'ScoutBody');
  assert.equal(state.decision.latencyMs, 375);
  assert.equal(state.sees?.scene?.summary, 'before');
  assert.equal(state.chooses?.name, 'dig_block');
  assert.equal(state.consequence?.committedToLync, true);
  assert.equal(state.nextExperience?.scene?.summary, 'after');
  assert.deepEqual(state.bodyCondition, {
    value: { health: 19, food: 18 },
    observedAt: 11,
  });
  assert.deepEqual(state.lync, {
    committedTurns: 1,
    tipId: 'Scout:turn:41',
    tipSequence: 41,
    parentId: 'Scout:turn:40',
    committedAt: new Date(8_000).toISOString(),
  });
  assert.deepEqual(state.ethogram.decisions, {
    scheduled: 1,
    terminals: { success: 1 },
    latencyMs: { count: 1, total: 375, min: 375, max: 375, last: 375 },
  });
  assert.deepEqual(state.ethogram.actions, {
    committed: 1,
    succeeded: 1,
    failed: 0,
    byName: { dig_block: 1 },
  });
  assert.deepEqual(state.ethogram.perceivedEvents, {
    total: 1,
    byType: { day_phase_changed: 1 },
  });
  assert.deepEqual(state.ethogram.verifiedWorldChanges, {
    total: 1,
    byVerb: { dig: 1 },
  });
  assert.equal(state.ethogram.recent.length, 2);
  assert.equal(state.ethogram.recent[0].kind, 'perceived_event');
  assert.equal(state.ethogram.recent[0].type, 'day_phase_changed');
  assert.equal(state.ethogram.recent[1].kind, 'verified_world_change');
  assert.equal(JSON.stringify(state).includes('private-before'), false);
  assert.equal(JSON.stringify(state).includes('private-after'), false);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.nextExperience));
});

test('resident lens counts a terminal world event only when a later decision perceives it', () => {
  const phaseChange = {
    sequence: 10,
    type: 'day_phase_changed',
    data: { previous: 'day', current: 'night' },
  };
  const chat = {
    sequence: 11,
    type: 'chat_received',
    data: { sender: 'Neighbor', message: 'hello' },
  };
  const state = foldResidentLens([
    event(1, 'entity_turn', {
      id: 'Scout:turn:1',
      sequence: 1,
      parentId: null,
      observationPresentation: {
        protocol: 'behold.entity-turn-observation-presentation.v1',
        bodyProfile: 'minecraft-human-semantic-v1',
        observation: { ...humanObservation(10, 'before'), events: [phaseChange] },
        nextObservation: { ...humanObservation(11, 'terminal'), events: [chat] },
      },
      action: { id: 'wait-1', name: 'wait_for_event', input: {}, source: 'llm' },
      outcome: { ok: true, eventType: 'wait_for_event', result: { status: 'waiting' } },
    }),
    event(2, 'entity_turn', {
      id: 'Scout:turn:2',
      sequence: 2,
      parentId: 'Scout:turn:1',
      observationPresentation: {
        protocol: 'behold.entity-turn-observation-presentation.v1',
        bodyProfile: 'minecraft-human-semantic-v1',
        observation: { ...humanObservation(11, 'later'), events: [chat] },
        nextObservation: { ...humanObservation(11, 'terminal-again'), events: [chat] },
      },
      action: { id: 'wait-2', name: 'wait_for_event', input: {}, source: 'llm' },
      outcome: { ok: true, eventType: 'wait_for_event', result: { status: 'waiting' } },
    }),
  ]);

  assert.deepEqual(state.ethogram.perceivedEvents, {
    total: 2,
    byType: { day_phase_changed: 1, chat_received: 1 },
  });
});

test('resident lens marks unsafe and missing projections unavailable instead of using raw frames', () => {
  const state = foldResidentLens([
    event(1, 'run_started', { runId: 'run-2', body: { username: 'ScoutBody' } }),
    event(3, 'model_turn', {
      observation: { protocol: 'private-controller-frame', secret: 'model-private' },
      intent: { id: 'intent-2', tool: 'look', input: {}, source: 'llm' },
    }),
    event(4, 'entity_turn', {
      observation: { secret: 'turn-private' },
      nextObservation: { secret: 'next-private' },
      action: { id: 'intent-2', name: 'look', input: {}, source: 'llm' },
      outcome: { ok: true, eventType: 'action_completed', result: { ok: true } },
    }),
  ]);

  assert.equal(state.sees, null);
  assert.equal(state.nextExperience, null);
  assert.match(state.unavailable.journal ?? '', /sequence gap/);
  assert.match(state.unavailable.sees ?? '', /safe human-semantic observation/);
  assert.match(state.unavailable.nextExperience ?? '', /safe human-semantic/);
  assert.equal(JSON.stringify(state).includes('model-private'), false);
  assert.equal(JSON.stringify(state).includes('turn-private'), false);
  assert.equal(JSON.stringify(state).includes('next-private'), false);
});

test('resident lens distinguishes resident waiting and process stop', () => {
  const observation = humanObservation(20, 'quiet');
  let state = foldResidentLens([
    event(1, 'run_started', { runId: 'run-3', body: { username: 'ScoutBody' } }),
    event(2, 'entity_turn', {
      observationPresentation: {
        protocol: 'behold.entity-turn-observation-presentation.v1',
        bodyProfile: 'minecraft-human-semantic-v1',
        observation,
        nextObservation: observation,
      },
      utterance: { assistant: { content: 'I will wait.' } },
      action: { id: 'wait-1', name: 'wait_for_event', input: {}, source: 'llm' },
      outcome: { ok: true, eventType: 'wait_for_event', result: { status: 'waiting' } },
    }),
  ]);
  assert.equal(state.phase, 'waiting');

  state = applyResidentLensEvent(state, event(3, 'run_stopping', { reason: 'owner_stop' }));
  assert.equal(state.phase, 'stopping');
  state = applyResidentLensEvent(state, event(4, 'run_stopped', { drained: true }));
  assert.equal(state.phase, 'stopped');
});

test('resident lens ignores malformed and replayed envelopes', () => {
  const initial = createResidentLensState();
  const malformed = applyResidentLensEvent(initial, {} as RunJournalEvent);
  assert.equal(malformed, initial);
  const started = applyResidentLensEvent(
    initial,
    event(1, 'run_started', { runId: 'run-4', body: { username: 'ScoutBody' } }),
  );
  assert.equal(applyResidentLensEvent(started, event(1, 'run_stopped', {})), started);
});

function event(sequence: number, type: string, data: any, engineAt?: number): RunJournalEvent {
  return {
    sequence,
    at: new Date(sequence * 1_000).toISOString(),
    ...(engineAt === undefined ? {} : { engineAt }),
    agent: 'Scout',
    type,
    data,
  };
}

function humanObservation(observedAt: number, summary: string) {
  return {
    protocol: 'behold.minecraft-human-semantic-observation.v1',
    bodyContract: { profile: 'minecraft-human-semantic-v1' },
    observedAt,
    self: { condition: { health: 19, food: 18 } },
    scene: { summary },
  };
}
