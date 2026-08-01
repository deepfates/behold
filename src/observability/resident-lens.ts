import { HUMAN_SEMANTIC_OBSERVATION_PROTOCOL } from '../mind/minecraft-body';
import { projectResidentVisibleValue } from '../mind/resident-visibility';
import { RESIDENT_LIFE_COMMIT_EVENT } from './resident-life-commit';

export const RESIDENT_LENS_PROTOCOL = 'behold.resident-lens.v2' as const;

const RECENT_ACTIVITY_LIMIT = 12;

export type RunJournalEvent = Readonly<{
  sequence: number;
  at: string;
  engineAt?: number;
  agent: string;
  type: string;
  data?: any;
}>;

export type ResidentLensPhase =
  | 'starting'
  | 'deciding'
  | 'chosen'
  | 'queued'
  | 'acting'
  | 'settled'
  | 'waiting'
  | 'stopping'
  | 'stopped';

export type ResidentLensState = Readonly<{
  protocol: typeof RESIDENT_LENS_PROTOCOL;
  runId: string | null;
  entityId: string | null;
  bodyUsername: string | null;
  cursor: Readonly<{ journalSequence: number; at: string | null }>;
  phase: ResidentLensPhase;
  decision: Readonly<{
    opportunityId: string | null;
    scheduledAt: number | null;
    completedAt: number | null;
    latencyMs: number | null;
    terminal: string | null;
  }>;
  sees: any | null;
  chooses: Readonly<{
    intentId: string | null;
    name: string;
    input: any;
    source: string;
    utterance: string | null;
  }> | null;
  doing: Readonly<{
    intentId: string;
    name: string;
    status: 'queued' | 'selected' | 'authorized' | 'started' | 'running';
    startedAt: number | null;
  }> | null;
  consequence: Readonly<{
    intentId: string | null;
    ok: boolean;
    eventType: string;
    result: any;
    error: string | null;
    committedToLync: boolean;
  }> | null;
  nextExperience: any | null;
  bodyCondition: Readonly<{
    value: any;
    observedAt: number | null;
  }> | null;
  lync: Readonly<{
    committedTurns: number;
    tipId: string | null;
    tipSequence: number | null;
    parentId: string | null;
    committedAt: string | null;
  }>;
  ethogram: Readonly<{
    decisions: Readonly<{
      scheduled: number;
      terminals: Readonly<Record<string, number>>;
      latencyMs: Readonly<{
        count: number;
        total: number;
        min: number | null;
        max: number | null;
        last: number | null;
      }>;
    }>;
    actions: Readonly<{
      committed: number;
      succeeded: number;
      failed: number;
      byName: Readonly<Record<string, number>>;
    }>;
    perceivedEvents: Readonly<{
      total: number;
      byType: Readonly<Record<string, number>>;
    }>;
    verifiedWorldChanges: Readonly<{
      total: number;
      byVerb: Readonly<Record<string, number>>;
    }>;
    recent: readonly Readonly<{
      turnId: string;
      turnSequence: number;
      at: number | null;
      kind: 'perceived_event' | 'verified_world_change';
      type: string;
      detail: any;
    }>[];
  }>;
  unavailable: Readonly<{
    journal: string | null;
    sees: string | null;
    nextExperience: string | null;
  }>;
}>;

export function createResidentLensState(): ResidentLensState {
  return freeze({
    protocol: RESIDENT_LENS_PROTOCOL,
    runId: null,
    entityId: null,
    bodyUsername: null,
    cursor: { journalSequence: 0, at: null },
    phase: 'starting',
    decision: emptyDecision(),
    sees: null,
    chooses: null,
    doing: null,
    consequence: null,
    nextExperience: null,
    bodyCondition: null,
    lync: {
      committedTurns: 0,
      tipId: null,
      tipSequence: null,
      parentId: null,
      committedAt: null,
    },
    ethogram: {
      decisions: {
        scheduled: 0,
        terminals: {},
        latencyMs: { count: 0, total: 0, min: null, max: null, last: null },
      },
      actions: { committed: 0, succeeded: 0, failed: 0, byName: {} },
      perceivedEvents: { total: 0, byType: {} },
      verifiedWorldChanges: { total: 0, byVerb: {} },
      recent: [],
    },
    unavailable: { journal: null, sees: null, nextExperience: null },
  });
}

/**
 * Fold one already-authoritative run-journal event into a disposable operator
 * view. This never observes the bot, appends history, or treats private entity
 * turn frames as resident experience.
 */
