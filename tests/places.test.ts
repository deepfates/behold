import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaceMemory, findProjectPlaceConflicts, situatePlaces } from '../src/entity/places';
import type { EntityTurn } from '../src/entity/loom';

test('completed spatial projects become actionable places rebuilt from the own loom', () => {
  const completion = completedPlaceTurn('Scout', 2, {
    projectId: 'shared-home',
    title: 'Build a shared home',
    doneWhen: 'A sealed shared shelter has a door',
    anchor: { x: 12, y: 64, z: -3 },
  });

  const firstLife = createPlaceMemory('Scout', [priorTurn('Scout', 1), completion]);
  assert.deepEqual(firstLife.snapshot(), [
    {
      id: 'place:overworld:12:64:-3',
      label: 'Build a shared home',
      purpose: 'A sealed shared shelter has a door',
      anchor: { dimension: 'overworld', x: 12, y: 64, z: -3 },
      affordances: [
        'sealed-space',
        'covered-space',
        'shared-capacity',
        'closable-entrance',
        'crafting-nearby',
      ],
      protectedBodyCells: [
        { x: 12, y: 64, z: -3 },
        { x: 13, y: 64, z: -3 },
      ],
      entrances: [
        {
          name: 'spruce_door',
          lower: { x: 11, y: 64, z: -3 },
          upper: { x: 11, y: 65, z: -3 },
          insideFeet: { x: 12, y: 64, z: -3 },
          outsideFeet: { x: 10, y: 64, z: -3 },
          rememberedState: 'closed',
        },
      ],
      evidence: 'space_enclosed',
      learnedAtSequence: 2,
      lastConfirmedAtSequence: 1,
      provenance: {
        source: 'own_entity_loom',
        projectId: 'shared-home',
        completionTurnSequence: 2,
        witnessTurnSequence: 1,
        witnessAction: 'inspect_reachable_space',
      },
    },
  ]);

  // A fresh process gets the same bounded affordance without trusting a fold.
  const restarted = createPlaceMemory('Scout', [priorTurn('Scout', 1), completion]);
  assert.deepEqual(restarted.snapshot(), firstLife.snapshot());

  const situated = situatePlaces(restarted.snapshot(), { x: 9, y: 64, z: 1 }, 'overworld');
  assert.equal(situated[0]?.distance, 5);
  assert.equal(situated[0]?.sameDimension, true);
  assert.equal(situated[0]?.source, 'memory');
});

test('nearby witnessed improvements coalesce instead of inventing duplicate homes', () => {
  const first = completedPlaceTurn('Scout', 1, {
    projectId: 'walls',
    title: 'Enclose the shelter',
    anchor: { x: 10, y: 64, z: 10 },
  });
  const second = completedPlaceTurn('Scout', 2, {
    projectId: 'door',
    title: 'Add a real door to the shelter',
    anchor: { x: 12, y: 64, z: 10 },
  });
  const memory = createPlaceMemory('Scout', [first, second]);

  assert.equal(memory.snapshot().length, 1);
  assert.equal(memory.snapshot()[0]?.label, 'Add a real door to the shelter');
  assert.equal(memory.snapshot()[0]?.learnedAtSequence, 1);
  assert.equal(memory.snapshot()[0]?.lastConfirmedAtSequence, 1);
});

test('ordinary world changes remember only the embodied site consequence', () => {
  const changed = completedWorldChangeTurn('Scout', 2, {
    projectId: 'first-wall',
    title: 'Build the first wall',
    anchor: { x: 12, y: 64, z: -3 },
  });
  const place = createPlaceMemory('Scout', [changed]).snapshot()[0];

  assert.equal(place?.evidence, 'world_change');
  assert.deepEqual(place?.affordances, ['built-or-modified-site']);
  assert.deepEqual(place?.protectedBodyCells, []);
  assert.deepEqual(place?.entrances, []);
  assert.equal(place?.provenance.witnessAction, 'place_block');
});

