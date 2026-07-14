import { createHash, randomUUID } from 'node:crypto';
import type { ResidentMind, ResidentMindDecision, ResidentMindRequest } from './interface';
import { ResidentMindCallError, type ModelCallFailureEvidence } from './evidence';

// Ax publishes a supported CommonJS entry, but its ESM-first declaration file
// trips TypeScript's Node16 interop check in this deliberately CommonJS app.
// Keep that module-format detail contained at the adapter boundary.
const { ai, ax } = require('@ax-llm/ax') as {
  ai: (options: any) => any;
  ax: (signature: string) => {
    forward: (llm: any, input: any, options?: any) => Promise<any>;
    addAssert: (assertion: (output: any) => true | string) => void;
    setInstruction: (instruction: string) => void;
    getUsage: () => unknown[];
    resetUsage: () => void;
    getTraces: () => unknown[];
    getChatLog: () => readonly unknown[];
  };
};

const AX_VERSION = '23.0.0';
const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1';

export type AxResidentMindOptions = {
  apiKey: string;
  model: string;
  apiURL?: string;
  maxRetries?: number;
  recordModelIO?: boolean;
  now?: () => number;
  fetch?: typeof fetch;
};

/**
 * DSPy-style structured decision adapter. It deliberately receives no
 * executable functions: Ax proposes a typed action and Behold validates and
 * executes it through the resident lifecycle.
 */
export function createAxResidentMind(options: AxResidentMindOptions): ResidentMind {
  const now = options.now || Date.now;
  const apiURL = options.apiURL || DEFAULT_OPENROUTER_URL;
  const baseFetch = options.fetch || globalThis.fetch;
  let activeProviderResponses: unknown[] | null = null;
  let activeActionConstraint: { admitted: Set<string>; required: string | null } | null = null;
  const instrumentedFetch: typeof fetch = async (input, init) => {
    const response = await baseFetch(input, init);
    if (activeProviderResponses) {
      try {
        activeProviderResponses.push(await response.clone().json());
      } catch {}
    }
    return response;
  };
  const llm = ai({
    name: 'openai',
    apiKey: options.apiKey,
    apiURL,
    config: { model: options.model },
    options: { stream: false, fetch: instrumentedFetch },
  });
  const program = ax(`
    "Choose exactly one next action for a persistent embodied resident from bounded lived evidence. Propose only; never claim the action happened and never execute tools."
    livedContext:json,
    currentObservation:json,
    admittedActionNames:string[],
    admittedActions:json,
    requiredAction?:string
    ->
    disposition:class "act, wait, no_action",
    actionName?:string,
    actionInput?:json,
    utterance:string,
    waitReason?:string
  `);
  program.addAssert((output: any) => {
    const constraint = activeActionConstraint;
    if (!constraint) return true;
    const disposition = String(output?.disposition || '');
    const name = disposition === 'wait' ? 'wait_for_event' : String(output?.actionName || '');
    if (constraint.required && name !== constraint.required) {
      return `The controller requires the exact action ${constraint.required}.`;
    }
    if (disposition === 'no_action') return true;
    if (!constraint.admitted.has(name)) {
      return `actionName must exactly equal one of: ${[...constraint.admitted].join(', ')}`;
    }
    return true;
  });

  return {
    id: `ax@${AX_VERSION}`,
    async decide(request, { signal }) {
      const startedAt = now();
      const requestId = `ax-${randomUUID()}`;
      const input = mindInput(request);
      const inputJson = stableJson(input);
      const traceOffset = program.getTraces().length;
      const chatOffset = program.getChatLog().length;
      const providerResponses: any[] = [];
      activeProviderResponses = providerResponses;
      activeActionConstraint = {
        admitted: new Set(request.actions.map((action) => action.name)),
        required: request.requiredAction,
      };
      program.setInstruction(residentInstruction(request));
      program.resetUsage();
      try {
        const output: any = await program.forward(llm, input as any, {
          abortSignal: signal,
          stream: false,
          maxRetries: Math.max(0, options.maxRetries ?? 1),
          modelConfig: { temperature: 0.2 },
          excludeContentFromTrace: !options.recordModelIO,
        });
        const completedAt = now();
        const usage = cloneJson(program.getUsage());
        const traces = program.getTraces().slice(traceOffset);
        const chatLog = program.getChatLog().slice(chatOffset);
        const providerResponse = providerResponses.at(-1);
        const call = {
          protocol: 'behold.model-call.v1' as const,
          requestId,
          endpoint: safeEndpoint(apiURL),
          startedAt,
          completedAt,
          latencyMs: Math.max(0, completedAt - startedAt),
          adapter: { name: 'ax', version: AX_VERSION },
          request: {
            model: options.model,
            messageCount: request.conversation.length,
            toolCount: request.actions.length,
            toolChoice: request.requiredAction,
            bodySha256: sha256(inputJson),
            messagesSha256: sha256(stableJson(request.conversation)),
            toolsSha256: sha256(stableJson(wireTools(request.actions))),
            kind: 'mind_input' as const,
            ...(options.recordModelIO ? { body: cloneJson(input) } : {}),
          },
          response: {
            id: stringOrNull(providerResponse?.id),
            model: stringOrNull(providerResponse?.model) || options.model,
            provider: stringOrNull(providerResponse?.provider) || 'Ax/OpenAI-compatible',
            finishReason:
              stringOrNull(providerResponse?.choices?.[0]?.finish_reason) || 'structured_output',
            nativeFinishReason: stringOrNull(
              providerResponse?.choices?.[0]?.native_finish_reason,
            ),
            usage: {
              ax: usage,
              provider: aggregateProviderUsage(providerResponses),
            },
            ...(options.recordModelIO
              ? {
                  raw: cloneJson({
                    output,
                    traces,
                    chatLog,
                    providerResponses,
                  }),
                }
              : {}),
          },
        };
        return toDecision(output, call);
      } catch (error: any) {
        if (signal.aborted) throw error;
        const completedAt = now();
        const call: ModelCallFailureEvidence = {
          protocol: 'behold.model-call.v1',
          requestId,
          endpoint: safeEndpoint(apiURL),
          startedAt,
          completedAt,
          latencyMs: Math.max(0, completedAt - startedAt),
          adapter: { name: 'ax', version: AX_VERSION },
          request: {
            model: options.model,
            messageCount: request.conversation.length,
            toolCount: request.actions.length,
            toolChoice: request.requiredAction,
            bodySha256: sha256(inputJson),
            messagesSha256: sha256(stableJson(request.conversation)),
            toolsSha256: sha256(stableJson(wireTools(request.actions))),
            kind: 'mind_input',
            ...(options.recordModelIO ? { body: cloneJson(input) } : {}),
          },
          response: { status: statusOrNull(error), bodyPreview: errorPreview(error) },
        };
        throw new ResidentMindCallError(
          `Ax resident decision failed: ${error?.message || String(error)}`,
          call,
        );
      } finally {
        activeProviderResponses = null;
        activeActionConstraint = null;
      }
    },
  };
}

