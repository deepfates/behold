import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ModelCallEvidence } from '../src/mind/evidence';
import {
  assertLmStudioLocalJsonActionRequest,
  assertLmStudioLocalLoomFoldWireRequest,
  assertLmStudioLocalPrefixReadinessWireRequest,
  assertLmStudioLocalWireRequest,
  createLmStudioLocalJsonActionRequest,
  createLmStudioLocalLoomFoldRequest,
  createLmStudioLocalPrefixReadinessRequest,
  digestRegularFileTree,
  lmStudioLocalPolicy,
  lmStudioResidentInstanceId,
  parseLmStudioLocalJsonActionDecision,
  parseLmStudioLocalLoomFoldResponse,
  parseLmStudioLocalPrefixReadinessResponse,
  preflightLmStudioLocal,
  prepareLmStudioResidentSession,
  releaseLmStudioResidentSession,
} from '../src/mind/lmstudio-local';
import {
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
} from '../src/mind/ollama-json-action';

const TEMPLATE = 'fixture lm studio resident template';
const APP_VERSION = '0.4.12+1';
const CLI_COMMIT = '0b2a176';
const ENGINE = 'mlx-llm-mac-arm64-apple-metal-advsimd@1.10.1';

test('LM Studio policy admits only exact loopback MLX resident sessions', async (t) => {
  const fixture = await artifactFixture(t);
  const residentPolicy = policy(fixture);
  assert.deepEqual(lmStudioLocalPolicy(residentPolicy), residentPolicy);
  for (const endpoint of [
    'https://127.0.0.1:1234/v1/chat/completions',
    'http://localhost:1234/v1/chat/completions',
    'http://192.168.1.5:1234/v1/chat/completions',
    'http://127.0.0.1:1234/api/v1/chat',
    'http://127.0.0.1:1234/v1/chat/completions?jit=true',
  ]) {
    assert.throws(() => lmStudioLocalPolicy({ ...residentPolicy, endpoint }));
  }
  assert.throws(() =>
    lmStudioLocalPolicy({
      ...residentPolicy,
      runtime: { ...residentPolicy.runtime, format: 'gguf' },
    }),
  );
  assert.throws(() =>
    lmStudioLocalPolicy({
      ...residentPolicy,
      transport: { ...residentPolicy.transport, schemaSha256: 'f'.repeat(64) },
    }),
  );
});

test('LM Studio loom folding has one exact non-authoritative wire with no action authority', async (t) => {
  const fixture = await artifactFixture(t);
  const residentPolicy = policy(fixture);
  const instanceId = expectedInstanceId(residentPolicy);
  const foldRequest = {
    entityId: 'OxfordAster',
    fromSequence: 1,
    toSequence: 2,
    previousSummary: null,
    turns: [
      {
        turn: 1,
        publicCommitment: {
          intention: 'Notice whether anyone answers.',
          expectedObservableConsequence: 'A chat event may appear in my next perception.',
        },
        action: { name: 'chat', input: { text: 'Hello?' } },
        outcome: { ok: true },
      },
    ],
  };
  const serialized = createLmStudioLocalLoomFoldRequest(
    foldRequest as any,
    residentPolicy,
    instanceId,
  );
  const body: any = serialized.body;
  assert.deepEqual(Object.keys(body).sort(), [
    'max_tokens',
    'messages',
    'model',
    'response_format',
    'stream',
    'temperature',
  ]);
  assert.equal(body.model, instanceId);
  assert.equal(body.messages.length, 2);
  assert.equal(body.response_format.json_schema.name, 'behold_loom_fold_v1');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema.required, ['summary']);
  assert.equal(Object.hasOwn(body, 'tools'), false);
  assert.equal(Object.hasOwn(body, 'previous_response_id'), false);
  assert.deepEqual(
    assertLmStudioLocalLoomFoldWireRequest(body, residentPolicy),
    serialized.identity,
  );
  assert.equal(serialized.identity.modelInstanceId, instanceId);
  assert.match(serialized.identity.responseFormatSha256, /^[a-f0-9]{64}$/);

  assert.equal(
    parseLmStudioLocalLoomFoldResponse(
      response(instanceId, { summary: 'At [t1], Aster spoke and is awaiting a visible reply.' }),
      residentPolicy,
      instanceId,
    ),
    'At [t1], Aster spoke and is awaiting a visible reply.',
  );

  for (const mutate of [
    (candidate: any) => (candidate.model = 'another-instance'),
    (candidate: any) => (candidate.messages[0].content += '\nChoose move_controls.'),
    (candidate: any) => (candidate.response_format.json_schema.strict = false),
    (candidate: any) => (candidate.response_format.json_schema.schema.additionalProperties = true),
    (candidate: any) => (candidate.temperature = 0.9),
  ]) {
    const candidate = structuredClone(body);
    mutate(candidate);
    assert.throws(() => assertLmStudioLocalLoomFoldWireRequest(candidate, residentPolicy));
  }
  assert.throws(() =>
    parseLmStudioLocalLoomFoldResponse(
      response(instanceId, {
        summary: 'At [t1], Aster spoke.',
        action: { name: 'move_controls' },
      }),
      residentPolicy,
      instanceId,
    ),
  );
});

