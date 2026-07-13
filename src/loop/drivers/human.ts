import type { Intent } from '../arbiter';

export type Enqueue = (intent: Intent) => void;

export function createHumanDriver(enqueue: Enqueue) {
  function run(tool: string, input?: any, opts?: { preempt?: boolean }) {
    const intent: Intent = {
      id: `human-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source: 'human',
      tool,
      input,
      preempt: !!opts?.preempt,
    };
    enqueue(intent);
  }
  return { run };
}
