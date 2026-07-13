import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessOwnedWorldProjectEvidence,
  hasCompletedProjectMilestone,
  hasInterruptedProjectMilestone,
  type BlockPosition,
  type ProjectWorldWitness,
} from '../scripts/owned-world-project-evidence';
import type { RunJournalEvent } from '../scripts/owned-world-model-evidence';

const firstPosition = { x: 2, y: -60, z: 2 };
const secondPosition = { x: 3, y: -60, z: 2 };
const nextStep = 'Place the remaining second cobblestone block adjacent to the first marker block';
const expected = {
  worldId: 'behold-owned-flat-v1',
  entityId: 'ProjectResident',
  model: 'test/model',
  task: 'build one restart-worthy landmark',
  projectId: 'spawn-landmark',
  material: 'cobblestone',
  worksiteY: -60,
  maxHorizontalCoordinate: 8,
  actRunId: 'behold-owned-flat-v1-1',
  resumeRunId: 'behold-owned-flat-v1-2',
  contextBudget: {
    maxTotalPromptTokens: 100,
    maxPromptTokensPerCall: 20,
    maxRequestBodyChars: 50_000,
  },
};

test('project evidence requires an interrupted physical commitment resumed without repetition', () => {
  const { act, resume, firstWitness, finalWitness } = validEvidence();
  const assessed = assessOwnedWorldProjectEvidence(
    act,
    resume,
    firstWitness,
    finalWitness,
    expected,
  );

  assert.deepEqual(assessed.failed, []);
  assert.deepEqual(assessed.firstPosition, firstPosition);
  assert.deepEqual(assessed.secondPosition, secondPosition);
  assert.equal(assessed.usage.callCount, 9);
  assert.equal(assessed.assertions.contextBudgetSatisfied, true);
  assert.equal(hasInterruptedProjectMilestone(act, expected.projectId, expected.material), true);
  assert.equal(
    hasCompletedProjectMilestone(resume, expected.projectId, expected.material, firstPosition),
    true,
  );
});

test('project evidence fails closed when production context exceeds its declared budget', () => {
  const evidence = validEvidence();
  const overBudget = structuredClone(evidence.resume);
  modelEvent(overBudget, 'place_block').data.call.response.usage.prompt_tokens = 1000;

  assert.ok(
    assessOwnedWorldProjectEvidence(
      evidence.act,
      overBudget,
      evidence.firstWitness,
      evidence.finalWitness,
      expected,
    ).failed.includes('contextBudgetSatisfied'),
  );
});

test('project budget includes loom-fold calls and their failures', () => {
  const evidence = validEvidence();
  const auxiliary = structuredClone(modelEvent(evidence.resume, 'place_block').data.call);
  auxiliary.request.body.tools = undefined;
  auxiliary.request.toolCount = 0;
  auxiliary.response.id = 'fold-response';
  auxiliary.response.usage = {
    prompt_tokens: 15,
    completion_tokens: 5,
    total_tokens: 20,
    cost: 0.0001,
  };
  evidence.resume.push(
    envelope(evidence.resume.length + 1, 'model_auxiliary_call', {
      purpose: 'loom_fold',
      call: auxiliary,
    }),
  );

  const assessed = assessOwnedWorldProjectEvidence(
    evidence.act,
    evidence.resume,
    evidence.firstWitness,
    evidence.finalWitness,
    expected,
  );
  assert.equal(assessed.usage.callCount, 10);
  assert.equal(assessed.usage.promptTokens, 105);
  assert.equal(assessed.assertions.contextBudgetSatisfied, false);

  evidence.resume.push(
    envelope(evidence.resume.length + 1, 'model_auxiliary_call_failed', {
      purpose: 'loom_fold',
      error: 'rate limited',
    }),
  );
  assert.equal(
    assessOwnedWorldProjectEvidence(
      evidence.act,
      evidence.resume,
      evidence.firstWitness,
      evidence.finalWitness,
      expected,
    ).assertions.noModelCallFailed,
    false,
  );
});

