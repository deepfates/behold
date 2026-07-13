import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/loop/engine';
import { startLLMPolicy } from '../src/policy/llm';

test('a parallel action does not release an in-flight physical action lease', async () => {
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
    kind: 'exclusive',
    tool: 'move_to',
  });
  const moveTick = engine.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.arbiter.activeLease()?.intent.id, 'move-1');

  engine.enqueueIntent({
    id: 'chat-1',
    source: 'llm',
    kind: 'parallel',
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
    kind: 'exclusive',
    tool: 'move_to',
  });
  await engine.tick();
  assert.ok(events.includes('action_started'));
  assert.ok(events.includes('action_failed'));
  assert.equal(events.includes('action_completed'), false);
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
    kind: 'exclusive',
    tool: 'approach_entity',
    input: { distance: 2.5, name: 'Director' },
  });
  const duplicate = engine.enqueueIntent({
    id: 'approach-2',
    source: 'llm',
    kind: 'exclusive',
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
    kind: 'exclusive',
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
