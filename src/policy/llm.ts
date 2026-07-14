import { createHash } from 'node:crypto';
import type { Intent } from '../loop/arbiter';
import type { EngineEvent } from '../loop/engine';
import { historyMessages, type EntityTurn } from '../entity/loom';
import type { InhabitantActionSpec, InhabitantInterface } from '../entity/interface';
import { MANAGE_PROJECT_TOOL } from '../entity/projects';
import { projectCurrentModelObservation, projectHistoricalModelObservation } from './context';
import {
  createLoomContextView,
  foldMessage,
  type LoomFoldRequest,
  type LoomFoldSummarizer,
} from '../entity/folding';
import type { ResidentMind, ResidentMindDecision, ResidentMindRequest } from '../mind/interface';
import {
  ResidentMindCallError,
  type ModelCallEvidence,
  type ModelCallFailureEvidence,
} from '../mind/evidence';

export type { ModelCallEvidence, ModelCallFailureEvidence } from '../mind/evidence';

type ToolSpec = InhabitantActionSpec;

export type Options = {
  apiKey: string;
  model: string;
  endpoint?: string;
  tickMs?: number;
  maxTurnSteps?: number;
  resumeAfterBudget?: boolean;
  allowTools?: string[] | null;
  history?: EntityTurn[];
  foldCacheFile?: string | null;
  foldRecentTurns?: number;
  foldBatchTurns?: number;
  foldTriggerTurns?: number;
  summarizeLoom?: LoomFoldSummarizer;
  now?: () => number;
  recordModelIO?: boolean;
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
  }) => void;
  onModelError?: (failure: {
    at: number;
    model: string;
    error: string;
    call: ModelCallFailureEvidence | ModelCallEvidence | null;
  }) => void;
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
  startedAt: number;
  observation: any;
  assistant: any;
};