test('project evidence rejects early completion and forced model choice', () => {
  const evidence = validEvidence();
  const lateProject = structuredClone(evidence.act);
  moveEntityAfter(lateProject, 'manage_project', 'start', 'place_block');
  assert.ok(
    assessOwnedWorldProjectEvidence(
      lateProject,
      evidence.resume,
      evidence.firstWitness,
      evidence.finalWitness,
      expected,
    ).failed.includes('projectStartedBeforeConstruction'),
  );
  assert.equal(
    hasInterruptedProjectMilestone(lateProject, expected.projectId, expected.material),
    false,
  );

  const early = structuredClone(evidence.act);
  const update = entityEvent(early, 'manage_project', 'update');
  update.data.action.input.operation = 'complete';
  update.data.action.input.nextStep = undefined;
  update.data.outcome.result.operation = 'complete';
  assert.ok(
    assessOwnedWorldProjectEvidence(
      early,
      evidence.resume,
      evidence.firstWitness,
      evidence.finalWitness,
      expected,
    ).failed.includes('firstLifeDidNotClaimCompletion'),
  );
  assert.equal(hasInterruptedProjectMilestone(early, expected.projectId, expected.material), false);

  const forced = structuredClone(evidence.act);
  const placementDecision = modelEvent(forced, 'place_block');
  placementDecision.data.call.request.toolChoice = {
    type: 'function',
    function: { name: 'place_block' },
  };
  assert.ok(
    assessOwnedWorldProjectEvidence(
      forced,
      evidence.resume,
      evidence.firstWitness,
      evidence.finalWitness,
      expected,
    ).failed.includes('modelFreelyChoseEveryCriticalStep'),
  );
});

test('project evidence rejects repeated or non-adjacent restart work', () => {
  const evidence = validEvidence();
  const repeated = structuredClone(evidence.resume);
  movePlacement(repeated, firstPosition);
  assert.ok(
    assessOwnedWorldProjectEvidence(
      evidence.act,
      repeated,
      evidence.firstWitness,
      evidence.finalWitness,
      expected,
    ).failed.includes('restartDidNotRepeatTheCompletedPlacement'),
  );
  assert.equal(
    hasCompletedProjectMilestone(repeated, expected.projectId, expected.material, firstPosition),
    false,
  );

  const remote = structuredClone(evidence.resume);
  movePlacement(remote, { x: 7, y: -60, z: 7 });
  assert.ok(
    assessOwnedWorldProjectEvidence(
      evidence.act,
      remote,
      evidence.firstWitness,
      evidence.finalWitness,
      expected,
    ).failed.includes('restartBuiltOneDistinctAdjacentBlock'),
  );
});

test('project evidence rejects missing restart memory, restatement, or external witness', () => {
  const evidence = validEvidence();
  const forgotten = structuredClone(evidence.resume);
  const firstDecision = forgotten.find((event) => event.type === 'model_turn')!;
  const user = firstDecision.data.call.request.body.messages.find(
    (message: any) => message.role === 'user',
  );
  const observation = JSON.parse(
    user.content.slice(
      user.content.indexOf('\n') + 1,
      user.content.lastIndexOf('\nPrevious action:'),
    ),
  );
  observation.self.projects = [];
  user.content = `New world experience:\n${JSON.stringify(observation)}\nPrevious action: none`;
  assert.ok(
    assessOwnedWorldProjectEvidence(
      evidence.act,
      forgotten,
      evidence.firstWitness,
      evidence.finalWitness,
      expected,
    ).failed.includes('restartReceivedActiveProjectAndMaterial'),
  );

  const noRestatement = structuredClone(evidence.resume);
  const update = entityEvent(noRestatement, 'manage_project', 'update');
  update.data.action.input.nextStep = 'look around';
  assert.ok(
    assessOwnedWorldProjectEvidence(
      evidence.act,
      noRestatement,
      evidence.firstWitness,
      evidence.finalWitness,
      expected,
    ).failed.includes('restartFirstRestatedTheUnfinishedCommitment'),
  );

  const falseWitness: any = structuredClone(evidence.firstWitness);
  falseWitness.blocks[0].name = 'air';
  assert.ok(
    assessOwnedWorldProjectEvidence(
      evidence.act,
      evidence.resume,
      falseWitness,
      evidence.finalWitness,
      expected,
    ).failed.includes('independentBodySawThePartialBuild'),
  );
});

