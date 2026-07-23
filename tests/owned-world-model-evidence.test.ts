import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessOwnedWorldModelEvidence,
  decisionMatchesEntityTurn,
  parseRunJournal,
  type RunJournalEvent,
} from '../scripts/owned-world-model-evidence';

const expected = {
  worldId: 'behold-owned-flat-v1',
  entityId: 'ModelResident',
  model: 'test/model',
  task: 'secure one useful loose resource',
  actRunId: 'behold-owned-flat-v1-1',
  resumeRunId: 'behold-owned-flat-v1-2',
};

test('an intentless explicit yield matches its recorded entity turn by tool call identity', () => {
  assert.equal(
    decisionMatchesEntityTurn(
      {
        intent: null,
        assistant: {
          tool_calls: [
            {
              id: 'ax-yield-call',
              function: { name: 'wait_for_event', arguments: '{"reason":"nothing urgent"}' },
            },
          ],
        },
      },
      {
        action: {
          id: 'yield-record',
          name: 'wait_for_event',
          kind: 'yield',
          toolCallId: 'ax-yield-call',
        },
      },
    ),
    true,
  );
});

test('model-world evidence requires a free choice, real consequence, and non-repeating restart', () => {
  const act = [
    journal(1, 'run_started', {
      runId: expected.actRunId,
      model: expected.model,
      task: expected.task,
      priorEntityTurns: 0,
    }),
    journal(
      2,
      'model_turn',
      modelTurn(
        expected.actRunId,
        'collect_nearby_item',
        'act-call',
        false,
        'World after inspect_volume',
      ),
    ),
    journal(3, 'entity_turn', collectionTurn('act-call')),
    journal(4, 'model_turn', modelTurn(expected.actRunId, 'wait_for_event', 'act-yield')),
    journal(5, 'entity_turn', waitTurn('act-yield')),
  ];
  const resume = [
    journal(1, 'run_started', {
      runId: expected.resumeRunId,
      model: expected.model,
      task: expected.task,
      priorEntityTurns: 1,
    }),
    journal(
      2,
      'model_turn',
      modelTurn(expected.resumeRunId, 'wait_for_event', 'resume-call', true),
    ),
    journal(3, 'entity_turn', waitTurn('resume-call')),
  ];
  const assessed = assessOwnedWorldModelEvidence(
    act,
    resume,
    {
      entityId: 'FreshWitness',
      worldId: expected.worldId,
      managedRunId: expected.actRunId,
      source: 'fresh_minecraft_connection',
      observedAt: 100,
      droppedItems: [],
    },
    expected,
  );

  assert.deepEqual(assessed.failed, []);
  assert.equal(assessed.resume.firstActionName, 'wait_for_event');
  assert.equal(assessed.usage.totalTokens, 63);

  const required = structuredClone(act);
  for (const event of required.filter((entry) => entry.type === 'model_turn')) {
    event.data.call.request.toolChoice = 'required';
  }
  const requiredResume = structuredClone(resume);
  requiredResume[1].data.call.request.toolChoice = 'required';
  assert.deepEqual(
    assessOwnedWorldModelEvidence(
      required,
      requiredResume,
      {
        entityId: 'FreshWitness',
        worldId: expected.worldId,
        managedRunId: expected.actRunId,
        source: 'fresh_minecraft_connection',
        observedAt: 100,
        droppedItems: [],
      },
      expected,
    ).failed,
    [],
  );

  const forced = structuredClone(act);
  forced[1].data.call.request.toolChoice = {
    type: 'function',
    function: { name: 'collect_nearby_item' },
  };
  assert.ok(
    assessOwnedWorldModelEvidence(
      forced,
      resume,
      {
        entityId: 'FreshWitness',
        worldId: expected.worldId,
        managedRunId: expected.actRunId,
        source: 'fresh_minecraft_connection',
        observedAt: 100,
        droppedItems: [],
      },
      expected,
    ).failed.includes('modelFreelyChoseCollection'),
  );

  const onlyCollectionWasOffered = structuredClone(act);
  onlyCollectionWasOffered[1].data.call.request.body.tools = [
    { function: { name: 'collect_nearby_item' } },
  ];
  assert.ok(
    assessOwnedWorldModelEvidence(
      onlyCollectionWasOffered,
      resume,
      {
        entityId: 'FreshWitness',
        worldId: expected.worldId,
        managedRunId: expected.actRunId,
        source: 'fresh_minecraft_connection',
        observedAt: 100,
        droppedItems: [],
      },
      expected,
    ).failed.includes('modelFreelyChoseCollection'),
  );

  const repeated = structuredClone(resume);
  repeated[1].data.intent = {
    id: 'resume-call-intent',
    source: 'llm',
    tool: 'collect_nearby_item',
    input: {},
  };
  repeated[1].data.assistant.tool_calls[0].function.name = 'collect_nearby_item';
  repeated[2].data.action.id = 'resume-call-intent';
  repeated[2].data.action.name = 'collect_nearby_item';
  assert.ok(
    assessOwnedWorldModelEvidence(
      act,
      repeated,
      {
        entityId: 'FreshWitness',
        worldId: expected.worldId,
        managedRunId: expected.actRunId,
        source: 'fresh_minecraft_connection',
        observedAt: 100,
        droppedItems: [],
      },
      expected,
    ).failed.includes('restartDidNotRepeatCompletedWork'),
  );
});

