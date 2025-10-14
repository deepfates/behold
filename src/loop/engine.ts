import type { Bot } from 'mineflayer';
import { ActionArbiter, type Intent } from './arbiter';

export type Registry = {
  run: (name: string, args?: any) => Promise<any>;
  list: () => Array<{ name: string; description?: string; parameters?: any }>;
};

export type EngineOptions = {
  tickMs?: number;
  rateMax?: number;
  rateWindowMs?: number;
  allowTools?: string[] | null;
  now?: () => number;
  log?: (line: string) => void;
};

export function createEngine(bot: Bot, registry: Registry, opts: EngineOptions = {}) {
  const now = () => (opts.now ? opts.now() : Date.now());
  const log = (s: string) => (opts.log ? opts.log(s) : void 0);
  const tickMs = Math.max(200, Number(opts.tickMs ?? 3000));
  const allow = Array.isArray(opts.allowTools) ? new Set(opts.allowTools) : null;
  const arbiter = new ActionArbiter({ max: opts.rateMax ?? 20, windowMs: opts.rateWindowMs ?? 60_000 });

  let timer: NodeJS.Timeout | null = null;
  let mutedLLM = false;
  let stepRequested = false;

  async function tick() {
    // In a future slice, we will let the LLM driver enqueue intents here when not muted.
    const intent = arbiter.selectNext(now());
    if (!intent) return;
    if (allow && !allow.has(intent.tool) && intent.tool !== 'stop') {
      log(`[engine] blocked by allowlist: ${intent.tool}`);
      return;
    }
    try {
      log(`[engine] act: ${intent.tool}`);
      const res = await registry.run(intent.tool, intent.input);
      // If exclusive finished, release lease
      arbiter.releaseLease();
      return res;
    } catch (e: any) {
      arbiter.releaseLease();
      log(`[engine] error in ${intent.tool}: ${e?.message || String(e)}`);
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

  function enqueueHumanIntent(intent: Omit<Intent, 'source' | 'id' | 'kind'> & { kind?: 'exclusive' | 'parallel' }) {
    const id = `human-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    arbiter.enqueue({ id, source: 'human', kind: intent.kind ?? 'exclusive', tool: intent.tool, input: intent.input, preempt: intent.preempt });
  }

  function muteLLM(mute: boolean) { mutedLLM = !!mute; }
  function requestStep() { stepRequested = true; }

  return {
    start,
    stop,
    tick,
    enqueueHumanIntent,
    arbiter, // exposed for wiring other drivers
    muteLLM,
    requestStep,
  };
}

