import assert from 'node:assert/strict';
import test from 'node:test';
import {
  admitExactLmStudioContext,
  LMSTUDIO_EXACT_CONTEXT_ADMISSION_PROTOCOL,
} from '../src/mind/lmstudio-context-admission';

test('exact LM Studio admission counts the final templated multimodal resident messages', async () => {
  const observed: any = { disposed: false, images: [] };
  const admission = await admitExactLmStudioContext({
    endpointOrigin: 'http://127.0.0.1:1234',
    modelInstanceId: 'resident-shared-model',
    messages: [
      { role: 'system', content: 'You are Rowan.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What you experience: stone' },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,iVBORw0KGgo=',
            },
          },
        ],
      },
    ],
    maxOutputTokens: 32,
    admittedContextTokens: 128,
    createClient(baseUrl) {
      observed.baseUrl = baseUrl;
      return fakeClient(observed, { loadedContextTokens: 128, inputTokens: 91 });
    },
  });

  assert.equal(observed.baseUrl, 'ws://127.0.0.1:1234');
  assert.deepEqual(observed.images, [
    { name: 'resident-929e08d597feae56.png', base64: 'iVBORw0KGgo=' },
  ]);
  assert.deepEqual(observed.chat, [
    { role: 'system', content: 'You are Rowan.' },
    {
      role: 'user',
      content: 'What you experience: stone',
      images: [{ image: 'resident-929e08d597feae56.png' }],
    },
  ]);
  assert.equal(admission.protocol, LMSTUDIO_EXACT_CONTEXT_ADMISSION_PROTOCOL);
  assert.equal(admission.inputTokens, 91);
  assert.equal(admission.totalReservedTokens, 123);
  assert.equal(observed.disposed, true);
});

test('exact LM Studio admission refuses the first request beyond the loaded boundary', async () => {
  await assert.rejects(
    admitExactLmStudioContext({
      endpointOrigin: 'http://[::1]:1234',
      modelInstanceId: 'resident-shared-model',
      messages: [{ role: 'user', content: 'complete life' }],
      maxOutputTokens: 32,
      admittedContextTokens: 128,
      createClient() {
        return fakeClient({}, { loadedContextTokens: 128, inputTokens: 97 });
      },
    }),
    /97 input tokens \+ 32 output > 128/,
  );
});

test('exact LM Studio admission fails closed on loaded-context drift and unsupported content', async () => {
  await assert.rejects(
    admitExactLmStudioContext({
      endpointOrigin: 'http://127.0.0.1:1234',
      modelInstanceId: 'resident-shared-model',
      messages: [{ role: 'user', content: 'complete life' }],
      maxOutputTokens: 32,
      admittedContextTokens: 128,
      createClient() {
        return fakeClient({}, { loadedContextTokens: 256, inputTokens: 10 });
      },
    }),
    /loaded context 256 differs from admitted 128/,
  );

  await assert.rejects(
    admitExactLmStudioContext({
      endpointOrigin: 'http://127.0.0.1:1234',
      modelInstanceId: 'resident-shared-model',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://example.com/private.png' } }],
        },
      ],
      maxOutputTokens: 32,
      admittedContextTokens: 128,
      createClient() {
        return fakeClient({}, { loadedContextTokens: 128, inputTokens: 10 });
      },
    }),
    /noncanonical image URL/,
  );
});

function fakeClient(
  observed: any,
  counts: Readonly<{ loadedContextTokens: number; inputTokens: number }>,
) {
  return {
    files: {
      async prepareImageBase64(name: string, base64: string) {
        observed.images?.push({ name, base64 });
        return { image: name };
      },
    },
    llm: {
      createDynamicHandle(query: unknown) {
        observed.query = query;
        return {
          async applyPromptTemplate(chat: unknown) {
            observed.chat = chat;
            return `formatted:${JSON.stringify(chat)}`;
          },
          async getContextLength() {
            return counts.loadedContextTokens;
          },
          async countTokens(formatted: string) {
            observed.formatted = formatted;
            return counts.inputTokens;
          },
        };
      },
    },
    async [Symbol.asyncDispose]() {
      observed.disposed = true;
    },
  };
}
