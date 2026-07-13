import test from 'node:test';
import assert from 'node:assert/strict';
import { hasDecisionRelevantEvent, startLLMPolicy } from '../src/policy/llm';
import type { EntityTurn } from '../src/entity/loom';

function frame(from: string, addressed = false, distance: number | null = null) {
  return {
    protocol: 'behold.inhabitant.v1',
    task: { target: 'Director' },
    scene: {
      entities:
        distance == null ? [] : [{ id: `player:${from}`, name: from, kind: 'player', distance }],
    },
    events: [
      {
        type: 'chat_received',
        isNew: true,
        data: { from, addressed, text: 'hello' },
      },
    ],
  };
}

test('task-directed attention wakes for the target or an addressed message', () => {
  assert.equal(hasDecisionRelevantEvent(frame('Server'), 4), false);
  assert.equal(hasDecisionRelevantEvent(frame('importdf'), 4), false);
  assert.equal(hasDecisionRelevantEvent(frame('importdf', false, 12), 4), true);
  assert.equal(hasDecisionRelevantEvent(frame('importdf', false, 30), 4), false);
  assert.equal(hasDecisionRelevantEvent(frame('Director'), 4), true);
  assert.equal(hasDecisionRelevantEvent(frame('importdf', true), 4), true);
});

test('controller receives real action results and continues the same bounded turn', async () => {
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  const responses = [
    assistantTool('call-approach', 'approach_entity', { name: 'importdf', near: 2.5 }),
    assistantTool('call-report', 'chat', {
      text: 'I reached you; the nearby terrain includes gray concrete.',
    }),
    assistantTool('call-wait', 'wait_for_event', {
      reason: 'Waiting for the requested block change.',
      events: ['chat_received'],
    }),
  ];
  globalThis.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(String(init?.body || '{}')));
    const message = responses.shift();
    assert.ok(message, 'controller made more model calls than the scripted trajectory');
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message }] }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  let sequence = 1;
  let currentAction: any = null;
  const enqueued: any[] = [];
  const entityTurns: any[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [tool('approach_entity'), tool('chat')],
      attempt: (intent) => {
        enqueued.push(intent);
        currentAction = { id: intent.id, tool: intent.tool, status: 'queued' };
        sequence += 1;
        return true;
      },
      observe: (sinceSequence) => experience(sequence, currentAction, sinceSequence),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      acceptEngineEvent: () => true,
      onEntityTurn: (turn) => entityTurns.push(turn),
    },
  );

  try {
    await policy.tick();
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].tool, 'approach_entity');
    assert.equal(requests.length, 1);
    const systemPrompt = requests[0].messages.find((message: any) => message.role === 'system');
    assert.match(
      systemPrompt?.content || '',
      /successful action proves only its reported consequence/i,
    );
    assert.match(systemPrompt?.content || '', /joint activity: keep the concern unfinished/i);
    assert.equal(entityTurns.length, 0, 'a choice is not a turn until the circle answers');

    // Dispatch acknowledgement and an intermediate tool result are not a
    // completed physical consequence, so neither may advance cognition.
    policy.onEngineEvent({
      type: 'tool_result',
      at: 20,
      data: { intent: enqueued[0], result: { ok: true, status: 'dispatched' } },
    });
    await drainImmediateQueue();
    assert.equal(requests.length, 1);

    currentAction = {
      id: enqueued[0].id,
      tool: enqueued[0].tool,
      status: 'completed',
      result: { ok: true, target: 'importdf', finalDistance: 2.1 },
    };
    sequence += 1;
    policy.onEngineEvent({
      type: 'action_completed',
      at: 30,
      data: { intent: enqueued[0], result: currentAction.result },
    });
    await until(() => enqueued.length === 2);
    assert.equal(entityTurns.length, 1);
    assert.equal(entityTurns[0].action.name, 'approach_entity');
    assert.equal(entityTurns[0].outcome.result.finalDistance, 2.1);
    assert.equal(enqueued[1].tool, 'chat');
    assert.equal(requests.length, 2);
    assert.ok(
      requests[1].messages.some(
        (message: any) =>
          message.role === 'tool' &&
          message.tool_call_id === 'call-approach' &&
          JSON.parse(message.content).result.finalDistance === 2.1,
      ),
      'resolved world result was not returned to the controller',
    );

    currentAction = {
      id: enqueued[1].id,
      tool: enqueued[1].tool,
      status: 'completed',
      result: { ok: true, message: enqueued[1].input.text },
    };
    sequence += 1;
    policy.onEngineEvent({
      type: 'action_completed',
      at: 40,
      data: { intent: enqueued[1], result: currentAction.result },
    });
    await until(() => policy.state().turnActive === false && requests.length === 3);
    assert.equal(enqueued.length, 2, 'wait_for_event must not enter the world action stream');
    assert.equal(policy.state().pendingIntentId, null);
    assert.deepEqual(
      entityTurns.map((turn) => turn.action.name),
      ['approach_entity', 'chat', 'wait_for_event'],
    );
    assert.equal(entityTurns[1].parentId, entityTurns[0].id);
    assert.equal(entityTurns[2].parentId, entityTurns[1].id);
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('model turns preserve reproducible call, usage, latency, and opt-in IO evidence', async () => {
  const originalFetch = globalThis.fetch;
  let now = 1000;
  globalThis.fetch = (async () => {
    now = 1027;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'generation-1',
        model: 'provider/resolved-model',
        provider: 'Example Provider',
        choices: [
          {
            finish_reason: 'tool_calls',
            native_finish_reason: 'tool_use',
            message: assistantTool('call-wait-evidence', 'wait_for_event', {
              reason: 'proof complete',
            }),
          },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 8,
          total_tokens: 128,
          cost: 0.00042,
        },
      }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  const modelTurns: any[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [tool('inspect_volume')],
      attempt: () => true,
      observe: () => experience(1, null, 0),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      endpoint: 'https://models.example.test/v1/chat/completions?credential=redacted',
      now: () => now,
      recordModelIO: true,
      acceptEngineEvent: () => true,
      onModelTurn: (turn) => modelTurns.push(turn),
    },
  );

  try {
    await policy.tick();
    await until(() => modelTurns.length === 1);
    const call = modelTurns[0].call;
    assert.equal(call.protocol, 'behold.model-call.v1');
    assert.equal(call.endpoint, 'https://models.example.test/v1/chat/completions');
    assert.equal(call.startedAt, 1000);
    assert.equal(call.completedAt, 1027);
    assert.equal(call.latencyMs, 27);
    assert.equal(call.request.model, 'test/model');
    assert.equal(call.request.toolChoice, 'auto');
    assert.match(call.request.bodySha256, /^[a-f0-9]{64}$/);
    assert.match(call.request.messagesSha256, /^[a-f0-9]{64}$/);
    assert.match(call.request.toolsSha256, /^[a-f0-9]{64}$/);
    assert.equal((call.request.body as any).messages[0].role, 'system');
    assert.equal(call.response.id, 'generation-1');
    assert.equal(call.response.model, 'provider/resolved-model');
    assert.equal(call.response.provider, 'Example Provider');
    assert.equal(call.response.finishReason, 'tool_calls');
    assert.equal(call.response.nativeFinishReason, 'tool_use');
    assert.equal(call.response.usage.total_tokens, 128);
    assert.equal(call.response.usage.cost, 0.00042);
    assert.equal(call.response.raw.id, 'generation-1');
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('loom-fold model usage is journalable instead of hidden from resident budgets', async () => {
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const request = JSON.parse(String(init?.body || '{}'));
    requests.push(request);
    if (!Array.isArray(request.tools)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'fold-generation',
          model: 'provider/fold-model',
          provider: 'Example Provider',
          choices: [{ finish_reason: 'stop', message: { content: '[t1-t4] compact continuity' } }],
          usage: { prompt_tokens: 80, completion_tokens: 10, total_tokens: 90, cost: 0.0001 },
        }),
        text: async () => '',
      } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'action-generation',
        choices: [
          {
            message: assistantTool('wait-after-fold', 'wait_for_event', {
              reason: 'fold accounted',
            }),
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 },
      }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  const auxiliary: any[] = [];
  const turns: EntityTurn[] = [];
  const history = Array.from({ length: 16 }, (_, index) =>
    failedTurn(index + 1, 'status'),
  );
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [],
      attempt: () => true,
      observe: () => experience(1, null, 0),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      recordModelIO: true,
      history,
      acceptEngineEvent: () => true,
      onAuxiliaryModelCall: (turn) => auxiliary.push(turn),
      onEntityTurn: (turn) => turns.push(turn),
    },
  );

  try {
    await policy.tick();
    await until(() => turns.length === 1);
    assert.equal(requests.length, 2);
    assert.equal(auxiliary.length, 1);
    assert.equal(auxiliary[0].purpose, 'loom_fold');
    assert.equal(auxiliary[0].call.protocol, 'behold.model-call.v1');
    assert.equal(auxiliary[0].call.request.toolCount, 0);
    assert.equal(auxiliary[0].call.request.body.messages[0].role, 'system');
    assert.equal(auxiliary[0].call.response.id, 'fold-generation');
    assert.equal(auxiliary[0].call.response.usage.total_tokens, 90);
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('model action space contains only executable gates plus explicit yield', async () => {
  const originalFetch = globalThis.fetch;
  let request: any = null;
  globalThis.fetch = (async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'allowlist-proof',
        choices: [
          {
            message: assistantTool('allowlist-wait', 'wait_for_event', {
              reason: 'action-space inspected',
            }),
          },
        ],
        usage: { total_tokens: 10 },
      }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  const turns: EntityTurn[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [tool('inspect_volume'), tool('collect_nearby_item')],
      attempt: () => true,
      observe: () => experience(1, null, 0),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      allowTools: ['inspect_volume'],
      acceptEngineEvent: () => true,
      onEntityTurn: (turn) => turns.push(turn),
    },
  );

  try {
    await policy.tick();
    await until(() => turns.length === 1);
    assert.deepEqual(
      request.tools.map((spec: any) => spec.function.name),
      ['inspect_volume', 'wait_for_event'],
    );
    assert.equal(request.tool_choice, 'auto');
    assert.equal(turns[0].action.name, 'wait_for_event');
    const system = String(request.messages[0].content);
    assert.match(system, /use inspect_volume at the worksite/i);
    assert.doesNotMatch(system, /Minecraft chat is narrow/i);
    assert.doesNotMatch(system, /descend_step/i);
    assert.doesNotMatch(system, /self\.projects is your bounded/i);
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('system guidance follows the admitted affordances instead of describing absent tools', async () => {
  const originalFetch = globalThis.fetch;
  let request: any = null;
  globalThis.fetch = (async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: assistantTool('bounded-prompt-wait', 'wait_for_event', {
              reason: 'working context inspected',
            }),
          },
        ],
        usage: { total_tokens: 10 },
      }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  const turns: EntityTurn[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Builder',
      actions: [
        tool('manage_project'),
        tool('collect_nearby_item'),
        tool('inspect_volume'),
        tool('place_block'),
      ],
      attempt: () => true,
      observe: () => experience(1, null, 0),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      acceptEngineEvent: () => true,
      onEntityTurn: (turn) => turns.push(turn),
    },
  );

  try {
    await policy.tick();
    await until(() => turns.length === 1);
    const system = String(request.messages[0].content);
    assert.ok(system.length < 4000, `four-gate prompt was ${system.length} characters`);
    assert.match(
      system,
      /ordering, preconditions, and prohibitions.*take precedence over the generic action heuristics/i,
    );
    assert.match(system, /self\.projects is your bounded/i);
    assert.match(system, /dropped items are nearby/i);
    assert.match(system, /bodyFeet.*occupied by bodies/i);
    assert.doesNotMatch(system, /Minecraft chat is narrow/i);
    assert.doesNotMatch(system, /descend_step/i);
    assert.doesNotMatch(system, /sealed=true/i);
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('a failed model call is visible once with request provenance and no credential', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let now = 2000;
  globalThis.fetch = (async () => {
    calls += 1;
    now = 2041;
    return {
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => 'rate limited',
    } as any;
  }) as typeof fetch;

  const failures: any[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [tool('inspect_volume')],
      attempt: () => true,
      observe: () => experience(1, null, 0),
    },
    {
      apiKey: 'super-secret-test-key',
      model: 'test/model',
      endpoint: 'https://models.example.test/v1/chat/completions?credential=secret',
      now: () => now,
      acceptEngineEvent: () => true,
      onModelError: (failure) => failures.push(failure),
    },
  );

  try {
    await policy.tick();
    assert.equal(calls, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].call.response.status, 429);
    assert.equal(failures[0].call.response.bodyPreview, 'rate limited');
    assert.equal(failures[0].call.endpoint, 'https://models.example.test/v1/chat/completions');
    assert.equal(failures[0].call.latencyMs, 41);
    assert.equal(failures[0].call.request.body, undefined);
    assert.equal(JSON.stringify(failures[0]).includes('super-secret-test-key'), false);
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('controller breaks a communication-only loop until the body acts or a human replies', async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    assistantTool('chat-one', 'chat', { text: 'First message.' }),
    assistantTool('chat-two', 'chat', { text: 'Second message.' }),
    assistantTool('chat-three', 'chat', { text: 'Third message.' }),
    assistantTool('collect-after-chat', 'collect_nearby_item', { maxDistance: 16 }),
  ];
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: responses.shift() }] }),
      text: async () => '',
    }) as any) as typeof fetch;

  let sequence = 1;
  const enqueued: any[] = [];
  const turns: EntityTurn[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [tool('chat'), tool('collect_nearby_item')],
      attempt: (intent) => {
        enqueued.push(intent);
        return true;
      },
      observe: (sinceSequence) => experience(sequence, null, sinceSequence),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      acceptEngineEvent: () => true,
      onEntityTurn: (turn) => turns.push(turn),
    },
  );

  try {
    await policy.tick();
    for (let index = 0; index < 2; index += 1) {
      await until(() => enqueued.length === index + 1);
      sequence += 1;
      policy.onEngineEvent({
        type: 'action_completed',
        at: 20 + index,
        data: { intent: enqueued[index], result: { ok: true } },
      });
    }
    await until(() => enqueued.length === 3);
    assert.deepEqual(
      enqueued.map((intent) => intent.tool),
      ['chat', 'chat', 'collect_nearby_item'],
    );
    assert.equal(turns[2]?.action.name, 'chat');
    assert.equal(turns[2]?.outcome.error, 'communication_without_world_progress');
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('a safe untasked life may act directly without wrapping one step in a project', async () => {
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  const responses = [
    assistantTool('first-action', 'dig_block', { x: 1, y: 64, z: 1 }),
    assistantTool('project-wait', 'wait_for_event', { reason: 'project recorded' }),
  ];
  globalThis.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(String(init?.body || '{}')));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: responses.shift() }] }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  let currentAction: any = null;
  let sequence = 1;
  const enqueued: any[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [tool('manage_project'), tool('dig_block')],
      attempt: (intent) => {
        enqueued.push(intent);
        currentAction = { id: intent.id, tool: intent.tool, status: 'queued' };
        return true;
      },
      observe: () => ({
        protocol: 'behold.inhabitant.v1',
        sequence,
        task: null,
        self: {
          projects: [],
          condition: { health: 20, food: 20, oxygen: null },
          currentAction,
        },
        scene: { entities: [] },
        events: [{ sequence, type: 'spawned', isNew: true, data: {} }],
      }),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      acceptEngineEvent: () => true,
    },
  );

  try {
    await policy.tick();
    assert.equal(enqueued[0]?.tool, 'dig_block');
    assert.equal(requests[0]?.tool_choice, 'auto');

    sequence += 1;
    currentAction = { ...currentAction, status: 'completed' };
    await policy.onEngineEvent({
      type: 'action_completed',
      at: 20,
      data: { intent: enqueued[0], result: { ok: true } },
    });
    await until(() => requests.length === 2);
    assert.equal(requests[1]?.tool_choice, 'auto');
    assert.equal(enqueued.length, 1, 'wait_for_event does not enter the action stream');
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('a remembered-place conflict must be resolved before more embodied construction', async () => {
  const originalFetch = globalThis.fetch;
  let request: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    request = JSON.parse(String(init?.body || '{}'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: assistantTool('abandon-duplicate', 'manage_project', {
              operation: 'abandon',
              id: 'night-refuge',
            }),
          },
        ],
      }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  const enqueued: any[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [tool('manage_project'), tool('place_block'), tool('move_to')],
      attempt: (intent) => {
        enqueued.push(intent);
        return true;
      },
      observe: () => ({
        protocol: 'behold.inhabitant.v1',
        sequence: 1,
        task: null,
        self: {
          projects: [{ id: 'night-refuge', needsDefinition: false }],
          places: [{ id: 'place:home', distance: 23 }],
          placeConflicts: [
            {
              projectId: 'night-refuge',
              placeId: 'place:home',
              distance: 23,
              reason: 'known adequate shelter nearby',
            },
          ],
          condition: { health: 20, food: 20, oxygen: null },
          currentAction: null,
        },
        scene: { entities: [] },
        events: [{ sequence: 1, type: 'spawned', isNew: true, data: {} }],
      }),
    },
    { apiKey: 'test-key', model: 'test/model', acceptEngineEvent: () => true },
  );

  try {
    await policy.tick();
    assert.deepEqual(request.tool_choice, {
      type: 'function',
      function: { name: 'manage_project' },
    });
    assert.equal(enqueued[0]?.tool, 'manage_project');
    assert.equal(enqueued[0]?.input.operation, 'abandon');
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('a safe dropped stack outranks new project selection while empty-server chat is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  let request: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    request = JSON.parse(String(init?.body || '{}'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: assistantTool('collect-safe-drop', 'collect_nearby_item', {
              name: 'birch_log',
              maxDistance: 6,
            }),
          },
        ],
      }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  const enqueued: any[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [tool('manage_project'), tool('collect_nearby_item'), tool('chat')],
      attempt: (intent) => {
        enqueued.push(intent);
        return true;
      },
      observe: () => ({
        protocol: 'behold.inhabitant.v1',
        sequence: 1,
        task: null,
        self: {
          projects: [],
          pose: { onGround: true, velocity: { x: 0, y: 0, z: 0 } },
          condition: { health: 20, food: 20, oxygen: null },
          currentAction: null,
        },
        scene: {
          social: { playersOnline: [] },
          entities: [
            {
              kind: 'item',
              name: 'birch_log',
              distance: 2,
              pickupSafety: { ok: true },
            },
          ],
        },
        events: [{ sequence: 1, type: 'spawned', isNew: true, data: {} }],
      }),
    },
    { apiKey: 'test-key', model: 'test/model', acceptEngineEvent: () => true },
  );

  try {
    await policy.tick();
    assert.deepEqual(request.tool_choice, {
      type: 'function',
      function: { name: 'collect_nearby_item' },
    });
    assert.equal(
      request.tools.some((spec: any) => spec.function.name === 'chat'),
      false,
    );
    assert.equal(enqueued[0]?.tool, 'collect_nearby_item');
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('a falling body yields for a new embodied event instead of starting another action', async () => {
  const originalFetch = globalThis.fetch;
  let request: any = null;
  globalThis.fetch = (async (_url: any, init: any) => {
    request = JSON.parse(String(init?.body || '{}'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: assistantTool('fall-wait', 'wait_for_event', {
              reason: 'falling; wait for grounded, hurt, death, or spawn evidence',
            }),
          },
        ],
      }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  const enqueued: any[] = [];
  const turns: EntityTurn[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [tool('dig_block')],
      attempt: (intent) => {
        enqueued.push(intent);
        return true;
      },
      observe: () => ({
        protocol: 'behold.inhabitant.v1',
        sequence: 1,
        task: null,
        self: {
          projects: [{ id: 'home' }],
          pose: { onGround: false, velocity: { x: 0, y: -3.2, z: 0 } },
          condition: { health: 20, food: 20, oxygen: null },
          currentAction: null,
        },
        scene: { entities: [] },
        events: [{ sequence: 1, type: 'condition_changed', isNew: true, data: {} }],
      }),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      acceptEngineEvent: () => true,
      onEntityTurn: (turn) => turns.push(turn),
    },
  );

  try {
    await policy.tick();
    await until(() => turns.length === 1);
    assert.deepEqual(request.tool_choice, {
      type: 'function',
      function: { name: 'wait_for_event' },
    });
    assert.equal(turns[0].action.name, 'wait_for_event');
    assert.equal(enqueued.length, 0);
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('a restarted controller blocks a fourth consecutive failed embodied strategy', async () => {
  const originalFetch = globalThis.fetch;
  let responseNumber = 0;
  globalThis.fetch = (async () => {
    responseNumber += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: assistantTool(`failed-dig-${responseNumber}`, 'dig_block', {
              x: responseNumber,
              y: 62,
              z: 0,
            }),
          },
        ],
      }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  const history = [1, 2, 3].map((sequence) => failedTurn(sequence, 'dig_block'));
  const turns: EntityTurn[] = [];
  const enqueued: any[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [tool('dig_block')],
      attempt: (intent) => {
        enqueued.push(intent);
        return true;
      },
      observe: () => experience(4, null, 0),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      acceptEngineEvent: () => true,
      history,
      maxTurnSteps: 1,
      onEntityTurn: (turn) => turns.push(turn),
    },
  );

  try {
    await policy.tick();
    await until(() => turns.length === 1);
    assert.equal(enqueued.length, 0);
    assert.equal(turns[0].outcome.error, 'repeated_failed_strategy');
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('a restarted controller continues the same entity trajectory from loom turns', async () => {
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(String(init?.body || '{}')));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: assistantTool('call-new-wait', 'wait_for_event', {
              reason: 'waiting after restart',
            }),
          },
        ],
      }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  const prior: EntityTurn = {
    protocol: 'behold.entity-turn.v1',
    id: 'Scout:turn:1',
    entityId: 'Scout',
    sequence: 1,
    parentId: null,
    model: 'test/model',
    startedAt: 10,
    completedAt: 20,
    observation: { protocol: 'behold.inhabitant.v1', sequence: 1 },
    utterance: {
      assistant: assistantTool('call-old-status', 'status', {}),
    },
    action: {
      id: 'old-action',
      name: 'status',
      input: {},
      source: 'llm',
      kind: 'parallel',
      toolCallId: 'call-old-status',
    },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: { position: { x: 4, y: 64, z: 8 } },
    },
    nextObservation: { protocol: 'behold.inhabitant.v1', sequence: 2 },
  };
  const turns: EntityTurn[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [],
      attempt: () => true,
      observe: () => experience(1, null, 0),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      acceptEngineEvent: () => true,
      history: [prior],
      onEntityTurn: (turn) => turns.push(turn),
    },
  );

  try {
    await policy.tick();
    assert.equal(requests.length, 1);
    assert.ok(
      requests[0].messages.some(
        (message: any) =>
          message.role === 'tool' &&
          message.tool_call_id === 'call-old-status' &&
          JSON.parse(message.content).result.position.x === 4,
      ),
      'the prior action observation was not restored into the model context',
    );
    assert.equal(turns[0]?.sequence, 2);
    assert.equal(turns[0]?.parentId, 'Scout:turn:1');
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('controller context remains bounded across a continuing life', async () => {
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  const actionCount = 18;
  const responses = [
    ...Array.from({ length: actionCount }, (_, index) =>
      assistantTool(`call-status-${index}`, 'status', { sample: index }),
    ),
    assistantTool('call-bounded-wait', 'wait_for_event', { reason: 'rest' }),
  ];
  globalThis.fetch = (async (_url: any, init: any) => {
    const request = JSON.parse(String(init?.body || '{}'));
    requests.push(request);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: responses.shift() }] }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  let sequence = 1;
  const enqueued: any[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [tool('status')],
      attempt: (intent) => {
        enqueued.push(intent);
        return true;
      },
      observe: (sinceSequence) => experience(sequence, null, sinceSequence),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      maxTurnSteps: 32,
      acceptEngineEvent: () => true,
      summarizeLoom: async ({ previousSummary, fromSequence, toSequence }) =>
        `${previousSummary || ''} [t${fromSequence}-t${toSequence}]`.trim(),
    },
  );

  try {
    await policy.tick();
    for (let index = 0; index < actionCount; index += 1) {
      await until(() => enqueued.length === index + 1);
      sequence += 1;
      policy.onEngineEvent({
        type: 'action_completed',
        at: 100 + index,
        data: { intent: enqueued[index], result: { ok: true, sample: index } },
      });
    }
    await until(() => policy.state().turnActive === false && requests.length === actionCount + 1);
    assert.ok(
      Math.max(...requests.map((request) => request.messages.length)) <= 48,
      'working context should contain only the bounded recent trajectory',
    );
    assert.ok(policy.state().loomContext.foldedThrough >= 8);
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('bounded event projection drains oldest unread batches without skipping the remainder', async () => {
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  const responses = [
    assistantTool('wait-first-batch', 'wait_for_event', { reason: 'batch one read' }),
    assistantTool('wait-second-batch', 'wait_for_event', { reason: 'batch two read' }),
  ];
  globalThis.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(String(init?.body || '{}')));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: responses.shift() }] }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  const observedAfter: number[] = [];
  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [],
      attempt: () => true,
      observe: (sinceSequence) => {
        observedAfter.push(sinceSequence);
        return {
          protocol: 'behold.inhabitant.v1',
          sequence: 20,
          eventWindow: {
            requestedAfterSequence: sinceSequence,
            oldestAvailableSequence: 1,
            newestAvailableSequence: 20,
            missingBeforeOldest: 0,
            complete: true,
          },
          self: { currentAction: null },
          scene: { entities: [] },
          events: Array.from({ length: 20 }, (_, index) => ({
            sequence: index + 1,
            type: 'world_event',
            data: { index: index + 1 },
            isNew: index + 1 > sinceSequence,
          })),
        };
      },
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      acceptEngineEvent: () => true,
    },
  );

  try {
    await policy.tick();
    assert.equal(policy.state().lastSequence, 12);
    await policy.tick();
    assert.equal(policy.state().lastSequence, 20);
    assert.ok(observedAfter.includes(12));
    const firstUpdate = String(requests[0].messages.at(-1)?.content || '');
    const secondUpdate = String(requests[1].messages.at(-1)?.content || '');
    assert.ok(firstUpdate.includes('"sequence":1'));
    assert.ok(firstUpdate.includes('"sequence":12'));
    assert.equal(firstUpdate.includes('"sequence":13'), false);
    assert.ok(secondUpdate.includes('"sequence":13'));
    assert.ok(secondUpdate.includes('"sequence":20'));
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('controller resumes from a generic folded view of its own older loom', async () => {
  const turns = Array.from({ length: 40 }, (_, index) => {
    const sequence = index + 1;
    const playerText =
      sequence === 2
        ? 'my coordinates are 314 69 36'
        : sequence === 4
          ? 'can you use shorter messages please'
          : `ordinary conversation message ${sequence}`;
    const placed = sequence === 3;
    return {
      protocol: 'behold.entity-turn.v1' as const,
      id: `Scout:turn:${sequence}`,
      entityId: 'Scout',
      sequence,
      parentId: sequence === 1 ? null : `Scout:turn:${sequence - 1}`,
      model: 'test/model',
      startedAt: sequence * 10,
      completedAt: sequence * 10 + 5,
      observation: {
        protocol: 'behold.inhabitant.v1',
        events: [
          {
            at: sequence * 10,
            type: 'chat_received',
            data: { from: 'importdf', text: playerText },
          },
          ...(sequence === 5
            ? [
                {
                  at: sequence * 10 + 1,
                  type: 'nearby_player_equipment_changed',
                  data: { name: 'importdf', heldItem: 'wooden_pickaxe' },
                },
              ]
            : []),
        ],
      },
      utterance: { assistant: assistantTool(`call-${sequence}`, 'status', {}) },
      action: {
        id: `action-${sequence}`,
        name: placed ? 'place_against' : 'status',
        input: {},
        source: 'llm' as const,
        kind: placed ? ('exclusive' as const) : ('parallel' as const),
        toolCallId: `call-${sequence}`,
      },
      outcome: {
        ok: true,
        eventType: 'action_completed',
        result: placed
          ? {
              changes: [
                {
                  verb: 'place',
                  verified: true,
                  after: 'crafting_table',
                  position: { x: 3513, y: 1, z: 641 },
                },
              ],
            }
          : {},
      },
      nextObservation: { protocol: 'behold.inhabitant.v1', events: [] },
    } satisfies EntityTurn;
  });

  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  const foldRequests: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(String(init?.body || '{}')));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: assistantTool('call-resumed-wait', 'wait_for_event', {
              reason: 'continuity loaded',
            }),
          },
        ],
      }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  const policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [],
      attempt: () => true,
      observe: () => experience(1, null, 0),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      acceptEngineEvent: () => true,
      history: turns,
      foldRecentTurns: 8,
      foldBatchTurns: 16,
      summarizeLoom: async (request) => {
        foldRequests.push(request);
        return [
          request.previousSummary,
          `[t${request.fromSequence}-t${request.toSequence}] importdf gave coordinates 314 69 36, prefers short messages, and Scout placed a crafting table at 3513 1 641.`,
        ]
          .filter(Boolean)
          .join(' ');
      },
    },
  );

  try {
    await policy.tick();
    assert.equal(foldRequests.length, 2);
    assert.ok(foldRequests.every((request) => request.entityId === 'Scout'));
    assert.equal(requests.length, 1);
    const folded = requests[0].messages.find((message: any) =>
      String(message.content || '').includes('Folded view of your own loom'),
    );
    assert.ok(folded);
    assert.match(folded.content, /coordinates 314 69 36/);
    assert.match(folded.content, /prefers short messages/);
    assert.match(folded.content, /crafting table at 3513 1 641/);
    assert.equal(policy.state().loomContext.foldedThrough, 32);
    assert.equal(policy.state().loomContext.visibleTurns, 9);
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

function tool(name: string) {
  return {
    type: 'function' as const,
    function: {
      name,
      description: name,
      parameters: { type: 'object', properties: {} },
    },
  };
}

function assistantTool(id: string, name: string, args: any) {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

function failedTurn(sequence: number, actionName: string): EntityTurn {
  return {
    protocol: 'behold.entity-turn.v1',
    id: `Scout:turn:${sequence}`,
    entityId: 'Scout',
    sequence,
    parentId: sequence === 1 ? null : `Scout:turn:${sequence - 1}`,
    model: 'test/model',
    startedAt: sequence * 10,
    completedAt: sequence * 10 + 1,
    observation: {},
    utterance: { assistant: assistantTool(`old-${sequence}`, actionName, {}) },
    action: {
      id: `old-action-${sequence}`,
      name: actionName,
      input: { x: sequence, y: 62, z: 0 },
      source: 'llm',
      kind: 'exclusive',
      toolCallId: `old-${sequence}`,
    },
    outcome: {
      ok: false,
      eventType: 'action_failed',
      result: { error: 'unreachable' },
      error: 'unreachable',
    },
    nextObservation: {},
  };
}

function experience(sequence: number, currentAction: any, sinceSequence: number) {
  return {
    protocol: 'behold.inhabitant.v1',
    sequence,
    observedAt: 100 + sequence,
    task: { id: 'come-see-do-report', target: 'importdf' },
    self: { currentAction },
    scene: {
      entities: [{ id: 'player:importdf', name: 'importdf', kind: 'player', distance: 2.1 }],
      terrain: { materials: [{ name: 'gray_concrete', count: 12 }] },
    },
    events: [
      {
        sequence,
        type: sequence === 1 ? 'spawned' : 'action_completed',
        isNew: sequence > sinceSequence,
        source: 'event',
        salience: 'normal',
        data: {},
      },
    ],
  };
}

async function drainImmediateQueue() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await drainImmediateQueue();
  }
  assert.fail('timed out waiting for controller continuation');
}
