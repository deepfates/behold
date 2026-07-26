import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startCognitionBroker, verifyCognitionBrokerJournal } from '../src/mind/cognition-broker';
import { cognitionClientHeaders, cognitionResidentKey } from '../src/mind/cognition';
import {
  createLmStudioLocalJsonActionRequest,
  createLmStudioLocalLoomFoldRequest,
  createLmStudioLocalPrefixReadinessRequest,
  lmStudioResidentInstanceId,
  type LmStudioLocalPolicy,
  type LmStudioLocalPreflight,
} from '../src/mind/lmstudio-local';
import {
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
} from '../src/mind/ollama-json-action';
import { verifyCognitionTransportCapture } from '../src/mind/transport-capture';

test('the cognition gate preserves exact LM Studio wire and rejects returned instance drift', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lmstudio-broker-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journalFile = path.join(root, 'broker.jsonl');
  const transportCaptureDirectory = path.join(root, 'transport');
  const policy = localPolicy();
  const preflight = localPreflight(policy);
  const instanceId = lmStudioResidentInstanceId(policy, 'Aster');
  const serialized = createLmStudioLocalJsonActionRequest(
    residentRequest(policy.modelKey, 'Aster') as any,
    policy,
    instanceId,
  );
  let calls = 0;
  const broker = await startCognitionBroker({
    upstreamEndpoint: policy.endpoint,
    lmStudioPreflight: preflight,
    clients: [
      {
        bearer: token(),
        residentKey: cognitionResidentKey('lmstudio-fixture', 'Aster'),
        model: policy.modelKey,
        lmStudioLocal: policy,
        lmStudioResidentIdentity: 'Aster',
      },
      {
        bearer: token('birch'),
        residentKey: cognitionResidentKey('lmstudio-fixture', 'Birch'),
        model: policy.modelKey,
        lmStudioLocal: policy,
        lmStudioResidentIdentity: 'Birch',
      },
    ],
    maxConcurrent: 1,
    journalFile,
    transportCaptureDirectory,
    fetch: async (url, init) => {
      calls += 1;
      assert.equal(String(url), policy.endpoint);
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      assert.deepEqual(JSON.parse(String(init?.body)), serialized.body);
      const returnedInstance = calls === 1 ? instanceId : 'behold-drifted-instance';
      return jsonResponse({
        id: `chatcmpl-${calls}`,
        object: 'chat.completion',
        model: returnedInstance,
        system_fingerprint: returnedInstance,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({
                intention: 'Wait for another lived change.',
                expectedObservableConsequence: 'A later perception may contain a new event.',
                action: 'wait_for_event',
                arguments: { reason: 'Nothing presently requires movement.' },
              }),
              tool_calls: [],
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      });
    },
  });

  try {
    const driftedWire = structuredClone(serialized.body) as any;
    driftedWire.response_format.json_schema.schema.oneOf[0].properties.arguments.properties.reason.maxLength = 1;
    const refused = await request(broker.endpoint, JSON.stringify(driftedWire), 'wire-drift');
    assert.equal(refused.status, 400);
    assert.equal(((await refused.json()) as any).error.code, 'request_lmstudio_policy_mismatch');
    assert.equal(calls, 0);

    assert.equal(lmStudioResidentInstanceId(policy, 'Birch'), instanceId);

    const crossedResident = await request(
      broker.endpoint,
      JSON.stringify(serialized.body),
      'crossed-resident',
      'resident_decision',
      'deliberative',
      token('birch'),
    );
    assert.equal(crossedResident.status, 400);
    assert.equal(
      ((await crossedResident.json()) as any).error.code,
      'request_lmstudio_policy_mismatch',
    );
    assert.equal(calls, 0);

    const admitted = await request(broker.endpoint, JSON.stringify(serialized.body), 'exact');
    assert.equal(admitted.status, 200);
    assert.equal(((await admitted.json()) as any).model, instanceId);

    const identityDrift = await request(
      broker.endpoint,
      JSON.stringify(serialized.body),
      'identity-drift',
    );
    assert.equal(identityDrift.status, 502);
    assert.equal(((await identityDrift.json()) as any).error.code, 'lmstudio_identity_mismatch');
  } finally {
    await broker.close();
  }

  const events = verifyCognitionBrokerJournal(journalFile).events;
  const capture = verifyCognitionTransportCapture(transportCaptureDirectory, events);
  assert.equal(capture.attempts, 2);
  assert.equal(capture.identityFailures, 1);
  assert.equal(capture.starts[0].route.authentication, 'none_loopback');
  assert.equal(capture.starts[0].lmStudioIdentity?.preflightDigest, preflight.digest);
  assert.equal(
    capture.starts[0].lmStudioIdentity?.request.transportProtocol,
    'behold.lmstudio-local-resident-session.v1',
  );
  assert.equal(
    (capture.starts[0].lmStudioIdentity?.request as any).stablePrefixSha256,
    serialized.identity.stablePrefixSha256,
  );
  assert.equal(capture.records[1].terminal, 'lmstudio_identity_mismatch');
});

