import { createHash, randomUUID } from 'node:crypto';
import { cognitionClientHeaders, parseCognitionAdmission } from './cognition';
import { directOpenRouterRequestBody } from './direct-wire';
import {
  assertNativeToolResidentSessionEnvelope,
  parseNativeToolResidentDecision,
} from './direct-native-tools';
import { ResidentMindCallError, type ModelCallEvidence } from './evidence';
import type { ResidentMind, ResidentMindDecision, ResidentMindRequest } from './interface';
import {
  assertOpenRouterRouteRequest,
  inspectOpenRouterResponseIdentity,
  openRouterRoutePolicy,
  type OpenRouterRoutePolicy,
} from './openrouter-route';
import { residentMindRequestSha256 } from './request-artifact';
import { attributeProviderRequestBody } from './request-attribution';
import {
  createStrictLocalResidentSessionEnvelope,
  parseStrictLocalJsonActionDecisionContent,
} from './ollama-json-action';

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const WAIT_TOOL = 'wait_for_event';

export type DirectResidentMindOptions = Readonly<{
  apiKey: string;
  model: string;
  allowedModels?: readonly string[];
  endpoint?: string;
  cognitionTransport?: boolean;
  recordModelIO?: boolean;
  routePolicy?: OpenRouterRoutePolicy;
  now?: () => number;
  fetch?: typeof fetch;
}>;

