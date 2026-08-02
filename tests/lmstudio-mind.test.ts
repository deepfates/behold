import assert from 'node:assert/strict';
import test from 'node:test';
import { ResidentMindCallError } from '../src/mind/evidence';
import {
  createLmStudioLocalLoomSummarizer,
  createLmStudioLocalResidentMind,
} from '../src/mind/lmstudio';
import type { ResidentMindRequest } from '../src/mind/interface';
import { lmStudioResidentInstanceId, type LmStudioLocalPolicy } from '../src/mind/lmstudio-local';
import {
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
} from '../src/mind/ollama-json-action';
import {
  createResidentCameraFrame,
  createResidentCameraRenderer,
} from '../src/perception/resident-camera-frame';

const BEARER = 'resident-broker-bearer-that-is-long-enough';
const BROKER = 'http://127.0.0.1:40123/v1/chat/completions';

test('LM Studio mind sends one exact strict resident request and retains its identities', async () => {
  const instance = lmStudioResidentInstanceId(policy());
  let calls = 0;
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const times = [1_000, 1_125, 1_126, 1_251];
  const mind = createLmStudioLocalResidentMind({
    bearer: BEARER,
    endpoint: BROKER,
    policy: policy(),
    modelInstanceId: instance,
    cognitionTransport: true,
    recordModelIO: true,
    now: () => times.shift()!,
    fetch: async (input, init) => {
      calls += 1;
      capturedUrl = String(input);
      capturedInit = init;
      if (isPrefixReadiness(init)) {
        return response(
          instance,
          { ready: true },
          admissionHeaders('resident_prefix_readiness', 'auxiliary'),
        );
      }
      return response(
        instance,
        {
          intention: 'Take one ordinary step toward the visible tree',
          expectedObservableConsequence: 'The tree should appear closer in my next perception',
          action: 'move_controls',
          arguments: { direction: 'forward', durationMs: 500 },
        },
        admissionHeaders(),
      );
    },
  });

  const readiness = await mind.prepare!(request(), { signal: new AbortController().signal });
  assert.equal((readiness as any).authority, 'none');
  assert.equal((readiness as any).responseUsedAsResidentDecision, false);
  const decision = await mind.decide(request(), { signal: new AbortController().signal });
  assert.equal(calls, 2);
  assert.equal(capturedUrl, BROKER);
  assert.equal(capturedInit?.method, 'POST');
  assert.equal((capturedInit?.headers as any).authorization, `Bearer ${BEARER}`);
  assert.equal((capturedInit?.headers as any)['x-behold-cognition-purpose'], 'resident_decision');
  const body = JSON.parse(String(capturedInit?.body));
  assert.deepEqual(Object.keys(body).sort(), [
    'max_tokens',
    'messages',
    'model',
    'response_format',
    'stream',
    'temperature',
  ]);
  assert.equal(body.model, instance);
  assert.equal(body.stream, false);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(Object.hasOwn(body, 'tools'), false);
  assert.equal(Object.hasOwn(body, 'previous_response_id'), false);
  assert.deepEqual(decision.action, {
    name: 'move_controls',
    input: { direction: 'forward', durationMs: 500 },
    callId: null,
  });
  assert.equal(decision.call.adapter?.name, 'direct-lmstudio-local-json-action');
  assert.equal(decision.call.adapter?.version, 'resident-session-v1');
  assert.equal(decision.call.latencyMs, 125);
  assert.equal((decision.call.request as any).lmStudioPrefixReadiness.authority, 'none');
  assert.equal(
    (decision.call.request as any).lmStudioPrefixReadiness.responseUsedAsResidentDecision,
    false,
  );
  assert.deepEqual((decision.call.request as any).lmStudioPrefixReadiness.decisionBinding, {
    requestedStablePrefixSha256: (decision.call.request as any).lmStudioActionTransport
      .stablePrefixSha256,
    requestedActionContractSha256: (decision.call.request as any).lmStudioActionTransport
      .actionContractSha256,
    exactPrefixMatch: true,
    use: 'exact_prefill',
  });
  assert.equal(
    (decision.call.request as any).lmStudioPrefixReadiness.call.response.usage.reasoning_tokens,
    0,
  );
  assert.equal(decision.call.admissions?.[0]?.admissionOrdinal, 1);
  assert.equal(decision.call.request.model, policy().modelKey);
  assert.equal((decision.call.request as any).requestedModelInstance, instance);
  assert.equal((decision.call.request as any).lmStudioActionTransport.modelInstanceId, instance);
  assert.equal(
    (decision.call.request as any).lmStudioActionTransport.artifactTreeSha256,
    policy().artifact.treeSha256,
  );
  assert.equal((decision.call.response as any).model, instance);
  assert.deepEqual((decision.call.response as any).usage, {
    prompt_tokens: 90,
    completion_tokens: 30,
    total_tokens: 120,
    reasoning_tokens: 0,
  });
});

