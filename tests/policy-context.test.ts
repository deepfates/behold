import assert from 'node:assert/strict';
import test from 'node:test';
import { historyMessages, type EntityTurn } from '../src/entity/loom';
import {
  projectCurrentModelObservation,
  projectHistoricalModelObservation,
  projectRecentActionContinuity,
  projectResidentFactualContinuity,
  projectResidentWorkingContinuity,
} from '../src/policy/context';
import { residentTurnMayReplay } from '../src/mind/resident-visibility';
import { projectHumanSemanticValue } from '../src/mind/minecraft-body';
import { residentContinuityCoverageNotice } from '../src/policy/llm';

test('bounded resident memory states the exact seam between a fold and recent continuity', () => {
  const continuity = {
    protocol: 'behold.resident-working-continuity.v1',
    source: { fromTurn: 1402 },
  } as any;

  assert.equal(
    residentContinuityCoverageNotice(
      { content: 'Folded view of your own loom, turns 1-1391.\nNon-authoritative.' },
      continuity,
    ),
    'Bounded memory coverage: turns 1392-1401 are not represented in this request; the full own Lync remains canonical.',
  );
  assert.equal(
    residentContinuityCoverageNotice(
      { content: 'Folded view of your own loom, turns 1-1401.\nNon-authoritative.' },
      continuity,
    ),
    null,
  );
});

test('model context suppresses only duplicated own-success lifecycle events without skipping them', () => {
  const frame = observation();
  const projected = projectCurrentModelObservation(frame);

  assert.equal(projected.task.goal, 'Finish the landmark');
  assert.equal(projected.self.identity, 'Scout');
  assert.deepEqual(projected.self.inventory, [{ name: 'cobblestone', count: 1 }]);
  assert.equal(projected.self.projects[0].nextStep, 'Place the second block at 1,-60,0');
  assert.equal(projected.self.projects[0].status, 'active_unfinished');
  assert.equal(projected.self.projects[0].completionRequires, 'space_enclosed');
  assert.equal(projected.self.projects[0].evidence, undefined);
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
      'world_event',
      'world_event',
    ],
  );
  assert.equal(projected.events[4].data.intent.source, 'human');
  assert.equal(projected.eventWindow.deliveredOldestSequence, 1);
  assert.equal(projected.eventWindow.deliveredNewestSequence, 14);
  assert.equal(projected.eventWindow.omittedNewEvents, 0);
  assert.equal(projected.eventWindow.suppressedControllerEvents, 6);
  assert.deepEqual(projected.eventWindow.suppressedControllerEventTypes, {
    intent_enqueued: 1,
    intent_selected: 1,
    permission_decision: 1,
    action_started: 1,
    tool_result: 1,
    action_completed: 1,
  });
  assert.equal(projected.eventWindow.complete, true);
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
      'world_event',
      'world_event',
    ],
  );
  assert.equal(projected.eventWindow.missingBeforeOldest, 3);
  assert.equal(projected.eventWindow.omittedNewEvents, 0);
});

test('repetitive ordinary sounds cannot crowd later lived changes out of a causal batch', () => {
  const frame: any = observation();
  const sounds = Array.from({ length: 24 }, (_, index) => ({
    sequence: index + 1,
    at: 1_000 + index * 800,
    type: 'sound_heard',
    salience: 'normal',
    source: 'sound',
    isNew: true,
    data: {
      sound: 'block.stone_pressure_plate.click_on',
      distanceBand: 'immediate',
      relativeDirection: index < 12 ? 'right' : 'behind',
      volume: 0.2,
      pitch: 1,
    },
  }));
  frame.sequence = 32;
  frame.events = [
    ...sounds.slice(0, 12),
    event(25, 'intent_enqueued', { intent: { source: 'llm' } }),
    event(26, 'intent_selected', { intent: { source: 'llm' } }),
    event(27, 'permission_decision', { intent: { source: 'llm' } }),
    ...sounds.slice(12).map((sound, index) => ({ ...sound, sequence: 13 + index })),
    event(28, 'action_started', { intent: { source: 'llm' } }),
    event(29, 'visible_block_changed', { before: 'stone', after: 'air' }),
    event(30, 'tool_result', { intent: { source: 'llm' } }),
    event(31, 'action_completed', { intent: { source: 'llm' } }),
    event(32, 'chat_received', { from: 'Alex', text: 'What was that?' }),
  ].sort((left, right) => left.sequence - right.sequence);
  frame.eventWindow = {
    requestedAfterSequence: 0,
    oldestAvailableSequence: 1,
    newestAvailableSequence: 32,
    missingBeforeOldest: 0,
    complete: true,
  };

  const projected = projectCurrentModelObservation(frame, 4);
  assert.deepEqual(
    projected.events.map((item: any) => item.type),
    ['sound_sequence_heard', 'visible_block_changed', 'chat_received'],
  );
  assert.equal(projected.events[0].data.compaction, 'behold.sound-sequence.v1');
  assert.equal(projected.events[0].data.fromSequence, 1);
  assert.equal(projected.events[0].data.throughSequence, 24);
  assert.equal(projected.events[0].data.omittedIndividualEvents, 24);
  assert.deepEqual(
    projected.events[0].data.occurrences.map((occurrence: any) => ({
      range: [occurrence.fromSequence, occurrence.throughSequence],
      count: occurrence.count,
      direction: occurrence.data.relativeDirection,
    })),
    [
      { range: [1, 12], count: 12, direction: 'right' },
      { range: [13, 24], count: 12, direction: 'behind' },
    ],
  );
  assert.equal(projected.eventWindow.deliveredNewestSequence, 32);
  assert.equal(projected.eventWindow.omittedNewEvents, 0);
  assert.equal(projected.eventWindow.suppressedControllerEvents, 6);
  assert.equal(projected.eventWindow.complete, true);
});