test('a selected door crossing becomes direction-neutral own-life route memory after next observation', () => {
  const crossed = doorwayCrossingTurn('Scout', 4, {
    fromFeet: { x: 0, y: 64, z: 1 },
    toFeet: { x: 0, y: 64, z: -1 },
    label: 'Garden gate',
    purpose: 'The route toward the garden',
  });
  const memory = createPlaceMemory('Scout', [crossed]);

  assert.deepEqual(memory.snapshot(), [
    {
      id: 'doorway:minecraft-test:overworld:0:64:0',
      label: 'Garden gate',
      purpose: 'The route toward the garden',
      circleId: 'minecraft:test',
      anchor: { dimension: 'overworld', x: 0, y: 64, z: -1 },
      affordances: ['witnessed-doorway-crossing'],
      protectedBodyCells: [],
      entrances: [],
      doorways: [
        {
          name: 'oak_door',
          focusId: 'block:overworld:0:64:0',
          lower: { x: 0, y: 64, z: 0 },
          upper: { x: 0, y: 65, z: 0 },
          sideAFeet: { x: 0, y: 64, z: -1 },
          sideBFeet: { x: 0, y: 64, z: 1 },
          rememberedState: 'closed',
        },
      ],
      evidence: 'doorway_crossed',
      learnedAtSequence: 4,
      lastConfirmedAtSequence: 4,
      provenance: {
        source: 'own_entity_loom',
        kind: 'embodied_doorway',
        actionId: 'cross-door-4',
        actionTurnSequence: 4,
        witnessTurnSequence: 4,
        witnessAction: 'cross_visible_door',
      },
    },
  ]);
  assert.deepEqual(createPlaceMemory('Scout', [crossed]).snapshot(), memory.snapshot());

  const reversed = doorwayCrossingTurn('Scout', 5, {
    fromFeet: { x: 0, y: 64, z: -1 },
    toFeet: { x: 0, y: 64, z: 1 },
    label: 'Garden gate',
    purpose: 'The same route in either direction',
  });
  memory.record(reversed);
  assert.equal(memory.snapshot().length, 1);
  assert.equal(memory.snapshot()[0]?.learnedAtSequence, 4);
  assert.equal(memory.snapshot()[0]?.lastConfirmedAtSequence, 5);
  assert.deepEqual(memory.snapshot()[0]?.doorways?.[0]?.sideAFeet, { x: 0, y: 64, z: -1 });
  assert.deepEqual(memory.snapshot()[0]?.doorways?.[0]?.sideBFeet, { x: 0, y: 64, z: 1 });
  assert.equal(memory.snapshot()[0]?.affordances.includes('sealed-space'), false);
});

test('doorway memory fails closed without exact world, action, and next-body evidence', () => {
  const wrongArrival = doorwayCrossingTurn('Scout', 4, {
    fromFeet: { x: 0, y: 64, z: 1 },
    toFeet: { x: 0, y: 64, z: -1 },
    label: 'Unconfirmed route',
  });
  wrongArrival.nextObservation.self.pose.position = { x: 0, y: 64, z: 1 };
  assert.deepEqual(createPlaceMemory('Scout', [wrongArrival]).snapshot(), []);

  const wrongCircle = doorwayCrossingTurn('Scout', 4, {
    fromFeet: { x: 0, y: 64, z: 1 },
    toFeet: { x: 0, y: 64, z: -1 },
    label: 'Other world',
  });
  wrongCircle.outcome.result.world.circleId = 'minecraft:other';
  assert.deepEqual(createPlaceMemory('Scout', [wrongCircle]).snapshot(), []);

  const systemAction = doorwayCrossingTurn('Scout', 4, {
    fromFeet: { x: 0, y: 64, z: 1 },
    toFeet: { x: 0, y: 64, z: -1 },
    label: 'System route',
  });
  systemAction.action.source = 'system';
  assert.deepEqual(createPlaceMemory('Scout', [systemAction]).snapshot(), []);

  const noName = doorwayCrossingTurn('Scout', 4, {
    fromFeet: { x: 0, y: 64, z: 1 },
    toFeet: { x: 0, y: 64, z: -1 },
    label: 'Temporary route',
  });
  delete noName.outcome.result.rememberAs;
  assert.deepEqual(createPlaceMemory('Scout', [noName]).snapshot(), []);
});

