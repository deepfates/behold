import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Bot } from 'mineflayer';
import { buildInterpreter } from '../src/agent/interpreter';
import { openEntityLoom } from '../src/entity/loom';
import { createPlaceMemory } from '../src/entity/places';
import { createProjectMemory } from '../src/entity/projects';
import { createAxResidentMind } from '../src/mind/ax';
import type { ResidentMind, ResidentMindRequest } from '../src/mind/interface';
import { startLLMPolicy } from '../src/policy/llm';

type CandidateAdapter = 'ax' | 'direct';
type Args = {
  journal: string;
  out?: string;
  modelTurn?: number;
  candidate: CandidateAdapter;
  attentionPair: boolean;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  const records = readJsonl(args.journal);
  const baselineRecord = records.find(
    (record) =>
      record?.type === 'model_turn' &&
      (args.modelTurn == null || Number(record.sequence) === args.modelTurn),
  );
  if (!baselineRecord?.data?.call || !baselineRecord?.data?.observation) {
    const selection = args.modelTurn == null ? '' : ` at journal sequence ${args.modelTurn}`;
    throw new Error(`No model_turn with call evidence${selection} in ${args.journal}`);
  }
  const entityId = String(
    baselineRecord.agent || baselineRecord.data.observation?.self?.identity || '',
  );
  if (!entityId) throw new Error('Could not identify the resident from the journal');
  const matchingTurn = records.find(
    (record) =>
      record?.type === 'entity_turn' &&
      record?.data?.action?.id === baselineRecord.data?.intent?.id,
  );
  if (!matchingTurn?.data?.sequence) {
    throw new Error('The journal does not contain the completed entity turn for its model choice');
  }

  const loom = await openEntityLoom(entityId);
  let policy: ReturnType<typeof startLLMPolicy> | null = null;
  try {
    const priorTurnCount = Number(matchingTurn.data.sequence) - 1;
    const history = loom.turns().slice(0, priorTurnCount);
    if (history.length !== priorTurnCount) {
      throw new Error(`Expected ${priorTurnCount} prior turns, found ${history.length}`);
    }
    const capturedObservation = baselineRecord.data.observation;
    const replay = observationForCurrentContract(capturedObservation);
    const observation = replay.observation;
    const projects = createProjectMemory(entityId, history);
    const places = createPlaceMemory(entityId, history);
    // Tool construction is side-effect free; no CommandSpec.run function is
    // exposed to either model or invoked by this differential.
    const interpreter = buildInterpreter({} as Bot, {
      projects,
      places: () => places.snapshot(),
      observe: () => replayObservationAtCursor(observation),
    });
    const actions = interpreter.list('inhabitant').map((spec) => ({
      type: 'function' as const,
      function: {
        name: spec.name,
        description: spec.description || '',
        parameters: spec.parameters || { type: 'object', properties: {} },
      },
    }));
    const model = String(baselineRecord.data.model);
    if (args.attentionPair) {
      const comparison = await runAttentionPair({
        apiKey,
        model,
        entityId,
        observation,
        history,
        actions,
        foldCacheFile: loom.foldFile,
        source: {
          journal: path.resolve(args.journal),
          modelTurnJournalSequence: Number(baselineRecord.sequence),
          priorTurnCount,
          observationSha256: sha256(stableJson(observation)),
          capturedObservationSha256: sha256(stableJson(capturedObservation)),
          observationMigrations: replay.migrations,
        },
      });
      await writeOutput(comparison, args.out);
      if (!comparison.matched.all || !comparison.arms.every((arm: any) => arm.call.ok)) {
        process.exitCode = 1;
      }
      return;
    }
    const candidateMind =
      args.candidate === 'ax'
        ? createAxResidentMind({
            apiKey,
            model,
            apiURL: openAICompatibleBaseURL(process.env.OPENROUTER_BASE_URL),
          })
        : null;
    let candidate: any = null;
    let candidateError: any = null;
    const attempted: any[] = [];
    policy = startLLMPolicy(
      {
        entityId,
        observe: (sinceSequence) => replayObservationAtCursor(observation, sinceSequence),
        actions,
        // This proof ends at proposal admission. It cannot mutate Minecraft.
        attempt: (intent) => {
          attempted.push(intent);
          return false;
        },
      },
      {
        apiKey,
        model,
        ...(candidateMind ? { mind: candidateMind } : {}),
        history,
        foldCacheFile: loom.foldFile,
        maxTurnSteps: 1,
        acceptEngineEvent: () => true,
        onModelTurn: (turn) => {
          candidate = turn;
        },
        onModelError: (error) => {
          candidateError = error;
        },
      },
    );
    await policy.tick();
    await policy.stop();

    const baseline = baselineRecord.data;
    const candidateCall = candidate?.call || candidateError?.call || null;
    const comparison = {
      protocol: 'behold.mind-differential.v1',
      generatedAt: new Date().toISOString(),
      source: {
        journal: path.resolve(args.journal),
        modelTurnJournalSequence: Number(baselineRecord.sequence),
        entityId,
        priorTurnCount,
        observationSha256: sha256(stableJson(observation)),
        capturedObservationSha256: sha256(stableJson(capturedObservation)),
        observationMigrations: replay.migrations,
      },
      safety: {
        worldMutationEnabled: false,
        proposalAttempts: attempted.length,
        proposalAttemptAccepted: false,
      },
      baseline: {
        adapter: baseline.call.adapter?.name || 'direct-openrouter',
        model,
        intent: baseline.intent,
        utterance: baseline.assistant?.content ?? null,
        call: baseline.call,
      },
      candidate: candidate
        ? {
            adapter: candidateMind?.id || candidate.call?.adapter?.name || 'direct-openrouter',
            model,
            intent: candidate.intent,
            utterance: candidate.assistant?.content ?? null,
            call: candidate.call,
          }
        : null,
      candidateError,
      matchedEpisode: candidateCall
        ? {
            model: model === candidateCall.request.model,
            observation: replay.migrations.length === 0,
            actionSet: baseline.call.request.toolsSha256 === candidateCall.request.toolsSha256,
            contextProjection: {
              messageCount:
                baseline.call.request.messageCount === candidateCall.request.messageCount,
              messagesSha256:
                baseline.call.request.messagesSha256 === candidateCall.request.messagesSha256,
              note: 'Context may differ when the disposable loom fold advanced after the captured baseline; source turns remain the same.',
            },
          }
        : null,
      sameProposedAction:
        candidate?.intent?.tool === baseline.intent?.tool &&
        stableJson(candidate?.intent?.input ?? null) === stableJson(baseline.intent?.input ?? null),
    };
    await writeOutput(comparison, args.out);
    if (!candidate || candidateError) process.exitCode = 1;
  } finally {
    await policy?.stop();
    await loom.close();
  }
}

