import { createHash, randomUUID } from 'node:crypto';
import { cognitionClientHeaders, parseCognitionAdmission } from './cognition';
import {
  ResidentMindCallError,
  type ModelCallEvidence,
  type ModelCallFailureEvidence,
} from './evidence';
import type { LoomFoldSummarizer } from '../entity/folding';
import type { ResidentMind } from './interface';
import {
  createLmStudioLocalJsonActionRequest,
  createLmStudioLocalLoomFoldRequest,
  inspectLmStudioLocalResponseIdentity,
  lmStudioLocalPolicy,
  lmStudioResidentInstanceId,
  parseLmStudioLocalJsonActionDecision,
  parseLmStudioLocalLoomFoldResponse,
  type LmStudioLocalPolicy,
  type LmStudioLocalRequestIdentity,
} from './lmstudio-local';
import { residentMindRequestSha256 } from './request-artifact';
import { attributeProviderRequestBody } from './request-attribution';

export type LmStudioLocalResidentMindOptions = Readonly<{
  /** Runner-owned broker credential; never forwarded to LM Studio. */
  bearer: string;
  /** Exact runner-owned cognition broker endpoint. */
  endpoint: string;
  /** Exact local model/artifact/runtime/structured-output policy. */
  policy: LmStudioLocalPolicy;
  /** Exact session-owned LM Studio model instance created before world release. */
  modelInstanceId: string;
  cognitionTransport: true;
  recordModelIO?: boolean;
  now?: () => number;
  fetch?: typeof fetch;
}>;

export type LmStudioLocalLoomSummarizerOptions = Readonly<{
  bearer: string;
  endpoint: string;
  policy: LmStudioLocalPolicy;
  modelInstanceId: string;
  cognitionTransport: true;
  recordModelIO?: boolean;
  now?: () => number;
  fetch?: typeof fetch;
  onCall?: (event: {
    at: number;
    model: string;
    purpose: 'loom_fold';
    call: ModelCallEvidence;
  }) => void;
  onError?: (event: {
    at: number;
    model: string;
    purpose: 'loom_fold';
    error: string;
    call: ModelCallFailureEvidence;
  }) => void;
}>;

type LmStudioCallRequestEvidence = ModelCallEvidence['request'] &
  Readonly<{
    lmStudioPolicy: LmStudioLocalPolicy;
    lmStudioActionTransport: LmStudioLocalRequestIdentity;
    requestedModelInstance: string;
  }>;

/**
 * Strict LM Studio resident-session adapter. It performs one authenticated
 * broker request and never owns correction, retry, normalization, tools, or
 * world authority. The controller's canonical action-schema validator remains
 * the final boundary before an intent can be minted.
 */
