import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isCriticalBodyCondition } from '../agent/condition';
import type { Intent } from '../loop/arbiter';
import type { EngineEvent } from '../loop/engine';
import { historyMessages, type EntityTurn } from '../entity/loom';
import type { InhabitantActionSpec, InhabitantInterface } from '../entity/interface';
import { MANAGE_PROJECT_TOOL } from '../entity/projects';
import {
  projectCurrentModelObservation,
  projectHistoricalModelObservation,
  projectRecentActionContinuity,
  type RecentActionContinuity,
} from './context';
import {
  createLoomContextView,
  foldMessage,
  type LoomFoldRequest,
  type LoomFoldSummarizer,
} from '../entity/folding';
import type {
  ResidentAttention,
  ResidentAttentionInterruption,
  ResidentMind,
  ResidentMindDecision,
  ResidentMindRequest,
} from '../mind/interface';
import { createDirectResidentMind } from '../mind/direct';
import { residentMindRequestSha256 } from '../mind/request-artifact';
import { attributeProviderRequestBody } from '../mind/request-attribution';
import { cognitionClientHeaders, parseCognitionAdmission } from '../mind/cognition';
import { validateResidentActionInput } from '../mind/schema';
import { residentTurnMayReplay } from '../mind/resident-visibility';
import {
  ResidentMindCallError,
  type ModelCallEvidence,
  type ModelCallFailureEvidence,
} from '../mind/evidence';
import {
  minecraftActionProfile,
  minecraftSafetyProfile,
  type MinecraftActionProfile,
  type MinecraftSafetyProfile,
} from '../agent/action-profiles';
import { isNeutralPolicy, residentPolicyProfile, type ResidentPolicyProfile } from './profile';

export type { ModelCallEvidence, ModelCallFailureEvidence } from '../mind/evidence';

type ToolSpec = InhabitantActionSpec;

export type Options = {
  apiKey: string;
  /** Default model for ordinary deliberation, social attention, and loom folding. */
  model: string;
  /** Optional model used for new bodily urgency and a still-critical body condition. */
  urgentModel?: string;
  /** Maximum wall time for one newly urgent bodily decision. */
  urgentDecisionTimeoutMs?: number;
  endpoint?: string;
  tickMs?: number;
  maxTurnSteps?: number;
  resumeAfterBudget?: boolean;
  allowTools?: string[] | null;
  history?: EntityTurn[];
  foldCacheFile?: string | null;
  /** Evidence replay may read an existing fold but must not create or update one. */
  foldReadOnly?: boolean;
  foldRecentTurns?: number;
  foldBatchTurns?: number;
  foldTriggerTurns?: number;
  /** Hard provider output budget for one disposable loom-fold request. */
  foldMaxOutputTokens?: number;
  summarizeLoom?: LoomFoldSummarizer;
  now?: () => number;
  recordModelIO?: boolean;
  /** Requests use the runner-owned, authenticated aggregate cognition transport. */
  cognitionTransport?: boolean;
  /** Alternate bounded decision implementation. Behold still owns the resident loop. */
  mind?: ResidentMind;
  /** Versioned controller behavior; neutral mode does not coach or repair model choices. */
  policyProfile?: ResidentPolicyProfile;
  /** Versioned action surface identity selected outside the generic policy loop. */
  actionProfile?: MinecraftActionProfile;
  /** Versioned world/body risk policy selected by the world adapter. */
  safetyProfile?: MinecraftSafetyProfile;
  log?: (s: string) => void;
  /** Accept only lifecycle objects minted by the engine that owns attempt(). */
  acceptEngineEvent: (event: EngineEvent) => boolean;
  onModelTurn?: (turn: {
    at: number;
    model: string;
    mind: string;
    policyProfile: ResidentPolicyProfile;
    actionProfile: MinecraftActionProfile;
    safetyProfile: MinecraftSafetyProfile;
    observation: any;
    assistant: any;
    intent: Intent | null;
    call: ModelCallEvidence;
    attention: ResidentAttention;
  }) => void;
  onModelError?: (failure: {
    at: number;
    model: string;
    error: string;
    call: ModelCallFailureEvidence | ModelCallEvidence | null;
  }) => void;
  onModelInterrupted?: (interruption: ResidentAttentionInterruption & { model: string }) => void;
  onAuxiliaryModelCall?: (turn: {
    at: number;
    model: string;
    purpose: 'loom_fold';
    call: ModelCallEvidence;
  }) => void;
  onAuxiliaryModelError?: (failure: {
    at: number;
    model: string;
    purpose: 'loom_fold';
    error: string;
    call: ModelCallFailureEvidence;
  }) => void;
  onEntityTurn?: (turn: EntityTurn) => unknown | Promise<unknown>;
};

type PendingAction = {
  intent: Intent;
  toolCallId: string | null;
  draft: TurnDraft;
};

type TurnDraft = {
  model: string;
  startedAt: number;
  observation: any;
  assistant: any;
  attention: ResidentAttention;
};

type ModelDecision = {
  assistant: any;
  intent: Intent | null;
  toolCallId: string | null;
  wait: boolean;
  call: ModelCallEvidence;
};

type ActiveDecision = {
  model: string;
  attention: ResidentAttention;
  startedAt: number;
  observationSequence: number;
  interruption: ResidentAttentionInterruption | null;
};

class ModelCallError extends Error {
  constructor(
    message: string,
    readonly call: ModelCallFailureEvidence,
  ) {
    super(message);
    this.name = 'ModelCallError';
  }
}

class MindDecisionError extends Error {
  constructor(
    message: string,
    readonly call: ModelCallEvidence,
  ) {
    super(message);
    this.name = 'MindDecisionError';
  }
}

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_URGENT_DECISION_TIMEOUT_MS = 5_000;
export const DEFAULT_LOOM_FOLD_MAX_OUTPUT_TOKENS = 1_024;
const WAIT_TOOL = 'wait_for_event';
const COLLECT_TOOL = 'collect_nearby_item';
const COMMUNICATION_TOOLS = new Set(['chat', 'whisper']);
const BODILY_URGENCY_EVENT_TYPES = new Set([
  'self_hurt',
  'condition_changed',
  'died',
  'dimension_changed',
  'sound_heard',
]);
const WAIT_TOOL_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: WAIT_TOOL,
    description:
      'Explicitly yield control when you have finished the current sequence and need a new world event before deciding again',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'What you are waiting for' },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional event types or natural-language conditions that should wake you',
        },
      },
      required: ['reason'],
    },
  },
};
const NEUTRAL_WAIT_TOOL_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: WAIT_TOOL,
    description: 'Yield without proposing a Minecraft action until a later world event.',
    parameters: WAIT_TOOL_SPEC.function.parameters,
  },
};
const EMBODIED_ACTION_TOOLS = new Set<string>([
  'move_to',
  'move_direction',
  'cross_visible_door',
  'cross_place_door',
  'approach_entity',
  'attack_entity',
  'collect_nearby_item',
  'drop_item',
  'dig_block',
  'descend_step',
  'ascend_step',
  'place_against',
  'place_block',
  'toggle_block',
  'craft_item',
  'inspect_container',
  'deposit_in_container',
  'withdraw_from_container',
  'sleep_in_bed',
  'wake_up',
]);
const BODILY_RESPONSE_TOOLS = new Set<string>([...EMBODIED_ACTION_TOOLS, 'consume', 'equip_item']);
const TERMINAL_ACTION_EVENTS = new Set(['action_completed', 'action_failed', 'intent_blocked']);
const URGENT_CONTINUITY_TURNS = 3;
const URGENT_CONTINUITY_BYTES = 6_000;
const DELIBERATIVE_CONTINUITY_TURNS = 12;
const DELIBERATIVE_CONTINUITY_BYTES = 16_000;

/**
 * A persistent controller coroutine over the shared action stream.
 *
 * A wake event begins a controller turn. The model may yield an action, receive
 * its real result, and yield another action. The turn ends only when it calls
 * wait_for_event, produces no action, or exhausts its bounded step budget.
 */
