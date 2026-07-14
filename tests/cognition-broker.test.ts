import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  startCognitionBroker,
  type CognitionBroker,
  type CognitionBrokerEvent,
  verifyCognitionBrokerJournal,
} from '../src/mind/cognition-broker';
import {
  cognitionClientHeaders,
  parseCognitionAdmission,
  type CognitionPriority,
} from '../src/mind/cognition';

const UPSTREAM_KEY = 'upstream-secret-fixture';

test('the loopback cognition gate preserves request bytes and enforces aggregate concurrency', async () => {
  let now = 1_000;
  let active = 0;
  let peak = 0;
  const calls: Array<{ body: string; authorization: string | null }> = [];
  const releases: Array<() => void> = [];
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
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
    upstreamApiKey: UPSTREAM_KEY,
    clients: ['blocker', 'ordinary', 'urgent-1', 'urgent-2', 'urgent-3'].map(client),
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

test('queued cancellation makes no upstream call and in-flight cancellation retains its slot', async () => {
  const events: CognitionBrokerEvent[] = [];
  const calls: string[] = [];
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
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

test('the transport gate rejects foreign credentials, model drift, and streaming before upstream', async () => {
  let upstreamCalls = 0;
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
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
    assert.equal(upstreamCalls, 0);
  } finally {
    await broker.close();
  }
});

test('the transport gate bounds an upstream response while preserving terminal evidence', async () => {
  const events: CognitionBrokerEvent[] = [];
  let cancelled = false;
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
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

test('the cognition journal durably closes every admitted request and detects edits', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-cognition-journal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journalFile = path.join(root, 'cognition.jsonl');
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://upstream.invalid/v1/chat/completions',
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

function client(name: string) {
  return {
    bearer: token(name),
    residentKey: `resident-${name}`,
    model: 'fixture/model',
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
) {
  return fetch(broker.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token(resident)}`,
      ...cognitionClientHeaders({
        requestId,
        priority,
        purpose: 'resident_decision',
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