test('a worksite anchors to the verified mutation rather than later completion position', () => {
  const changed = completedWorldChangeTurn('Scout', 2, {
    projectId: 'first-wall',
    title: 'Build the first wall',
    anchor: { x: 12, y: 64, z: -3 },
  });
  changed.observation = worldObservation('Scout', { x: 80, y: 70, z: 80 });
  changed.nextObservation = worldObservation('Scout', { x: 81, y: 70, z: 80 });

  assert.deepEqual(createPlaceMemory('Scout', [changed]).snapshot()[0]?.anchor, {
    dimension: 'overworld',
    x: 12,
    y: 64,
    z: -3,
  });
});

test('non-spatial or cross-dimension witnesses cannot create a worksite place', () => {
  const unverified = completedWorldChangeTurn('Scout', 2, {
    projectId: 'unverified-wall',
    title: 'Claim an unverified wall',
    anchor: { x: 12, y: 64, z: -3 },
  });
  delete unverified.outcome.result.evidence.witness.result.changes[0].verified;
  assert.deepEqual(createPlaceMemory('Scout', [unverified]).snapshot(), []);

  const container = completedWorldChangeTurn('Scout', 2, {
    projectId: 'stock-cache',
    title: 'Stock the cache',
    anchor: { x: 12, y: 64, z: -3 },
  });
  container.outcome.result.evidence.witness = {
    sequence: 1,
    action: 'deposit_in_container',
    input: { name: 'apple', count: 1 },
    result: {
      requested: 1,
      bodyRemoved: 1,
      containerAdded: 1,
      confirmation: 'mineflayer:container_inventory_delta',
    },
    world: { circleId: 'minecraft:test', dimension: 'overworld' },
  };
  assert.deepEqual(createPlaceMemory('Scout', [container]).snapshot(), []);

  const mismatched = completedWorldChangeTurn('Scout', 2, {
    projectId: 'wrong-world',
    title: 'Change another dimension',
    anchor: { x: 12, y: 64, z: -3 },
  });
  mismatched.outcome.result.evidence.witness.world.dimension = 'the_nether';
  assert.deepEqual(createPlaceMemory('Scout', [mismatched]).snapshot(), []);

  const wrongCircle = completedWorldChangeTurn('Scout', 2, {
    projectId: 'wrong-circle',
    title: 'Change another world',
    anchor: { x: 12, y: 64, z: -3 },
  });
  wrongCircle.outcome.result.evidence.witness.world.circleId = 'minecraft:other';
  assert.deepEqual(createPlaceMemory('Scout', [wrongCircle]).snapshot(), []);
});

test('later weaker world changes cannot relabel legacy certified place geometry', () => {
  const legacy = completedPlaceTurn('Scout', 2, {
    projectId: 'legacy-home',
    title: 'Legacy certified home',
    anchor: { x: 12, y: 64, z: -3 },
  });
  const changed = completedWorldChangeTurn('Scout', 3, {
    projectId: 'repair-wall',
    title: 'Repair one wall',
    anchor: { x: 13, y: 64, z: -3 },
  });
  const place = createPlaceMemory('Scout', [legacy, changed]).snapshot()[0];

  assert.equal(place?.evidence, 'space_enclosed');
  assert.equal(place?.provenance.projectId, 'legacy-home');
  assert.equal(place?.provenance.completionTurnSequence, 2);
  assert.equal(place?.lastConfirmedAtSequence, 1);
  assert.equal(place?.affordances.includes('built-or-modified-site'), false);
  assert.equal(place?.affordances.includes('sealed-space'), true);
});

test('place projections reject foreign turns and do not leak across inhabitants', () => {
  const scoutTurn = completedPlaceTurn('Scout', 1, {
    projectId: 'scout-home',
    title: 'Scout only home',
    anchor: { x: 4, y: 64, z: 4 },
  });
  const masonTurn = completedPlaceTurn('Mason', 1, {
    projectId: 'mason-home',
    title: 'Mason only home',
    anchor: { x: 100, y: 64, z: 100 },
  });

  const scout = createPlaceMemory('Scout', [scoutTurn]);
  const mason = createPlaceMemory('Mason', [masonTurn]);
  assert.equal(scout.snapshot()[0]?.label, 'Scout only home');
  assert.equal(mason.snapshot()[0]?.label, 'Mason only home');
  assert.throws(() => scout.record(masonTurn), /expected Scout, received Mason/);
  assert.doesNotMatch(JSON.stringify(scout.snapshot()), /Mason|mason-home/);
});