test('combat sound pressure retains exact high occurrences and tail social consequences', () => {
  const frame: any = observation();
  const sounds = Array.from({ length: 20 }, (_, index) => ({
    sequence: index + 1,
    at: 2_000 + index * 100,
    type: 'sound_heard',
    salience: index % 3 === 0 ? 'high' : 'normal',
    source: 'sound',
    isNew: true,
    data: {
      sound: index % 3 === 0 ? 'entity.zombie.hurt' : 'entity.zombie.step',
      distanceBand: 'nearby',
      relativeDirection: index < 10 ? 'ahead' : 'right',
      volume: 1,
      pitch: 1,
    },
  }));
  frame.sequence = 24;
  frame.events = [
    ...sounds,
    event(21, 'visible_entity_hurt', { id: 'player:importdf', name: 'importdf' }),
    event(22, 'visible_entity_died', { id: 'entity:215', name: 'Zombie' }),
    event(23, 'chat_received', { from: 'importdf', text: "sedge! you're back" }),
    event(24, 'chat_received', { from: 'importdf', text: 'can you help us' }),
  ];
  frame.eventWindow = {
    requestedAfterSequence: 0,
    oldestAvailableSequence: 1,
    newestAvailableSequence: 24,
    missingBeforeOldest: 0,
    complete: true,
  };

  const projected = projectCurrentModelObservation(frame, 5);
  assert.deepEqual(
    projected.events.map((item: any) => item.type),
    [
      'sound_sequence_heard',
      'visible_entity_hurt',
      'visible_entity_died',
      'chat_received',
      'chat_received',
    ],
  );
  assert.equal(projected.events[0].salience, 'high');
  assert.equal(projected.events[0].data.fromSequence, 1);
  assert.equal(projected.events[0].data.throughSequence, 20);
  assert.equal(projected.events[0].data.omittedIndividualEvents, 20);
  assert.deepEqual(
    projected.events.slice(-2).map((item: any) => item.data.text),
    ["sedge! you're back", 'can you help us'],
  );
  assert.equal(projected.eventWindow.deliveredNewestSequence, 24);
  assert.equal(projected.eventWindow.omittedNewEvents, 0);
  assert.equal(projected.eventWindow.complete, true);
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

test('fast attention receives bounded outcomes and allowlisted first-person working memory', () => {
  const placed = continuityTurn(
    1,
    'Scout',
    'place_block',
    { x: 4, y: 64, z: 8 },
    {
      ok: true,
      changes: [
        {
          verb: 'place',
          position: { x: 4, y: 64, z: 8 },
          before: 'air',
          after: 'oak_planks',
          verified: true,
          confirmation: { source: 'mineflayer:blockUpdate' },
        },
      ],
    },
  );
  const failed = continuityTurn(
    2,
    'Scout',
    'place_block',
    { x: 4, y: 65, z: 8 },
    {
      ok: false,
      error: 'placement_support_not_found',
      reason: 'The destination needs one adjacent solid block.',
    },
  );
  placed.observation = { scene: { privilegedLoadedVolume: 'must not enter working memory' } };
  placed.nextObservation = {
    protocol: 'behold.inhabitant.v2',
    sequence: 3,
    observedAt: 30,
    self: { pose: { yaw: Math.PI / 2, pitch: 0 } },
    scene: {
      focus: {
        id: 'block:overworld:4:64:8',
        kind: 'block',
        name: 'oak_planks',
        distance: 2.5,
        reachable: true,
        privilegedBlockState: 'must not enter working memory',
      },
      terrain: {
        privilegedLoadedVolume: 'must not enter working memory',
        visualField: {
          protocol: 'behold.visual-field.v1',
          available: true,
          dimensions: { rows: 5, columns: 9 },
          rowOrder: 'top_to_bottom',
          columnOrder: 'left_to_right',
          materialRows: ['.........', '....a....', '....a....', '....b....', 'bbbbbbbbb'],
          depthRows: ['.........', '....2....', '....2....', '....1....', '111111111'],
          materialLegend: [
            { symbol: 'a', name: 'oak_planks' },
            { symbol: 'b', name: 'grass_block' },
          ],
          depthLegend: [
            { symbol: '1', label: 'interaction', maxDistance: 4.5 },
            { symbol: '2', label: 'near', maxDistance: 8 },
          ],
          noHitSymbol: '.',
          unavailableSymbol: '?',
          center: { row: 2, column: 4, alignedWith: 'current_view' },
          secretRayEndpoints: 'must not enter working memory',
        },
      },
    },
  };
  placed.utterance.assistant.content =
    'I will place the lower wall block that anchors the next upper block.';
  placed.utterance.assistant.reasoning = 'provider-private chain of thought';

  const projected = projectRecentActionContinuity([placed, failed]);
  assert.equal(projected?.source.entityId, 'Scout');
  assert.equal(projected?.source.authority, 'entity_loom');
  assert.equal(projected?.source.currency, 'historical_current_observation_wins');
  assert.equal(projected?.turns[0].action.name, 'place_block');
  assert.deepEqual(projected?.turns[0].outcome.result.changes[0].position, {
    x: 4,
    y: 64,
    z: 8,
  });
  assert.equal(
    projected?.turns[0].outcome.result.changes[0].confirmation.source,
    'mineflayer:blockUpdate',
  );
  assert.equal(
    projected?.turns[0].publicIntention,
    'I will place the lower wall block that anchors the next upper block.',
  );
  assert.equal(projected?.turns[1].outcome.result.error, 'placement_support_not_found');
  assert.equal(projected?.turns[0].glimpse?.orientation?.facing, 'west');
  assert.equal(projected?.turns[0].glimpse?.focus?.name, 'oak_planks');
  assert.deepEqual(projected?.turns[0].glimpse?.visualField.materialRows, [
    '.........',
    '....a....',
    '....a....',
    '....b....',
    'bbbbbbbbb',
  ]);
  assert.equal(projected?.turns[0].glimpse?.visualField.center.alignedWith, 'historical_view');
  assert.equal(projected?.turns[0].glimpse?.visualField.depthLegend[1].label, 'near');
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes('privilegedLoadedVolume'), false);
  assert.equal(serialized.includes('privilegedBlockState'), false);
  assert.equal(serialized.includes('secretRayEndpoints'), false);
  assert.equal(serialized.includes('provider-private chain of thought'), false);

  const laterWindow = projectRecentActionContinuity([
    continuityTurn(68, 'Scout', 'move_direction', { direction: 'back' }, { ok: true }),
    continuityTurn(69, 'Scout', 'place_block', { x: 9, y: 64, z: 9 }, { ok: true }),
  ]);
  assert.equal(laterWindow?.source.omittedOlderTurns, 67);
});

test('recent action continuity is byte bounded and rejects mixed inhabitant history', () => {
  const turns = Array.from({ length: 10 }, (_, index) =>
    continuityTurn(
      index + 1,
      'Scout',
      'inspect_volume',
      { radius: 4 },
      {
        ok: true,
        volume: Array.from({ length: 200 }, (_unused, cell) => ({
          cell,
          material: `material-${cell}-${'x'.repeat(200)}`,
        })),
      },
    ),
  );
  const projected = projectRecentActionContinuity(turns, 6, 1_000);
  assert.ok(Buffer.byteLength(JSON.stringify(projected), 'utf8') <= 1_000);
  assert.ok(Number(projected?.turns.length) >= 1);
  assert.equal(projected?.turns.at(-1)?.turn, 10);
  assert.equal(projected?.turns.at(-1)?.outcome.resultOmittedFromWorkingContinuity, true);
  assert.equal(projected?.source.omittedOlderTurns, 10 - Number(projected?.turns.length));

  turns.at(-1)!.nextObservation = {
    sequence: 11,
    observedAt: 40,
    self: { pose: { yaw: 0, pitch: 0 } },
    scene: {
      terrain: {
        visualField: {
          protocol: 'behold.visual-field.v1',
          available: true,
          dimensions: { rows: 5, columns: 9 },
          rowOrder: 'top_to_bottom',
          columnOrder: 'left_to_right',
          materialRows: Array(5).fill('aaaaaaaaa'),
          depthRows: Array(5).fill('111111111'),
          materialLegend: Array.from({ length: 32 }, (_, index) => ({
            symbol: String.fromCharCode(65 + index),
            name: `material-${index}-${'x'.repeat(120)}`,
          })),
          depthLegend: [],
          noHitSymbol: '.',
          unavailableSymbol: '?',
          center: { row: 2, column: 4 },
        },
      },
    },
  };
  const projectedWithLargeGlimpse = projectRecentActionContinuity(turns, 6, 1_000);
  assert.ok(Buffer.byteLength(JSON.stringify(projectedWithLargeGlimpse), 'utf8') <= 1_000);
  assert.equal(projectedWithLargeGlimpse?.turns.at(-1)?.glimpse, undefined);

  const foreign = continuityTurn(11, 'Builder', 'status', {}, { ok: true });
  assert.throws(
    () => projectRecentActionContinuity([...turns, foreign]),
    /cannot mix inhabitant identities/,
  );
});

test('resident working continuity preserves lived public tuples without replaying controller results, cameras, or targets', () => {
  const turns = Array.from({ length: 9 }, (_, index) => {
    const turn = continuityTurn(
      index + 1,
      'Scout',
      index % 2 === 0 ? 'look_direction' : 'move_controls',
      index % 2 === 0
        ? { horizontal: 'right', vertical: 'same' }
        : { direction: 'forward', durationMs: 500 },
      {
        ok: true,
        position: { x: 100 + index, y: 64, z: -30 },
        confirmation: 'mineflayer:body_controls',
      },
    );
    turn.profiles = {
      policy: 'legible-resident-v1',
      body: 'minecraft-human-semantic-v1',
      actions: 'minecraft-human-semantic-v1',
      safety: 'vanilla-player-v1',
    };
    turn.utterance.publicCommitment = {
      protocol: 'behold.resident-public-action-commitment.v1',
      policyProfile: 'legible-resident-v1',
      intention: `Continue my own exploration step ${index + 1}`,
      expectedObservableConsequence: 'My body or view should change in Minecraft',
    };
    turn.nextObservation = {
      self: {
        pose: { yaw: Math.PI / 2, pitch: 0 },
        condition: { health: 18, food: 19, isDay: false },
      },
      scene: {
        social: { playersOnline: ['Wren'] },
        focus: {
          id: `block:overworld:${index}:64:8`,
          kind: 'block',
          name: 'oak_planks',
          distance: 2.5,
        },
        entities: [{ id: 'entity:99', kind: 'player', name: 'Wren', distance: 7 }],
        terrain: {
          visualField: {
            protocol: 'behold.visual-field.v1',
            available: true,
            dimensions: { rows: 5, columns: 9 },
            rowOrder: 'top_to_bottom',
            columnOrder: 'left_to_right',
            materialRows: Array(5).fill('aaaaaaaaa'),
            depthRows: Array(5).fill('111111111'),
            materialLegend: [
              { symbol: 'a', name: 'oak_planks' },
              { symbol: 'b', name: 'grass_block' },
            ],
            depthLegend: [{ symbol: '1', label: 'interaction' }],
            noHitSymbol: '.',
            unavailableSymbol: '?',
            center: { row: 2, column: 4 },
          },
        },
      },
    };
    return turn;
  });

  const projected = projectResidentWorkingContinuity(
    turns,
    6,
    6_000,
    residentTurnMayReplay,
    projectHumanSemanticValue,
  );
  assert.equal(projected?.protocol, 'behold.resident-working-continuity.v1');
  assert.equal(projected?.source.includedTurns, 6);
  assert.equal(projected?.source.omittedOlderTurns, 3);
  assert.equal(projected?.experiences.at(-1)?.intention, 'Continue my own exploration step 9');
  assert.equal(projected?.experiences.at(-1)?.action, 'look_direction');
  assert.deepEqual(projected?.experiences.at(-1)?.arguments, {
    horizontal: 'right',
    vertical: 'same',
  });
  assert.equal(
    projected?.experiences.at(-1)?.actualConsequence,
    'Minecraft reported that the action completed successfully.',
  );
  assert.deepEqual(projected?.experiences.at(-1)?.perceptionAfter, {
    orientation: { facing: 'west', vertical: 'level' },
    condition: { health: 18, food: 19, daylight: 'night' },
    focus: { kind: 'block', name: 'oak_planks', proximity: 'interaction' },
    visibleMaterials: ['oak_planks', 'grass_block'],
    visibleEntities: [{ kind: 'player', name: 'Wren', proximity: 'nearby' }],
    playersOnline: ['Wren'],
    provenance: 'historical_next_observation',
    currency: 'historical_current_observation_wins',
  });
  const serialized = JSON.stringify(projected);
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= 6_000);
  assert.doesNotMatch(
    serialized,
    /materialRows|depthRows|block:overworld|entity:99|"x"|"y"|"z"|"input"|"result"|eventType|mineflayer:/,
  );
});