export function startLLMPolicy(environment: InhabitantInterface, opts: Options) {
  const log = (s: string) => (opts.log ? opts.log(s) : void 0);
  const now = () => (opts.now ? opts.now() : Date.now());
  const entityId = environment.entityId;
  const history = opts.history || [];
  const tickMs = Math.max(500, Number(opts.tickMs ?? 3000));
  const maxTurnSteps = Math.max(1, Math.min(32, Number(opts.maxTurnSteps ?? 8)));
  const policyProfile = residentPolicyProfile(opts.policyProfile);
  const actionProfile = minecraftActionProfile(
    opts.actionProfile ??
      (policyProfile === 'neutral-benchmark-v1' ? 'minecraft-player-v1' : 'resident-v1'),
  );
  const safetyProfile = minecraftSafetyProfile(
    opts.safetyProfile ??
      (policyProfile === 'neutral-benchmark-v1' ? 'vanilla-player-v1' : 'resident-safe-v1'),
  );
  const urgentDecisionTimeoutMs = boundedUrgentDecisionTimeoutMs(opts.urgentDecisionTimeoutMs);
  const allow = Array.isArray(opts.allowTools) ? new Set(opts.allowTools) : null;
  const executableTools = allow
    ? environment.actions.filter((spec) => allow.has(spec.function.name))
    : [...environment.actions];
  const waitToolSpec = isNeutralPolicy(policyProfile) ? NEUTRAL_WAIT_TOOL_SPEC : WAIT_TOOL_SPEC;
  const modelTools = executableTools.some((spec) => spec.function.name === WAIT_TOOL)
    ? executableTools
    : [...executableTools, waitToolSpec];
  const executableCatalog = new Map(
    executableTools.map((spec) => [spec.function.name, spec] as const),
  );
  const mind: ResidentMind =
    opts.mind ||
    createDirectResidentMind({
      apiKey: opts.apiKey,
      model: opts.model,
      ...(opts.urgentModel ? { allowedModels: [opts.urgentModel] } : {}),
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      ...(opts.cognitionTransport ? { cognitionTransport: true } : {}),
      ...(opts.recordModelIO ? { recordModelIO: true } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
  let activeModelRequest: AbortController | null = null;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  let resolveStop: (() => void) | null = null;
  const loomContext = createLoomContextView(history, {
    entityId,
    model: opts.model,
    cacheFile: opts.foldCacheFile,
    readOnly: opts.foldReadOnly,
    recentTurns: opts.foldRecentTurns ?? 6,
    foldBatchTurns: opts.foldBatchTurns ?? 24,
    foldTriggerTurns: opts.foldTriggerTurns ?? 6,
    now,
    summarize: opts.summarizeLoom
      ? (request, signal) =>
          signal
            ? abortable(opts.summarizeLoom!(request, signal), signal)
            : opts.summarizeLoom!(request)
      : (request, signal) => summarizeLoom(request, opts, signal ?? new AbortController().signal),
  });
  const messages: any[] = [
    { role: 'system', content: controllerSystemPrompt(modelTools, policyProfile) },
  ];

  let timer: NodeJS.Timeout | null = null;
  let resumeTimer: NodeJS.Timeout | null = null;
  let lastTool: string | null = null;
  let lastSequence = 0;
  let deciding = false;
  let preparingContext = false;
  let contextPrepared = false;
  let loomMaintenanceScheduled = false;
  let loomMaintenanceActive = false;
  let wakeQueued = false;
  let turnActive = false;
  let turnSteps = 0;
  let pending: PendingAction | null = null;
  let currentObservation: any = null;
  let currentModelObservation: any = null;
  let entitySequence = history.at(-1)?.sequence ?? 0;
  let parentTurnId = history.at(-1)?.id ?? null;
  let lastActionSignature: string | null = null;
  let repeatedActionCount = 0;
  let consecutiveCommunicationActions = trailingCommunicationActions(history);
  const trailingFailures = trailingFailedEmbodiedActions(history);
  let failedEmbodiedTool = trailingFailures.tool;
  let failedEmbodiedCount = trailingFailures.count;
  let suspended = false;
  let activeDecision: ActiveDecision | null = null;
  let continuingBodilyAttention: ResidentAttention | null = null;

  async function wake(force = false) {
    if (stopped || suspended) return;
    if (deciding) {
      wakeQueued = true;
      const latest = observe();
      const decision = activeDecision;
      const triggers = urgentEventTriggers(latest, decision?.observationSequence ?? lastSequence);
      if (
        decision?.attention.mode === 'deliberative' &&
        !decision.interruption &&
        triggers.length > 0
      ) {
        const interruptedAt = now();
        decision.interruption = {
          protocol: 'behold.attention-interruption.v1',
          reason: 'urgent_world_attention',
          startedAt: decision.startedAt,
          interruptedAt,
          latencyMs: Math.max(0, interruptedAt - decision.startedAt),
          observationSequence: decision.observationSequence,
          from: decision.attention,
          to: {
            mode: 'urgent',
            context: 'current_body_and_continuity',
            triggers,
          },
        };
        activeModelRequest?.abort(abortError('urgent_world_attention'));
      }
      return;
    }
    if (preparingContext) {
      if (loomMaintenanceActive) {
        const latest = observe();
        const triggers = urgentEventTriggers(latest, lastSequence);
        if (force || hasDecisionRelevantEvent(latest, lastSequence)) {
          wakeQueued = true;
          activeModelRequest?.abort(
            abortError(
              triggers.length > 0
                ? 'urgent_world_attention_during_loom_fold'
                : 'world_attention_during_loom_fold',
            ),
          );
        }
      } else {
        wakeQueued = true;
      }
      return;
    }
    if (pending) {
      wakeQueued = true;
      return;
    }

    let frame: any = null;
    if (!contextPrepared) {
      frame = observe();
      const initialView = projectCurrentModelObservation(frame);
      const initialAttention = attentionForObservation(initialView);
      const initialBodyUrgency =
        hasBodilyUrgency(initialAttention) || isCriticalBodyCondition(initialView?.self?.condition);
      if (opts.foldReadOnly && loomContext.state().needsFold) {
        preparingContext = true;
        try {
          await loomContext.prepare();
        } catch (error: any) {
          if (!stopped)
            log(`[policy] could not prepare loom context: ${error?.message || String(error)}`);
          return;
        } finally {
          preparingContext = false;
          settleStop();
        }
      }
      rebuildMessagesFromLoom();
      contextPrepared = true;
      if (loomContext.state().needsFold) {
        log(
          initialBodyUrgency
            ? '[policy] deferred initial own-loom fold while bodily urgency remains unresolved'
            : '[policy] deferred initial own-loom fold until the resident yields',
        );
      }
    }

    frame ??= observe();
    if (hasUnfinishedAction(frame)) {
      wakeQueued = true;
      return;
    }
    if (!turnActive && !force && !hasDecisionRelevantEvent(frame, lastSequence)) return;

    if (!turnActive) {
      turnActive = true;
      turnSteps = 0;
    }
    appendWorldUpdate(frame, 'New world experience');
    await continueTurn();
  }

  async function continueTurn() {
    if (stopped || suspended) {
      turnActive = false;
      turnSteps = 0;
      wakeQueued = false;
      return;
    }
    if (!turnActive || pending) return;
    if (deciding || preparingContext) {
      wakeQueued = true;
      return;
    }

    if (turnSteps >= maxTurnSteps) {
      log(`[policy] controller paused after reaching ${maxTurnSteps} model steps`);
      messages.push({
        role: 'user',
        content: `Controller step budget reached (${maxTurnSteps}); your life and unfinished commitments continue in the next episode.`,
      });
      turnActive = false;
      turnSteps = 0;
      if (opts.resumeAfterBudget && !resumeTimer) {
        resumeTimer = setTimeout(() => {
          resumeTimer = null;
          void wake(true);
        }, tickMs);
      }
      scheduleLoomMaintenance();
      return;
    }

    deciding = true;
    let continueImmediately = false;
    try {
      turnSteps += 1;
      const startedAt = now();
      const modelObservation =
        currentModelObservation ?? projectCurrentModelObservation(currentObservation);
      const currentAttention = attentionForCurrentLife(modelObservation);
      const attention = hasBodilyUrgency(currentAttention)
        ? { ...currentAttention, decisionBudgetMs: urgentDecisionTimeoutMs }
        : currentAttention;
      const decisionModel = hasBodilyUrgency(attention)
        ? opts.urgentModel || opts.model
        : opts.model;
      activeDecision = {
        model: decisionModel,
        attention,
        startedAt,
        observationSequence: Number(currentObservation?.sequence) || lastSequence,
        interruption: null,
      };
      const physicallyOffered = actionsOfferedByEnvironment(
        environment,
        currentObservation,
        executableTools,
        executableCatalog,
        log,
      );
      const withYield = physicallyOffered.some((spec) => spec.function.name === WAIT_TOOL)
        ? physicallyOffered
        : [...physicallyOffered, waitToolSpec];
      const availableTools = availableModelTools(
        withYield,
        currentObservation,
        attention,
        policyProfile,
      );
      const requiredTool = isNeutralPolicy(policyProfile)
        ? null
        : requiredSelfDirectionTool(currentObservation, availableTools, allow);
      const decision = await withModelRequest(async (signal) => {
        const deadline = hasBodilyUrgency(attention)
          ? setTimeout(() => {
              activeModelRequest?.abort(
                abortError(`urgent_decision_deadline_exceeded:${urgentDecisionTimeoutMs}ms`),
              );
            }, urgentDecisionTimeoutMs)
          : null;
        const request: ResidentMindRequest = {
          protocol: 'behold.mind-request.v1',
          entityId,
          model: decisionModel,
          policyProfile,
          actionProfile,
          safetyProfile,
          observation: cloneJson(modelObservation),
          conversation: cloneJson(
            conversationForAttention(
              messages,
              attention,
              availableTools,
              projectRecentActionContinuity(
                loomContext.view().turns,
                attention.context === 'bounded_loom'
                  ? DELIBERATIVE_CONTINUITY_TURNS
                  : URGENT_CONTINUITY_TURNS,
                attention.context === 'bounded_loom'
                  ? DELIBERATIVE_CONTINUITY_BYTES
                  : URGENT_CONTINUITY_BYTES,
                residentTurnMayReplay,
              ),
              policyProfile,
            ),
          ),
          actions: cloneJson(
            availableTools.map((action) => ({
              name: action.function.name,
              description: action.function.description,
              inputSchema: action.function.parameters ?? {
                type: 'object',
                properties: {},
              },
            })),
          ),
          requiredAction: requiredTool,
          attention,
        };
        // ResidentMind owns acknowledgement of its AbortSignal. Do not race it
        // with a synthetic rejection: aggregate compute remains occupied until
        // the adapter promise actually settles.
        try {
          const requestSha256 = residentMindRequestSha256(request);
          const proposed = await mind.decide(request, { signal });
          if (signal.aborted) {
            throw signal.reason ?? abortError('urgent decision expired before admission');
          }
          return validateMindDecision(
            proposed,
            availableTools,
            requiredTool,
            decisionModel,
            requestSha256,
          );
        } finally {
          if (deadline) clearTimeout(deadline);
        }
      });
      if (stopped || suspended) {
        turnActive = false;
        turnSteps = 0;
        return;
      }
      const assistant = normalizeAssistant(decision.assistant);
      const decidedAt = now();
      if (decision.intent) {
        decision.intent = {
          ...decision.intent,
          observationSequence: Number(currentObservation?.sequence),
          decidedAt,
        };
      }
      const draft: TurnDraft = {
        model: decisionModel,
        startedAt,
        observation: currentObservation,
        assistant,
        attention,
      };
      messages.push(assistant);
      opts.onModelTurn?.({
        at: decidedAt,
        model: decisionModel,
        mind: mind.id,
        policyProfile,
        actionProfile,
        safetyProfile,
        observation: modelObservation,
        assistant,
        intent: decision.intent,
        call: decision.call,
        attention,
      });

      if (decision.intent) {
        const latestObservation = environment.observe(
          Number(draft.observation?.sequence) || lastSequence,
        );
        const invalidation = modelDecisionInvalidation(
          latestObservation,
          Number(draft.observation?.sequence) || lastSequence,
        );
        if (invalidation) {
          const result = {
            ok: false,
            error: 'decision_invalidated_by_world',
            reason:
              'The body crossed a life boundary or an observation gap after this decision began. Reobserve before choosing for the current body.',
            ...invalidation,
          };
          appendRejectedToolResult(decision, result);
          await closeTurn(
            draft,
            actionFromIntent(decision.intent, decision.toolCallId),
            { ok: false, eventType: 'intent_blocked', result, error: result.error },
            latestObservation,
          );
          appendWorldUpdate(observe(), `World after invalidated ${decision.intent.tool}`);
          log(`[policy] invalidated stale ${decision.intent.tool}: ${invalidation.reason}`);
          continueImmediately = true;
          return;
        }
      }

      if (decision.wait) {
        const result = { ok: true, status: 'waiting_for_world_event' };
        if (decision.toolCallId) {
          messages.push({
            role: 'tool',
            tool_call_id: decision.toolCallId,
            name: WAIT_TOOL,
            content: JSON.stringify(result),
          });
        }
        await closeTurn(
          draft,
          {
            id: decision.toolCallId || rid('wait'),
            name: WAIT_TOOL,
            input: toolArguments(assistant),
            kind: 'yield',
            toolCallId: decision.toolCallId,
          },
          { ok: true, eventType: 'wait_for_event', result },
          observe(),
        );
        log('[policy] yielded: waiting for a new world event');
        turnActive = false;
        turnSteps = 0;
        lastTool = null;
        return;
      }

      if (!decision.intent) {
        const result = { ok: true, status: 'waiting_for_world_event', reason: 'no_action' };
        await closeTurn(
          draft,
          {
            id: rid('wait'),
            name: WAIT_TOOL,
            input: { reason: 'model proposed no action' },
            kind: 'yield',
            toolCallId: null,
          },
          { ok: true, eventType: 'wait_for_event', result },
          observe(),
        );
        log('[policy] yielded: model proposed no action');
        turnActive = false;
        turnSteps = 0;
        return;
      }

      const intent = decision.intent;
      const signature = actionSignature(intent);
      if (signature === lastActionSignature) repeatedActionCount += 1;
      else {
        lastActionSignature = signature;
        repeatedActionCount = 1;
      }
      if (
        !isNeutralPolicy(policyProfile) &&
        intent.tool !== 'attack_entity' &&
        repeatedActionCount >= 3
      ) {
        const result = {
          ok: false,
          error: 'repeated_action_without_adaptation',
          reason:
            'This exact action was already chosen twice in succession. Inspect the consequence and choose a materially different action.',
        };
        appendRejectedToolResult(decision, result);
        const nextObservation = observe();
        await closeTurn(
          draft,
          actionFromIntent(intent, decision.toolCallId),
          { ok: false, eventType: 'intent_blocked', result, error: result.error },
          nextObservation,
        );
        appendWorldUpdate(nextObservation, `World after loop-breaking ${intent.tool}`);
        log(`[policy] broke repeated-action loop: ${intent.tool}`);
        continueImmediately = true;
        return;
      }
      if (
        !isNeutralPolicy(policyProfile) &&
        EMBODIED_ACTION_TOOLS.has(intent.tool) &&
        intent.tool === failedEmbodiedTool &&
        failedEmbodiedCount >= 3
      ) {
        const result = {
          ok: false,
          error: 'repeated_failed_strategy',
          reason: `${intent.tool} has already failed ${failedEmbodiedCount} consecutive times. Use a different affordance to inspect, reposition, revise your project, or wait for a relevant world change before trying it again.`,
        };
        appendRejectedToolResult(decision, result);
        const nextObservation = observe();
        await closeTurn(
          draft,
          actionFromIntent(intent, decision.toolCallId),
          { ok: false, eventType: 'intent_blocked', result, error: result.error },
          nextObservation,
        );
        appendWorldUpdate(observe(), `World after strategy-loop breaking ${intent.tool}`);
        log(`[policy] broke repeated failed strategy: ${intent.tool}`);
        continueImmediately = true;
        return;
      }
      if (
        !isNeutralPolicy(policyProfile) &&
        COMMUNICATION_TOOLS.has(intent.tool) &&
        consecutiveCommunicationActions >= 2
      ) {
        const result = {
          ok: false,
          error: 'communication_without_world_progress',
          reason:
            'You already sent two messages without an embodied action or a human reply. Act in the world or wait for a reply before speaking again.',
        };
        appendRejectedToolResult(decision, result);
        const nextObservation = observe();
        await closeTurn(
          draft,
          actionFromIntent(intent, decision.toolCallId),
          { ok: false, eventType: 'intent_blocked', result, error: result.error },
          nextObservation,
        );
        appendWorldUpdate(nextObservation, `World after loop-breaking ${intent.tool}`);
        log(`[policy] broke communication-only loop: ${intent.tool}`);
        continueImmediately = true;
        return;
      }
      if (allow && !allow.has(intent.tool)) {
        const result = {
          ok: false,
          error: 'tool_not_allowed',
          tool: intent.tool,
        };
        appendRejectedToolResult(decision, result);
        const nextObservation = observe();
        await closeTurn(
          draft,
          actionFromIntent(intent, decision.toolCallId),
          { ok: false, eventType: 'intent_blocked', result, error: result.error },
          nextObservation,
        );
        appendWorldUpdate(nextObservation, `World after rejected ${intent.tool}`);
        log(`[policy] rejected by controller allowlist: ${intent.tool}`);
        continueImmediately = true;
        return;
      }

      log(`[policy] propose: ${intent.tool} ${fmtArgs(intent.input)}`);
      if (COMMUNICATION_TOOLS.has(intent.tool)) consecutiveCommunicationActions += 1;
      else if (intent.tool !== WAIT_TOOL) consecutiveCommunicationActions = 0;
      lastTool = intent.tool;
      // Establish ownership before admission. The environment may synchronously
      // emit a terminal event while enqueueing (for example, bodily urgency can
      // reclaim the just-queued model action). onEngineEvent must be able to
      // match that terminal, and this frame must not reinstall a pending intent
      // after the terminal has already claimed it.
      const proposedPending = { intent, toolCallId: decision.toolCallId, draft };
      pending = proposedPending;
      let accepted: boolean | void;
      try {
        accepted = environment.attempt(intent, { observation: draft.observation });
      } catch (error) {
        if (pending === proposedPending) pending = null;
        throw error;
      }
      if (accepted === false) {
        if (pending !== proposedPending) {
          // A synchronous terminal already owns closure of this turn.
          return;
        }
        pending = null;
        const result = {
          ok: false,
          error: 'intent_not_enqueued',
          reason: 'An equivalent action is already pending.',
        };
        appendRejectedToolResult(decision, result);
        const nextObservation = observe();
        await closeTurn(
          draft,
          actionFromIntent(intent, decision.toolCallId),
          { ok: false, eventType: 'intent_blocked', result, error: result.error },
          nextObservation,
        );
        appendWorldUpdate(nextObservation, `World after rejected ${intent.tool}`);
        continueImmediately = true;
        return;
      }
    } catch (e: any) {
      if (!stopped) {
        const interruption = activeDecision?.interruption;
        if (interruption) {
          log(
            `[policy] interrupted deliberation for ${interruption.to.triggers
              .map((trigger) => `${trigger.type}@${trigger.sequence}`)
              .join(', ')}`,
          );
          opts.onModelInterrupted?.({
            ...interruption,
            model: activeDecision?.model || opts.model,
            ...(e instanceof ResidentMindCallError ? { call: e.call } : {}),
          });
        } else {
          log(`[policy] error: ${e?.message || String(e)}`);
          opts.onModelError?.({
            at: now(),
            model: activeDecision?.model || opts.model,
            error: e?.message || String(e),
            call:
              e instanceof ModelCallError ||
              e instanceof MindDecisionError ||
              e instanceof ResidentMindCallError
                ? e.call
                : null,
          });
        }
      }
      turnActive = false;
      turnSteps = 0;
    } finally {
      deciding = false;
      activeDecision = null;
      settleStop();
      if (!stopped && continueImmediately && turnActive && !pending) {
        setImmediate(() => void continueTurn());
      } else if (!stopped && wakeQueued && !pending) {
        wakeQueued = false;
        setImmediate(() => void wake());
      } else if (!stopped && !turnActive && !pending) {
        scheduleLoomMaintenance();
      }
    }
  }

  function scheduleLoomMaintenance() {
    if (
      stopped ||
      suspended ||
      turnActive ||
      pending ||
      deciding ||
      preparingContext ||
      wakeQueued ||
      loomMaintenanceScheduled ||
      loomMaintenanceActive ||
      !loomContext.state().needsFold
    ) {
      return;
    }
    const frame = projectCurrentModelObservation(observe());
    const attention = attentionForObservation(frame);
    if (hasBodilyUrgency(attention) || isCriticalBodyCondition(frame?.self?.condition)) {
      log('[policy] deferred own-loom maintenance while bodily pressure remains unresolved');
      return;
    }
    loomMaintenanceScheduled = true;
    setImmediate(() => void maintainLoomContext());
  }

  async function maintainLoomContext() {
    loomMaintenanceScheduled = false;
    if (
      stopped ||
      suspended ||
      turnActive ||
      pending ||
      deciding ||
      preparingContext ||
      wakeQueued ||
      !loomContext.state().needsFold
    ) {
      return;
    }
    preparingContext = true;
    loomMaintenanceActive = true;
    try {
      const folded = await withModelRequest((signal) => loomContext.prepare(signal));
      if (!stopped && folded) {
        rebuildMessagesFromLoom();
        log(`[policy] folded own loom through turn ${loomContext.state().foldedThrough}`);
      }
    } catch (error: any) {
      if (!stopped && error?.name !== 'AbortError') {
        log(`[policy] could not fold loom context: ${error?.message || String(error)}`);
      } else if (!stopped) {
        // A cancelled multi-batch refresh may still have committed complete
        // earlier batches. Rebuild from that valid frontier before foreground
        // thought resumes; never expose a half-written or synthetic fold.
        rebuildMessagesFromLoom();
        log('[policy] yielded own-loom maintenance to world attention');
      }
    } finally {
      loomMaintenanceActive = false;
      preparingContext = false;
      settleStop();
      if (!stopped && wakeQueued) {
        wakeQueued = false;
        setImmediate(() => void wake());
      }
    }
  }

  function attentionForCurrentLife(frame: any): ResidentAttention {
    const fresh = attentionForObservation(frame);
    if (hasBodilyUrgency(fresh)) {
      continuingBodilyAttention = fresh;
      return fresh;
    }
    if (continuingBodilyAttention && isCriticalBodyCondition(frame?.self?.condition)) {
      return {
        ...continuingBodilyAttention,
        continuingCondition: 'critical_body_condition',
      };
    }
    continuingBodilyAttention = null;
    if (isCriticalBodyCondition(frame?.self?.condition)) {
      return {
        mode: 'deliberative',
        context: 'current_body_and_continuity',
        continuingCondition: 'critical_body_condition',
        triggers: [],
      };
    }
    return fresh;
  }

  async function onEngineEvent(event: EngineEvent) {
    if (!opts.acceptEngineEvent(event)) {
      log(`[policy] refused unauthenticated engine event: ${String(event?.type || 'unknown')}`);
      return;
    }
    if (event.type === 'controller_suspended') {
      suspend(String(event.data?.reason || 'controller_suspended'));
      return;
    }
    if (!TERMINAL_ACTION_EVENTS.has(event.type) || !pending) return;
    const eventIntent = event.data?.intent;
    if (
      String(eventIntent?.id || '') !== pending.intent.id ||
      String(eventIntent?.source || '') !== pending.intent.source ||
      String(eventIntent?.tool || '') !== pending.intent.tool ||
      stableJson(eventIntent?.input ?? {}) !== stableJson(pending.intent.input ?? {}) ||
      (event.type === 'action_completed' && event.data?.result?.ok === false)
    ) {
      log(`[policy] refused mismatched terminal event for ${pending.intent.id}`);
      return;
    }

    const finished = pending;
    pending = null;
    if (
      event.type === 'action_completed' &&
      continuingBodilyAttention &&
      completedBodilyResponse(finished.intent.tool, event.data?.result)
    ) {
      // A new urgent event deserves one fast response. Once a bodily action
      // really executes, the critical condition remains visible and keeps
      // maintenance/bookkeeping deferred, but planning may become deliberative
      // until new harm or another urgent world event arrives.
      continuingBodilyAttention = null;
      log('[policy] acute bodily response completed; continuing recovery may deliberate');
    }
    if (
      event.type === 'intent_blocked' &&
      ['human_stop', 'llm_muted_by_human_stop'].includes(String(event.data?.reason || ''))
    ) {
      suspend('human_stop');
    }
    const result = terminalResult(event);
    if (finished.toolCallId) {
      messages.push({
        role: 'tool',
        tool_call_id: finished.toolCallId,
        name: finished.intent.tool,
        content: JSON.stringify(result),
      });
    } else {
      messages.push({
        role: 'user',
        content: `Action result for ${finished.intent.tool}: ${JSON.stringify(result)}`,
      });
    }

    preparingContext = true;
    try {
      const nextObservation = observe();
      await closeTurn(
        finished.draft,
        actionFromIntent(finished.intent, finished.toolCallId),
        result,
        nextObservation,
        event.at,
      );
      // onEntityTurn may update loom-derived projections such as projects.
      // Observe again so continuation sees the committed view rather than the
      // provisional frame captured before persistence.
      appendWorldUpdate(observe(), `World after ${finished.intent.tool}`);
      wakeQueued = false;
    } catch (error: any) {
      log(`[policy] could not persist entity turn: ${error?.message || String(error)}`);
      turnActive = false;
      turnSteps = 0;
    } finally {
      preparingContext = false;
      settleStop();
    }
    if (!stopped && turnActive && !suspended) setImmediate(() => void continueTurn());
    else if (!stopped && wakeQueued) {
      wakeQueued = false;
      setImmediate(() => void wake());
    }
  }

  function appendRejectedToolResult(decision: ModelDecision, result: any) {
    if (decision.toolCallId) {
      messages.push({
        role: 'tool',
        tool_call_id: decision.toolCallId,
        name: decision.intent?.tool || 'unknown',
        content: JSON.stringify(result),
      });
    } else {
      messages.push({ role: 'user', content: `Action rejected: ${JSON.stringify(result)}` });
    }
  }

  function observe() {
    return environment.observe(lastSequence);
  }

  function appendWorldUpdate(frame: any, label: string) {
    currentObservation = frame;
    const projected = projectCurrentModelObservation(frame);
    currentModelObservation = projected;
    const deliveredSequence = projected?.eventWindow?.deliveredNewestSequence;
    if (Number.isFinite(Number(deliveredSequence))) {
      lastSequence = Math.max(lastSequence, Number(deliveredSequence));
    } else if (!Array.isArray(frame?.events) && Number.isFinite(Number(frame?.sequence))) {
      lastSequence = Math.max(lastSequence, Number(frame.sequence));
    }
    messages.push({
      role: 'user',
      content: `${label}:\n${JSON.stringify(projected)}\nPrevious action: ${lastTool ?? 'none'}`,
    });
  }

  async function closeTurn(
    draft: TurnDraft,
    action: Omit<EntityTurn['action'], 'source'>,
    outcome: EntityTurn['outcome'],
    nextObservation: any,
    completedAt = now(),
  ) {
    const sequence = entitySequence + 1;
    const turn: EntityTurn = {
      protocol: 'behold.entity-turn.v1',
      ...(draft.observation?.circle?.id ? { circleId: String(draft.observation.circle.id) } : {}),
      id: `${entityId}:turn:${sequence}`,
      entityId,
      sequence,
      parentId: parentTurnId,
      model: draft.model,
      attention: draft.attention,
      startedAt: draft.startedAt,
      completedAt,
      observation: draft.observation,
      utterance: { assistant: draft.assistant },
      action: { ...action, source: 'llm' },
      outcome,
      nextObservation,
    };
    await opts.onEntityTurn?.(turn);
    loomContext.append(turn);
    recordEmbodiedOutcome(turn.action.name, turn.outcome.ok);
    rebuildMessagesFromLoom();
    entitySequence = sequence;
    parentTurnId = turn.id;
  }

  function recordEmbodiedOutcome(tool: string, ok: boolean) {
    if (!EMBODIED_ACTION_TOOLS.has(tool) || ok) {
      failedEmbodiedTool = null;
      failedEmbodiedCount = 0;
      return;
    }
    if (tool === failedEmbodiedTool) failedEmbodiedCount += 1;
    else {
      failedEmbodiedTool = tool;
      failedEmbodiedCount = 1;
    }
  }

  function rebuildMessagesFromLoom() {
    const view = loomContext.view();
    messages.splice(
      1,
      Math.max(0, messages.length - 1),
      ...(view.fold ? [foldMessage(view.fold)] : []),
      ...historyMessages(
        view.turns,
        (observation, context) =>
          projectHistoricalModelObservation(
            observation,
            context.phase === 'nextObservation'
              ? context.turn.observation
              : context.previousTurn?.nextObservation,
            context.phase === 'nextObservation'
              ? 'same_turn_observation'
              : 'previous_turn_next_observation',
          ),
        residentTurnMayReplay,
      ),
    );
  }

  function start() {
    if (!stopped && !timer) timer = setInterval(() => void wake(), tickMs);
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopped = true;
    suspended = true;
    wakeQueued = false;
    turnActive = false;
    turnSteps = 0;
    if (timer) clearInterval(timer);
    timer = null;
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = null;
    stopPromise = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    activeModelRequest?.abort(abortError('policy stopped'));
    settleStop();
    return stopPromise;
  }

  function suspend(reason = 'human_stop') {
    suspended = true;
    wakeQueued = false;
    turnActive = false;
    turnSteps = 0;
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = null;
    log(`[policy] suspended: ${reason}`);
  }

  function resume() {
    if (stopped) return;
    consecutiveCommunicationActions = 0;
    if (!suspended) {
      void wake();
      return;
    }
    suspended = false;
    log('[policy] resumed by world interaction');
    void wake(true);
  }

  async function withModelRequest<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (stopped) throw abortError('policy stopped');
    if (activeModelRequest) throw new Error('a model request is already active');
    const controller = new AbortController();
    activeModelRequest = controller;
    try {
      return await operation(controller.signal);
    } finally {
      if (activeModelRequest === controller) activeModelRequest = null;
      settleStop();
    }
  }

  function settleStop() {
    if (!stopped || deciding || preparingContext || activeModelRequest) return;
    const resolve = resolveStop;
    resolveStop = null;
    resolve?.();
  }

  return {
    start,
    stop,
    tick: () => wake(true),
    wake: () => void wake(),
    suspend,
    resume,
    onEngineEvent,
    shouldReclaimModelAction: (event: { type?: unknown; salience?: unknown }) =>
      bodilyUrgencyReclaimsModelAction(event, pending?.draft.attention ?? null),
    state: () => ({
      turnActive,
      turnSteps,
      pendingIntentId: pending?.intent.id ?? null,
      lastSequence,
      messageCount: messages.length,
      entityTurns: entitySequence,
      suspended,
      stopped,
      modelRequestActive: activeModelRequest !== null,
      loomMaintenanceScheduled,
      loomMaintenanceActive,
      loomContext: loomContext.state(),
    }),
  };
}

function completedBodilyResponse(tool: string, result: any) {
  if (!BODILY_RESPONSE_TOOLS.has(tool) || result?.ok !== true) return false;
  if (result?.bodyMoved === false) return false;
  if (result?.status === 'already_within_requested_range') return false;
  return true;
}

export function controllerSystemPrompt(
  specs: readonly ToolSpec[],
  profile: ResidentPolicyProfile = 'resident-v1',
) {
  if (isNeutralPolicy(profile)) {
    return [
      'You are embodied in Minecraft and receive only this body’s bounded lived observation.',
      'Choose exactly one currently admitted action, or explicitly yield when you choose not to act.',
      'An action is only a proposal until Minecraft returns its terminal result; do not claim an unobserved consequence.',
    ].join('\n');
  }
  const tools = new Set(specs.map((spec) => spec.function.name));
  const hasAny = (...names: string[]) => names.some((name) => tools.has(name));
  const lines = [
    'You are a persistent embodied Minecraft entity.',
    'Observe, then choose exactly one available action. Its real result becomes your next observation; adapt to failures and denials. Your trajectory is your continuing identity.',
    'State one short public intention before acting. If it is setup, name the target or purpose that must survive it. This is replayable continuity, not private reasoning or proof of success.',
    `Use ${WAIT_TOOL} only for a needed external event or when no useful self-directed action remains; Minecraft continues while you wait.`,
    'A task gives goals and constraints, not hidden next actions. Keep your own commitments. Its explicit ordering, preconditions, and prohibitions take precedence over the generic action heuristics below.',
    'Without a task, live: protect your body; learn the place; gain materials, tools, food, light, shelter, and sleep; improve useful shared places.',
    'task, self, scene, and events are present experience; isNew marks unread events. scene.entities are only unoccluded bodies in current first-person view. scene.terrain.visualField is a coarse top-down, left-right grid of current first-hit rays, not surrounding geometry; no-hit proves neither safety nor empty space. sound_heard has coarse direction and distance, never hidden coordinates.',
  ];
  if (tools.has(MANAGE_PROJECT_TOOL)) {
    lines.push(
      'self.projects is your bounded restart memory from your loom. Every listed project has status active_unfinished: doneWhen is a future Minecraft condition and completionRequires names the future evidence channel, never evidence that the condition is already true. Bookmark durable outcomes needing several actions—not walking, inspection, transfers, equipment, or cleanup. Keep one focus; resolve overlaps. Survey and choice are steps, not outcomes. Already-true, waiting, and idle conditions are invalid. Use world_change for construction and time_elapsed for a concrete future time. Complete only after a matching post-start witness. Completion is your grounded conclusion, not external world certification.',
    );
  }
  if (hasAny('cross_visible_door', 'cross_place_door', MANAGE_PROJECT_TOOL)) {
    lines.push(
      `self.places is bounded own-loom memory, not current server truth: re-observe near its anchor before relying on condition. Prefer using or improving a reachable known affordance over duplicating it.${
        tools.has(MANAGE_PROJECT_TOOL)
          ? ' Resolve self.placeConflicts with manage_project before building.'
          : ''
      }`,
    );
  }
  if (tools.has('cross_visible_door')) {
    lines.push(
      'Use cross_visible_door on the exact reachable scene.focus.id when you are facing a wooden door from an adjacent side. It owns opening, crossing that selected aperture, confirming arrival, and optional closing. rememberAs names only the route you actually crossed; it never proves inside, safety, enclosure, or ownership.',
    );
  }
  if (tools.has('cross_place_door')) {
    lines.push(
      'Use cross_place_door only when you already stand on one side of a route in self.places. It turns to and re-observes the remembered door before crossing either direction; a stale or different world route fails closed.',
    );
  }
  if (tools.has(COLLECT_TOOL)) {
    lines.push(
      'After death, dropped inventory expires. Weigh recovery against your body, creatures, distance, and terrain. pickupGround describes only the ground directly beneath it, not a safe approach.',
    );
  }
  if (hasAny('chat', 'whisper', 'approach_entity', 'drop_item')) {
    lines.push(
      'Speaking is an action. Conversation may remain open while life continues; after speaking, pursue another concern unless its answer gates the next action.',
      'A successful action proves only its reported consequence for named entities. Moving moves you; chat proves you spoke. Neither proves another entity followed, arrived, learned, received something, or stayed safe. For joint activity: keep the concern unfinished, establish proximity, take short actions, and observe the other entity again before claiming shared progress.',
      'Without an interacting human, do not ask the empty server what to do; continue your own concern.',
      'scene.social.playersOnline is roster presence, not proximity. Empty means no chat recipient; null means unknown.',
      'Minecraft chat is narrow: use one short sentence, normally under 120 characters. Teach in tiny embodied loops and require evidence before advancing.',
      'You cannot inspect another player’s inventory; use heldItem, nearby collection evidence, or ask them to show or confirm.',
      'Respond naturally to a human, clarify ambiguous spatial references, and never claim success before completion.',
    );
  }
  if (tools.has('approach_entity')) {
    lines.push(
      'Use approach_entity for a visible person: choose the exact scene id. It owns pursuit and succeeds only after confirming current proximity.',
    );
  }
  if (tools.has('look_direction')) {
    lines.push(
      'You see only where you face. Use look_direction to orient or seek an entrance. Before breaking intact construction merely to navigate, look for an ordinary route unless danger forbids it.',
    );
  }
  if (tools.has('face_visible_target')) {
    lines.push(
      'scene.terrain.targets are bounded exact first-hit surfaces from the current camera rays. Use face_visible_target to turn toward one already-visible surface before a cursor-gated interaction; it does not search, approach, use, or prove the target stayed unchanged.',
    );
  }
  if (tools.has('move_direction')) {
    lines.push(
      'move_direction explores relative to view; move_to is for visible, communicated, or remembered positions. Looking and walking are not projects.',
    );
  }
  if (hasAny('find_blocks', 'dig_block')) {
    lines.push(
      'Terrain samples and find_blocks identify loaded local blocks, not line of sight. Move and look when that matters.',
      'If resources are elevated or unreachable, widen find_blocks to the material name; for wood use name "log", distance 32, and prefer likelyGrounded.',
      'dig_block selects one current visual target and owns facing and approach. If openedBodyPassages is nonempty, move through one before mining more.',
    );
  }
  if (hasAny('inspect_volume', 'place_block', 'place_against')) {
    lines.push(
      'For deliberate building, use inspect_volume at the worksite for exact loaded geometry. Target air or replaceable vegetation; place one block at a time and reinspect uncertain shapes. bodyFeet and protected body cells are occupied by bodies; never target them or another non-replaceable cell.',
    );
  }
  if (tools.has('inspect_reachable_space')) {
    lines.push(
      'Run inspect_reachable_space inside. Shared shelter requires sealed=true, fullyCovered=true, sharedCapacity=true, closableEntranceCount>=1, and a crafting or storage amenity. A doorless sealed box is unfinished.',
    );
  }
  if (tools.has('place_against')) {
    lines.push('Use place_against only when the particular reference face matters.');
  }
  if (hasAny('dig_block', 'descend_step', 'ascend_step')) {
    lines.push(
      'Never dig under your feet or improvise a shaft. descend_step makes a supported cardinal stair; ascend_step leaves in the opposite direction. After digging, adjacentBlocks may reveal a connected vein or trunk.',
    );
  }
  if (hasAny('craft_item', 'equip', 'consume', 'sleep_in_bed', 'attack_entity')) {
    lines.push('Crafting, equipping, eating, sleeping, and defense are ordinary self-care.');
  }
  if (hasAny('inspect_volume', 'inspect_reachable_space', 'inspect_container', 'status')) {
    lines.push('When uncertain, inspect first; then act from its evidence.');
  }
  if (tools.has('survey_area')) {
    lines.push(
      'survey_area is privileged symbolic sensing. Use it only when the task or a human explicitly permits it.',
    );
  }
  lines.push(
    'Repeat no failed action without new evidence or changed input, and never merely because a timer fired. Continue from existing results and events.',
  );
  return lines.join('\n');
}

function trailingCommunicationActions(turns: EntityTurn[]) {
  let count = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (!COMMUNICATION_TOOLS.has(turns[index].action.name)) break;
    count += 1;
  }
  return count;
}

function trailingFailedEmbodiedActions(turns: EntityTurn[]) {
  const last = turns.at(-1);
  if (!last || last.outcome.ok || !EMBODIED_ACTION_TOOLS.has(last.action.name)) {
    return { tool: null as string | null, count: 0 };
  }
  let count = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.outcome.ok || turn.action.name !== last.action.name) break;
    count += 1;
  }
  return { tool: last.action.name, count };
}

