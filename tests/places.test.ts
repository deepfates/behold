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
            confirmation: { source: 'mineflayer:blockUpdate' },
          },
        ],
      },
    },
  };
  return turn;
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
