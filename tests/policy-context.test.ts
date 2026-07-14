import assert from 'node:assert/strict';
import test from 'node:test';
import { historyMessages, type EntityTurn } from '../src/entity/loom';
import {
  projectCurrentModelObservation,
  projectHistoricalModelObservation,
} from '../src/policy/context';

test('model context suppresses only duplicated own-success lifecycle events without skipping them', () => {
  const frame = observation();
  const projected = projectCurrentModelObservation(frame);

  assert.equal(projected.task.goal, 'Finish the landmark');
  assert.equal(projected.self.identity, 'Scout');
  assert.deepEqual(projected.self.inventory, [{ name: 'cobblestone', count: 1 }]);
  assert.equal(projected.self.projects[0].nextStep, 'Place the second block at 1,-60,0');
  assert.equal(projected.self.currentAction.source, 'llm');
  assert.deepEqual(projected.self.currentAction.input, { x: 0, y: -60, z: 0 });
  assert.equal(projected.self.currentAction.result, undefined);
  assert.equal(projected.self.currentAction.resultOmittedFromWorkingContext, true);

  assert.deepEqual(
    projected.events.map((event: any) => event.type),
    [
      'spawned',
      'block_changed_nearby',
      'inventory_changed',
      'action_failed',
      'action_completed',
      'chat_received',
    ],
  );
  assert.equal(projected.events[4].data.intent.source, 'human');
  assert.equal(projected.eventWindow.deliveredOldestSequence, 1);
  assert.equal(projected.eventWindow.deliveredNewestSequence, 12);
  assert.equal(projected.eventWindow.omittedNewEvents, 2);
  assert.equal(projected.eventWindow.suppressedControllerEvents, 6);
  assert.deepEqual(projected.eventWindow.suppressedControllerEventTypes, {
    intent_enqueued: 1,
    intent_selected: 1,
    permission_decision: 1,
    action_started: 1,
    tool_result: 1,
    action_completed: 1,
  });
  assert.equal(projected.eventWindow.complete, false);
});

test('historical frames retain causal state and events without replaying whole world snapshots', () => {
  const projected = projectHistoricalModelObservation(observation());

  assert.equal(projected.task, undefined);
  assert.deepEqual(projected.historicalProjection, {
    source: 'authoritative_entity_turn',
    mode: 'causal_delta',
    previous: null,
  });
  assert.equal(projected.circle.id, 'world-one');
  assert.equal(projected.circle.managedRunId, 'world-one-2');
  assert.equal(projected.self.identity, 'Scout');
  assert.deepEqual(projected.self.inventory, [{ name: 'cobblestone', count: 1 }]);
  assert.equal(projected.self.projects[0].id, 'marker');
  assert.equal(projected.self.currentAction, undefined);
  assert.equal(projected.scene, undefined);
  assert.deepEqual(
    projected.events.map((event: any) => event.type),
    [
      'spawned',
      'block_changed_nearby',
      'inventory_changed',
      'action_failed',
      'action_completed',
      'chat_received',
    ],
  );
  assert.equal(projected.eventWindow.missingBeforeOldest, 3);
  assert.equal(projected.eventWindow.omittedNewEvents, 2);
});

test('later historical frames retain self changes and omit only state identical to the prior result', () => {
  const previous: any = observation();
  previous.self.pose = {
    position: { x: 0, y: 64, z: 0 },
    onGround: true,
    velocity: { x: 0, y: 0, z: 0 },
  };
  previous.self.condition = { health: 20, food: 18 };
  previous.self.heldItem = null;

  const current = structuredClone(previous);
  current.sequence = 15;
  current.self.pose.position = { x: 3, y: 64, z: 0 };
  current.self.heldItem = { name: 'wooden_pickaxe', count: 1 };
  current.events = [event(15, 'inventory_changed', { added: ['wooden_pickaxe'] })];

  const projected = projectHistoricalModelObservation(current, previous);
  assert.deepEqual(projected.self, {
    identity: 'Scout',
    pose: { position: { x: 3, y: 64, z: 0 } },
    heldItem: { name: 'wooden_pickaxe', count: 1 },
  });
  assert.equal(projected.self.condition, undefined);
  assert.equal(projected.self.inventory, undefined);
  assert.equal(projected.self.projects, undefined);
  assert.deepEqual(projected.historicalProjection, {
    source: 'authoritative_entity_turn',
    mode: 'causal_delta',
    previous: 'previous_turn_next_observation',
  });
  assert.equal(projected.events[0].type, 'inventory_changed');
});

