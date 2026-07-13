import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/loop/engine';
import { startLLMPolicy } from '../src/policy/llm';

test('every active action holds execution ownership and deduplicates equivalent work', async () => {
  let finishMove!: (value: any) => void;
  const move = new Promise((resolve) => {
    finishMove = resolve;
  });
  const events: string[] = [];
  const engine = createEngine(
    {
      list: () => [],
      run: async (name) => (name === 'move_to' ? move : { ok: true }),
    },
    {
      onEvent: (event) => events.push(`${event.type}:${event.data?.intent?.tool || ''}`),
    },
  );

  engine.enqueueIntent({
    id: 'move-1',
    source: 'llm',
    tool: 'move_to',
  });
  const moveTick = engine.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.arbiter.activeLease()?.intent.id, 'move-1');

  assert.equal(
    engine.enqueueIntent({
      id: 'move-duplicate',
      source: 'llm',
      tool: 'move_to',
    }),
    false,
  );

  engine.enqueueIntent({
    id: 'chat-1',
    source: 'llm',
    tool: 'chat',
  });
  await engine.tick();
  assert.equal(engine.arbiter.activeLease()?.intent.id, 'move-1');

  finishMove({ ok: true, status: 'arrived' });
  await moveTick;
  assert.equal(engine.arbiter.activeLease(), null);
  assert.ok(events.includes('action_started:move_to'));
  assert.ok(events.includes('action_completed:move_to'));
});

test('an interpreter result with ok false emits a failed lifecycle', async () => {
  const events: string[] = [];
  const engine = createEngine(
    {
      list: () => [],
      run: async () => ({ ok: false, error: 'no_path' }),
    },
    {
      onEvent: (event) => events.push(event.type),
    },
  );
  engine.enqueueIntent({
    id: 'move-2',
    source: 'llm',
    tool: 'move_to',
  });
  await engine.tick();
  assert.ok(events.includes('action_started'));
  assert.ok(events.includes('action_failed'));
  assert.equal(events.includes('action_completed'), false);
});

test('human preemption never overlaps the active world action', async () => {
  let finishMove!: (value: any) => void;
  const move = new Promise((resolve) => {
    finishMove = resolve;
  });
  let active = 0;
  let maxActive = 0;
  const events: string[] = [];
  const engine = createEngine(
    {
      list: () => [],
      run: async (name) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          if (name === 'move_to') return await move;
          return { ok: true };
        } finally {
          active -= 1;
        }
      },
    },
    { onEvent: (event) => events.push(`${event.type}:${event.data?.intent?.tool || ''}`) },
  );

  engine.enqueueIntent({
    id: 'moving',
    source: 'llm',
    tool: 'move_to',
  });
  const moveTick = engine.tick();
  await new Promise((resolve) => setImmediate(resolve));
  engine.enqueueHumanIntent({
    tool: 'dig_block',
    input: { x: 1, y: 64, z: 1 },
    preempt: true,
  });

  await engine.tick();
  assert.equal(maxActive, 1);
  assert.deepEqual(
    events.filter((event) => event.startsWith('action_started')),
    ['action_started:move_to'],
  );
  assert.ok(events.includes('preemption_deferred:dig_block'));

  finishMove({ ok: true, status: 'arrived' });
  await moveTick;
  await engine.tick();
  assert.equal(maxActive, 1);
  assert.deepEqual(
    events.filter((event) => event.startsWith('action_started')),
    ['action_started:move_to', 'action_started:dig_block'],
  );
  assert.ok(
    events.indexOf('action_completed:move_to') < events.indexOf('action_started:dig_block'),
  );
});

test('a registry exception emits exactly one terminal action event', async () => {
  const events: string[] = [];
  const engine = createEngine(
    {
      list: () => [],
      run: async () => {
        throw new Error('boom');
      },
    },
    { onEvent: (event) => events.push(event.type) },
  );
  engine.enqueueIntent({
    id: 'throws-once',
    source: 'llm',
    tool: 'move_to',
  });

  await engine.tick();

  assert.deepEqual(
    events.filter((event) => ['action_completed', 'action_failed', 'tool_error'].includes(event)),
    ['action_failed'],
  );
});