test('LM Studio urgent contract drift uses the prepared runtime without an in-horizon rewarm', async () => {
  const instance = lmStudioResidentInstanceId(policy());
  let calls = 0;
  const mind = createLmStudioLocalResidentMind({
    bearer: BEARER,
    endpoint: BROKER,
    policy: policy(),
    modelInstanceId: instance,
    cognitionTransport: true,
    fetch: async (_input, init) => {
      calls += 1;
      return isPrefixReadiness(init)
        ? response(instance, { ready: true })
        : response(instance, validOutput());
    },
  });

  await mind.prepare!(request(), { signal: new AbortController().signal });
  const drifted = {
    ...request(),
    actions: request().actions.map((action) =>
      action.name === 'move_controls'
        ? { ...action, description: 'A transiently changed urgent action contract.' }
        : action,
    ),
    attention: {
      mode: 'urgent' as const,
      context: 'current_body_and_continuity' as const,
      triggers: [{ sequence: 1, type: 'self_hurt', salience: 'urgent' as const }],
    },
  };
  const decision = await mind.decide(drifted, { signal: new AbortController().signal });
  assert.equal(decision.action?.name, 'move_controls');
  assert.equal(calls, 2, 'urgent drift performed a second readiness call');
  assert.deepEqual((decision.call.request as any).lmStudioPrefixReadiness.decisionBinding, {
    requestedStablePrefixSha256: (decision.call.request as any).lmStudioActionTransport
      .stablePrefixSha256,
    requestedActionContractSha256: (decision.call.request as any).lmStudioActionTransport
      .actionContractSha256,
    exactPrefixMatch: false,
    use: 'prepared_runtime_baseline',
  });
});

test('LM Studio mind may prepare a new deliberative contract before its action request', async () => {
  const instance = lmStudioResidentInstanceId(policy());
  let calls = 0;
  const mind = createLmStudioLocalResidentMind({
    bearer: BEARER,
    endpoint: BROKER,
    policy: policy(),
    modelInstanceId: instance,
    cognitionTransport: true,
    fetch: async (_input, init) => {
      calls += 1;
      if (isPrefixReadiness(init)) return response(instance, { ready: true });
      return response(instance, validOutput());
    },
  });

  await mind.prepare!(request(), { signal: new AbortController().signal });
  const changed = {
    ...request(),
    actions: request().actions.map((action) =>
      action.name === 'move_controls'
        ? { ...action, description: 'A newly presented ordinary movement description.' }
        : action,
    ),
    attention: { mode: 'deliberative' as const, context: 'bounded_loom' as const, triggers: [] },
  };
  const decision = await mind.decide(changed, { signal: new AbortController().signal });
  assert.equal(decision.action?.name, 'move_controls');
  assert.equal(calls, 3);
  assert.equal(
    (decision.call.request as any).lmStudioPrefixReadiness.request.stablePrefixSha256,
    (decision.call.request as any).lmStudioActionTransport.stablePrefixSha256,
  );
  assert.equal(
    (decision.call.request as any).lmStudioPrefixReadiness.decisionBinding.exactPrefixMatch,
    true,
  );
});

