import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessNativeBodyConformance,
  NATIVE_BODY_CONFORMANCE_PROTOCOL,
  NATIVE_BODY_PHASE_PROTOCOL,
} from '../src/evaluation/native-body-conformance';
import { createMinecraftMaterialActionRecord } from '../src/evaluation/minecraft-material-action-record';

test('native body conformance requires one bounded reposition and independently witnessed exact mutation', () => {
  const report = passingReport();
  const assessment = assessNativeBodyConformance(report);
  assert.equal(assessment.pass, true);
  assert.ok(Object.values(assessment.assertions).every(Boolean));

  const cases: Array<[string, (candidate: any) => void]> = [
    ['bodyInitiallyOccupiesTarget', (candidate) => (candidate.phase.bodyBefore.x = 1.5)],
    ['fixtureSetupDeclared', (candidate) => delete candidate.phase.fixtureSetup],
    ['sameAdmittedPlayerAction', (candidate) => (candidate.phase.turn.action.input.x = 1)],
    ['boundedStepAside', (candidate) => (candidate.phase.turn.result.navigation.final.x = 4.5)],
    [
      'exactMinecraftConsequence',
      (candidate) => (candidate.phase.turn.result.changes[0].observed = false),
    ],
    [
      'inventoryConsequence',
      (candidate) => (candidate.phase.finalObservation.self.inventory[0].count = 1),
    ],
    ['independentWitness', (candidate) => (candidate.independentWitness.blocks[0].name = 'air')],
    ['cleanManagedStop', (candidate) => (candidate.finalOwnership.port = 'owned')],
  ];
  for (const [assertion, mutate] of cases) {
    const candidate = structuredClone(report);
    mutate(candidate);
    const changed = assessNativeBodyConformance(candidate);
    assert.equal(
      changed.assertions[assertion as keyof typeof changed.assertions],
      false,
      assertion,
    );
    assert.equal(changed.pass, false, assertion);
  }
});

test('native placement emits one narrow Minecraft fact only after a fresh body agrees', () => {
  const report = passingReport();
  const record = createMinecraftMaterialActionRecord(report, recordEvidence());
  assert.equal(record.status, 'passed');
  assert.ok(record.binding);
  assert.equal(record.materialBinding?.action, 'place_block');
  assert.equal(record.materialBinding?.dimension, 'overworld');
  assert.deepEqual(
    record.bundle?.records.map((candidate) => candidate.stage),
    [
      'observation',
      'proposal',
      'decision',
      'execution',
      'execution',
      'observation',
      'observation',
      'world_fact',
      'check',
    ],
  );
  const fact = record.bundle?.records.find((candidate) => candidate.stage === 'world_fact');
  assert.equal(fact?.payload.claim.data.dimension, 'overworld');
  assert.equal(fact?.payload.claim.data.blockUpdate.afterStateId, 10);
  assert.equal(fact?.payload.confirmationSources.length, 2);
  assert.ok(record.bundle?.records.at(-1)?.payload.scope.notAssessed.includes('material-effect'));
});

test('native placement refuses stale, cross-dimension, or state-disagreeing facts', () => {
  const cases: Array<[string, (candidate: any) => void]> = [
    [
      'duplicate permission',
      (candidate) => candidate.phase.turn.events.unshift(candidate.phase.turn.events[0]),
    ],
    [
      'authorization drift',
      (candidate) =>
        (candidate.phase.turn.events[1].data.authorization.authority = 'other-authority'),
    ],
    [
      'terminal intent tool drift',
      (candidate) => (candidate.phase.turn.events[2].data.intent.tool = 'dig_block'),
    ],
    [
      'terminal intent input drift',
      (candidate) => (candidate.phase.turn.events[2].data.intent.input.x = 9),
    ],
    [
      'terminal intent source drift',
      (candidate) => (candidate.phase.turn.events[2].data.intent.source = 'llm'),
    ],
    [
      'terminal result drift',
      (candidate) => (candidate.phase.turn.events[2].data.result.ok = false),
    ],
    [
      'post-terminal block update',
      (candidate) => (candidate.phase.turn.result.changes[0].confirmation.observedAt = 23),
    ],
    ['stale witness', (candidate) => (candidate.independentWitness.observedAt = 21)],
    [
      'pre-quiescence witness',
      (candidate) => (candidate.lifecycle.quiescence.at = new Date(31).toISOString()),
    ],
    [
      'pre-terminal quiescence',
      (candidate) => (candidate.lifecycle.quiescence.at = new Date(14).toISOString()),
    ],
    ['same-body witness', (candidate) => (candidate.independentWitness.entityId = 'BodyResident')],
    ['cross-dimension witness', (candidate) => (candidate.independentWitness.dimension = 'nether')],
    [
      'post-observation dimension drift',
      (candidate) =>
        (candidate.phase.turn.turn.nextObservation.self.condition.dimension = 'nether'),
    ],
    [
      'block-update dimension drift',
      (candidate) => (candidate.phase.turn.result.changes[0].confirmation.dimension = 'nether'),
    ],
    [
      'block-update position drift',
      (candidate) => (candidate.phase.turn.result.changes[0].confirmation.position.x = 9),
    ],
    ['state disagreement', (candidate) => (candidate.independentWitness.blocks[0].stateId = 11)],
  ];
  for (const [label, mutate] of cases) {
    const candidate = passingReport();
    mutate(candidate);
    const record = createMinecraftMaterialActionRecord(candidate, recordEvidence());
    assert.equal(record.status, 'failed', label);
    assert.equal(record.bundle, null, label);
    assert.equal(record.materialBinding, null, label);
  }
});

