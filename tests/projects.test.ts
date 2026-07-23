import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectMemory, MANAGE_PROJECT_TOOL } from '../src/entity/projects';
import type { EntityTurn } from '../src/entity/loom';

function projectTurn(
  entityId: string,
  sequence: number,
  parentId: string | null,
  input: any,
  ok = true,
  observation: any = {},
  nextObservation: any = observation,
): EntityTurn {
  return {
    protocol: 'behold.entity-turn.v1',
    id: `${entityId}:turn:${sequence}`,
    entityId,
    sequence,
    parentId,
    model: 'test/model',
    startedAt: sequence * 10,
    completedAt: sequence * 10 + 1,
    observation,
    utterance: { assistant: { role: 'assistant' } },
    action: {
      id: `project-${sequence}`,
      name: MANAGE_PROJECT_TOOL,
      input,
      source: 'llm',
      kind: 'parallel',
      toolCallId: null,
    },
    outcome: {
      ok,
      eventType: ok ? 'action_completed' : 'action_failed',
      result:
        input?.operation === 'complete'
          ? {
              ok,
              operation: 'complete',
              project: { id: input.id },
              evidence: { satisfied: true },
              conclusion: { authority: 'inhabitant', worldStateCertified: false },
            }
          : { ok },
    },
    nextObservation,
  };
}

function observation({
  observedAt = 100,
  isDay = false,
  position = { x: 0, y: 64, z: 0 },
  inventory = [],
  events = [],
}: {
  observedAt?: number;
  isDay?: boolean;
  position?: { x: number; y: number; z: number };
  inventory?: Array<{ name: string; count: number }>;
  events?: any[];
} = {}) {
  return {
    observedAt,
    self: {
      pose: { position },
      condition: { health: 20, food: 20, oxygen: null, dimension: 'overworld', isDay },
      inventory,
    },
    events,
  };
}

test('active projects are a bounded projection rebuilt from the inhabitant loom', () => {
  const start = projectTurn('Scout', 1, null, {
    operation: 'start',
    id: 'shared-home',
    title: 'Build a shared home',
    nextStep: 'Gather eight logs',
    doneWhen: 'A lit, enclosed shelter has a door, bed, and shared chest',
    evidence: 'world_change',
  });
  const update = projectTurn('Scout', 2, start.id, {
    operation: 'update',
    id: 'shared-home',
    nextStep: 'Craft planks and place the first wall',
  });
  const memory = createProjectMemory('Scout', [start, update]);

  assert.deepEqual(memory.snapshot(), [
    {
      id: 'shared-home',
      title: 'Build a shared home',
      status: 'active_unfinished',
      nextStep: 'Craft planks and place the first wall',
      doneWhen: 'A lit, enclosed shelter has a door, bed, and shared chest',
      completionRequires: 'world_change',
      needsDefinition: false,
      startedAtSequence: 1,
      updatedAtSequence: 2,
    },
  ]);

  const complete = projectTurn('Scout', 3, update.id, {
    operation: 'complete',
    id: 'shared-home',
  });
  memory.validate(complete);
  memory.record(complete);
  assert.deepEqual(memory.snapshot(), []);
  assert.deepEqual(createProjectMemory('Scout', [start, update, complete]).snapshot(), []);
});

test('projects keep one active focus and reject foreign turns', () => {
  const memory = createProjectMemory('Scout');
  memory.record(
    projectTurn('Scout', 1, null, {
      operation: 'start',
      id: 'project-1',
      title: 'Project 1',
      nextStep: 'Do one thing',
      doneWhen: 'Project 1 has one observed result',
      evidence: 'world_change',
    }),
  );
  assert.equal(
    memory.propose({
      operation: 'start',
      id: 'project-2',
      title: 'Project 2',
      nextStep: 'Do another thing',
      doneWhen: 'Project 2 has one observed result',
      evidence: 'inventory_change',
    }).error,
    'active_project_limit_reached',
  );
  assert.throws(
    () =>
      memory.record(
        projectTurn('Builder', 1, null, {
          operation: 'start',
          id: 'foreign',
          title: 'Foreign',
          nextStep: 'Leak state',
        }),
      ),
    /expected Scout/,
  );
});