test('LM Studio mind rechecks camera freshness after prefix readiness and before decision admission', async () => {
  const instance = lmStudioResidentInstanceId(policy());
  let clock = 1_014;
  let calls = 0;
  const mind = createLmStudioLocalResidentMind({
    bearer: BEARER,
    endpoint: BROKER,
    policy: policy(),
    modelInstanceId: instance,
    cognitionTransport: true,
    now: () => clock,
    fetch: async (_input, init) => {
      calls += 1;
      assert.equal(isPrefixReadiness(init), true);
      clock = 7_000;
      return response(instance, { ready: true });
    },
  });
  const withCamera = {
    ...request(),
    perception: {
      profile: 'semantic-plus-camera-v1' as const,
      camera: cameraFrame(),
    },
  };

  await assert.rejects(
    mind.decide(withCamera, { signal: new AbortController().signal }),
    /outside its admitted time horizon/,
  );
  assert.equal(calls, 1, 'stale frame reached the resident decision request');
});

test('LM Studio mind rejects instance drift distinctly and never retries', async () => {
  let calls = 0;
  const mind = createLmStudioLocalResidentMind({
    bearer: BEARER,
    endpoint: BROKER,
    policy: policy(),
    modelInstanceId: lmStudioResidentInstanceId(policy()),
    cognitionTransport: true,
    recordModelIO: true,
    fetch: async (_input, init) => {
      calls += 1;
      if (isPrefixReadiness(init)) {
        return response(lmStudioResidentInstanceId(policy()), { ready: true });
      }
      return response('behold-bbbbbbbbbbbbbbbbbbbbbbbb', validOutput());
    },
  });

  await assert.rejects(
    mind.decide(request(), { signal: new AbortController().signal }),
    (error: any) => {
      assert.ok(error instanceof ResidentMindCallError);
      const failure = error.call.response as any;
      assert.equal(failure.terminal, 'lmstudio_identity_mismatch');
      assert.equal(failure.lmStudioIdentity.reason, 'model_mismatch');
      assert.equal(failure.lmStudioIdentity.returnedModel, 'behold-bbbbbbbbbbbbbbbbbbbbbbbb');
      assert.equal(failure.raw.model, 'behold-bbbbbbbbbbbbbbbbbbbbbbbb');
      return true;
    },
  );
  assert.equal(calls, 2);
});

test('LM Studio mind identifies an exhausted resident decision quota', async () => {
  const instance = lmStudioResidentInstanceId(policy());
  const mind = createLmStudioLocalResidentMind({
    bearer: BEARER,
    endpoint: BROKER,
    policy: policy(),
    modelInstanceId: instance,
    cognitionTransport: true,
    fetch: async (_input, init) =>
      isPrefixReadiness(init)
        ? response(instance, { ready: true })
        : new Response(
            JSON.stringify({
              error: {
                code: 'resident_purpose_quota_exhausted',
                message: 'resident resident_decision provider-attempt quota is exhausted',
              },
            }),
            { status: 429, headers: { 'content-type': 'application/json' } },
          ),
  });

  await assert.rejects(
    mind.decide(request(), { signal: new AbortController().signal }),
    (error: any) => {
      assert.ok(error instanceof ResidentMindCallError);
      assert.equal(error.call.response.terminal, 'quota_exhausted');
      assert.equal(error.call.response.status, 429);
      return true;
    },
  );
});

