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
    eventWindow: projectHistoricalEventWindow(projected.eventWindow),
    self: previousSelf ? projectHistoricalSelfDelta(self, previousSelf) : self,
    events: projected.events,
    historicalProjection: {
      source: 'authoritative_entity_turn',
      mode: 'causal_delta',
      previous: previousSelf ? previousSource : null,
    },
  };
}

function projectHistoricalEventWindow(window: any) {
  if (!window || typeof window !== 'object') return window;
  return {
    complete: window.complete !== false,
    missingBeforeOldest: Math.max(0, Number(window.missingBeforeOldest) || 0),
    omittedNewEvents: Math.max(0, Number(window.omittedNewEvents) || 0),
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
    ...(self.pose ? { pose: projectCurrentPose(self.pose) } : {}),
    currentAction: projectCurrentAction(self.currentAction),
  };
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
