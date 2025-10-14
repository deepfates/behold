import readline from 'node:readline';
import type { Bot } from 'mineflayer';
import type { Config } from '../config';
import { collectObservation, type ChatLine } from './observation';

type HarnessOpts = {
  tickMs?: number;
  maxSteps?: number;
  thinkTimeoutMs?: number; // how long to wait for an action after an observation
  rateMax?: number; // actions per time window
  rateWindowMs?: number;
  allowTools?: string[] | null; // null means all
};

type Incoming =
  | { action: 'call'; id?: string; tool: string; input?: any }
  | { action: 'wait' }
  | { action: 'final'; text?: string };

export async function runStdioHarness(bot: Bot, _config: Config, fns: Record<string, (input: any) => Promise<any>>, specs: any[], opts: HarnessOpts = {}) {
  const tickMs = Math.max(200, Number(opts.tickMs ?? 3000));
  const thinkTimeoutMs = Math.max(500, Number(opts.thinkTimeoutMs ?? 8000));
  const maxSteps = Math.max(1, Number(opts.maxSteps ?? 128));
  const rateMax = Math.max(1, Number(opts.rateMax ?? 20));
  const rateWindowMs = Math.max(1000, Number(opts.rateWindowMs ?? 60_000));
  const allow = Array.isArray(opts.allowTools) ? new Set(opts.allowTools) : null;

  // Simple rate limiter (sliding window)
  const actionTimestamps: number[] = [];
  const withinRate = () => {
    const now = Date.now();
    while (actionTimestamps.length && now - actionTimestamps[0] > rateWindowMs) actionTimestamps.shift();
    return actionTimestamps.length < rateMax;
  };

  let lastChat: ChatLine = null;
  (bot as any).on?.('chat', (username: string, message: string) => {
    lastChat = { username, message, at: Date.now() };
  });

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const queue: Incoming[] = [];

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed) as Incoming;
      queue.push(msg);
    } catch (e) {
      emit({ event: 'error', error: 'invalid_json', detail: String(e) });
    }
  });

  function emit(obj: any) {
    try {
      process.stdout.write(JSON.stringify(obj) + '\n');
    } catch (e) {
      // best-effort; avoid throwing
    }
  }

  // Announce tools once
  emit({ event: 'hello', username: (bot as any).username, specs });

  let step = 0;
  main: while (step < maxSteps) {
    step += 1;
    emit({ event: 'status', phase: 'observing', step });
    const observation = collectObservation(bot, lastChat);
    emit({ event: 'observation', data: observation });

    emit({ event: 'status', phase: 'thinking', step });
    const action = await nextAction(queue, thinkTimeoutMs, tickMs);
    if (!action) {
      // no action provided; wait one tick
      await sleep(tickMs);
      continue;
    }

    if (!withinRate()) {
      emit({ event: 'error', error: 'rate_limited', detail: `max ${rateMax}/${Math.round(rateWindowMs / 1000)}s` });
      await sleep(tickMs);
      continue;
    }

    if (action.action === 'final') {
      if (action.text) (bot as any).chat?.(String(action.text));
      emit({ event: 'final', step, text: action.text ?? null });
      break main;
    }

    if (action.action === 'wait') {
      emit({ event: 'status', phase: 'waiting', step });
      await sleep(tickMs);
      continue;
    }

    // call
    const id = (action as any).id || `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const name = (action as any).tool;
    if (typeof name !== 'string' || !name) {
      emit({ event: 'tool_result', id, ok: false, error: 'missing_tool' });
      continue;
    }
    if (allow && !allow.has(name)) {
      emit({ event: 'tool_result', id, ok: false, error: 'tool_not_allowed', tool: name });
      continue;
    }

    const fn = (fns as any)[name];
    if (typeof fn !== 'function') {
      emit({ event: 'tool_result', id, ok: false, error: 'unknown_tool', tool: name });
      continue;
    }

    emit({ event: 'status', phase: 'acting', step, tool: name });
    actionTimestamps.push(Date.now());
    try {
      const result = await fn((action as any).input);
      emit({ event: 'tool_result', id, ok: true, result });
    } catch (e: any) {
      emit({ event: 'tool_result', id, ok: false, error: e?.message || String(e) });
    }
  }

  rl.close();
}

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function nextAction(queue: Incoming[], timeoutMs: number, pollEveryMs: number): Promise<Incoming | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (queue.length) return queue.shift()!;
    await sleep(Math.min(200, pollEveryMs));
  }
  return queue.length ? queue.shift()! : null;
}
