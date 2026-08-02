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
  createLmStudioLocalPrefixReadinessRequest,
  inspectLmStudioLocalResponseIdentity,
  lmStudioLocalPolicy,
  lmStudioResidentInstanceId,
  parseLmStudioLocalJsonActionDecision,
  parseLmStudioLocalLoomFoldResponse,
  parseLmStudioLocalPrefixReadinessResponse,
  type LmStudioLocalPolicy,
  type LmStudioLocalRequestIdentity,
  type LmStudioLocalPrefixReadinessRequestIdentity,
} from './lmstudio-local';
import { residentMindRequestSha256 } from './request-artifact';
import { attributeProviderRequestBody } from './request-attribution';
import {
  admitResidentCameraFrameFreshness,
  RESIDENT_CAMERA_MAX_AGE_MS,
  RESIDENT_CAMERA_MAX_CAPTURE_DURATION_MS,
} from '../perception/resident-camera-frame';
import {
  admitExactLmStudioContext,
  type LmStudioExactContextAdmission,
} from './lmstudio-context-admission';

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
  /** Test seam for the official SDK context counter; production leaves this unset. */
  createContextClient?: (baseUrl: string) => any;
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
    lmStudioPrefixReadiness: LmStudioPrefixReadinessEvidence;
    lmStudioContextAdmission?: LmStudioExactContextAdmission;
  }>;

export type LmStudioPrefixReadinessEvidence = Readonly<{
  protocol: 'behold.lmstudio-resident-prefix-readiness.v1';
  authority: 'none';
  responseUsedAsResidentDecision: false;
  request: LmStudioLocalPrefixReadinessRequestIdentity &
    Readonly<{ bodySha256: string; bodyBytes: number }>;
  call: ModelCallEvidence;
}>;

