import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  COGNITION_ADMISSION_LIMIT_PROTOCOL,
  COGNITION_ADMISSION_LIMIT_SETTLEMENT_PROTOCOL,
  startCognitionBroker,
  type CognitionBroker,
  type CognitionBrokerEvent,
  verifyCognitionBrokerJournal,
} from '../src/mind/cognition-broker';
import {
  cognitionClientHeaders,
  cognitionResidentKey,
  parseCognitionAdmission,
  type CognitionPriority,
  type CognitionPurpose,
} from '../src/mind/cognition';
import { verifyQuotaLedger } from '../src/observability/quota-ledger';
import { verifyCognitionTransportCapture } from '../src/mind/transport-capture';

const UPSTREAM_KEY = 'upstream-secret-fixture';

test('the cognition gate enforces an exact aggregate admission ceiling before upstream', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-cognition-limit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journalFile = path.join(root, 'cognition.jsonl');
  let upstreamCalls = 0;
  const releases: Array<() => void> = [];
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: [client('a')],
    maxConcurrent: 1,
    maxAccepted: 2,
    journalFile,
    fetch: async () => {
      upstreamCalls += 1;
      await new Promise<void>((resolve) => releases.push(resolve));
      return jsonResponse({ id: `admitted-${upstreamCalls}` });
    },
  });

  const first = brokerRequest(
    broker,
    'a',
    requestBody('fixture/model', 'first'),
    'deliberative',
    'first',
  );
  await waitFor(() => upstreamCalls === 1);
  const second = brokerRequest(
    broker,
    'a',
    requestBody('fixture/model', 'second'),
    'deliberative',
    'second',
  );
  await waitFor(() => broker.snapshot().accepted === 2);

  const reached = await broker.admissionLimitReached;
  assert.equal(reached.protocol, COGNITION_ADMISSION_LIMIT_PROTOCOL);
  assert.equal(reached.brokerId, broker.brokerId);
  assert.equal(reached.accepted, 2);
  assert.equal(reached.limit, 2);
  let settled = false;
  void broker.admissionLimitSettled.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  releases.shift()!();
  const firstResponse = await first;
  assert.equal(firstResponse.status, 200);
  await firstResponse.text();
  await waitFor(() => upstreamCalls === 2);
  assert.equal(settled, false);
  releases.shift()!();
  const secondResponse = await second;
  assert.equal(secondResponse.status, 200);
  await secondResponse.text();

  const settlement = await broker.admissionLimitSettled;
  assert.equal(settlement.protocol, COGNITION_ADMISSION_LIMIT_SETTLEMENT_PROTOCOL);
  assert.equal(settlement.brokerId, broker.brokerId);
  assert.equal(settlement.accepted, 2);
  assert.equal(settlement.terminal, 2);
  assert.equal(settlement.completed, 2);
  assert.equal(settlement.failed, 0);
  assert.equal(settlement.cancelled, 0);

  const refused = await brokerRequest(
    broker,
    'a',
    requestBody('fixture/model', 'refused'),
    'deliberative',
    'refused',
  );
  assert.equal(refused.status, 429);
  assert.equal(((await refused.json()) as any).error.code, 'cognition_admission_limit_exhausted');
  assert.equal(upstreamCalls, 2);
  assert.deepEqual(
    {
      accepted: broker.snapshot().accepted,
      acceptedLimit: broker.snapshot().acceptedLimit,
      acceptedRemaining: broker.snapshot().acceptedRemaining,
      rejected: broker.snapshot().rejected,
    },
    { accepted: 2, acceptedLimit: 2, acceptedRemaining: 0, rejected: 1 },
  );

  await broker.close();
  const verified = verifyCognitionBrokerJournal(journalFile);
  assert.equal(verified.accepted, 2);
  assert.equal(verified.acceptedLimit, 2);
  assert.equal(verified.acceptedRemaining, 0);
  assert.equal(verified.terminal, 2);
});

