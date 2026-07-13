import { ActionArbiter, type Intent } from './arbiter';

export type Registry = {
  run: (name: string, args?: any, intent?: Intent) => Promise<any>;
  list: () => Array<{ name: string; description?: string; parameters?: any }>;
};

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
  let mutedLLM = false;
  let inFlight: { intent: Intent; promise: Promise<any> } | null = null;

  async function tick() {
    // Until each adapter can acknowledge cancellation, serialize all actions.
    // This is deliberately stricter than the arbiter's future parallel lane:
    // correctness comes before speculative concurrency.
    if (inFlight) return;
    // In a future slice, we will let the LLM driver enqueue intents here when not muted.
    const intent = arbiter.selectNext(now());
    if (!intent) return;
    if (allow && !allow.has(intent.tool) && intent.tool !== 'stop') {
      log(`[engine] blocked by allowlist: ${intent.tool}`);
      emit('intent_blocked', { intent, reason: 'allowlist' });
      arbiter.releaseLease(intent.id);
      return;
    }
    const execution = execute(intent);
    inFlight = { intent, promise: execution };
    try {
      return await execution;
    } finally {
      if (inFlight?.intent.id === intent.id) inFlight = null;
    }
  }

  async function execute(intent: Intent) {
    try {
      log(`[arbiter] selected: ${intent.source} ${intent.tool}`);
      log(`[engine] act: ${intent.tool}`);
      emit('intent_selected', { intent });
      emit('action_started', { intent });
      const res = await registry.run(intent.tool, intent.input, intent);
      emit('tool_result', { intent, result: res });
      if (res?.ok === false) {
        emit('action_failed', {
          intent,
          result: res,
          error: res?.error || 'action_failed',
        });
      } else {
        emit('action_completed', { intent, result: res });
      }
      // If exclusive finished, release lease
      arbiter.releaseLease(intent.id);
      return res;
    } catch (e: any) {
      arbiter.releaseLease(intent.id);
      log(`[engine] error in ${intent.tool}: ${e?.message || String(e)}`);
      emit('action_failed', {
        intent,
        error: e?.message || String(e),
        failureKind: 'registry_exception',
      });
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, tickMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
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
    if (intent.preempt && inFlight) {
      emit('preemption_deferred', {
        intent: fullIntent,
        activeIntent: inFlight.intent,
        reason: 'active_action_must_reach_a_terminal_result',
      });
    }
    enqueueIntent(fullIntent);
  }

  function enqueueIntent(intent: Intent) {
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
    tick,
    enqueueHumanIntent,
    enqueueIntent,
    arbiter, // exposed for wiring other drivers
    muteLLM,
    acceptsEvent: (event: unknown) =>
      Boolean(event && typeof event === 'object' && authenticEvents.has(event as object)),
    state: () => ({
      mutedLLM,
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