function validEvidence() {
  const actTurns = [
    collection('collect-material'),
    action('manage_project', 'start-project', {
      operation: 'start',
      id: expected.projectId,
      title: 'Build a two-block spawn landmark',
      nextStep: 'Collect the cobblestone stack and place the first marker block',
      doneWhen: 'Two adjacent cobblestone blocks form a durable marker beside spawn',
      evidence: 'world_change',
    }),
    placement('place-first', firstPosition),
    action('manage_project', 'record-partial', {
      operation: 'update',
      id: expected.projectId,
      nextStep,
    }),
    action('wait_for_event', 'yield-first', { reason: 'first block is witnessed' }),
  ];
  const resumeObservation = observation(expected.resumeRunId, true);
  const resumeTurns = [
    action('manage_project', 'restate-project', {
      operation: 'update',
      id: expected.projectId,
      nextStep,
    }),
    placement('place-second', secondPosition),
    action('manage_project', 'complete-project', {
      operation: 'complete',
      id: expected.projectId,
    }),
    action('wait_for_event', 'yield-complete', { reason: 'landmark complete' }),
  ];
  const act = journal(expected.actRunId, false, actTurns, observation(expected.actRunId, false));
  const resume = journal(expected.resumeRunId, true, resumeTurns, resumeObservation);
  return {
    act,
    resume,
    firstWitness: witness(expected.actRunId, [firstPosition]),
    finalWitness: witness(expected.resumeRunId, [firstPosition, secondPosition]),
  };
}

function journal(runId: string, resumed: boolean, turns: any[], frame: any) {
  const events: RunJournalEvent[] = [
    envelope(1, 'run_started', {
      runId,
      model: expected.model,
      task: expected.task,
      priorEntityTurns: resumed ? 5 : 0,
    }),
  ];
  for (const turn of turns) {
    const sequence = events.length + 1;
    events.push(envelope(sequence, 'model_turn', modelTurn(runId, turn, frame, resumed)));
    events.push(envelope(sequence + 1, 'entity_turn', turn));
  }
  return events;
}

function modelTurn(runId: string, turn: any, frame: any, resumed: boolean) {
  const callId = String(turn.action.toolCallId);
  const toolName = String(turn.action.name);
  const prompt = structuredClone(frame);
  prompt.circle.managedRunId = runId;
  return {
    observation: prompt,
    assistant: {
      role: 'assistant',
      content: `I will use ${toolName}`,
      tool_calls: [
        {
          id: callId,
          function: { name: toolName, arguments: JSON.stringify(turn.action.input) },
        },
      ],
    },
    intent:
      toolName === 'wait_for_event'
        ? null
        : {
            id: turn.action.id,
            source: 'llm',
            tool: toolName,
            input: turn.action.input,
          },
    call: {
      protocol: 'behold.model-call.v1',
      latencyMs: 10,
      request: {
        model: expected.model,
        toolChoice: 'auto',
        body: {
          messages: [
            ...(resumed
              ? [
                  {
                    role: 'tool',
                    content: JSON.stringify({
                      projectId: expected.projectId,
                      confirmation: { source: 'mineflayer:blockUpdate' },
                      position: firstPosition,
                    }),
                  },
                ]
              : []),
            {
              role: 'user',
              content: `New world experience:\n${JSON.stringify(prompt)}\nPrevious action: none`,
            },
          ],
          tools: ['manage_project', 'collect_nearby_item', 'inspect_volume', 'place_block'].map(
            (name) => ({ function: { name } }),
          ),
        },
      },
      response: {
        id: `${callId}-response`,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 },
      },
    },
  };
}