test('the cognition gate admits and captures only the exact LM Studio loom-fold wire as auxiliary work', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lmstudio-fold-broker-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journalFile = path.join(root, 'broker.jsonl');
  const ledgerFile = path.join(root, 'quota.jsonl');
  const transportCaptureDirectory = path.join(root, 'transport');
  const policy = localPolicy();
  const preflight = localPreflight(policy);
  const instanceId = lmStudioResidentInstanceId(policy);
  const residentKey = cognitionResidentKey('lmstudio-fold-fixture', 'Aster');
  const fold = createLmStudioLocalLoomFoldRequest(
    {
      entityId: 'Aster',
      fromSequence: 1,
      toSequence: 1,
      previousSummary: null,
      turns: [{ turn: 1, action: { name: 'chat' }, outcome: { ok: true } }],
    } as any,
    policy,
    instanceId,
  );
  let upstreamAttempts = 0;
  const broker = await startCognitionBroker({
    upstreamEndpoint: policy.endpoint,
    lmStudioPreflight: preflight,
    clients: [
      {
        bearer: token(),
        residentKey,
        model: policy.modelKey,
        lmStudioLocal: policy,
        accounting: {
          scopeId: 'lmstudio-fold-fixture',
          worldId: 'world-fixture',
          accountId: residentKey,
          ledgerFile,
          limits: { resident_decision: 2, loom_fold: 1 },
        },
      },
    ],
    maxConcurrent: 1,
    journalFile,
    transportCaptureDirectory,
    fetch: async (_url, init) => {
      upstreamAttempts += 1;
      assert.deepEqual(JSON.parse(String(init?.body)), fold.body);
      return jsonResponse({
        id: 'chatcmpl-fold-1',
        object: 'chat.completion',
        model: instanceId,
        system_fingerprint: instanceId,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({ summary: 'At [t1], Aster spoke.' }),
              tool_calls: [],
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 8, total_tokens: 58 },
      });
    },
  });

  try {
    const crossed = await request(broker.endpoint, JSON.stringify(fold.body), 'fold-as-decision');
    assert.equal(crossed.status, 400);
    assert.equal(upstreamAttempts, 0);

    const admitted = await request(
      broker.endpoint,
      JSON.stringify(fold.body),
      'exact-fold',
      'loom_fold',
      'auxiliary',
    );
    assert.equal(admitted.status, 200);
    assert.equal(upstreamAttempts, 1);
  } finally {
    await broker.close();
  }

  const events = verifyCognitionBrokerJournal(journalFile).events as any[];
  const admittedEvent = events.find(
    (event) => event.type === 'admitted' && event.request?.purpose === 'loom_fold',
  );
  assert.ok(admittedEvent);
  assert.equal(
    events.some(
      (event) => event.request?.purpose === 'resident_decision' && event.type === 'admitted',
    ),
    false,
  );
  const capture = verifyCognitionTransportCapture(transportCaptureDirectory, events);
  assert.equal(capture.attempts, 1);
  assert.equal(
    capture.starts[0].lmStudioIdentity?.request.transportProtocol,
    'behold.lmstudio-local-loom-fold.v1',
  );
  assert.match(fs.readFileSync(ledgerFile, 'utf8'), /"purpose":"loom_fold"/);
  assert.doesNotMatch(fs.readFileSync(ledgerFile, 'utf8'), /"purpose":"resident_decision"/);
});

test('the cognition gate records authority-free prefix readiness against the resident decision budget', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lmstudio-prefix-broker-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journalFile = path.join(root, 'broker.jsonl');
  const ledgerFile = path.join(root, 'quota.jsonl');
  const transportCaptureDirectory = path.join(root, 'transport');
  const policy = localPolicy();
  const preflight = localPreflight(policy);
  const instanceId = lmStudioResidentInstanceId(policy);
  const residentKey = cognitionResidentKey('lmstudio-prefix-fixture', 'Aster');
  const readiness = createLmStudioLocalPrefixReadinessRequest(
    residentRequest(policy.modelKey) as any,
    policy,
    instanceId,
  );
  let upstreamAttempts = 0;
  const broker = await startCognitionBroker({
    upstreamEndpoint: policy.endpoint,
    lmStudioPreflight: preflight,
    clients: [
      {
        bearer: token(),
        residentKey,
        model: policy.modelKey,
        lmStudioLocal: policy,
        accounting: {
          scopeId: 'lmstudio-prefix-fixture',
          worldId: 'world-fixture',
          accountId: residentKey,
          ledgerFile,
          limits: { resident_decision: 1, loom_fold: 1 },
        },
      },
    ],
    maxConcurrent: 1,
    journalFile,
    transportCaptureDirectory,
    fetch: async (_url, init) => {
      upstreamAttempts += 1;
      assert.deepEqual(JSON.parse(String(init?.body)), readiness.body);
      return jsonResponse({
        id: 'chatcmpl-prefix-1',
        object: 'chat.completion',
        model: instanceId,
        system_fingerprint: instanceId,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({ ready: true }),
              reasoning_content: '',
              tool_calls: [],
            },
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 4,
          total_tokens: 54,
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      });
    },
  });

  try {
    const crossed = await request(
      broker.endpoint,
      JSON.stringify(readiness.body),
      'prefix-as-decision',
    );
    assert.equal(crossed.status, 400);
    assert.equal(upstreamAttempts, 0);

    const admitted = await request(
      broker.endpoint,
      JSON.stringify(readiness.body),
      'exact-prefix',
      'resident_prefix_readiness',
      'auxiliary',
    );
    assert.equal(admitted.status, 200);
    assert.equal(upstreamAttempts, 1);
  } finally {
    await broker.close();
  }

  const events = verifyCognitionBrokerJournal(journalFile).events as any[];
  assert.ok(
    events.some(
      (event) =>
        event.type === 'admitted' && event.request?.purpose === 'resident_prefix_readiness',
    ),
  );
  const capture = verifyCognitionTransportCapture(transportCaptureDirectory, events);
  assert.equal(capture.attempts, 1);
  assert.equal(
    capture.starts[0].lmStudioIdentity?.request.transportProtocol,
    'behold.lmstudio-local-prefix-readiness.v1',
  );
  const ledger = fs.readFileSync(ledgerFile, 'utf8');
  assert.match(ledger, /"purpose":"resident_decision"/);
  assert.match(ledger, /"quotaPurpose":"resident_decision"/);
  assert.match(ledger, /"purpose":"resident_prefix_readiness"/);
});