function requiredSelfDirectionTool(frame: any, specs: ToolSpec[], allow: Set<string> | null) {
  const falling =
    frame?.self?.pose?.onGround === false &&
    Number.isFinite(Number(frame?.self?.pose?.velocity?.y)) &&
    Number(frame.self.pose.velocity.y) <= -0.8;
  if (falling && specs.some((spec) => spec.function.name === WAIT_TOOL)) return WAIT_TOOL;
  if (!specs.some((spec) => spec.function.name === MANAGE_PROJECT_TOOL)) return null;
  if (!frame || frame.task != null) return null;
  const condition = frame?.self?.condition || {};
  if (finiteAtMost(condition.health, 10)) return null;
  if (finiteAtMost(condition.food, 6)) return null;
  if (finiteAtMost(condition.oxygen, 8)) return null;
  const projects = frame?.self?.projects;
  if (!Array.isArray(projects)) return null;
  if (
    (!allow || allow.has(MANAGE_PROJECT_TOOL)) &&
    (projects.length > 1 ||
      projects.some((project: any) => project?.needsDefinition === true) ||
      (Array.isArray(frame?.self?.placeConflicts) && frame.self.placeConflicts.length > 0))
  ) {
    return MANAGE_PROJECT_TOOL;
  }
  return null;
}

