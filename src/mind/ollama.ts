import { createHash, randomUUID } from 'node:crypto';
import { cognitionClientHeaders, parseCognitionAdmission } from './cognition';
import { ResidentMindCallError, type ModelCallEvidence } from './evidence';
import type { ResidentMind } from './interface';
import {
  inspectOllamaLocalResponseIdentity,
  ollamaLocalPolicy,
  type OllamaLocalPolicy,
} from './ollama-local';
import {
  createOllamaLocalJsonActionRequest,
  parseOllamaLocalJsonActionDecision,
} from './ollama-json-action';
import { residentMindRequestSha256 } from './request-artifact';
import { attributeProviderRequestBody } from './request-attribution';

export type OllamaLocalResidentMindOptions = Readonly<{
  /** Runner-owned broker credential; never forwarded to the loopback Ollama daemon. */
  bearer: string;
  endpoint: string;
  policy: OllamaLocalPolicy;
  cognitionTransport: true;
  recordModelIO?: boolean;
  now?: () => number;
  fetch?: typeof fetch;
}>;

/** Strict native Ollama JSON-action adapter with no tools, correction, or provider semantics. */
export function createOllamaLocalResidentMind(
  options: OllamaLocalResidentMindOptions,
): ResidentMind {
  const now = options.now ?? Date.now;
  const requestFetch = options.fetch ?? fetch;
  const policy = ollamaLocalPolicy(options.policy);
  const endpoint = safeEndpoint(options.endpoint);
  if (!options.cognitionTransport || String(options.bearer || '').length < 32) {
    throw new Error('Ollama local resident mind requires the authenticated cognition broker');
  }

  return {
    id: 'direct-ollama-local-json-action',
    async decide(request, { signal }) {
      if (request.model !== policy.modelTag) {
        throw new Error(`Ollama local mind was not configured for model ${request.model}`);
      }
      const startedAt = now();
      const requestId = `ollama-${randomUUID()}`;
      const serialized = createOllamaLocalJsonActionRequest(request, policy);
      const body = serialized.body as Record<string, any>;
      const requestBody = JSON.stringify(body);
      const callRequest = {
        model: request.model,
        mindRequestSha256: residentMindRequestSha256(request),
        ...(options.recordModelIO ? { mindRequest: cloneJson(request) } : {}),
        messageCount: request.conversation.length,
        toolCount: request.actions.length,
        toolChoice: request.requiredAction,
        bodySha256: sha256(requestBody),
        bodyBytes: Buffer.byteLength(requestBody, 'utf8'),
        byteAttribution: attributeProviderRequestBody(body),
        messagesSha256: sha256(stableJson(body.messages)),
        toolsSha256: serialized.identity.actionContractSha256,
        formatSha256: serialized.identity.responseFormatSha256,
        kind: 'provider_request' as const,
        localPolicy: policy,
        localActionTransport: serialized.identity,
        ...(options.recordModelIO ? { body: cloneJson(body) } : {}),
      };
      const priority = request.attention?.mode === 'urgent' ? 'urgent' : 'deliberative';
      const urgentTriggers = (request.attention?.triggers ?? []).map((trigger) => trigger.sequence);
      const urgentTriggerSequence =
        priority === 'urgent' && urgentTriggers.length > 0 ? Math.max(...urgentTriggers) : null;

      let response: Response;
      try {
        response = await requestFetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.bearer}`,
            ...cognitionClientHeaders({
              requestId,
              priority,
              purpose: 'resident_decision',
              urgentTriggerSequence,
            }),
          },
          body: requestBody,
          signal,
        });
      } catch (error: any) {
        const completedAt = now();
        throw new ResidentMindCallError(
          `Ollama local decision transport error: ${error?.message || String(error)}`,
          {
            protocol: 'behold.model-call.v1',
            adapter: { name: 'direct-ollama-local-json-action', version: 'v1' },
            requestId,
            endpoint,
            startedAt,
            completedAt,
            latencyMs: Math.max(0, completedAt - startedAt),
            request: callRequest,
            response: {
              terminal: signal.aborted ? 'cancelled' : 'transport_error',
              status: null,
              bodyPreview: null,
            },
          },
        );
      }

      const text = await response.text();
      if (!response.ok) {
        const completedAt = now();
        throw new ResidentMindCallError(`Ollama local decision ${response.status}`, {
          protocol: 'behold.model-call.v1',
          adapter: { name: 'direct-ollama-local-json-action', version: 'v1' },
          requestId,
          endpoint,
          startedAt,
          completedAt,
          latencyMs: Math.max(0, completedAt - startedAt),
          ...admissionEvidence(response),
          request: callRequest,
          response: {
            terminal: brokerFailureTerminal(text),
            status: response.status,
            bodyPreview: text.slice(0, 200) || null,
          },
        });
      }

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        const completedAt = now();
        throw new ResidentMindCallError('Ollama local decision returned malformed JSON', {
          protocol: 'behold.model-call.v1',
          adapter: { name: 'direct-ollama-local-json-action', version: 'v1' },
          requestId,
          endpoint,
          startedAt,
          completedAt,
          latencyMs: Math.max(0, completedAt - startedAt),
          ...admissionEvidence(response),
          request: callRequest,
          response: {
            terminal: 'malformed_output',
            status: response.status,
            bodyPreview: text.slice(0, 200) || null,
          },
        });
      }

      const completedAt = now();
      const localIdentity = inspectOllamaLocalResponseIdentity(data, policy);
      if (!localIdentity.ok) {
        throw new ResidentMindCallError(
          'Ollama local decision returned unadmitted model identity',
          {
            protocol: 'behold.model-call.v1',
            adapter: { name: 'direct-ollama-local-json-action', version: 'v1' },
            requestId,
            endpoint,
            startedAt,
            completedAt,
            latencyMs: Math.max(0, completedAt - startedAt),
            ...admissionEvidence(response),
            request: callRequest,
            response: {
              terminal: 'ollama_identity_mismatch',
              status: response.status,
              bodyPreview: text.slice(0, 200) || null,
              localIdentity,
            },
          },
        );
      }
      const usage = ollamaUsage(data);
      const call: ModelCallEvidence = {
        protocol: 'behold.model-call.v1',
        adapter: { name: 'direct-ollama-local-json-action', version: 'v1' },
        requestId,
        endpoint,
        startedAt,
        completedAt,
        latencyMs: Math.max(0, completedAt - startedAt),
        ...admissionEvidence(response),
        request: callRequest,
        response: {
          terminal: 'success',
          id: null,
          model: localIdentity.returnedModel,
          provider: null,
          finishReason: stringOrNull(data?.done_reason),
          nativeFinishReason: stringOrNull(data?.done_reason),
          usage,
          ...(options.recordModelIO ? { raw: cloneJson(data) } : {}),
        },
      };
      try {
        return parseOllamaLocalJsonActionDecision(data, request, call);
      } catch (error: any) {
        throw new ResidentMindCallError(
          `Ollama local decision returned malformed output: ${error?.message || String(error)}`,
          {
            ...call,
            response: {
              terminal: 'malformed_output',
              status: response.status,
              bodyPreview: text.slice(0, 200) || null,
              ...(options.recordModelIO ? { raw: cloneJson(data) } : {}),
            },
          },
        );
      }
    },
  };
}

function admissionEvidence(response: Response) {
  const admission = parseCognitionAdmission(response.headers);
  return admission ? { admissions: [admission] } : {};
}

function brokerFailureTerminal(text: string) {
  try {
    const code = String(JSON.parse(text)?.error?.code || '');
    if (code === 'ollama_identity_mismatch') return 'ollama_identity_mismatch' as const;
    if (/admission|quota|queue|request_ollama/.test(code)) return 'admission_rejected' as const;
  } catch {
    // Ordinary local server error.
  }
  return 'provider_error' as const;
}

function ollamaUsage(data: any) {
  const prompt = nonnegativeNumber(data?.prompt_eval_count);
  const completion = nonnegativeNumber(data?.eval_count);
  if (prompt == null && completion == null) return null;
  return {
    ...(prompt == null ? {} : { prompt_tokens: prompt }),
    ...(completion == null ? {} : { completion_tokens: completion }),
    ...(prompt == null || completion == null ? {} : { total_tokens: prompt + completion }),
  };
}

function nonnegativeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function stringOrNull(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function safeEndpoint(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/v1/chat/completions' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Ollama resident transport must use the exact loopback cognition endpoint');
  }
  return url.toString();
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function cloneJson(value: unknown): any {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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
