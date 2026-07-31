export type ResidentDecisionCyclePhase =
  | 'idle'
  | 'perceiving'
  | 'preparing_context'
  | 'deciding'
  | 'action_pending'
  | 'settling_action'
  | 'committing_turn'
  | 'suspended'
  | 'stopped';

export type ResidentWakeCause =
  | Readonly<{ kind: 'initial' | 'timer' | 'fixed_slot' | 'resume' | 'budget_resume' | 'external' }>
  | Readonly<{
      kind: 'world_event';
      type: string;
      sequence: number | null;
      salience: string | null;
    }>;

export type ResidentDecisionCycleState = Readonly<{
  protocol: 'behold.resident-decision-cycle-state.v1';
  phase: ResidentDecisionCyclePhase;
  enteredAt: number;
  activeWake: ResidentWakeCause | null;
  queuedWake: ResidentWakeCause | null;
  waitingFor:
    | 'timer_or_world_event'
    | 'world_event'
    | 'fixed_slot'
    | 'mind'
    | 'action_terminal'
    | 'context'
    | 'commit'
    | 'none';
  observationSequence: number | null;
  pendingIntent: Readonly<{ id: string; tool: string }> | null;
}>;

export function createResidentDecisionCycle(now: () => number) {
  let phase: ResidentDecisionCyclePhase = 'idle';
  let enteredAt = now();
  let activeWake: ResidentWakeCause | null = null;
  let queuedWake: ResidentWakeCause | null = null;
  let observationSequence: number | null = null;

  const enter = (
    next: ResidentDecisionCyclePhase,
    update: Readonly<{
      activeWake?: ResidentWakeCause | null;
      observationSequence?: number | null;
    }> = {},
  ) => {
    if (phase === 'stopped' && next !== 'stopped') return;
    if (phase === 'suspended' && !['suspended', 'stopped', 'idle'].includes(next)) return;
    phase = next;
    enteredAt = now();
    if ('activeWake' in update) {
      activeWake = update.activeWake ? freezeCause(update.activeWake) : null;
    }
    if ('observationSequence' in update) {
      observationSequence = finiteSequence(update.observationSequence);
    }
    if (next === 'idle' || next === 'suspended' || next === 'stopped') {
      activeWake = null;
      observationSequence = null;
    }
  };

  const queueWake = (cause: ResidentWakeCause) => {
    if (!queuedWake || (cause.kind === 'world_event' && queuedWake.kind !== 'world_event')) {
      queuedWake = freezeCause(cause);
    }
  };

  const clearQueuedWake = () => {
    queuedWake = null;
  };

  const takeQueuedWake = () => {
    const cause = queuedWake;
    queuedWake = null;
    return cause;
  };

  const snapshot = (
    pendingIntent: Readonly<{ id: string; tool: string }> | null,
    fixedPilotSlots: boolean,
  ): ResidentDecisionCycleState =>
    Object.freeze({
      protocol: 'behold.resident-decision-cycle-state.v1' as const,
      phase,
      enteredAt,
      activeWake,
      queuedWake,
      waitingFor: waitingFor(phase, fixedPilotSlots),
      observationSequence,
      pendingIntent: pendingIntent ? Object.freeze({ ...pendingIntent }) : null,
    });

  return Object.freeze({ enter, queueWake, clearQueuedWake, takeQueuedWake, snapshot });
}

function waitingFor(
  phase: ResidentDecisionCyclePhase,
  fixedPilotSlots: boolean,
): ResidentDecisionCycleState['waitingFor'] {
  if (phase === 'idle') return fixedPilotSlots ? 'fixed_slot' : 'timer_or_world_event';
  if (phase === 'perceiving') return 'none';
  if (phase === 'preparing_context') return 'context';
  if (phase === 'deciding') return 'mind';
  if (phase === 'action_pending') return 'action_terminal';
  if (phase === 'settling_action') return 'none';
  if (phase === 'committing_turn') return 'commit';
  if (phase === 'suspended') return 'world_event';
  return 'none';
}

function freezeCause(cause: ResidentWakeCause): ResidentWakeCause {
  return Object.freeze({ ...cause }) as ResidentWakeCause;
}

function finiteSequence(value: unknown) {
  if (value == null) return null;
  const sequence = Number(value);
  return Number.isFinite(sequence) ? sequence : null;
}
