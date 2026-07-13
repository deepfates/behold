export type IntentSource = 'human' | 'llm' | 'system';

export type Intent = {
  id: string;
  source: IntentSource;
  tool: string;
  input?: any;
  kind: 'exclusive' | 'parallel';
  preempt?: boolean;
  deadlineMs?: number;
  enqueuedAt?: number;
};

export type Lease = {
  intent: Intent;
  startedAt: number;
};

export type RateWindow = { max: number; windowMs: number };

const DEFAULT_EXCLUSIVE = new Set<string>(['move_to', 'dig_block', 'place_against']);

export class ActionArbiter {
  private qHuman: Intent[] = [];
  private qSystem: Intent[] = [];
  private qLLM: Intent[] = [];
  private lastActions: number[] = [];
  private lease: Lease | null = null;
  private readonly rate: RateWindow;
  private readonly exclusive: Set<string>;

  constructor(
    rate: RateWindow = { max: 20, windowMs: 60_000 },
    exclusive: Set<string> = DEFAULT_EXCLUSIVE,
  ) {
    this.rate = rate;
    this.exclusive = exclusive;
  }

  enqueue(intent: Intent) {
    const now = Date.now();
    intent.enqueuedAt = intent.enqueuedAt ?? now;
    switch (intent.source) {
      case 'human':
        this.qHuman.push(intent);
        break;
      case 'system':
        this.qSystem.push(intent);
        break;
      case 'llm':
      default:
        this.qLLM.push(intent);
        break;
    }
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

  preempt() {
    this.lease = null;
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

  private isExclusive(tool: string) {
    return this.exclusive.has(tool);
  }

  selectNext(now = Date.now()): Intent | null {
    if (!this.withinRate(now)) return null;

    // If there is an active lease, allow only parallel intents, or human preemptions/stop
    if (this.lease) {
      const next = this.peekHuman() || this.peekSystem() || this.peekLLM();
      if (!next) return null;

      if (next.source === 'human' && (next.preempt || next.tool === 'stop')) {
        this.lease = null;
        return this.shift(next.source);
      }
      if (next && next.kind === 'parallel') {
        return this.shift(next.source);
      }
      return null; // wait for lease to finish
    }

    // No lease: priority Human > System > LLM
    const ready = this.shift('human') || this.shift('system') || this.shift('llm');
    if (!ready) return null;
    if (this.isExclusive(ready.tool) || ready.kind === 'exclusive') {
      this.lease = { intent: ready, startedAt: now };
    }
    this.markAction(now);
    return ready;
  }

  releaseLease(intentId?: string) {
    if (intentId && this.lease?.intent.id !== intentId) return;
    this.lease = null;
  }

  private peekHuman() {
    return this.qHuman[0] || null;
  }
  private peekSystem() {
    return this.qSystem[0] || null;
  }
  private peekLLM() {
    return this.qLLM[0] || null;
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
