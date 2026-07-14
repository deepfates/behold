import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessCausalTurn,
  assessDecisionTurn,
  assessUncoachedDecisionTurn,
} from '../src/evaluation/causal-turn';
import { createResidentMindRequestArtifact } from '../src/mind/request-artifact';

test('a causal turn binds one exact mind input through world consequence and Lync life', () => {
  const evidence = fixture();
  const assessment = assessCausalTurn(evidence as any);
  assert.deepEqual(assessment.failed, []);
  assert.ok(assessment.binding);
  assert.equal(assessment.binding?.mind.requestSha256, evidence.request.requestSha256);
  assert.equal(assessment.binding?.mind.program?.runtime.name, 'ax');
  assert.equal(assessment.binding?.decision.actionName, 'move_direction');
  assert.equal(assessment.status, 'passed');
  assert.equal(assessment.binding?.worldAction.terminalEvent, 'action_completed');
  assert.equal(assessment.binding?.entity.life.end.turnId, 'life-turn-1');
});

test('causal turn assessment locates configuration drift, request drift, copied life, and missing witness', () => {
  const configurationDrift = fixture();
  configurationDrift.runStarted.data.task = 'Walk forward now';
  assert.ok(
    assessCausalTurn(configurationDrift as any).failed.includes('authenticatedConfiguration'),
  );

  const drifted = fixture();
  drifted.modelTurn.data.call.request.mindRequestSha256 = 'f'.repeat(64);
  assert.ok(assessCausalTurn(drifted as any).failed.includes('exactMindRequest'));

  const copied = fixture();
  copied.lifeTurn.outcome.result.distance = 99;
  assert.ok(assessCausalTurn(copied as any).failed.includes('exactLyncTurn'));

  const unwitnessed = fixture();
  unwitnessed.entityTurn.data.nextObservation.events = [];
  unwitnessed.lifeTurn.nextObservation.events = [];
  assert.ok(assessCausalTurn(unwitnessed as any).notExercised.includes('worldActionStarted'));
});

test('a matching task is authenticated without making tasklessness a framework invariant', () => {
  const tasked = fixture();
  tasked.runStarted.data.task = 'Walk forward now';
  tasked.lifecycle.events[0].data.population.residents[0].task = 'Walk forward now';
  assert.deepEqual(assessCausalTurn(tasked as any).failed, []);
  assert.ok(assessUncoachedDecisionTurn(tasked as any).failed.includes('untasked'));
});

test('uncoached decision evidence excludes required actions and provider tool forcing', () => {
  const required = fixture();
  const request = structuredClone(required.request.request) as any;
  request.requiredAction = 'move_direction';
  const requiredArtifact = createResidentMindRequestArtifact(request);
  required.modelTurn.data.call.request.mindRequest = requiredArtifact.request;
  required.modelTurn.data.call.request.mindRequestSha256 = requiredArtifact.requestSha256;
  assert.deepEqual(assessDecisionTurn(required as any).failed, []);
  assert.ok(assessUncoachedDecisionTurn(required as any).failed.includes('noRequiredAction'));

  const forced = fixture();
  forced.modelTurn.data.call.request.toolChoice = 'required';
  assert.deepEqual(assessDecisionTurn(forced as any).failed, []);
  assert.ok(assessUncoachedDecisionTurn(forced as any).failed.includes('noProviderToolChoice'));
});

test('an explicit yield is a valid recorded decision but not evidence of a world consequence', () => {
  const yielded = fixture();
  const intent = {
    id: 'yield-1',
    source: 'llm',
    tool: 'wait_for_event',
    input: { reason: 'Nothing currently calls for action.' },
  };
  (yielded.modelTurn.data as any).intent = intent;
  yielded.entityTurn.data.action = {
    id: intent.id,
    name: intent.tool,
    input: intent.input,
    source: 'llm',
    kind: 'yield',
    toolCallId: 'tool-yield-1',
  };
  yielded.entityTurn.data.outcome = {
    ok: true,
    eventType: 'wait_for_event',
    result: { ok: true, status: 'waiting_for_world_event' },
  };
  yielded.entityTurn.data.nextObservation = {
    ...structuredClone(yielded.entityTurn.data.observation),
    self: {
      ...structuredClone(yielded.entityTurn.data.observation.self),
      currentAction: null,
    },
  };
  yielded.lifeTurn = structuredClone(yielded.entityTurn.data);

  const decision = assessDecisionTurn(yielded as any);
  assert.deepEqual(decision.failed, []);
  assert.equal(decision.binding?.decision.actionKind, 'yield');
  assert.equal(decision.binding?.record.eventType, 'wait_for_event');
  assert.equal(assessUncoachedDecisionTurn(yielded as any).status, 'passed');

  const causal = assessCausalTurn(yielded as any);
  assert.ok(causal.decisionBinding);
  assert.equal(causal.status, 'not_exercised');
  assert.deepEqual(causal.failed, []);
  assert.ok(causal.notExercised.includes('worldActionProposed'));
  assert.ok(causal.notExercised.includes('worldActionStarted'));
  assert.ok(causal.notExercised.includes('terminalWorldResult'));
  assert.ok(causal.notExercised.includes('freshTerminalReobservation'));
  assert.equal(causal.binding, null);
});