test('LM Studio wire preserves the exact strict resident schema and stable prefix without tools or state', async (t) => {
  const fixture = await artifactFixture(t);
  const residentPolicy = policy(fixture);
  const residentRequest = request(residentPolicy.modelKey);
  const instanceId = expectedInstanceId(residentPolicy);
  const first = createLmStudioLocalJsonActionRequest(
    residentRequest as any,
    residentPolicy,
    instanceId,
  );
  const body: any = first.body;
  assert.deepEqual(Object.keys(body).sort(), [
    'max_tokens',
    'messages',
    'model',
    'response_format',
    'stream',
    'temperature',
  ]);
  assert.equal(body.model, instanceId);
  assert.equal(body.stream, false);
  assert.equal(Object.hasOwn(body, 'tools'), false);
  assert.equal(Object.hasOwn(body, 'provider'), false);
  assert.equal(Object.hasOwn(body, 'previous_response_id'), false);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.oneOf.length, 3);
  residentRequest.actions.forEach((action, index) => {
    const variant = body.response_format.json_schema.schema.oneOf[index];
    assert.equal(variant.properties.action.const, action.name);
    assert.deepEqual(variant.properties.arguments, action.inputSchema);
    assert.equal(variant.additionalProperties, false);
    assert.deepEqual(variant.required, [
      'intention',
      'expectedObservableConsequence',
      'action',
      'arguments',
    ]);
  });
  assert.match(body.messages[1].content, /BEHOLD_LOCAL_JSON_ACTION_CONTRACT_V2_BEGIN/);
  assert.match(body.messages[1].content, /"maximum":2000/);
  assert.equal(first.identity.schemaSha256, OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256);
  assert.equal(first.identity.modelInstanceId, instanceId);
  assert.deepEqual(
    assertLmStudioLocalJsonActionRequest(body, residentRequest as any, residentPolicy, instanceId),
    first.identity,
  );
  assert.deepEqual(assertLmStudioLocalWireRequest(body, residentPolicy), first.identity);

  const next = createLmStudioLocalJsonActionRequest(
    {
      ...residentRequest,
      conversation: [
        residentRequest.conversation[0],
        {
          role: 'system',
          content:
            'Resident working continuity from your own entity loom.\n{"protocol":"behold.resident-working-continuity.v1","experiences":[{"turn":1,"action":"look_direction","actualConsequence":"Minecraft confirmed that the action succeeded."}]}',
        },
        { role: 'user', content: 'Current perception changed after another resident spoke.' },
      ],
    } as any,
    residentPolicy,
    instanceId,
  );
  assert.deepEqual((next.body as any).messages.slice(0, 2), body.messages.slice(0, 2));
  assert.equal(next.identity.stablePrefixSha256, first.identity.stablePrefixSha256);

  const drifted = structuredClone(body);
  drifted.response_format.json_schema.schema.oneOf[0].properties.arguments.properties.durationMs.maximum = 20_000;
  assert.throws(
    () =>
      assertLmStudioLocalJsonActionRequest(
        drifted,
        residentRequest as any,
        residentPolicy,
        instanceId,
      ),
    /differs from the exact admitted resident request/,
  );
});

