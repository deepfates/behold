import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOllamaLocalResidentMind } from '../src/mind/ollama';
import {
  createOllamaLocalJsonActionRequest,
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL,
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_SHA256,
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
  OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL,
  OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_V2_PROTOCOL,
} from '../src/mind/ollama-json-action';
import {
  assertOllamaLocalRequest,
  ollamaLocalPolicy,
  preflightOllamaLocal,
} from '../src/mind/ollama-local';
import { ResidentMindCallError } from '../src/mind/evidence';
import { buildInterpreter } from '../src/agent/interpreter';
import { minecraftActionsForProfile } from '../src/agent/action-profiles';

const DIGEST_3B = 'a'.repeat(64);
const DIGEST_70B = 'b'.repeat(64);
const TEMPLATE_3B = 'fixture installed template for 3b';
const TEMPLATE_70B = 'fixture installed template for 70b';

test('Ollama v2 policy admits only exact loopback JSON action transport identities', () => {
  assert.deepEqual(
    ollamaLocalPolicy(policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B)),
    policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B),
  );
  for (const endpoint of [
    'https://127.0.0.1:11434/api/chat',
    'http://localhost:11434/api/chat',
    'http://192.168.1.4:11434/api/chat',
    'http://127.0.0.1:11434/v1/chat/completions',
    'http://127.0.0.1:11434/api/chat?remote=true',
  ]) {
    assert.throws(() =>
      ollamaLocalPolicy({ ...policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B), endpoint }),
    );
  }
  assert.throws(() =>
    ollamaLocalPolicy({
      ...policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B),
      protocol: 'behold.ollama-local-policy.v1',
    }),
  );
  assert.throws(() =>
    ollamaLocalPolicy({
      ...policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B),
      transport: {
        ...policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B).transport,
        schemaSha256: 'f'.repeat(64),
      },
    }),
  );
  assert.throws(() =>
    ollamaLocalPolicy({
      ...policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B),
      settings: {
        ...policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B).settings,
        keepAlive: 'default',
      },
    }),
  );
});

test('strict JSON action request has no native tools and preserves the exact action schemas in message and format', () => {
  const residentRequest = request();
  const localPolicy = policy('test/model', DIGEST_3B, TEMPLATE_3B);
  const serialized = createOllamaLocalJsonActionRequest(residentRequest as any, localPolicy);
  const body: any = serialized.body;

  assert.deepEqual(Object.keys(body).sort(), [
    'format',
    'keep_alive',
    'messages',
    'model',
    'options',
    'stream',
  ]);
  assert.equal(Object.hasOwn(body, 'tools'), false);
  assert.equal(Object.hasOwn(body, 'provider'), false);
  assert.equal(Object.hasOwn(body, 'parallel_tool_calls'), false);
  assert.deepEqual(body.options, { num_ctx: 16_384, num_predict: 512, temperature: 0.2 });
  assert.equal(body.keep_alive, '5m');
  assert.equal(body.format.oneOf.length, residentRequest.actions.length);
  residentRequest.actions.forEach((action, index) => {
    const variant = body.format.oneOf[index];
    assert.equal(variant.properties.action.const, action.name);
    assert.deepEqual(variant.properties.arguments, action.inputSchema);
  });
  assert.match(body.messages.at(-1).content, /BEHOLD_LOCAL_JSON_ACTION_CONTRACT_V1_BEGIN/);
  assert.match(body.messages.at(-1).content, /"maximum":2000/);
  assert.deepEqual(
    assertOllamaLocalRequest(body, residentRequest.model, localPolicy),
    serialized.identity,
  );
  assert.equal(serialized.identity.modelDigest, DIGEST_3B);
  assert.equal(serialized.identity.templateSha256, sha256(TEMPLATE_3B));
  assert.match(serialized.identity.actionContractSha256, /^[a-f0-9]{64}$/);
  assert.match(serialized.identity.responseFormatSha256, /^[a-f0-9]{64}$/);

  const drifted = structuredClone(body);
  drifted.format.oneOf[0].properties.arguments.properties.durationMs.maximum = 20_000;
  assert.throws(
    () => assertOllamaLocalRequest(drifted, residentRequest.model, localPolicy),
    /response format differs from the exact action contract/,
  );

  const required = createOllamaLocalJsonActionRequest(
    { ...residentRequest, requiredAction: 'wait_for_event' } as any,
    localPolicy,
  );
  assert.equal((required.body as any).format.oneOf.length, 1);
  assert.equal((required.body as any).format.oneOf[0].properties.action.const, 'wait_for_event');
  assert.deepEqual(
    assertOllamaLocalRequest(required.body, residentRequest.model, localPolicy),
    required.identity,
  );
});

