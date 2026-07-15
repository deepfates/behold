import { createHash, randomUUID } from 'node:crypto';
import type { ResidentMind, ResidentMindDecision, ResidentMindRequest } from './interface';
import { ResidentMindCallError, type ModelCallFailureEvidence } from './evidence';
import {
  cognitionClientHeaders,
  parseCognitionAdmission,
  type CognitionAdmissionEvidence,
} from './cognition';
import {
  AX_RESIDENT_PROGRAM_ID,
  AX_RESIDENT_SIGNATURE,
  AX_RESIDENT_SIGNATURE_SHA256,
  AX_VERSION,
  axResidentProgramIdentity,
  defaultAxResidentProgramArtifact,
  parseAxResidentProgramArtifact,
  type AxResidentProgramArtifact,
} from './ax-program-artifact';
import { residentMindRequestSha256 } from './request-artifact';

export {
  axResidentProgramFromOptimization,
  axResidentProgramIdentity,
  defaultAxResidentProgramArtifact,
  parseAxResidentProgramArtifact,
} from './ax-program-artifact';
export type { AxResidentProgramArtifact, AxResidentProgramIdentity } from './ax-program-artifact';

// Ax publishes a supported CommonJS entry, but its ESM-first declaration file
// trips TypeScript's Node16 interop check in this deliberately CommonJS app.
// Keep that module-format detail contained at the adapter boundary.
const { ai, ax } = require('@ax-llm/ax') as {
  ai: (options: any) => any;
  ax: (signature: string) => {
    forward: (llm: any, input: any, options?: any) => Promise<any>;
    addAssert: (assertion: (output: any) => true | string) => void;
    setId: (id: string) => void;
    setInstruction: (instruction: string) => void;
    setDemos: (demos: readonly any[]) => void;
    getSignature: () => { toString: () => string };
    getUsage: () => unknown[];
    resetUsage: () => void;
    getTraces: () => unknown[];
    getChatLog: () => readonly unknown[];
  };
};

const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1';

