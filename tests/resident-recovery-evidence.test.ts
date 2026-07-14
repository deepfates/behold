import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessResidentRecoveryWitness,
  RESIDENT_RECOVERY_WITNESS_PHASE_PROTOCOL,
  RESIDENT_RECOVERY_WITNESS_PROTOCOL,
  summarizeResidentRecoverySource,
} from '../scripts/resident-recovery-evidence';

const digest = 'a'.repeat(64);

function report() {
  return {
    protocol: RESIDENT_RECOVERY_WITNESS_PROTOCOL,
    source: {
      entityId: 'WrenLife',
      worldId: 'first-life-v1',
      managedRunId: 'first-life-v1-50',
      model: 'openai/gpt-5.4-mini',
      urgentModel: 'openai/gpt-5.4-mini',
      task: null,
      target: null,
      controller: { kind: 'llm', mindAdapter: 'direct', allowTools: null },
      initial: sample(2, { health: 2, food: 13, oxygen: 20 }),
      urgency: {
        journalSequence: 2,
        eventSequence: 3,
        atMs: 100,
        type: 'condition_changed',
        salience: 'urgent',
        source: 'body',
        condition: { health: 2, food: 13, oxygen: 20 },
      },
      nadir: sample(2, { health: 2, food: 13, oxygen: 20 }),
      final: sample(5, { health: 2, food: 13, oxygen: 20 }),
      recoveryActions: [
        {
          journalSequence: 4,
          turnSequence: 50,
          completedAt: 300,
          source: 'llm',
          name: 'toggle_block',
          kind: 'shelter',
          selectedFromCriticalBody: true,
          outcomeOk: true,
          bodyMoved: false,
          bodyDisplacement: 0,
          positionAfter: { x: 53.5, y: 65, z: 91.5 },
          mutationPositions: [{ x: 53, y: 66, z: 92 }],
          confirmation: 'mineflayer:blockUpdate',
          modelCall: {
            protocol: 'behold.model-call.v1',
            requestId: 'model-live-1',
            adapter: 'direct-openrouter',
            model: 'openai/gpt-5.4-mini',
            provider: 'OpenAI',
            admission: {
              protocol: 'behold.cognition-admission.v1',
              brokerId: 'cognition-live-1',
              purpose: 'resident_decision',
              priority: 'urgent',
              urgentTriggerSequence: 3,
            },
          },
        },
      ],
      deathEvents: [],
      journalSha256Before: digest,
      journalSha256After: digest,
      loomSha256Before: digest,
      loomSha256After: digest,
    },
    witness: {
      protocol: RESIDENT_RECOVERY_WITNESS_PHASE_PROTOCOL,
      entityId: 'WrenLife',
      worldId: 'first-life-v1',
      managedRunId: 'first-life-v1-51',
      source: 'fresh_minecraft_connection',
      authority: 'external_evaluator',
      worldStateCertified: true,
      position: { x: 53.5, y: 65, z: 91.5 },
      condition: { health: 2, food: 13, oxygen: 20 },
      priorTurns: 50,
      resultingTurns: 50,
      inspection: {
        ok: true,
        source: 'loaded_local_terrain',
        sealed: true,
        fullyCovered: true,
        protectedRegionCellCount: 1,
        closableEntranceCount: 1,
        problems: ['fewer than two reachable body cells fit'],
      },
    },
    lifecycle: { verified: true },
    finalOwnership: { control: 'clear', port: 'clear', leases: 'clear' },
  };
}

test('independent sealed single-body cover proves a causal recovery that persists across restart', () => {
  const assessment = assessResidentRecoveryWitness(report());
  assert.equal(assessment.pass, true);
  assert.equal(assessment.measurements.shelterRecovery, true);
  assert.equal(assessment.measurements.sourceHealthImproved, false);
  assert.equal(assessment.measurements.shelter.protectedRegionCellCount, 1);
});

test('resident nourishment plus source-run improvement is an alternative recovery route', () => {
  const input = report();
  input.source.final.condition.health = 6;
  input.source.recoveryActions[0] = {
    ...input.source.recoveryActions[0],
    name: 'consume',
    kind: 'nourishment',
    mutationPositions: [],
  };
  input.witness.inspection.sealed = false;
  input.witness.inspection.fullyCovered = false;
  input.witness.inspection.closableEntranceCount = 0;
  input.witness.condition.health = 6;
  const assessment = assessResidentRecoveryWitness(input);
  assert.equal(assessment.pass, true);
  assert.equal(assessment.measurements.vitalityRecovery, true);
  assert.equal(assessment.measurements.shelterRecovery, false);
});

test('later passive regeneration cannot retroactively turn unrelated work into recovery', () => {
  const input = report();
  input.witness.inspection.sealed = false;
  input.witness.inspection.fullyCovered = false;
  input.witness.inspection.closableEntranceCount = 0;
  input.witness.condition.health = 8;
  const assessment = assessResidentRecoveryWitness(input);
  assert.equal(assessment.pass, false);
  assert.equal(assessment.measurements.sourceHealthImproved, false);
  assert.equal(assessment.assertions.recoveryCompletedBeforeRestart, false);
});

test('a controller claim, displaced body, mutated autobiography, or witness-written memory cannot pass', () => {
  const input = report();
  input.witness.source = 'controller_report';
  input.witness.position.x = 60;
  input.witness.resultingTurns = 51;
  input.source.loomSha256After = 'b'.repeat(64);
  const assessment = assessResidentRecoveryWitness(input);
  assert.equal(assessment.pass, false);
  assert.equal(assessment.assertions.freshMinecraftWitness, false);
  assert.equal(assessment.assertions.persistedBodyPosition, false);
  assert.equal(assessment.assertions.inhabitantLoomUnchanged, false);
  assert.equal(assessment.assertions.witnessDidNotWriteResidentMemory, false);
});

