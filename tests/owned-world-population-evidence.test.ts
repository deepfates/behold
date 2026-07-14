import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { EntityTurn } from '../src/entity/loom';
import type { WorldLifecycleEvent } from '../src/runtime/world-control';
import type { RunJournalEvent } from '../scripts/owned-world-model-evidence';
import {
  assessOwnedWorldPopulationEvidence,
  type PopulationEvidenceInput,
  type PopulationResidentEvidence,
} from '../scripts/owned-world-population-evidence';

const WORLD = 'behold-owned-flat-v1';
const ACT_RUN = `${WORLD}-1`;
const RESUME_RUN = `${WORLD}-2`;
const MODEL = 'test/model';
const BUDGETS = Object.freeze({
  maxResidents: 2,
  maxConcurrentModelCalls: 2,
  maxTotalModelCalls: 16,
  maxTotalTokens: 40_000,
  maxSingleCallLatencyMs: 60_000,
  maxTotalModelCostUsd: 0.1,
  maxJournalBytesPerResident: 2 * 1024 * 1024,
  maxLoomBytesPerResident: 2 * 1024 * 1024,
  maxProofWallMs: 12 * 60_000,
});

test('population evidence requires two causal lives in one epoch without identity leakage', () => {
  const input = fixture();
  const assessment = assessOwnedWorldPopulationEvidence(input);

  assert.deepEqual(assessment.failed, []);
  assert.equal(assessment.residents.length, 2);
  assert.equal(assessment.metrics.usage.callCount, 6);
  assert.equal(assessment.metrics.maxConcurrentModelCalls, 2);
  assert.equal(assessment.lifecycle.act.startup.length, 2);
});

test('population evidence rejects foreign history, reused evidence paths, and cost overflow', () => {
  const input = structuredClone(fixture()) as PopulationEvidenceInput;
  const apple = input.residents[0] as any;
  const carrot = input.residents[1] as any;
  apple.resumeEvents[1].data.call.request.body.messages.push({
    role: 'system',
    content: carrot.trajectory[0].id,
  });
  carrot.files.resumeJournal.file = apple.files.actJournal.file;
  for (const event of apple.actEvents) {
    if (event.type === 'model_turn') event.data.call.response.usage.cost = 0.2;
  }

  const assessment = assessOwnedWorldPopulationEvidence(input);
  assert.ok(assessment.failed.includes('noForeignTurnIdsReachModelContext'));
  assert.ok(assessment.failed.includes('evidenceFilesAreDistinct'));
  assert.ok(assessment.failed.includes('costBudgetHeld'));
});

test('population evidence rejects a foreign journal envelope and cross-body inventory', () => {
  const input = structuredClone(fixture()) as PopulationEvidenceInput;
  (input.residents[0].actEvents[0] as any).agent = input.residents[1].entityId;
  (input.residents[0].bodyWitness.inventory as any[]).push({ name: 'carrot', count: 1 });

  const assessment = assessOwnedWorldPopulationEvidence(input);
  assert.ok(assessment.failed.includes('journalsStayResidentScoped'));
  assert.ok(assessment.failed.includes('freshBodiesRetainOnlyOwnTarget'));
});

function fixture(): PopulationEvidenceInput {
  const definitions = [
    { entityId: 'AppleResident', targetItem: 'apple' },
    { entityId: 'CarrotResident', targetItem: 'carrot' },
  ];
  const residents = definitions.map((definition, index) => resident(definition, index));
  return {
    worldId: WORLD,
    actRunId: ACT_RUN,
    resumeRunId: RESUME_RUN,
    actLifecycle: lifecycle(
      1,
      ACT_RUN,
      definitions.map((item) => item.entityId),
    ),
    resumeLifecycle: lifecycle(
      2,
      RESUME_RUN,
      definitions.map((item) => item.entityId),
    ),
    independentWitness: {
      entityId: 'PopulationWitness',
      worldId: WORLD,
      managedRunId: ACT_RUN,
      source: 'fresh_minecraft_connection',
      observedAt: 100,
      droppedItems: [],
    },
    residents,
    budgets: BUDGETS,
    proofWallMs: 10_000,
  };
}

function resident(
  definition: Readonly<{ entityId: string; targetItem: string }>,
  index: number,
): PopulationResidentEvidence {
  const task = `secure ${definition.targetItem}`;
  const actEvents = [
    journal(definition.entityId, 1, 'run_started', {
      runId: ACT_RUN,
      model: MODEL,
      task,
      priorEntityTurns: 0,
    }),
    journal(
      definition.entityId,
      2,
      'model_turn',
      modelTurn(definition, ACT_RUN, 'collect_nearby_item', `collect-${index}`, false, index),
    ),
    journal(definition.entityId, 3, 'entity_turn', collectionTurn(definition, `collect-${index}`)),
    journal(
      definition.entityId,
      4,
      'model_turn',
      modelTurn(definition, ACT_RUN, 'wait_for_event', `yield-${index}`, false, index + 10),
    ),
    journal(definition.entityId, 5, 'entity_turn', waitTurn(`yield-${index}`)),
  ];
  const resumeEvents = [
    journal(definition.entityId, 1, 'run_started', {
      runId: RESUME_RUN,
      model: MODEL,
      task,
      priorEntityTurns: 2,
    }),
    journal(
      definition.entityId,
      2,
      'model_turn',
      modelTurn(definition, RESUME_RUN, 'wait_for_event', `resume-${index}`, true, index + 20),
    ),
    journal(definition.entityId, 3, 'entity_turn', waitTurn(`resume-${index}`)),
  ];
  const trajectory = [
    trajectoryTurn(definition.entityId, `${definition.entityId}-act`, 1),
    trajectoryTurn(definition.entityId, `${definition.entityId}-resume`, 2),
  ];
  const root = path.resolve('/tmp/population-evidence', definition.entityId);
  return {
    entityId: definition.entityId,
    model: MODEL,
    task,
    targetItem: definition.targetItem,
    actEvents,
    resumeEvents,
    trajectory,
    bodyWitness: {
      entityId: definition.entityId,
      worldId: WORLD,
      managedRunId: ACT_RUN,
      source: 'fresh_minecraft_connection',
      observedAt: 100,
      inventory: [{ name: definition.targetItem, count: 1 }],
      droppedItems: [],
    },
    files: {
      actJournal: { file: path.join(root, 'act.jsonl'), bytes: 1_000 },
      resumeJournal: { file: path.join(root, 'resume.jsonl'), bytes: 500 },
      loom: { file: path.join(root, 'life.lync'), bytes: 2_000 },
    },
  };
}