test('legacy overlapping projects replay but must be resolved before further updates', () => {
  const first = projectTurn('Scout', 1, null, {
    operation: 'start',
    id: 'recover',
    title: 'Recover',
    nextStep: 'Get grounded',
    doneWhen: 'Standing safely',
    evidence: 'body_change',
  });
  const second = projectTurn('Scout', 2, first.id, {
    operation: 'start',
    id: 'reorient',
    title: 'Reorient',
    nextStep: 'Look around',
    doneWhen: 'A safe route is known',
    evidence: 'place_reached',
  });
  const memory = createProjectMemory('Scout', [first, second]);

  assert.equal(memory.snapshot().length, 2);
  assert.equal(
    memory.propose({
      operation: 'update',
      id: 'reorient',
      nextStep: 'Find a tree',
    }).error,
    'resolve_project_overlap_first',
  );
  assert.equal(memory.propose({ operation: 'abandon', id: 'recover' }).ok, true);
});

test('legacy projects remain immutable but require an observable completion definition', () => {
  const legacy = projectTurn('Scout', 1, null, {
    operation: 'start',
    id: 'gather-resources',
    title: 'Gather Resources',
    nextStep: 'Collect dirt',
  });
  const memory = createProjectMemory('Scout', [legacy]);

  assert.equal(memory.snapshot()[0]?.doneWhen, null);
  assert.equal(memory.snapshot()[0]?.completionRequires, null);
  assert.equal(memory.snapshot()[0]?.needsDefinition, true);
  assert.equal(
    memory.propose({
      operation: 'update',
      id: 'gather-resources',
      nextStep: 'Collect logs for a shelter',
    }).error,
    'project_done_when_required',
  );
  assert.equal(
    memory.propose({
      operation: 'update',
      id: 'gather-resources',
      title: 'Build a safe first shelter',
      nextStep: 'Collect four logs',
      doneWhen: 'A lit enclosed shelter with a door survives one night',
      evidence: 'world_change',
    }).ok,
    true,
  );
});

test('new projects require a valid future Minecraft evidence channel', () => {
  const memory = createProjectMemory('Scout');
  const base = {
    operation: 'start',
    id: 'first-shelter',
    title: 'Build a first shelter',
    nextStep: 'Gather four nearby logs',
    doneWhen: 'A lit enclosed shelter survives one night',
  };

  assert.equal(memory.propose(base).error, 'project_evidence_required');
  assert.equal(
    memory.propose({ ...base, evidence: 'being_productive' }).error,
    'invalid_project_evidence',
  );
  assert.equal(
    memory.propose({ ...base, evidence: 'time_elapsed' }).error,
    'project_construction_requires_world_change',
  );
  assert.equal(
    memory.propose({ ...base, evidence: 'space_enclosed' }).error,
    'project_evidence_external_only',
  );
  assert.equal(memory.propose({ ...base, evidence: 'world_change' }).ok, true);
});

test('surviving until daylight may use time evidence without pretending to rebuild the shelter', () => {
  const memory = createProjectMemory('Scout');
  const result = memory.propose({
    operation: 'start',
    id: 'survive-night',
    title: 'Stay safe in sealed shelter until daylight',
    nextStep: 'Remain inside unless danger or another urgent event occurs',
    doneWhen: 'It is daylight again while I remain alive at this shelter',
    evidence: 'time_elapsed',
  });

  assert.equal(result.ok, true);
});