test('legible-resident v2 exposes one exact action plus two bounded public commitments', () => {
  const residentRequest = canonicalLegibleRequest();
  const localPolicy = legiblePolicy('test/model', DIGEST_3B, TEMPLATE_3B);
  const serialized = createOllamaLocalJsonActionRequest(residentRequest as any, localPolicy);
  const body: any = serialized.body;

  assert.equal(Object.hasOwn(body, 'tools'), false);
  assert.equal(residentRequest.actions.length, 18);
  assert.equal(body.format.oneOf.length, residentRequest.actions.length);
  residentRequest.actions.forEach((action, index) => {
    const variant = body.format.oneOf[index];
    assert.deepEqual(variant.required, [
      'intention',
      'expectedObservableConsequence',
      'action',
      'arguments',
    ]);
    assert.equal(variant.additionalProperties, false);
    assert.deepEqual(variant.properties.action, { const: action.name });
    assert.deepEqual(variant.properties.arguments, action.inputSchema);
    assert.deepEqual(
      {
        type: variant.properties.intention.type,
        minLength: variant.properties.intention.minLength,
        maxLength: variant.properties.intention.maxLength,
        pattern: variant.properties.intention.pattern,
      },
      { type: 'string', minLength: 1, maxLength: 240, pattern: '^[^\\r\\n]+$' },
    );
    assert.deepEqual(
      {
        type: variant.properties.expectedObservableConsequence.type,
        minLength: variant.properties.expectedObservableConsequence.minLength,
        maxLength: variant.properties.expectedObservableConsequence.maxLength,
        pattern: variant.properties.expectedObservableConsequence.pattern,
      },
      { type: 'string', minLength: 1, maxLength: 240, pattern: '^[^\\r\\n]+$' },
    );
  });
  const contractMessage = body.messages.at(-1).content;
  assert.match(contractMessage, /BEHOLD_LOCAL_JSON_ACTION_CONTRACT_V2_BEGIN/);
  assert.match(contractMessage, /"policyProfile":"legible-resident-v1"/);
  assert.match(contractMessage, /public commitments, not private reasoning/i);
  assert.equal(serialized.identity.protocol, 'behold.ollama-local-json-action-request-identity.v2');
  assert.equal(
    serialized.identity.transportProtocol,
    OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_V2_PROTOCOL,
  );
  assert.equal(serialized.identity.schemaProtocol, OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL);
  assert.deepEqual(
    assertOllamaLocalRequest(body, residentRequest.model, localPolicy),
    serialized.identity,
  );

  const drifted = structuredClone(body);
  drifted.format.oneOf[0].properties.intention.maxLength = 241;
  assert.throws(
    () => assertOllamaLocalRequest(drifted, residentRequest.model, localPolicy),
    /response format differs from the exact action contract/,
  );
});

test('strict local transport and policy treatment identities cannot be crossed', () => {
  assert.throws(
    () =>
      createOllamaLocalJsonActionRequest(
        request() as any,
        legiblePolicy('test/model', DIGEST_3B, TEMPLATE_3B),
      ),
    /v2 requires policyProfile legible-resident-v1/,
  );
  assert.throws(
    () =>
      createOllamaLocalJsonActionRequest(
        legibleRequest() as any,
        policy('test/model', DIGEST_3B, TEMPLATE_3B),
      ),
    /legible-resident-v1 requires Ollama local JSON action v2/,
  );
});