test('concurrent resident arrivals cannot overshoot the aggregate admission ceiling', async () => {
  const residents = Array.from({ length: 8 }, (_, index) => `resident-${index}`);
  let upstreamCalls = 0;
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: residents.map((name) => client(name)),
    maxConcurrent: 3,
    maxAccepted: 3,
    fetch: async () => {
      upstreamCalls += 1;
      return jsonResponse({ id: `parallel-${upstreamCalls}` });
    },
  });

  try {
    const responses = await Promise.all(
      residents.map((resident) =>
        brokerRequest(
          broker,
          resident,
          requestBody('fixture/model', resident),
          'deliberative',
          resident,
        ),
      ),
    );
    await broker.admissionLimitReached;
    const settlement = await broker.admissionLimitSettled;
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 200, 200, 429, 429, 429, 429, 429],
    );
    assert.equal(upstreamCalls, 3);
    assert.equal(settlement.terminal, 3);
    assert.equal(broker.snapshot().accepted, 3);
    assert.equal(broker.snapshot().acceptedRemaining, 0);
  } finally {
    await broker.close();
  }
});

test('the loopback cognition gate preserves request bytes and enforces aggregate concurrency', async () => {
  let now = 1_000;
  let active = 0;
  let peak = 0;
  const calls: Array<{ body: string; authorization: string | null }> = [];
  const releases: Array<() => void> = [];
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: [client('a'), client('b')],
    maxConcurrent: 1,
    now: () => now,
    fetch: async (_input, init) => {
      active += 1;
      peak = Math.max(peak, active);
      calls.push({
        body: String(init?.body),
        authorization: new Headers(init?.headers).get('authorization'),
      });
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return jsonResponse({ id: `response-${calls.length}` });
    },
  });

  try {
    const firstBody = requestBody('fixture/model', 'first');
    const secondBody = requestBody('fixture/model', 'second');
    const first = brokerRequest(broker, 'a', firstBody, 'deliberative', 'first-request');
    await waitFor(() => calls.length === 1);
    const second = brokerRequest(broker, 'b', secondBody, 'deliberative', 'second-request');
    await waitFor(() => broker.snapshot().queued === 1);
    assert.equal(calls.length, 1);

    now = 1_075;
    releases.shift()!();
    const firstResponse = await first;
    await waitFor(() => calls.length === 2);
    releases.shift()!();
    const secondResponse = await second;

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.deepEqual(
      calls.map((call) => call.body),
      [firstBody, secondBody],
    );
    assert.deepEqual(
      calls.map((call) => call.authorization),
      [`Bearer ${UPSTREAM_KEY}`, `Bearer ${UPSTREAM_KEY}`],
    );
    assert.equal(peak, 1);
    const secondAdmission = parseCognitionAdmission(secondResponse.headers);
    assert.ok(secondAdmission);
    assert.equal(secondAdmission.clientRequestId, 'second-request');
    assert.equal(secondAdmission.queueMs, 75);
    assert.equal(secondAdmission.concurrencyLimit, 1);
    assert.equal(broker.snapshot().peakActive, 1);
  } finally {
    await broker.close();
  }
});