test('an evidence label cannot disguise waiting or an already-true idle state as a project', () => {
  const circular = projectTurn('Scout', 1, null, {
    operation: 'start',
    id: 'idle-safe-keepalive',
    title: 'Stay safe while idle',
    nextStep: 'Keep still until a concrete new task appears',
    doneWhen: 'I have a new task or there is no immediate hazard',
    evidence: 'time_elapsed',
  });
  const replayed = createProjectMemory('Scout', [circular]);
  assert.equal(replayed.snapshot()[0]?.needsDefinition, true);
  assert.equal(
    replayed.propose({
      operation: 'update',
      id: 'idle-safe-keepalive',
      nextStep: 'Keep still until somebody assigns work',
    }).error,
    'project_must_name_a_future_change',
  );

  const fresh = createProjectMemory('Scout');
  assert.equal(
    fresh.propose({
      operation: 'start',
      id: 'wait-safely',
      title: 'Wait safely',
      nextStep: 'Remain here',
      doneWhen: 'Something changes eventually',
      evidence: 'time_elapsed',
    }).error,
    'project_time_boundary_required',
  );
  assert.equal(
    fresh.propose({
      operation: 'start',
      id: 'survive-until-dawn',
      title: 'Survive until dawn',
      nextStep: 'Find defensible cover for the rest of the night',
      doneWhen: 'Daylight arrives while I remain alive and grounded',
      evidence: 'time_elapsed',
    }).ok,
    true,
  );
});

test('surveying and choosing a target are steps, while a reached place is a durable outcome', () => {
  const survey = projectTurn('Scout', 1, null, {
    operation: 'start',
    id: 'orient-next',
    title: 'Survey for a useful next base step',
    nextStep: 'Inspect the nearby chest and crafting area',
    doneWhen: 'I have identified a specific nearby spot and a concrete next building target',
    evidence: 'place_reached',
  });
  const replayed = createProjectMemory('Scout', [survey]);
  assert.equal(replayed.snapshot()[0]?.needsDefinition, true);
  assert.equal(
    replayed.propose({
      operation: 'update',
      id: 'orient-next',
      nextStep: 'Look at the empty chest',
      doneWhen: 'I have chosen what to do next',
      evidence: 'place_reached',
    }).error,
    'project_outcome_must_be_a_durable_state',
  );
  assert.equal(
    replayed.propose({
      operation: 'update',
      id: 'orient-next',
      title: 'Reach the first base point',
      nextStep: 'Walk to the empty chest and crafting table',
      doneWhen: 'I am standing beside the empty chest and crafting table',
      evidence: 'place_reached',
    }).ok,
    true,
  );

  const fresh = createProjectMemory('Scout');
  assert.equal(
    fresh.propose({
      operation: 'start',
      id: 'find-base',
      title: 'Find a base',
      nextStep: 'Survey nearby terrain',
      doneWhen: 'A suitable base location is known',
      evidence: 'place_reached',
    }).error,
    'project_place_completion_must_name_arrival',
  );
});

test('project completion requires a real witness after project start', () => {
  const startObservation = observation({ observedAt: 10, isDay: false });
  const start = projectTurn(
    'Scout',
    1,
    null,
    {
      operation: 'start',
      id: 'survive-until-dawn',
      title: 'Survive until dawn',
      nextStep: 'Remain under cover while it is night',
      doneWhen: 'I have reached dawn safely',
      evidence: 'time_elapsed',
    },
    true,
    startObservation,
  );
  const memory = createProjectMemory('Scout', [start]);

  assert.equal(
    memory.propose({ operation: 'complete', id: 'survive-until-dawn' }).error,
    'project_completion_observation_required',
  );
  const uncertifiedCommit = projectTurn('Scout', 2, start.id, {
    operation: 'complete',
    id: 'survive-until-dawn',
  });
  delete uncertifiedCommit.outcome.result.conclusion;
  assert.throws(() => memory.validate(uncertifiedCommit), /project_completion_authority_required/);

  const premature = memory.propose(
    { operation: 'complete', id: 'survive-until-dawn' },
    observation({ observedAt: 40, isDay: false }),
  );
  assert.equal(premature.ok, false);
  assert.equal(premature.error, 'project_completion_unproven');
  assert.match(premature.observed, /has not been observed/);

  const dawn = memory.propose(
    { operation: 'complete', id: 'survive-until-dawn' },
    observation({
      observedAt: 50,
      isDay: false,
      events: [
        {
          sequence: 7,
          at: 45,
          type: 'day_phase_changed',
          data: { previous: 'night', current: 'dawn' },
        },
      ],
    }),
  );
  assert.equal(dawn.ok, true);
  assert.equal(dawn.evidence.satisfied, true);
  assert.match(dawn.evidence.observed, /dawn/);
});