export function createLmStudioLocalResidentMind(
  options: LmStudioLocalResidentMindOptions,
): ResidentMind {
  const now = options.now ?? Date.now;
  const requestFetch = options.fetch ?? fetch;
  const policy = lmStudioLocalPolicy(options.policy);
  const endpoint = exactCognitionEndpoint(options.endpoint);
  const modelInstanceId = exactModelInstanceId(options.modelInstanceId);
  if (modelInstanceId !== lmStudioResidentInstanceId(policy)) {
    throw new Error('LM Studio resident mind instance differs from its admitted model policy');
  }
  if (!options.cognitionTransport || String(options.bearer || '').length < 32) {
    throw new Error('LM Studio resident mind requires the authenticated cognition broker');
  }

  return {
    id: 'direct-lmstudio-local-json-action',
    async decide(request, { signal }) {
      if (request.model !== policy.modelKey) {
        throw new Error(`LM Studio resident mind was not configured for model ${request.model}`);
      }
      const startedAt = now();
      const requestId = `lmstudio-${randomUUID()}`;
      const serialized = createLmStudioLocalJsonActionRequest(request, policy, modelInstanceId);
      const body = serialized.body as Record<string, unknown>;
      const requestBody = JSON.stringify(body);
      const callRequest: LmStudioCallRequestEvidence = {
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
        kind: 'provider_request',
        lmStudioPolicy: policy,
        lmStudioActionTransport: serialized.identity,
        requestedModelInstance: modelInstanceId,
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
          `LM Studio resident decision transport error: ${error?.message || String(error)}`,
          {
            protocol: 'behold.model-call.v1',
            adapter: { name: 'direct-lmstudio-local-json-action', version: 'resident-session-v1' },
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
        throw new ResidentMindCallError(`LM Studio resident decision ${response.status}`, {
          protocol: 'behold.model-call.v1',
          adapter: { name: 'direct-lmstudio-local-json-action', version: 'resident-session-v1' },
          requestId,
          endpoint,
          startedAt,
          completedAt,
          latencyMs: Math.max(0, completedAt - startedAt),
          ...admissionEvidence(response),
          request: callRequest,
          response: {
            terminal: brokerFailureTerminal(text) as any,
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
        throw new ResidentMindCallError('LM Studio resident decision returned malformed JSON', {
          protocol: 'behold.model-call.v1',
          adapter: { name: 'direct-lmstudio-local-json-action', version: 'resident-session-v1' },
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
      const localIdentity = inspectLmStudioLocalResponseIdentity(data, policy);
      if (!localIdentity.ok) {
        throw new ResidentMindCallError(
          'LM Studio resident decision returned an unadmitted model instance',
          {
            protocol: 'behold.model-call.v1',
            adapter: { name: 'direct-lmstudio-local-json-action', version: 'resident-session-v1' },
            requestId,
            endpoint,
            startedAt,
            completedAt,
            latencyMs: Math.max(0, completedAt - startedAt),
            ...admissionEvidence(response),
            request: callRequest,
            response: {
              terminal: 'lmstudio_identity_mismatch' as any,
              status: response.status,
              bodyPreview: text.slice(0, 200) || null,
              lmStudioIdentity: localIdentity,
              ...(options.recordModelIO ? { raw: cloneJson(data) } : {}),
            } as any,
          },
        );
      }

      const call: ModelCallEvidence = {
        protocol: 'behold.model-call.v1',
        adapter: { name: 'direct-lmstudio-local-json-action', version: 'resident-session-v1' },
        requestId,
        endpoint,
        startedAt,
        completedAt,
        latencyMs: Math.max(0, completedAt - startedAt),
        ...admissionEvidence(response),
        request: callRequest,
        response: {
          terminal: 'success',
          id: stringOrNull(data?.id),
          model: localIdentity.returnedModel,
          provider: null,
          finishReason: stringOrNull(data?.choices?.[0]?.finish_reason),
          nativeFinishReason: stringOrNull(data?.choices?.[0]?.finish_reason),
          usage: lmStudioUsage(data),
          ...(options.recordModelIO ? { raw: cloneJson(data) } : {}),
        },
      };
      try {
        return parseLmStudioLocalJsonActionDecision(data, request, call, policy, modelInstanceId);
      } catch (error: any) {
        throw new ResidentMindCallError(
          `LM Studio resident decision returned malformed output: ${error?.message || String(error)}`,
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

/**
 * One exact auxiliary fold through the resident's already loaded local model.
 * It has no action schema, tool call, retry, correction, or world authority.
 */
export function createLmStudioLocalLoomSummarizer(
  options: LmStudioLocalLoomSummarizerOptions,
): LoomFoldSummarizer {
  const now = options.now ?? Date.now;
  const requestFetch = options.fetch ?? fetch;
  const policy = lmStudioLocalPolicy(options.policy);
  const endpoint = exactCognitionEndpoint(options.endpoint);
  const modelInstanceId = exactModelInstanceId(options.modelInstanceId);
  if (modelInstanceId !== lmStudioResidentInstanceId(policy)) {
    throw new Error('LM Studio loom summarizer instance differs from its admitted model policy');
  }
  if (!options.cognitionTransport || String(options.bearer || '').length < 32) {
    throw new Error('LM Studio loom summarizer requires the authenticated cognition broker');
  }

  return async (request, signal = new AbortController().signal) => {
    const startedAt = now();
    const requestId = `lmstudio-fold-${randomUUID()}`;
    const serialized = createLmStudioLocalLoomFoldRequest(request, policy, modelInstanceId);
    const body = serialized.body as Record<string, unknown>;
    const requestBody = JSON.stringify(body);
    const callRequest: ModelCallEvidence['request'] = {
      model: policy.modelKey,
      messageCount: 2,
      toolCount: 0,
      toolChoice: null,
      bodySha256: sha256(requestBody),
      bodyBytes: Buffer.byteLength(requestBody, 'utf8'),
      byteAttribution: attributeProviderRequestBody(body),
      messagesSha256: serialized.identity.messagesSha256,
      toolsSha256: sha256(stableJson([])),
      formatSha256: serialized.identity.responseFormatSha256,
      kind: 'provider_request',
      lmStudioPolicy: policy,
      lmStudioLoomFoldTransport: serialized.identity,
      requestedModelInstance: modelInstanceId,
      ...(options.recordModelIO ? { body: cloneJson(body) } : {}),
    };
    const failure = (
      message: string,
      terminal: ModelCallFailureEvidence['response']['terminal'],
      status: number | null,
      bodyPreview: string | null,
      completedAt: number,
      additions: Partial<Omit<ModelCallFailureEvidence, 'request' | 'response'>> = {},
      responseAdditions: Partial<ModelCallFailureEvidence['response']> = {},
    ) => {
      const call: ModelCallFailureEvidence = {
        protocol: 'behold.model-call.v1',
        adapter: { name: 'lmstudio-local-loom-fold', version: 'v1' },
        requestId,
        endpoint,
        startedAt,
        completedAt,
        latencyMs: Math.max(0, completedAt - startedAt),
        ...additions,
        request: callRequest,
        response: { terminal, status, bodyPreview, ...responseAdditions },
      };
      if (!signal.aborted) {
        options.onError?.({
          at: completedAt,
          model: policy.modelKey,
          purpose: 'loom_fold',
          error: message,
          call,
        });
      }
      return new ResidentMindCallError(message, call);
    };

    let response: Response;
    try {
      response = await requestFetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.bearer}`,
          ...cognitionClientHeaders({
            requestId,
            priority: 'auxiliary',
            purpose: 'loom_fold',
            urgentTriggerSequence: null,
          }),
        },
        body: requestBody,
        signal,
      });
    } catch (error: any) {
      const completedAt = now();
      throw failure(
        `LM Studio loom-fold transport error: ${error?.message || String(error)}`,
        signal.aborted ? 'cancelled' : 'transport_error',
        null,
        null,
        completedAt,
      );
    }
    const text = await response.text();
    const completedAt = now();
    if (!response.ok) {
      throw failure(
        `LM Studio loom-fold request ${response.status}`,
        brokerFailureTerminal(text) as ModelCallFailureEvidence['response']['terminal'],
        response.status,
        text.slice(0, 200) || null,
        completedAt,
        admissionEvidence(response),
      );
    }
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw failure(
        'LM Studio loom-fold response was malformed JSON',
        'malformed_output',
        response.status,
        text.slice(0, 200) || null,
        completedAt,
        admissionEvidence(response),
      );
    }
    const localIdentity = inspectLmStudioLocalResponseIdentity(data, policy);
    if (!localIdentity.ok) {
      throw failure(
        'LM Studio loom-fold response returned an unadmitted model instance',
        'lmstudio_identity_mismatch',
        response.status,
        text.slice(0, 200) || null,
        completedAt,
        admissionEvidence(response),
        {
          lmStudioIdentity: localIdentity,
          ...(options.recordModelIO ? { raw: cloneJson(data) } : {}),
        },
      );
    }
    let summary: string;
    try {
      summary = parseLmStudioLocalLoomFoldResponse(data, policy, modelInstanceId);
    } catch (error: any) {
      throw failure(
        `LM Studio loom-fold response was malformed: ${error?.message || String(error)}`,
        'malformed_output',
        response.status,
        text.slice(0, 200) || null,
        completedAt,
        admissionEvidence(response),
        options.recordModelIO ? { raw: cloneJson(data) } : {},
      );
    }
    const call: ModelCallEvidence = {
      protocol: 'behold.model-call.v1',
      adapter: { name: 'lmstudio-local-loom-fold', version: 'v1' },
      requestId,
      endpoint,
      startedAt,
      completedAt,
      latencyMs: Math.max(0, completedAt - startedAt),
      ...admissionEvidence(response),
      request: callRequest,
      response: {
        terminal: 'success',
        id: stringOrNull(data?.id),
        model: localIdentity.returnedModel,
        provider: null,
        finishReason: stringOrNull(data?.choices?.[0]?.finish_reason),
        nativeFinishReason: stringOrNull(data?.choices?.[0]?.finish_reason),
        usage: lmStudioUsage(data),
        ...(options.recordModelIO ? { raw: cloneJson(data) } : {}),
      },
    };
    options.onCall?.({ at: completedAt, model: policy.modelKey, purpose: 'loom_fold', call });
    return summary;
  };
}

function admissionEvidence(response: Response) {
  const admission = parseCognitionAdmission(response.headers);
  return admission ? { admissions: [admission] } : {};
}

function brokerFailureTerminal(text: string) {
  try {
    const code = String(JSON.parse(text)?.error?.code || '');
    if (code === 'lmstudio_identity_mismatch') return 'lmstudio_identity_mismatch';
    if (/admission|quota|queue|request_lmstudio/.test(code)) return 'admission_rejected';
  } catch {
    // Ordinary local runtime error.
  }
  return 'provider_error';
}

function lmStudioUsage(data: any) {
  const usage = plainRecord(data?.usage) ? data.usage : null;
  if (!usage) return null;
  const result: Record<string, number> = {};
  for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
    const value = nonnegativeNumber(usage[field]);
    if (value != null) result[field] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function nonnegativeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function exactCognitionEndpoint(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/v1/chat/completions' ||
    url.search ||
    url.hash
  ) {
    throw new Error('LM Studio resident transport requires the exact loopback cognition endpoint');
  }
  return url.toString();
}

function exactModelInstanceId(value: unknown) {
  const text = String(value || '');
  if (!/^behold-[a-f0-9]{24}$/.test(text)) {
    throw new Error('LM Studio resident model instance identity is invalid');
  }
  return text;
}

function plainRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
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
