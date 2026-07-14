import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { EntityTurn } from '../src/entity/loom';
import type { WorldLifecycleEvent } from '../src/runtime/world-control';
import {
  assessOwnedWorldCacheEvidence,
  type CacheEvidenceInput,
  type CacheResidentEvidence,
} from '../scripts/owned-world-cache-evidence';
import type { RunJournalEvent } from '../scripts/owned-world-model-evidence';

const WORLD = 'behold-owned-flat-v1';
const ACT_RUN = `${WORLD}-1`;
const RESUME_RUN = `${WORLD}-2`;
const MODEL = 'test/model';
const APPLE = 'AppleKeeper';
const CARROT = 'CarrotKeeper';
const ITEMS = ['apple', 'carrot'] as const;
const CONTAINER = { x: 0, y: -60, z: 5 } as const;
const BUDGETS = Object.freeze({
  maxResidents: 2,
  maxConcurrentModelCalls: 2,
  maxTotalModelCalls: 30,
  maxTotalTokens: 80_000,
  maxSingleCallLatencyMs: 60_000,
  maxTotalModelCostUsd: 0.2,
  maxJournalBytesPerResident: 3 * 1024 * 1024,
  maxLoomBytesPerResident: 3 * 1024 * 1024,
  maxProofWallMs: 15 * 60_000,
});
const TOOLS = [
  'collect_nearby_item',
  'deposit_in_container',
  'inspect_container',
  'chat',
  'wait_for_event',
];

test('cache evidence requires two embodied contributions and two lived confirmations', () => {
  const assessment = assessOwnedWorldCacheEvidence(fixture());

  assert.deepEqual(assessment.failed, []);
  assert.equal(assessment.residents.length, 2);
  assert.equal(
    assessment.residents.every((resident) => resident.observedPeerChat),
    true,
  );
  assert.equal(assessment.metrics.maxConcurrentModelCalls, 2);
});

test('cache evidence rejects a collaboration claim without peer receipt or final inspection', () => {
  const input = structuredClone(fixture()) as CacheEvidenceInput;
  const apple = input.residents.find((resident) => resident.entityId === APPLE) as any;
  const inspect = entityTurns(apple.actEvents).find(
    (turn) => turn.action.name === 'inspect_container',
  );
  inspect.nextObservation.events = [];
  inspect.outcome.result.result.contents = [{ name: 'apple', count: 1 }];

  const assessment = assessOwnedWorldCacheEvidence(input);
  assert.ok(assessment.failed.includes('everyResidentHeardPeerThroughOwnObservation'));
  assert.ok(assessment.failed.includes('everyResidentIndependentlyInspectedCompletedCache'));
  assert.ok(assessment.failed.includes('everyResidentYieldedAfterJointEvidence'));
});

test('cache evidence rejects privileged coordination and leaked private trajectory', () => {
  const input = structuredClone(fixture()) as CacheEvidenceInput;
  const apple = input.residents.find((resident) => resident.entityId === APPLE) as any;
  const carrot = input.residents.find((resident) => resident.entityId === CARROT) as any;
  const firstCall = modelTurns(apple.actEvents)[0].call;
  firstCall.request.body.tools.push({ function: { name: 'coordinate_residents' } });
  firstCall.request.body.messages.unshift({
    role: 'system',
    content: carrot.trajectory[0].id,
  });

  const assessment = assessOwnedWorldCacheEvidence(input);
  assert.ok(assessment.failed.includes('onlyNativeCacheToolsAdmitted'));
  assert.ok(assessment.failed.includes('noControllerOwnedCooperationMacro'));
  assert.ok(assessment.failed.includes('noForeignTurnIdsReachModelContext'));
});

test('cache evidence rejects duplicated restart work and a false fresh witness', () => {
  const input = structuredClone(fixture()) as CacheEvidenceInput;
  const apple = input.residents.find((resident) => resident.entityId === APPLE) as any;
  const decision = modelTurns(apple.resumeEvents)[0];
  const turn = entityTurns(apple.resumeEvents)[0];
  decision.intent.tool = 'deposit_in_container';
  decision.assistant.tool_calls[0].function.name = 'deposit_in_container';
  turn.action.name = 'deposit_in_container';
  (input.independentWitness as any).contents = [{ name: 'apple', count: 2 }];

  const assessment = assessOwnedWorldCacheEvidence(input);
  assert.ok(assessment.failed.includes('restartDidNotRepeatOrUndoWork'));
  assert.ok(assessment.failed.includes('freshMinecraftWitnessSawExactCompletedCache'));
});

