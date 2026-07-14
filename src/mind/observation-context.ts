import { isDeepStrictEqual } from 'node:util';
import type { EntityTurn } from '../entity/loom';
import { projectResidentVisibleValue } from './resident-visibility';

const MODEL_EVENT_BATCH = 12;
const RECENT_ACTION_TURN_LIMIT = 6;
const RECENT_ACTION_BYTE_LIMIT = 12_000;
const RECENT_ACTION_TURN_BYTE_LIMIT = 4_000;
const REDUNDANT_OWN_LIFECYCLE_EVENTS = new Set([
  'intent_enqueued',
  'intent_selected',
  'permission_decision',
  'action_started',
  'tool_result',
  'action_completed',
]);

export type RecentActionContinuity = {
  protocol: 'behold.recent-action-continuity.v1';
  source: {
    entityId: string;
    fromTurn: number;
    throughTurn: number;
    includedTurns: number;
    omittedOlderTurns: number;
    turnLimit: number;
    byteLimit: number;
    authority: 'entity_loom';
    currency: 'historical_current_observation_wins';
  };
  turns: Array<{
    turn: number;
    completedAt: number;
    controller: string;
    publicIntention?: string;
    action: {
      name: string;
      input?: any;
      inputOmittedFromWorkingContinuity?: true;
    };
    outcome: {
      ok: boolean;
      eventType: string;
      error?: string;
      result?: any;
      resultOmittedFromWorkingContinuity?: true;
    };
    glimpse?: {
      protocol: 'behold.first-person-glimpse.v1';
      observationSequence: number | null;
      observedAt: number | null;
      orientation: { facing: string; vertical: string } | null;
      focus: {
        id: string;
        kind: string;
        name: string;
        distance: number | null;
        reachable: boolean | null;
      } | null;
      visualField: HistoricalFirstPersonVisualField;
      provenance: 'historical_next_observation';
      currency: 'historical_current_observation_wins';
    };
  }>;
};

type HistoricalFirstPersonVisualField = {
  protocol: 'behold.visual-field.v1';
  available: boolean;
  dimensions: { rows: number | null; columns: number | null };
  rowOrder: string;
  columnOrder: string;
  materialRows: string[];
  depthRows: string[];
  materialLegend: Array<{ symbol: string; name: string }>;
  depthLegend: Array<{ symbol: string; label: string; maxDistance: number | null }>;
  noHitSymbol: string;
  unavailableSymbol: string;
  center: { row: number | null; column: number | null; alignedWith: 'historical_view' };
};

/**
 * A small causal working set for fast attention.
 *
 * Urgent cognition cannot afford the whole recent conversation, but it still
 * needs to know what this body just tried and what the world actually did.
 * This projection contains only the inhabitant's own committed action/outcome
 * pairs plus a tiny allowlisted first-person glimpse after each action. It
 * carries no loaded-volume scene, hidden coordinate, provider reasoning, or
 * controller scratch state, and explicitly yields to the current observation.
 */
export function projectRecentActionContinuity(
  turns: readonly EntityTurn[],
  turnLimit = RECENT_ACTION_TURN_LIMIT,
  byteLimit = RECENT_ACTION_BYTE_LIMIT,
  mayReplayTurn: (turn: EntityTurn) => boolean = () => true,
): RecentActionContinuity | null {
  if (!turns.length) return null;
  const boundedTurns = integerInRange(turnLimit, 1, 12, RECENT_ACTION_TURN_LIMIT);
  const boundedBytes = integerInRange(byteLimit, 1_000, 64_000, RECENT_ACTION_BYTE_LIMIT);
  const entityId = String(turns.at(-1)?.entityId || '').trim();
  if (!entityId || turns.some((turn) => turn.entityId !== entityId)) {
    throw new Error('recent action continuity cannot mix inhabitant identities');
  }

  const candidates = turns
    .slice(-boundedTurns)
    .map((turn) =>
      !mayReplayTurn(turn) ? projectOmittedContinuityTurn(turn) : projectContinuityTurn(turn),
    );
  let selected: RecentActionContinuity['turns'] = [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const proposed = [candidate, ...selected];
    if (
      Buffer.byteLength(
        JSON.stringify(continuityEnvelope(entityId, proposed, boundedTurns, boundedBytes)),
        'utf8',
      ) > boundedBytes
    ) {
      if (selected.length === 0) {
        selected = [
          continuityTurnWithinEnvelopeBudget(turns.at(-1)!, entityId, boundedTurns, boundedBytes),
        ];
      }
      break;
    }
    selected = proposed;
  }

  return continuityEnvelope(entityId, selected, boundedTurns, boundedBytes);
}