test('urgent cognition jumps the ordinary queue without starving it', async () => {
  const order: string[] = [];
  const releases: Array<() => void> = [];
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: ['blocker', 'ordinary', 'urgent-1', 'urgent-2', 'urgent-3'].map((name) =>
      client(name),
    ),
    maxConcurrent: 1,
    maxUrgentBurst: 2,
    fetch: async (_input, init) => {
      const label = JSON.parse(String(init?.body)).messages[0].content;
      order.push(label);
      await new Promise<void>((resolve) => releases.push(resolve));
      return jsonResponse({ id: label });
    },
  });

  try {
    const calls = [
      brokerRequest(
        broker,
        'blocker',
        requestBody('fixture/model', 'blocker'),
        'deliberative',
        'blocker',
      ),
    ];
    await waitFor(() => order.length === 1);
    calls.push(
      brokerRequest(
        broker,
        'ordinary',
        requestBody('fixture/model', 'ordinary'),
        'deliberative',
        'ordinary',
      ),
      brokerRequest(
        broker,
        'urgent-1',
        requestBody('fixture/model', 'urgent-1'),
        'urgent',
        'urgent-1',
      ),
      brokerRequest(
        broker,
        'urgent-2',
        requestBody('fixture/model', 'urgent-2'),
        'urgent',
        'urgent-2',
      ),
      brokerRequest(
        broker,
        'urgent-3',
        requestBody('fixture/model', 'urgent-3'),
        'urgent',
        'urgent-3',
      ),
    );
    await waitFor(() => broker.snapshot().queued === 4);
    for (let expected = 2; expected <= 5; expected += 1) {
      releases.shift()!();
      await waitFor(() => order.length === expected);
    }
    releases.shift()!();
    await Promise.all(calls);

    assert.deepEqual(order, ['blocker', 'urgent-1', 'urgent-2', 'ordinary', 'urgent-3']);
  } finally {
    await broker.close();
  }
});

test('the global queue cap holds even when a resident is ineligible for a free slot', async () => {
  const releases: Array<() => void> = [];
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: [client('a'), client('b')],
    maxConcurrent: 2,
    maxQueued: 1,
    maxQueuedPerResident: 2,
    fetch: async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return jsonResponse({});
    },
  });

  try {
    const active = brokerRequest(
      broker,
      'a',
      requestBody('fixture/model', 'active'),
      'deliberative',
      'active',
    );
    await waitFor(() => broker.snapshot().active === 1);
    const queued = brokerRequest(
      broker,
      'a',
      requestBody('fixture/model', 'queued'),
      'deliberative',
      'queued',
    );
    await waitFor(() => broker.snapshot().queued === 1);
    const rejected = await brokerRequest(
      broker,
      'a',
      requestBody('fixture/model', 'overflow'),
      'deliberative',
      'overflow',
    );
    assert.equal(rejected.status, 429);
    releases.shift()!();
    await active;
    await waitFor(() => broker.snapshot().active === 1);
    releases.shift()!();
    await queued;
  } finally {
    await broker.close();
  }
});

test('queued cancellation makes no upstream call and in-flight cancellation retains its slot', async () => {
  const events: CognitionBrokerEvent[] = [];
  const calls: string[] = [];
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: [client('a'), client('b'), client('c')],
    maxConcurrent: 1,
    onEvent: (event) => events.push(event),
    fetch: async (_input, init) => {
      const label = JSON.parse(String(init?.body)).messages[0].content;
      calls.push(label);
      if (label !== 'a') return jsonResponse({ id: label });
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    },
  });

  try {
    const activeAbort = new AbortController();
    const active = brokerRequest(
      broker,
      'a',
      requestBody('fixture/model', 'a'),
      'deliberative',
      'active-a',
      activeAbort.signal,
    );
    await waitFor(() => calls.length === 1);
    const queuedAbort = new AbortController();
    const cancelled = brokerRequest(
      broker,
      'b',
      requestBody('fixture/model', 'b'),
      'deliberative',
      'queued-b',
      queuedAbort.signal,
    );
    const successor = brokerRequest(
      broker,
      'c',
      requestBody('fixture/model', 'c'),
      'urgent',
      'urgent-c',
    );
    await waitFor(() => broker.snapshot().queued === 2);
    queuedAbort.abort();
    await assert.rejects(cancelled, /abort/i);
    await waitFor(() =>
      events.some(
        (event) => event.type === 'cancelled' && event.request?.clientRequestId === 'queued-b',
      ),
    );
    activeAbort.abort();
    await assert.rejects(active, /abort/i);
    const successorResponse = await successor;

    assert.equal(successorResponse.status, 200);
    assert.deepEqual(calls, ['a', 'c']);
    assert.equal(broker.snapshot().peakActive, 1);
    assert.ok(
      events.some(
        (event) =>
          event.type === 'cancelled' &&
          event.request?.clientRequestId === 'queued-b' &&
          (event.data as any).admitted === false,
      ),
    );
    assert.ok(
      events.some(
        (event) =>
          event.type === 'cancelled' &&
          event.request?.clientRequestId === 'active-a' &&
          (event.data as any).admitted === true,
      ),
    );
  } finally {
    await broker.close();
  }
});