function parseArgs(argv: string[]): Args {
  let journal = '';
  let out: string | undefined;
  let modelTurn: number | undefined;
  let candidate: CandidateAdapter = 'ax';
  let attentionPair = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--journal') journal = String(argv[++index] || '');
    else if (argv[index] === '--out') out = String(argv[++index] || '');
    else if (argv[index] === '--model-turn') {
      modelTurn = Number(argv[++index]);
      if (!Number.isSafeInteger(modelTurn) || modelTurn < 1) {
        throw new Error('--model-turn must be a positive journal sequence');
      }
    } else if (argv[index] === '--candidate') {
      const value = String(argv[++index] || '');
      if (value !== 'ax' && value !== 'direct') {
        throw new Error('--candidate must be ax or direct');
      }
      candidate = value;
    } else if (argv[index] === '--attention-pair') {
      attentionPair = true;
    } else throw new Error(`Unknown argument ${argv[index]}`);
  }
  if (!journal) {
    throw new Error(
      'Usage: mind-differential --journal <run.jsonl> [--model-turn <journal-sequence>] [--candidate ax|direct | --attention-pair] [--out result.json]',
    );
  }
  return {
    journal,
    candidate,
    attentionPair,
    ...(modelTurn == null ? {} : { modelTurn }),
    ...(out ? { out } : {}),
  };
}