function availableModelTools(
  specs: ToolSpec[],
  frame: any,
  attention: ResidentAttention = attentionForObservation(frame),
  profile: ResidentPolicyProfile = 'resident-v1',
) {
  return specs.filter((spec) => {
    // A project record is private continuity bookkeeping, not an embodied
    // Minecraft response. Preserve every ordinary player affordance during
    // urgent attention, but defer bookkeeping until the body is no longer
    // demanding an immediate choice.
    if (
      !isNeutralPolicy(profile) &&
      (hasBodilyUrgency(attention) || isCriticalBodyCondition(frame?.self?.condition)) &&
      spec.function.name === MANAGE_PROJECT_TOOL
    ) {
      return false;
    }
    return true;
  });
}

function actionsOfferedByEnvironment(
  environment: InhabitantInterface,
  observation: any,
  fallback: ToolSpec[],
  executableCatalog: ReadonlyMap<string, ToolSpec>,
  log: (message: string) => void,
) {
  if (!environment.actionsFor) return fallback;
  let offered: readonly ToolSpec[];
  try {
    offered = environment.actionsFor(observation);
  } catch (error: any) {
    log(`[policy] world affordance resolution failed: ${error?.message || String(error)}`);
    return [];
  }
  if (!Array.isArray(offered)) {
    log('[policy] world affordance resolution failed: actionsFor returned a non-array');
    return [];
  }
  const seen = new Set<string>();
  return offered.flatMap((spec) => {
    const name = String(spec?.function?.name || '');
    const catalog = executableCatalog.get(name);
    if (!name || !catalog) {
      log(`[policy] rejected world-offered capability absent from catalog: ${name || '(missing)'}`);
      return [];
    }
    if (seen.has(name)) {
      log(`[policy] rejected duplicate world-offered capability: ${name}`);
      return [];
    }
    if (!isActionSchemaNarrowing(catalog.function.parameters, spec.function.parameters)) {
      log(`[policy] rejected broadened world-offered schema: ${name}`);
      return [];
    }
    seen.add(name);
    return [
      {
        ...catalog,
        function: {
          ...catalog.function,
          parameters: cloneJson(spec.function.parameters),
        },
      },
    ];
  });
}