function fixture(): CacheEvidenceInput {
  return {
    worldId: WORLD,
    containerPosition: CONTAINER,
    actRunId: ACT_RUN,
    resumeRunId: RESUME_RUN,
    actLifecycle: lifecycle(1, ACT_RUN, [APPLE, CARROT]),
    resumeLifecycle: lifecycle(2, RESUME_RUN, [APPLE, CARROT]),
    independentWitness: {
      entityId: 'CacheWitness',
      worldId: WORLD,
      managedRunId: ACT_RUN,
      source: 'fresh_minecraft_connection',
      observedAt: 100,
      droppedItems: [],
      container: { name: 'chest', position: CONTAINER },
      contents: ITEMS.map((name) => ({ name, count: 1 })),
      confirmation: 'mineflayer:openContainer',
    },
    residents: [
      resident(APPLE, 'apple', CARROT, 'carrot', 0),
      resident(CARROT, 'carrot', APPLE, 'apple', 0),
    ],
    budgets: BUDGETS,
    proofWallMs: 15_000,
  };
}

function resident(
  entityId: string,
  item: string,
  peerId: string,
  peerItem: string,
  callOffset: number,
): CacheResidentEvidence {
  const task = `put ${item} in the chest with ${peerId}`;
  const empty = observation(entityId, ACT_RUN, [], []);
  const carrying = observation(entityId, ACT_RUN, [{ name: item, count: 1 }], []);
  const peerMessage = observation(
    entityId,
    ACT_RUN,
    [],
    [
      {
        type: 'chat_received',
        data: { from: peerId, text: `${peerItem} is stored in the chest`, addressed: false },
      },
    ],
  );
  const prefix = entityId.toLowerCase();
  const actEvents = renumber([
    journal(entityId, 'run_started', {
      runId: ACT_RUN,
      model: MODEL,
      task,
      priorEntityTurns: 0,
    }),
    pairedModel(entityId, `${prefix}-pickup`, 'collect_nearby_item', empty, callOffset),
    pairedAction(`${prefix}-pickup`, 'collect_nearby_item', empty, carrying, {
      ok: true,
      item,
      confirmation: 'mineflayer:playerCollect',
    }),
    pairedModel(entityId, `${prefix}-deposit`, 'deposit_in_container', carrying, callOffset + 2),
    pairedAction(`${prefix}-deposit`, 'deposit_in_container', carrying, empty, {
      ok: true,
      item,
      requested: 1,
      bodyRemoved: 1,
      containerAdded: 1,
      container: { name: 'chest', position: CONTAINER },
      confirmation: 'mineflayer:container_inventory_delta',
    }),
    pairedModel(entityId, `${prefix}-chat`, 'chat', empty, callOffset + 4),
    pairedAction(`${prefix}-chat`, 'chat', empty, empty, {
      ok: true,
      message: `${item} is stored in the chest`,
    }),
    pairedModel(entityId, `${prefix}-inspect`, 'inspect_container', peerMessage, callOffset + 6),
    pairedAction(`${prefix}-inspect`, 'inspect_container', empty, peerMessage, {
      ok: true,
      container: { name: 'chest', position: CONTAINER },
      contents: ITEMS.map((name) => ({ name, count: 1 })),
      confirmation: 'mineflayer:openContainer',
    }),
    pairedModel(entityId, `${prefix}-yield`, 'wait_for_event', peerMessage, callOffset + 8),
    pairedAction(`${prefix}-yield`, 'wait_for_event', peerMessage, peerMessage, { ok: true }),
  ]);
  const resumed = observation(entityId, RESUME_RUN, [], []);
  const continuity = 'mineflayer:container_inventory_delta mineflayer:openContainer chat_received';
  const resumeEvents = renumber([
    journal(entityId, 'run_started', {
      runId: RESUME_RUN,
      model: MODEL,
      task,
      priorEntityTurns: 5,
    }),
    pairedModel(
      entityId,
      `${prefix}-resume`,
      'wait_for_event',
      resumed,
      callOffset + 20,
      continuity,
    ),
    pairedAction(`${prefix}-resume`, 'wait_for_event', resumed, resumed, { ok: true }),
  ]);
  const root = path.resolve('/tmp/cache-evidence', entityId);
  return {
    entityId,
    model: MODEL,
    task,
    targetItem: item,
    actEvents,
    resumeEvents,
    trajectory: [trajectoryTurn(entityId, `${entityId}-private-turn`)],
    bodyWitness: {
      entityId,
      worldId: WORLD,
      managedRunId: ACT_RUN,
      source: 'fresh_minecraft_connection',
      observedAt: 100 + callOffset,
      inventory: [],
      droppedItems: [],
    },
    files: {
      actJournal: { file: path.join(root, 'act.jsonl'), bytes: 2_000 },
      resumeJournal: { file: path.join(root, 'resume.jsonl'), bytes: 1_000 },
      loom: { file: path.join(root, 'life.lync'), bytes: 3_000 },
    },
  };
}