test('resident-purpose provider quotas are durable, isolated, and usage-accounted', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-cognition-accounting-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clients = ['a', 'b'].map((name) =>
    client(name, {
      scopeId: 'experiment-1',
      worldId: 'world-1',
      accountId: name.repeat(64),
      ledgerFile: path.join(root, `${name}.jsonl`),
      limits: { resident_decision: 1, loom_fold: 1 },
    }),
  );
  const upstream: string[] = [];
  const first = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients,
    maxConcurrent: 2,
    fetch: async (_input, init) => {
      const label = JSON.parse(String(init?.body)).messages[0].content;
      upstream.push(label);
      return jsonResponse({
        id: label,
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.01 },
      });
    },
  });
  const aDecision = await brokerRequest(
    first,
    'a',
    requestBody('fixture/model', 'a-decision'),
    'deliberative',
    'a-decision',
  );
  assert.equal(aDecision.status, 200);
  await aDecision.text();
  const aDecisionRefused = await brokerRequest(
    first,
    'a',
    requestBody('fixture/model', 'a-decision-refused'),
    'deliberative',
    'a-decision-refused',
  );
  assert.equal(aDecisionRefused.status, 429);
  assert.equal(
    ((await aDecisionRefused.json()) as any).error.code,
    'resident_purpose_quota_exhausted',
  );
  const aFold = await brokerRequest(
    first,
    'a',
    requestBody('fixture/model', 'a-fold'),
    'auxiliary',
    'a-fold',
    undefined,
    'loom_fold',
  );
  assert.equal(aFold.status, 200);
  await aFold.text();
  const bDecision = await brokerRequest(
    first,
    'b',
    requestBody('fixture/model', 'b-decision'),
    'deliberative',
    'b-decision',
  );
  assert.equal(bDecision.status, 200);
  await bDecision.text();
  assert.deepEqual(upstream, ['a-decision', 'a-fold', 'b-decision']);
  const aAccount = first
    .snapshot()
    .accounting!.accounts.find((account) => account.accountId === 'a'.repeat(64))!;
  assert.deepEqual(aAccount.used, { loom_fold: 1, resident_decision: 1 });
  assert.equal(aAccount.usage.resident_decision.totalTokens, 12);
  assert.equal(aAccount.usage.loom_fold.costUsd, 0.01);
  await first.close();

  const resumedUpstream: string[] = [];
  const resumed = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients,
    maxConcurrent: 2,
    fetch: async (_input, init) => {
      const label = JSON.parse(String(init?.body)).messages[0].content;
      resumedUpstream.push(label);
      return jsonResponse({ id: label });
    },
  });
  const exhausted = await brokerRequest(
    resumed,
    'a',
    requestBody('fixture/model', 'after-restart-decision'),
    'deliberative',
    'after-restart-decision',
  );
  assert.equal(exhausted.status, 429);
  const independentFold = await brokerRequest(
    resumed,
    'b',
    requestBody('fixture/model', 'b-fold'),
    'auxiliary',
    'b-fold',
    undefined,
    'loom_fold',
  );
  assert.equal(independentFold.status, 200);
  await independentFold.text();
  assert.deepEqual(resumedUpstream, ['b-fold']);
  await resumed.close();

  const verifiedA = verifyQuotaLedger(path.join(root, 'a.jsonl')).snapshot;
  const verifiedB = verifyQuotaLedger(path.join(root, 'b.jsonl')).snapshot;
  assert.deepEqual(verifiedA.used, { loom_fold: 1, resident_decision: 1 });
  assert.deepEqual(verifiedB.used, { loom_fold: 1, resident_decision: 1 });
  assert.equal(verifiedA.eventCount, 5);
});

