import { createHash } from 'node:crypto';
import { LMStudioClient } from '@lmstudio/sdk';

export const LMSTUDIO_EXACT_CONTEXT_ADMISSION_PROTOCOL =
  'behold.lmstudio-exact-context-admission.v1' as const;

export type LmStudioExactContextAdmission = Readonly<{
  protocol: typeof LMSTUDIO_EXACT_CONTEXT_ADMISSION_PROTOCOL;
  modelInstanceId: string;
  promptTemplateSha256: string;
  inputTokens: number;
  maxOutputTokens: number;
  loadedContextTokens: number;
  admittedContextTokens: number;
  totalReservedTokens: number;
}>;

type AdmissionInput = Readonly<{
  endpointOrigin: string;
  modelInstanceId: string;
  messages: unknown;
  maxOutputTokens: number;
  admittedContextTokens: number;
  /** Test seam only. Production always creates the official local SDK client. */
  createClient?: (baseUrl: string) => any;
}>;

/**
 * Apply the exact loaded model's LM Studio prompt template, then count that
 * formatted prompt with the same model tokenizer. This is deliberately done
 * against the final OpenAI-compatible message body, including its current
 * image placeholder, immediately before the broker request is admitted.
 */
export async function admitExactLmStudioContext(
  input: AdmissionInput,
): Promise<LmStudioExactContextAdmission> {
  const origin = loopbackOrigin(input.endpointOrigin);
  const instanceId = nonEmpty(input.modelInstanceId, 'LM Studio model instance id');
  const maxOutputTokens = positiveInteger(input.maxOutputTokens, 'LM Studio max output tokens');
  const admittedContextTokens = positiveInteger(
    input.admittedContextTokens,
    'LM Studio admitted context tokens',
  );
  const baseUrl = origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  const client = input.createClient
    ? input.createClient(baseUrl)
    : new LMStudioClient({ baseUrl, verboseErrorMessages: true });

  try {
    const model = client.llm.createDynamicHandle({ identifier: instanceId });
    const chat = await openAiMessagesToLmStudioChat(client, input.messages);
    const formatted = await model.applyPromptTemplate(chat);
    if (typeof formatted !== 'string' || formatted.length === 0) {
      throw new Error('LM Studio returned an empty formatted resident prompt');
    }
    const [loadedContextValue, inputTokensValue] = await Promise.all([
      model.getContextLength(),
      model.countTokens(formatted),
    ]);
    const loadedContextTokens = positiveInteger(
      loadedContextValue,
      'LM Studio loaded context tokens',
    );
    const inputTokens = nonnegativeInteger(inputTokensValue, 'LM Studio resident input tokens');
    if (loadedContextTokens !== admittedContextTokens) {
      throw new Error(
        `LM Studio loaded context ${loadedContextTokens} differs from admitted ${admittedContextTokens}`,
      );
    }
    const totalReservedTokens = inputTokens + maxOutputTokens;
    if (totalReservedTokens > loadedContextTokens) {
      throw new Error(
        `LM Studio request exceeds the exact admitted context window: ${inputTokens} input tokens + ${maxOutputTokens} output > ${loadedContextTokens}`,
      );
    }
    return Object.freeze({
      protocol: LMSTUDIO_EXACT_CONTEXT_ADMISSION_PROTOCOL,
      modelInstanceId: instanceId,
      promptTemplateSha256: sha256(formatted),
      inputTokens,
      maxOutputTokens,
      loadedContextTokens,
      admittedContextTokens,
      totalReservedTokens,
    });
  } finally {
    await client[Symbol.asyncDispose]?.();
  }
}

async function openAiMessagesToLmStudioChat(client: any, value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('LM Studio exact context admission requires resident messages');
  }
  const chat: Array<{ role: 'system' | 'user' | 'assistant'; content: string; images?: any[] }> =
    [];
  for (const [index, raw] of value.entries()) {
    if (!plainRecord(raw)) throw new Error(`LM Studio message ${index} is malformed`);
    const role = raw.role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new Error(`LM Studio message ${index} has unsupported role`);
    }
    if (typeof raw.content === 'string') {
      chat.push({ role, content: raw.content });
      continue;
    }
    if (!Array.isArray(raw.content) || role !== 'user') {
      throw new Error(`LM Studio message ${index} has unsupported content`);
    }
    const text: string[] = [];
    const images: any[] = [];
    for (const [partIndex, part] of raw.content.entries()) {
      if (!plainRecord(part)) {
        throw new Error(`LM Studio message ${index} part ${partIndex} is malformed`);
      }
      if (part.type === 'text' && typeof part.text === 'string') {
        text.push(part.text);
        continue;
      }
      if (part.type === 'image_url' && plainRecord(part.image_url)) {
        const parsed = dataImage(String(part.image_url.url || ''));
        images.push(
          await client.files.prepareImageBase64(
            `resident-${sha256(parsed.base64).slice(0, 16)}.${parsed.extension}`,
            parsed.base64,
          ),
        );
        continue;
      }
      throw new Error(`LM Studio message ${index} part ${partIndex} is unsupported`);
    }
    if (text.length !== 1 || images.length !== 1 || raw.content.length !== 2) {
      throw new Error('LM Studio resident camera message must contain one text and one image');
    }
    chat.push({ role, content: text[0], images });
  }
  return chat;
}

function dataImage(value: string) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('LM Studio resident context contains a noncanonical image URL');
  return { extension: match[1] === 'jpeg' ? 'jpg' : 'png', base64: match[2] };
}

function loopbackOrigin(value: string) {
  const url = new URL(value);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    (url.hostname !== '127.0.0.1' && url.hostname !== '::1' && url.hostname !== '[::1]') ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new Error('LM Studio exact context admission requires an exact loopback origin');
  }
  return url.origin;
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid`);
  return Number(value);
}

function nonnegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`);
  return Number(value);
}

function nonEmpty(value: unknown, label: string) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function plainRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