function pairedModel(
  entityId: string,
  callId: string,
  action: string,
  observationValue: any,
  offset: number,
  continuity = '',
) {
  return journal(entityId, 'model_turn', {
    observation: observationValue,
    assistant: {
      role: 'assistant',
      tool_calls: [{ id: callId, function: { name: action, arguments: '{}' } }],
    },
    intent: { id: `${callId}-intent`, source: 'llm', tool: action, input: {} },
    call: {
      protocol: 'behold.model-call.v1',
      startedAt: 100 + offset * 100,
      completedAt: 150 + offset * 100,
      latencyMs: 50,
      request: {
        model: MODEL,
        toolChoice: 'auto',
        body: {
          messages: [
            ...(continuity ? [{ role: 'tool', content: continuity }] : []),
            {
              role: 'user',
              content: `New world experience:\n${JSON.stringify(observationValue)}\nPrevious action: none`,
            },
          ],
          tools: TOOLS.map((name) => ({ function: { name } })),
        },
      },
      response: {
        id: `${callId}-response`,
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, cost: 0.001 },
      },
    },
  });
}

function pairedAction(callId: string, action: string, before: any, after: any, result: any) {
  return journal(String(before.self.identity), 'entity_turn', {
    observation: before,
    action: {
      id: `${callId}-intent`,
      name: action,
      input: {},
      source: 'llm',
      toolCallId: callId,
    },
    outcome: {
      ok: true,
      eventType: action === 'wait_for_event' ? 'wait_for_event' : 'action_completed',
      result: { ok: true, result },
    },
    nextObservation: after,
  });
}

function observation(
  entityId: string,
  runId: string,
  inventory: readonly { name: string; count: number }[],
  events: readonly any[],
) {
  return {
    protocol: 'behold.inhabitant.v1',
    circle: { id: WORLD, managedRunId: runId },
    self: { identity: entityId, inventory },
    scene: { entities: [] },
    events,
    eventWindow: { omittedNewEvents: 0 },
  };
}

function journal(entityId: string, type: string, data: any): RunJournalEvent {
  return { sequence: 0, at: new Date(0).toISOString(), agent: entityId, type, data };
}

function renumber(events: readonly RunJournalEvent[]) {
  return events.map((event, index) => ({
    ...event,
    sequence: index + 1,
    at: new Date(index + 1).toISOString(),
  }));
}

function modelTurns(events: readonly RunJournalEvent[]) {
  return events.filter((event) => event.type === 'model_turn').map((event) => event.data);
}

function entityTurns(events: readonly RunJournalEvent[]) {
  return events.filter((event) => event.type === 'entity_turn').map((event) => event.data);
}

function trajectoryTurn(entityId: string, id: string): EntityTurn {
  const observationValue = { self: { identity: entityId } };
  return {
    protocol: 'behold.entity-turn.v1',
    id,
    entityId,
    sequence: 1,
    parentId: null,
    model: MODEL,
    startedAt: 1,
    completedAt: 2,
    observation: observationValue,
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
    nextObservation: observationValue,
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
    { type: 'run_ready', data: { residents: residentIds.map((entityId) => ({ entityId })) } },
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