/** A replaceable direct OpenAI-compatible mind with no world execution authority. */
export function createDirectResidentMind(options: DirectResidentMindOptions): ResidentMind {
  const now = options.now ?? Date.now;
  const requestFetch = options.fetch ?? fetch;
  const allowedModels = new Set([options.model, ...(options.allowedModels ?? [])]);
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const routePolicy = options.routePolicy ? openRouterRoutePolicy(options.routePolicy) : null;

  return {
    id: 'direct-openrouter',
    async decide(request, { signal }) {
      if (!allowedModels.has(request.model)) {
        throw new Error(`direct resident mind was not configured for model ${request.model}`);
      }
      const startedAt = now();
      const requestId = `direct-${randomUUID()}`;
      const body = directOpenRouterRequestBody(request, routePolicy) as Record<string, any>;
      const nativeRoutePolicy =
        routePolicy?.protocol === 'behold.openrouter-route-policy.v3' ? routePolicy : null;
      const nativeToolSession =
        request.policyProfile === 'legible-resident-v1' && nativeRoutePolicy
          ? assertNativeToolResidentSessionEnvelope(body.messages, body.tools, body.tool_choice)
          : null;
      const residentSession =
        (request.policyProfile === 'legible-resident-v1' ||
          request.policyProfile === 'resident-v4' ||
          request.policyProfile === 'resident-v3' ||
          request.policyProfile === 'resident-v2') &&
        !nativeToolSession
          ? createStrictLocalResidentSessionEnvelope(request)
          : null;
      const requestBody = JSON.stringify(body);
      if (routePolicy?.protocol === 'behold.openrouter-route-policy.v5') {
        if (request.policyProfile !== 'resident-v4' && request.policyProfile !== 'resident-v3') {
          throw new Error(
            'context-bound private OpenRouter route v5 requires resident-v4 or resident-v3',
          );
        }
        assertOpenRouterRouteRequest(
          body,
          request.model,
          routePolicy,
          request.entityId,
          request.policyProfile,
        );
      }
      const mindRequestSha256 = residentMindRequestSha256(request);
      const callRequest = {
        model: request.model,
        mindRequestSha256,
        ...(options.recordModelIO ? { mindRequest: cloneJson(request) } : {}),
        messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
        toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
        toolChoice: body.tool_choice ?? null,
        bodySha256: sha256(requestBody),
        bodyBytes: Buffer.byteLength(requestBody, 'utf8'),
        byteAttribution: attributeProviderRequestBody(body),
        messagesSha256: sha256(stableJson(body.messages)),
        toolsSha256: sha256(stableJson(body.tools ?? [])),
        ...(residentSession
          ? {
              formatSha256: sha256(stableJson(body.response_format)),
              providerResidentSession: {
                protocol: 'behold.openrouter-resident-session.v1',
                schemaProtocol: residentSession.schemaProtocol,
                schemaSha256: residentSession.schemaSha256,
                messageLayoutProtocol: residentSession.messageLayoutProtocol,
                workingContinuityProtocol: residentSession.workingContinuityProtocol,
                actionContractSha256: residentSession.actionContractSha256,
                responseSchemaSha256: residentSession.responseSchemaSha256,
                stablePrefixSha256: residentSession.stablePrefixSha256,
                ...(routePolicy?.protocol === 'behold.openrouter-route-policy.v4' ||
                routePolicy?.protocol === 'behold.openrouter-route-policy.v5'
                  ? { reasoningEnabled: false }
                  : { reasoningEffort: 'minimal' }),
                reasoningExcluded: true,
              },
            }
          : {}),
        ...(nativeToolSession
          ? {
              providerResidentSession: {
                protocol: nativeToolSession.protocol,
                messageLayoutProtocol: nativeToolSession.messageLayoutProtocol,
                workingContinuityProtocol: nativeToolSession.workingContinuityProtocol,
                actionContractSha256: nativeToolSession.actionContractSha256,
                toolsSha256: nativeToolSession.toolsSha256,
                requestPrefixSha256: nativeToolSession.requestPrefixSha256,
                reasoningEffort: nativeRoutePolicy!.reasoningEffort,
                reasoningExcluded: true,
              },
            }
          : {}),
        kind: 'provider_request' as const,
        ...(routePolicy ? { routePolicy } : {}),
        ...(options.recordModelIO ? { body: JSON.parse(requestBody) } : {}),
      };
      const priority = request.attention?.mode === 'urgent' ? 'urgent' : 'deliberative';
      const urgentTriggers = (request.attention?.triggers ?? []).map((trigger) => trigger.sequence);
      const urgentTriggerSequence =
        priority === 'urgent' && urgentTriggers.length > 0 ? Math.max(...urgentTriggers) : null;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
        ...(options.cognitionTransport
          ? cognitionClientHeaders({
              requestId,
              priority,
              purpose: 'resident_decision',
              urgentTriggerSequence,
            })
          : {}),
      };
      if (process.env.OPENROUTER_REFERER) {
        headers['HTTP-Referer'] = String(process.env.OPENROUTER_REFERER);
      }
      if (process.env.OPENROUTER_TITLE) {
        headers['X-Title'] = String(process.env.OPENROUTER_TITLE);
      }

      let response: Response;
      try {
        response = await requestFetch(endpoint, {
          method: 'POST',
          headers,
          body: requestBody,
          signal,
        });
      } catch (error: any) {
        const completedAt = now();
        const terminal = signal.aborted ? 'cancelled' : 'transport_error';
        throw new ResidentMindCallError(
          `direct resident decision network error: ${error?.message || String(error)}`,
          {
            protocol: 'behold.model-call.v1',
            adapter: { name: 'direct-openrouter' },
            requestId,
            endpoint: safeEndpoint(endpoint),
            startedAt,
            completedAt,
            latencyMs: Math.max(0, completedAt - startedAt),
            request: callRequest,
            response: { terminal, status: null, bodyPreview: null },
          },
        );
      }
      if (!response.ok) {
        const text = await response.text();
        const completedAt = now();
        const terminal = brokerFailureTerminal(text);
        throw new ResidentMindCallError(`direct resident decision ${response.status}`, {
          protocol: 'behold.model-call.v1',
          adapter: { name: 'direct-openrouter' },
          requestId,
          endpoint: safeEndpoint(endpoint),
          startedAt,
          completedAt,
          latencyMs: Math.max(0, completedAt - startedAt),
          ...admissionEvidence(response),
          request: callRequest,
          response: {
            terminal,
            status: response.status,
            bodyPreview: text.slice(0, 200) || null,
          },
        });
      }

      let text = '';
      let data: any;
      const responseValue: any = response;
      try {
        if (response instanceof Response) {
          text = await response.text();
          data = JSON.parse(text);
        } else {
          data = await responseValue.json();
          text = JSON.stringify(data);
        }
      } catch {
        const completedAt = now();
        throw new ResidentMindCallError('direct resident decision returned malformed JSON', {
          protocol: 'behold.model-call.v1',
          adapter: { name: 'direct-openrouter' },
          requestId,
          endpoint: safeEndpoint(endpoint),
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
      const routeIdentity = routePolicy
        ? inspectOpenRouterResponseIdentity(data, request.model, routePolicy)
        : null;
      if (routeIdentity && !routeIdentity.ok) {
        throw new ResidentMindCallError(
          'direct resident decision returned unadmitted route identity',
          {
            protocol: 'behold.model-call.v1',
            adapter: { name: 'direct-openrouter' },
            requestId,
            endpoint: safeEndpoint(endpoint),
            startedAt,
            completedAt,
            latencyMs: Math.max(0, completedAt - startedAt),
            ...admissionEvidence(response),
            request: callRequest,
            response: {
              terminal: 'route_identity_mismatch',
              status: response.status,
              bodyPreview: text.slice(0, 200) || null,
              routeIdentity,
            },
          },
        );
      }
      const call: ModelCallEvidence = {
        protocol: 'behold.model-call.v1',
        adapter: { name: 'direct-openrouter' },
        requestId,
        endpoint: safeEndpoint(endpoint),
        startedAt,
        completedAt,
        latencyMs: Math.max(0, completedAt - startedAt),
        ...admissionEvidence(response),
        request: callRequest,
        response: {
          terminal: 'success',
          id: stringOrNull(data?.id),
          model: stringOrNull(data?.model),
          provider: stringOrNull(data?.provider),
          finishReason: stringOrNull(data?.choices?.[0]?.finish_reason),
          nativeFinishReason: stringOrNull(data?.choices?.[0]?.native_finish_reason),
          usage: cloneJson(data?.usage ?? null),
          ...(options.recordModelIO ? { raw: cloneJson(data) } : {}),
        },
      };
      try {
        if (nativeToolSession) {
          return parseNativeToolResidentDecision(data, request, call);
        }
        if (residentSession) {
          const message = data?.choices?.[0]?.message;
          if (!message || typeof message.content !== 'string') {
            throw new Error('provider resident-session response contained no assistant content');
          }
          if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
            throw new Error('provider resident-session response used forbidden native tool calls');
          }
          return parseStrictLocalJsonActionDecisionContent(
            message.content,
            message,
            request,
            call,
            request.policyProfile === 'resident-v4'
              ? 4
              : request.policyProfile === 'resident-v3'
                ? 3
                : request.policyProfile === 'resident-v2'
                  ? 1
                  : 2,
          );
        }
        return responseDecision(data, request, call);
      } catch (error: any) {
        throw new ResidentMindCallError(
          `direct resident decision returned malformed output: ${error?.message || String(error)}`,
          {
            ...call,
            response: {
              terminal: 'malformed_output',
              status: response.status,
              bodyPreview: text.slice(0, 200) || null,
            },
          },
        );
      }
    },
  };
}

export function responseDecision(
  data: any,
  request: ResidentMindRequest,
  call: ModelCallEvidence,
): ResidentMindDecision {
  if (!Array.isArray(data?.choices) || data.choices.length < 1) {
    throw new Error('provider response contained no assistant choice');
  }
  const assistant = data.choices[0]?.message;
  if (!assistant || typeof assistant !== 'object' || Array.isArray(assistant)) {
    throw new Error('provider response contained no assistant message');
  }
  if (assistant.content != null && typeof assistant.content !== 'string') {
    throw new Error('assistant content was not text or null');
  }
  if (assistant.tool_calls != null && !Array.isArray(assistant.tool_calls)) {
    throw new Error('assistant tool_calls was not an array');
  }
  if (assistant.tool_calls?.length > 1) {
    throw new Error('resident decision contained multiple tool calls');
  }
  const utterance = typeof assistant?.content === 'string' ? assistant.content : null;
  const toolCall = assistant?.tool_calls?.[0];
  if (toolCall && !toolCall?.function?.name) {
    throw new Error('assistant tool call contained no function name');
  }
  if (toolCall?.function?.name) {
    const singleToolAssistant = { ...assistant, tool_calls: [toolCall] };
    const name = String(toolCall.function.name);
    return {
      protocol: 'behold.mind-decision.v1',
      disposition: name === WAIT_TOOL ? 'wait' : 'act',
      utterance,
      action: {
        name,
        input: parseToolArguments(toolCall.function.arguments),
        callId: String(toolCall.id || `${name}-${randomUUID()}`),
      },
      adapterRecord: singleToolAssistant,
      call,
    };
  }

  if (utterance?.trim() && request.actions.some((action) => action.name === 'chat')) {
    return {
      protocol: 'behold.mind-decision.v1',
      disposition: 'act',
      utterance,
      action: { name: 'chat', input: { text: utterance.slice(0, 200) }, callId: null },
      adapterRecord: assistant,
      call,
    };
  }
  return {
    protocol: 'behold.mind-decision.v1',
    disposition: 'no_action',
    utterance,
    action: null,
    adapterRecord: assistant,
    call,
  };
}

function admissionEvidence(response: Response) {
  if (!response?.headers || typeof response.headers.get !== 'function') return {};
  const admission = parseCognitionAdmission(response.headers);
  return admission ? { admissions: [admission] } : {};
}

function parseToolArguments(value: unknown) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error('tool arguments were not valid JSON');
  }
}

function brokerFailureTerminal(text: string) {
  try {
    const code = String(JSON.parse(text)?.error?.code || '');
    if (code === 'resident_purpose_quota_exhausted') return 'quota_exhausted' as const;
    if (code === 'route_identity_mismatch') return 'route_identity_mismatch' as const;
    if (/admission|quota|queue|request_route_policy/.test(code)) {
      return 'admission_rejected' as const;
    }
  } catch {
    // Fall through to an ordinary provider error.
  }
  return 'provider_error' as const;
}

function stringOrNull(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function safeEndpoint(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split('?')[0];
  }
}

function cloneJson(value: unknown): any {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