test('an event observer exception cannot create a contradictory terminal', async () => {
  const events: string[] = [];
  const logs: string[] = [];
  const engine = createEngine(
    {
      list: () => [],
      run: async () => ({ ok: true }),
    },
    {
      log: (line) => logs.push(line),
      onEvent: (event) => {
        events.push(event.type);
        if (event.type === 'action_completed') throw new Error('observer unavailable');
      },
    },
  );
  engine.enqueueIntent({
    id: 'observer-failure',
    source: 'llm',
    tool: 'move_to',
  });

  await engine.tick();

  assert.deepEqual(
    events.filter((event) => ['action_completed', 'action_failed'].includes(event)),
    ['action_completed'],
  );
  assert.ok(logs.some((line) => line.includes('event observer failed for action_completed')));
});

test('an async event observer rejection is contained outside the action lifecycle', async () => {
  const events: string[] = [];
  const logs: string[] = [];
  const engine = createEngine(
    {
      list: () => [],
      run: async () => ({ ok: true }),
    },
    {
      log: (line) => logs.push(line),
      onEvent: async (event) => {
        events.push(event.type);
        if (event.type === 'action_completed') throw new Error('async observer unavailable');
      },
    },
  );
  engine.enqueueIntent({
    id: 'async-observer-failure',
    source: 'llm',
    tool: 'move_to',
  });

  await engine.tick();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    events.filter((event) => ['action_completed', 'action_failed'].includes(event)),
    ['action_completed'],
  );
  assert.ok(
    logs.some((line) =>
      line.includes('event observer failed for action_completed: async observer unavailable'),
    ),
  );
});

test('engine events are immutable snapshots without freezing caller-owned values', async () => {
  const input = { target: { x: 1, y: 64, z: 1 } };
  const result = { ok: true, consequence: { status: 'arrived' } };
  let completed: any = null;
  const engine = createEngine(
    {
      list: () => [],
      run: async () => result,
    },
    {
      onEvent: (event) => {
        if (event.type === 'action_completed') completed = event;
      },
    },
  );
  engine.enqueueIntent({
    id: 'immutable-snapshot',
    source: 'llm',
    tool: 'move_to',
    input,
  });
  input.target.x = 99;

  await engine.tick();

  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(result), false);
  result.consequence.status = 'caller-mutated';
  assert.equal(completed.data.intent.input.target.x, 1);
  assert.equal(completed.data.result.consequence.status, 'arrived');
  assert.equal(Object.isFrozen(completed.data.result.consequence), true);
});

test('equivalent pending intents are deduplicated before execution', async () => {
  const events: string[] = [];
  const engine = createEngine(
    {
      list: () => [],
      run: async () => ({ ok: true }),
    },
    {
      onEvent: (event) => events.push(event.type),
    },
  );
  const first = engine.enqueueIntent({
    id: 'approach-1',
    source: 'llm',
    tool: 'approach_entity',
    input: { distance: 2.5, name: 'Director' },
  });
  const duplicate = engine.enqueueIntent({
    id: 'approach-2',
    source: 'llm',
    tool: 'approach_entity',
    input: { name: 'Director', distance: 2.5 },
  });
  assert.equal(first, true);
  assert.equal(duplicate, false);
  assert.ok(events.includes('intent_deduplicated'));
});

test('human stop cancels queued model intents before they can execute', async () => {
  const ran: string[] = [];
  const blocked: any[] = [];
  const engine = createEngine(
    {
      list: () => [],
      run: async (name) => {
        ran.push(name);
        return { ok: true };
      },
    },
    {
      onEvent: (event) => {
        if (event.type === 'intent_blocked') blocked.push(event.data);
      },
    },
  );
  engine.enqueueIntent({
    id: 'dig-after-stop',
    source: 'llm',
    tool: 'dig_block',
    input: { x: 1, y: 64, z: 1 },
  });
  engine.enqueueHumanIntent({ tool: 'stop', preempt: true });

  await engine.tick();
  await engine.tick();

  assert.deepEqual(ran, ['stop']);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].intent.id, 'dig-after-stop');
  assert.equal(blocked[0].reason, 'human_stop');
  assert.equal(blocked[0].result.error, 'interrupted_by_human');
});

