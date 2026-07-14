import { ActionArbiter, type Intent } from './arbiter';

export type Registry = {
  run: (name: string, args?: any, intent?: Intent, execution?: ActionExecution) => Promise<any>;
  authorize?: (
    name: string,
    args: any,
    intent: Intent,
  ) => ActionAuthorization | Promise<ActionAuthorization>;
  list: () => Array<{ name: string; description?: string; parameters?: any }>;
};

export type ActionAuthorization =
  | { ok: true; authority: string; evidence?: Readonly<Record<string, unknown>> }
  | {
      ok: false;
      authority: string;
      error: string;
      reason: string;
      evidence?: Readonly<Record<string, unknown>>;
    };

export type ActionExecution = Readonly<{
  signal: AbortSignal;
}>;

export type EngineEvent = Readonly<{
  type: string;
  at: number;
  data: Readonly<Record<string, any>>;
}>;

export type EngineOptions = {
  tickMs?: number;
  rateMax?: number;
  rateWindowMs?: number;
  allowTools?: string[] | null;
  now?: () => number;
  log?: (line: string) => void;
  onEvent?: (event: EngineEvent) => unknown;
};

export function createEngine(registry: Registry, opts: EngineOptions = {}) {
  const now = () => (opts.now ? opts.now() : Date.now());
  const log = (s: string) => (opts.log ? opts.log(s) : void 0);
  const authenticEvents = new WeakSet<object>();
  const reportObserverFailure = (type: string, error: any) =>
    log(`[engine] event observer failed for ${type}: ${error?.message || String(error)}`);
  const emit = (type: string, data: any = {}) => {
    const eventData = structuredClone(data);
    const event: EngineEvent = Object.freeze({
      type,
      at: now(),
      data: deepFreeze(eventData),
    });
    authenticEvents.add(event);
    try {
      const delivery = opts.onEvent?.(event);
      if (
        delivery &&
        (typeof delivery === 'object' || typeof delivery === 'function') &&
        typeof (delivery as PromiseLike<unknown>).then === 'function'
      ) {
        // Event consumers are downstream of the already-minted lifecycle.
        // Observe rejection without awaiting it or rewriting action outcome.
        void Promise.resolve(delivery).catch((error) => reportObserverFailure(type, error));
      }
    } catch (error: any) {
      // A broken observer must not rewrite a successfully completed action as
      // a second, contradictory terminal. The event already exists; surface
      // the delivery failure out of band and keep the lifecycle unchanged.
      reportObserverFailure(type, error);
    }
    return event;
  };
  const tickMs = Math.max(200, Number(opts.tickMs ?? 3000));
  const allow = Array.isArray(opts.allowTools) ? new Set(opts.allowTools) : null;
  const arbiter = new ActionArbiter({
    max: opts.rateMax ?? 20,
    windowMs: opts.rateWindowMs ?? 60_000,
  });

  let timer: NodeJS.Timeout | null = null;
  let tickScheduled = false;
  let mutedLLM = false;
  let shuttingDown = false;
  let inFlight: {
    intent: Intent;
    promise: Promise<any>;
    controller: AbortController;
  } | null = null;

  async function tick() {
    if (shuttingDown) return;
    // Until each adapter can acknowledge cancellation, serialize all actions.
    // This is deliberately stricter than the arbiter's future parallel lane:
    // correctness comes before speculative concurrency.
    if (inFlight) return;
    // In a future slice, we will let the LLM driver enqueue intents here when not muted.
    const intent = arbiter.selectNext(now());
    if (!intent) return;
    if (allow && !allow.has(intent.tool) && intent.tool !== 'stop') {
      log(`[engine] blocked by allowlist: ${intent.tool}`);
      const authorization: ActionAuthorization = {
        ok: false,
        authority: 'engine-tool-allowlist',
        error: 'tool_not_allowed',
        reason: `${intent.tool} is not in the configured tool allowlist`,
      };
      emit('intent_selected', { intent });
      emit('permission_decision', { intent, authorization });
      emit('intent_blocked', {
        intent,
        authorization,
        reason: authorization.error,
        error: authorization.error,
        result: authorization,
      });
      arbiter.releaseLease(intent.id);
      return;
    }
    const controller = new AbortController();
    // Publish execution ownership before any lifecycle observer can request
    // shutdown or preemption from a synchronously delivered event.
    const execution = Promise.resolve().then(() => execute(intent, controller));
    inFlight = { intent, promise: execution, controller };
    try {
      return await execution;
    } finally {
      if (inFlight?.intent.id === intent.id) inFlight = null;
      scheduleTick();
    }
  }

  function scheduleTick() {
    if (!timer || tickScheduled || shuttingDown) return;
    tickScheduled = true;
    queueMicrotask(() => {
      tickScheduled = false;
      if (timer && !shuttingDown) void tick();
    });
  }

  async function execute(intent: Intent, controller: AbortController) {
    let authorization: ActionAuthorization = { ok: true, authority: 'registry-default' };
    try {
      log(`[arbiter] selected: ${intent.source} ${intent.tool}`);
      log(`[engine] act: ${intent.tool}`);
      emit('intent_selected', { intent });
      if (registry.authorize) {
        try {
          authorization = await registry.authorize(intent.tool, intent.input, intent);
        } catch (error: any) {
          authorization = {
            ok: false,
            authority: 'registry-authorization-error',
            error: 'authorization_error',
            reason: error?.message || String(error),
          };
        }
      }
      emit('permission_decision', { intent, authorization });
      if (authorization.ok === false) {
        emit('intent_blocked', {
          intent,
          authorization,
          reason: authorization.error,
          error: authorization.error,
          result: authorization,
        });
        arbiter.releaseLease(intent.id);
        return authorization;
      }
      emit('action_started', { intent, authorization });
      const res = await registry.run(intent.tool, intent.input, intent, {
        signal: controller.signal,
      });
      emit('tool_result', { intent, authorization, result: res });
      if (res?.ok === false) {
        emit('action_failed', {
          intent,
          authorization,
          result: res,
          error: res?.error || 'action_failed',
          ...(controller.signal.aborted
            ? {
                cancellation: {
                  requested: true,
                  reason: String(controller.signal.reason || 'interrupted_by_human'),
                  acknowledged: res?.cancellation?.acknowledged === true,
                  adapter: res?.cancellation?.adapter ?? null,
                },
                ...(res?.cancellation?.acknowledged === true
                  ? { failureKind: 'adapter_acknowledged_cancellation' }
                  : {}),
              }
            : {}),
        });
      } else {
        emit('action_completed', {
          intent,
          authorization,
          result: res,
          ...(controller.signal.aborted
            ? {
                cancellation: {
                  requested: true,
                  reason: String(controller.signal.reason || 'interrupted_by_human'),
                  acknowledged: false,
                  adapter: null,
                },
              }
            : {}),
        });
      }
      // If exclusive finished, release lease
      arbiter.releaseLease(intent.id);
      return res;
    } catch (e: any) {
      arbiter.releaseLease(intent.id);
      log(`[engine] error in ${intent.tool}: ${e?.message || String(e)}`);
      emit('action_failed', {
        intent,
        authorization,
        error: e?.message || String(e),
        failureKind: controller.signal.aborted
          ? 'unacknowledged_cancellation_registry_exception'
          : 'registry_exception',
        ...(controller.signal.aborted
          ? {
              cancellation: {
                requested: true,
                reason: String(controller.signal.reason || 'interrupted_by_human'),
                acknowledged: false,
                adapter: null,
              },
            }
          : {}),
      });
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, tickMs);
    scheduleTick();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function shutdown(reason = 'engine_shutdown') {
    if (shuttingDown) {
      if (inFlight) await inFlight.promise;
      return { drained: inFlight == null, activeIntent: inFlight?.intent ?? null };
    }
    shuttingDown = true;
    stop();
    mutedLLM = true;
    emit('controller_suspended', {
      reason,
      activeIntent: inFlight?.intent ?? arbiter.activeLease()?.intent ?? null,
    });
    for (const cancelled of arbiter.cancelQueued(() => true)) {
      emit('intent_blocked', {
        intent: cancelled,
        reason,
        error: 'engine_shutdown',
        result: { ok: false, error: 'engine_shutdown' },
      });
    }
    if (!inFlight) return { drained: true, activeIntent: null };
    const active = inFlight;
    if (!active.controller.signal.aborted) {
      emit('cancellation_requested', {
        intent: active.intent,
        requestedBy: {
          id: `system-${reason}`,
          source: 'system',
          tool: 'shutdown',
        },
        reason,
      });
      active.controller.abort(reason);
    }
    await active.promise;
    return { drained: inFlight == null, activeIntent: inFlight?.intent ?? null };
  }

  function enqueueHumanIntent(intent: Omit<Intent, 'source' | 'id'>) {
    if (intent.tool === 'stop') {
      muteLLM(true, 'human_stop');
    }
    const id = `human-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const fullIntent = {
      id,
      source: 'human' as const,
      tool: intent.tool,
      input: intent.input,
      preempt: intent.preempt,
    };
    if (shuttingDown) return enqueueIntent(fullIntent);
    if (intent.preempt && inFlight) {
      const reason = intent.tool === 'stop' ? 'human_stop' : 'human_preemption';
      if (!inFlight.controller.signal.aborted) {
        emit('cancellation_requested', {
          intent: inFlight.intent,
          requestedBy: fullIntent,
          reason,
        });
        inFlight.controller.abort(reason);
      }
      emit('preemption_deferred', {
        intent: fullIntent,
        activeIntent: inFlight.intent,
        reason: 'awaiting_active_action_terminal_cancellation_acknowledgement',
      });
    }
    return enqueueIntent(fullIntent);
  }

  function enqueueIntent(intent: Intent) {
    if (shuttingDown) {
      emit('intent_blocked', {
        intent,
        reason: 'engine_shutdown',
        error: 'engine_shutdown',
        result: { ok: false, error: 'engine_shutdown' },
      });
      return false;
    }
    if (mutedLLM && intent.source === 'llm') {
      emit('intent_blocked', {
        intent,
        reason: 'llm_muted_by_human_stop',
        error: 'interrupted_by_human',
        result: { ok: false, error: 'interrupted_by_human' },
      });
      return false;
    }
    if (arbiter.hasEquivalent(intent)) {
      emit('intent_deduplicated', { intent, reason: 'equivalent_intent_pending' });
      return false;
    }
    const queued = arbiter.enqueue(intent);
    emit('intent_enqueued', { intent: queued });
    scheduleTick();
    return true;
  }

  function muteLLM(mute: boolean, reason = 'llm_muted') {
    mutedLLM = !!mute;
    if (!mutedLLM) return;
    emit('controller_suspended', {
      reason,
      activeIntent: inFlight?.intent ?? arbiter.activeLease()?.intent ?? null,
    });
    for (const cancelled of arbiter.cancelQueued((candidate) => candidate.source === 'llm')) {
      emit('intent_blocked', {
        intent: cancelled,
        reason,
        error: 'interrupted_by_human',
        result: { ok: false, error: 'interrupted_by_human' },
      });
    }
  }
  return {
    start,
    stop,
    shutdown,
    tick,
    enqueueHumanIntent,
    enqueueIntent,
    arbiter, // exposed for wiring other drivers
    muteLLM,
    acceptsEvent: (event: unknown) =>
      Boolean(event && typeof event === 'object' && authenticEvents.has(event as object)),
    state: () => ({
      mutedLLM,
      shuttingDown,
      inFlightIntent: inFlight?.intent ?? null,
      queuedLease: arbiter.activeLease(),
    }),
  };
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}