async function runAttentionPair(options: {
  apiKey: string;
  model: string;
  entityId: string;
  observation: any;
  history: any[];
  actions: any[];
  foldCacheFile: string;
  source: Record<string, unknown>;
}) {
  const control = deliberativeControlObservation(options.observation);
  if (control.interventions.length === 0) {
    throw new Error('--attention-pair requires a captured observation containing an urgent event');
  }
  const deliberativeCaptured = await captureMindRequest({
    ...options,
    observation: control.observation,
  });
  const urgent = await captureMindRequest(options);
  if (urgent.attention?.mode !== 'urgent') {
    throw new Error('captured observation did not produce urgent attention');
  }
  if (deliberativeCaptured.attention?.mode !== 'deliberative') {
    throw new Error('control observation did not produce deliberative attention');
  }

  const deliberativeConversation = [...structuredClone(deliberativeCaptured.conversation)];
  deliberativeConversation[deliberativeConversation.length - 1] = structuredClone(
    urgent.conversation.at(-1),
  );
  const deliberative: ResidentMindRequest = {
    ...structuredClone(deliberativeCaptured),
    observation: structuredClone(urgent.observation),
    conversation: deliberativeConversation,
  };
  const evaluationId = `attention-${randomUUID()}`;
  const measuredDeliberative = withEvaluationNonce(deliberative, evaluationId);
  const measuredUrgent = withEvaluationNonce(urgent, evaluationId);
  const matched = {
    model: measuredDeliberative.model === measuredUrgent.model,
    observation:
      sha256(stableJson(measuredDeliberative.observation)) ===
      sha256(stableJson(measuredUrgent.observation)),
    actions:
      sha256(stableJson(measuredDeliberative.actions)) ===
      sha256(stableJson(measuredUrgent.actions)),
    requiredAction: measuredDeliberative.requiredAction === measuredUrgent.requiredAction,
  };
  const endpoint = chatCompletionEndpoint(process.env.OPENROUTER_BASE_URL);
  const [deliberativeCall, urgentCall] = await Promise.all([
    measuredProviderCall('deliberative', measuredDeliberative, options.apiKey, endpoint),
    measuredProviderCall('urgent', measuredUrgent, options.apiKey, endpoint),
  ]);
  const arms = [
    attentionArm('deliberative', measuredDeliberative, deliberativeCall),
    attentionArm('urgent', measuredUrgent, urgentCall),
  ];
  return {
    protocol: 'behold.attention-differential.v1',
    generatedAt: new Date().toISOString(),
    evaluationId,
    source: options.source,
    interventions: control.interventions,
    safety: {
      worldMutationEnabled: false,
      executableFunctionsExposedToProvider: false,
      proposalAdmissionEnabled: false,
      note: 'Both arms send the same current observation and action schemas; provider tool calls are recorded but never admitted.',
      cacheControl:
        'The same unique non-semantic suffix is added to both system prompts so prior provider prompt-cache state cannot favor either arm.',
    },
    matched: { ...matched, all: Object.values(matched).every(Boolean) },
    arms,
    reduction: comparisonReduction(arms[0], arms[1]),
    limitations: [
      'One paired sample estimates operational effect; model sampling and provider scheduling remain uncontrolled.',
      'The deliberative arm is reconstructed from the same production context after downgrading urgent salience only long enough to capture the full history, then restoring the exact urgent current observation before either provider call.',
    ],
  };
}

function withEvaluationNonce(request: ResidentMindRequest, evaluationId: string) {
  const conversation = structuredClone(request.conversation) as any[];
  const system = conversation[0];
  if (!system || system.role !== 'system' || typeof system.content !== 'string') {
    throw new Error('attention comparison requires a leading system message');
  }
  conversation[0] = {
    ...system,
    content: `${system.content}\nEvaluation provenance ${evaluationId}; this label does not change the world or choose an action.`,
  };
  return { ...structuredClone(request), conversation } satisfies ResidentMindRequest;
}