test('LM Studio prefix readiness prefills only the exact stable contract without action authority', async (t) => {
  const fixture = await artifactFixture(t);
  const residentPolicy = policy(fixture);
  const residentRequest = request(residentPolicy.modelKey) as any;
  const instanceId = expectedInstanceId(residentPolicy);
  const action = createLmStudioLocalJsonActionRequest(residentRequest, residentPolicy, instanceId);
  const readiness = createLmStudioLocalPrefixReadinessRequest(
    residentRequest,
    residentPolicy,
    instanceId,
  );
  const body: any = readiness.body;
  assert.deepEqual(body.messages.slice(0, 2), (action.body as any).messages.slice(0, 2));
  assert.equal(body.messages.length, 3);
  assert.match(body.messages[2].content, /no Minecraft observation, world authority, or action/);
  assert.equal(body.response_format.json_schema.name, 'behold_resident_prefix_ready_v1');
  assert.equal(body.max_tokens, 16);
  assert.equal(Object.hasOwn(body, 'tools'), false);
  assert.deepEqual(
    assertLmStudioLocalPrefixReadinessWireRequest(body, residentPolicy),
    readiness.identity,
  );
  assert.equal(readiness.identity.stablePrefixSha256, action.identity.stablePrefixSha256);
  assert.equal(readiness.identity.actionContractSha256, action.identity.actionContractSha256);
  assert.equal(
    parseLmStudioLocalPrefixReadinessResponse(
      response(instanceId, { ready: true }),
      residentPolicy,
      instanceId,
    ),
    true,
  );

  const drifted = structuredClone(body);
  drifted.messages[2].content += ' Choose move_controls.';
  assert.throws(() => assertLmStudioLocalPrefixReadinessWireRequest(drifted, residentPolicy));
  const leaked: any = response(instanceId, { ready: true });
  leaked.choices[0].message.reasoning_content = 'I should prepare an action.';
  assert.throws(() =>
    parseLmStudioLocalPrefixReadinessResponse(leaked, residentPolicy, instanceId),
  );
});

test('LM Studio response admits one exact public decision and rejects identity, tools, multiplicity, and malformed output', async (t) => {
  const fixture = await artifactFixture(t);
  const residentPolicy = policy(fixture);
  const residentRequest = request(residentPolicy.modelKey) as any;
  const instanceId = expectedInstanceId(residentPolicy);
  const call = callEvidence();
  const output = {
    intention: 'Move one ordinary step toward the visible tree',
    expectedObservableConsequence: 'The tree should appear closer in my next perception',
    action: 'move_controls',
    arguments: { direction: 'forward', durationMs: 500 },
  };
  const decision = parseLmStudioLocalJsonActionDecision(
    response(instanceId, output),
    residentRequest,
    call,
    residentPolicy,
    instanceId,
  );
  assert.deepEqual(decision.action, {
    name: 'move_controls',
    input: { direction: 'forward', durationMs: 500 },
    callId: null,
  });
  assert.equal(
    decision.utterance,
    'Intention: Move one ordinary step toward the visible tree\nExpected observable consequence: The tree should appear closer in my next perception',
  );

  for (const candidate of [
    { ...response(instanceId, output), model: 'another-instance' },
    { ...response(instanceId, output), choices: [] },
    {
      ...response(instanceId, output),
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify(output),
            tool_calls: [{ function: { name: 'move_controls', arguments: {} } }],
          },
        },
      ],
    },
    response(instanceId, { ...output, expectedObservableConsequence: { ok: true } }),
    {
      ...response(instanceId, output),
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify(output),
            reasoning_content: 'private chain of thought',
            tool_calls: [],
          },
        },
      ],
    },
  ]) {
    assert.throws(() =>
      parseLmStudioLocalJsonActionDecision(
        candidate,
        residentRequest,
        call,
        residentPolicy,
        instanceId,
      ),
    );
  }
});

