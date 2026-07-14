import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { EntityTurn } from '../src/entity/loom';
import type { WorldLifecycleEvent } from '../src/runtime/world-control';
import {
  assessOwnedWorldHandoffEvidence,
  type HandoffEvidenceInput,
  type HandoffResidentEvidence,
} from '../scripts/owned-world-handoff-evidence';
import type { RunJournalEvent } from '../scripts/owned-world-model-evidence';

const WORLD = 'behold-owned-flat-v1';
const ACT_RUN = `${WORLD}-1`;
const RESUME_RUN = `${WORLD}-2`;
const MODEL = 'test/model';
const ITEM = 'apple';
const GIVER = 'GiverResident';
const RECIPIENT = 'ReceiverResident';
const BUDGETS = Object.freeze({
  maxResidents: 2,
  maxConcurrentModelCalls: 2,
  maxTotalModelCalls: 20,
  maxTotalTokens: 50_000,
  maxSingleCallLatencyMs: 60_000,
  maxTotalModelCostUsd: 0.15,
  maxJournalBytesPerResident: 2 * 1024 * 1024,
  maxLoomBytesPerResident: 2 * 1024 * 1024,
  maxProofWallMs: 12 * 60_000,
});

test('handoff evidence requires native acts and two independently observed sides', () => {
  const assessment = assessOwnedWorldHandoffEvidence(fixture());

  assert.deepEqual(assessment.failed, []);
  assert.equal(assessment.giver?.dropTurn?.action?.name, 'drop_item');
  assert.equal(assessment.recipient?.collectionTurn?.action?.name, 'move_to');
  assert.equal(assessment.metrics.maxConcurrentModelCalls, 2);
});

test('handoff evidence rejects a privileged offer claim and missing recipient witness', () => {
  const input = structuredClone(fixture()) as HandoffEvidenceInput;
  const giver = input.residents.find((resident) => resident.role === 'giver') as any;
  const recipient = input.residents.find((resident) => resident.role === 'recipient') as any;
  giver.actEvents[3].data.assistant.tool_calls[0].function.name = 'offer_item_to_player';
  giver.actEvents[3].data.intent.tool = 'offer_item_to_player';
  giver.actEvents[4].data.action.name = 'offer_item_to_player';
  recipient.bodyWitness.inventory = [];

  const assessment = assessOwnedWorldHandoffEvidence(input);
  assert.ok(assessment.failed.includes('giverFreelyChoseNativeDrop'));
  assert.ok(assessment.failed.includes('noPrivilegedOfferVerb'));
  assert.ok(assessment.failed.includes('freshBodiesConfirmTransfer'));
});

test('handoff evidence rejects an admitted symbolic sensing power', () => {
  const input = structuredClone(fixture()) as HandoffEvidenceInput;
  const giver = input.residents.find((resident) => resident.role === 'giver') as any;
  giver.actEvents[3].data.call.request.body.tools.push({
    function: { name: 'inspect_volume' },
  });

  const assessment = assessOwnedWorldHandoffEvidence(input);
  assert.ok(assessment.failed.includes('onlyNativeHandoffToolsAdmitted'));
});

test('handoff evidence rejects shared private history and repeated restart work', () => {
  const input = structuredClone(fixture()) as HandoffEvidenceInput;
  const giver = input.residents.find((resident) => resident.role === 'giver') as any;
  const recipient = input.residents.find((resident) => resident.role === 'recipient') as any;
  giver.resumeEvents[1].data.call.request.body.messages.unshift({
    role: 'system',
    content: recipient.trajectory[0].id,
  });
  giver.resumeEvents[1].data.assistant.tool_calls[0].function.name = 'move_to';
  giver.resumeEvents[1].data.intent.tool = 'move_to';
  giver.resumeEvents[2].data.action.name = 'move_to';

  const assessment = assessOwnedWorldHandoffEvidence(input);
  assert.ok(assessment.failed.includes('noForeignTurnIdsReachModelContext'));
  assert.ok(assessment.failed.includes('restartDidNotRepeatHandoff'));
});

