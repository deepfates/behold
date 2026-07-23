import { createHash, randomUUID } from 'node:crypto';
import { cognitionClientHeaders, parseCognitionAdmission } from './cognition';
import { directOpenRouterRequestBody } from './direct-wire';
import { ResidentMindCallError, type ModelCallEvidence } from './evidence';
import type { ResidentMind, ResidentMindDecision, ResidentMindRequest } from './interface';
import { residentMindRequestSha256 } from './request-artifact';
import { attributeProviderRequestBody } from './request-attribution';

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const WAIT_TOOL = 'wait_for_event';

export type DirectResidentMindOptions = Readonly<{
  apiKey: string;
  model: string;
  allowedModels?: readonly string[];
  endpoint?: string;
  cognitionTransport?: boolean;
  recordModelIO?: boolean;
  now?: () => number;
  fetch?: typeof fetch;
}>;

/** A replaceable direct OpenAI-compatible mind with no world execution authority. */
export function createDirectResidentMind(options: DirectResidentMindOptions): ResidentMind {
  const now = options.now ?? Date.now;
  const requestFetch = options.fetch ?? fetch;
  const allowedModels = new Set([options.model, ...(options.allowedModels ?? [])]);
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;

  return {
    id: 'direct-openrouter',
    async decide(request, { signal }) {
      if (!allowedModels.has(request.model)) {
        throw new Error(`direct resident mind was not configured for model ${request.model}`);
      }
      const startedAt = now();
      const requestId = `direct-${randomUUID()}`;
      const body = directOpenRouterRequestBody(request) as Record<string, any>;
      const requestBody = JSON.stringify(body);
      const mindRequestSha256 = residentMindRequestSha256(request);
      const callRequest = {
        model: request.model,
        mindRequestSha256,
        ...(options.recordModelIO ? { mindRequest: cloneJson(request) } : {}),
        messageCount: request.conversation.length,
        toolCount: request.actions.length,
        toolChoice: body.tool_choice ?? null,
        bodySha256: sha256(requestBody),
        bodyBytes: Buffer.byteLength(requestBody, 'utf8'),
        byteAttribution: attributeProviderRequestBody(body),
        messagesSha256: sha256(stableJson(body.messages)),
        toolsSha256: sha256(stableJson(body.tools)),
        kind: 'provider_request' as const,
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
            response: { status: null, bodyPreview: null },
          },
        );
      }
      if (!response.ok) {
        const text = await response.text();
        const completedAt = now();
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
          response: { status: response.status, bodyPreview: text.slice(0, 200) || null },
        });
      }

      const data: any = await response.json();
      const completedAt = now();
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
          id: stringOrNull(data?.id),
          model: stringOrNull(data?.model),
          provider: stringOrNull(data?.provider),
          finishReason: stringOrNull(data?.choices?.[0]?.finish_reason),
          nativeFinishReason: stringOrNull(data?.choices?.[0]?.native_finish_reason),
          usage: cloneJson(data?.usage ?? null),
          ...(options.recordModelIO ? { raw: cloneJson(data) } : {}),
        },
      };
      return responseDecision(data, request, call);
    },
  };
}

function responseDecision(
  data: any,
  request: ResidentMindRequest,
  call: ModelCallEvidence,
): ResidentMindDecision {
  const assistant = data?.choices?.[0]?.message || { role: 'assistant', content: '' };
  const utterance = typeof assistant?.content === 'string' ? assistant.content : null;
  const toolCall = assistant?.tool_calls?.[0];
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
    return {};
  }
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