test('resident factual continuity preserves lived facts without legacy steering or controller prose', () => {
  const turn = continuityTurn(
    1,
    'Scout',
    'move_controls',
    { direction: 'forward', durationMs: 500 },
    {
      ok: true,
      bodyMoved: false,
      reason: 'CANARY_CONTROLLER_REASON',
      message: 'CANARY_CONTROLLER_MESSAGE',
    },
  );
  turn.profiles = {
    policy: 'legible-resident-v1',
    body: 'minecraft-human-semantic-v1',
    actions: 'minecraft-human-semantic-v1',
    safety: 'vanilla-player-v1',
  };
  turn.utterance.assistant.content = 'CANARY_ASSISTANT_NARRATION';
  turn.utterance.publicCommitment = {
    protocol: 'behold.resident-public-action-commitment.v1',
    policyProfile: 'legible-resident-v1',
    intention: 'CANARY_LEGACY_INTENTION',
    expectedObservableConsequence: 'CANARY_EXPECTED_CONSEQUENCE',
  };
  turn.nextObservation = {
    task: { name: 'CANARY_CONTROLLER_TASK', progress: 'CANARY_PROGRESS' },
    self: { condition: { health: 17, food: 16, isDay: true } },
    scene: { social: { playersOnline: ['Wren'] } },
    events: [
      {
        sequence: 2,
        type: 'chat_received',
        isNew: true,
        data: { from: 'Wren', text: 'Are you still there?' },
      },
    ],
  };

  const projected = projectResidentFactualContinuity(
    [turn],
    6,
    6_000,
    residentTurnMayReplay,
    projectHumanSemanticValue,
  );
  assert.equal(projected?.protocol, 'behold.resident-factual-continuity.v1');
  assert.deepEqual(projected?.experiences[0].chosen, {
    control: 'move_controls',
    arguments: { direction: 'forward', durationMs: 500 },
  });
  assert.deepEqual(projected?.experiences[0].settled, {
    terminal: 'completed',
    eventType: 'action_completed',
    bodyMoved: false,
  });
  assert.deepEqual(projected?.experiences[0].communication?.heard, [
    { from: 'Wren', text: 'Are you still there?' },
  ]);
  assert.deepEqual(projected?.experiences[0].after?.condition, {
    health: 17,
    food: 16,
    daylight: 'day',
  });
  assert.doesNotMatch(
    JSON.stringify(projected),
    /CANARY_|intention|expectedObservableConsequence|progress|project|reason|message/,
  );
});

