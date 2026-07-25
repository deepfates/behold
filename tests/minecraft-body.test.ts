import assert from 'node:assert/strict';
import test from 'node:test';
import { minecraftActionsForProfile } from '../src/agent/action-profiles';
import type { EntityTurn } from '../src/entity/loom';
import type { ResidentMind, ResidentMindRequest } from '../src/mind/interface';
import {
  HUMAN_SEMANTIC_OBSERVATION_PROTOCOL,
  projectHumanSemanticObservation,
} from '../src/mind/minecraft-body';
import { startLLMPolicy } from '../src/policy/llm';

const FORBIDDEN_KEYS = new Set([
  'id',
  'uuid',
  'managedRunId',
  'circleId',
  'position',
  'coordinates',
  'x',
  'y',
  'z',
  'yaw',
  'pitch',
  'velocity',
  'distance',
  'maxDistance',
  'pickupGround',
  'support',
  'uses',
  'projects',
  'places',
  'placeConflicts',
  'currentAction',
  'task',
  'observedAt',
  'at',
]);

test('human-semantic observation retains ordinary perception and removes oracle state', () => {
  const projected = projectHumanSemanticObservation(rawObservation());

  assert.equal(projected.protocol, HUMAN_SEMANTIC_OBSERVATION_PROTOCOL);
  assert.equal(projected.bodyContract.profile, 'minecraft-human-semantic-v1');
  assert.deepEqual(projected.self.inventory, [{ name: 'oak_log', count: 3 }]);
  assert.deepEqual(projected.scene.focus, {
    reference: 'focus',
    kind: 'block',
    name: 'oak_log',
    source: 'crosshair',
    proximity: 'interaction',
  });
  assert.deepEqual(projected.scene.entities[0], {
    reference: 'visible-entity-1',
    kind: 'player',
    name: 'Alex',
    heldItem: 'stick',
    proximity: 'nearby',
    relativeDirection: 'front-left',
    visibility: 'visible',
  });
  assert.equal(projected.scene.terrain.visualField.materialRows[0], 'OT');
  assert.equal(projected.events[0].data.target, 'focused-block');
  assert.equal(projected.task, undefined);
  assertNoForbiddenKeys(projected);

  const text = JSON.stringify(projected);
  assert.doesNotMatch(text, /world-secret|entity:491|block:overworld:12:64:-9/);
  assert.doesNotMatch(text, /"(?:x|y|z)":(?:12|64|-9)/);
});

test('human-semantic action profile is a frozen cursor and key-control surface', () => {
  const candidates = [
    'chat',
    'look_direction',
    'move_controls',
    'attack_focused_entity',
    'dig_focused_block',
    'move_to',
    'approach_entity',
    'attack_entity',
    'collect_nearby_item',
    'craft_item',
    'manage_project',
  ].map(tool);

  assert.deepEqual(
    minecraftActionsForProfile(candidates, 'minecraft-human-semantic-v1').map(
      (candidate) => candidate.function.name,
    ),
    ['chat', 'look_direction', 'move_controls', 'attack_focused_entity', 'dig_focused_block'],
  );
});

test('a human-semantic mind request cannot recover raw current or legacy body evidence', async () => {
  let request!: Readonly<ResidentMindRequest>;
  let received!: () => void;
  const receivedRequest = new Promise<void>((resolve) => (received = resolve));
  const mind: ResidentMind = {
    id: 'capture-human-semantic-request',
    decide: async (candidate) => {
      request = candidate;
      received();
      return {
        protocol: 'behold.mind-decision.v1',
        disposition: 'wait',
        utterance: null,
        action: null,
        call: modelCallEvidence(),
      };
    },
  };
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [tool('look_direction')],
      attempt: () => assert.fail('the capturing mind yielded'),
      observe: () => rawObservation(),
    },
    {
      apiKey: 'unused',
      model: 'test/model',
      mind,
      policyProfile: 'neutral-benchmark-v1',
      bodyProfile: 'minecraft-human-semantic-v1',
      actionProfile: 'minecraft-human-semantic-v1',
      safetyProfile: 'vanilla-player-v1',
      history: [legacyTurn()],
      maxTurnSteps: 1,
      acceptEngineEvent: () => true,
    },
  );

  try {
    await policy.tick();
    await receivedRequest;
    assert.equal(request.bodyProfile, 'minecraft-human-semantic-v1');
    assert.equal((request.observation as any).protocol, HUMAN_SEMANTIC_OBSERVATION_PROTOCOL);
    assert.deepEqual(
      request.actions.map((action) => action.name),
      ['look_direction', 'wait_for_event'],
    );
    assert.equal(request.requiredAction, null);
    assertNoForbiddenKeys(request.observation);

    const wire = JSON.stringify(request);
    assert.doesNotMatch(wire, /world-secret|legacy-oracle-secret|entity:491/);
    assert.doesNotMatch(wire, /block:overworld:12:64:-9/);
  } finally {
    await policy.stop();
  }
});

test('body and action profiles fail closed when their semantic contracts do not match', () => {
  assert.throws(
    () =>
      startLLMPolicy(
        {
          entityId: 'Scout',
          actions: [],
          attempt: () => false,
          observe: () => rawObservation(),
        },
        {
          apiKey: 'unused',
          model: 'test/model',
          policyProfile: 'neutral-benchmark-v1',
          bodyProfile: 'minecraft-human-semantic-v1',
          actionProfile: 'minecraft-player-v1',
          acceptEngineEvent: () => true,
        },
      ),
    /must be paired with its matching action profile/,
  );
});

