import type { Intent } from '../arbiter';

export type Enqueue = (intent: Intent) => void;

export function createHumanDriver(enqueue: Enqueue) {
  function run(tool: string, input?: any, opts?: { preempt?: boolean; kind?: 'exclusive'|'parallel' }) {
    const intent: Intent = {
      id: `human-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source: 'human',
      tool,
      input,
      kind: opts?.kind ?? 'exclusive',
      preempt: !!opts?.preempt,
    };
    enqueue(intent);
  }
  return { run };
}