test('resident continuity distinguishes dispatched input and movement without consequence', () => {
  const dispatched = continuityTurn(
    1,
    'Scout',
    'use_focused_block',
    {},
    {
      ok: true,
      status: 'use_input_dispatched',
    },
  );
  const stationary = continuityTurn(
    2,
    'Scout',
    'move_controls',
    { direction: 'forward' },
    {
      ok: true,
      bodyMoved: false,
    },
  );
  for (const turn of [dispatched, stationary]) {
    turn.profiles = {
      policy: 'legible-resident-v1',
      body: 'minecraft-human-semantic-v1',
      actions: 'minecraft-human-semantic-v1',
      safety: 'vanilla-player-v1',
    };
  }
  const projected = projectResidentWorkingContinuity(
    [dispatched, stationary],
    6,
    6_000,
    residentTurnMayReplay,
    projectHumanSemanticValue,
  );

  assert.equal(
    projected?.experiences[0].actualConsequence,
    'Minecraft accepted the use_input_dispatched input; no world consequence was confirmed.',
  );
  assert.equal(
    projected?.experiences[1].actualConsequence,
    'Minecraft completed the movement input but confirmed no body movement.',
  );
});

test('resident continuity never turns submitted chat input into confirmed delivery', () => {
  const chat = continuityTurn(
    1,
    'Scout',
    'chat',
    { text: 'Can anyone hear me?' },
    { ok: true, status: 'chat_input_dispatched', message: 'Can anyone hear me?' },
  );
  chat.profiles = {
    policy: 'resident-v2',
    body: 'minecraft-human-semantic-v1',
    actions: 'minecraft-human-semantic-v1',
    safety: 'vanilla-player-v1',
  };

  const projected = projectResidentWorkingContinuity(
    [chat],
    6,
    6_000,
    residentTurnMayReplay,
    projectHumanSemanticValue,
  );
  const factual = projectResidentFactualContinuity(
    [chat],
    6,
    6_000,
    residentTurnMayReplay,
    projectHumanSemanticValue,
  );

  assert.deepEqual(factual?.experiences[0].settled, {
    terminal: 'input_dispatched',
    eventType: 'action_completed',
  });
  assert.equal(
    projected?.experiences[0].actualConsequence,
    'Minecraft accepted the chat_input_dispatched input; no world consequence was confirmed.',
  );
});