export function applyResidentLensEvent(
  prior: ResidentLensState,
  event: RunJournalEvent,
): ResidentLensState {
  if (!validEnvelope(event)) return prior;
  if (event.sequence <= prior.cursor.journalSequence) return prior;

  const gap =
    event.sequence === prior.cursor.journalSequence + 1
      ? prior.unavailable.journal
      : `journal sequence gap after ${prior.cursor.journalSequence}; next event was ${event.sequence}`;
  const state: any = clone(prior);
  state.cursor = { journalSequence: event.sequence, at: event.at };
  state.entityId ||= event.agent;
  state.unavailable.journal = gap;

  switch (event.type) {
    case 'run_started':
      state.runId = text(event.data?.runId);
      state.entityId = event.agent;
      state.bodyUsername = text(event.data?.body?.username);
      state.phase = event.data?.controller?.paused === true ? 'waiting' : 'starting';
      break;

    case 'resident_decision_opportunity':
      applyDecisionOpportunity(state, event.data);
      break;

    case 'model_turn': {
      const observation = safeObservation(event.data?.observation);
      state.sees = observation;
      state.unavailable.sees = observation
        ? null
        : 'model turn did not contain a safe human-semantic observation';
      state.bodyCondition = bodyCondition(observation);
      state.chooses = choice(event.data);
      state.phase = state.chooses ? 'chosen' : 'waiting';
      state.doing = null;
      state.consequence = null;
      state.nextExperience = null;
      state.unavailable.nextExperience = null;
      break;
    }

    case 'intent_enqueued':
      state.doing = actionProgress(event.data?.intent, 'queued', event.engineAt);
      state.phase = state.doing ? 'queued' : state.phase;
      break;
    case 'intent_selected':
      state.doing = actionProgress(event.data?.intent, 'selected', event.engineAt);
      state.phase = state.doing ? 'acting' : state.phase;
      break;
    case 'permission_decision':
      if (event.data?.authorization?.ok === true) {
        state.doing = actionProgress(event.data?.intent, 'authorized', event.engineAt);
        state.phase = state.doing ? 'acting' : state.phase;
      }
      break;
    case 'action_started':
      state.doing = actionProgress(event.data?.intent, 'started', event.engineAt);
      state.phase = state.doing ? 'acting' : state.phase;
      break;
    case 'tool_result':
      state.doing = actionProgress(event.data?.intent, 'running', event.engineAt);
      state.phase = state.doing ? 'acting' : state.phase;
      break;

    case 'intent_blocked':
    case 'action_failed':
    case 'action_completed':
      state.consequence = engineConsequence(event);
      state.doing = null;
      state.phase = 'settled';
      break;

    case 'entity_turn':
      applyCommittedTurn(state, event.data, event.at);
      break;

    case RESIDENT_LIFE_COMMIT_EVENT:
      applyResidentLifeCommit(state, event.data, event.at);
      break;

    case 'operator_cognition_control':
      if (event.data?.phase === 'acknowledged') {
        state.phase = event.data?.state === 'paused' ? 'waiting' : 'settled';
      }
      break;

    case 'run_stopping':
      state.phase = 'stopping';
      break;
    case 'run_stopped':
      state.phase = 'stopped';
      state.doing = null;
      break;
  }

  return freeze(state);
}

export function foldResidentLens(events: readonly RunJournalEvent[]): ResidentLensState {
  return events.reduce(applyResidentLensEvent, createResidentLensState());
}

function applyDecisionOpportunity(state: any, data: any) {
  const opportunityId = text(data?.opportunityId);
  if (!opportunityId) return;
  const at = finite(data?.at);
  if (data?.phase === 'scheduled') {
    state.ethogram.decisions.scheduled += 1;
    state.decision = {
      opportunityId,
      scheduledAt: at,
      completedAt: null,
      latencyMs: null,
      terminal: null,
    };
    state.sees = null;
    state.chooses = null;
    state.doing = null;
    state.consequence = null;
    state.nextExperience = null;
    state.unavailable.sees = 'decision observation is pending its safe model-turn projection';
    state.unavailable.nextExperience = null;
    state.phase = 'deciding';
    return;
  }
  if (data?.phase !== 'terminal') return;
  const scheduledAt =
    state.decision.opportunityId === opportunityId ? state.decision.scheduledAt : null;
  state.decision = {
    opportunityId,
    scheduledAt,
    completedAt: at,
    latencyMs: scheduledAt !== null && at !== null ? Math.max(0, at - scheduledAt) : null,
    terminal: text(data?.terminal),
  };
  increment(state.ethogram.decisions.terminals, text(data?.terminal) ?? 'unknown');
  if (state.decision.latencyMs !== null) {
    const latency = state.decision.latencyMs;
    const summary = state.ethogram.decisions.latencyMs;
    summary.count += 1;
    summary.total += latency;
    summary.min = summary.min === null ? latency : Math.min(summary.min, latency);
    summary.max = summary.max === null ? latency : Math.max(summary.max, latency);
    summary.last = latency;
  }
  if (data?.terminal !== 'success') state.phase = 'settled';
}