test('LM Studio mind retains malformed output without correction, normalization, or retry', async () => {
  const instance = lmStudioResidentInstanceId(policy());
  let calls = 0;
  const mind = createLmStudioLocalResidentMind({
    bearer: BEARER,
    endpoint: BROKER,
    policy: policy(),
    modelInstanceId: instance,
    cognitionTransport: true,
    recordModelIO: true,
    fetch: async (_input, init) => {
      calls += 1;
      if (isPrefixReadiness(init)) return response(instance, { ready: true });
      return response(instance, {
        intention: 'Walk forward',
        expectedObservableConsequence: { copiedControllerOutcome: true },
        action: 'move_controls',
        arguments: { input: { direction: 'forward', durationMs: 500 } },
      });
    },
  });

  await assert.rejects(
    mind.decide(request(), { signal: new AbortController().signal }),
    (error: any) => {
      assert.ok(error instanceof ResidentMindCallError);
      const failure = error.call.response as any;
      assert.equal(failure.terminal, 'malformed_output');
      assert.deepEqual(failure.raw.choices[0].message.tool_calls, []);
      assert.match(error.message, /malformed output/);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test('LM Studio mind propagates abort to its sole physical request', async () => {
  let calls = 0;
  let observedSignal: AbortSignal | undefined;
  const mind = createLmStudioLocalResidentMind({
    bearer: BEARER,
    endpoint: BROKER,
    policy: policy(),
    modelInstanceId: lmStudioResidentInstanceId(policy()),
    cognitionTransport: true,
    fetch: async (_input, init) => {
      calls += 1;
      observedSignal = init?.signal as AbortSignal;
      return await new Promise<Response>((_resolve, reject) => {
        observedSignal!.addEventListener(
          'abort',
          () =>
            reject(
              Object.assign(new Error('aborted by resident controller'), { name: 'AbortError' }),
            ),
          { once: true },
        );
      });
    },
  });
  const abort = new AbortController();
  const pending = mind.decide(request(), { signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, (error: any) => {
    assert.ok(error instanceof ResidentMindCallError);
    assert.equal(error.call.response.terminal, 'cancelled');
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(observedSignal, abort.signal);
});

test('LM Studio mind leaves canonical action-input validation to the controller boundary', async () => {
  const instance = lmStudioResidentInstanceId(policy());
  const mind = createLmStudioLocalResidentMind({
    bearer: BEARER,
    endpoint: BROKER,
    policy: policy(),
    modelInstanceId: instance,
    cognitionTransport: true,
    fetch: async (_input, init) =>
      isPrefixReadiness(init)
        ? response(instance, { ready: true })
        : response(instance, {
            ...validOutput(),
            arguments: { direction: 'forward', durationMs: 999_999 },
          }),
  });

  const decision = await mind.decide(request(), { signal: new AbortController().signal });
  assert.deepEqual(decision.action?.input, { direction: 'forward', durationMs: 999_999 });
  assert.equal(
    decision.call.request.mindRequestSha256?.length,
    64,
    'the controller receives the exact originating request identity for final validation',
  );
});

test('LM Studio loom summarizer makes one auxiliary request and retains exact evidence', async () => {
  const instance = lmStudioResidentInstanceId(policy());
  const calls: any[] = [];
  const summarizer = createLmStudioLocalLoomSummarizer({
    bearer: BEARER,
    endpoint: BROKER,
    policy: policy(),
    modelInstanceId: instance,
    cognitionTransport: true,
    recordModelIO: true,
    now: (() => {
      const times = [2_000, 2_240];
      return () => times.shift()!;
    })(),
    onCall: (event) => calls.push(event),
    fetch: async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('x-behold-cognition-priority'), 'auxiliary');
      assert.equal(headers.get('x-behold-cognition-purpose'), 'loom_fold');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, instance);
      assert.equal(Object.hasOwn(body, 'tools'), false);
      return response(
        instance,
        { summary: 'At [t1], Aster greeted the world and is awaiting a visible response.' },
        admissionHeaders('loom_fold', 'auxiliary'),
      );
    },
  });
  const summary = await summarizer(foldRequest(), new AbortController().signal);
  assert.equal(summary, 'At [t1], Aster greeted the world and is awaiting a visible response.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].call.latencyMs, 240);
  assert.equal(calls[0].call.request.lmStudioLoomFoldTransport.modelInstanceId, instance);
  assert.match(calls[0].call.request.formatSha256, /^[a-f0-9]{64}$/);
  assert.equal(calls[0].call.request.toolCount, 0);
});

test('LM Studio loom summarizer retains malformed output and never corrects or retries', async () => {
  const instance = lmStudioResidentInstanceId(policy());
  let physicalAttempts = 0;
  const failures: any[] = [];
  const summarizer = createLmStudioLocalLoomSummarizer({
    bearer: BEARER,
    endpoint: BROKER,
    policy: policy(),
    modelInstanceId: instance,
    cognitionTransport: true,
    recordModelIO: true,
    onError: (event) => failures.push(event),
    fetch: async () => {
      physicalAttempts += 1;
      return response(instance, { summary: '', repairedSummary: 'forbidden correction' });
    },
  });
  await assert.rejects(summarizer(foldRequest(), new AbortController().signal), (error: any) => {
    assert.ok(error instanceof ResidentMindCallError);
    assert.equal(error.call.response.terminal, 'malformed_output');
    assert.deepEqual((error.call.response.raw as any).choices[0].message.tool_calls, []);
    return true;
  });
  assert.equal(physicalAttempts, 1);
  assert.equal(failures.length, 1);
});

function policy(): LmStudioLocalPolicy {
  return {
    protocol: 'behold.lmstudio-local-policy.v1',
    endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    modelKey: 'google/gemma-4-26b-a4b-qat',
    catalogKey: 'google/gemma-4-26b-a4b-qat',
    indexedModelIdentifier: 'google/gemma-4-26b-a4b-qat',
    artifact: {
      relativePath: 'google/gemma-4-26b-a4b-qat',
      treeSha256: 'b'.repeat(64),
      sizeBytes: 15_600_000_000,
    },
    transport: {
      protocol: 'behold.lmstudio-local-resident-session.v1',
      schemaProtocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
      schemaSha256: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
      templateSha256: 'c'.repeat(64),
    },
    runtime: {
      appVersion: '0.4.12+1',
      cliCommit: '0b2a176',
      engine: 'mlx-llm-mac-arm64-apple-metal-advsimd@1.10.1',
      format: 'mlx',
    },
    settings: { contextTokens: 16_384, maxOutputTokens: 512, temperature: 0.2 },
  };
}

function request(): ResidentMindRequest {
  return {
    protocol: 'behold.mind-request.v1',
    entityId: 'OxfordAster',
    model: policy().modelKey,
    policyProfile: 'legible-resident-v1',
    bodyProfile: 'minecraft-human-semantic-v1',
    actionProfile: 'minecraft-human-semantic-v1',
    safetyProfile: 'vanilla-player-v1',
    observation: { protocol: 'behold.minecraft-human-semantic-observation.v1', health: 20 },
    conversation: [
      {
        role: 'system',
        content:
          'You are a persistent embodied Minecraft resident. Direct your own conduct from lived perception.',
      },
      {
        role: 'user',
        content: 'You see an ordinary tree ahead and open ground beneath your body.',
      },
    ],
    actions: [
      {
        name: 'move_controls',
        description: 'Press one ordinary movement control for a bounded duration.',
        inputSchema: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['forward', 'back', 'left', 'right'] },
            durationMs: { type: 'integer', minimum: 100, maximum: 2_000 },
          },
          required: ['direction', 'durationMs'],
          additionalProperties: false,
        },
      },
      {
        name: 'wait_for_event',
        inputSchema: {
          type: 'object',
          properties: { reason: { type: 'string', maxLength: 240 } },
          required: ['reason'],
          additionalProperties: false,
        },
      },
    ],
    requiredAction: null,
  };
}

function cameraFrame() {
  const observation = {
    protocol: 'behold.inhabitant.v2',
    circle: { id: 'minecraft:test', substrate: 'minecraft', managedRunId: 'run-1' },
    sequence: 1,
    observedAt: 1_000,
    self: {
      identity: 'OxfordAster',
      body: { substrate: 'minecraft', username: 'AsterBot', uuid: null },
      pose: {
        position: { x: 0, y: 64, z: 0 },
        yaw: 0,
        pitch: 0,
        velocity: { x: 0, y: 0, z: 0 },
        onGround: true,
      },
      condition: { dimension: 'minecraft:overworld' },
    },
  };
  return createResidentCameraFrame({
    bytes: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
      'base64',
    ),
    mediaType: 'image/png',
    observation,
    renderer: createResidentCameraRenderer({
      name: 'fixture',
      version: '1',
      implementationSha256: '12'.repeat(32),
      verticalFovDegrees: 75,
      width: 10,
      height: 10,
      viewDistanceChunks: 6,
    }),
    renderedCamera: { position: { x: 0, y: 65.62, z: 0 }, yaw: 0, pitch: 0 },
    captureStartedAt: 1_010,
    captureCompletedAt: 1_014,
  });
}

function validOutput() {
  return {
    intention: 'Take one ordinary step toward the visible tree',
    expectedObservableConsequence: 'The tree should appear closer in my next perception',
    action: 'move_controls',
    arguments: { direction: 'forward', durationMs: 500 },
  };
}

function foldRequest() {
  return {
    entityId: 'OxfordAster',
    fromSequence: 1,
    toSequence: 1,
    previousSummary: null,
    turns: [
      {
        turn: 1,
        publicCommitment: {
          intention: 'Greet anyone nearby.',
          expectedObservableConsequence: 'A chat event may appear later.',
        },
        action: { name: 'chat', input: { text: 'Hello?' } },
        outcome: { ok: true },
      },
    ],
  } as any;
}

function response(instance: string, output: unknown, headers: HeadersInit = {}) {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-lmstudio-fixture',
      object: 'chat.completion',
      model: instance,
      system_fingerprint: instance,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify(output), tool_calls: [] },
        },
      ],
      usage: {
        prompt_tokens: 90,
        completion_tokens: 30,
        total_tokens: 120,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json', ...headers } },
  );
}