test('LM Studio read-only preflight binds CLI, app, MLX engine, index, artifact bytes, and unloaded inventory', async (t) => {
  const fixture = await artifactFixture(t);
  const residentPolicy = policy(fixture);
  const preflight = await preflightLmStudioLocal({
    policies: [residentPolicy],
    modelsRoot: fixture.modelsRoot,
    readAppVersion: () => APP_VERSION,
    now: () => new Date('2026-07-26T10:00:00.000Z'),
    runLms: preflightRunner(residentPolicy),
    fetch: inventoryFetch(residentPolicy, []),
  });
  assert.equal(preflight.runtime.engine, ENGINE);
  assert.equal(preflight.models[0].artifactTreeSha256, fixture.treeSha256);
  assert.equal(preflight.models[0].templateSha256, sha256(TEMPLATE));
  assert.equal(preflight.models[0].maxContextTokens, 65_536);

  await assert.rejects(
    preflightLmStudioLocal({
      policies: [
        { ...residentPolicy, artifact: { ...residentPolicy.artifact, treeSha256: 'f'.repeat(64) } },
      ],
      modelsRoot: fixture.modelsRoot,
      readAppVersion: () => APP_VERSION,
      runLms: preflightRunner(residentPolicy),
      fetch: inventoryFetch(residentPolicy, []),
    }),
    /artifact bytes differ|index identity differs/,
  );
});

test('LM Studio resident session owns exact custom instances and releases them after use', async (t) => {
  const fixture = await artifactFixture(t);
  const residentPolicy = policy(fixture);
  const instanceId = expectedInstanceId(residentPolicy);
  const commands: string[][] = [];
  const loaded = new Set<string>();
  const runLms = (args: readonly string[]) => {
    commands.push([...args]);
    if (args[0] === '--version') return `CLI commit: ${CLI_COMMIT}\n`;
    if (args[0] === 'runtime') return `ENGINE SELECTED\n${ENGINE} ✓ MLX\n`;
    if (args[0] === 'ls') return JSON.stringify([indexEntry(residentPolicy)]);
    if (args[0] === 'ps') return '[]';
    if (args[0] === 'load') {
      loaded.add(String(args[args.indexOf('--identifier') + 1]));
      return 'loaded\n';
    }
    if (args[0] === 'unload') {
      loaded.delete(String(args[1]));
      return 'unloaded\n';
    }
    throw new Error(`unexpected lms command ${args.join(' ')}`);
  };
  const fetch: typeof globalThis.fetch = async () => inventoryResponse(residentPolicy, [...loaded]);
  const preflight = await preflightLmStudioLocal({
    policies: [residentPolicy],
    modelsRoot: fixture.modelsRoot,
    readAppVersion: () => APP_VERSION,
    runLms,
    fetch,
  });
  const session = await prepareLmStudioResidentSession({
    policies: [residentPolicy],
    preflight,
    runLms,
    fetch,
  });
  assert.equal(session.models[0].modelInstanceId, instanceId);
  assert.deepEqual([...loaded], [instanceId]);
  assert.deepEqual(
    commands.find((args) => args[0] === 'load'),
    [
      'load',
      residentPolicy.catalogKey,
      '--context-length',
      '16384',
      '--parallel',
      '1',
      '--identifier',
      instanceId,
      '--yes',
      '--host',
      '127.0.0.1',
      '--port',
      '1234',
    ],
  );
  const release = await releaseLmStudioResidentSession({
    session,
    policies: [residentPolicy],
    runLms,
    fetch,
  });
  assert.deepEqual(release.unloadedInstances, [instanceId]);
  assert.equal(loaded.size, 0);
});

