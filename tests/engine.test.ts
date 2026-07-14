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

test('a started engine dispatches admitted work immediately and drains it serially', async () => {
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => (markFirstStarted = resolve));
  let markSecondStarted!: () => void;
  const secondStarted = new Promise<void>((resolve) => (markSecondStarted = resolve));
  const started: string[] = [];
  const engine = createEngine(
    {
      list: () => [],
      run: async (tool) => {
        started.push(tool);
        if (tool === 'first') {
          markFirstStarted();
          await firstGate;
        } else {
          markSecondStarted();
        }
        return { ok: true };
      },
    },
    { tickMs: 60_000 },
  );

  engine.start();
  try {
    engine.enqueueIntent({ id: 'first', source: 'llm', tool: 'first' });
    await firstStarted;
    engine.enqueueIntent({ id: 'second', source: 'llm', tool: 'second' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ['first']);

    releaseFirst();
    await secondStarted;
    assert.deepEqual(started, ['first', 'second']);
  } finally {
    releaseFirst();
    engine.stop();
  }
});

test('stopping the engine cancels scheduled automatic dispatch', async () => {
  let dispatches = 0;
  const engine = createEngine(
    {
      list: () => [],
      run: async () => {
        dispatches += 1;
        return { ok: true };
      },
    },
    { tickMs: 60_000 },
  );

  engine.start();
  engine.stop();
  engine.enqueueIntent({ id: 'after-stop', source: 'llm', tool: 'move_to' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(dispatches, 0);
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

test('permission denial is recorded before dispatch and never starts the adapter', async () => {
  const events: string[] = [];
  let dispatches = 0;
  const engine = createEngine(
    {
      list: () => [],
      authorize: () => ({
        ok: false,
        authority: 'task-policy',
        error: 'explicit_change_request_required',
        reason: 'Wait for the player request',
      }),
      run: async () => {
        dispatches += 1;
        return { ok: true };
      },
    },
    { onEvent: (event) => events.push(event.type) },
  );
  engine.enqueueIntent({ id: 'denied-place', source: 'llm', tool: 'place_block' });

  await engine.tick();

  assert.equal(dispatches, 0);
  assert.deepEqual(events.slice(-3), ['intent_selected', 'permission_decision', 'intent_blocked']);
  assert.equal(events.includes('action_started'), false);
});

test('positive permission is engine-bound and precedes action start', async () => {
  const events: any[] = [];
  const engine = createEngine(
    {
      list: () => [],
      authorize: () => ({ ok: true, authority: 'task-policy' }),
      run: async () => ({ ok: true, status: 'arrived' }),
    },
    { onEvent: (event) => events.push(event) },
  );
  engine.enqueueIntent({ id: 'allowed-move', source: 'llm', tool: 'move_to' });

  await engine.tick();

  assert.deepEqual(
    events
      .filter((event) =>
        ['intent_selected', 'permission_decision', 'action_started', 'action_completed'].includes(
          event.type,
        ),
      )
      .map((event) => event.type),
    ['intent_selected', 'permission_decision', 'action_started', 'action_completed'],
  );
  const completed = events.find((event) => event.type === 'action_completed');
  assert.deepEqual(completed.data.authorization, { ok: true, authority: 'task-policy' });
});

test('engine tool allowlist blocks a mutator before registry authorization or dispatch', async () => {
  const events: any[] = [];
  let authorizations = 0;
  let dispatches = 0;
  const engine = createEngine(
    {
      list: () => [],
      authorize: () => {
        authorizations += 1;
        return { ok: true, authority: 'task-policy' };
      },
      run: async () => {
        dispatches += 1;
        return { ok: true };
      },
    },
    {
      allowTools: ['approach_entity', 'chat'],
      onEvent: (event) => events.push(event),
    },
  );
  engine.enqueueIntent({ id: 'not-allowed', source: 'llm', tool: 'descend_step' });

  await engine.tick();

  assert.equal(authorizations, 0);
  assert.equal(dispatches, 0);
  assert.deepEqual(
    events.slice(-3).map((event) => event.type),
    ['intent_selected', 'permission_decision', 'intent_blocked'],
  );
  assert.equal(events.at(-2).data.authorization.authority, 'engine-tool-allowlist');
  assert.equal(
    events.some((event) => event.type === 'action_started'),
    false,
  );
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

test('human stop reaches an active adapter and waits for its cancellation acknowledgement', async () => {
  const events: any[] = [];
  let activeStarted!: () => void;
  const started = new Promise<void>((resolve) => (activeStarted = resolve));
  const ran: string[] = [];
  const engine = createEngine(
    {
      list: () => [],
      run: async (name, _args, _intent, execution) => {
        ran.push(name);
        if (name === 'stop') return { ok: true };
        activeStarted();
        await new Promise<void>((resolve) =>
          execution!.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        return {
          ok: false,
          error: 'interrupted_by_human',
          cancellation: { acknowledged: true, adapter: 'test-adapter' },
        };
      },
    },
    { onEvent: (event) => events.push(event) },
  );
  engine.enqueueIntent({ id: 'active-move', source: 'llm', tool: 'move_to' });

  const activeTick = engine.tick();
  await started;
  engine.enqueueHumanIntent({ tool: 'stop', preempt: true });
  await activeTick;
  await engine.tick();

  assert.deepEqual(ran, ['move_to', 'stop']);
  assert.deepEqual(
    events
      .filter((event) =>
        ['cancellation_requested', 'action_failed', 'action_completed'].includes(event.type),
      )
      .map((event) => [event.type, event.data.intent.tool]),
    [
      ['cancellation_requested', 'move_to'],
      ['action_failed', 'move_to'],
      ['action_completed', 'stop'],
    ],
  );
  const failed = events.find(
    (event) => event.type === 'action_failed' && event.data.intent.id === 'active-move',
  );
  assert.deepEqual(failed.data.cancellation, {
    requested: true,
    reason: 'human_stop',
    acknowledged: true,
    adapter: 'test-adapter',
  });
  assert.equal(failed.data.failureKind, 'adapter_acknowledged_cancellation');
});

test('human stop never fabricates cancellation when an active adapter cannot acknowledge it', async () => {
  const events: any[] = [];
  let activeStarted!: () => void;
  const started = new Promise<void>((resolve) => (activeStarted = resolve));
  let finishActive!: () => void;
  const finish = new Promise<void>((resolve) => (finishActive = resolve));
  const ran: string[] = [];
  const engine = createEngine(
    {
      list: () => [],
      run: async (name) => {
        ran.push(name);
        if (name === 'stop') return { ok: true };
        activeStarted();
        await finish;
        return { ok: true };
      },
    },
    { onEvent: (event) => events.push(event) },
  );
  engine.enqueueIntent({ id: 'active-place', source: 'llm', tool: 'place_block' });

  const activeTick = engine.tick();
  await started;
  engine.enqueueHumanIntent({ tool: 'stop', preempt: true });
  await engine.tick();
  assert.deepEqual(ran, ['place_block']);

  finishActive();
  await activeTick;
  await engine.tick();

  assert.deepEqual(ran, ['place_block', 'stop']);
  const completed = events.find(
    (event) => event.type === 'action_completed' && event.data.intent.id === 'active-place',
  );
  assert.deepEqual(completed.data.cancellation, {
    requested: true,
    reason: 'human_stop',
    acknowledged: false,
    adapter: null,
  });
  assert.equal(
    events.some(
      (event) => event.type === 'action_failed' && event.data.intent.id === 'active-place',
    ),
    false,
  );
});

test('engine shutdown stops admission, requests adapter cancellation, and drains the terminal', async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const events: any[] = [];
  let observedSignal: AbortSignal | null = null;
  const engine = createEngine(
    {
      list: () => [],
      run: async (_tool, _args, _intent, execution) => {
        observedSignal = execution!.signal;
        entered();
        await new Promise<void>((resolve) =>
          execution!.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        return {
          ok: false,
          error: 'interrupted_by_shutdown',
          cancellation: { acknowledged: true, adapter: 'fixture-adapter' },
        };
      },
    },
    { onEvent: (event) => events.push(event) },
  );
  engine.enqueueIntent({ id: 'shutdown-active', source: 'llm', tool: 'move_to' });
  const tick = engine.tick();
  await started;

  const result = await engine.shutdown('controller_stdin_closed');
  await tick;

  assert.equal(result.drained, true);
  assert.equal(observedSignal?.aborted, true);
  assert.equal(engine.state().inFlightIntent, null);
  const requested = events.find((event) => event.type === 'cancellation_requested');
  assert.equal(requested.data.requestedBy.source, 'system');
  const terminal = events.find((event) => event.type === 'action_failed');
  assert.equal(terminal.data.cancellation.acknowledged, true);
});

test('engine shutdown cancels every queued source and permanently closes admission', async () => {
  let dispatches = 0;
  const events: any[] = [];
  const engine = createEngine(
    {
      list: () => [],
      run: async () => {
        dispatches += 1;
        return { ok: true };
      },
    },
    { onEvent: (event) => events.push(event) },
  );
  engine.enqueueIntent({ id: 'queued-human', source: 'human', tool: 'chat' });
  engine.enqueueIntent({ id: 'queued-system', source: 'system', tool: 'status' });
  engine.enqueueIntent({ id: 'queued-llm', source: 'llm', tool: 'look' });

  const result = await engine.shutdown('fixture_shutdown');
  assert.equal(result.drained, true);
  assert.equal(engine.state().shuttingDown, true);
  assert.equal(engine.enqueueIntent({ id: 'late-llm', source: 'llm', tool: 'look' }), false);
  assert.equal(
    engine.enqueueIntent({ id: 'late-system', source: 'system', tool: 'status' }),
    false,
  );
  assert.equal(engine.enqueueHumanIntent({ tool: 'chat' }), false);
  await engine.tick();

  assert.equal(dispatches, 0);
  const blocked = events.filter((event) => event.type === 'intent_blocked');
  for (const id of ['queued-human', 'queued-system', 'queued-llm', 'late-llm', 'late-system']) {
    assert.ok(blocked.some((event) => event.data.intent.id === id));
  }
  assert.ok(blocked.some((event) => event.data.intent.source === 'human'));
});

test('execution ownership exists before a lifecycle observer can request shutdown', async () => {
  let engine: ReturnType<typeof createEngine>;
  let shutdown: Promise<any> | null = null;
  let sawAbortedSignal = false;
  engine = createEngine(
    {
      list: () => [],
      run: async (_tool, _args, _intent, execution) => {
        sawAbortedSignal = execution!.signal.aborted;
        return {
          ok: false,
          error: 'interrupted_by_shutdown',
          cancellation: { acknowledged: true, adapter: 'fixture' },
        };
      },
    },
    {
      onEvent: (event) => {
        if (event.type === 'action_started') shutdown = engine.shutdown('observer_shutdown');
      },
    },
  );
  engine.enqueueIntent({ id: 'observer-shutdown', source: 'llm', tool: 'move_to' });

  await engine.tick();
  await shutdown;

  assert.equal(sawAbortedSignal, true);
  assert.equal(engine.state().inFlightIntent, null);
  assert.equal(engine.state().shuttingDown, true);
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