function continuityEnvelope(
  entityId: string,
  turns: RecentActionContinuity['turns'],
  turnLimit: number,
  byteLimit: number,
): RecentActionContinuity {
  return {
    protocol: 'behold.recent-action-continuity.v1',
    source: {
      entityId,
      fromTurn: turns[0].turn,
      throughTurn: turns.at(-1)!.turn,
      includedTurns: turns.length,
      omittedOlderTurns: Math.max(0, turns[0].turn - 1),
      turnLimit,
      byteLimit,
      authority: 'entity_loom',
      currency: 'historical_current_observation_wins',
    },
    turns,
  };
}

function projectContinuityTurn(turn: EntityTurn): RecentActionContinuity['turns'][number] {
  const projected: RecentActionContinuity['turns'][number] = {
    turn: turn.sequence,
    completedAt: turn.completedAt,
    controller: String(turn.action.source),
    ...publicIntention(turn),
    action: {
      name: String(turn.action.name),
      input: compactContinuityValue(projectResidentVisibleValue(turn.action.input)),
    },
    outcome: {
      ok: turn.outcome.ok === true,
      eventType: String(turn.outcome.eventType || ''),
      ...(turn.outcome.error ? { error: boundedContinuityText(turn.outcome.error, 400) } : {}),
      result: compactContinuityValue(projectResidentVisibleValue(turn.outcome.result)),
    },
    ...firstPersonGlimpse(turn),
  };
  if (Buffer.byteLength(JSON.stringify(projected), 'utf8') <= RECENT_ACTION_TURN_BYTE_LIMIT) {
    return projected;
  }
  return projectContinuityTurnFallback(turn);
}

function projectContinuityTurnFallback(turn: EntityTurn): RecentActionContinuity['turns'][number] {
  const projected: RecentActionContinuity['turns'][number] = {
    turn: turn.sequence,
    completedAt: turn.completedAt,
    controller: String(turn.action.source),
    ...publicIntention(turn, 200),
    action: {
      name: String(turn.action.name),
      inputOmittedFromWorkingContinuity: true,
    },
    outcome: {
      ok: turn.outcome.ok === true,
      eventType: String(turn.outcome.eventType || ''),
      ...(turn.outcome.error ? { error: boundedContinuityText(turn.outcome.error, 400) } : {}),
      resultOmittedFromWorkingContinuity: true,
    },
    ...firstPersonGlimpse(turn),
  };
  if (Buffer.byteLength(JSON.stringify(projected), 'utf8') <= RECENT_ACTION_TURN_BYTE_LIMIT) {
    return projected;
  }
  return projectMinimalContinuityTurn(turn);
}

function continuityTurnWithinEnvelopeBudget(
  turn: EntityTurn,
  entityId: string,
  turnLimit: number,
  byteLimit: number,
) {
  const withGlimpse = projectContinuityTurnFallback(turn);
  if (
    Buffer.byteLength(
      JSON.stringify(continuityEnvelope(entityId, [withGlimpse], turnLimit, byteLimit)),
      'utf8',
    ) <= byteLimit
  ) {
    return withGlimpse;
  }
  return projectMinimalContinuityTurn(turn);
}

function projectMinimalContinuityTurn(turn: EntityTurn): RecentActionContinuity['turns'][number] {
  return {
    turn: turn.sequence,
    completedAt: turn.completedAt,
    controller: boundedContinuityText(turn.action.source, 80),
    action: {
      name: boundedContinuityText(turn.action.name, 80),
      inputOmittedFromWorkingContinuity: true,
    },
    outcome: {
      ok: turn.outcome.ok === true,
      eventType: boundedContinuityText(turn.outcome.eventType, 80),
      resultOmittedFromWorkingContinuity: true,
    },
  };
}

function projectOmittedContinuityTurn(turn: EntityTurn): RecentActionContinuity['turns'][number] {
  return {
    turn: turn.sequence,
    completedAt: turn.completedAt,
    controller: String(turn.action.source),
    action: {
      name: String(turn.action.name),
      inputOmittedFromWorkingContinuity: true,
    },
    outcome: {
      ok: turn.outcome.ok === true,
      eventType: String(turn.outcome.eventType || ''),
      resultOmittedFromWorkingContinuity: true,
    },
  };
}

