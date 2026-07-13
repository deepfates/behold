import { ActionArbiter, type Intent } from './arbiter';

export type Registry = {
  run: (name: string, args?: any, intent?: Intent) => Promise<any>;
  list: () => Array<{ name: string; description?: string; parameters?: any }>;
};

export type EngineOptions = {
  tickMs?: number;
  rateMax?: number;
  rateWindowMs?: number;
  allowTools?: string[] | null;
  now?: () => number;
  log?: (line: string) => void;
  onEvent?: (event: { type: string; at: number; data: any }) => void;
};

export function createEngine(registry: Registry, opts: EngineOptions = {}) {
  const now = () => (opts.now ? opts.now() : Date.now());
  const log = (s: string) => (opts.log ? opts.log(s) : void 0);
  const emit = (type: string, data: any = {}) => opts.onEvent?.({ type, at: now(), data });
  const tickMs = Math.max(200, Number(opts.tickMs ?? 3000));
  const allow = Array.isArray(opts.allowTools) ? new Set(opts.allowTools) : null;
  const arbiter = new ActionArbiter({
    max: opts.rateMax ?? 20,
    windowMs: opts.rateWindowMs ?? 60_000,
  });

  let timer: NodeJS.Timeout | null = null;
  let mutedLLM = false;
  let stepRequested = false;

  async function tick() {
    // In a future slice, we will let the LLM driver enqueue intents here when not muted.
    const intent = arbiter.selectNext(now());
    if (!intent) return;
    if (allow && !allow.has(intent.tool) && intent.tool !== 'stop') {
      log(`[engine] blocked by allowlist: ${intent.tool}`);
      emit('intent_blocked', { intent, reason: 'allowlist' });
      arbiter.releaseLease(intent.id);
      return;
    }
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
      emit('tool_error', { intent, error: e?.message || String(e) });
      emit('action_failed', { intent, error: e?.message || String(e) });
    } finally {
      stepRequested = false;
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

  function enqueueHumanIntent(
    intent: Omit<Intent, 'source' | 'id' | 'kind'> & { kind?: 'exclusive' | 'parallel' },
  ) {
    if (intent.tool === 'stop') {
      muteLLM(true, 'human_stop');
    }
    const id = `human-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const fullIntent = {
      id,
      source: 'human' as const,
      kind: intent.kind ?? 'exclusive',
      tool: intent.tool,
      input: intent.input,
      preempt: intent.preempt,
    };
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
    arbiter.enqueue(intent);
    emit('intent_enqueued', { intent });
    return true;
  }

  function muteLLM(mute: boolean, reason = 'llm_muted') {
    mutedLLM = !!mute;
    if (!mutedLLM) return;
    for (const cancelled of arbiter.cancelQueued((candidate) => candidate.source === 'llm')) {
      emit('intent_blocked', {
        intent: cancelled,
        reason,
        error: 'interrupted_by_human',
        result: { ok: false, error: 'interrupted_by_human' },
      });
    }
  }
  function requestStep() {
    stepRequested = true;
  }

  return {
    start,
    stop,
    tick,
    enqueueHumanIntent,
    enqueueIntent,
    arbiter, // exposed for wiring other drivers
    muteLLM,
    requestStep,
  };
}
