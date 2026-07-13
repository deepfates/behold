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
  if (!Array.isArray(frame.events)) {
    return { ...frame, ...(projectedSelf ? { self: projectedSelf } : {}) };
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

/**
 * Recent turns still need causal anchors, but not another full copy of the
 * current task. The authoritative turn retains it and the latest observation
 * supplies the task presently governing the controller.
 */
export function projectHistoricalModelObservation(frame: any) {
  const projected = projectCurrentModelObservation(frame);
  if (!projected || typeof projected !== 'object' || !('task' in projected)) return projected;
  const { task: _task, ...withoutRepeatedTask } = projected;
  return {
    ...withoutRepeatedTask,
    taskReference: {
      source: 'authoritative_entity_turn',
      omittedFromWorkingContext: true,
    },
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