export function isActionSchemaNarrowing(catalog: unknown, offered: unknown) {
  if (!isDeepStrictEqual(withoutNarrowingKeywords(catalog), withoutNarrowingKeywords(offered))) {
    return false;
  }
  const catalogEnums = enumPaths(catalog);
  const offeredEnums = enumPaths(offered);
  for (const [path, allowed] of catalogEnums) {
    const narrowed = offeredEnums.get(path);
    if (!narrowed || !narrowed.every((candidate) => includesJson(allowed, candidate))) return false;
  }
  if (
    ![...offeredEnums.values()].every(
      (values) => values.length > 0 && values.every((value) => typeof value === 'string'),
    )
  ) {
    return false;
  }
  return numericBoundsNarrow(catalog, offered);
}

function withoutNarrowingKeywords(value: any): any {
  if (Array.isArray(value)) return value.map(withoutNarrowingKeywords);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'enum' && key !== 'minimum' && key !== 'maximum')
      .map(([key, item]) => [key, withoutNarrowingKeywords(item)]),
  );
}

function numericBoundsNarrow(catalog: unknown, offered: unknown) {
  const catalogBounds = numericBounds(catalog);
  const offeredBounds = numericBounds(offered);
  const paths = new Set([...catalogBounds.keys(), ...offeredBounds.keys()]);
  for (const path of paths) {
    const baseline = catalogBounds.get(path) || {};
    const narrowed = offeredBounds.get(path) || {};
    if (
      (narrowed.minimum != null && !Number.isFinite(narrowed.minimum)) ||
      (narrowed.maximum != null && !Number.isFinite(narrowed.maximum)) ||
      (narrowed.minimum != null && narrowed.maximum != null && narrowed.minimum > narrowed.maximum)
    ) {
      return false;
    }
    if (
      baseline.minimum != null &&
      (narrowed.minimum == null || narrowed.minimum < baseline.minimum)
    ) {
      return false;
    }
    if (
      baseline.maximum != null &&
      (narrowed.maximum == null || narrowed.maximum > baseline.maximum)
    ) {
      return false;
    }
  }
  return true;
}