function applyCommittedTurn(state: any, turn: any, committedAt: string) {
  const presentation = safePresentation(turn?.observationPresentation);
  const observation = presentation?.observation ?? null;
  const nextObservation = presentation?.nextObservation ?? null;
  if (!state.sees && observation) state.sees = observation;
  if (observation) state.unavailable.sees = null;
  state.nextExperience = nextObservation;
  state.unavailable.nextExperience = nextObservation
    ? null
    : 'committed turn did not contain a safe human-semantic next-experience projection';
  state.bodyCondition = bodyCondition(nextObservation) ?? state.bodyCondition;
  state.chooses = turnChoice(turn);
  state.consequence = committedConsequence(turn);
  state.doing = null;
  state.phase = turn?.action?.name === 'wait_for_event' ? 'waiting' : 'settled';
  const turnId = text(turn?.id);
  const turnSequence = positiveInteger(turn?.sequence);
  if (!turnId || turnSequence === null) return;
  state.lync.committedTurns += 1;
  state.lync.tipId = turnId;
  state.lync.tipSequence = turnSequence;
  state.lync.parentId = text(turn?.parentId);
  state.lync.committedAt = committedAt;

  const actionName = text(turn?.action?.name) ?? 'unknown';
  state.ethogram.actions.committed += 1;
  increment(state.ethogram.actions.byName, actionName);
  if (turn?.outcome?.ok === true) state.ethogram.actions.succeeded += 1;
  else state.ethogram.actions.failed += 1;

  // Count only the observation that actually informed this model choice.
  // nextObservation is an auditable terminal snapshot, not experience shown
  // to the resident during this turn; fresh events there become perceived
  // only if a later decision admits them as its observation.
  const events = Array.isArray(observation?.events) ? observation.events : [];
  for (const event of events) {
    const eventType = text(event?.type) ?? 'unknown';
    state.ethogram.perceivedEvents.total += 1;
    increment(state.ethogram.perceivedEvents.byType, eventType);
    if (recentEventType(eventType)) {
      appendRecent(state, {
        turnId,
        turnSequence,
        at: finite(nextObservation?.observedAt),
        kind: 'perceived_event',
        type: eventType,
        detail: project(event?.data),
      });
    }
  }

  const changes = Array.isArray(turn?.outcome?.result?.changes) ? turn.outcome.result.changes : [];
  for (const change of changes) {
    if (change?.verified !== true || change?.observed !== true) continue;
    const verb = text(change?.verb) ?? 'change';
    state.ethogram.verifiedWorldChanges.total += 1;
    increment(state.ethogram.verifiedWorldChanges.byVerb, verb);
    appendRecent(state, {
      turnId,
      turnSequence,
      at: finite(change?.confirmation?.observedAt),
      kind: 'verified_world_change',
      type: verb,
      detail: project({
        before: change?.before,
        after: change?.after,
        confirmation: change?.confirmation,
      }),
    });
  }
}

function applyResidentLifeCommit(state: any, commit: any, committedAt: string) {
  if (commit?.protocol !== 'behold.resident-life-commit.v1') return;
  const turn = {
    id: commit.entity?.turnId,
    sequence: commit.entity?.sequence,
    parentId: commit.entity?.parentTurnId,
    observationPresentation:
      commit.experience == null
        ? null
        : {
            protocol: commit.experience.protocol,
            bodyProfile: commit.experience.bodyProfile,
            observation: commit.experience.before,
            nextObservation: commit.experience.after,
          },
    utterance: {
      assistant: { content: commit.choice?.utterance },
      publicCommitment: commit.choice?.publicCommitment,
    },
    action: commit.choice?.action,
    outcome: commit.consequence,
  };
  applyCommittedTurn(state, turn, committedAt);
  const receipt = commit.lync;
  if (
    receipt?.protocol === 'behold.entity-turn-commit-receipt.v1' &&
    receipt.entityId === commit.entity?.id &&
    receipt.sequence === commit.entity?.sequence &&
    receipt.legacyTurnId === commit.entity?.turnId
  ) {
    state.lync.committedTurns = positiveInteger(receipt.depth) ?? state.lync.committedTurns;
    state.lync.tipId = text(receipt.turn?.turnId) ?? state.lync.tipId;
  }
}