test('the transport gate rejects foreign credentials, model drift, and streaming before upstream', async () => {
  let upstreamCalls = 0;
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: [client('a')],
    maxConcurrent: 1,
    fetch: async () => {
      upstreamCalls += 1;
      return jsonResponse({});
    },
  });

  try {
    const foreign = await brokerRequest(
      broker,
      'foreign',
      requestBody('fixture/model', 'foreign'),
      'deliberative',
      'foreign',
    );
    assert.equal(foreign.status, 401);
    const wrongModel = await brokerRequest(
      broker,
      'a',
      requestBody('other/model', 'wrong-model'),
      'deliberative',
      'wrong-model',
    );
    assert.equal(wrongModel.status, 400);
    const streaming = await brokerRequest(
      broker,
      'a',
      JSON.stringify({ model: 'fixture/model', messages: [], stream: true }),
      'deliberative',
      'streaming',
    );
    assert.equal(streaming.status, 400);
    const multipleChoices = await brokerRequest(
      broker,
      'a',
      JSON.stringify({ model: 'fixture/model', messages: [], n: 2 }),
      'deliberative',
      'multiple-choices',
    );
    assert.equal(multipleChoices.status, 400);
    assert.equal(upstreamCalls, 0);
  } finally {
    await broker.close();
  }
});

test('the transport gate admits only an exact configured resident model set', async () => {
  const events: CognitionBrokerEvent[] = [];
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: [{ ...client('a'), models: ['fixture/urgent-model'] }],
    maxConcurrent: 1,
    onEvent: (event) => events.push(event),
    fetch: async () => jsonResponse({ id: 'urgent-model-call' }),
  });

  try {
    const admitted = await brokerRequest(
      broker,
      'a',
      requestBody('fixture/urgent-model', 'urgent'),
      'urgent',
      'urgent-model',
    );
    assert.equal(admitted.status, 200);
    await admitted.text();
    const rejected = await brokerRequest(
      broker,
      'a',
      requestBody('fixture/unconfigured-model', 'drift'),
      'urgent',
      'unconfigured-model',
    );
    assert.equal(rejected.status, 400);
    assert.ok(
      events.some(
        (event) =>
          event.type === 'admitted' &&
          event.request?.clientRequestId === 'urgent-model' &&
          event.request.model === 'fixture/urgent-model' &&
          (event.data as any).model === 'fixture/urgent-model',
      ),
    );
  } finally {
    await broker.close();
  }
});

test('the transport gate bounds an upstream response while preserving terminal evidence', async () => {
  const events: CognitionBrokerEvent[] = [];
  let cancelled = false;
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: [client('a')],
    maxConcurrent: 1,
    maxResponseBytes: 8,
    onEvent: (event) => events.push(event),
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('123456'));
            controller.enqueue(new TextEncoder().encode('789'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      ),
  });

  try {
    const response = await brokerRequest(
      broker,
      'a',
      requestBody('fixture/model', 'oversized-response'),
      'deliberative',
      'oversized-response',
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'response_too_large');
    assert.equal(cancelled, true);
    assert.equal(broker.snapshot().failed, 1);
    assert.ok(
      events.some(
        (event) =>
          event.type === 'completed' &&
          event.request?.clientRequestId === 'oversized-response' &&
          (event.data as any).error === 'response_too_large',
      ),
    );
  } finally {
    await broker.close();
  }
});