test('legible-resident v2 retains one public commitment and rejects malformed commitment output without correction', async () => {
  const outputs = [
    {
      intention: 'Inspect the visible player',
      expectedObservableConsequence: 'The next view will show whether they remain ahead',
      action: 'move_controls',
      arguments: { direction: 'forward', durationMs: 500 },
    },
    {
      intention: ' leading whitespace is not silently normalized',
      expectedObservableConsequence: 'The action has an observable result',
      action: 'move_controls',
      arguments: { direction: 'forward', durationMs: 500 },
    },
  ];
  let calls = 0;
  const mind = createOllamaLocalResidentMind({
    bearer: 'resident-broker-bearer-that-is-long-enough',
    endpoint: 'http://127.0.0.1:31000/v1/chat/completions',
    policy: legiblePolicy('test/model', DIGEST_3B, TEMPLATE_3B),
    cognitionTransport: true,
    fetch: async () => {
      const output = outputs[calls++];
      return json({
        model: 'test/model',
        message: { role: 'assistant', content: JSON.stringify(output) },
        done: true,
        done_reason: 'stop',
      });
    },
  });
  const decision = await mind.decide(legibleRequest() as any, {
    signal: new AbortController().signal,
  });
  assert.equal(decision.call.adapter?.version, 'v2');
  assert.deepEqual(decision.publicCommitment, {
    protocol: 'behold.resident-public-action-commitment.v1',
    policyProfile: 'legible-resident-v1',
    intention: 'Inspect the visible player',
    expectedObservableConsequence: 'The next view will show whether they remain ahead',
  });
  assert.equal(
    decision.utterance,
    'Intention: Inspect the visible player\nExpected observable consequence: The next view will show whether they remain ahead',
  );

  await assert.rejects(
    mind.decide(legibleRequest() as any, { signal: new AbortController().signal }),
    (error: any) => {
      assert.ok(error instanceof ResidentMindCallError);
      assert.equal(error.call.response.terminal, 'malformed_output');
      assert.match(error.message, /exact trimmed line/);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test('read-only Ollama preflight binds cloud, model, completion, context, and exact per-model templates', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-ollama-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cloudConfigFile = path.join(root, 'server.json');
  fs.writeFileSync(cloudConfigFile, JSON.stringify({ disable_ollama_cloud: true }));
  const policies = [
    policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B),
    policy('llama3.3:latest', DIGEST_70B, TEMPLATE_70B),
  ];
  const calls: Array<{ path: string; body: any }> = [];
  const preflight = await preflightOllamaLocal({
    policies,
    cloudConfigFile,
    now: () => new Date('2026-07-25T20:00:00.000Z'),
    fetch: async (url, init) => {
      const pathName = new URL(String(url)).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ path: pathName, body });
      if (pathName === '/api/version') return json({ version: '0.23.2' });
      if (pathName === '/api/tags') {
        return json({
          models: [
            { model: 'llama3.2:3b', digest: DIGEST_3B },
            { model: 'llama3.3:latest', digest: DIGEST_70B },
          ],
        });
      }
      if (pathName === '/api/ps') return json({ models: [] });
      if (pathName === '/api/show') {
        return json({
          capabilities: ['completion', 'tools'],
          template: body.model === 'llama3.2:3b' ? TEMPLATE_3B : TEMPLATE_70B,
          details: {
            family: 'llama',
            parameter_size: body.model === 'llama3.2:3b' ? '3.2B' : '70.6B',
            quantization_level: 'Q4_K_M',
          },
          model_info: { 'llama.context_length': 131_072 },
        });
      }
      throw new Error(`unexpected preflight route ${pathName}`);
    },
  });
  assert.equal(preflight.server.cloudDisabled, true);
  assert.equal(preflight.server.version, '0.23.2');
  assert.deepEqual(
    preflight.models.map((model) => [
      model.modelTag,
      model.modelDigest,
      model.templateSha256,
      model.contextLength,
    ]),
    [
      ['llama3.2:3b', DIGEST_3B, sha256(TEMPLATE_3B), 131_072],
      ['llama3.3:latest', DIGEST_70B, sha256(TEMPLATE_70B), 131_072],
    ],
  );
  assert.equal(
    calls.some((call) => call.path === '/api/chat'),
    false,
  );
});