function fixture(): HandoffEvidenceInput {
  const giver = giverResident();
  const recipient = recipientResident();
  return {
    worldId: WORLD,
    item: ITEM,
    initialItemPosition: { x: 3, y: -60, z: 0 },
    actRunId: ACT_RUN,
    resumeRunId: RESUME_RUN,
    actLifecycle: lifecycle(1, ACT_RUN, [GIVER, RECIPIENT]),
    resumeLifecycle: lifecycle(2, RESUME_RUN, [GIVER, RECIPIENT]),
    independentWitness: {
      entityId: 'HandWitness',
      worldId: WORLD,
      managedRunId: ACT_RUN,
      source: 'fresh_minecraft_connection',
      observedAt: 100,
      droppedItems: [],
    },
    residents: [giver, recipient],
    budgets: BUDGETS,
    proofWallMs: 12_000,
  };
}

function giverResident(): HandoffResidentEvidence {
  const task = `get the ${ITEM} to ${RECIPIENT}`;
  const empty = observation(GIVER, ACT_RUN, [], []);
  const carrying = observation(
    GIVER,
    ACT_RUN,
    [{ name: ITEM, count: 1 }],
    [{ type: 'item_collected', data: { collector: GIVER, item: ITEM } }],
  );
  const dropped = observation(GIVER, ACT_RUN, [], []);
  const witnessed = observation(
    GIVER,
    ACT_RUN,
    [],
    [
      {
        type: 'nearby_player_collected_item',
        data: { collector: RECIPIENT, item: ITEM, distance: 2 },
      },
    ],
  );
  const actEvents = [
    journal(GIVER, 1, 'run_started', {
      runId: ACT_RUN,
      model: MODEL,
      task,
      priorEntityTurns: 0,
    }),
    journal(GIVER, 2, 'model_turn', modelTurn(GIVER, 'giver-move', 'move_to', empty, 0)),
    journal(GIVER, 3, 'entity_turn', actionTurn('giver-move', 'move_to', empty, carrying)),
    journal(GIVER, 4, 'model_turn', modelTurn(GIVER, 'giver-drop', 'drop_item', carrying, 1)),
    journal(
      GIVER,
      5,
      'entity_turn',
      actionTurn('giver-drop', 'drop_item', carrying, dropped, {
        ok: true,
        item: ITEM,
        count: 1,
        inventoryRemoved: 1,
        confirmation: 'mineflayer:inventory_delta',
      }),
    ),
    journal(
      GIVER,
      6,
      'model_turn',
      modelTurn(GIVER, 'giver-yield', 'wait_for_event', witnessed, 4),
    ),
    journal(
      GIVER,
      7,
      'entity_turn',
      actionTurn('giver-yield', 'wait_for_event', witnessed, witnessed),
    ),
  ];
  const resumed = observation(GIVER, RESUME_RUN, [], []);
  const resumeEvents = restartEvents(GIVER, task, resumed, 'nearby_player_collected_item');
  return residentEnvelope('giver', GIVER, task, actEvents, resumeEvents, [], 0);
}

function recipientResident(): HandoffResidentEvidence {
  const task = `receive the ${ITEM} from ${GIVER}`;
  const empty = observation(RECIPIENT, ACT_RUN, [], []);
  const carrying = observation(
    RECIPIENT,
    ACT_RUN,
    [{ name: ITEM, count: 1 }],
    [{ type: 'item_collected', data: { collector: RECIPIENT, item: ITEM } }],
  );
  const actEvents = [
    journal(RECIPIENT, 1, 'run_started', {
      runId: ACT_RUN,
      model: MODEL,
      task,
      priorEntityTurns: 0,
    }),
    journal(
      RECIPIENT,
      2,
      'model_turn',
      modelTurn(RECIPIENT, 'recipient-move', 'move_to', empty, 0),
    ),
    journal(RECIPIENT, 3, 'entity_turn', actionTurn('recipient-move', 'move_to', empty, carrying)),
    journal(
      RECIPIENT,
      4,
      'model_turn',
      modelTurn(RECIPIENT, 'recipient-yield', 'wait_for_event', carrying, 3),
    ),
    journal(
      RECIPIENT,
      5,
      'entity_turn',
      actionTurn('recipient-yield', 'wait_for_event', carrying, carrying),
    ),
  ];
  const resumed = observation(RECIPIENT, RESUME_RUN, [{ name: ITEM, count: 1 }], []);
  const resumeEvents = restartEvents(RECIPIENT, task, resumed, 'item_collected');
  return residentEnvelope(
    'recipient',
    RECIPIENT,
    task,
    actEvents,
    resumeEvents,
    [{ name: ITEM, count: 1 }],
    1,
  );
}