function action(name: string, callId: string, input: any) {
  const intentId = name === 'wait_for_event' ? callId : `${callId}-intent`;
  const result: any = { ok: true };
  if (name === 'manage_project') {
    result.operation = input.operation;
    result.project = { id: input.id, nextStep: input.nextStep ?? null };
    if (input.operation === 'complete') {
      result.evidence = { satisfied: true, expected: 'world_change' };
    }
  }
  return {
    action: {
      id: intentId,
      name,
      input,
      source: 'llm',
      toolCallId: callId,
    },
    outcome: {
      ok: true,
      eventType: name === 'wait_for_event' ? 'wait_for_event' : 'action_completed',
      result,
    },
  };
}

function collection(callId: string) {
  const turn = action('collect_nearby_item', callId, { name: expected.material });
  turn.outcome.result = {
    ok: true,
    item: expected.material,
    confirmation: 'mineflayer:playerCollect',
  };
  (turn as any).nextObservation = observation(expected.actRunId, false);
  (turn as any).nextObservation.self.inventory = [{ name: expected.material, count: 2 }];
  return turn;
}

function placement(callId: string, position: BlockPosition) {
  const turn = action('place_block', callId, { ...position, name: expected.material });
  turn.outcome.result = {
    ok: true,
    item: expected.material,
    changes: [
      {
        verb: 'place',
        verified: true,
        position: { ...position },
        after: expected.material,
        confirmation: { source: 'mineflayer:blockUpdate' },
      },
    ],
  };
  return turn;
}

function observation(runId: string, resumed: boolean) {
  return {
    protocol: 'behold.inhabitant.v1',
    circle: { id: expected.worldId, managedRunId: runId },
    self: {
      identity: expected.entityId,
      inventory: resumed ? [{ name: expected.material, count: 1 }] : [],
      projects: resumed
        ? [
            {
              id: expected.projectId,
              title: 'Build a two-block spawn landmark',
              nextStep,
              doneWhen: 'Two adjacent cobblestone blocks form a durable marker beside spawn',
              evidence: 'world_change',
            },
          ]
        : [],
    },
    scene: { entities: [] },
    events: [],
    eventWindow: { omittedNewEvents: 0 },
  };
}

function witness(runId: string, positions: BlockPosition[]): ProjectWorldWitness {
  return {
    entityId: runId === expected.actRunId ? 'ProjectWitnessAct' : 'ProjectWitnessResume',
    worldId: expected.worldId,
    managedRunId: runId,
    source: 'fresh_minecraft_connection',
    observedAt: 100,
    blocks: positions.map((position) => ({
      position: { ...position },
      name: expected.material,
      stateId: 1,
    })),
  };
}

function envelope(sequence: number, type: string, data: any): RunJournalEvent {
  return {
    sequence,
    at: new Date(sequence).toISOString(),
    agent: expected.entityId,
    type,
    data,
  };
}

function entityEvent(events: RunJournalEvent[], name: string, operation?: string) {
  const event = events.find(
    (candidate) =>
      candidate.type === 'entity_turn' &&
      candidate.data.action.name === name &&
      (operation == null || candidate.data.action.input.operation === operation),
  );
  assert.ok(event, `missing entity event ${name}/${operation || '*'}`);
  return event;
}

function modelEvent(events: RunJournalEvent[], name: string) {
  const event = events.find(
    (candidate) =>
      candidate.type === 'model_turn' &&
      candidate.data.assistant.tool_calls[0].function.name === name,
  );
  assert.ok(event, `missing model event ${name}`);
  return event;
}

function movePlacement(events: RunJournalEvent[], position: BlockPosition) {
  const event = entityEvent(events, 'place_block');
  Object.assign(event.data.action.input, position);
  Object.assign(event.data.outcome.result.changes[0].position, position);
}

function moveEntityAfter(
  events: RunJournalEvent[],
  name: string,
  operation: string,
  afterName: string,
) {
  const from = events.findIndex(
    (event) =>
      event.type === 'entity_turn' &&
      event.data.action.name === name &&
      event.data.action.input.operation === operation,
  );
  assert.ok(from >= 0);
  const [moved] = events.splice(from, 1);
  const after = events.findIndex(
    (event) => event.type === 'entity_turn' && event.data.action.name === afterName,
  );
  assert.ok(after >= 0);
  events.splice(after + 1, 0, moved);
}