test('Ollama preflight fails closed on cloud, digest, template, completion, context, or transport drift', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-ollama-negative-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cloudConfigFile = path.join(root, 'server.json');
  fs.writeFileSync(cloudConfigFile, JSON.stringify({ disable_ollama_cloud: false }));
  let calls = 0;
  await assert.rejects(
    preflightOllamaLocal({
      policies: [policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B)],
      cloudConfigFile,
      fetch: async () => {
        calls += 1;
        return json({});
      },
    }),
    /cloud must be explicitly disabled/,
  );
  assert.equal(calls, 0);

  fs.writeFileSync(cloudConfigFile, JSON.stringify({ disable_ollama_cloud: true }));
  for (const show of [
    {
      capabilities: ['tools'],
      template: TEMPLATE_3B,
      model_info: { 'llama.context_length': 131_072 },
    },
    {
      capabilities: ['completion'],
      template: TEMPLATE_3B,
      model_info: { 'llama.context_length': 8_192 },
    },
    {
      capabilities: ['completion'],
      template: 'drifted template',
      model_info: { 'llama.context_length': 131_072 },
    },
  ]) {
    await assert.rejects(
      preflightOllamaLocal({
        policies: [policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B)],
        cloudConfigFile,
        fetch: preflightFetch(show),
      }),
      /completion capability|context is smaller|installed template differs/,
    );
  }
  await assert.rejects(
    preflightOllamaLocal({
      policies: [policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B)],
      cloudConfigFile,
      fetch: preflightFetch(
        {
          capabilities: ['completion'],
          template: TEMPLATE_3B,
          model_info: { 'llama.context_length': 131_072 },
        },
        'c'.repeat(64),
      ),
    }),
    /installed digest differs/,
  );
  await assert.rejects(
    preflightOllamaLocal({
      policies: [
        policy('llama3.2:3b', DIGEST_3B, TEMPLATE_3B),
        {
          ...policy('llama3.3:latest', DIGEST_70B, TEMPLATE_70B),
          transport: {
            ...policy('llama3.3:latest', DIGEST_70B, TEMPLATE_70B).transport,
            protocol: 'unadmitted-transport',
          },
        } as any,
      ],
      cloudConfigFile,
      fetch: async () => json({}),
    }),
    /action transport protocol/,
  );
});

test('strict JSON action mind checks identity and accepts one exact action object', async () => {
  const bodies: any[] = [];
  const mind = createOllamaLocalResidentMind({
    bearer: 'resident-broker-bearer-that-is-long-enough',
    endpoint: 'http://127.0.0.1:31000/v1/chat/completions',
    policy: policy('test/model', DIGEST_3B, TEMPLATE_3B),
    cognitionTransport: true,
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json({
        model: 'test/model',
        message: {
          role: 'assistant',
          content: JSON.stringify({
            action: 'move_controls',
            arguments: { direction: 'forward', durationMs: 500 },
          }),
        },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 40,
        eval_count: 8,
      });
    },
  });
  const decision = await mind.decide(request() as any, {
    signal: new AbortController().signal,
  });
  assert.equal(decision.call.adapter?.name, 'direct-ollama-local-json-action');
  assert.equal(decision.call.adapter?.version, 'v1');
  assert.equal(decision.call.response.provider, null);
  assert.deepEqual(decision.action, {
    name: 'move_controls',
    input: { direction: 'forward', durationMs: 500 },
    callId: null,
  });
  assert.deepEqual(decision.call.response.usage, {
    prompt_tokens: 40,
    completion_tokens: 8,
    total_tokens: 48,
  });
  assert.equal(Object.hasOwn(bodies[0], 'tools'), false);
  assert.ok(decision.call.request.localActionTransport);
  assert.equal(
    decision.call.request.formatSha256,
    decision.call.request.localActionTransport?.responseFormatSha256,
  );

  const drifted = createOllamaLocalResidentMind({
    bearer: 'resident-broker-bearer-that-is-long-enough',
    endpoint: 'http://127.0.0.1:31000/v1/chat/completions',
    policy: policy('test/model', DIGEST_3B, TEMPLATE_3B),
    cognitionTransport: true,
    fetch: async () =>
      json({
        model: 'other/model',
        message: { role: 'assistant', content: '{"action":"wait_for_event","arguments":{}}' },
        done: true,
      }),
  });
  await assert.rejects(
    drifted.decide(request() as any, { signal: new AbortController().signal }),
    (error: any) => {
      assert.ok(error instanceof ResidentMindCallError);
      assert.equal(error.call.response.terminal, 'ollama_identity_mismatch');
      assert.equal(error.call.response.localIdentity.reason, 'model_mismatch');
      return true;
    },
  );
});