function rawObservation() {
  return {
    protocol: 'behold.inhabitant.v2',
    circle: { id: 'world-secret', managedRunId: 'run-secret', substrate: 'minecraft' },
    sequence: 9,
    observedAt: 1_700_000_000_000,
    eventWindow: { requestedAfterSequence: 0, complete: true },
    task: { id: 'forced-project', goal: 'build the demo' },
    self: {
      identity: 'Scout',
      body: { username: 'ScoutBot', uuid: '123e4567-e89b-12d3-a456-426614174000' },
      pose: {
        position: { x: 12, y: 64, z: -9 },
        yaw: 1.2,
        pitch: -0.4,
        velocity: { x: 0.1, y: 0, z: 0 },
        onGround: true,
      },
      condition: {
        health: 18,
        food: 16,
        oxygen: 20,
        sleeping: false,
        dimension: 'overworld',
        isDay: true,
      },
      heldItem: 'oak_log',
      inventory: [{ name: 'oak_log', count: 3, uses: ['place', 'craft'] }],
      projects: [{ id: 'project-secret' }],
      places: [{ id: 'place-secret', protectedBodyCells: [{ x: 1, y: 2, z: 3 }] }],
      placeConflicts: [{ id: 'conflict-secret' }],
      currentAction: { id: 'action-secret', tool: 'move_to' },
    },
    scene: {
      social: { playersOnline: ['Alex'], source: 'server_roster' },
      focus: {
        id: 'block:overworld:12:64:-9',
        kind: 'block',
        name: 'oak_log',
        position: { x: 12, y: 64, z: -9 },
        distance: 3.2,
        pickupGround: { status: 'supported' },
      },
      entities: [
        {
          id: 'entity:491',
          uuid: '123e4567-e89b-12d3-a456-426614174001',
          kind: 'player',
          name: 'Alex',
          heldItem: 'stick',
          position: { x: 8, y: 64, z: -5 },
          distance: 7,
          relativeDirection: 'front-left',
          pickupGround: { status: 'hazard' },
        },
      ],
      terrain: {
        maxDistance: 32,
        targets: [{ id: 'block:overworld:12:64:-9', position: { x: 12, y: 64, z: -9 } }],
        nearest: { water: { x: 11, y: 63, z: -9 } },
        visualField: {
          protocol: 'behold.semantic-visual-field.v1',
          available: true,
          dimensions: { rows: 1, columns: 2 },
          rowOrder: 'top-to-bottom',
          columnOrder: 'left-to-right',
          materialRows: ['OT'],
          depthRows: ['12'],
          materialLegend: [
            { symbol: 'O', name: 'oak_log' },
            { symbol: 'T', name: 'torch' },
          ],
          depthLegend: [{ symbol: '1', label: 'interaction' }],
          noHitSymbol: '.',
          unavailableSymbol: '?',
          center: { row: 0, column: 1 },
        },
      },
    },
    events: [
      {
        sequence: 9,
        at: 1_700_000_000_000,
        type: 'action_failed',
        salience: 'high',
        source: 'controller',
        isNew: true,
        data: {
          id: 'event-secret',
          target: 'block:overworld:12:64:-9',
          position: { x: 12, y: 64, z: -9 },
          requestedDestination: { x: 99, y: 70, z: 99 },
        },
      },
    ],
  };
}

function legacyTurn(): EntityTurn {
  return {
    protocol: 'behold.entity-turn.v1',
    id: 'Scout:turn:1',
    entityId: 'Scout',
    sequence: 1,
    parentId: null,
    model: 'test/model',
    startedAt: 1,
    completedAt: 2,
    observation: rawObservation(),
    utterance: {
      assistant: {
        role: 'assistant',
        content: 'legacy-oracle-secret',
        tool_calls: [],
      },
    },
    action: {
      id: 'legacy-action',
      name: 'look_direction',
      input: { target: 'entity:491' },
      source: 'llm',
      kind: 'exclusive',
      toolCallId: null,
    },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: { position: { x: 12, y: 64, z: -9 }, secret: 'legacy-oracle-secret' },
    },
    nextObservation: rawObservation(),
  };
}

function tool(name: string) {
  return {
    type: 'function' as const,
    function: {
      name,
      description: name,
      parameters: { type: 'object', properties: {} },
    },
  };
}

function assertNoForbiddenKeys(value: unknown) {
  visit(value, (key) => assert.equal(FORBIDDEN_KEYS.has(key), false, `forbidden key ${key}`));
}

function visit(value: unknown, check: (key: string) => void) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) visit(item, check);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    check(key);
    visit(item, check);
  }
}

function modelCallEvidence() {
  return {
    protocol: 'behold.model-call.v1' as const,
    requestId: 'human-semantic-test-call',
    endpoint: 'test://mind',
    startedAt: 1,
    completedAt: 2,
    latencyMs: 1,
    adapter: { name: 'human-semantic-test' },
    request: {
      model: 'test/model',
      messageCount: 1,
      toolCount: 1,
      toolChoice: null,
      bodySha256: '0'.repeat(64),
      messagesSha256: '1'.repeat(64),
      toolsSha256: '2'.repeat(64),
      kind: 'mind_input' as const,
    },
    response: {
      id: null,
      model: 'test/model',
      provider: 'test',
      finishReason: 'test',
      nativeFinishReason: null,
      usage: null,
    },
  };
}