test('a pre-world block records the decision without claiming the world edge was exercised', () => {
  const blocked = fixture();
  const intent = blocked.modelTurn.data.intent;
  blocked.entityTurn.data.outcome = {
    ok: false,
    eventType: 'intent_blocked',
    result: { ok: false, error: 'tool_not_allowed' },
  };
  blocked.entityTurn.data.nextObservation.events = [
    {
      sequence: 9,
      type: 'intent_blocked',
      source: 'event',
      isNew: true,
      data: { intent, result: blocked.entityTurn.data.outcome.result },
    },
  ];
  blocked.entityTurn.data.nextObservation.self.currentAction = {
    id: intent.id,
    tool: intent.tool,
    status: 'failed',
    result: blocked.entityTurn.data.outcome.result,
  };
  blocked.lifeTurn = structuredClone(blocked.entityTurn.data);

  const assessment = assessCausalTurn(blocked as any);
  assert.equal(assessment.status, 'not_exercised');
  assert.ok(assessment.decisionBinding);
  assert.ok(assessment.notExercised.includes('worldActionStarted'));
  assert.equal(assessment.binding, null);
});

test('a started world action fails causal verification when terminal delivery is not fresh', () => {
  const stale = fixture();
  stale.entityTurn.data.nextObservation.events[1].isNew = false;
  stale.lifeTurn = structuredClone(stale.entityTurn.data);

  const assessment = assessCausalTurn(stale as any);
  assert.equal(assessment.status, 'failed');
  assert.ok(assessment.failed.includes('freshTerminalReobservation'));
  assert.equal(assessment.binding, null);
});