test('an upstream deadline closes the admitted request and releases its slot', async () => {
  const events: CognitionBrokerEvent[] = [];
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: [client('a')],
    maxConcurrent: 1,
    maxCallMs: 10,
    onEvent: (event) => events.push(event),
    fetch: async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
  });

  try {
    const response = await brokerRequest(
      broker,
      'a',
      requestBody('fixture/model', 'timeout'),
      'deliberative',
      'timeout',
    );
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error.code, 'upstream_timeout');
    await waitFor(() => broker.snapshot().active === 0);
    assert.equal(broker.snapshot().failed, 1);
    assert.ok(
      events.some(
        (event) =>
          event.type === 'completed' &&
          event.request?.clientRequestId === 'timeout' &&
          (event.data as any).error === 'upstream_timeout',
      ),
    );
  } finally {
    await broker.close();
  }
});

test('an admission journal failure cannot strand an active slot or listening server', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-cognition-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let upstreamCalls = 0;
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: [client('a')],
    maxConcurrent: 1,
    journalFile: path.join(root, 'broker.jsonl'),
    fetch: async () => {
      upstreamCalls += 1;
      return jsonResponse({});
    },
  });
  const originalFsync = fs.fsyncSync;
  let fsyncs = 0;
  (fs as any).fsyncSync = (descriptor: number) => {
    fsyncs += 1;
    if (fsyncs === 2) throw new Error('fixture fsync failure');
    return originalFsync(descriptor);
  };
  try {
    const response = await brokerRequest(
      broker,
      'a',
      requestBody('fixture/model', 'journal-failure'),
      'deliberative',
      'journal-failure',
    );
    assert.equal(response.status, 500);
    assert.match(await response.text(), /fixture fsync failure/);
    assert.match((await broker.failed).message, /fixture fsync failure/);
    assert.equal(upstreamCalls, 0);
    assert.equal(broker.snapshot().active, 0);
  } finally {
    (fs as any).fsyncSync = originalFsync;
  }
  await assert.rejects(broker.close(), /fixture fsync failure/);
  await assert.rejects(fetch(broker.endpoint), /fetch failed|ECONNREFUSED/);
});

test('a cancellation journal failure is contained and closes every live resource', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-cognition-cancel-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: [client('a'), client('b')],
    maxConcurrent: 1,
    journalFile: path.join(root, 'broker.jsonl'),
    fetch: async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
  });
  const activeAbort = new AbortController();
  const queuedAbort = new AbortController();
  const active = brokerRequest(
    broker,
    'a',
    requestBody('fixture/model', 'active'),
    'deliberative',
    'active',
    activeAbort.signal,
  );
  await waitFor(() => broker.snapshot().active === 1);
  const queued = brokerRequest(
    broker,
    'b',
    requestBody('fixture/model', 'queued'),
    'deliberative',
    'queued',
    queuedAbort.signal,
  );
  await waitFor(() => broker.snapshot().queued === 1);

  const originalFsync = fs.fsyncSync;
  (fs as any).fsyncSync = () => {
    throw new Error('cancel fsync failure');
  };
  try {
    queuedAbort.abort();
    await assert.rejects(queued, /abort/i);
    assert.match((await broker.failed).message, /cancel fsync failure/);
  } finally {
    (fs as any).fsyncSync = originalFsync;
  }
  await Promise.allSettled([active]);
  await assert.rejects(broker.close(), /cancel fsync failure/);
  assert.equal(broker.snapshot().active, 0);
  assert.equal(broker.snapshot().queued, 0);
  await assert.rejects(fetch(broker.endpoint), /fetch failed|ECONNREFUSED/);
});