test('a task, allowlist, or scripted/unbrokered recovery choice cannot pass as untasked life', () => {
  const input = report();
  input.source.task = 'escape-the-test';
  input.source.controller.allowTools = ['move_direction'];
  input.source.recoveryActions[0].modelCall = null;
  const assessment = assessResidentRecoveryWitness(input);
  assert.equal(assessment.pass, false);
  assert.equal(assessment.assertions.untaskedResident, false);
  assert.equal(assessment.assertions.unrestrictedResidentSurface, false);
  assert.equal(assessment.assertions.brokerAdmittedRealModelDecision, false);
});

test('death or missing body telemetry cannot masquerade as a completed recovery', () => {
  const input = report();
  input.source.nadir.condition = { health: null, food: null, oxygen: null };
  input.source.deathEvents = [{ type: 'died', source: 'body' }];
  const assessment = assessResidentRecoveryWitness(input);
  assert.equal(assessment.pass, false);
  assert.equal(assessment.assertions.sourceBodyWasCritical, false);
  assert.equal(assessment.assertions.noDeathBeforeRestart, false);
});

test('a resident-authored escape can recover oxygen and persist through restart', () => {
  const input = report();
  input.source.initial.condition = { health: 20, food: 20, oxygen: 20 };
  input.source.urgency.condition = { health: 20, food: 20, oxygen: 5 };
  input.source.nadir.condition = { health: 20, food: 20, oxygen: 5 };
  input.source.final.condition = { health: 20, food: 20, oxygen: 20 };
  input.source.recoveryActions = [
    {
      ...input.source.recoveryActions[0],
      name: 'move_direction',
      kind: 'movement',
      outcomeOk: true,
      bodyMoved: true,
      bodyDisplacement: 3,
      positionAfter: { x: 53.5, y: 65, z: 91.5 },
      mutationPositions: [],
    },
  ];
  input.witness.condition = { health: 20, food: 20, oxygen: 20 };

  const assessment = assessResidentRecoveryWitness(input);

  assert.equal(assessment.pass, true);
  assert.equal(assessment.measurements.sourceOxygenImproved, true);
  assert.equal(assessment.measurements.witnessedOxygenPersisted, true);
  assert.equal(assessment.measurements.vitalityRecovery, true);
});

test('source summarization binds body urgency, nadir, resident action, improvement, and final state', () => {
  const events = [
    envelope(1, 'run_started', {
      runId: 'first-life-v1-50',
      circle: { id: 'first-life-v1' },
      entityLoom: '/tmp/WrenLife.lync',
    }),
    envelope(2, 'observation', {
      sequence: 3,
      observedAt: 100,
      self: body(2),
      events: [
        {
          sequence: 3,
          at: 99,
          type: 'condition_changed',
          salience: 'urgent',
          source: 'body',
          data: { current: { health: 2, food: 13, oxygen: 20 } },
        },
      ],
    }),
    envelope(3, 'entity_turn', {
      sequence: 40,
      startedAt: 150,
      completedAt: 200,
      attention: {
        mode: 'urgent',
        context: 'current_body_and_continuity',
        triggers: [{ sequence: 3, type: 'condition_changed', salience: 'urgent' }],
      },
      observation: { sequence: 3, self: body(2), events: [] },
      action: { id: 'llm-recovery-1', name: 'consume', source: 'llm' },
      outcome: { ok: true, result: { ok: true, confirmation: 'mineflayer:health' } },
      nextObservation: { sequence: 8, self: body(6), events: [] },
    }),
    envelope(4, 'observation', {
      sequence: 9,
      observedAt: 220,
      self: body(6),
      events: [],
    }),
  ];

  events.splice(
    2,
    0,
    envelope(3, 'model_turn', {
      intent: { id: 'llm-recovery-1', source: 'llm', tool: 'consume' },
      call: {
        protocol: 'behold.model-call.v1',
        requestId: 'model-recovery-1',
        adapter: { name: 'direct-openrouter' },
        admissions: [
          {
            protocol: 'behold.cognition-admission.v1',
            brokerId: 'cognition-recovery-1',
            purpose: 'resident_decision',
            priority: 'urgent',
            urgentTriggerSequence: 3,
          },
        ],
        request: { model: 'openai/gpt-5.4-mini' },
        response: { provider: 'OpenAI' },
      },
    }),
  );

  const source = summarizeResidentRecoverySource(events, 'WrenLife', 'first-life-v1');
  assert.equal(source.initial.condition.health, 2);
  assert.equal(source.urgency?.source, 'body');
  assert.equal(source.nadir?.condition.health, 2);
  assert.equal(source.final.condition.health, 6);
  assert.equal(source.recoveryActions.length, 1);
  assert.equal(source.recoveryActions[0].kind, 'nourishment');
  assert.equal(source.recoveryActions[0].modelCall?.provider, 'OpenAI');
  assert.deepEqual(source.deathEvents, []);
});

function sample(journalSequence: number, condition: any) {
  return {
    journalSequence,
    observationSequence: journalSequence,
    atMs: journalSequence * 100,
    phase: 'observation',
    condition,
    position: { x: 53.5, y: 65, z: 91.5 },
  };
}

function body(health: number) {
  return {
    pose: { position: { x: 53.5, y: 65, z: 91.5 } },
    condition: { health, food: 13, oxygen: 20, dimension: 'overworld', isDay: false },
  };
}

function envelope(sequence: number, type: string, data: any) {
  return {
    protocol: 'behold.run-event.v1',
    sequence,
    at: new Date(sequence * 100).toISOString(),
    agent: 'WrenLife',
    type,
    data,
  };
}