test('strict JSON action mind retains malformed outputs distinctly with one attempt and no correction', async () => {
  const malformed = [
    { message: { role: 'assistant', content: 'not-json' }, reason: /not valid JSON/ },
    {
      message: {
        role: 'assistant',
        content: '{"action":"move_controls","arguments":{},"extra":true}',
      },
      reason: /fields do not match/,
    },
    {
      message: { role: 'assistant', content: '{"action":"move_controls","arguments":[]}' },
      reason: /arguments were not an object/,
    },
    {
      message: { role: 'assistant', content: '{"action":"hidden_macro","arguments":{}}' },
      reason: /unadmitted action/,
    },
    {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ function: { name: 'move_controls', arguments: {} } }],
      },
      reason: /forbidden native tool calls/,
    },
  ];
  for (const candidate of malformed) {
    let calls = 0;
    const mind = createOllamaLocalResidentMind({
      bearer: 'resident-broker-bearer-that-is-long-enough',
      endpoint: 'http://127.0.0.1:31000/v1/chat/completions',
      policy: policy('test/model', DIGEST_3B, TEMPLATE_3B),
      cognitionTransport: true,
      recordModelIO: true,
      fetch: async () => {
        calls += 1;
        return json({ model: 'test/model', message: candidate.message, done: true });
      },
    });
    await assert.rejects(
      mind.decide(request() as any, { signal: new AbortController().signal }),
      (error: any) => {
        assert.ok(error instanceof ResidentMindCallError);
        assert.equal(error.call.response.terminal, 'malformed_output');
        assert.match(error.message, candidate.reason);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

export function policy(modelTag: string, modelDigest: string, template: string) {
  return {
    protocol: 'behold.ollama-local-policy.v2',
    endpoint: 'http://127.0.0.1:11434/api/chat',
    modelTag,
    modelDigest,
    transport: {
      protocol: OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL,
      schemaProtocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL,
      schemaSha256: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_SHA256,
      templateSha256: sha256(template),
    },
    settings: {
      contextTokens: 16_384,
      maxOutputTokens: 512,
      temperature: 0.2,
      keepAlive: '5m',
    },
  } as const;
}

export function legiblePolicy(modelTag: string, modelDigest: string, template: string) {
  return {
    ...policy(modelTag, modelDigest, template),
    transport: {
      protocol: OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_V2_PROTOCOL,
      schemaProtocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
      schemaSha256: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
      templateSha256: sha256(template),
    },
  } as const;
}

export function request() {
  return {
    protocol: 'behold.mind-request.v1',
    entityId: 'Scout',
    model: 'test/model',
    policyProfile: 'neutral-benchmark-v1',
    bodyProfile: 'minecraft-human-semantic-v1',
    actionProfile: 'minecraft-human-semantic-v1',
    safetyProfile: 'vanilla-player-v1',
    observation: { health: 20 },
    conversation: [
      { role: 'system', content: 'Choose through the admitted world interface.' },
      { role: 'user', content: 'One grassy step is ahead.' },
    ],
    actions: [
      {
        name: 'move_controls',
        description: 'Hold bounded Minecraft movement controls, then release them.',
        inputSchema: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['forward', 'back', 'left', 'right'] },
            durationMs: { type: 'number', minimum: 100, maximum: 2000 },
          },
          required: ['direction', 'durationMs'],
        },
      },
      {
        name: 'wait_for_event',
        description: 'Yield until a later world event.',
        inputSchema: {
          type: 'object',
          properties: { reason: { type: 'string' } },
          required: ['reason'],
        },
      },
    ],
    requiredAction: null,
    attention: { mode: 'deliberative', context: 'bounded_loom', triggers: [] },
  } as const;
}

export function legibleRequest() {
  return { ...request(), policyProfile: 'legible-resident-v1' as const };
}

function canonicalLegibleRequest() {
  const actions = minecraftActionsForProfile(
    buildInterpreter({} as any)
      .list('inhabitant')
      .map((spec) => ({
        type: 'function' as const,
        function: {
          name: spec.name,
          description: spec.description,
          parameters: spec.parameters,
        },
      })),
    'minecraft-human-semantic-v1',
  ).map((action) => ({
    name: action.function.name,
    description: action.function.description,
    inputSchema: action.function.parameters,
  }));
  actions.push({
    name: 'wait_for_event',
    description: 'Yield without proposing a Minecraft action until a later world event.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  });
  return { ...legibleRequest(), actions };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function preflightFetch(show: unknown, digest = DIGEST_3B): typeof fetch {
  return async (url) => {
    const pathName = new URL(String(url)).pathname;
    if (pathName === '/api/version') return json({ version: '0.23.2' });
    if (pathName === '/api/tags') {
      return json({ models: [{ model: 'llama3.2:3b', digest }] });
    }
    if (pathName === '/api/ps') return json({ models: [] });
    if (pathName === '/api/show') return json(show);
    throw new Error(`unexpected preflight route ${pathName}`);
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