function restartEvents(entityId: string, task: string, observationValue: any, marker: string) {
  return [
    journal(entityId, 1, 'run_started', {
      runId: RESUME_RUN,
      model: MODEL,
      task,
      priorEntityTurns: 2,
    }),
    journal(
      entityId,
      2,
      'model_turn',
      modelTurn(entityId, `${entityId}-resume`, 'wait_for_event', observationValue, 10, marker),
    ),
    journal(
      entityId,
      3,
      'entity_turn',
      actionTurn(`${entityId}-resume`, 'wait_for_event', observationValue, observationValue),
    ),
  ];
}

function residentEnvelope(
  role: 'giver' | 'recipient',
  entityId: string,
  task: string,
  actEvents: readonly RunJournalEvent[],
  resumeEvents: readonly RunJournalEvent[],
  inventory: readonly { name: string; count: number }[],
  offset: number,
): HandoffResidentEvidence {
  const root = path.resolve('/tmp/handoff-evidence', entityId);
  return {
    role,
    entityId,
    model: MODEL,
    task,
    actEvents,
    resumeEvents,
    trajectory: [trajectoryTurn(entityId, `${entityId}-act`, 1)],
    bodyWitness: {
      entityId,
      worldId: WORLD,
      managedRunId: ACT_RUN,
      source: 'fresh_minecraft_connection',
      observedAt: 100 + offset,
      inventory,
      droppedItems: [],
    },
    files: {
      actJournal: { file: path.join(root, 'act.jsonl'), bytes: 2_000 },
      resumeJournal: { file: path.join(root, 'resume.jsonl'), bytes: 1_000 },
      loom: { file: path.join(root, 'life.lync'), bytes: 3_000 },
    },
  };
}

function modelTurn(
  entityId: string,
  callId: string,
  action: string,
  observationValue: any,
  offset: number,
  continuityMarker?: string,
) {
  return {
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
            ...(continuityMarker ? [{ role: 'tool', content: `${continuityMarker}:${ITEM}` }] : []),
            {
              role: 'user',
              content: `New world experience:\n${JSON.stringify(observationValue)}\nPrevious action: none`,
            },
          ],
          tools: [
            { function: { name: 'move_to' } },
            { function: { name: 'drop_item' } },
            { function: { name: 'wait_for_event' } },
          ],
        },
      },
      response: {
        id: `${callId}-response`,
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, cost: 0.001 },
      },
    },
  };
}

function actionTurn(
  callId: string,
  action: string,
  before: any,
  after: any,
  result: any = { ok: true },
) {
  return {
    observation: before,
    action: {
      id: `${callId}-intent`,
      name: action,
      input: action === 'move_to' ? { x: 3, y: -60, z: 0 } : {},
      source: 'llm',
      toolCallId: callId,
    },
    outcome: {
      ok: true,
      eventType: action === 'wait_for_event' ? 'wait_for_event' : 'action_completed',
      result: { ok: true, result },
    },
    nextObservation: after,
  };
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
  const observationValue = { self: { identity: entityId } };
  return {
    protocol: 'behold.entity-turn.v1',
    id,
    entityId,
    sequence,
    parentId: null,
    model: MODEL,
    startedAt: sequence,
    completedAt: sequence + 1,
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