test('recent continuity omits actions outside the resident action surface', () => {
  const privileged = continuityTurn(
    1,
    'Scout',
    'inspect_reachable_space',
    { feet: { x: 91, y: 64, z: -37 }, secret: 'private-input' },
    { ok: true, sealed: true, topology: 'private-result' },
  );
  privileged.utterance.assistant.content = 'The private topology is sealed.';

  const projected = projectRecentActionContinuity(
    [privileged],
    6,
    12_000,
    (turn) => turn.action.name !== 'inspect_reachable_space',
  );
  assert.equal(projected?.turns[0]?.action.name, 'inspect_reachable_space');
  assert.equal(projected?.turns[0]?.action.inputOmittedFromWorkingContinuity, true);
  assert.equal(projected?.turns[0]?.outcome.resultOmittedFromWorkingContinuity, true);
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes('private-input'), false);
  assert.equal(serialized.includes('private-result'), false);
  assert.equal(serialized.includes('private topology'), false);
});

test('recent continuity omits privileged evidence nested in a resident result', () => {
  const completion = continuityTurn(
    1,
    'Scout',
    'manage_project',
    { operation: 'complete' },
    {
      evidence: {
        expected: 'space_enclosed',
        witness: {
          action: 'inspect_reachable_space',
          input: { secret: 'nested-private-input' },
          result: { secret: 'nested-private-result' },
        },
      },
    },
  );
  completion.utterance.assistant.content = 'Nested-private geometry is ready.';

  const projected = projectRecentActionContinuity([completion], 6, 12_000, residentTurnMayReplay);
  assert.equal(projected?.turns[0]?.action.inputOmittedFromWorkingContinuity, true);
  assert.equal(projected?.turns[0]?.outcome.resultOmittedFromWorkingContinuity, true);
  assert.doesNotMatch(JSON.stringify(projected), /nested-private/);
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
          doneWhen: 'A sealed landmark is independently observed later',
          evidence: 'space_enclosed',
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

function continuityTurn(
  sequence: number,
  entityId: string,
  name: string,
  input: any,
  result: any,
): EntityTurn {
  return {
    protocol: 'behold.entity-turn.v1',
    id: `${entityId}:turn:${sequence}`,
    entityId,
    sequence,
    parentId: sequence > 1 ? `${entityId}:turn:${sequence - 1}` : null,
    model: 'test/model',
    startedAt: sequence * 10,
    completedAt: sequence * 10 + 5,
    observation: { protocol: 'behold.inhabitant.v2', sequence },
    utterance: { assistant: { role: 'assistant' } },
    action: {
      id: `intent-${sequence}`,
      name,
      input,
      source: 'llm',
      kind: 'exclusive',
      toolCallId: `call-${sequence}`,
    },
    outcome: {
      ok: result?.ok === true,
      eventType: result?.ok === true ? 'action_completed' : 'action_failed',
      result,
      ...(result?.error ? { error: result.error } : {}),
    },
    nextObservation: { protocol: 'behold.inhabitant.v2', sequence: sequence + 1 },
  };
}
