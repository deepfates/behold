import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessMinecraftInventoryGain,
  minecraftInventoryGainSpecification,
  minecraftInventoryGainSpecificationSha256,
} from '../src/evaluation/minecraft-inventory-gain';

test('persisted inventory gain is scored from an exact life and a fresh body restart', () => {
  const fixture = assessmentFixture();
  const assessment = assessMinecraftInventoryGain(fixture);
  assert.equal(assessment.status, 'passed');
  assert.deepEqual(assessment.failed, []);
  assert.equal(assessment.binding?.initialCount, 0);
  assert.equal(assessment.binding?.terminalCount, 1);
  assert.equal(assessment.binding?.persistedGain, 1);
  assert.equal(assessment.binding?.providerCalls, 1);
  assert.deepEqual(assessment.binding?.actions, [
    {
      sequence: 1,
      name: 'dig_block',
      ok: true,
      terminalEvent: 'action_completed',
    },
  ]);
});

test('inventory gain assessment rejects coaching, copied life, ambient gain, and weak witnesses', () => {
  const mutations: Array<[string, (fixture: ReturnType<typeof assessmentFixture>) => void]> = [
    [
      'actConfiguration',
      (fixture) => (fixture.actEvents[0].data.controller.allowTools = ['dig_block']),
    ],
    ['actConfiguration', (fixture) => (fixture.actEvents[0].data.task = 'Dig the oak log now')],
    ['exactBody', (fixture) => (fixture.restartEvents[1].data.self.body.uuid = 'other-body')],
    ['providerBudget', (fixture) => (fixture.actEvents[1].data.call.admissions = [])],
    ['exactLife', (fixture) => (fixture.lifeTurns[0].outcome.ok = false)],
    ['exactEpisode', (fixture) => (fixture.episodeDefinition.suite.caseId = 'other-case')],
    [
      'bodyReportedGain',
      (fixture) => {
        fixture.actEvents[2].data.nextObservation.events = [];
      },
    ],
    [
      'gainObservedBeforeStop',
      (fixture) => {
        fixture.actEvents[2].data.nextObservation.self.inventory = [];
      },
    ],
    ['gainPersisted', (fixture) => (fixture.restartEvents[1].data.self.inventory = [])],
  ];
  for (const [expectedFailure, mutate] of mutations) {
    const fixture = assessmentFixture();
    mutate(fixture);
    const assessment = assessMinecraftInventoryGain(fixture);
    assert.equal(assessment.status, 'failed', expectedFailure);
    assert.ok(assessment.failed.includes(expectedFailure), JSON.stringify(assessment.failed));
  }
});

test('inventory gain specification is narrow, bounded, and content addressed', () => {
  const specification = minecraftInventoryGainSpecification({
    item: 'oak_log',
    minimumGain: 1,
    turns: 4,
    providerCalls: 8,
  });
  assert.match(specification.task, /End this episode with at least 1 more oak_log/);
  assert.match(specification.task, /Choose how/);
  assert.doesNotMatch(specification.task, /dig_block|mine|walk|face/);
  assert.match(minecraftInventoryGainSpecificationSha256(specification), /^[a-f0-9]{64}$/);
  assert.throws(() => minecraftInventoryGainSpecification({ item: 'oak log' }), /item is invalid/);
  assert.throws(
    () => minecraftInventoryGainSpecification({ item: 'oak_log', turns: 33 }),
    /turn budget/,
  );
});

function assessmentFixture(): any {
  const specification = minecraftInventoryGainSpecification({
    item: 'oak_log',
    minimumGain: 1,
    turns: 4,
    providerCalls: 8,
  });
  const life = {
    protocol: 'behold.entity-life-range.v1',
    entityId: 'Gatherer',
    circleId: 'history-a',
    life: { v: 1, kind: 'loom', loomId: 'lync:life' },
    start: { v: 1, kind: 'turn', loomId: 'lync:life', turnId: 'turn-1' },
    end: { v: 1, kind: 'turn', loomId: 'lync:life', turnId: 'turn-1' },
    sequences: { start: 1, end: 1 },
  };
  const entityTurn = {
    protocol: 'behold.entity-turn.v1',
    id: 'Gatherer:turn:1',
    entityId: 'Gatherer',
    sequence: 1,
    parentId: null,
    model: 'test/model',
    startedAt: 10,
    completedAt: 20,
    observation: observation([]),
    utterance: null,
    action: {
      id: 'intent-1',
      name: 'dig_block',
      input: { target: 'block:overworld:1:64:1' },
      source: 'llm',
      kind: 'exclusive',
      toolCallId: 'call-1',
    },
    outcome: { ok: true, eventType: 'action_completed', result: { ok: true } },
    nextObservation: {
      ...observation([{ name: 'oak_log', count: 1 }]),
      events: [
        {
          type: 'inventory_changed',
          isNew: true,
          data: { added: [{ name: 'oak_log', count: 1 }] },
        },
      ],
    },
  };
  return {
    specification,
    expected: {
      worldId: 'history-a',
      entityId: 'Gatherer',
      bodyUsername: 'SavedBody',
      model: 'test/model',
      mind: 'direct',
      actRunId: 'act-run',
      restartRunId: 'restart-run',
    },
    actEvents: [
      {
        type: 'run_started',
        data: {
          runId: 'act-run',
          circle: { id: 'history-a' },
          model: 'test/model',
          task: specification.task,
          priorEntityTurns: 0,
          controller: {
            mindAdapter: 'direct',
            policyProfile: 'neutral-benchmark-v1',
            actionProfile: 'minecraft-player-v1',
            safetyProfile: 'vanilla-player-v1',
            maxTurnSteps: 4,
            resumeAfterBudget: false,
            allowTools: null,
          },
        },
      },
      {
        type: 'model_turn',
        data: { observation: observation([]), call: { admissions: [{ ordinal: 1 }] } },
      },
      { type: 'entity_turn', data: entityTurn },
    ],
    restartEvents: [
      {
        type: 'run_started',
        data: {
          runId: 'restart-run',
          circle: { id: 'history-a' },
          priorEntityTurns: 1,
          model: 'test/model',
          controller: {
            mindAdapter: 'direct',
            policyProfile: 'neutral-benchmark-v1',
            actionProfile: 'minecraft-player-v1',
            safetyProfile: 'vanilla-player-v1',
            paused: true,
          },
        },
      },
      {
        type: 'local_world_ready',
        data: { self: observation([{ name: 'oak_log', count: 1 }]).self },
      },
    ],
    life,
    lifeTurns: [JSON.parse(JSON.stringify(entityTurn))],
    episodeDefinition: {
      protocol: 'behold.evaluation-episode.v1',
      suite: {
        id: 'minecraft-inventory-gain',
        version: '1',
        caseId: 'persisted-inventory-gain',
        specificationSha256: minecraftInventoryGainSpecificationSha256(specification),
      },
      life,
    },
  };
}

function observation(inventory: readonly any[]) {
  return {
    protocol: 'behold.inhabitant.v2',
    self: {
      identity: 'Gatherer',
      body: { substrate: 'minecraft', username: 'SavedBody', uuid: 'saved-body-uuid' },
      inventory,
    },
  };
}