function fixture() {
  const entityId = 'Scout';
  const worldId = 'flat-world';
  const managedRunId = 'flat-world-3';
  const request = createResidentMindRequestArtifact({
    protocol: 'behold.mind-request.v1',
    entityId,
    model: 'test/model',
    policyProfile: 'neutral-benchmark-v1',
    actionProfile: 'minecraft-player-v1',
    safetyProfile: 'vanilla-player-v1',
    observation: {
      protocol: 'behold.inhabitant.v2',
      sequence: 5,
      circle: { id: worldId, managedRunId },
      self: { identity: entityId, position: { x: 0, y: 64, z: 0 } },
      events: [],
    },
    conversation: [{ role: 'system', content: 'Use admitted affordances.' }],
    actions: [
      {
        name: 'move_direction',
        inputSchema: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['forward', 'back', 'left', 'right'] },
            distance: { type: 'integer', minimum: 1, maximum: 4 },
          },
          required: ['direction', 'distance'],
        },
      },
      {
        name: 'wait_for_event',
        inputSchema: {
          type: 'object',
          properties: { reason: { type: 'string' } },
          required: ['reason'],
        },
      },
    ],
    requiredAction: null,
    attention: { mode: 'deliberative', context: 'bounded_loom', triggers: [] },
  });
  const intent = {
    id: 'intent-1',
    source: 'llm',
    tool: 'move_direction',
    input: { direction: 'forward', distance: 2 },
  };
  const nextObservation = {
    protocol: 'behold.inhabitant.v2',
    sequence: 10,
    eventWindow: {
      requestedAfterSequence: 5,
      oldestAvailableSequence: 1,
      newestAvailableSequence: 10,
      missingBeforeOldest: 0,
      complete: true,
    },
    circle: { id: worldId, managedRunId },
    self: {
      identity: entityId,
      position: { x: 0, y: 64, z: -2 },
      currentAction: {
        id: intent.id,
        tool: intent.tool,
        status: 'completed',
        result: { ok: true, distance: 2 },
      },
    },
    events: [
      {
        sequence: 9,
        type: 'action_started',
        source: 'event',
        isNew: true,
        data: { intent },
      },
      {
        sequence: 10,
        type: 'action_completed',
        source: 'event',
        isNew: true,
        data: { intent, result: { ok: true, distance: 2 } },
      },
    ],
  };
  const turn: any = {
    protocol: 'behold.entity-turn.v1',
    circleId: worldId,
    id: 'Scout:turn:1',
    entityId,
    sequence: 1,
    parentId: null,
    model: 'test/model',
    startedAt: 10,
    completedAt: 20,
    observation: request.request.observation,
    utterance: { assistant: { role: 'assistant', content: null } },
    action: {
      id: intent.id,
      name: intent.tool,
      input: intent.input,
      source: 'llm',
      kind: 'exclusive',
      toolCallId: 'tool-1',
    },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: { ok: true, distance: 2 },
    },
    nextObservation,
  };
  const life = {
    protocol: 'behold.entity-life-range.v1',
    entityId,
    circleId: worldId,
    life: { v: 1, kind: 'loom', loomId: 'life-1' },
    start: { v: 1, kind: 'turn', loomId: 'life-1', turnId: 'life-turn-1' },
    end: { v: 1, kind: 'turn', loomId: 'life-1', turnId: 'life-turn-1' },
    sequences: { start: 1, end: 1 },
  };
  const program = {
    protocol: 'behold.mind-program-identity.v1',
    name: 'behold.resident-decision.v1',
    artifactProtocol: 'behold.ax-resident-program.v1',
    artifactSha256: 'a'.repeat(64),
    signatureSha256: 'b'.repeat(64),
    runtime: { name: 'ax', version: '23.0.0' },
  };
  const modelTurn = {
    sequence: 2,
    agent: entityId,
    type: 'model_turn',
    data: {
      model: 'test/model',
      observation: request.request.observation,
      intent,
      call: {
        protocol: 'behold.model-call.v1',
        adapter: { name: 'ax', version: '23.0.0' },
        program,
        requestId: 'call-1',
        endpoint: 'test://model',
        startedAt: 10,
        completedAt: 12,
        latencyMs: 2,
        request: {
          model: 'test/model',
          mindRequestSha256: request.requestSha256,
          mindRequest: request.request,
          messageCount: 1,
          toolCount: 2,
          toolChoice: null,
          bodySha256: 'c'.repeat(64),
          messagesSha256: 'd'.repeat(64),
          toolsSha256: 'e'.repeat(64),
          kind: 'mind_input',
        },
        response: {
          id: 'generation-1',
          model: 'test/model',
          provider: 'fixture',
          finishReason: 'stop',
          nativeFinishReason: null,
          usage: null,
        },
      },
    },
  };
  const runStarted = {
    sequence: 1,
    agent: entityId,
    type: 'run_started',
    data: {
      runId: managedRunId,
      task: null,
      controller: {
        allowTools: null,
        policyProfile: 'neutral-benchmark-v1',
        actionProfile: 'minecraft-player-v1',
        safetyProfile: 'vanilla-player-v1',
      },
    },
  };
  const entityTurn = { sequence: 3, agent: entityId, type: 'entity_turn', data: turn };
  const lifecycle = {
    world: worldId,
    epoch: 3,
    tipDigest: '1'.repeat(64),
    events: [
      {
        type: 'run_configured',
        data: {
          runId: managedRunId,
          world: { id: worldId },
          population: {
            residents: [
              {
                entityId,
                task: null,
                allowTools: null,
                policyProfile: 'neutral-benchmark-v1',
                actionProfile: 'minecraft-player-v1',
                safetyProfile: 'vanilla-player-v1',
              },
            ],
          },
        },
      },
      { type: 'run_ready', data: {} },
      { type: 'run_stopped', data: {} },
    ],
  };
  const definition = {
    protocol: 'behold.evaluation-episode.v1',
    suite: {
      id: 'neutral-causal-turn',
      version: '1',
      caseId: 'first-action',
      specificationSha256: '2'.repeat(64),
    },
    life,
  };
  return {
    request,
    expected: {
      worldId,
      managedRunId,
      entityId,
      policyProfile: 'neutral-benchmark-v1',
      actionProfile: 'minecraft-player-v1',
      safetyProfile: 'vanilla-player-v1',
    },
    runStarted,
    modelTurn,
    entityTurn,
    life,
    lifeTurn: structuredClone(turn),
    episode: {
      definition,
      loomReference: { v: 1, kind: 'loom', loomId: 'episode-1' },
      definitionReference: {
        v: 1,
        kind: 'turn',
        loomId: 'episode-1',
        turnId: 'episode-definition-1',
      },
    },
    lifecycle,
    runJournalSha256: '3'.repeat(64),
    worldLifecycleSha256: '4'.repeat(64),
  };
}