test('same-model residents own distinct entity-bound LM Studio instances', async (t) => {
  const fixture = await artifactFixture(t);
  const residentPolicy = policy(fixture);
  const residentIds = ['OxfordAster', 'OxfordBirch'];
  const instanceIds = residentIds.map((residentId) =>
    lmStudioResidentInstanceId(residentPolicy, residentId),
  );
  const commands: string[][] = [];
  const loaded = new Set<string>();
  const runLms = (args: readonly string[]) => {
    commands.push([...args]);
    if (args[0] === '--version') return `CLI commit: ${CLI_COMMIT}\n`;
    if (args[0] === 'runtime') return `ENGINE SELECTED\n${ENGINE} ✓ MLX\n`;
    if (args[0] === 'ls') return JSON.stringify([indexEntry(residentPolicy)]);
    if (args[0] === 'ps') return '[]';
    if (args[0] === 'load') {
      loaded.add(String(args[args.indexOf('--identifier') + 1]));
      return 'loaded\n';
    }
    if (args[0] === 'unload') {
      loaded.delete(String(args[1]));
      return 'unloaded\n';
    }
    throw new Error(`unexpected lms command ${args.join(' ')}`);
  };
  const fetch: typeof globalThis.fetch = async () => inventoryResponse(residentPolicy, [...loaded]);
  const preflight = await preflightLmStudioLocal({
    policies: [residentPolicy, residentPolicy],
    modelsRoot: fixture.modelsRoot,
    readAppVersion: () => APP_VERSION,
    runLms,
    fetch,
  });
  const session = await prepareLmStudioResidentSession({
    policies: [residentPolicy, residentPolicy],
    residentIds,
    preflight,
    runLms,
    fetch,
  });

  assert.equal(session.protocol, 'behold.lmstudio-resident-session.v2');
  assert.deepEqual(
    session.models.map((model) => ({
      residentId: model.residentId,
      modelInstanceId: model.modelInstanceId,
    })),
    residentIds.map((residentId, index) => ({
      residentId,
      modelInstanceId: instanceIds[index],
    })),
  );
  assert.deepEqual([...loaded].sort(), [...instanceIds].sort());
  assert.equal(commands.filter((args) => args[0] === 'load').length, 2);

  const release = await releaseLmStudioResidentSession({
    session,
    policies: [residentPolicy, residentPolicy],
    residentIds,
    runLms,
    fetch,
  });
  assert.deepEqual([...release.unloadedInstances].sort(), [...instanceIds].sort());
  assert.equal(loaded.size, 0);
});

async function artifactFixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lmstudio-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modelsRoot = path.join(root, 'models');
  const relativePath = 'prism-ml/Bonsai-8B-mlx-1bit';
  const artifactRoot = path.join(modelsRoot, relativePath);
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(path.join(artifactRoot, 'chat_template.jinja'), TEMPLATE);
  fs.writeFileSync(path.join(artifactRoot, 'config.json'), '{"model_type":"qwen3"}\n');
  fs.writeFileSync(path.join(artifactRoot, 'model.safetensors'), 'fixture weights');
  return {
    modelsRoot,
    relativePath,
    treeSha256: await digestRegularFileTree(artifactRoot),
    sizeBytes: 1_296_458_723,
  };
}

function policy(fixture: Awaited<ReturnType<typeof artifactFixture>>) {
  return {
    protocol: 'behold.lmstudio-local-policy.v1',
    endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    modelKey: 'bonsai-8b-mlx',
    catalogKey: 'bonsai-8b-mlx',
    indexedModelIdentifier: fixture.relativePath,
    artifact: {
      relativePath: fixture.relativePath,
      treeSha256: fixture.treeSha256,
      sizeBytes: fixture.sizeBytes,
    },
    transport: {
      protocol: 'behold.lmstudio-local-resident-session.v1',
      schemaProtocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
      schemaSha256: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
      templateSha256: sha256(TEMPLATE),
    },
    runtime: {
      appVersion: APP_VERSION,
      cliCommit: CLI_COMMIT,
      engine: ENGINE,
      format: 'mlx',
    },
    settings: { contextTokens: 16_384, maxOutputTokens: 512, temperature: 0.2 },
  } as const;
}

