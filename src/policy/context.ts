import { isDeepStrictEqual } from 'node:util';

const MODEL_EVENT_BATCH = 12;
const REDUNDANT_OWN_LIFECYCLE_EVENTS = new Set([
  'intent_enqueued',
  'intent_selected',
  'permission_decision',
  'action_started',
  'tool_result',
  'action_completed',
]);

/**
 * A bounded, loss-visible projection for the controller's present experience.
 *
 * The inhabitant loom and engine journal retain the complete frame. This view
 * removes only successful lifecycle copies already delivered through the
 * protocol-valid assistant/tool exchange. Body, world, social, failure, and
 * foreign-controller events remain explicit.
 */
export function projectCurrentModelObservation(frame: any) {
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
  const delivered = unread.slice(0, MODEL_EVENT_BATCH);
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
) {
  const projected = projectCurrentModelObservation(frame);
  if (!projected || typeof projected !== 'object') return projected;
  const self = projectHistoricalSelf(projected.self);
  const previousSelf = previousFrame ? projectHistoricalSelf(previousFrame.self) : null;
  return {
    protocol: projected.protocol,
    circle: projected.circle,
    sequence: projected.sequence,
    observedAt: projected.observedAt,
    eventWindow: projected.eventWindow,
    self: previousSelf ? projectHistoricalSelfDelta(self, previousSelf) : self,
    ...(previousSelf
      ? {
          selfReference: {
            source: previousSource,
            unchangedFieldsOmitted: true,
          },
        }
      : {}),
    events: projected.events,
    taskReference: {
      source: 'authoritative_entity_turn',
      omittedFromWorkingContext: true,
    },
    snapshotReference: {
      source: 'authoritative_entity_turn',
      omittedFromWorkingContext: [
        'task',
        'self.pose.orientation_and_velocity',
        'self.currentAction',
        'self.places',
        'self.placeConflicts',
        'scene',
      ],
    },
  };
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
    projects: self.projects,
  };
}

function projectSelf(self: any) {
  if (!self || typeof self !== 'object') return self;
  return {
    ...self,
    currentAction: projectCurrentAction(self.currentAction),
  };
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