function isPrefixReadiness(init: RequestInit | undefined) {
  return (
    JSON.parse(String(init?.body)).response_format?.json_schema?.name ===
    'behold_resident_prefix_ready_v1'
  );
}

function admissionHeaders(
  purpose: 'resident_decision' | 'resident_prefix_readiness' | 'loom_fold' = 'resident_decision',
  priority: 'deliberative' | 'auxiliary' = 'deliberative',
): Record<string, string> {
  return {
    'x-behold-cognition-protocol': 'behold.cognition-admission.v1',
    'x-behold-cognition-broker-id': 'broker-fixture',
    'x-behold-cognition-broker-request-id': 'broker-request-fixture',
    'x-behold-cognition-resident-key': 'd'.repeat(64),
    'x-behold-cognition-model': policy().modelKey,
    'x-behold-cognition-body-sha256': 'e'.repeat(64),
    'x-behold-cognition-request-id': 'client-request-fixture',
    'x-behold-cognition-priority': priority,
    'x-behold-cognition-purpose': purpose,
    'x-behold-cognition-urgent-trigger': 'none',
    'x-behold-cognition-queued-at': '1000',
    'x-behold-cognition-admitted-at': '1001',
    'x-behold-cognition-queue-ms': '1',
    'x-behold-cognition-queue-depth': '0',
    'x-behold-cognition-active-before': '0',
    'x-behold-cognition-limit': '2',
    'x-behold-cognition-admission-ordinal': '1',
  };
}