test('the cognition journal durably closes every admitted request and detects edits', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-cognition-journal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journalFile = path.join(root, 'cognition.jsonl');
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: [client('a')],
    maxConcurrent: 1,
    journalFile,
    fetch: async () => jsonResponse({ id: 'journal-proof' }),
  });
  const response = await brokerRequest(
    broker,
    'a',
    requestBody('fixture/model', 'journal-proof'),
    'deliberative',
    'journal-proof',
  );
  assert.equal(response.status, 200);
  await response.text();
  await broker.close();

  const verified = verifyCognitionBrokerJournal(journalFile);
  assert.equal(verified.accepted, 1);
  assert.equal(verified.admitted, 1);
  assert.equal(verified.terminal, 1);
  assert.equal(verified.peakActive, 1);
  assert.deepEqual(
    verified.events.map((event) => event.type),
    ['started', 'accepted', 'admitted', 'completed', 'draining', 'drained'],
  );

  const edited = path.join(root, 'edited.jsonl');
  fs.copyFileSync(journalFile, edited);
  const contents = fs.readFileSync(edited, 'utf8');
  fs.writeFileSync(edited, contents.replace('journal-proof', 'journal-spoof'));
  assert.throws(() => verifyCognitionBrokerJournal(edited), /invalid cognition broker chain/);
});