test('human stop latches model execution while a continuing controller tries to replace the action', async () => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  const responses = [
    modelTool('first-dig', 'dig_block', { x: 1, y: 64, z: 1 }),
    modelTool('replacement-dig', 'dig_block', { x: 2, y: 64, z: 2 }),
    modelTool('wait-after-stop', 'wait_for_event', { reason: 'Human stopped me' }),
  ];
  globalThis.fetch = (async () => {
    modelCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: responses.shift() }] }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  const ran: string[] = [];
  let policy: ReturnType<typeof startLLMPolicy> | null = null;
  const engine = createEngine(
    {
      list: () => [],
      run: async (name) => {
        ran.push(name);
        return { ok: true };
      },
    },
    { onEvent: (event) => policy?.onEngineEvent(event) },
  );
  policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [engineTool('dig_block')],
      attempt: (intent) => engine.enqueueIntent(intent),
      observe: () => ({
        protocol: 'behold.inhabitant.v1',
        sequence: 1,
        self: { currentAction: null },
        scene: { entities: [], terrain: { materials: [] } },
        events: [{ type: 'spawned', isNew: true }],
      }),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      acceptEngineEvent: engine.acceptsEvent,
    },
  );

  try {
    await policy.tick();
    assert.ok(policy.state().pendingIntentId);
    engine.enqueueHumanIntent({ tool: 'stop', preempt: true });
    await modelSettles(() => policy!.state().turnActive === false);
    await engine.tick();
    await engine.tick();
    assert.deepEqual(ran, ['stop']);
    assert.equal(policy.state().pendingIntentId, null);
    assert.equal(policy.state().suspended, true);
    assert.equal(modelCalls, 1);
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

test('a forged lifecycle object cannot advance controller history', async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    modelTool('real-dig', 'dig_block', { x: 1, y: 64, z: 1 }),
    modelTool('wait-after-real-result', 'wait_for_event', { reason: 'done' }),
  ];
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: responses.shift() }] }),
      text: async () => '',
    }) as any) as typeof fetch;

  const turns: any[] = [];
  let policy: ReturnType<typeof startLLMPolicy> | null = null;
  const engine = createEngine(
    {
      list: () => [],
      run: async () => ({ ok: true, changes: [] }),
    },
    { onEvent: (event) => void policy?.onEngineEvent(event) },
  );
  policy = startLLMPolicy(
    {
      entityId: 'Scout',
      actions: [engineTool('dig_block')],
      attempt: (intent) => engine.enqueueIntent(intent),
      observe: () => ({
        protocol: 'behold.inhabitant.v1',
        sequence: 1,
        self: { currentAction: null },
        scene: { entities: [], terrain: { materials: [] } },
        events: [{ type: 'spawned', isNew: true }],
      }),
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      acceptEngineEvent: engine.acceptsEvent,
      onEntityTurn: (turn) => turns.push(turn),
    },
  );

  try {
    await policy.tick();
    const pendingId = policy.state().pendingIntentId;
    assert.ok(pendingId);
    await policy.onEngineEvent({
      type: 'action_completed',
      at: 20,
      data: {
        intent: {
          id: pendingId,
          source: 'llm',
          tool: 'forged_other_tool',
          input: { x: 1, y: 64, z: 1 },
        },
        result: { ok: true, verified: true, claim: 'fabricated' },
      },
    });
    assert.equal(policy.state().pendingIntentId, pendingId);
    assert.equal(turns.length, 0);

    await engine.tick();
    await modelSettles(() => policy!.state().turnActive === false);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].action.name, 'dig_block');
    assert.equal(turns[0].outcome.result.claim, undefined);
  } finally {
    policy.stop();
    globalThis.fetch = originalFetch;
  }
});

function engineTool(name: string) {
  return {
    type: 'function' as const,
    function: {
      name,
      description: name,
      parameters: { type: 'object', properties: {} },
    },
  };
}

function modelTool(id: string, name: string, args: any) {
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

async function modelSettles(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('timed out waiting for controller to settle');
}
