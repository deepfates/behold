import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOllamaLocalResidentMind } from '../src/mind/ollama';
import { ResidentMindCallError } from '../src/mind/evidence';
import {
  directOllamaRequestBody,
  ollamaLocalPolicy,
  preflightOllamaLocal,
} from '../src/mind/ollama-local';

const DIGEST_3B = 'a'.repeat(64);
const DIGEST_70B = 'b'.repeat(64);

test('Ollama policy admits only exact loopback native chat with bounded common settings', () => {
  assert.deepEqual(
    ollamaLocalPolicy(policy('llama3.2:3b', DIGEST_3B)),
    policy('llama3.2:3b', DIGEST_3B),
  );
  for (const endpoint of [
    'https://127.0.0.1:11434/api/chat',
    'http://localhost:11434/api/chat',
    'http://192.168.1.4:11434/api/chat',
    'http://127.0.0.1:11434/v1/chat/completions',
    'http://127.0.0.1:11434/api/chat?remote=true',
  ]) {
    assert.throws(() => ollamaLocalPolicy({ ...policy('llama3.2:3b', DIGEST_3B), endpoint }));
  }
  assert.throws(() =>
    ollamaLocalPolicy({
      ...policy('llama3.2:3b', DIGEST_3B),
      settings: { ...policy('llama3.2:3b', DIGEST_3B).settings, keepAlive: 'default' },
    }),
  );
});

test('native Ollama request has no OpenRouter provider, fallback, or compatibility fields', () => {
  const body = directOllamaRequestBody(request() as any, policy('test/model', DIGEST_3B));
  assert.deepEqual(Object.keys(body).sort(), [
    'keep_alive',
    'messages',
    'model',
    'options',
    'stream',
    'tools',
  ]);
  assert.equal(Object.hasOwn(body, 'provider'), false);
  assert.equal(Object.hasOwn(body, 'parallel_tool_calls'), false);
  assert.equal(Object.hasOwn(body, 'max_tokens'), false);
  assert.deepEqual(body.options, { num_ctx: 16_384, num_predict: 512, temperature: 0.2 });
  assert.equal(body.keep_alive, '5m');
});

test('read-only Ollama preflight binds cloud-disabled config, installed digests, tools, and context', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-ollama-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cloudConfigFile = path.join(root, 'server.json');
  fs.writeFileSync(cloudConfigFile, JSON.stringify({ disable_ollama_cloud: true }));
  const calls: Array<{ path: string; body: any }> = [];
  const preflight = await preflightOllamaLocal({
    policies: [policy('llama3.2:3b', DIGEST_3B), policy('llama3.3:latest', DIGEST_70B)],
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
    preflight.models.map((model) => [model.modelTag, model.modelDigest, model.contextLength]),
    [
      ['llama3.2:3b', DIGEST_3B, 131_072],
      ['llama3.3:latest', DIGEST_70B, 131_072],
    ],
  );
  assert.equal(
    calls.some((call) => call.path === '/api/chat'),
    false,
  );
  assert.deepEqual(
    calls.filter((call) => call.path === '/api/show').map((call) => call.body),
    [
      { model: 'llama3.2:3b', verbose: false },
      { model: 'llama3.3:latest', verbose: false },
    ],
  );
});

test('Ollama preflight fails closed before admission on cloud, digest, tool, or context drift', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-ollama-negative-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cloudConfigFile = path.join(root, 'server.json');
  fs.writeFileSync(cloudConfigFile, JSON.stringify({ disable_ollama_cloud: false }));
  let calls = 0;
  await assert.rejects(
    preflightOllamaLocal({
      policies: [policy('llama3.2:3b', DIGEST_3B)],
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
    { capabilities: ['completion'], model_info: { 'llama.context_length': 131_072 } },
    { capabilities: ['completion', 'tools'], model_info: { 'llama.context_length': 8_192 } },
  ]) {
    await assert.rejects(
      preflightOllamaLocal({
        policies: [policy('llama3.2:3b', DIGEST_3B)],
        cloudConfigFile,
        fetch: preflightFetch(show),
      }),
      /tool capability|context is smaller/,
    );
  }
  await assert.rejects(
    preflightOllamaLocal({
      policies: [policy('llama3.2:3b', DIGEST_3B)],
      cloudConfigFile,
      fetch: preflightFetch(
        {
          capabilities: ['completion', 'tools'],
          model_info: { 'llama.context_length': 131_072 },
        },
        'c'.repeat(64),
      ),
    }),
    /installed digest differs/,
  );
});

test('Ollama mind checks response tag and retains native failures distinctly', async () => {
  const bodies: any[] = [];
  const mind = createOllamaLocalResidentMind({
    bearer: 'resident-broker-bearer-that-is-long-enough',
    endpoint: 'http://127.0.0.1:31000/v1/chat/completions',
    policy: policy('test/model', DIGEST_3B),
    cognitionTransport: true,
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json({
        model: 'test/model',
        message: {
          role: 'assistant',
          content: 'I will step forward.',
          tool_calls: [
            {
              function: {
                name: 'move_direction',
                arguments: { direction: 'forward', distance: 2 },
              },
            },
          ],
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
  assert.equal(decision.call.adapter?.name, 'direct-ollama-local');
  assert.equal(decision.call.response.provider, null);
  assert.deepEqual(decision.call.response.usage, {
    prompt_tokens: 40,
    completion_tokens: 8,
    total_tokens: 48,
  });
  assert.equal(Object.hasOwn(bodies[0], 'provider'), false);

  const drifted = createOllamaLocalResidentMind({
    bearer: 'resident-broker-bearer-that-is-long-enough',
    endpoint: 'http://127.0.0.1:31000/v1/chat/completions',
    policy: policy('test/model', DIGEST_3B),
    cognitionTransport: true,
    fetch: async () =>
      json({ model: 'other/model', message: { role: 'assistant', content: null }, done: true }),
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

function policy(modelTag: string, modelDigest: string) {
  return {
    protocol: 'behold.ollama-local-policy.v1',
    endpoint: 'http://127.0.0.1:11434/api/chat',
    modelTag,
    modelDigest,
    settings: {
      contextTokens: 16_384,
      maxOutputTokens: 512,
      temperature: 0.2,
      keepAlive: '5m',
    },
  } as const;
}

function request() {
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
        name: 'move_direction',
        description: 'Move relative to first-person orientation.',
        inputSchema: {
          type: 'object',
          properties: {
            direction: { type: 'string' },
            distance: { type: 'integer' },
          },
          required: ['direction', 'distance'],
        },
      },
    ],
    requiredAction: null,
    attention: { mode: 'deliberative', context: 'bounded_loom', triggers: [] },
  };
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