test('raw transport capture retains every success, provider failure, and explicit retry without secrets', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-cognition-capture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journalFile = path.join(root, 'cognition.jsonl');
  const transportCaptureDirectory = path.join(root, 'transport');
  const responseBodies = [
    {
      id: 'response-success',
      model: 'fixture/model',
      provider: 'fixture-provider-a',
      choices: [
        {
          finish_reason: 'stop',
          native_finish_reason: 'completed',
          message: { role: 'assistant', content: 'first' },
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14, cost: 0 },
    },
    {
      error: { code: 'route_unavailable', message: 'fixture provider unavailable' },
      provider: 'fixture-provider-b',
    },
  ];
  let upstreamAttempt = 0;
  let cancellationStarted!: () => void;
  const cancellationWasStarted = new Promise<void>((resolve) => {
    cancellationStarted = resolve;
  });
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
    allowedUpstreamOrigins: ['https://upstream.invalid'],
    upstreamApiKey: UPSTREAM_KEY,
    clients: [
      client('a', {
        scopeId: 'capture-experiment',
        worldId: 'capture-world',
        accountId: 'a'.repeat(64),
        ledgerFile: path.join(root, 'quota.jsonl'),
        limits: { resident_decision: 10, loom_fold: 2 },
      }),
    ],
    maxConcurrent: 1,
    journalFile,
    transportCaptureDirectory,
    fetch: async (_input, init) => {
      upstreamAttempt += 1;
      if (upstreamAttempt === 1) return jsonResponse(responseBodies[0]);
      if (upstreamAttempt === 2) {
        return new Response(JSON.stringify(responseBodies[1]), {
          status: 503,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (upstreamAttempt === 3) {
        throw Object.assign(new Error(`network refused Bearer ${UPSTREAM_KEY} and ${token('a')}`), {
          code: 'fixture_network_refused',
        });
      }
      cancellationStarted();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason ?? new Error('fixture cancellation')),
          { once: true },
        );
      });
    },
  });

  const firstBody = requestBody('fixture/model', 'first exact request');
  const first = await brokerRequest(broker, 'a', firstBody, 'deliberative', 'opportunity-1');
  assert.equal(first.status, 200);
  await first.text();

  const failedBody = requestBody('fixture/model', 'explicit failed attempt');
  const failed = await brokerRequest(broker, 'a', failedBody, 'deliberative', 'opportunity-2');
  assert.equal(failed.status, 503);
  await failed.text();

  const retryBody = requestBody('fixture/model', 'explicit retry attempt');
  const retry = await brokerRequest(broker, 'a', retryBody, 'deliberative', 'opportunity-2');
  assert.equal(retry.status, 502);
  assert.equal(((await retry.json()) as any).error.code, 'fixture_network_refused');

  const cancellation = new AbortController();
  const cancelled = brokerRequest(
    broker,
    'a',
    requestBody('fixture/model', 'cancelled physical attempt'),
    'deliberative',
    'opportunity-3',
    cancellation.signal,
  );
  await cancellationWasStarted;
  cancellation.abort(new Error('fixture client cancellation'));
  await assert.rejects(cancelled, /fixture client cancellation|abort/i);
  await waitFor(() => broker.snapshot().active === 0);

  await broker.close();
  const journal = verifyCognitionBrokerJournal(journalFile);
  const verified = verifyCognitionTransportCapture(transportCaptureDirectory, journal.events);
  assert.equal(verified.attempts, 4);
  assert.equal(verified.responses, 2);
  assert.equal(verified.successfulResponses, 1);
  assert.equal(verified.providerFailures, 1);
  assert.equal(verified.transportErrors, 1);
  assert.equal(verified.cancellations, 1);
  assert.equal(verified.correctionAttempts, 1);
  assert.deepEqual(
    verified.records.map((record) => record.terminal),
    ['success', 'provider_error', 'network_error', 'cancelled'],
  );
  assert.deepEqual(
    verified.starts.map((record) => record.clientRequestId),
    ['opportunity-1', 'opportunity-2', 'opportunity-2', 'opportunity-3'],
  );
  assert.deepEqual(
    verified.starts.map((record) => record.logicalRequestAttempt),
    [1, 1, 2, 1],
  );
  assert.equal(new Set(verified.records.map((record) => record.brokerRequestId)).size, 4);
  assert.equal(
    verifyQuotaLedger(path.join(root, 'quota.jsonl')).snapshot.used.resident_decision,
    4,
  );
  assert.deepEqual(verified.usage.total_tokens, { value: 14, reports: 1 });
  assert.deepEqual(verified.usage.cost, { value: 0, reports: 1 });
  assert.equal(verified.starts[0].route.endpoint, 'https://upstream.invalid/v1/chat/completions');
  assert.equal(fs.readFileSync(verified.starts[0].request.file, 'utf8'), firstBody);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(verified.records[0].response!.content.file, 'utf8')),
    responseBodies[0],
  );
  assert.equal(verified.records[0].response?.provider, 'fixture-provider-a');
  assert.equal(verified.records[0].response?.model, 'fixture/model');
  assert.equal(verified.records[2].error?.code, 'fixture_network_refused');
  assert.doesNotMatch(verified.records[2].error!.message, /upstream-secret|local-a-/);

  const capturedText = fs
    .readdirSync(transportCaptureDirectory, { recursive: true })
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => path.join(transportCaptureDirectory, entry))
    .filter((entry) => fs.statSync(entry).isFile())
    .map((entry) => fs.readFileSync(entry, 'utf8'))
    .join('\n');
  assert.doesNotMatch(capturedText, /upstream-secret-fixture/);
  assert.doesNotMatch(capturedText, /local-a-x{8}/);
  assert.doesNotMatch(capturedText, /authorization/i);

  fs.appendFileSync(verified.records[0].response!.content.file, 'tampered');
  assert.throws(
    () => verifyCognitionTransportCapture(transportCaptureDirectory, journal.events),
    /content hash or length is invalid/,
  );
});

function client(
  name: string,
  accounting?: {
    scopeId: string;
    worldId: string;
    accountId: string;
    ledgerFile: string;
    limits: { resident_decision: number; loom_fold: number };
  },
) {
  return {
    bearer: token(name),
    residentKey: cognitionResidentKey('fixture-run', name),
    model: 'fixture/model',
    ...(accounting ? { accounting } : {}),
  };
}

function token(name: string) {
  return `local-${name}-${'x'.repeat(48)}`;
}

function requestBody(model: string, label: string) {
  return ` { "model": ${JSON.stringify(model)}, "messages": [{"role":"user","content":${JSON.stringify(label)}}] } `;
}

function brokerRequest(
  broker: CognitionBroker,
  resident: string,
  body: string,
  priority: CognitionPriority,
  requestId: string,
  signal?: AbortSignal,
  purpose: CognitionPurpose = 'resident_decision',
) {
  return fetch(broker.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token(resident)}`,
      ...cognitionClientHeaders({
        requestId,
        priority,
        purpose,
        urgentTriggerSequence: priority === 'urgent' ? 42 : null,
      }),
    },
    body,
    signal,
  });
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out');
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}