function modelTurn(
  resident: Readonly<{ entityId: string; targetItem: string }>,
  runId: string,
  action: string,
  callId: string,
  resumed: boolean,
  offset: number,
) {
  const observation = {
    protocol: 'behold.inhabitant.v1',
    circle: { id: WORLD, managedRunId: runId },
    self: {
      identity: resident.entityId,
      inventory: resumed ? [{ name: resident.targetItem, count: 1 }] : [],
    },
    scene: {
      entities: resumed ? [] : [{ kind: 'item', name: resident.targetItem, count: 1 }],
    },
    events: [],
    eventWindow: { omittedNewEvents: 0 },
  };
  return {
    observation,
    assistant: {
      role: 'assistant',
      tool_calls: [{ id: callId, function: { name: action, arguments: '{}' } }],
    },
    intent:
      action === 'wait_for_event'
        ? null
        : { id: `${callId}-intent`, source: 'llm', tool: action, input: {} },
    call: {
      protocol: 'behold.model-call.v1',
      startedAt: 100 + offset * 100,
      completedAt: 250 + offset * 100,
      latencyMs: 150,
      request: {
        model: MODEL,
        toolChoice: 'auto',
        body: {
          messages: [
            ...(resumed
              ? [
                  {
                    role: 'tool',
                    content: `{"action":"collect_nearby_item","confirmation":"mineflayer:playerCollect","item":"${resident.targetItem}"}`,
                  },
                ]
              : []),
            {
              role: 'user',
              content: `New world experience:\n${JSON.stringify(observation)}\nPrevious action: none`,
            },
          ],
          tools: [
            { function: { name: 'collect_nearby_item' } },
            { function: { name: 'inspect_volume' } },
          ],
        },
      },
      response: {
        id: `${callId}-response`,
        usage: { prompt_tokens: 10, completion_tokens: 11, total_tokens: 21, cost: 0.001 },
      },
    },
  };
}

function collectionTurn(
  resident: Readonly<{ entityId: string; targetItem: string }>,
  callId: string,
) {
  return {
    action: {
      id: `${callId}-intent`,
      name: 'collect_nearby_item',
      source: 'llm',
      toolCallId: callId,
    },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: {
        ok: true,
        eventType: 'action_completed',
        result: {
          ok: true,
          item: resident.targetItem,
          confirmation: 'mineflayer:playerCollect',
        },
      },
    },
  };
}

function waitTurn(callId: string) {
  return {
    action: {
      id: callId,
      name: 'wait_for_event',
      source: 'llm',
      toolCallId: callId,
    },
    outcome: { ok: true, eventType: 'wait_for_event', result: { ok: true } },
  };
}

function journal(entityId: string, sequence: number, type: string, data: any): RunJournalEvent {
  return {
    sequence,
    at: new Date(sequence).toISOString(),
    agent: entityId,
    type,
    data,
  };
}

function trajectoryTurn(entityId: string, id: string, sequence: number): EntityTurn {
  const observation = { self: { identity: entityId } };
  return {
    protocol: 'behold.entity-turn.v1',
    id,
    entityId,
    sequence,
    parentId: sequence === 1 ? null : `${entityId}-act`,
    model: MODEL,
    startedAt: sequence,
    completedAt: sequence + 1,
    observation,
    utterance: { assistant: {} },
    action: {
      id: `${id}-action`,
      name: 'wait_for_event',
      input: {},
      source: 'llm',
      kind: 'yield',
      toolCallId: null,
    },
    outcome: { ok: true, eventType: 'wait_for_event', result: { ok: true } },
    nextObservation: observation,
  };
}

function lifecycle(epoch: number, runId: string, residentIds: readonly string[]) {
  const records: Array<Readonly<{ type: string; data: any }>> = [
    {
      type: 'run_configured',
      data: {
        runId,
        population: {
          residents: residentIds.map((entityId) => ({ entityId })),
          residentCount: residentIds.length,
          maxResidentProcesses: BUDGETS.maxResidents,
          maxConcurrentModelCalls: residentIds.length,
        },
      },
    },
    ...residentIds.map((entityId) => ({ type: 'controller_started', data: { entityId } })),
    ...residentIds.map((entityId) => ({ type: 'controller_ready', data: { entityId } })),
    {
      type: 'run_ready',
      data: { residents: residentIds.map((entityId) => ({ entityId })) },
    },
    { type: 'residents_quiesced', data: {} },
    { type: 'server_save_acknowledged', data: {} },
    { type: 'run_stopped', data: {} },
    { type: 'control_released', data: {} },
  ];
  return records.map(
    (record, index) =>
      ({
        sequence: index + 1,
        at: new Date(index * 100).toISOString(),
        world: WORLD,
        epoch,
        type: record.type,
        data: record.data,
        previousDigest: index === 0 ? null : `digest-${index}`,
        digest: `digest-${index + 1}`,
      }) satisfies WorldLifecycleEvent,
  );
}