function mindInput(request: ResidentMindRequest) {
  return {
    livedContext: livedContext(request),
    currentObservation: request.observation,
    admittedActionNames: request.actions.map((action) => action.name),
    admittedActions: request.actions,
    ...(request.requiredAction ? { requiredAction: request.requiredAction } : {}),
  };
}

function wireTools(actions: ResidentMindRequest['actions']) {
  return actions.map((action) => ({
    type: 'function',
    function: {
      name: action.name,
      ...(action.description == null ? {} : { description: action.description }),
      parameters: action.inputSchema,
    },
  }));
}

function residentInstruction(request: ResidentMindRequest) {
  const system = request.conversation.find(
    (message: any) => message?.role === 'system' && typeof message?.content === 'string',
  ) as any;
  return [
    'Choose exactly one next action for this persistent embodied resident from bounded lived evidence.',
    'Propose only. Never execute a tool and never claim an action happened before its later world consequence is observed.',
    'actionName must exactly equal one admittedActionNames value. Darkness alone is not a reason to wait when a safe useful action is available.',
    system?.content || '',
  ]
    .filter(Boolean)
    .join('\n');
}

function livedContext(request: ResidentMindRequest) {
  const withoutSystem = request.conversation.filter((message: any) => message?.role !== 'system');
  const last = withoutSystem.at(-1) as any;
  if (
    last?.role === 'user' &&
    /^(New world experience|Current world experience|World after )/.test(String(last?.content || ''))
  ) {
    return { messages: withoutSystem.slice(0, -1) };
  }
  return { messages: withoutSystem };
}

function toDecision(output: any, call: ResidentMindDecision['call']): ResidentMindDecision {
  const disposition = String(output?.disposition || '') as ResidentMindDecision['disposition'];
  const utterance = typeof output?.utterance === 'string' ? output.utterance : null;
  if (disposition === 'no_action') {
    return {
      protocol: 'behold.mind-decision.v1',
      disposition,
      utterance,
      action: null,
      call,
    };
  }
  if (disposition === 'wait') {
    return {
      protocol: 'behold.mind-decision.v1',
      disposition,
      utterance,
      action: {
        name: 'wait_for_event',
        input: { reason: String(output?.waitReason || utterance || 'waiting for a world event') },
      },
      call,
    };
  }
  return {
    protocol: 'behold.mind-decision.v1',
    disposition,
    utterance,
    action: {
      name: String(output?.actionName || ''),
      input: jsonValue(output?.actionInput),
    },
    call,
  };
}

function jsonValue(value: unknown) {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
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

function cloneJson(value: unknown) {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function safeEndpoint(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split('?')[0];
  }
}

function statusOrNull(error: any) {
  const status = Number(error?.status ?? error?.cause?.status);
  return Number.isFinite(status) ? status : null;
}

function errorPreview(error: any) {
  const message = String(error?.message || error || '').trim();
  return message ? message.slice(0, 200) : null;
}

function stringOrNull(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function aggregateProviderUsage(responses: any[]) {
  const usages = responses.map((response) => response?.usage).filter(Boolean);
  if (usages.length === 0) return null;
  const sum = (field: string) =>
    usages.reduce((total, usage) => total + (Number(usage?.[field]) || 0), 0);
  return {
    prompt_tokens: sum('prompt_tokens'),
    completion_tokens: sum('completion_tokens'),
    total_tokens: sum('total_tokens'),
    cost: sum('cost'),
    attempts: usages.length,
  };
}