test('run journal parser rejects gaps and malformed envelopes', () => {
  const valid = [journal(1, 'run_started', {}), journal(2, 'model_turn', {})];
  assert.equal(parseRunJournal(valid.map((event) => JSON.stringify(event)).join('\n')).length, 2);
  const gap = [journal(1, 'run_started', {}), journal(3, 'model_turn', {})];
  assert.throws(
    () => parseRunJournal(gap.map((event) => JSON.stringify(event)).join('\n')),
    /invalid envelope/,
  );
  assert.throws(() => parseRunJournal('{not json}\n'), /not JSON/);
});

function journal(sequence: number, type: string, data: any): RunJournalEvent {
  return {
    sequence,
    at: new Date(sequence).toISOString(),
    agent: expected.entityId,
    type,
    data,
  };
}

function modelTurn(
  runId: string,
  name: string,
  callId: string,
  resumed = false,
  observationLabel = 'New world experience',
) {
  const observation = {
    protocol: 'behold.inhabitant.v1',
    circle: { id: expected.worldId, managedRunId: runId },
    self: {
      identity: expected.entityId,
      inventory: resumed ? [{ name: 'apple', count: 1 }] : [],
    },
    scene: {
      entities: resumed ? [] : [{ kind: 'item', name: 'apple', count: 1 }],
    },
    events: [],
    eventWindow: { omittedNewEvents: 0 },
  };
  return {
    observation,
    assistant: {
      role: 'assistant',
      tool_calls: [{ id: callId, function: { name, arguments: '{}' } }],
    },
    intent:
      name === 'wait_for_event'
        ? null
        : { id: `${callId}-intent`, source: 'llm', tool: name, input: {} },
    call: {
      protocol: 'behold.model-call.v1',
      latencyMs: 12,
      request: {
        model: expected.model,
        toolChoice: 'auto',
        body: {
          messages: [
            ...(resumed
              ? [
                  {
                    role: 'tool',
                    content:
                      '{"action":"collect_nearby_item","confirmation":"mineflayer:playerCollect","item":"apple"}',
                  },
                ]
              : []),
            {
              role: 'user',
              content: `${observationLabel}:\n${JSON.stringify(observation)}\nPrevious action: none`,
            },
          ],
          tools: resumed
            ? [{ function: { name: 'inspect_volume' } }, { function: { name: 'wait_for_event' } }]
            : [
                { function: { name: 'collect_nearby_item' } },
                { function: { name: 'inspect_volume' } },
                { function: { name: 'wait_for_event' } },
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

function collectionTurn(callId: string) {
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
        result: { ok: true, item: 'apple', confirmation: 'mineflayer:playerCollect' },
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