function localPolicy(): LmStudioLocalPolicy {
  return {
    protocol: 'behold.lmstudio-local-policy.v1',
    endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    modelKey: 'fixture/gemma@4bit',
    catalogKey: 'fixture/gemma',
    indexedModelIdentifier: 'fixture/gemma@publisher/gemma-mlx-4bit',
    artifact: {
      relativePath: 'publisher/gemma-mlx-4bit',
      treeSha256: 'a'.repeat(64),
      sizeBytes: 4_000_000,
    },
    transport: {
      protocol: 'behold.lmstudio-local-resident-session.v1',
      schemaProtocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
      schemaSha256: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
      templateSha256: 'b'.repeat(64),
    },
    runtime: {
      appVersion: '0.4.12+1',
      cliCommit: 'fixture-cli',
      engine: 'mlx-fixture@1.0.0',
      format: 'mlx',
    },
    settings: { contextTokens: 16_384, maxOutputTokens: 512, temperature: 0.2 },
  };
}

function localPreflight(policy: LmStudioLocalPolicy): LmStudioLocalPreflight {
  const base = {
    protocol: 'behold.lmstudio-local-preflight.v1' as const,
    checkedAt: '2026-07-26T12:00:00.000Z',
    endpoint: policy.endpoint,
    runtime: policy.runtime,
    models: [
      {
        modelKey: policy.modelKey,
        catalogKey: policy.catalogKey,
        indexedModelIdentifier: policy.indexedModelIdentifier,
        artifactTreeSha256: policy.artifact.treeSha256,
        templateSha256: policy.transport.templateSha256,
        sizeBytes: policy.artifact.sizeBytes,
        architecture: 'gemma4',
        maxContextTokens: 262_144,
        trainedForToolUse: true,
      },
    ],
  };
  return { ...base, digest: sha256(stableJson(base)) };
}

function residentRequest(model: string, entityId = 'Aster') {
  return {
    protocol: 'behold.mind-request.v1',
    entityId,
    model,
    policyProfile: 'legible-resident-v1',
    bodyProfile: 'minecraft-human-semantic-v1',
    actionProfile: 'minecraft-human-semantic-v1',
    safetyProfile: 'vanilla-player-v1',
    observation: { protocol: 'behold.minecraft-human-semantic-observation.v1' },
    conversation: [
      { role: 'system', content: 'You are a persistent embodied Minecraft resident.' },
      {
        role: 'system',
        content:
          'Resident working continuity from your own entity loom.\n{"protocol":"behold.resident-working-continuity.v1","experiences":[]}',
      },
      {
        role: 'user',
        content: `Current perception:\n${JSON.stringify({
          protocol: 'behold.minecraft-human-semantic-observation.v1',
          self: { identity: entityId },
        })}`,
      },
    ],
    actions: [
      {
        name: 'wait_for_event',
        description: 'Yield until the world provides another event.',
        inputSchema: {
          type: 'object',
          properties: { reason: { type: 'string', minLength: 1, maxLength: 200 } },
          required: ['reason'],
          additionalProperties: false,
        },
      },
    ],
    requiredAction: null,
  };
}

function request(
  endpoint: string,
  body: string,
  requestId: string,
  purpose: 'resident_decision' | 'resident_prefix_readiness' | 'loom_fold' = 'resident_decision',
  priority: 'deliberative' | 'auxiliary' = 'deliberative',
  bearer = token(),
) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bearer}`,
      ...cognitionClientHeaders({
        requestId,
        priority,
        purpose,
        urgentTriggerSequence: null,
      }),
    },
    body,
  });
}

function token(label = 'aster') {
  return `local-lmstudio-${label}-${'x'.repeat(48)}`;
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