function numericBounds(
  value: any,
  path = '$',
  found = new Map<string, { minimum?: number; maximum?: number }>(),
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => numericBounds(item, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  if (Object.hasOwn(value, 'minimum') || Object.hasOwn(value, 'maximum')) {
    found.set(path, {
      ...(Object.hasOwn(value, 'minimum') ? { minimum: Number(value.minimum) } : {}),
      ...(Object.hasOwn(value, 'maximum') ? { maximum: Number(value.maximum) } : {}),
    });
  }
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'minimum' && key !== 'maximum') numericBounds(item, `${path}.${key}`, found);
  }
  return found;
}

function enumPaths(value: any, path = '$', found = new Map<string, any[]>()) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => enumPaths(item, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value.enum)) found.set(path, value.enum);
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'enum') enumPaths(item, `${path}.${key}`, found);
  }
  return found;
}

function includesJson(values: any[], candidate: any) {
  return values.some((value) => isDeepStrictEqual(value, candidate));
}

function finiteAtMost(value: unknown, threshold: number) {
  if (value == null) return false;
  const number = Number(value);
  return Number.isFinite(number) && number <= threshold;
}

function abortError(message: string) {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? abortError('operation aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? abortError('operation aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function hasUnfinishedAction(frame: any) {
  const status = frame?.self?.currentAction?.status;
  return (
    status === 'queued' || status === 'selected' || status === 'started' || status === 'running'
  );
}

export function modelDecisionInvalidation(frame: any, afterSequence: number) {
  const missing = Number(frame?.eventWindow?.missingBeforeOldest || 0);
  if (missing > 0) {
    return {
      reason: 'observation_gap_after_decision',
      afterSequence,
      observedThroughSequence: Number(frame?.sequence) || null,
      missingBeforeOldest: missing,
      invalidatingEvents: [],
    };
  }
  const lifeBoundaryTypes = new Set(['died', 'spawned', 'dimension_changed']);
  const invalidatingEvents = (Array.isArray(frame?.events) ? frame.events : [])
    .filter(
      (event: any) =>
        Number(event?.sequence) > afterSequence && lifeBoundaryTypes.has(String(event?.type || '')),
    )
    .map((event: any) => ({
      sequence: Number(event.sequence),
      at: Number(event.at) || null,
      type: String(event.type),
    }));
  if (!invalidatingEvents.length) return null;
  return {
    reason: 'body_life_boundary_changed',
    afterSequence,
    observedThroughSequence: Number(frame?.sequence) || null,
    missingBeforeOldest: 0,
    invalidatingEvents,
  };
}

export function isImmediateAttentionEvent(event: { salience?: unknown }) {
  return event?.salience === 'high' || event?.salience === 'urgent';
}

export function isBodilyUrgencyEvent(event: { type?: unknown; salience?: unknown }) {
  return event?.salience === 'urgent' && BODILY_URGENCY_EVENT_TYPES.has(String(event?.type || ''));
}

/**
 * Reclaim stale ordinary work for a new body crisis, but do not repeatedly
 * cancel the bounded response that urgent cognition already selected for that
 * crisis. Its terminal result and accumulated events force a fresh observation
 * immediately afterward. Life-boundary events remain preemptive regardless.
 */
export function bodilyUrgencyReclaimsModelAction(
  event: { type?: unknown; salience?: unknown },
  selectedAttention: Pick<ResidentAttention, 'mode'> | null | undefined,
) {
  if (!isBodilyUrgencyEvent(event)) return false;
  if (['died', 'dimension_changed'].includes(String(event?.type || ''))) return true;
  return selectedAttention?.mode !== 'urgent';
}

export function attentionForObservation(frame: any): ResidentAttention {
  const triggers = urgentEventTriggers(frame, -1);
  return triggers.length > 0
    ? { mode: 'urgent', context: 'current_body_and_continuity', triggers }
    : { mode: 'deliberative', context: 'bounded_loom', triggers: [] };
}

export function boundedUrgentDecisionTimeoutMs(value: unknown) {
  const numeric = Number(value ?? DEFAULT_URGENT_DECISION_TIMEOUT_MS);
  if (!Number.isFinite(numeric)) return DEFAULT_URGENT_DECISION_TIMEOUT_MS;
  return Math.max(100, Math.min(60_000, Math.floor(numeric)));
}

export function boundedLoomFoldOutputTokens(value: unknown) {
  const numeric = Number(value ?? DEFAULT_LOOM_FOLD_MAX_OUTPUT_TOKENS);
  if (!Number.isFinite(numeric)) return DEFAULT_LOOM_FOLD_MAX_OUTPUT_TOKENS;
  return Math.max(128, Math.min(4_096, Math.floor(numeric)));
}

function urgentEventTriggers(frame: any, afterSequence: number): ResidentAttention['triggers'] {
  return (Array.isArray(frame?.events) ? frame.events : [])
    .filter(
      (event: any) =>
        Number(event?.sequence) > afterSequence &&
        event?.isNew !== false &&
        event?.salience === 'urgent',
    )
    .map((event: any) => ({
      sequence: Number(event.sequence),
      type: String(event.type || 'unknown'),
      salience: 'urgent' as const,
    }));
}

function conversationForAttention(
  messages: readonly any[],
  attention: ResidentAttention,
  availableTools?: readonly ToolSpec[],
  recentActionContinuity?: RecentActionContinuity | null,
  profile: ResidentPolicyProfile = 'resident-v1',
) {
  const bodilyUrgency = hasBodilyUrgency(attention);
  const continuingBodyPressure = attention.continuingCondition === 'critical_body_condition';
  const system = availableTools
    ? { role: 'system', content: controllerSystemPrompt(availableTools, profile) }
    : messages[0];
  const foldedContinuity = messages
    .slice(1, -1)
    .filter(
      (message) =>
        message?.role === 'system' &&
        String(message?.content || '').startsWith('Folded view of your own loom'),
    )
    .at(-1);
  const residentUrgentHandoff = {
    role: 'system',
    content: [
      bodilyUrgency
        ? continuingBodyPressure
          ? 'Continuing bodily urgency: the last attempted response failed and the critical condition remains.'
          : 'Urgent attention handoff: slow deliberation was superseded by newly lived bodily evidence.'
        : 'Ongoing critical body pressure: an immediate response executed, so recovery may be deliberate while the condition remains current.',
      `Triggers: ${
        attention.triggers.map((trigger) => `${trigger.type}@${trigger.sequence}`).join(', ') ||
        (continuingBodyPressure ? 'current critical body condition' : 'current urgent observation')
      }.`,
      ...(attention.decisionBudgetMs
        ? [`Decision deadline: ${attention.decisionBudgetMs}ms of wall time.`]
        : []),
      ...(bodilyUrgency
        ? [
            'Reassess the current body and scene. Treat interrupted work as stale until the immediate danger or critical condition is mitigated.',
            'Choose an action whose immediate expected consequence addresses the danger or obtains perception needed to do so. Movement, cover, defense, food, and escape are ordinary Minecraft possibilities only when current evidence supports them. Do not continue unrelated construction while taking active damage or critically low on health.',
            'At critical health during active harm, prefer an action that changes exposure now. A perception-only action is safe only when acting without that perception would be worse and the body can survive the delay.',
            'A threat leaving the camera is not proof of safety. When no hostile is currently visible, do not flee blindly forever; use a bounded look or current terrain and inventory evidence to locate food, defensible cover, or a safe route.',
            'Every admitted embodied action remains available; private project bookkeeping is deferred until bodily urgency ends. No response has been selected for you.',
          ]
        : continuingBodyPressure
          ? [
              'Use the current body, egocentric scene, inventory, and recent consequences to plan the next grounded recovery step. Survival remains the priority, but no new urgent event has preselected an action.',
              'Do not convert remembered or inferred safety into current fact. Seek food, defensible terrain, or another ordinary Minecraft mitigation only through available evidence and verified consequences.',
              'Private project bookkeeping and memory maintenance remain deferred until the body leaves the critical range.',
            ]
          : [
              'Reassess the current body, scene, and social event. The ordinary admitted action surface is unchanged, and no response has been selected for you.',
            ]),
    ].join('\n'),
  };
  const urgentHandoff = isNeutralPolicy(profile)
    ? {
        role: 'system',
        content: [
          'A newer lived observation superseded unfinished model work. No interrupted proposal executed unless a terminal result says it did.',
          `Attention evidence: ${
            attention.triggers.map((trigger) => `${trigger.type}@${trigger.sequence}`).join(', ') ||
            attention.continuingCondition ||
            'current observation'
          }.`,
          ...(attention.decisionBudgetMs
            ? [`Decision deadline: ${attention.decisionBudgetMs}ms of wall time.`]
            : []),
          'The admitted action surface is unchanged by this notice, and no response has been selected or recommended.',
        ].join('\n'),
      }
    : residentUrgentHandoff;
  const recentActions = recentActionContinuity
    ? {
        role: 'system',
        content: [
          'Recent lived action continuity from your own entity loom. This is bounded historical evidence; the current observation wins whenever state has changed.',
          'Any first-person glimpses are past camera views retained as perceptual working memory. Compare their orientations, but do not treat them as current geometry, a panorama, or proof of safety.',
          JSON.stringify(recentActionContinuity),
        ].join('\n'),
      }
    : null;
  const current = messages.at(-1);
  if (attention.context === 'bounded_loom') {
    return [system, ...(foldedContinuity ? [foldedContinuity] : []), recentActions, current].filter(
      Boolean,
    );
  }
  return [
    system,
    ...(foldedContinuity ? [foldedContinuity] : []),
    ...(recentActions ? [recentActions] : []),
    urgentHandoff,
    current,
  ].filter(Boolean);
}

function hasBodilyUrgency(attention: ResidentAttention) {
  return attention.mode === 'urgent' && attention.triggers.some(isBodilyUrgencyEvent);
}

export function hasDecisionRelevantEvent(frame: any, lastSequence: number) {
  if (
    (frame?.protocol !== 'behold.inhabitant.v1' && frame?.protocol !== 'behold.inhabitant.v2') ||
    lastSequence === 0
  ) {
    return true;
  }
  const relevant = new Set([
    'spawned',
    'chat_received',
    'condition_changed',
    'visible_block_changed',
    'block_changed_nearby',
    'time_passed',
    'day_phase_changed',
    'weather_changed',
    'inventory_changed',
    'item_collected',
    'nearby_player_collected_item',
    'nearby_player_equipment_changed',
    'visible_player_collected_item',
    'visible_player_equipment_changed',
    'self_hurt',
    'visible_entity_hurt',
    'visible_entity_died',
    'entity_became_visible',
    'entity_left_view',
    'sound_heard',
    'entity_hurt_nearby',
    'entity_died_nearby',
    'entity_appeared_nearby',
    'fell_asleep',
    'woke_up',
    'died',
    'dimension_changed',
    'task_updated',
    'action_completed',
    'action_failed',
    'tool_error',
    'intent_blocked',
  ]);
  return (frame?.events || []).some((event: any) => {
    if (!event?.isNew || !relevant.has(event.type)) return false;
    if (event.type === 'chat_received') return relevantChat(event, frame);
    if (event.type === 'condition_changed' && !['high', 'urgent'].includes(event.salience)) {
      return false;
    }
    if (
      [
        'entity_appeared_nearby',
        'entity_became_visible',
        'entity_left_view',
        'sound_heard',
      ].includes(event.type) &&
      !['high', 'urgent'].includes(String(event.salience))
    ) {
      return false;
    }
    if (
      event.type === 'action_completed' &&
      ['chat', 'whisper'].includes(String(event?.data?.intent?.tool || ''))
    ) {
      return false;
    }
    return true;
  });
}

function relevantChat(event: any, frame: any) {
  if (event?.data?.addressed === true) return true;
  const from = String(event?.data?.from || '').toLowerCase();
  if (!from || from === 'server') return false;
  const target = String(frame?.task?.target || '').toLowerCase();
  if (target && from === target) return true;
  return (frame?.scene?.entities || []).some(
    (entity: any) =>
      String(entity?.name || '').toLowerCase() === from && Number(entity?.distance) <= 24,
  );
}

async function summarizeLoom(request: LoomFoldRequest, opts: Options, signal: AbortSignal) {
  const messages = [
    {
      role: 'system',
      content: [
        "You are producing a bounded, non-authoritative view of one entity's append-only loom.",
        'The source turns remain authoritative. Do not invent events, motives, possessions, agreements, or success.',
        'Preserve what may change the entity’s next decisions: unresolved projects and commitments, unfinished joint activities, relationships, places and artifacts, body or inventory state, learned constraints, failures, interaction preferences, and consequential world changes.',
        'Distinguish direct observation from what another character said and from the entity’s own inference.',
        'When later evidence revises an earlier belief, update the view instead of preserving both as equally current.',
        'Use compact prose and cite supporting turn anchors such as [t42].',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        entityId: request.entityId,
        foldedRange: [request.fromSequence, request.toSequence],
        previousFoldedView: request.previousSummary,
        newLoomEvidence: request.turns,
      }),
    },
  ];
  const body = {
    model: opts.model,
    messages,
    max_tokens: boundedLoomFoldOutputTokens(opts.foldMaxOutputTokens),
    ...(opts.model.includes('gpt-5') ? {} : { temperature: 0.1 }),
  };
  const requestId = rid('model-aux');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.apiKey}`,
    ...(opts.cognitionTransport
      ? cognitionClientHeaders({
          requestId,
          priority: 'auxiliary',
          purpose: 'loom_fold',
          urgentTriggerSequence: null,
        })
      : {}),
  };
  if (process.env.OPENROUTER_REFERER)
    headers['HTTP-Referer'] = String(process.env.OPENROUTER_REFERER);
  if (process.env.OPENROUTER_TITLE) headers['X-Title'] = String(process.env.OPENROUTER_TITLE);
  const endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  const startedAt = opts.now ? opts.now() : Date.now();
  const requestBody = JSON.stringify(body);
  const requestEvidence = {
    model: opts.model,
    messageCount: messages.length,
    toolCount: 0,
    toolChoice: null,
    bodySha256: sha256(requestBody),
    bodyBytes: Buffer.byteLength(requestBody, 'utf8'),
    byteAttribution: attributeProviderRequestBody(body),
    messagesSha256: sha256(stableJson(messages)),
    toolsSha256: sha256(stableJson([])),
    kind: 'provider_request' as const,
    ...(opts.recordModelIO ? { body: JSON.parse(requestBody) } : {}),
  };
  let response: Response;
  try {
    response = await fetch(endpoint, { method: 'POST', headers, body: requestBody, signal });
  } catch (error: any) {
    const completedAt = opts.now ? opts.now() : Date.now();
    const call: ModelCallFailureEvidence = {
      protocol: 'behold.model-call.v1',
      adapter: { name: 'direct-openrouter' },
      requestId,
      endpoint: safeEndpoint(endpoint),
      startedAt,
      completedAt,
      latencyMs: Math.max(0, completedAt - startedAt),
      request: requestEvidence,
      response: { status: null, bodyPreview: null },
    };
    if (!signal.aborted) {
      opts.onAuxiliaryModelError?.({
        at: completedAt,
        model: opts.model,
        purpose: 'loom_fold',
        error: error?.message || String(error),
        call,
      });
    }
    throw new ModelCallError(`loom fold network error: ${error?.message || String(error)}`, call);
  }
  if (!response.ok) {
    const text = await response.text();
    const completedAt = opts.now ? opts.now() : Date.now();
    const call: ModelCallFailureEvidence = {
      protocol: 'behold.model-call.v1',
      adapter: { name: 'direct-openrouter' },
      requestId,
      endpoint: safeEndpoint(endpoint),
      startedAt,
      completedAt,
      latencyMs: Math.max(0, completedAt - startedAt),
      ...admissionEvidence(response),
      request: requestEvidence,
      response: { status: response.status, bodyPreview: text.slice(0, 200) || null },
    };
    opts.onAuxiliaryModelError?.({
      at: completedAt,
      model: opts.model,
      purpose: 'loom_fold',
      error: `loom fold ${response.status}: ${text.slice(0, 200)}`,
      call,
    });
    throw new ModelCallError(`loom fold ${response.status}: ${text.slice(0, 200)}`, call);
  }
  const data: any = await response.json();
  const completedAt = opts.now ? opts.now() : Date.now();
  const call: ModelCallEvidence = {
    protocol: 'behold.model-call.v1',
    adapter: { name: 'direct-openrouter' },
    requestId,
    endpoint: safeEndpoint(endpoint),
    startedAt,
    completedAt,
    latencyMs: Math.max(0, completedAt - startedAt),
    ...admissionEvidence(response),
    request: requestEvidence,
    response: {
      id: stringOrNull(data?.id),
      model: stringOrNull(data?.model),
      provider: stringOrNull(data?.provider),
      finishReason: stringOrNull(data?.choices?.[0]?.finish_reason),
      nativeFinishReason: stringOrNull(data?.choices?.[0]?.native_finish_reason),
      usage: cloneJson(data?.usage ?? null),
      ...(opts.recordModelIO ? { raw: cloneJson(data) } : {}),
    },
  };
  opts.onAuxiliaryModelCall?.({
    at: completedAt,
    model: opts.model,
    purpose: 'loom_fold',
    call,
  });
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('loom fold returned no summary text');
  }
  return content.trim();
}

/**
 * Convert a framework-neutral proposal into the existing resident coroutine's
 * internal form. This is deliberately the last trust boundary before an
 * Intent can be minted.
 */
function validateMindDecision(
  decision: ResidentMindDecision,
  admittedActions: readonly ToolSpec[],
  requiredAction: string | null,
  expectedModel: string,
  expectedMindRequestSha256: string,
): ModelDecision {
  if (decision?.protocol !== 'behold.mind-decision.v1') {
    throw new Error('mind returned an unsupported decision protocol');
  }
  if (decision.call?.protocol !== 'behold.model-call.v1') {
    throw new Error('mind returned no inspectable model-call evidence');
  }

  if (
    decision.call.request?.mindRequestSha256 != null &&
    decision.call.request.mindRequestSha256 !== expectedMindRequestSha256
  ) {
    throw new MindDecisionError(
      'mind call evidence refers to a different resident mind request',
      decision.call,
    );
  }
  const call: ModelCallEvidence = {
    ...decision.call,
    request: {
      ...decision.call.request,
      mindRequestSha256: expectedMindRequestSha256,
    },
  };
  const admitted = new Set(admittedActions.map((spec) => spec.function.name));
  const fail = (message: string): never => {
    throw new MindDecisionError(message, call);
  };
  if (decision.call.request?.model !== expectedModel) {
    fail(
      `mind call evidence model ${String(decision.call.request?.model)} does not match requested model ${expectedModel}`,
    );
  }
  const content = typeof decision.utterance === 'string' ? decision.utterance : null;

  if (decision.disposition === 'no_action') {
    if (requiredAction) fail(`mind yielded no action while ${requiredAction} was required`);
    if (decision.action) fail('mind attached an action to a no_action decision');
    return {
      assistant: canonicalAssistant(decision, content, null),
      intent: null,
      toolCallId: null,
      wait: false,
      call,
    };
  }

  if (decision.disposition !== 'act' && decision.disposition !== 'wait') {
    fail(`mind returned unknown disposition ${String(decision.disposition)}`);
  }
  const proposed = decision.action;
  const name = decision.disposition === 'wait' ? WAIT_TOOL : String(proposed?.name || '');
  if (!name) fail('mind proposed an action without a name');
  if (decision.disposition === 'act' && proposed?.name !== name) {
    fail('mind proposed a malformed action name');
  }
  if (!admitted.has(name)) fail(`mind proposed unadmitted action ${name}`);
  if (requiredAction && name !== requiredAction) {
    fail(`mind proposed ${name} while ${requiredAction} was required`);
  }

  const input =
    name === WAIT_TOOL && proposed?.input == null
      ? { reason: content || 'waiting for a world event' }
      : (proposed?.input ?? {});
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    fail(`mind proposed non-object input for ${name}`);
  }
  const admittedSpec = admittedActions.find((spec) => spec.function.name === name)!;
  const validation = validateResidentActionInput(
    input,
    admittedSpec.function.parameters ?? { type: 'object', properties: {} },
  );
  if (validation.ok === false) {
    fail(`mind proposed invalid input for ${name}: ${validation.errors.join('; ')}`);
  }
  const toolCallId = String(proposed?.callId || rid('mind'));
  const assistant = canonicalAssistant(decision, content, {
    id: toolCallId,
    type: 'function',
    function: { name, arguments: JSON.stringify(input) },
  });
  if (name === WAIT_TOOL) {
    return {
      assistant,
      intent: null,
      toolCallId,
      wait: true,
      call,
    };
  }
  return {
    assistant,
    intent: toIntent(name, input),
    toolCallId,
    wait: false,
    call,
  };
}

function canonicalAssistant(
  decision: ResidentMindDecision,
  content: string | null,
  toolCall: unknown | null,
) {
  const record =
    decision.adapterRecord &&
    typeof decision.adapterRecord === 'object' &&
    !Array.isArray(decision.adapterRecord)
      ? cloneJson(decision.adapterRecord)
      : {};
  const assistant: any = { ...record, role: 'assistant', content };
  if (toolCall) assistant.tool_calls = [toolCall];
  else delete assistant.tool_calls;
  return assistant;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function safeEndpoint(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split('?')[0];
  }
}

function admissionEvidence(response: Response | undefined) {
  if (!response?.headers || typeof response.headers.get !== 'function') return {};
  const admission = parseCognitionAdmission(response.headers);
  return admission ? { admissions: [admission] } : {};
}

function stringOrNull(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function cloneJson(value: unknown) {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizeAssistant(assistant: any) {
  return assistant?.role === 'assistant' ? assistant : { role: 'assistant', ...assistant };
}

function parseToolArguments(value: any) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function terminalResult(event: EngineEvent) {
  if (event.type === 'action_completed') {
    return {
      ok: true,
      eventType: event.type,
      result: event.data?.result ?? null,
      ...(event.data?.cancellation ? { cancellation: cloneJson(event.data.cancellation) } : {}),
    };
  }
  return {
    ok: false,
    eventType: event.type,
    result: event.data?.result ?? null,
    error: event.data?.error || event.data?.reason || event.type,
    ...(event.data?.cancellation ? { cancellation: cloneJson(event.data.cancellation) } : {}),
  };
}

function actionFromIntent(
  intent: Intent,
  toolCallId: string | null,
): Omit<EntityTurn['action'], 'source'> {
  return {
    id: intent.id,
    name: intent.tool,
    input: intent.input,
    kind: 'exclusive',
    toolCallId,
  };
}

function toolArguments(assistant: any) {
  return parseToolArguments(assistant?.tool_calls?.[0]?.function?.arguments);
}

function toIntent(name: string, args: any): Intent {
  return {
    id: rid('llm'),
    source: 'llm',
    tool: name,
    input: args,
  };
}

function actionSignature(intent: Intent) {
  return `${intent.tool}:${stableJson(intent.input ?? {})}`;
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

function rid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function fmtArgs(value: any) {
  try {
    const text = JSON.stringify(value);
    return text.length > 120 ? text.slice(0, 117) + '...' : text;
  } catch {
    return '';
  }
}