async function captureMindRequest(options: {
  apiKey: string;
  model: string;
  entityId: string;
  observation: any;
  history: any[];
  actions: any[];
  foldCacheFile: string;
}) {
  let captured: ResidentMindRequest | null = null;
  const mind: ResidentMind = {
    id: 'attention-request-capture',
    decide: async (request) => {
      captured = structuredClone(request);
      return {
        protocol: 'behold.mind-decision.v1',
        disposition: 'wait',
        utterance: 'measurement capture only',
        action: null,
        call: captureCallEvidence(options.model),
      };
    },
  };
  const policy = startLLMPolicy(
    {
      entityId: options.entityId,
      observe: (sinceSequence) => replayObservationAtCursor(options.observation, sinceSequence),
      actions: options.actions,
      attempt: () => {
        throw new Error('attention request capture cannot admit an action');
      },
    },
    {
      apiKey: options.apiKey,
      model: options.model,
      mind,
      history: options.history,
      foldCacheFile: options.foldCacheFile,
      maxTurnSteps: 1,
      acceptEngineEvent: () => true,
    },
  );
  try {
    await policy.tick();
  } finally {
    await policy.stop();
  }
  if (!captured) throw new Error('policy produced no mind request for attention comparison');
  return captured as ResidentMindRequest;
}

function captureCallEvidence(model: string) {
  return {
    protocol: 'behold.model-call.v1' as const,
    requestId: 'attention-request-capture',
    endpoint: 'local://attention-request-capture',
    startedAt: 0,
    completedAt: 0,
    latencyMs: 0,
    adapter: { name: 'attention-request-capture' },
    request: {
      model,
      messageCount: 0,
      toolCount: 0,
      toolChoice: null,
      bodySha256: sha256('capture'),
      messagesSha256: sha256('capture'),
      toolsSha256: sha256('capture'),
      kind: 'mind_input' as const,
    },
    response: {
      id: null,
      model,
      provider: 'local',
      finishReason: 'capture',
      nativeFinishReason: null,
      usage: null,
    },
  };
}

function deliberativeControlObservation(observation: any) {
  const cloned = structuredClone(observation);
  const interventions: Array<{ sequence: number; type: string; from: string; to: string }> = [];
  for (const event of cloned?.events || []) {
    if (event?.salience !== 'urgent' || event?.isNew === false) continue;
    interventions.push({
      sequence: Number(event.sequence),
      type: String(event.type || 'unknown'),
      from: 'urgent',
      to: 'high',
    });
    event.salience = 'high';
  }
  return { observation: cloned, interventions };
}

async function measuredProviderCall(
  label: 'deliberative' | 'urgent',
  request: ResidentMindRequest,
  apiKey: string,
  endpoint: string,
) {
  const tools = request.actions.map((action) => ({
    type: 'function',
    function: {
      name: action.name,
      description: action.description,
      parameters: action.inputSchema,
    },
  }));
  const body = {
    model: request.model,
    messages: request.conversation,
    tools,
    tool_choice: request.requiredAction
      ? { type: 'function', function: { name: request.requiredAction } }
      : 'auto',
    parallel_tool_calls: false,
    ...(request.model.includes('gpt-5') ? {} : { temperature: 0.2 }),
  };
  const requestBody = JSON.stringify(body);
  const startedAt = Date.now();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (process.env.OPENROUTER_REFERER) headers['HTTP-Referer'] = process.env.OPENROUTER_REFERER;
  if (process.env.OPENROUTER_TITLE) headers['X-Title'] = process.env.OPENROUTER_TITLE;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers, body: requestBody });
    const text = await response.text();
    const completedAt = Date.now();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    return {
      ok: response.ok,
      label,
      endpoint: safeEndpoint(endpoint),
      startedAt,
      completedAt,
      latencyMs: completedAt - startedAt,
      request: {
        messageCount: request.conversation.length,
        toolCount: request.actions.length,
        bodyBytes: Buffer.byteLength(requestBody),
        bodySha256: sha256(requestBody),
        messagesSha256: sha256(stableJson(request.conversation)),
        toolsSha256: sha256(stableJson(request.actions)),
      },
      response: response.ok
        ? {
            id: data?.id ?? null,
            model: data?.model ?? null,
            provider: data?.provider ?? null,
            finishReason: data?.choices?.[0]?.finish_reason ?? null,
            usage: data?.usage ?? null,
            proposal: proposalFromResponse(data),
          }
        : { status: response.status, bodyPreview: text.slice(0, 200) || null },
    };
  } catch (error: any) {
    const completedAt = Date.now();
    return {
      ok: false,
      label,
      endpoint: safeEndpoint(endpoint),
      startedAt,
      completedAt,
      latencyMs: completedAt - startedAt,
      request: {
        messageCount: request.conversation.length,
        toolCount: request.actions.length,
        bodyBytes: Buffer.byteLength(requestBody),
        bodySha256: sha256(requestBody),
        messagesSha256: sha256(stableJson(request.conversation)),
        toolsSha256: sha256(stableJson(request.actions)),
      },
      response: { status: null, bodyPreview: null },
      error: error?.message || String(error),
    };
  }
}