test('an unchanged historical frame has a bounded causal replay', () => {
  const previous: any = observation();
  const current = structuredClone(previous);
  current.sequence = 15;
  current.observedAt += 1_000;
  current.events = [];
  current.eventWindow = {
    requestedAfterSequence: 12,
    oldestAvailableSequence: 1,
    newestAvailableSequence: 15,
    missingBeforeOldest: 0,
    complete: true,
    deliveredOldestSequence: 13,
    deliveredNewestSequence: 15,
    omittedNewEvents: 0,
    suppressedControllerEvents: 6,
    suppressedControllerEventTypes: { action_started: 1, action_completed: 1 },
  };

  const projected = projectHistoricalModelObservation(current, previous);
  assert.deepEqual(projected.eventWindow, {
    complete: true,
    missingBeforeOldest: 0,
    omittedNewEvents: 0,
  });
  assert.deepEqual(projected.self, { identity: 'Scout' });
  assert.ok(Buffer.byteLength(JSON.stringify(projected), 'utf8') < 500);
});

test('current task projection removes only exact duplicate and empty envelope fields', () => {
  const frame: any = observation();
  frame.task = {
    id: 'Build the landmark exactly as observed',
    goal: 'Build the landmark exactly as observed',
    successConditions: [],
    constraints: ['Remain near spawn'],
    target: null,
  };

  assert.deepEqual(projectCurrentModelObservation(frame).task, {
    goal: 'Build the landmark exactly as observed',
    constraints: ['Remain near spawn'],
  });

  frame.task.id = 'landmark-v1';
  assert.equal(projectCurrentModelObservation(frame).task.id, 'landmark-v1');
});

test('current body orientation is player-scale rather than raw angles', () => {
  const frame: any = observation();
  frame.self.pose = {
    position: { x: 1, y: 64, z: 2 },
    yaw: Math.PI / 2,
    pitch: -Math.PI / 6,
    velocity: { x: 0, y: 0, z: 0 },
    onGround: true,
  };

  const pose = projectCurrentModelObservation(frame).self.pose;
  assert.deepEqual(pose.orientation, { facing: 'west', vertical: 'down' });
  assert.equal(pose.yaw, undefined);
  assert.equal(pose.pitch, undefined);
  assert.deepEqual(pose.position, { x: 1, y: 64, z: 2 });
});

test('protocol tool history retains exact consequences removed from duplicate observations', () => {
  const frame = observation();
  const turn: EntityTurn = {
    protocol: 'behold.entity-turn.v1',
    id: 'Scout:turn:1',
    entityId: 'Scout',
    sequence: 1,
    parentId: null,
    model: 'test/model',
    startedAt: 10,
    completedAt: 20,
    observation: frame,
    utterance: {
      assistant: {
        role: 'assistant',
        tool_calls: [
          {
            id: 'place-call',
            type: 'function',
            function: {
              name: 'place_block',
              arguments: '{"x":0,"y":-60,"z":0}',
            },
          },
        ],
      },
    },
    action: {
      id: 'place-intent',
      name: 'place_block',
      input: { x: 0, y: -60, z: 0 },
      source: 'llm',
      kind: 'exclusive',
      toolCallId: 'place-call',
    },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: {
        ok: true,
        changes: [
          {
            verb: 'place',
            position: { x: 0, y: -60, z: 0 },
            after: 'cobblestone',
            verified: true,
            confirmation: { source: 'mineflayer:blockUpdate' },
          },
        ],
      },
    },
    nextObservation: frame,
  };

  const messages = historyMessages([turn], projectHistoricalModelObservation);
  const historicalFrame = String(messages[0].content);
  const toolOutcome = String(messages[2].content);
  assert.equal(historicalFrame.includes('mineflayer:blockUpdate'), false);
  assert.equal(historicalFrame.includes('Finish the landmark'), false);
  assert.match(toolOutcome, /mineflayer:blockUpdate/);
  assert.match(toolOutcome, /"x":0,"y":-60,"z":0/);
  assert.match(toolOutcome, /"verified":true/);
});