function appendRecent(state: any, item: any) {
  state.ethogram.recent.push(item);
  if (state.ethogram.recent.length > RECENT_ACTIVITY_LIMIT) {
    state.ethogram.recent.splice(0, state.ethogram.recent.length - RECENT_ACTIVITY_LIMIT);
  }
}

function recentEventType(type: string) {
  return [
    'chat_received',
    'entity_became_visible',
    'entity_left_view',
    'visible_player_equipment_changed',
    'visible_block_changed',
    'item_collected',
    'inventory_changed',
    'controller_suspended',
    'weather_changed',
    'day_phase_changed',
  ].includes(type);
}

function increment(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function choice(data: any): ResidentLensState['chooses'] {
  const intent = data?.intent;
  const name = text(intent?.tool);
  if (!name) return null;
  return {
    intentId: text(intent?.id),
    name,
    input: project(intent?.input),
    source: text(intent?.source) ?? 'llm',
    utterance: text(data?.assistant?.content),
  };
}

function turnChoice(turn: any): ResidentLensState['chooses'] {
  const name = text(turn?.action?.name);
  if (!name) return null;
  return {
    intentId: text(turn?.action?.id),
    name,
    input: project(turn?.action?.input),
    source: text(turn?.action?.source) ?? 'unknown',
    utterance: text(turn?.utterance?.assistant?.content),
  };
}

function actionProgress(
  intent: any,
  status: ResidentLensState['doing'] extends infer T
    ? T extends { status: infer S }
      ? S
      : never
    : never,
  engineAt?: number,
): ResidentLensState['doing'] {
  const intentId = text(intent?.id);
  const name = text(intent?.tool);
  if (!intentId || !name) return null;
  return {
    intentId,
    name,
    status,
    startedAt: status === 'started' ? finite(engineAt) : null,
  };
}

function engineConsequence(event: RunJournalEvent): ResidentLensState['consequence'] {
  return {
    intentId: text(event.data?.intent?.id),
    ok: event.type === 'action_completed',
    eventType: event.type,
    result: project(event.data?.result),
    error: text(event.data?.error ?? event.data?.reason),
    committedToLync: false,
  };
}

function committedConsequence(turn: any): ResidentLensState['consequence'] {
  if (typeof turn?.outcome?.ok !== 'boolean') return null;
  return {
    intentId: text(turn?.action?.id),
    ok: turn.outcome.ok,
    eventType: text(turn.outcome.eventType) ?? 'unknown',
    result: project(turn.outcome.result),
    error: text(turn.outcome.error),
    committedToLync: true,
  };
}

function safePresentation(value: any) {
  if (
    value?.protocol !== 'behold.entity-turn-observation-presentation.v1' ||
    value?.bodyProfile !== 'minecraft-human-semantic-v1'
  ) {
    return null;
  }
  const observation = safeObservation(value.observation);
  const nextObservation = safeObservation(value.nextObservation);
  if (!observation || !nextObservation) return null;
  return { observation, nextObservation };
}

function safeObservation(value: any) {
  if (
    !value ||
    typeof value !== 'object' ||
    value.protocol !== HUMAN_SEMANTIC_OBSERVATION_PROTOCOL ||
    value.bodyContract?.profile !== 'minecraft-human-semantic-v1'
  ) {
    return null;
  }
  return clone(value);
}

function bodyCondition(observation: any): ResidentLensState['bodyCondition'] {
  if (!observation?.self?.condition) return null;
  return {
    value: clone(observation.self.condition),
    observedAt: finite(observation.observedAt),
  };
}

function project(value: any) {
  return clone(projectResidentVisibleValue(value));
}

function emptyDecision(): ResidentLensState['decision'] {
  return {
    opportunityId: null,
    scheduledAt: null,
    completedAt: null,
    latencyMs: null,
    terminal: null,
  };
}

function validEnvelope(value: any): value is RunJournalEvent {
  return (
    Number.isSafeInteger(value?.sequence) &&
    value.sequence > 0 &&
    typeof value.at === 'string' &&
    typeof value.agent === 'string' &&
    value.agent.length > 0 &&
    typeof value.type === 'string' &&
    value.type.length > 0
  );
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const item of Object.values(value as Record<string, unknown>)) freeze(item, seen);
  return Object.freeze(value);
}