function passingReport() {
  const target = { x: 0, y: -60, z: 0 };
  const body = { x: 0.5, y: -60, z: 0.5 };
  const observation = (sequence: number, observedAt: number, count: number) => ({
    protocol: 'behold.inhabitant.v2',
    sequence,
    observedAt,
    eventWindow: {
      requestedAfterSequence: 0,
      oldestAvailableSequence: 1,
      newestAvailableSequence: sequence,
      missingBeforeOldest: 0,
      complete: true,
    },
    circle: { id: 'world', managedRunId: 'world-1' },
    self: {
      identity: 'BodyResident',
      condition: { dimension: 'overworld' },
      inventory: [{ name: 'dirt', count }],
    },
    events: [],
  });
  const initialObservation = observation(1, 10, 1);
  const finalObservation = observation(5, 25, 0);
  const action = {
    id: 'BodyResident:script:1',
    name: 'place_block',
    source: 'script',
    kind: 'exclusive',
    toolCallId: null,
    input: { ...target, name: 'dirt' },
  };
  const intent = {
    id: action.id,
    source: 'script',
    tool: action.name,
    input: action.input,
    observationSequence: 1,
    decidedAt: 11,
  };
  const authorization = {
    ok: true,
    authority: 'native-body-conformance',
    evidence: { entityId: 'BodyResident', intentId: action.id, tool: action.name },
  };
  const result = {
    ok: true,
    navigation: {
      ok: true,
      target: 'placement step-aside',
      start: body,
      final: { x: 1.5, y: -60, z: 0.5 },
    },
    changes: [
      {
        verb: 'place',
        position: target,
        before: 'air',
        after: 'dirt',
        verified: true,
        observed: true,
        confirmation: {
          source: 'mineflayer:blockUpdate',
          observedAt: 20,
          dimension: 'overworld',
          position: target,
          before: { name: 'air', stateId: 0 },
          after: { name: 'dirt', stateId: 10 },
          beforeStateId: 0,
          afterStateId: 10,
        },
      },
    ],
  };
  const events = [
    { type: 'permission_decision', at: 12, data: { intent, authorization } },
    { type: 'action_started', at: 15, data: { intent, authorization } },
    { type: 'action_completed', at: 22, data: { intent, authorization, result } },
  ];
  return JSON.parse(
    JSON.stringify({
      protocol: NATIVE_BODY_CONFORMANCE_PROTOCOL,
      repositoryRevision: 'a'.repeat(40),
      worldId: 'world',
      managedRunId: 'world-1',
      phase: {
        protocol: NATIVE_BODY_PHASE_PROTOCOL,
        repositoryRevision: 'a'.repeat(40),
        entityId: 'BodyResident',
        model: 'script/native-body-conformance-v1',
        worldId: 'world',
        managedRunId: 'world-1',
        priorTurns: 0,
        resultingTurns: 1,
        bodyBefore: body,
        target,
        fixtureSetup: {
          kind: 'pathfinder_preposition_before_recorded_action',
          destination: target,
        },
        initialObservation,
        turn: {
          turn: {
            protocol: 'behold.entity-turn.v1',
            id: 'BodyResident:turn:1',
            entityId: 'BodyResident',
            sequence: 1,
            parentId: null,
            model: 'script/native-body-conformance-v1',
            startedAt: 11,
            completedAt: 23,
            observation: initialObservation,
            utterance: { assistant: null },
            action,
            outcome: { ok: true, eventType: 'action_completed', result },
            nextObservation: finalObservation,
          },
          turnId: 'BodyResident:turn:1',
          action,
          result,
          events,
        },
        finalObservation,
      },
      independentWitness: {
        source: 'fresh_minecraft_connection',
        entityId: 'BodyWitness',
        worldId: 'world',
        managedRunId: 'world-1',
        observedAt: 30,
        dimension: 'overworld',
        blocks: [{ position: target, name: 'dirt', stateId: 10 }],
      },
      loomSha256: 'b'.repeat(64),
      lifecycle: {
        verified: true,
        tipDigest: 'c'.repeat(64),
        quiescence: {
          sequence: 4,
          at: new Date(24).toISOString(),
          digest: 'd'.repeat(64),
          reason: 'native_body_before_independent_witness',
        },
      },
      finalOwnership: { control: 'clear', port: 'clear', leases: 'clear' },
    }),
  );
}

function recordEvidence() {
  return {
    assessedAt: new Date(40).toISOString(),
    checkerRevision: 'a'.repeat(40),
    refs: {
      phase: { file: '/private/native-body-phase.json', sha256: 'd'.repeat(64) },
      witness: { file: '/private/independent-witness.json', sha256: 'e'.repeat(64) },
      life: { file: '/private/life.lync', sha256: 'f'.repeat(64) },
      lifecycle: { file: '/private/lifecycle.jsonl', sha256: '1'.repeat(64) },
    },
  };
}
