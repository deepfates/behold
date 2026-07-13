export type IntentSource = 'human' | 'llm' | 'system';

export type Intent = {
  id: string;
  source: IntentSource;
  tool: string;
  input?: any;
  preempt?: boolean;
  deadlineMs?: number;
  enqueuedAt?: number;
};

export type Lease = {
  intent: Intent;
  startedAt: number;
};

export type RateWindow = { max: number; windowMs: number };

export class ActionArbiter {
  private qHuman: Intent[] = [];
  private qSystem: Intent[] = [];
  private qLLM: Intent[] = [];
  private lastActions: number[] = [];
  private lease: Lease | null = null;
  private readonly rate: RateWindow;

  constructor(rate: RateWindow = { max: 20, windowMs: 60_000 }) {
    this.rate = rate;
  }

  enqueue(intent: Intent) {
    const now = Date.now();
    const queued = freezeIntent({
      ...intent,
      input: cloneInput(intent.input),
      enqueuedAt: intent.enqueuedAt ?? now,
    });
    switch (queued.source) {
      case 'human':
        this.qHuman.push(queued);
        break;
      case 'system':
        this.qSystem.push(queued);
        break;
      case 'llm':
      default:
        this.qLLM.push(queued);
        break;
    }
    return queued;
  }

  hasEquivalent(intent: Intent) {
    const same = (candidate: Intent | undefined | null) =>
      !!candidate &&
      candidate.source === intent.source &&
      candidate.tool === intent.tool &&
      stableInput(candidate.input) === stableInput(intent.input);
    return (
      same(this.lease?.intent) ||
      this.qHuman.some(same) ||
      this.qSystem.some(same) ||
      this.qLLM.some(same)
    );
  }

  cancelQueued(predicate: (intent: Intent) => boolean) {
    const cancelled: Intent[] = [];
    const retain = (queue: Intent[]) =>
      queue.filter((intent) => {
        if (!predicate(intent)) return true;
        cancelled.push(intent);
        return false;
      });
    this.qHuman = retain(this.qHuman);
    this.qSystem = retain(this.qSystem);
    this.qLLM = retain(this.qLLM);
    return cancelled;
  }

  hasLease() {
    return !!this.lease;
  }

  activeLease(): Lease | null {
    return this.lease;
  }

  private withinRate(now: number) {
    const cutoff = now - this.rate.windowMs;
    while (this.lastActions.length && this.lastActions[0] < cutoff) this.lastActions.shift();
    return this.lastActions.length < this.rate.max;
  }

  private markAction(now: number) {
    this.lastActions.push(now);
  }

  selectNext(now = Date.now()): Intent | null {
    if (!this.withinRate(now)) return null;

    // A lease is released only by the execution engine after the selected
    // action reaches a terminal result. "Preempt" is a request for priority,
    // not permission to overlap a second physical action with the first.
    if (this.lease) return null;

    // No lease: priority Human > System > LLM
    const ready = this.shift('human') || this.shift('system') || this.shift('llm');
    if (!ready) return null;
    this.lease = { intent: ready, startedAt: now };
    this.markAction(now);
    return ready;
  }

  releaseLease(intentId?: string) {
    if (intentId && this.lease?.intent.id !== intentId) return;
    this.lease = null;
  }

  private shift(source: IntentSource): Intent | null {
    switch (source) {
      case 'human':
        return this.qHuman.shift() || null;
      case 'system':
        return this.qSystem.shift() || null;
      case 'llm':
        return this.qLLM.shift() || null;
    }
  }
}

function stableInput(value: any) {
  try {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    return JSON.stringify(sortObject(value));
  } catch {
    return String(value);
  }
}

function sortObject(value: any): any {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObject(value[key])]),
  );
}

function cloneInput(value: any) {
  if (value == null) return value;
  try {
    return structuredClone(value);
  } catch (error: any) {
    throw new Error(
      `intent input must be structured-cloneable: ${error?.message || String(error)}`,
    );
  }
}

function freezeIntent(intent: Intent) {
  deepFreeze(intent.input);
  return Object.freeze(intent);
}

function deepFreeze(value: any, seen = new WeakSet<object>()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
