export const FIXED_DECISION_PILOT_SCHEDULE_PROTOCOL =
  'behold.fixed-decision-pilot-schedule.v1' as const;
export const FIXED_DECISION_PILOT_SLOT_COUNT = 4;

export type FixedDecisionPilotSlot = Readonly<{
  slotId: string;
  order: number;
  offsetMs: number;
}>;

export type FixedDecisionPilotSchedule = Readonly<{
  protocol: typeof FIXED_DECISION_PILOT_SCHEDULE_PROTOCOL;
  slots: readonly FixedDecisionPilotSlot[];
}>;

export type FixedDecisionPilotScheduleEvent = Readonly<{
  protocol: 'behold.fixed-decision-pilot-schedule-event.v1';
  type: 'started' | 'slot_opened' | 'slot_terminal' | 'completed' | 'cancelled';
  at: number;
  releaseAt: number;
  slot?: FixedDecisionPilotSlot;
  scheduledAt?: number;
  latenessMs?: number;
  terminal?: unknown;
  completedSlots: number;
}>;

export function fixedDecisionPilotSchedule(value: unknown): FixedDecisionPilotSchedule {
  const record = exactRecord(value, ['protocol', 'slots'], 'fixed decision pilot schedule');
  if (record.protocol !== FIXED_DECISION_PILOT_SCHEDULE_PROTOCOL) {
    throw new Error(
      `unsupported fixed decision pilot schedule protocol: ${String(record.protocol)}`,
    );
  }
  if (!Array.isArray(record.slots) || record.slots.length !== FIXED_DECISION_PILOT_SLOT_COUNT) {
    throw new Error(
      `fixed decision pilot schedule requires exactly ${FIXED_DECISION_PILOT_SLOT_COUNT} slots`,
    );
  }
  const slots = record.slots.map((value, index) => {
    const slot = exactRecord(
      value,
      ['slotId', 'order', 'offsetMs'],
      `fixed decision slot ${index}`,
    );
    const slotId = String(slot.slotId || '');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(slotId)) {
      throw new Error(`fixed decision slot ${index} has an invalid slotId`);
    }
    if (!Number.isSafeInteger(slot.order) || Number(slot.order) < 1) {
      throw new Error(`fixed decision slot ${slotId} has an invalid order`);
    }
    if (
      !Number.isSafeInteger(slot.offsetMs) ||
      Number(slot.offsetMs) < 0 ||
      Number(slot.offsetMs) > 30 * 60_000
    ) {
      throw new Error(`fixed decision slot ${slotId} has an invalid offsetMs`);
    }
    return Object.freeze({
      slotId,
      order: Number(slot.order),
      offsetMs: Number(slot.offsetMs),
    });
  });
  if (new Set(slots.map((slot) => slot.slotId)).size !== slots.length) {
    throw new Error('fixed decision pilot slot IDs must be unique');
  }
  for (let index = 1; index < slots.length; index += 1) {
    if (slots[index].offsetMs <= slots[index - 1].offsetMs) {
      throw new Error('fixed decision pilot slot offsets must increase within one resident');
    }
    if (slots[index].order <= slots[index - 1].order) {
      throw new Error('fixed decision pilot slot orders must increase within one resident');
    }
  }
  return Object.freeze({
    protocol: FIXED_DECISION_PILOT_SCHEDULE_PROTOCOL,
    slots: Object.freeze(slots),
  });
}

export function serializeFixedDecisionPilotSchedule(schedule: FixedDecisionPilotSchedule) {
  return JSON.stringify(fixedDecisionPilotSchedule(schedule));
}

export function fixedDecisionPilotScheduleFromText(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error: any) {
    throw new Error(
      `fixed decision pilot schedule is not valid JSON: ${error?.message || String(error)}`,
    );
  }
  return fixedDecisionPilotSchedule(parsed);
}

