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
  type LmStudioLocalPolicy,
} from '../src/mind/lmstudio-local';
import {
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL,
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_SHA256,
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
} from '../src/mind/ollama-json-action';
import {
  createResidentCameraFrame,
  createResidentCameraRenderer,
} from '../src/perception/resident-camera-frame';

const TEMPLATE = 'fixture lm studio resident template';
const APP_VERSION = '0.4.12+1';
const CLI_COMMIT = '0b2a176';
const ENGINE = 'mlx-llm-mac-arm64-apple-metal-advsimd@1.10.1';
const GGUF_ENGINE = 'llama.cpp-mac-arm64-apple-metal-advsimd@2.14.0';

test('LM Studio policy admits only exact loopback resident sessions', async (t) => {
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
      runtime: { ...residentPolicy.runtime, format: 'onnx' },
    }),
  );
  assert.throws(() =>
    lmStudioLocalPolicy({
      ...residentPolicy,
      transport: { ...residentPolicy.transport, schemaSha256: 'f'.repeat(64) },
    }),
  );
  assert.throws(() =>
    lmStudioLocalPolicy({
      ...residentPolicy,
      settings: { ...residentPolicy.settings, reasoningEffort: 'low' },
    }),
  );
});

test('GGUF admission binds the exact artifact tree and embedded chat template through unload', async (t) => {
  const fixture = await ggufArtifactFixture(t);
  const basePolicy = ggufPolicy(fixture);
  const residentPolicy = {
    ...basePolicy,
    modelKey: `${basePolicy.catalogKey}@q8_0`,
    indexedModelIdentifier: `${basePolicy.catalogKey}@${fixture.indexedModelIdentifier}`,
    settings: { ...basePolicy.settings, reasoningEffort: 'none' as const },
  };
  assert.deepEqual(lmStudioLocalPolicy(residentPolicy), residentPolicy);
  const loaded = new Set<string>();
  const commands: string[][] = [];
  const runLms = (args: readonly string[]) => {
    commands.push([...args]);
    if (args[0] === '--version') return `CLI commit: ${CLI_COMMIT}\n`;
    if (args[0] === 'runtime') return `ENGINE SELECTED\n${GGUF_ENGINE} ✓ llama.cpp\n`;
    if (args[0] === 'ls' && args.length > 2) {
      return JSON.stringify([{ ...indexEntry(residentPolicy), modelKey: residentPolicy.modelKey }]);
    }
    if (args[0] === 'ls') {
      return JSON.stringify([
        {
          ...indexEntry(residentPolicy),
          modelKey: residentPolicy.catalogKey,
          indexedModelIdentifier: residentPolicy.catalogKey,
          selectedVariant: residentPolicy.modelKey,
          variants: [residentPolicy.modelKey],
        },
      ]);
    }
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
  assert.equal(preflight.runtime.format, 'gguf');
  assert.equal(preflight.models[0].templateSha256, sha256(TEMPLATE));
  const session = await prepareLmStudioResidentSession({
    policies: [residentPolicy],
    residentIds: ['OxfordBerduck'],
    preflight,
    runLms,
    fetch,
  });
  assert.equal(session.models[0].residentId, 'OxfordBerduck');
  assert.deepEqual([...loaded], [session.models[0].modelInstanceId]);
  assert.equal(commands.find((args) => args[0] === 'load')?.[1], residentPolicy.catalogKey);
  await releaseLmStudioResidentSession({
    session,
    policies: [residentPolicy],
    residentIds: ['OxfordBerduck'],
    runLms,
    fetch,
  });
  assert.equal(loaded.size, 0);

  await assert.rejects(
    preflightLmStudioLocal({
      policies: [
        {
          ...residentPolicy,
          transport: { ...residentPolicy.transport, templateSha256: 'f'.repeat(64) },
        },
      ],
      modelsRoot: fixture.modelsRoot,
      readAppVersion: () => APP_VERSION,
      runLms,
      fetch,
    }),
    /template bytes differ/,
  );
});

test('LM Studio loom folding has one exact non-authoritative wire with no action authority', async (t) => {
  const fixture = await artifactFixture(t);
  const residentPolicy = policy(fixture);
  const instanceId = lmStudioResidentInstanceId(residentPolicy);
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

test('LM Studio resident-v2 session is action-only while preserving the stable own-life prefix', async (t) => {
  const fixture = await artifactFixture(t);
  const legacyPolicy = policy(fixture);
  const residentPolicy: LmStudioLocalPolicy = {
    ...legacyPolicy,
    transport: {
      ...legacyPolicy.transport,
      protocol: 'behold.lmstudio-local-resident-session.v2',
      schemaProtocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL,
      schemaSha256: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_SHA256,
    },
  };
  const residentRequest = {
    ...request(residentPolicy.modelKey),
    policyProfile: 'resident-v2',
  } as any;
  const instanceId = lmStudioResidentInstanceId(residentPolicy);
  const serialized = createLmStudioLocalJsonActionRequest(
    residentRequest,
    residentPolicy,
    instanceId,
  );
  const body: any = serialized.body;

  assert.throws(
    () =>
      createLmStudioLocalJsonActionRequest(
        residentRequest,
        legacyPolicy,
        lmStudioResidentInstanceId(legacyPolicy),
      ),
    /does not admit policyProfile resident-v2/,
  );

  assert.equal(body.response_format.json_schema.name, 'behold_resident_action_v1');
  assert.equal(serialized.identity.transportProtocol, 'behold.lmstudio-local-resident-session.v2');
  assert.equal(serialized.identity.schemaProtocol, OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL);
  assert.equal(
    serialized.identity.workingContinuityProtocol,
    'behold.resident-factual-continuity.v1',
  );
  assert.match(body.messages[1].content, /BEHOLD_LOCAL_JSON_ACTION_CONTRACT_V1_BEGIN/);
  assert.match(body.messages.at(-1).content, /including wait_for_event when you choose to yield/);
  assert.doesNotMatch(
    JSON.stringify(body),
    /expectedObservableConsequence|"intention"|public commitments|private reasoning/,
  );
  for (const variant of body.response_format.json_schema.schema.oneOf) {
    assert.deepEqual(variant.required, ['action', 'arguments']);
    assert.deepEqual(Object.keys(variant.properties).sort(), ['action', 'arguments']);
  }
  assert.deepEqual(
    assertLmStudioLocalJsonActionRequest(body, residentRequest, residentPolicy, instanceId),
    serialized.identity,
  );
  assert.deepEqual(assertLmStudioLocalWireRequest(body, residentPolicy), serialized.identity);
});

test('LM Studio resident-v3 wire carries continuous chronology for exact runtime admission', async (t) => {
  const fixture = await artifactFixture(t);
  const legacyPolicy = policy(fixture);
  const residentPolicy: LmStudioLocalPolicy = {
    ...legacyPolicy,
    transport: {
      ...legacyPolicy.transport,
      protocol: 'behold.lmstudio-local-resident-session.v2',
      schemaProtocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL,
      schemaSha256: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_SHA256,
    },
  };
  const residentRequest = {
    ...request(residentPolicy.modelKey),
    policyProfile: 'resident-v3',
    conversation: [
      { role: 'system', content: 'You are OxfordAster.' },
      { role: 'user', content: 'What you experience:\n{"sequence":1}' },
      {
        role: 'assistant',
        content: '{"action":"chat","arguments":{"text":"I am here."}}',
      },
      {
        role: 'user',
        content: 'What Minecraft returned after your chat attempt:\n{"ok":true}',
      },
      { role: 'user', content: 'What you experience:\n{"sequence":2}' },
    ],
  } as any;
  const instanceId = lmStudioResidentInstanceId(residentPolicy);
  const serialized = createLmStudioLocalJsonActionRequest(
    residentRequest,
    residentPolicy,
    instanceId,
  );

  assert.equal(
    serialized.identity.messageLayoutProtocol,
    'behold.ollama-local-resident-session-message-layout.v2',
  );
  assert.equal(
    serialized.identity.workingContinuityProtocol,
    'behold.resident-continuous-transcript.v1',
  );
  assert.deepEqual(
    (serialized.body.messages as any[]).slice(2, -1).map((message) => message.role),
    ['user', 'assistant', 'user'],
  );
  assert.deepEqual(
    assertLmStudioLocalJsonActionRequest(
      serialized.body,
      residentRequest,
      residentPolicy,
      instanceId,
    ),
    serialized.identity,
  );
  const large = createLmStudioLocalJsonActionRequest(
    {
      ...residentRequest,
      conversation: [
        ...residentRequest.conversation.slice(0, -1),
        { role: 'user', content: `What you experience:\n${'x'.repeat(20_000)}` },
      ],
    },
    residentPolicy,
    instanceId,
  );
  assert.match((large.body.messages as any[]).at(-1).content, /x{20000}/);
});

test('LM Studio camera perception adds one bound image without changing semantic text or prefix', async (t) => {
  const fixture = await artifactFixture(t);
  const residentPolicy = policy(fixture);
  const semanticRequest = request(residentPolicy.modelKey) as any;
  const instanceId = expectedInstanceId(residentPolicy);
  const semantic = createLmStudioLocalJsonActionRequest(
    semanticRequest,
    residentPolicy,
    instanceId,
  );
  const camera = createLmStudioLocalJsonActionRequest(
    {
      ...semanticRequest,
      perception: { profile: 'semantic-plus-camera-v1', camera: cameraFrame() },
    },
    residentPolicy,
    instanceId,
  );
  const semanticBody: any = semantic.body;
  const cameraBody: any = camera.body;
  const semanticCurrent = semanticBody.messages.at(-1).content;
  const cameraCurrent = cameraBody.messages.at(-1).content;

  assert.equal(typeof semanticCurrent, 'string');
  assert.equal(cameraCurrent.length, 2);
  assert.deepEqual(cameraCurrent[0], { type: 'text', text: semanticCurrent });
  assert.match(cameraCurrent[1].image_url.url, /^data:image\/png;base64,/);
  assert.deepEqual(cameraBody.messages.slice(0, 2), semanticBody.messages.slice(0, 2));
  assert.equal(camera.identity.stablePrefixSha256, semantic.identity.stablePrefixSha256);
  assert.deepEqual(
    assertLmStudioLocalJsonActionRequest(
      cameraBody,
      {
        ...semanticRequest,
        perception: { profile: 'semantic-plus-camera-v1', camera: cameraFrame() },
      },
      residentPolicy,
      instanceId,
    ),
    camera.identity,
  );
  assert.deepEqual(
    assertLmStudioLocalWireRequest(
      cameraBody,
      residentPolicy,
      undefined,
      undefined,
      'semantic-plus-camera-v1',
    ),
    camera.identity,
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
  assert.equal(preflight.models[0].vision, true);

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

test('same-model residents share weights while retaining distinct resident bindings', async (t) => {
  const fixture = await artifactFixture(t);
  const residentPolicy = policy(fixture);
  const residentIds = ['OxfordAster', 'OxfordBirch'];
  const instanceIds = residentIds.map((residentId) =>
    lmStudioResidentInstanceId(residentPolicy, residentId),
  );
  const commands: string[][] = [];
  const loaded = new Set<string>();
  const parallelByInstance = new Map<string, number>();
  const runLms = (args: readonly string[]) => {
    commands.push([...args]);
    if (args[0] === '--version') return `CLI commit: ${CLI_COMMIT}\n`;
    if (args[0] === 'runtime') return `ENGINE SELECTED\n${ENGINE} ✓ MLX\n`;
    if (args[0] === 'ls') return JSON.stringify([indexEntry(residentPolicy)]);
    if (args[0] === 'ps') return '[]';
    if (args[0] === 'load') {
      const instanceId = String(args[args.indexOf('--identifier') + 1]);
      loaded.add(instanceId);
      parallelByInstance.set(instanceId, Number(args[args.indexOf('--parallel') + 1]));
      return 'loaded\n';
    }
    if (args[0] === 'unload') {
      loaded.delete(String(args[1]));
      parallelByInstance.delete(String(args[1]));
      return 'unloaded\n';
    }
    throw new Error(`unexpected lms command ${args.join(' ')}`);
  };
  const fetch: typeof globalThis.fetch = async () =>
    json({
      models: [
        {
          key: residentPolicy.catalogKey,
          type: 'llm',
          format: residentPolicy.runtime.format,
          size_bytes: residentPolicy.artifact.sizeBytes,
          architecture: 'qwen3',
          max_context_length: 32768,
          capabilities: { trained_for_tool_use: true, vision: true },
          loaded_instances: [...loaded].map((id) => ({
            id,
            config: {
              context_length: residentPolicy.settings.contextTokens,
              parallel: parallelByInstance.get(id),
            },
          })),
        },
      ],
    });
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

  assert.equal(session.protocol, 'behold.lmstudio-resident-session.v3');
  assert.deepEqual(
    session.models.map((model) => ({
      residentId: model.residentId,
      modelInstanceId: model.modelInstanceId,
    })),
    residentIds.map((residentId) => ({
      residentId,
      modelInstanceId: instanceIds[0],
    })),
  );
  assert.equal(new Set(instanceIds).size, 1);
  assert.deepEqual([...loaded], [instanceIds[0]]);
  assert.equal(commands.filter((args) => args[0] === 'load').length, 1);
  assert.equal(parallelByInstance.get(instanceIds[0]), 2);

  const release = await releaseLmStudioResidentSession({
    session,
    policies: [residentPolicy, residentPolicy],
    residentIds,
    runLms,
    fetch,
  });
  assert.deepEqual(release.unloadedInstances, [instanceIds[0]]);
  assert.equal(loaded.size, 0);

  const serializedSession = await prepareLmStudioResidentSession({
    policies: [residentPolicy, residentPolicy],
    residentIds,
    preflight,
    maxParallel: 1,
    runLms,
    fetch,
  });
  assert.deepEqual(
    serializedSession.models.map((model) => model.parallel),
    [1, 1],
  );
  assert.equal(parallelByInstance.get(instanceIds[0]), 1);
  await releaseLmStudioResidentSession({
    session: serializedSession,
    policies: [residentPolicy, residentPolicy],
    residentIds,
    runLms,
    fetch,
  });
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

async function ggufArtifactFixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lmstudio-gguf-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modelsRoot = path.join(root, 'models');
  const relativePath = 'mradermacher/berduck-qwen2-1.5b-GGUF';
  const artifactRoot = path.join(modelsRoot, relativePath);
  const fileName = 'berduck-qwen2-1.5b.Q8_0.gguf';
  fs.mkdirSync(artifactRoot, { recursive: true });
  const file = path.join(artifactRoot, fileName);
  fs.writeFileSync(
    file,
    minimalGguf({ 'general.architecture': 'qwen2', 'tokenizer.chat_template': TEMPLATE }),
  );
  fs.writeFileSync(path.join(artifactRoot, 'mmproj-fixture.gguf'), 'fixture projector');
  return {
    modelsRoot,
    relativePath,
    indexedModelIdentifier: `${relativePath}/${fileName}`,
    treeSha256: await digestRegularFileTree(artifactRoot),
    sizeBytes:
      fs.statSync(file).size + fs.statSync(path.join(artifactRoot, 'mmproj-fixture.gguf')).size,
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

function ggufPolicy(fixture: Awaited<ReturnType<typeof ggufArtifactFixture>>): LmStudioLocalPolicy {
  return {
    protocol: 'behold.lmstudio-local-policy.v1',
    endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    modelKey: 'berduck-qwen2-1.5b',
    catalogKey: 'berduck-qwen2-1.5b',
    indexedModelIdentifier: fixture.indexedModelIdentifier,
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
      engine: GGUF_ENGINE,
      format: 'gguf',
    },
    settings: { contextTokens: 16_384, maxOutputTokens: 512, temperature: 0.2 },
  };
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

function cameraFrame() {
  const observation = {
    protocol: 'behold.inhabitant.v2',
    circle: { id: 'minecraft:test-circle', substrate: 'minecraft', managedRunId: 'run-1' },
    sequence: 7,
    observedAt: 1_000,
    eventWindow: {
      requestedAfterSequence: 6,
      oldestAvailableSequence: 7,
      newestAvailableSequence: 7,
      missingBeforeOldest: 0,
      complete: true,
    },
    task: null,
    self: {
      identity: 'OxfordAster',
      body: {
        substrate: 'minecraft',
        username: 'AsterBot',
        uuid: '00000000-0000-4000-8000-000000000001',
      },
      pose: {
        position: { x: 12.25, y: 64, z: -3.5 },
        yaw: 0.5,
        pitch: -0.25,
        velocity: { x: 0, y: 0, z: 0 },
        onGround: true,
      },
      condition: {
        health: 20,
        food: 20,
        oxygen: 20,
        sleeping: false,
        dimension: 'minecraft:overworld',
        isDay: true,
      },
      heldItem: null,
      inventory: [],
      projects: [],
      places: [],
      placeConflicts: [],
      currentAction: null,
    },
    scene: {
      social: { source: 'server_roster', playersOnline: ['AsterBot'], note: '' },
      focus: null,
      entities: [],
      terrain: {
        source: 'vision',
        horizontalFovDegrees: 100,
        verticalFovDegrees: 70,
        maxDistance: 24,
        raysCast: 1,
        raysHit: 0,
        failedRays: 0,
        materials: [],
        targets: [],
        visualField: { rows: [] },
        note: '',
      },
    },
    events: [],
  };
  return createResidentCameraFrame({
    bytes: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
      'base64',
    ),
    mediaType: 'image/png',
    observation,
    renderer: createResidentCameraRenderer({
      name: 'deterministic-fixture',
      version: '1',
      implementationSha256: '12'.repeat(32),
      verticalFovDegrees: 75,
      width: 10,
      height: 10,
      viewDistanceChunks: 6,
    }),
    renderedCamera: {
      position: { x: 12.25, y: 65.62, z: -3.5 },
      yaw: 0.5,
      pitch: -0.25,
    },
    captureStartedAt: 1_010,
    captureCompletedAt: 1_014,
  });
}

function preflightRunner(residentPolicy: LmStudioLocalPolicy) {
  return (args: readonly string[]) => {
    if (args[0] === '--version') return `CLI commit: ${CLI_COMMIT}\n`;
    if (args[0] === 'runtime')
      return `ENGINE SELECTED\n${residentPolicy.runtime.engine} ✓ runtime\n`;
    if (args[0] === 'ls') return JSON.stringify([indexEntry(residentPolicy)]);
    if (args[0] === 'ps') return '[]';
    throw new Error(`unexpected lms command ${args.join(' ')}`);
  };
}

function indexEntry(residentPolicy: LmStudioLocalPolicy) {
  return {
    type: 'llm',
    modelKey: residentPolicy.catalogKey,
    format: residentPolicy.runtime.format === 'mlx' ? 'safetensors' : 'gguf',
    path: residentPolicy.catalogKey,
    sizeBytes: residentPolicy.artifact.sizeBytes,
    indexedModelIdentifier: residentPolicy.indexedModelIdentifier,
    selectedVariant: undefined,
  };
}

function inventoryFetch(
  residentPolicy: LmStudioLocalPolicy,
  loaded: readonly string[],
): typeof globalThis.fetch {
  return async () => inventoryResponse(residentPolicy, loaded);
}

function inventoryResponse(residentPolicy: LmStudioLocalPolicy, loaded: readonly string[]) {
  return json({
    models: [
      {
        type: 'llm',
        key: residentPolicy.catalogKey,
        architecture: 'qwen3',
        format: residentPolicy.runtime.format,
        size_bytes: residentPolicy.artifact.sizeBytes,
        max_context_length: 65_536,
        selected_variant:
          residentPolicy.modelKey === residentPolicy.catalogKey ? null : residentPolicy.modelKey,
        capabilities: { trained_for_tool_use: true, vision: true },
        loaded_instances: loaded.map((id) => ({
          id,
          config: { context_length: residentPolicy.settings.contextTokens, parallel: 1 },
        })),
      },
    ],
  });
}

function minimalGguf(metadata: Readonly<Record<string, string>>) {
  const parts = [Buffer.from('GGUF'), uint32(3), uint64(0), uint64(Object.keys(metadata).length)];
  for (const [key, value] of Object.entries(metadata)) {
    parts.push(ggufString(key), uint32(8), ggufString(value));
  }
  return Buffer.concat(parts);
}

function ggufString(value: string) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([uint64(bytes.length), bytes]);
}

function uint32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function uint64(value: number) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
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