type LmStudioDecisionReadinessEvidence = LmStudioPrefixReadinessEvidence &
  Readonly<{
    decisionBinding: Readonly<{
      requestedStablePrefixSha256: string;
      requestedActionContractSha256: string;
      exactPrefixMatch: boolean;
      use: 'exact_prefill' | 'prepared_runtime_baseline';
    }>;
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
  if (!options.cognitionTransport || String(options.bearer || '').length < 32) {
    throw new Error('LM Studio resident mind requires the authenticated cognition broker');
  }
  const prefixReadiness = new Map<string, Promise<LmStudioPrefixReadinessEvidence>>();
  let runtimeBaseline: Promise<LmStudioPrefixReadinessEvidence> | null = null;

  return {
    id: 'direct-lmstudio-local-json-action',
    async prepare(request, { signal }) {
      assertResidentModel(request);
      runtimeBaseline ??= ensurePrefixReadiness(request, signal);
      return await runtimeBaseline;
    },
    async decide(request, { signal }) {
      assertResidentModel(request);
      const startedAt = now();
      const requestId = `lmstudio-${randomUUID()}`;
      const serialized = createLmStudioLocalJsonActionRequest(request, policy, modelInstanceId);
      const contextAdmission =
        serialized.identity.workingContinuityProtocol ===
          'behold.resident-continuous-transcript.v1' ||
        serialized.identity.workingContinuityProtocol === 'behold.resident-context-epoch.v1'
          ? await admitExactLmStudioContext({
              endpointOrigin: new URL(policy.endpoint).origin,
              modelInstanceId,
              messages: (serialized.body as any).messages,
              maxOutputTokens: policy.settings.maxOutputTokens,
              admittedContextTokens: policy.settings.contextTokens,
              ...(options.createContextClient ? { createClient: options.createContextClient } : {}),
            })
          : undefined;
      const readinessKey = prefixReadinessKey(serialized.identity);
      const exactReadiness = prefixReadiness.get(readinessKey);
      const prepared =
        request.attention?.mode === 'urgent' && !exactReadiness
          ? runtimeBaseline
          : ensurePrefixReadiness(request, signal);
      if (!prepared) {
        throw new Error(
          'LM Studio resident decision has no prepared runtime baseline; refusing inference before setup readiness',
        );
      }
      const readiness = bindDecisionReadiness(await prepared, serialized.identity);
      if (request.perception) {
        admitResidentCameraFrameFreshness({
          frame: request.perception.camera,
          now: now(),
          maxAgeMs: RESIDENT_CAMERA_MAX_AGE_MS,
          maxCaptureDurationMs: RESIDENT_CAMERA_MAX_CAPTURE_DURATION_MS,
        });
      }
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
        lmStudioPrefixReadiness: readiness,
        ...(contextAdmission ? { lmStudioContextAdmission: contextAdmission } : {}),
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
      const localIdentity = inspectLmStudioLocalResponseIdentity(data, policy, modelInstanceId);
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

  function assertResidentModel(request: Parameters<ResidentMind['decide']>[0]) {
    if (request.model !== policy.modelKey) {
      throw new Error(`LM Studio resident mind was not configured for model ${request.model}`);
    }
    if (
      modelInstanceId !== lmStudioResidentInstanceId(policy) &&
      modelInstanceId !== lmStudioResidentInstanceId(policy, request.entityId)
    ) {
      throw new Error('LM Studio resident mind instance differs from its entity-bound policy');
    }
  }

  function ensurePrefixReadiness(
    request: Parameters<ResidentMind['decide']>[0],
    signal: AbortSignal,
  ) {
    const identity = createLmStudioLocalPrefixReadinessRequest(
      request,
      policy,
      modelInstanceId,
    ).identity;
    const key = prefixReadinessKey(identity);
    const existing = prefixReadiness.get(key);
    if (existing) return existing;
    let created: Promise<LmStudioPrefixReadinessEvidence>;
    created = warmResidentPrefix(request, signal).catch((error) => {
      if (prefixReadiness.get(key) === created) prefixReadiness.delete(key);
      throw error;
    });
    prefixReadiness.set(key, created);
    return created;
  }

  async function warmResidentPrefix(
    request: Parameters<ResidentMind['decide']>[0],
    signal: AbortSignal,
  ): Promise<LmStudioPrefixReadinessEvidence> {
    const serialized = createLmStudioLocalPrefixReadinessRequest(request, policy, modelInstanceId);
    const body = serialized.body as Record<string, unknown>;
    const requestBody = JSON.stringify(body);
    const requestId = `lmstudio-prefix-${randomUUID()}`;
    const startedAt = now();
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
            purpose: 'resident_prefix_readiness',
          }),
        },
        body: requestBody,
        signal,
      });
    } catch (error: any) {
      const completedAt = now();
      throw new ResidentMindCallError(
        `LM Studio resident prefix readiness transport error: ${error?.message || String(error)}`,
        {
          protocol: 'behold.model-call.v1',
          adapter: { name: 'lmstudio-local-prefix-readiness', version: 'v1' },
          requestId,
          endpoint,
          startedAt,
          completedAt,
          latencyMs: Math.max(0, completedAt - startedAt),
          request: {
            model: request.model,
            messageCount: 3,
            toolCount: 0,
            toolChoice: null,
            bodySha256: sha256(requestBody),
            bodyBytes: Buffer.byteLength(requestBody),
            messagesSha256: sha256(stableJson(body.messages)),
            toolsSha256: sha256('[]'),
            lmStudioPrefixReadinessTransport: serialized.identity,
          },
          response: {
            terminal: signal.aborted ? 'cancelled' : 'transport_error',
            status: null,
            bodyPreview: null,
          },
        },
      );
    }
    const text = await response.text();
    const completedAt = now();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // The versioned parser below owns malformed output classification.
    }
    if (!response.ok) {
      throw new ResidentMindCallError(`LM Studio resident prefix readiness ${response.status}`, {
        protocol: 'behold.model-call.v1',
        adapter: { name: 'lmstudio-local-prefix-readiness', version: 'v1' },
        requestId,
        endpoint,
        startedAt,
        completedAt,
        latencyMs: Math.max(0, completedAt - startedAt),
        ...admissionEvidence(response),
        request: {
          model: request.model,
          messageCount: 3,
          toolCount: 0,
          toolChoice: null,
          bodySha256: sha256(requestBody),
          bodyBytes: Buffer.byteLength(requestBody),
          messagesSha256: sha256(stableJson(body.messages)),
          toolsSha256: sha256('[]'),
          lmStudioPrefixReadinessTransport: serialized.identity,
          ...(options.recordModelIO ? { body: cloneJson(body) } : {}),
        },
        response: {
          terminal: brokerFailureTerminal(text) as any,
          status: response.status,
          bodyPreview: text.slice(0, 200) || null,
        },
      });
    }
    const call: ModelCallEvidence = {
      protocol: 'behold.model-call.v1',
      adapter: { name: 'lmstudio-local-prefix-readiness', version: 'v1' },
      requestId,
      endpoint,
      startedAt,
      completedAt,
      latencyMs: Math.max(0, completedAt - startedAt),
      ...admissionEvidence(response),
      request: {
        model: request.model,
        messageCount: 3,
        toolCount: 0,
        toolChoice: null,
        bodySha256: sha256(requestBody),
        bodyBytes: Buffer.byteLength(requestBody),
        messagesSha256: sha256(stableJson(body.messages)),
        toolsSha256: sha256('[]'),
        kind: 'provider_request',
        lmStudioPrefixReadinessTransport: serialized.identity,
        ...(options.recordModelIO ? { body: cloneJson(body) } : {}),
      },
      response: {
        terminal: 'success',
        id: stringOrNull(data?.id),
        model: stringOrNull(data?.model),
        provider: null,
        finishReason: stringOrNull(data?.choices?.[0]?.finish_reason),
        nativeFinishReason: stringOrNull(data?.choices?.[0]?.finish_reason),
        usage: lmStudioUsage(data),
        ...(options.recordModelIO ? { raw: cloneJson(data) } : {}),
      },
    };
    try {
      parseLmStudioLocalPrefixReadinessResponse(data, policy, modelInstanceId);
    } catch (error: any) {
      throw new ResidentMindCallError(
        `LM Studio resident prefix readiness returned malformed output: ${error?.message || String(error)}`,
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
    return Object.freeze({
      protocol: 'behold.lmstudio-resident-prefix-readiness.v1' as const,
      authority: 'none' as const,
      responseUsedAsResidentDecision: false as const,
      request: Object.freeze({
        ...serialized.identity,
        bodySha256: sha256(requestBody),
        bodyBytes: Buffer.byteLength(requestBody),
      }),
      call,
    });
  }

  function prefixReadinessKey(
    identity: Pick<
      LmStudioLocalPrefixReadinessRequestIdentity,
      'stablePrefixSha256' | 'actionContractSha256'
    >,
  ) {
    return `${identity.stablePrefixSha256}:${identity.actionContractSha256}`;
  }

  function bindDecisionReadiness(
    readiness: LmStudioPrefixReadinessEvidence,
    identity: Pick<LmStudioLocalRequestIdentity, 'stablePrefixSha256' | 'actionContractSha256'>,
  ): LmStudioDecisionReadinessEvidence {
    const exactPrefixMatch =
      readiness.request.stablePrefixSha256 === identity.stablePrefixSha256 &&
      readiness.request.actionContractSha256 === identity.actionContractSha256;
    return Object.freeze({
      ...readiness,
      decisionBinding: Object.freeze({
        requestedStablePrefixSha256: identity.stablePrefixSha256,
        requestedActionContractSha256: identity.actionContractSha256,
        exactPrefixMatch,
        use: exactPrefixMatch ? ('exact_prefill' as const) : ('prepared_runtime_baseline' as const),
      }),
    });
  }
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
  if (!options.cognitionTransport || String(options.bearer || '').length < 32) {
    throw new Error('LM Studio loom summarizer requires the authenticated cognition broker');
  }

  return async (request, signal = new AbortController().signal) => {
    if (
      modelInstanceId !== lmStudioResidentInstanceId(policy) &&
      modelInstanceId !== lmStudioResidentInstanceId(policy, request.entityId)
    ) {
      throw new Error('LM Studio loom summarizer instance differs from its entity-bound policy');
    }
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
    const localIdentity = inspectLmStudioLocalResponseIdentity(data, policy, modelInstanceId);
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
    if (code === 'resident_purpose_quota_exhausted') return 'quota_exhausted';
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
  const reasoningTokens = nonnegativeNumber(
    plainRecord(usage.completion_tokens_details)
      ? usage.completion_tokens_details.reasoning_tokens
      : null,
  );
  if (reasoningTokens != null) result.reasoning_tokens = reasoningTokens;
  return Object.keys(result).length > 0 ? result : null;
}

function nonnegativeNumber(value: unknown) {
  if (value == null) return null;
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