test('an ambient nearby block change cannot complete an inhabitant project', () => {
  const start = projectTurn(
    'Scout',
    1,
    null,
    {
      operation: 'start',
      id: 'stock-chest',
      title: 'Stock the chest',
      nextStep: 'Put one sign in the chest',
      doneWhen: 'The chest contains one spruce sign',
      evidence: 'world_change',
    },
    true,
    observation({ observedAt: 10 }),
  );
  const memory = createProjectMemory('Scout', [start]);

  assert.equal(
    memory.propose({ operation: 'complete', id: 'stock-chest' }, observation({ observedAt: 40 }))
      .error,
    'project_completion_unproven',
  );

  const changed = memory.propose(
    { operation: 'complete', id: 'stock-chest' },
    observation({
      observedAt: 50,
      events: [
        {
          sequence: 8,
          at: 45,
          type: 'block_changed_nearby',
          data: { position: { x: 1, y: 64, z: 1 }, before: 'air', after: 'chest' },
        },
      ],
    }),
  );
  assert.equal(changed.ok, false);
  assert.equal(changed.error, 'project_completion_unproven');
  assert.match(changed.observed, /own action/);
});

test('world-change projects require the exact consequence contract for each mutation tool', () => {
  const start = projectTurn(
    'Scout',
    1,
    null,
    {
      operation: 'start',
      id: 'stock-chest',
      title: 'Stock the chest',
      nextStep: 'Put one sign in the chest',
      doneWhen: 'The chest contains one spruce sign',
      evidence: 'world_change',
    },
    true,
    observation({ observedAt: 10 }),
  );
  const unprovedTransfer: EntityTurn = {
    ...projectTurn('Scout', 2, start.id, { operation: 'complete', id: 'unused' }),
    action: {
      id: 'deposit-2',
      name: 'deposit_in_container',
      input: { name: 'spruce_sign', count: 1 },
      source: 'llm',
      kind: 'exclusive',
      toolCallId: null,
    },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: { ok: true, requested: 1 },
    },
  };
  const memory = createProjectMemory('Scout', [start, unprovedTransfer]);

  assert.equal(
    memory.propose({ operation: 'complete', id: 'stock-chest' }, observation()).error,
    'project_completion_unproven',
  );

  memory.record({
    ...unprovedTransfer,
    id: 'Scout:turn:3',
    sequence: 3,
    parentId: unprovedTransfer.id,
    action: { ...unprovedTransfer.action, id: 'deposit-3' },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: {
        ok: true,
        requested: 1,
        bodyRemoved: 1,
        containerAdded: 1,
        confirmation: 'mineflayer:container_inventory_delta',
      },
    },
  });

  const complete = memory.propose(
    { operation: 'complete', id: 'stock-chest' },
    observation({ observedAt: 50 }),
  );
  assert.equal(complete.ok, true);
  assert.match(complete.evidence.observed, /deposit_in_container/);
  assert.deepEqual(complete.conclusion, {
    authority: 'inhabitant',
    worldStateCertified: false,
    meaning:
      'The inhabitant concluded its commitment from its own post-start evidence; external evaluation may independently disagree.',
  });
});