type ModelDecision = {
  assistant: any;
  intent: Intent | null;
  toolCallId: string | null;
  wait: boolean;
  call: ModelCallEvidence;
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
const COMMUNICATION_TOOLS = new Set(['chat', 'whisper']);
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
  'enter_place',
  'leave_place',
  'approach_entity',
  'attack_entity',
  'collect_nearby_item',
  'offer_item_to_player',
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
    opts.mind ||
    createDirectResidentMind((request, signal) =>
      callLLM(
        request.actions.map((action) => ({
          type: 'function' as const,
          function: {
            name: action.name,
            description: action.description,
            parameters: action.inputSchema,
          },
        })),
        request.conversation as any[],
        opts,
        request.requiredAction,
        signal,
      ),
    );
  let activeModelRequest: AbortController | null = null;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  let resolveStop: (() => void) | null = null;
  const loomContext = createLoomContextView(history, {
    entityId,
    model: opts.model,
    cacheFile: opts.foldCacheFile,
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
  let entitySequence = history.at(-1)?.sequence ?? 0;
  let parentTurnId = history.at(-1)?.id ?? null;
  let lastActionSignature: string | null = null;
  let repeatedActionCount = 0;
  let consecutiveCommunicationActions = trailingCommunicationActions(history);
  const trailingFailures = trailingFailedEmbodiedActions(history);
  let failedEmbodiedTool = trailingFailures.tool;
  let failedEmbodiedCount = trailingFailures.count;
  let suspended = false;

  async function wake(force = false) {
    if (stopped || suspended) return;
    if (pending || deciding || preparingContext) {
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

    if (loomContext.state().needsFold) {
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
      const availableTools = availableModelTools(modelTools, currentObservation);
      const blockedUrgentTool = failedEmbodiedCount >= 3 ? failedEmbodiedTool : null;
      const requiredTool = requiredSelfDirectionTool(
        currentObservation,
        availableTools,
        allow,
        blockedUrgentTool,
      );
      const decision = await withModelRequest(async (signal) => {
        const request: ResidentMindRequest = {
          protocol: 'behold.mind-request.v1',
          entityId,
          model: opts.model,
          observation: cloneJson(currentObservation),
          conversation: cloneJson(messages),
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
        };
        const proposed = await abortable(mind.decide(request, { signal }), signal);
        return validateMindDecision(proposed, availableTools, requiredTool);
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
        startedAt,
        observation: currentObservation,
        assistant,
      };
      messages.push(assistant);
      opts.onModelTurn?.({
        at: decidedAt,
        model: opts.model,
        observation: currentObservation,
        assistant,
        intent: decision.intent,
        call: decision.call,
      });

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
        log(`[policy] error: ${e?.message || String(e)}`);
        opts.onModelError?.({
          at: now(),
          model: opts.model,
          error: e?.message || String(e),
          call:
            e instanceof ModelCallError ||
            e instanceof MindDecisionError ||
            e instanceof ResidentMindCallError
              ? e.call
              : null,
        });
      }
      turnActive = false;
      turnSteps = 0;
    } finally {
      deciding = false;
      settleStop();
      if (!stopped && continueImmediately && turnActive && !pending) {
        setImmediate(() => void continueTurn());
      } else if (!stopped && wakeQueued && !pending) {
        wakeQueued = false;
        setImmediate(() => void wake());
      }
    }
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
      model: opts.model,
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
      ...historyMessages(view.turns, projectHistoricalModelObservation),
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

function controllerSystemPrompt(specs: readonly ToolSpec[]) {
  const tools = new Set(specs.map((spec) => spec.function.name));
  const hasAny = (...names: string[]) => names.some((name) => tools.has(name));
  const lines = [
    'You are a persistent embodied Minecraft entity.',
    'Each turn, observe the world and choose exactly one available action. Its real result is your next observation; failures and denials are evidence to adapt from. Your trajectory is your continuing identity.',
    `Choose ${WAIT_TOOL} only when you need an external event or have no useful self-directed action; Minecraft continues while you wait.`,
    'The task brief gives goals and constraints, not hidden next actions. Maintain your own commitments. Its explicit ordering, preconditions, and prohibitions take precedence over the generic action heuristics below.',
    'Without a task, live autonomously: care for your body; learn the place; gain materials, tools, food, light, shelter, and sleep; improve useful shared places.',
    'task, self, scene, and events are present experience; isNew events arrived since the preceding update. proximity and local_volume are sensed summaries, not visual-line-of-sight proof.',
  ];
  if (tools.has(MANAGE_PROJECT_TOOL)) {
    lines.push(
      'self.projects is your bounded restart memory rebuilt from your own loom. Projects are sparse bookmarks for durable outcomes worth several meaningful actions, never wrappers for one-step or routine work such as nearby walking, inspecting, depositing one stack, equipping, or cleanup. Keep at most one active focus and resolve legacy overlaps first. Surveying, orienting, and choosing are steps, not outcomes. doneWhen must be a future Minecraft-observable condition, with evidence naming its observation channel; waiting, nothing to do, and already-true conditions are invalid. time_elapsed is only for a concrete future time condition; space_enclosed is required for shelter. Follow nextStep, update when observation changes the plan, and complete only after a matching post-start witness. When evidence invalidates a strategy, revise, abandon, or pivot instead of repeating it.',
    );
  }
  if (hasAny('enter_place', 'leave_place', MANAGE_PROJECT_TOOL)) {
    lines.push(
      'self.places is bounded own-loom memory, not current server truth: re-observe near an anchor before relying on present condition. Prefer returning to, using, or improving a reachable known affordance over duplicating it. Resolve self.placeConflicts with manage_project before further building.',
    );
  }
  if (hasAny('enter_place', 'leave_place')) {
    lines.push(
      'Use enter_place and leave_place for a known door-served place: they approach the witnessed side, operate the door only when necessary, cross the physical leaf, confirm arrival, and can close behind. Do not replace them with a blind door toggle and guessed movement.',
    );
  }
  if (tools.has(COLLECT_TOOL)) {
    lines.push(
      'After respawning, or when inventory is unexpectedly empty and dropped items are nearby, recover safe drops before narrating or beginning another project; dropped items expire.',
    );
  }
  if (hasAny('chat', 'whisper', 'approach_entity', 'offer_item_to_player')) {
    lines.push(
      'Speaking through chat is an action like movement or looking. Conversation can remain open while life continues; after speaking, pursue other concerns unless the answer is required for the next action.',
      'A successful action proves only its reported consequence for the entities named in that result. Your movement moves your body, your chat proves only that you spoke, and neither proves another entity followed, arrived, learned, received something, or remained safe. Treat requests involving another entity as joint activity: keep the concern unfinished, establish interaction proximity, take short actions, and use the next observation of that entity before claiming shared progress.',
      'When no human is actively interacting with you, do not ask the empty server what to do next. Continue your own concrete concern.',
      'scene.social.playersOnline is server-roster presence, not proximity. If it is empty, chat has no recipient; if null, roster presence is unknown.',
      'Minecraft chat is narrow. Use one short sentence at a time, normally under 120 characters. Teach through tiny embodied loops and wait for evidence before advancing.',
      'You cannot inspect another player’s inventory. Use their heldItem, nearby collection evidence, or ask them to show or confirm the result.',
      'Respond naturally when a human speaks, ask when a spatial reference is ambiguous, and never claim success before an action completes.',
    );
  }
  if (tools.has('approach_entity')) {
    lines.push(
      'Prefer approach_entity for a named nearby person. Navigation succeeds only when arrival is confirmed.',
    );
  }
  if (hasAny('find_blocks', 'dig_block')) {
    lines.push(
      'Nearby terrain samples and find_blocks identify loaded local blocks but do not prove visual line of sight. Move and look when that distinction matters.',
      'When resource targets are elevated, unsupported, or unreachable, widen find_blocks to the broad material name. For wood, search name "log" out to 32 blocks and prefer likelyGrounded results.',
      'Block coordinates are solid interaction targets, not places to stand. Use dig_block on a chosen find_blocks result; it approaches into reach before mining.',
    );
  }
  if (hasAny('inspect_volume', 'place_block', 'place_against')) {
    lines.push(
      'For deliberate building, use inspect_volume at the worksite to understand exact loaded geometry. Choose exact air or replaceable-vegetation cells, use place_block for one change at a time, and inspect again when the shape is uncertain. bodyFeet and protected body cells are occupied by bodies: never target them or any non-replaceable occupied cell.',
    );
  }
  if (tools.has('inspect_reachable_space')) {
    lines.push(
      'Use inspect_reachable_space from the intended interior. A useful shared shelter requires sealed=true, fullyCovered=true, sharedCapacity=true, closableEntranceCount>=1, plus a crafting or storage amenity. A sealed box without a real door is unfinished.',
    );
  }
  if (tools.has('place_against')) {
    lines.push('Use place_against only when the particular reference face matters.');
  }
  if (hasAny('dig_block', 'descend_step', 'ascend_step')) {
    lines.push(
      'Never dig directly under your feet or improvise a vertical shaft. Use descend_step for a supported cardinal staircase step and ascend_step in the opposite direction to leave it. After an ordinary dig, adjacentBlocks can identify a connected vein or trunk.',
    );
  }
  if (hasAny('craft_item', 'equip', 'consume', 'sleep_in_bed', 'attack_entity')) {
    lines.push(
      'Crafting, equipping, eating, sleep, and defense are ordinary parts of caring for your Minecraft life.',
    );
  }
  if (hasAny('inspect_volume', 'inspect_reachable_space', 'inspect_container', 'status')) {
    lines.push(
      'Use available inspect or status tools when uncertain, then manipulate the world from their evidence.',
    );
  }
  if (tools.has('survey_area')) {
    lines.push(
      'survey_area is privileged symbolic sensing. Use it only when the task or a human explicitly permits it.',
    );
  }
  lines.push(
    'Do not repeat a failed action without new evidence or a changed input. Do not repeat merely because a timer fired. Continue from the tool results and world events already in this conversation.',
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

function requiredSelfDirectionTool(
  frame: any,
  specs: ToolSpec[],
  allow: Set<string> | null,
  blockedUrgentTool: string | null,
) {
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
  const safeDrop = (frame?.scene?.entities || []).some(
    (entity: any) =>
      String(entity?.kind || '').toLowerCase() === 'item' &&
      Number(entity?.distance) <= 16 &&
      entity?.pickupSafety?.ok === true,
  );
  if (
    safeDrop &&
    blockedUrgentTool !== COLLECT_TOOL &&
    specs.some((spec) => spec.function.name === COLLECT_TOOL) &&
    (!allow || allow.has(COLLECT_TOOL))
  ) {
    return COLLECT_TOOL;
  }
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

function availableModelTools(specs: ToolSpec[], frame: any) {
  const roster = frame?.scene?.social?.playersOnline;
  const droppedItems = Array.isArray(frame?.scene?.entities)
    ? frame.scene.entities.filter(
        (entity: any) => String(entity?.kind || entity?.type || '').toLowerCase() === 'item',
      )
    : [];
  return specs.filter((spec) => {
    if (COMMUNICATION_TOOLS.has(spec.function.name)) {
      return !Array.isArray(roster) || roster.length > 0;
    }
    if (spec.function.name === COLLECT_TOOL) return droppedItems.length > 0;
    return true;
  });
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

export function hasDecisionRelevantEvent(frame: any, lastSequence: number) {
  if (frame?.protocol !== 'behold.inhabitant.v1' || lastSequence === 0) return true;
  const relevant = new Set([
    'spawned',
    'chat_received',
    'condition_changed',
    'block_changed_nearby',
    'time_passed',
    'day_phase_changed',
    'weather_changed',
    'inventory_changed',
    'item_collected',
    'nearby_player_collected_item',
    'nearby_player_equipment_changed',
    'self_hurt',
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
      event.type === 'entity_appeared_nearby' &&
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.apiKey}`,
  };
  if (process.env.OPENROUTER_REFERER)
    headers['HTTP-Referer'] = String(process.env.OPENROUTER_REFERER);
  if (process.env.OPENROUTER_TITLE) headers['X-Title'] = String(process.env.OPENROUTER_TITLE);
  const endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  const requestId = rid('model-aux');
  const startedAt = opts.now ? opts.now() : Date.now();
  const requestBody = JSON.stringify(body);
  const requestEvidence = {
    model: opts.model,
    messageCount: messages.length,
    toolCount: 0,
    toolChoice: null,
    bodySha256: sha256(requestBody),
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

  const input = proposed?.input ?? {};
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    fail(`mind proposed non-object input for ${name}`);
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
  specs: ToolSpec[],
  messages: any[],
  opts: Options,
  requiredTool: string | null = null,
  signal?: AbortSignal,
): Promise<ModelDecision> {
  const body = {
    model: opts.model,
    messages,
    tools: specs,
    tool_choice: requiredTool ? { type: 'function', function: { name: requiredTool } } : 'auto',
    parallel_tool_calls: false,
    ...(opts.model.includes('gpt-5') ? {} : { temperature: 0.2 }),
  } as any;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.apiKey}`,
  };
  if (process.env.OPENROUTER_REFERER)
    headers['HTTP-Referer'] = String(process.env.OPENROUTER_REFERER);
  if (process.env.OPENROUTER_TITLE) headers['X-Title'] = String(process.env.OPENROUTER_TITLE);

  const endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  const requestId = rid('model');
  const startedAt = opts.now ? opts.now() : Date.now();
  const requestBody = JSON.stringify(body);
  const request = {
    model: opts.model,
    messageCount: messages.length,
    toolCount: specs.length,
    toolChoice: body.tool_choice,
    bodySha256: sha256(requestBody),
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