export type AxResidentMindOptions = {
  apiKey: string;
  /** Default model. Resident requests may select another explicitly allowed model. */
  model: string;
  allowedModels?: readonly string[];
  apiURL?: string;
  maxRetries?: number;
  recordModelIO?: boolean;
  cognitionTransport?: boolean;
  now?: () => number;
  fetch?: typeof fetch;
  /** Frozen candidate program. Runtime observations and policy context remain inputs. */
  programArtifact?: AxResidentProgramArtifact;
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
  const allowedModels = new Set([options.model, ...(options.allowedModels ?? [])]);
  let activeProviderResponses: unknown[] | null = null;
  let activeAdmissions: CognitionAdmissionEvidence[] | null = null;
  let activeTransportRequest: {
    requestId: string;
    request: ResidentMindRequest;
  } | null = null;
  let activeActionConstraint: { admitted: Set<string>; required: string | null } | null = null;
  const instrumentedFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (options.cognitionTransport && activeTransportRequest) {
      const priority =
        activeTransportRequest.request.attention?.mode === 'urgent'
          ? ('urgent' as const)
          : ('deliberative' as const);
      const triggers = activeTransportRequest.request.attention?.triggers ?? [];
      const urgentTriggerSequence =
        priority === 'urgent' && triggers.length > 0
          ? Math.max(...triggers.map((trigger) => trigger.sequence))
          : null;
      for (const [name, value] of Object.entries(
        cognitionClientHeaders({
          requestId: activeTransportRequest.requestId,
          priority,
          purpose: 'resident_decision',
          urgentTriggerSequence,
        }),
      )) {
        headers.set(name, value);
      }
    }
    const response = await baseFetch(input, { ...init, headers });
    const admission = parseCognitionAdmission(response.headers);
    if (admission && activeAdmissions) activeAdmissions.push(admission);
    if (activeProviderResponses) {
      try {
        activeProviderResponses.push(await response.clone().json());
      } catch {}
    }
    return response;
  };
  const llms = new Map<string, any>();
  const llmFor = (model: string) => {
    if (!allowedModels.has(model)) {
      throw new Error(`Ax resident mind was not configured for model ${model}`);
    }
    let llm = llms.get(model);
    if (!llm) {
      llm = ai({
        name: 'openai',
        apiKey: options.apiKey,
        apiURL,
        config: { model },
        options: { stream: false, fetch: instrumentedFetch },
      });
      llms.set(model, llm);
    }
    return llm;
  };
  const programArtifact = parseAxResidentProgramArtifact(
    options.programArtifact ?? defaultAxResidentProgramArtifact(),
  );
  const programIdentity = axResidentProgramIdentity(programArtifact);
  const program = ax(AX_RESIDENT_SIGNATURE);
  program.setId(AX_RESIDENT_PROGRAM_ID);
  const signatureSha256 = sha256(program.getSignature().toString());
  if (
    signatureSha256 !== AX_RESIDENT_SIGNATURE_SHA256 ||
    signatureSha256 !== programArtifact.signatureSha256
  ) {
    throw new Error('Ax canonical resident signature differs from the admitted artifact');
  }
  program.setInstruction(programArtifact.instruction);
  if (programArtifact.demos.length > 0) program.setDemos(programArtifact.demos);
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
      const mindRequestSha256 = residentMindRequestSha256(request);
      const input = mindInput(request);
      const inputJson = stableJson(input);
      const traceOffset = program.getTraces().length;
      const chatOffset = program.getChatLog().length;
      const providerResponses: any[] = [];
      const admissions: CognitionAdmissionEvidence[] = [];
      activeProviderResponses = providerResponses;
      activeAdmissions = admissions;
      activeTransportRequest = { requestId, request };
      activeActionConstraint = {
        admitted: new Set(request.actions.map((action) => action.name)),
        required: request.requiredAction,
      };
      program.resetUsage();
      try {
        const output: any = await program.forward(llmFor(request.model), input as any, {
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
          ...(admissions.length ? { admissions: cloneJson(admissions) } : {}),
          adapter: { name: 'ax', version: AX_VERSION },
          program: programIdentity,
          request: {
            model: request.model,
            mindRequestSha256,
            ...(options.recordModelIO ? { mindRequest: cloneJson(request) } : {}),
            messageCount: request.conversation.length,
            toolCount: request.actions.length,
            toolChoice: request.requiredAction,
            bodySha256: sha256(inputJson),
            bodyBytes: Buffer.byteLength(inputJson, 'utf8'),
            messagesSha256: sha256(stableJson(request.conversation)),
            toolsSha256: sha256(stableJson(wireTools(request.actions))),
            kind: 'mind_input' as const,
            ...(options.recordModelIO ? { body: cloneJson(input) } : {}),
          },
          response: {
            id: stringOrNull(providerResponse?.id),
            model: stringOrNull(providerResponse?.model) || request.model,
            provider: stringOrNull(providerResponse?.provider) || 'Ax/OpenAI-compatible',
            finishReason:
              stringOrNull(providerResponse?.choices?.[0]?.finish_reason) || 'structured_output',
            nativeFinishReason: stringOrNull(providerResponse?.choices?.[0]?.native_finish_reason),
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
        const completedAt = now();
        const call: ModelCallFailureEvidence = {
          protocol: 'behold.model-call.v1',
          requestId,
          endpoint: safeEndpoint(apiURL),
          startedAt,
          completedAt,
          latencyMs: Math.max(0, completedAt - startedAt),
          ...(admissions.length ? { admissions: cloneJson(admissions) } : {}),
          adapter: { name: 'ax', version: AX_VERSION },
          program: programIdentity,
          request: {
            model: request.model,
            mindRequestSha256,
            ...(options.recordModelIO ? { mindRequest: cloneJson(request) } : {}),
            messageCount: request.conversation.length,
            toolCount: request.actions.length,
            toolChoice: request.requiredAction,
            bodySha256: sha256(inputJson),
            bodyBytes: Buffer.byteLength(inputJson, 'utf8'),
            messagesSha256: sha256(stableJson(request.conversation)),
            toolsSha256: sha256(stableJson(wireTools(request.actions))),
            kind: 'mind_input',
            ...(options.recordModelIO ? { body: cloneJson(input) } : {}),
          },
          response: {
            status: statusOrNull(error),
            bodyPreview: errorPreview(error),
            ...(options.recordModelIO
              ? {
                  raw: cloneJson({
                    traces: program.getTraces().slice(traceOffset),
                    chatLog: program.getChatLog().slice(chatOffset),
                    providerResponses,
                  }),
                }
              : {}),
          },
        };
        throw new ResidentMindCallError(
          `Ax resident decision failed: ${error?.message || String(error)}`,
          call,
        );
      } finally {
        activeProviderResponses = null;
        activeAdmissions = null;
        activeTransportRequest = null;
        activeActionConstraint = null;
      }
    },
  };
}

function mindInput(request: ResidentMindRequest) {
  return {
    policyGuidance: policyGuidance(request),
    profiles: {
      policy: request.policyProfile ?? 'legacy-unspecified',
      actions: request.actionProfile ?? 'legacy-unspecified',
      safety: request.safetyProfile ?? 'legacy-unspecified',
    },
    livedContext: livedContext(request),
    currentObservation: request.observation,
    ...(request.attention ? { attention: request.attention } : {}),
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

function policyGuidance(request: ResidentMindRequest) {
  const first = request.conversation[0] as any;
  return first?.role === 'system' && typeof first?.content === 'string'
    ? first.content
    : 'Use only the bounded context and admitted affordances.';
}

function livedContext(request: ResidentMindRequest) {
  const contextMessages = request.conversation.filter(
    (message: any, index: number) => index !== 0 || message?.role !== 'system',
  );
  const last = contextMessages.at(-1) as any;
  if (
    last?.role === 'user' &&
    /^(New world experience|Current world experience|World after )/.test(
      String(last?.content || ''),
    )
  ) {
    return { messages: contextMessages.slice(0, -1) };
  }
  return { messages: contextMessages };
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