export function assertFixedDecisionPilotPopulation(
  residents: readonly Readonly<{
    entityId: string;
    decisionSchedule?: FixedDecisionPilotSchedule;
  }>[],
) {
  const configured = residents.filter((resident) => resident.decisionSchedule != null);
  if (configured.length === 0) return;
  if (configured.length !== residents.length) {
    throw new Error('fixed decision pilot schedule must cover the exact resident population');
  }
  const slots = configured
    .flatMap((resident) =>
      resident.decisionSchedule!.slots.map((slot) => ({ entityId: resident.entityId, ...slot })),
    )
    .sort((left, right) => left.order - right.order);
  if (new Set(slots.map((slot) => slot.slotId)).size !== slots.length) {
    throw new Error('fixed decision pilot slot IDs must be unique across the population');
  }
  if (new Set(slots.map((slot) => slot.order)).size !== slots.length) {
    throw new Error('fixed decision pilot slot orders must be unique across the population');
  }
  for (let index = 0; index < slots.length; index += 1) {
    if (slots[index].order !== index + 1) {
      throw new Error('fixed decision pilot slot order must be one complete global sequence');
    }
    if (index > 0 && slots[index].offsetMs <= slots[index - 1].offsetMs) {
      throw new Error('fixed decision pilot slot times must be globally staggered in exact order');
    }
  }
}

export async function runFixedDecisionPilotSchedule(input: {
  schedule: FixedDecisionPilotSchedule;
  releasedAt: string | number;
  signal?: AbortSignal;
  now?: () => number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  openOpportunity: (slot: FixedDecisionPilotSlot, signal?: AbortSignal) => Promise<unknown>;
  onEvent?: (event: FixedDecisionPilotScheduleEvent) => void;
}) {
  const schedule = fixedDecisionPilotSchedule(input.schedule);
  const releaseAt =
    typeof input.releasedAt === 'number' ? input.releasedAt : Date.parse(input.releasedAt);
  if (!Number.isFinite(releaseAt)) throw new Error('fixed decision pilot release time is invalid');
  const now = input.now ?? Date.now;
  const wait = input.wait ?? abortableDelay;
  let completedSlots = 0;
  const emit = (
    type: FixedDecisionPilotScheduleEvent['type'],
    detail: Partial<FixedDecisionPilotScheduleEvent> = {},
  ) =>
    input.onEvent?.(
      Object.freeze({
        protocol: 'behold.fixed-decision-pilot-schedule-event.v1' as const,
        type,
        at: now(),
        releaseAt,
        completedSlots,
        ...detail,
      }),
    );

  emit('started');
  try {
    for (const slot of schedule.slots) {
      input.signal?.throwIfAborted();
      const scheduledAt = releaseAt + slot.offsetMs;
      await wait(Math.max(0, scheduledAt - now()), input.signal);
      input.signal?.throwIfAborted();
      const openedAt = now();
      emit('slot_opened', {
        slot,
        scheduledAt,
        latenessMs: Math.max(0, openedAt - scheduledAt),
      });
      const terminal = await input.openOpportunity(slot, input.signal);
      completedSlots += 1;
      emit('slot_terminal', { slot, scheduledAt, terminal });
    }
    emit('completed');
    return Object.freeze({ status: 'completed' as const, completedSlots });
  } catch (error) {
    if (input.signal?.aborted) {
      emit('cancelled');
      return Object.freeze({ status: 'cancelled' as const, completedSlots });
    }
    throw error;
  }
}

function exactRecord(value: unknown, fields: readonly string[], label: string) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((field) => !fields.includes(field));
  const missing = fields.filter((field) => !Object.prototype.hasOwnProperty.call(record, field));
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(
      `${label} fields mismatch${unknown.length ? `; unknown ${unknown.join(', ')}` : ''}${
        missing.length ? `; missing ${missing.join(', ')}` : ''
      }`,
    );
  }
  return record;
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('schedule aborted'));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, Math.max(0, milliseconds));
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new Error('schedule aborted'));
    };
    function finish() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