test('a later duplicate shelter project conflicts with an earlier nearby witnessed place', () => {
  const place = situatePlaces(
    createPlaceMemory('Scout', [
      completedPlaceTurn('Scout', 8, {
        projectId: 'shared-home',
        title: 'Build a shared home',
        anchor: { x: 20, y: 64, z: 0 },
      }),
    ]).snapshot(),
    { x: 0, y: 64, z: 0 },
    'overworld',
  );
  const duplicate = project('night-refuge', 12, 'Establish a safe night refuge');
  const conflicts = findProjectPlaceConflicts([duplicate], place);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.projectId, 'night-refuge');
  assert.equal(conflicts[0]?.distance, 20);
  assert.match(conflicts[0]?.requiredResolution || '', /Abandon the duplicate/);
  assert.deepEqual(
    findProjectPlaceConflicts(
      [project('repair-home', 12, 'Return to and repair the existing shared home')],
      place,
    ),
    [],
  );
  assert.deepEqual(
    findProjectPlaceConflicts(
      [project('remote-outpost', 12, 'Establish a deliberately separate remote outpost')],
      place,
    ),
    [],
  );
});

function completedPlaceTurn(
  entityId: string,
  sequence: number,
  options: {
    projectId: string;
    title: string;
    doneWhen?: string;
    anchor: { x: number; y: number; z: number };
  },
): EntityTurn {
  const observation = worldObservation(entityId, options.anchor);
  return {
    protocol: 'behold.entity-turn.v1',
    id: `${entityId}:turn:${sequence}`,
    entityId,
    sequence,
    parentId: sequence === 1 ? null : `${entityId}:turn:${sequence - 1}`,
    model: 'test/model',
    startedAt: sequence * 10,
    completedAt: sequence * 10 + 5,
    observation,
    utterance: { assistant: { role: 'assistant' } },
    action: {
      id: `complete-${sequence}`,
      name: 'manage_project',
      input: { operation: 'complete', id: options.projectId },
      source: 'llm',
      kind: 'parallel',
      toolCallId: null,
    },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: {
        ok: true,
        operation: 'complete',
        project: {
          id: options.projectId,
          title: options.title,
          doneWhen: options.doneWhen || 'A useful shared place exists',
          evidence: 'space_enclosed',
        },
        evidence: {
          satisfied: true,
          expected: 'space_enclosed',
          witness: {
            sequence: Math.max(1, sequence - 1),
            action: 'inspect_reachable_space',
            input: { feet: options.anchor },
            result: {
              ok: true,
              seedFeet: options.anchor,
              sealed: true,
              fullyCovered: true,
              sharedCapacity: true,
              closableEntranceCount: 1,
              protectedCells: [
                { feet: options.anchor },
                {
                  feet: {
                    x: options.anchor.x + 1,
                    y: options.anchor.y,
                    z: options.anchor.z,
                  },
                },
              ],
              closableEntrances: [
                {
                  name: 'spruce_door',
                  lower: {
                    x: options.anchor.x - 1,
                    y: options.anchor.y,
                    z: options.anchor.z,
                  },
                  upper: {
                    x: options.anchor.x - 1,
                    y: options.anchor.y + 1,
                    z: options.anchor.z,
                  },
                  fromProtectedFeet: options.anchor,
                  outsideFeet: {
                    x: options.anchor.x - 2,
                    y: options.anchor.y,
                    z: options.anchor.z,
                  },
                  state: 'closed',
                },
              ],
            },
          },
        },
      },
    },
    nextObservation: observation,
  };
}

function completedWorldChangeTurn(
  entityId: string,
  sequence: number,
  options: {
    projectId: string;
    title: string;
    anchor: { x: number; y: number; z: number };
  },
): EntityTurn {
  const turn = completedPlaceTurn(entityId, sequence, options);
  turn.circleId = 'minecraft:test';
  turn.observation.scene.terrain.materials = [];
  turn.nextObservation.scene.terrain.materials = [];
  turn.outcome.result.project.evidence = 'world_change';
  turn.outcome.result.evidence = {
    satisfied: true,
    expected: 'world_change',
    witness: {
      sequence: Math.max(1, sequence - 1),
      action: 'place_block',
      input: options.anchor,
      result: {
        ok: true,
        changes: [
          {
            position: options.anchor,
            before: 'air',
            after: 'oak_planks',
            verified: true,
            confirmation: { source: 'mineflayer:blockUpdate' },
          },
        ],
      },
      world: { circleId: 'minecraft:test', dimension: 'overworld' },
    },
  };
  return turn;
}

