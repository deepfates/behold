import { createHash } from 'node:crypto';
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
import { directOpenRouterRequestBody } from '../mind/direct-wire';
import {
  cognitionClientHeaders,
  parseCognitionAdmission,
  type CognitionPriority,
} from '../mind/cognition';
import { validateResidentActionInput } from '../mind/schema';
import { residentTurnMayReplay } from '../mind/resident-visibility';
import {
  ResidentMindCallError,
  type ModelCallEvidence,
  type ModelCallFailureEvidence,
} from '../mind/evidence';

export type { ModelCallEvidence, ModelCallFailureEvidence } from '../mind/evidence';

type ToolSpec = InhabitantActionSpec;

export type Options = {
  apiKey: string;
  /** Default model for ordinary deliberation, social attention, and loom folding. */
  model: string;
  /** Optional model used for new bodily urgency and a still-critical body condition. */
  urgentModel?: string;
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
  summarizeLoom?: LoomFoldSummarizer;
  now?: () => number;
  recordModelIO?: boolean;
  /** Requests use the runner-owned, authenticated aggregate cognition transport. */
  cognitionTransport?: boolean;
  /** Alternate bounded decision implementation. Behold still owns the resident loop. */
  mind?: ResidentMind;
  log?: (s: string) => void;
  /** Accept only lifecycle objects minted by the engine that owns attempt(). */
  acceptEngineEvent: (event: EngineEvent) => boolean;
  onModelTurn?: (turn: {
    at: number;
    model: string;
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
const WAIT_TOOL = 'wait_for_event';
const COLLECT_TOOL = 'collect_nearby_item';
const DROP_TOOL = 'drop_item';
const APPROACH_TOOL = 'approach_entity';
const ATTACK_TOOL = 'attack_entity';
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
const TERMINAL_ACTION_EVENTS = new Set(['action_completed', 'action_failed', 'intent_blocked']);

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
  const allow = Array.isArray(opts.allowTools) ? new Set(opts.allowTools) : null;
  const executableTools = allow
    ? environment.actions.filter((spec) => allow.has(spec.function.name))
    : [...environment.actions];
  const modelTools = executableTools.some((spec) => spec.function.name === WAIT_TOOL)
    ? executableTools
    : [...executableTools, WAIT_TOOL_SPEC];
  const mind: ResidentMind =
    opts.mind || createDirectResidentMind((request, signal) => callLLM(request, opts, signal));
  let activeModelRequest: AbortController | null = null;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  let resolveStop: (() => void) | null = null;
  const loomContext = createLoomContextView(history, {
    entityId,
    model: opts.model,
    cacheFile: opts.foldCacheFile,
    readOnly: opts.foldReadOnly,
    recentTurns: opts.foldRecentTurns ?? 8,
    foldBatchTurns: opts.foldBatchTurns ?? 24,
    foldTriggerTurns: opts.foldTriggerTurns ?? 8,
    now,
    summarize: opts.summarizeLoom
      ? (request) => withModelRequest((signal) => abortable(opts.summarizeLoom!(request), signal))
      : (request) =>
          withModelRequest((signal) => abortable(summarizeLoom(request, opts, signal), signal)),
  });
  const messages: any[] = [{ role: 'system', content: controllerSystemPrompt(modelTools) }];

  let timer: NodeJS.Timeout | null = null;
  let resumeTimer: NodeJS.Timeout | null = null;
  let lastTool: string | null = null;
  let lastSequence = 0;
  let deciding = false;
  let preparingContext = false;
  let contextPrepared = false;
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
      wakeQueued = true;
      const latest = observe();
      const triggers = urgentEventTriggers(latest, lastSequence);
      if (activeModelRequest && triggers.length > 0) {
        activeModelRequest.abort(abortError('urgent_world_attention_during_loom_fold'));
      }
      return;
    }
    if (pending) {
      wakeQueued = true;
      return;
    }

    if (!contextPrepared) {
      preparingContext = true;
      try {
        await loomContext.prepare();
        if (stopped) return;
        rebuildMessagesFromLoom();
        contextPrepared = true;
      } catch (error: any) {
        if (!stopped)
          log(`[policy] could not prepare loom context: ${error?.message || String(error)}`);
        return;
      } finally {
        preparingContext = false;
        settleStop();
      }
    }

    const frame = observe();
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

    const attentionBeforeFold = attentionForCurrentLife(
      currentModelObservation ?? projectCurrentModelObservation(currentObservation),
    );
    if (loomContext.state().needsFold && !hasBodilyUrgency(attentionBeforeFold)) {
      preparingContext = true;
      try {
        const folded = await loomContext.prepare();
        if (stopped) return;
        if (folded) {
          rebuildMessagesFromLoom();
          if (currentObservation) appendWorldUpdate(currentObservation, 'Current world experience');
          log(`[policy] folded own loom through turn ${loomContext.state().foldedThrough}`);
        }
      } catch (error: any) {
        if (!stopped)
          log(`[policy] could not fold loom context: ${error?.message || String(error)}`);
        turnActive = false;
        turnSteps = 0;
        return;
      } finally {
        preparingContext = false;
        settleStop();
      }
    } else if (loomContext.state().needsFold) {
      log('[policy] deferred own-loom fold while bodily urgency remains unresolved');
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
      return;
    }

    deciding = true;
    let continueImmediately = false;
    try {
      turnSteps += 1;
      const startedAt = now();
      const modelObservation =
        currentModelObservation ?? projectCurrentModelObservation(currentObservation);
      const attention = attentionForCurrentLife(modelObservation);
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
      const availableTools = availableModelTools(modelTools, currentObservation, attention);
      const requiredTool = requiredSelfDirectionTool(currentObservation, availableTools, allow);
      const decision = await withModelRequest(async (signal) => {
        const request: ResidentMindRequest = {
          protocol: 'behold.mind-request.v1',
          entityId,
          model: decisionModel,
          observation: cloneJson(modelObservation),
          conversation: cloneJson(
            conversationForAttention(
              messages,
              attention,
              availableTools,
              attention.mode === 'urgent'
                ? projectRecentActionContinuity(
                    loomContext.view().turns,
                    undefined,
                    undefined,
                    residentTurnMayReplay,
                  )
                : null,
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
        const proposed = await mind.decide(request, { signal });
        return validateMindDecision(proposed, availableTools, requiredTool, decisionModel);
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
      if (intent.tool !== 'attack_entity' && repeatedActionCount >= 3) {
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
      if (COMMUNICATION_TOOLS.has(intent.tool) && consecutiveCommunicationActions >= 2) {
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
      const accepted = environment.attempt(intent);
      if (accepted === false) {
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
      pending = { intent, toolCallId: decision.toolCallId, draft };
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
      loomContext: loomContext.state(),
    }),
  };
}

export function controllerSystemPrompt(specs: readonly ToolSpec[]) {
  const tools = new Set(specs.map((spec) => spec.function.name));
  const hasAny = (...names: string[]) => names.some((name) => tools.has(name));
  const lines = [
    'You are a persistent embodied Minecraft entity.',
    'Observe, then choose exactly one available action. Its real result becomes your next observation; adapt to failures and denials. Your trajectory is your continuing identity.',
    'State one short public intention before acting. If it is setup, name the target or purpose that must survive it. This is replayable continuity, not private reasoning or proof of success.',
    `Use ${WAIT_TOOL} only for a needed external event or when no useful self-directed action remains; Minecraft continues while you wait.`,
    'A task gives goals and constraints, not hidden next actions. Keep your own commitments. Its explicit ordering, preconditions, and prohibitions take precedence over the generic action heuristics below.',
    'Without a task, live: protect your body; learn the place; gain materials, tools, food, light, shelter, and sleep; improve useful shared places.',
    'task, self, scene, and events are present experience; isNew marks unread events. scene.entities are only unoccluded bodies in current first-person view; scene.terrain is only first-hit visible surfaces. sound_heard has coarse direction and distance, never hidden coordinates.',
  ];
  if (tools.has(MANAGE_PROJECT_TOOL)) {
    lines.push(
      'self.projects is your bounded restart memory from your loom. Bookmark durable outcomes needing several actions—not walking, inspection, transfers, equipment, or cleanup. Keep one focus; resolve overlaps. Survey and choice are steps, not outcomes. doneWhen names a future Minecraft condition and player-observable evidence; already-true, waiting, and idle conditions are invalid. Use world_change for construction and time_elapsed for a concrete future time. Complete only after a matching post-start witness. Completion is your grounded conclusion, not external world certification.',
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
  if (tools.has('move_direction')) {
    lines.push(
      'Use move_direction for short local exploration relative to view; use move_to only for a visible, communicated, or remembered position. Looking and walking are not projects.',
    );
  }
  if (hasAny('find_blocks', 'dig_block')) {
    lines.push(
      'Terrain samples and find_blocks identify loaded local blocks, not line of sight. Move and look when that matters.',
      'If resources are elevated or unreachable, widen find_blocks to the material name; for wood use name "log", distance 32, and prefer likelyGrounded.',
      'Block coordinates are solid targets, not standing places. dig_block approaches a chosen result into reach before mining.',
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
) {
  const roster = frame?.scene?.social?.playersOnline;
  const inventory = Array.isArray(frame?.self?.inventory) ? frame.self.inventory : [];
  const perceivedEntities =
    frame?.protocol === 'behold.inhabitant.v2' && Array.isArray(frame?.scene?.entities)
      ? frame.scene.entities.filter(
          (entity: any) =>
            entity?.source === 'vision' &&
            entity?.visibility === 'visible' &&
            typeof entity?.id === 'string' &&
            entity.id.length > 0,
        )
      : [];
  const droppedItems = perceivedEntities.filter(
    (entity: any) => String(entity?.kind || entity?.type || '').toLowerCase() === 'item',
  );
  const embodiedEntities = perceivedEntities.filter(
    (entity: any) => String(entity?.kind || entity?.type || '').toLowerCase() !== 'item',
  );
  const targetIds = (entities: any[]) => entities.map((entity) => String(entity.id));
  return specs.flatMap((spec) => {
    // A project record is private continuity bookkeeping, not an embodied
    // Minecraft response. Preserve every ordinary player affordance during
    // urgent attention, but defer bookkeeping until the body is no longer
    // demanding an immediate choice.
    if (hasBodilyUrgency(attention) && spec.function.name === MANAGE_PROJECT_TOOL) return [];
    if (COMMUNICATION_TOOLS.has(spec.function.name)) {
      return !Array.isArray(roster) || roster.length > 0 ? [spec] : [];
    }
    if (spec.function.name === 'cross_visible_door') {
      const focus = frame?.scene?.focus;
      const name = String(focus?.name || '').toLowerCase();
      return focus?.kind === 'block' &&
        focus?.source === 'cursor' &&
        focus?.reachable === true &&
        typeof focus?.id === 'string' &&
        name.endsWith('_door') &&
        !name.startsWith('iron_')
        ? [withExactStringEnum(spec, 'focus', [focus.id])]
        : [];
    }
    if (spec.function.name === 'cross_place_door') {
      const position = frame?.self?.pose?.position;
      const dimension = String(frame?.self?.condition?.dimension || '');
      const circleId = String(frame?.circle?.id || '');
      const eligible = (Array.isArray(frame?.self?.places) ? frame.self.places : []).filter(
        (place: any) =>
          place?.evidence === 'doorway_crossed' &&
          place?.circleId === circleId &&
          place?.anchor?.dimension === dimension &&
          Array.isArray(place?.doorways) &&
          place.doorways.some(
            (doorway: any) =>
              sameFeetCell(position, doorway?.sideAFeet) ||
              sameFeetCell(position, doorway?.sideBFeet),
          ),
      );
      return eligible.length > 0
        ? [
            withExactStringEnum(
              spec,
              'id',
              eligible.map((place: any) => String(place.id)),
            ),
          ]
        : [];
    }
    if (spec.function.name === COLLECT_TOOL) {
      return droppedItems.length > 0 ? [withExactTargetEnum(spec, targetIds(droppedItems))] : [];
    }
    if (spec.function.name === APPROACH_TOOL || spec.function.name === ATTACK_TOOL) {
      return embodiedEntities.length > 0
        ? [withExactTargetEnum(spec, targetIds(embodiedEntities))]
        : [];
    }
    if (spec.function.name === DROP_TOOL) {
      return inventory.some(
        (item: any) => Number(item?.count) > 0 && String(item?.name || '').length > 0,
      )
        ? [spec]
        : [];
    }
    return [spec];
  });
}

function withExactTargetEnum(spec: ToolSpec, targets: string[]): ToolSpec {
  return withExactStringEnum(spec, 'target', targets);
}

function withExactStringEnum(spec: ToolSpec, property: string, values: string[]): ToolSpec {
  const copy = cloneJson(spec) as ToolSpec;
  const parameters: any = copy.function.parameters || {
    type: 'object',
    properties: {},
  };
  parameters.properties = parameters.properties || {};
  parameters.properties[property] = {
    ...(parameters.properties[property] || { type: 'string' }),
    enum: [...new Set(values)],
  };
  copy.function.parameters = parameters;
  return copy;
}

function sameFeetCell(first: any, second: any) {
  if (
    ![first?.x, first?.y, first?.z, second?.x, second?.y, second?.z].every((value) =>
      Number.isFinite(Number(value)),
    )
  ) {
    return false;
  }
  return (
    Math.floor(Number(first.x)) === Number(second.x) &&
    Math.floor(Number(first.y)) === Number(second.y) &&
    Math.floor(Number(first.z)) === Number(second.z)
  );
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

export function attentionForObservation(frame: any): ResidentAttention {
  const triggers = urgentEventTriggers(frame, -1);
  return triggers.length > 0
    ? { mode: 'urgent', context: 'current_body_and_continuity', triggers }
    : { mode: 'deliberative', context: 'bounded_loom', triggers: [] };
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
) {
  if (attention.mode !== 'urgent') return messages;
  const bodilyUrgency = hasBodilyUrgency(attention);
  const system = availableTools
    ? { role: 'system', content: controllerSystemPrompt(availableTools) }
    : messages[0];
  const foldedContinuity = messages
    .slice(1, -1)
    .filter(
      (message) =>
        message?.role === 'system' &&
        String(message?.content || '').startsWith('Folded view of your own loom'),
    )
    .at(-1);
  const urgentHandoff = {
    role: 'system',
    content: [
      attention.continuingCondition
        ? 'Continuing bodily urgency: an earlier lived trigger remains unresolved in the current body condition.'
        : 'Urgent attention handoff: slow deliberation was superseded by newly lived bodily evidence.',
      `Triggers: ${
        attention.triggers.map((trigger) => `${trigger.type}@${trigger.sequence}`).join(', ') ||
        'current urgent observation'
      }.`,
      ...(bodilyUrgency
        ? [
            'Reassess the current body and scene. Treat interrupted work as stale until the immediate danger or critical condition is mitigated.',
            'Choose an action whose immediate expected consequence addresses the danger or obtains perception needed to do so. Movement, cover, defense, food, and escape are ordinary Minecraft possibilities only when current evidence supports them. Do not continue unrelated construction while taking active damage or critically low on health.',
            'At critical health during active harm, prefer an action that changes exposure now. A perception-only action is safe only when acting without that perception would be worse and the body can survive the delay.',
            'A threat leaving the camera is not proof of safety. When no hostile is currently visible, do not flee blindly forever; use a bounded look or current terrain and inventory evidence to locate food, defensible cover, or a safe route.',
            'Every admitted embodied action remains available; private project bookkeeping is deferred until bodily urgency ends. No response has been selected for you.',
          ]
        : [
            'Reassess the current body, scene, and social event. The ordinary admitted action surface is unchanged, and no response has been selected for you.',
          ]),
    ].join('\n'),
  };
  const recentActions = recentActionContinuity
    ? {
        role: 'system',
        content: [
          'Recent lived action continuity from your own entity loom. This is bounded historical evidence; the current observation wins whenever state has changed.',
          JSON.stringify(recentActionContinuity),
        ].join('\n'),
      }
    : null;
  const current = messages.at(-1);
  return [
    system,
    ...(foldedContinuity ? [foldedContinuity] : []),
    ...(recentActions ? [recentActions] : []),
    urgentHandoff,
    current,
  ].filter(Boolean);
}

function hasBodilyUrgency(attention: ResidentAttention) {
  return (
    attention.mode === 'urgent' &&
    attention.triggers.some((trigger) => BODILY_URGENCY_EVENT_TYPES.has(trigger.type))
  );
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

function createDirectResidentMind(
  decide: (request: ResidentMindRequest, signal: AbortSignal) => Promise<ModelDecision>,
): ResidentMind {
  return {
    id: 'direct-openrouter',
    async decide(request, { signal }) {
      const decision = await decide(request, signal);
      const utterance =
        typeof decision.assistant?.content === 'string' ? decision.assistant.content : null;
      if (decision.wait) {
        return {
          protocol: 'behold.mind-decision.v1',
          disposition: 'wait',
          utterance,
          action: {
            name: WAIT_TOOL,
            input: toolArguments(decision.assistant),
            callId: decision.toolCallId,
          },
          adapterRecord: decision.assistant,
          call: decision.call,
        };
      }
      if (!decision.intent) {
        return {
          protocol: 'behold.mind-decision.v1',
          disposition: 'no_action',
          utterance,
          action: null,
          adapterRecord: decision.assistant,
          call: decision.call,
        };
      }
      return {
        protocol: 'behold.mind-decision.v1',
        disposition: 'act',
        utterance,
        action: {
          name: decision.intent.tool,
          input: decision.intent.input ?? {},
          callId: decision.toolCallId,
        },
        adapterRecord: decision.assistant,
        call: decision.call,
      };
    },
  };
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
): ModelDecision {
  if (decision?.protocol !== 'behold.mind-decision.v1') {
    throw new Error('mind returned an unsupported decision protocol');
  }
  if (decision.call?.protocol !== 'behold.model-call.v1') {
    throw new Error('mind returned no inspectable model-call evidence');
  }

  const admitted = new Set(admittedActions.map((spec) => spec.function.name));
  const fail = (message: string): never => {
    throw new MindDecisionError(message, decision.call);
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
      call: decision.call,
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
      call: decision.call,
    };
  }
  return {
    assistant,
    intent: toIntent(name, input),
    toolCallId,
    wait: false,
    call: decision.call,
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

async function callLLM(
  residentRequest: ResidentMindRequest,
  opts: Options,
  signal?: AbortSignal,
): Promise<ModelDecision> {
  const body = directOpenRouterRequestBody(residentRequest) as any;
  const messages = body.messages as any[];
  const specs = body.tools as ToolSpec[];

  const requestId = rid('model');
  const priority: CognitionPriority =
    residentRequest.attention?.mode === 'urgent' ? 'urgent' : 'deliberative';
  const urgentTriggers = (residentRequest.attention?.triggers ?? []).map(
    (trigger) => trigger.sequence,
  );
  const urgentTriggerSequence =
    priority === 'urgent' && urgentTriggers.length > 0 ? Math.max(...urgentTriggers) : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.apiKey}`,
    ...(opts.cognitionTransport
      ? cognitionClientHeaders({
          requestId,
          priority,
          purpose: 'resident_decision',
          urgentTriggerSequence,
        })
      : {}),
  };
  if (process.env.OPENROUTER_REFERER)
    headers['HTTP-Referer'] = String(process.env.OPENROUTER_REFERER);
  if (process.env.OPENROUTER_TITLE) headers['X-Title'] = String(process.env.OPENROUTER_TITLE);

  const endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  const startedAt = opts.now ? opts.now() : Date.now();
  const requestBody = JSON.stringify(body);
  const request = {
    model: residentRequest.model,
    messageCount: messages.length,
    toolCount: specs.length,
    toolChoice: body.tool_choice,
    bodySha256: sha256(requestBody),
    bodyBytes: Buffer.byteLength(requestBody, 'utf8'),
    messagesSha256: sha256(stableJson(messages)),
    toolsSha256: sha256(stableJson(specs)),
    kind: 'provider_request' as const,
    ...(opts.recordModelIO ? { body: JSON.parse(requestBody) } : {}),
  };
  let res: Response;
  try {
    res = await fetch(endpoint, { method: 'POST', headers, body: requestBody, signal });
  } catch (error: any) {
    const completedAt = opts.now ? opts.now() : Date.now();
    throw new ModelCallError(`llm network error: ${error?.message || String(error)}`, {
      protocol: 'behold.model-call.v1',
      adapter: { name: 'direct-openrouter' },
      requestId,
      endpoint: safeEndpoint(endpoint),
      startedAt,
      completedAt,
      latencyMs: Math.max(0, completedAt - startedAt),
      request,
      response: { status: null, bodyPreview: null },
    });
  }
  if (!res.ok) {
    const text = await res.text();
    const completedAt = opts.now ? opts.now() : Date.now();
    throw new ModelCallError(`llm ${res.status}: ${text.slice(0, 200)}`, {
      protocol: 'behold.model-call.v1',
      adapter: { name: 'direct-openrouter' },
      requestId,
      endpoint: safeEndpoint(endpoint),
      startedAt,
      completedAt,
      latencyMs: Math.max(0, completedAt - startedAt),
      ...admissionEvidence(res),
      request,
      response: { status: res.status, bodyPreview: text.slice(0, 200) || null },
    });
  }
  const data: any = await res.json();
  const completedAt = opts.now ? opts.now() : Date.now();
  const call: ModelCallEvidence = {
    protocol: 'behold.model-call.v1',
    adapter: { name: 'direct-openrouter' },
    requestId,
    endpoint: safeEndpoint(endpoint),
    startedAt,
    completedAt,
    latencyMs: Math.max(0, completedAt - startedAt),
    ...admissionEvidence(res),
    request,
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
  const assistant = data?.choices?.[0]?.message || { role: 'assistant', content: '' };
  const toolCall = assistant?.tool_calls?.[0];
  if (toolCall?.function?.name) {
    // The controller intentionally resolves one dependent action at a time.
    // Keep the assistant history protocol-valid even if a provider ignores
    // parallel_tool_calls=false and emits several calls.
    const singleToolAssistant = { ...assistant, tool_calls: [toolCall] };
    const name = String(toolCall.function.name);
    const args = parseToolArguments(toolCall.function.arguments);
    if (name === WAIT_TOOL) {
      return {
        assistant: singleToolAssistant,
        intent: null,
        toolCallId: String(toolCall.id || rid('wait')),
        wait: true,
        call,
      };
    }
    return {
      assistant: singleToolAssistant,
      intent: toIntent(name, args),
      toolCallId: String(toolCall.id || rid('tool')),
      wait: false,
      call,
    };
  }

  const text: string | undefined = assistant?.content;
  if (text && text.trim() && specs.some((spec) => spec.function.name === 'chat')) {
    return {
      assistant,
      intent: {
        id: rid('llm'),
        source: 'llm',
        tool: 'chat',
        input: { text: text.slice(0, 200) },
      },
      toolCallId: null,
      wait: false,
      call,
    };
  }
  return { assistant, intent: null, toolCallId: null, wait: false, call };
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
    return { ok: true, eventType: event.type, result: event.data?.result ?? null };
  }
  return {
    ok: false,
    eventType: event.type,
    result: event.data?.result ?? null,
    error: event.data?.error || event.data?.reason || event.type,
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
