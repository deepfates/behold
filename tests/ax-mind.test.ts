import test from 'node:test';
import assert from 'node:assert/strict';
import { createAxResidentMind } from '../src/mind/ax';

test('Ax proposes a typed decision without receiving executable world functions', async () => {
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(String(init?.body || '{}')));
    const firstAttempt = requests.length === 1;
    return new Response(
      JSON.stringify({
        id: 'ax-test-generation',
        object: 'chat.completion',
        created: 1,
        model: 'test/model',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: [
                'Disposition: act',
                `Action Name: ${firstAttempt ? 'use_crafting_table' : 'craft_item'}`,
                'Action Input: {"item":"oak_planks"}',
                'Utterance: I will turn the log into planks.',
              ].join('\n'),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const mind = createAxResidentMind({
    apiKey: 'test-key',
    model: 'test/model',
    apiURL: 'https://models.example.test/v1',
    maxRetries: 1,
    now: (() => {
      let value = 100;
      return () => (value += 5);
    })(),
  });

  try {
    const decision = await mind.decide(
      {
        protocol: 'behold.mind-request.v1',
        entityId: 'Scout',
        model: 'test/model',
        observation: { inventory: [{ name: 'oak_log', count: 1 }] },
        conversation: [{ role: 'system', content: 'Live carefully.' }],
        actions: [
          {
            name: 'craft_item',
            description: 'Craft one recipe',
            inputSchema: { type: 'object', properties: { item: { type: 'string' } } },
          },
        ],
        requiredAction: null,
      },
      { signal: new AbortController().signal },
    );

    assert.equal(requests.length, 2, 'Ax should retry an action outside the admitted set');
    assert.equal(
      Array.isArray(requests[0].tools) && requests[0].tools.length > 0,
      false,
      'Ax may request structured output, but it must not receive executable Minecraft tools',
    );
    assert.equal(decision.disposition, 'act');
    assert.equal(decision.action?.name, 'craft_item');
    assert.deepEqual(decision.action?.input, { item: 'oak_planks' });
    assert.equal(decision.call.adapter?.name, 'ax');
    assert.equal(decision.call.request.kind, 'mind_input');
    assert.equal((decision.call.response.usage as any).ax[0].tokens.totalTokens, 240);
    assert.equal((decision.call.response.usage as any).provider.total_tokens, 240);
    assert.equal((decision.call.response.usage as any).provider.attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