function publicIntention(turn: EntityTurn, limit = 600) {
  const content = turn.utterance?.assistant?.content;
  if (typeof content !== 'string' || !content.trim()) return {};
  return { publicIntention: boundedContinuityText(content.trim(), limit) };
}

function firstPersonGlimpse(turn: EntityTurn) {
  const observation = turn.nextObservation;
  const visualField = observation?.scene?.terrain?.visualField;
  if (visualField?.protocol !== 'behold.visual-field.v1') return {};
  const orientation = observationOrientation(observation?.self?.pose);
  const focus = observation?.scene?.focus;
  return {
    glimpse: {
      protocol: 'behold.first-person-glimpse.v1' as const,
      observationSequence: finiteOrNull(observation?.sequence),
      observedAt: finiteOrNull(observation?.observedAt),
      orientation:
        typeof orientation?.facing === 'string' && typeof orientation?.vertical === 'string'
          ? {
              facing: boundedContinuityText(orientation.facing, 32),
              vertical: boundedContinuityText(orientation.vertical, 32),
            }
          : null,
      focus:
        focus && typeof focus === 'object'
          ? {
              id: boundedContinuityText(focus.id, 160),
              kind: boundedContinuityText(focus.kind, 40),
              name: boundedContinuityText(focus.name, 120),
              distance: finiteOrNull(focus.distance),
              reachable: typeof focus.reachable === 'boolean' ? focus.reachable : null,
            }
          : null,
      visualField: projectVisualField(visualField),
      provenance: 'historical_next_observation' as const,
      currency: 'historical_current_observation_wins' as const,
    },
  };
}

function observationOrientation(pose: any) {
  if (
    typeof pose?.orientation?.facing === 'string' &&
    typeof pose?.orientation?.vertical === 'string'
  ) {
    return pose.orientation;
  }
  return projectCurrentPose(pose)?.orientation;
}

function projectVisualField(field: any): HistoricalFirstPersonVisualField {
  return {
    protocol: 'behold.visual-field.v1',
    available: field.available === true,
    dimensions: {
      rows: finiteOrNull(field?.dimensions?.rows),
      columns: finiteOrNull(field?.dimensions?.columns),
    },
    rowOrder: boundedContinuityText(field.rowOrder, 32),
    columnOrder: boundedContinuityText(field.columnOrder, 32),
    materialRows: boundedRows(field.materialRows),
    depthRows: boundedRows(field.depthRows),
    materialLegend: Array.isArray(field.materialLegend)
      ? field.materialLegend.slice(0, 32).map((entry: any) => ({
          symbol: boundedContinuityText(entry?.symbol, 4),
          name: boundedContinuityText(entry?.name, 120),
        }))
      : [],
    depthLegend: Array.isArray(field.depthLegend)
      ? field.depthLegend.slice(0, 8).map((entry: any) => ({
          symbol: boundedContinuityText(entry?.symbol, 4),
          label: boundedContinuityText(entry?.label, 80),
          maxDistance: finiteOrNull(entry?.maxDistance),
        }))
      : [],
    noHitSymbol: boundedContinuityText(field.noHitSymbol, 4),
    unavailableSymbol: boundedContinuityText(field.unavailableSymbol, 4),
    center: {
      row: finiteOrNull(field?.center?.row),
      column: finiteOrNull(field?.center?.column),
      alignedWith: 'historical_view',
    },
  };
}

function boundedRows(value: any) {
  return Array.isArray(value) ? value.slice(0, 9).map((row) => boundedContinuityText(row, 32)) : [];
}