function attentionArm(label: string, request: ResidentMindRequest, call: any) {
  return {
    label,
    attention: request.attention,
    conversationMessages: request.conversation.length,
    call,
  };
}

function comparisonReduction(deliberative: any, urgent: any) {
  const before = deliberative.call?.response?.usage || {};
  const after = urgent.call?.response?.usage || {};
  return {
    conversationMessages: reduction(deliberative.conversationMessages, urgent.conversationMessages),
    requestBytes: reduction(deliberative.call?.request?.bodyBytes, urgent.call?.request?.bodyBytes),
    promptTokens: reduction(before.prompt_tokens, after.prompt_tokens),
    latencyMs: reduction(deliberative.call?.latencyMs, urgent.call?.latencyMs),
    cost: reduction(before.cost, after.cost),
  };
}

function reduction(before: unknown, after: unknown) {
  const baseline = Number(before);
  const candidate = Number(after);
  if (!Number.isFinite(baseline) || !Number.isFinite(candidate)) return null;
  return {
    deliberative: baseline,
    urgent: candidate,
    absolute: baseline - candidate,
    fraction: baseline === 0 ? null : (baseline - candidate) / baseline,
  };
}

function proposalFromResponse(data: any) {
  const message = data?.choices?.[0]?.message;
  const toolCall = message?.tool_calls?.[0];
  if (!toolCall?.function?.name) {
    return { type: 'text', content: message?.content ?? null };
  }
  let input: any = toolCall.function.arguments ?? {};
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {}
  }
  return { type: 'tool_call', name: String(toolCall.function.name), input };
}

function chatCompletionEndpoint(value: string | undefined) {
  const normalized = String(value || 'https://openrouter.ai/api/v1/chat/completions').replace(
    /\/+$/,
    '',
  );
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function safeEndpoint(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split('?')[0];
  }
}

async function writeOutput(value: unknown, outputFile: string | undefined) {
  const output = `${JSON.stringify(value, null, 2)}\n`;
  if (outputFile) {
    await fsPromises.mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
    await fsPromises.writeFile(path.resolve(outputFile), output, 'utf8');
  }
  process.stdout.write(output);
}

function readJsonl(file: string) {
  return fs
    .readFileSync(path.resolve(file), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSON at ${file}:${index + 1}`);
      }
    });
}

function openAICompatibleBaseURL(value: string | undefined) {
  const normalized = String(value || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  return normalized.replace(/\/chat\/completions$/, '');
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

function observationForCurrentContract(captured: any) {
  const observation = structuredClone(captured);
  const migrations: string[] = [];
  for (const entity of observation?.scene?.entities || []) {
    if (!entity?.pickupSafety || entity.pickupGround) continue;
    const legacy = entity.pickupSafety;
    entity.pickupGround = {
      status: legacy.ok
        ? 'supported'
        : legacy.reason === 'hazardous_support'
          ? 'hazardous'
          : legacy.reason === 'unsupported_destination'
            ? 'unsupported'
            : 'unknown',
      ...(legacy.feet ? { feet: legacy.feet } : {}),
      ...(legacy.support ? { support: legacy.support } : {}),
    };
    delete entity.pickupSafety;
    if (!migrations.includes('scene.entities.pickupSafety->pickupGround')) {
      migrations.push('scene.entities.pickupSafety->pickupGround');
    }
  }
  return { observation, migrations };
}

function replayObservationAtCursor(observation: any, sinceSequence = 0) {
  const observedThrough = Number(observation?.sequence) || 0;
  if (Number(sinceSequence) < observedThrough) return structuredClone(observation);
  return {
    ...structuredClone(observation),
    eventWindow: {
      requestedAfterSequence: Number(sinceSequence),
      oldestAvailableSequence: Number(observation?.eventWindow?.oldestAvailableSequence) || 1,
      newestAvailableSequence: observedThrough,
      missingBeforeOldest: 0,
      complete: true,
    },
    events: [],
  };
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