function request(model: string) {
  return {
    protocol: 'behold.mind-request.v1',
    entityId: 'OxfordAster',
    model,
    policyProfile: 'legible-resident-v1',
    bodyProfile: 'minecraft-human-semantic-v1',
    actionProfile: 'minecraft-human-semantic-v1',
    safetyProfile: 'vanilla-player-v1',
    observation: { health: 20 },
    conversation: [
      {
        role: 'system',
        content:
          'You are one persistent resident. Direct your own life and adapt to what Minecraft actually does.',
      },
      { role: 'user', content: 'You see grass and an oak tree ahead. Another resident is online.' },
    ],
    actions: [
      {
        name: 'move_controls',
        description: 'Hold ordinary movement controls for a bounded duration, then release them.',
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
        name: 'chat',
        description: 'Send ordinary public Minecraft chat.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', minLength: 1, maxLength: 240 } },
          required: ['text'],
        },
      },
      {
        name: 'wait_for_event',
        description: 'Yield until later lived evidence arrives.',
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

function preflightRunner(residentPolicy: ReturnType<typeof policy>) {
  return (args: readonly string[]) => {
    if (args[0] === '--version') return `CLI commit: ${CLI_COMMIT}\n`;
    if (args[0] === 'runtime') return `ENGINE SELECTED\n${ENGINE} ✓ MLX\n`;
    if (args[0] === 'ls') return JSON.stringify([indexEntry(residentPolicy)]);
    if (args[0] === 'ps') return '[]';
    throw new Error(`unexpected lms command ${args.join(' ')}`);
  };
}

function indexEntry(residentPolicy: ReturnType<typeof policy>) {
  return {
    type: 'llm',
    modelKey: residentPolicy.catalogKey,
    format: 'safetensors',
    path: residentPolicy.catalogKey,
    sizeBytes: residentPolicy.artifact.sizeBytes,
    indexedModelIdentifier: residentPolicy.indexedModelIdentifier,
    selectedVariant: undefined,
  };
}

function inventoryFetch(
  residentPolicy: ReturnType<typeof policy>,
  loaded: readonly string[],
): typeof globalThis.fetch {
  return async () => inventoryResponse(residentPolicy, loaded);
}

function inventoryResponse(residentPolicy: ReturnType<typeof policy>, loaded: readonly string[]) {
  return json({
    models: [
      {
        type: 'llm',
        key: residentPolicy.catalogKey,
        architecture: 'qwen3',
        format: 'mlx',
        size_bytes: residentPolicy.artifact.sizeBytes,
        max_context_length: 65_536,
        selected_variant: null,
        capabilities: { trained_for_tool_use: true },
        loaded_instances: loaded.map((id) => ({
          id,
          config: { context_length: residentPolicy.settings.contextTokens, parallel: 1 },
        })),
      },
    ],
  });
}

function response(instanceId: string, output: unknown) {
  return {
    id: 'chatcmpl_fixture',
    object: 'chat.completion',
    model: instanceId,
    system_fingerprint: instanceId,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(output), tool_calls: [] },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
  };
}

function callEvidence(): ModelCallEvidence {
  return {
    protocol: 'behold.model-call.v1',
    adapter: { name: 'direct-lmstudio-local-json-action', version: 'resident-session-v1' },
    requestId: 'fixture-request',
    endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    startedAt: 1,
    completedAt: 2,
    latencyMs: 1,
    request: { kind: 'provider_request' },
    response: { terminal: 'success', status: 200 },
  } as any;
}

function expectedInstanceId(residentPolicy: ReturnType<typeof policy>) {
  return `behold-${sha256(
    stableJson({
      modelKey: residentPolicy.modelKey,
      artifactTreeSha256: residentPolicy.artifact.treeSha256,
      contextTokens: residentPolicy.settings.contextTokens,
    }),
  ).slice(0, 24)}`;
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