test('failed current actions remain visible instead of being compacted into success', () => {
  const frame: any = observation();
  frame.self.currentAction.result = {
    ok: false,
    error: 'placement_target_occupied',
    reason: 'Choose another cell',
    secretDebugState: 'must not enter working context',
  };
  const projected = projectCurrentModelObservation(frame);

  assert.deepEqual(projected.self.currentAction.result, {
    ok: false,
    error: 'placement_target_occupied',
    reason: 'Choose another cell',
    status: null,
  });
  assert.equal(JSON.stringify(projected).includes('secretDebugState'), false);
});

function observation() {
  const ownIntent = {
    id: 'place-intent',
    source: 'llm',
    tool: 'place_block',
    input: { x: 0, y: -60, z: 0 },
  };
  const events = [
    event(1, 'spawned', {}),
    event(2, 'intent_enqueued', { intent: ownIntent }),
    event(3, 'intent_selected', { intent: ownIntent }),
    event(4, 'permission_decision', { intent: ownIntent, authorization: { ok: true } }),
    event(5, 'action_started', { intent: ownIntent }),
    event(6, 'tool_result', {
      intent: ownIntent,
      result: {
        changes: [
          {
            position: { x: 0, y: -60, z: 0 },
            confirmation: { source: 'mineflayer:blockUpdate' },
          },
        ],
      },
    }),
    event(7, 'action_completed', { intent: ownIntent, result: { ok: true } }),
    event(8, 'block_changed_nearby', {
      position: { x: 0, y: -60, z: 0 },
      before: 'air',
      after: 'cobblestone',
    }),
    event(9, 'inventory_changed', {
      removed: [{ name: 'cobblestone', count: 1 }],
    }),
    event(10, 'action_failed', {
      intent: { ...ownIntent, id: 'failed-intent' },
      error: 'placement_target_occupied',
    }),
    event(11, 'action_completed', {
      intent: { id: 'human-action', source: 'human', tool: 'move_to', input: { x: 2 } },
      result: { ok: true },
    }),
    event(12, 'chat_received', { from: 'Alex', text: 'I saw the first block.' }),
    event(13, 'world_event', { name: 'later-one' }),
    event(14, 'world_event', { name: 'later-two' }),
  ];
  return {
    protocol: 'behold.inhabitant.v1',
    circle: { id: 'world-one', managedRunId: 'world-one-2' },
    sequence: 14,
    observedAt: 100,
    eventWindow: {
      requestedAfterSequence: 0,
      oldestAvailableSequence: 4,
      newestAvailableSequence: 14,
      missingBeforeOldest: 3,
      complete: true,
    },
    task: { id: 'landmark', goal: 'Finish the landmark' },
    self: {
      identity: 'Scout',
      inventory: [{ name: 'cobblestone', count: 1 }],
      projects: [
        {
          id: 'marker',
          nextStep: 'Place the second block at 1,-60,0',
        },
      ],
      currentAction: {
        id: 'place-intent',
        tool: 'place_block',
        source: 'llm',
        input: { x: 0, y: -60, z: 0 },
        status: 'completed',
        result: {
          ok: true,
          changes: [
            {
              position: { x: 0, y: -60, z: 0 },
              confirmation: { source: 'mineflayer:blockUpdate' },
            },
          ],
        },
      },
    },
    scene: { entities: [] },
    events,
  };
}

function event(sequence: number, type: string, data: any) {
  return { sequence, type, data, isNew: true };
}