test('legacy external enclosure evidence replays but cannot authorize a new resident completion', () => {
  const start = projectTurn(
    'Scout',
    1,
    null,
    {
      operation: 'start',
      id: 'shared-shelter',
      title: 'Build a shared shelter',
      nextStep: 'Place walls around two interior body cells',
      doneWhen: 'A sealed covered space fits both Scout and the player',
      evidence: 'space_enclosed',
    },
    true,
    observation({ observedAt: 10 }),
  );
  const failedInspection: EntityTurn = {
    ...projectTurn('Scout', 2, start.id, { operation: 'complete', id: 'unused' }),
    action: {
      id: 'space-2',
      name: 'inspect_reachable_space',
      input: { feet: { x: 0, y: 64, z: 0 } },
      source: 'llm',
      kind: 'parallel',
      toolCallId: null,
    },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: {
        ok: true,
        sealed: false,
        fullyCovered: true,
        sharedCapacity: false,
        reachableCellCount: 8,
      },
    },
  };
  const memory = createProjectMemory('Scout', [start, failedInspection]);
  assert.equal(memory.snapshot()[0]?.needsDefinition, true);
  assert.equal(
    memory.propose({ operation: 'complete', id: 'shared-shelter' }, observation({ observedAt: 30 }))
      .error,
    'project_definition_repair_required',
  );

  const proof: EntityTurn = {
    ...failedInspection,
    id: 'Scout:turn:3',
    sequence: 3,
    parentId: failedInspection.id,
    action: { ...failedInspection.action, id: 'space-3' },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: {
        ok: true,
        sealed: true,
        fullyCovered: true,
        sharedCapacity: true,
        closableEntranceCount: 0,
        reachableCellCount: 2,
      },
    },
  };
  proof.outcome.result.closableEntranceCount = 1;
  const exactExternalInspection = {
    ...proof,
    id: 'Scout:turn:4',
    sequence: 4,
    parentId: proof.id,
    action: { ...proof.action, id: 'space-4' },
  };
  memory.record(exactExternalInspection);
  assert.equal(
    memory.propose({ operation: 'complete', id: 'shared-shelter' }, observation({ observedAt: 40 }))
      .error,
    'project_definition_repair_required',
  );

  const repaired = memory.propose({
    operation: 'update',
    id: 'shared-shelter',
    nextStep: 'Place and personally witness the final shelter block',
    doneWhen: 'I have made and witnessed the final planned shelter change',
    evidence: 'world_change',
  });
  assert.equal(repaired.ok, true);

  // Immutable histories that already contain an old successful completion
  // remain readable even though the current resident contract cannot create it.
  const legacyComplete = projectTurn('Scout', 5, exactExternalInspection.id, {
    operation: 'complete',
    id: 'shared-shelter',
  });
  assert.deepEqual(
    createProjectMemory('Scout', [
      start,
      failedInspection,
      proof,
      exactExternalInspection,
      legacyComplete,
    ]).snapshot(),
    [],
  );
});

test('a no-op arrival cannot complete a place-reached project', () => {
  const startPosition = { x: 10.5, y: 64, z: 10.5 };
  const start = projectTurn(
    'Scout',
    1,
    null,
    {
      operation: 'start',
      id: 'reach-base',
      title: 'Reach the base',
      nextStep: 'Walk to the chest',
      doneWhen: 'I have arrived beside the chest',
      evidence: 'place_reached',
    },
    true,
    observation({ observedAt: 10, position: startPosition }),
  );
  const memory = createProjectMemory('Scout', [start]);

  const noOp = memory.propose(
    { operation: 'complete', id: 'reach-base' },
    observation({ observedAt: 30, position: { ...startPosition } }),
  );
  assert.equal(noOp.error, 'project_completion_unproven');
  assert.match(noOp.observed, /0 blocks/);

  const arrived = memory.propose(
    { operation: 'complete', id: 'reach-base' },
    observation({ observedAt: 40, position: { x: 12, y: 64, z: 10.5 } }),
  );
  assert.equal(arrived.ok, true);
  assert.equal(arrived.evidence.witness.displacement, 1.5);
});