function doorwayCrossingTurn(
  entityId: string,
  sequence: number,
  options: {
    fromFeet: { x: number; y: number; z: number };
    toFeet: { x: number; y: number; z: number };
    label: string;
    purpose?: string;
  },
): EntityTurn {
  const observation = worldObservation(entityId, options.fromFeet);
  const nextObservation = worldObservation(entityId, options.toFeet);
  (observation as any).circle = { id: 'minecraft:test', managedRunId: 'run-7' };
  (nextObservation as any).circle = { id: 'minecraft:test', managedRunId: 'run-7' };
  return {
    protocol: 'behold.entity-turn.v1',
    circleId: 'minecraft:test',
    id: `${entityId}:turn:${sequence}`,
    entityId,
    sequence,
    parentId: sequence === 1 ? null : `${entityId}:turn:${sequence - 1}`,
    model: 'test/model',
    startedAt: sequence * 10,
    completedAt: sequence * 10 + 5,
    observation,
    utterance: { assistant: { role: 'assistant' } },
    action: {
      id: `cross-door-${sequence}`,
      name: 'cross_visible_door',
      input: { focus: 'block:overworld:0:64:0' },
      source: 'script',
      kind: 'exclusive',
      toolCallId: null,
    },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: {
        ok: true,
        protocol: 'behold.visible-door-crossing.v1',
        crossed: true,
        focus: {
          id: 'block:overworld:0:64:0',
          kind: 'block',
          name: 'oak_door',
          source: 'cursor',
          position: { x: 0, y: 64, z: 0 },
        },
        door: {
          lower: { x: 0, y: 64, z: 0 },
          upper: { x: 0, y: 65, z: 0 },
        },
        fromFeet: options.fromFeet,
        toFeet: options.toFeet,
        doorOpened: { ok: true, changed: { property: 'open', before: false, after: true } },
        doorClosed: { ok: true, changed: { property: 'open', before: true, after: false } },
        crossing: {
          ok: true,
          doorCellOccupied: true,
          confirmation: 'mineflayer:body_crossed_selected_door_cell',
        },
        world: { circleId: 'minecraft:test', dimension: 'overworld' },
        rememberAs: { label: options.label, purpose: options.purpose ?? null },
      },
    },
    nextObservation,
  };
}

function priorTurn(entityId: string, sequence: number): EntityTurn {
  const observation = worldObservation(entityId, { x: 0, y: 64, z: 0 });
  return {
    protocol: 'behold.entity-turn.v1',
    id: `${entityId}:turn:${sequence}`,
    entityId,
    sequence,
    parentId: sequence === 1 ? null : `${entityId}:turn:${sequence - 1}`,
    model: 'test/model',
    startedAt: sequence * 10,
    completedAt: sequence * 10 + 5,
    observation,
    utterance: { assistant: { role: 'assistant' } },
    action: {
      id: `inspect-${sequence}`,
      name: 'inspect_reachable_space',
      input: { feet: { x: 0, y: 64, z: 0 } },
      source: 'llm',
      kind: 'parallel',
      toolCallId: null,
    },
    outcome: { ok: true, eventType: 'action_completed', result: { ok: true } },
    nextObservation: observation,
  };
}

function project(id: string, startedAtSequence: number, title: string) {
  return {
    id,
    title,
    nextStep: 'Place the next wall',
    doneWhen: 'A sealed, covered shared shelter has a closable entrance',
    evidence: 'space_enclosed' as const,
    needsDefinition: false,
    startedAtSequence,
    updatedAtSequence: startedAtSequence,
  };
}

function worldObservation(entityId: string, position: { x: number; y: number; z: number }) {
  return {
    self: {
      identity: entityId,
      pose: { position },
      condition: { dimension: 'overworld' },
    },
    scene: {
      terrain: {
        materials: [{ name: 'crafting_table', count: 1 }],
      },
    },
  };
}