function finiteOrNull(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactContinuityValue(value: any, depth = 0): any {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return boundedContinuityText(value, 400);
  if (depth >= 6) return '[depth bounded]';
  if (Array.isArray(value)) {
    const projected = value.slice(0, 24).map((item) => compactContinuityValue(item, depth + 1));
    if (value.length > projected.length) {
      projected.push(`[${value.length - projected.length} more items omitted]`);
    }
    return projected;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    const projected = Object.fromEntries(
      entries.slice(0, 32).map(([key, item]) => [key, compactContinuityValue(item, depth + 1)]),
    );
    if (entries.length > 32) projected.__omittedKeys = entries.length - 32;
    return projected;
  }
  return boundedContinuityText(String(value), 400);
}

function integerInRange(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function boundedContinuityText(value: unknown, limit: number) {
  const text = String(value ?? '');
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

/**
 * A bounded, loss-visible projection for the controller's present experience.
 *
 * The inhabitant loom and engine journal retain the complete frame. This view
 * removes only successful lifecycle copies already delivered through the
 * protocol-valid assistant/tool exchange. Body, world, social, failure, and
 * foreign-controller events remain explicit.
 */
export function projectCurrentModelObservation(frame: any, eventBatchLimit = MODEL_EVENT_BATCH) {
  if (!frame || typeof frame !== 'object') return frame;
  const projectedSelf = projectSelf(frame.self);
  const projectedTask = projectTask(frame.task);
  if (!Array.isArray(frame.events)) {
    return {
      ...frame,
      ...(projectedTask ? { task: projectedTask } : {}),
      ...(projectedSelf ? { self: projectedSelf } : {}),
    };
  }

  const unread = frame.events.filter((event: any) => event?.isNew === true);
  // Cursor advancement follows the raw delivery batch, not the filtered
  // working view. Otherwise intentionally suppressed lifecycle events would
  // remain unread forever or silently skip later world evidence.
  const delivered = unread.slice(0, boundedEventBatchLimit(eventBatchLimit));
  const visible = delivered.filter(isModelRelevantEvent);
  const suppressed = delivered.filter((event: any) => !isModelRelevantEvent(event));
  const omittedNewEvents = Math.max(0, unread.length - delivered.length);
  return {
    ...frame,
    ...(projectedTask ? { task: projectedTask } : {}),
    ...(projectedSelf ? { self: projectedSelf } : {}),
    events: visible,
    eventWindow: {
      ...(frame.eventWindow || {}),
      deliveredOldestSequence: delivered[0]?.sequence ?? null,
      deliveredNewestSequence: delivered.at(-1)?.sequence ?? null,
      omittedNewEvents,
      suppressedControllerEvents: suppressed.length,
      suppressedControllerEventTypes: eventTypeCounts(suppressed),
      complete: frame.eventWindow?.complete !== false && omittedNewEvents === 0,
    },
  };
}

function projectTask(task: any) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return task;
  const projected: Record<string, any> = {};
  for (const [key, value] of Object.entries(task)) {
    if (key === 'id' && value === task.goal) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (value == null) continue;
    projected[key] = value;
  }
  return projected;
}

/**
 * Recent turns still need causal anchors, but not another full copy of the
 * current task. The authoritative turn retains it and the latest observation
 * supplies the task presently governing the controller.
 */
export function projectHistoricalModelObservation(
  frame: any,
  previousFrame?: any,
  previousSource:
    'previous_turn_next_observation' | 'same_turn_observation' = 'previous_turn_next_observation',
  eventBatchLimit = MODEL_EVENT_BATCH,
) {
  const projected = projectCurrentModelObservation(frame, eventBatchLimit);
  if (!projected || typeof projected !== 'object') return projected;
  const self = projectHistoricalSelf(projected.self);
  const previousSelf = previousFrame ? projectHistoricalSelf(previousFrame.self) : null;
  const previousEvents = historicalEventKeys(previousFrame?.events);
  const events = Array.isArray(projected.events)
    ? projected.events.filter((event: any) => !previousEvents.has(historicalEventKey(event)))
    : projected.events;
  const repeatedEvents = Array.isArray(projected.events)
    ? projected.events.length - events.length
    : 0;
  return {
    protocol: projected.protocol,
    circle: projected.circle,
    sequence: projected.sequence,
    observedAt: projected.observedAt,
    eventWindow: projectHistoricalEventWindow(projected.eventWindow, repeatedEvents),
    self: previousSelf ? projectHistoricalSelfDelta(self, previousSelf) : self,
    events,
    historicalProjection: {
      source: 'authoritative_entity_turn',
      mode: 'causal_delta',
      previous: previousSelf ? previousSource : null,
    },
  };
}

function boundedEventBatchLimit(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= 256 ? number : MODEL_EVENT_BATCH;
}

function projectHistoricalEventWindow(window: any, repeatedEvents = 0) {
  if (!window || typeof window !== 'object') return window;
  return {
    complete: window.complete !== false,
    missingBeforeOldest: Math.max(0, Number(window.missingBeforeOldest) || 0),
    omittedNewEvents: Math.max(0, Number(window.omittedNewEvents) || 0),
    ...(repeatedEvents > 0 ? { suppressedRepeatedEvents: repeatedEvents } : {}),
  };
}

function historicalEventKeys(events: any) {
  const keys = new Set<string>();
  if (!Array.isArray(events)) return keys;
  for (const event of events) {
    if (event?.isNew !== true) continue;
    const key = historicalEventKey(event);
    if (key) keys.add(key);
  }
  return keys;
}

function historicalEventKey(event: any) {
  const sequence = Number(event?.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return '';
  return `${sequence}:${String(event?.type || '')}`;
}

function projectHistoricalSelfDelta(self: any, previous: any) {
  if (!self || typeof self !== 'object' || !previous || typeof previous !== 'object') return self;
  const delta: Record<string, any> = { identity: self.identity };
  if (!isDeepStrictEqual(self.pose, previous.pose)) {
    if (!self.pose || typeof self.pose !== 'object' || !previous.pose) {
      delta.pose = self.pose ?? null;
    } else {
      const pose: Record<string, any> = {};
      if (!isDeepStrictEqual(self.pose.position, previous.pose.position)) {
        pose.position = self.pose.position ?? null;
      }
      if (!isDeepStrictEqual(self.pose.onGround, previous.pose.onGround)) {
        pose.onGround = self.pose.onGround ?? null;
      }
      delta.pose = pose;
    }
  }
  for (const key of ['condition', 'heldItem', 'inventory', 'projects']) {
    if (!isDeepStrictEqual(self[key], previous[key])) delta[key] = self[key] ?? null;
  }
  return delta;
}

function projectHistoricalSelf(self: any) {
  if (!self || typeof self !== 'object') return self;
  return {
    identity: self.identity,
    pose: self.pose
      ? {
          position: self.pose.position,
          onGround: self.pose.onGround,
        }
      : self.pose,
    condition: self.condition,
    heldItem: self.heldItem,
    inventory: self.inventory,
    projects: Array.isArray(self.projects) ? projectActiveProjects(self.projects) : self.projects,
  };
}

function projectSelf(self: any) {
  if (!self || typeof self !== 'object') return self;
  return projectResidentVisibleValue({
    ...self,
    ...(self.pose ? { pose: projectCurrentPose(self.pose) } : {}),
    ...(Array.isArray(self.projects) ? { projects: projectActiveProjects(self.projects) } : {}),
    currentAction: projectCurrentAction(self.currentAction),
  });
}

function projectActiveProjects(projects: any[]) {
  return projects.map((project) => {
    if (!project || typeof project !== 'object' || Array.isArray(project)) return project;
    const { evidence, status: _legacyStatus, ...current } = project;
    return {
      ...current,
      status: 'active_unfinished',
      completionRequires: current.completionRequires ?? evidence ?? null,
    };
  });
}

function projectCurrentPose(pose: any) {
  if (!pose || typeof pose !== 'object') return pose;
  const { yaw, pitch, ...embodied } = pose;
  const numericYaw = Number(yaw);
  const numericPitch = Number(pitch);
  if (!Number.isFinite(numericYaw) || !Number.isFinite(numericPitch)) return embodied;
  const x = -Math.sin(numericYaw) * Math.cos(numericPitch);
  const z = -Math.cos(numericYaw) * Math.cos(numericPitch);
  const facing = Math.abs(x) > Math.abs(z) ? (x > 0 ? 'east' : 'west') : z > 0 ? 'south' : 'north';
  const vertical =
    numericPitch > Math.PI / 12 ? 'up' : numericPitch < -Math.PI / 12 ? 'down' : 'level';
  return { ...embodied, orientation: { facing, vertical } };
}

function projectCurrentAction(action: any) {
  if (!action || typeof action !== 'object') return action;
  const { result, ...identity } = action;
  if (result == null) return identity;
  if (result?.ok === false) {
    return {
      ...identity,
      result: failureSummary(result),
    };
  }
  return {
    ...identity,
    resultOmittedFromWorkingContext: true,
  };
}

function failureSummary(result: any) {
  return {
    ok: false,
    error: textOrNull(result?.error),
    reason: textOrNull(result?.reason),
    status: textOrNull(result?.status),
  };
}

function isModelRelevantEvent(event: any) {
  const type = String(event?.type || '');
  if (!REDUNDANT_OWN_LIFECYCLE_EVENTS.has(type)) return true;
  const source = String(event?.data?.intent?.source || '');
  return source !== 'llm';
}

function eventTypeCounts(events: readonly any[]) {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const type = String(event?.type || 'unknown');
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function textOrNull(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 400) : null;
}
