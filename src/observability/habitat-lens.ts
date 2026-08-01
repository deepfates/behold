export const HABITAT_LENS_PROTOCOL = 'behold.habitat-lens.v1' as const;

export type HabitatLifecycleEvent = Readonly<{
  sequence: number;
  at: string;
  type: string;
  data?: any;
}>;

export type HabitatLensPhase =
  'unknown' | 'starting' | 'running' | 'stopping' | 'stopped' | 'recovery_required';

export type HabitatLensState = Readonly<{
  protocol: typeof HABITAT_LENS_PROTOCOL;
  worldId: string | null;
  runId: string | null;
  phase: HabitatLensPhase;
  cursor: Readonly<{ lifecycleSequence: number; at: string | null }>;
  population: Readonly<{
    configured: readonly string[];
    ready: readonly string[];
    released: readonly string[];
    stopped: number | null;
  }>;
  server: Readonly<{
    pid: number | null;
    ready: boolean;
    saveAcknowledged: boolean;
    stopped: boolean;
  }>;
  cognition: Readonly<{
    state: 'unknown' | 'running' | 'paused' | 'transitioning' | 'failed';
    requested: 'running' | 'paused' | null;
    at: string | null;
    error: string | null;
  }>;
  terminal: Readonly<{
    reason: string | null;
    worldDigest: string | null;
    error: string | null;
  }>;
  unavailable: Readonly<{ lifecycle: string | null }>;
}>;

export function createHabitatLensState(): HabitatLensState {
  return freeze({
    protocol: HABITAT_LENS_PROTOCOL,
    worldId: null,
    runId: null,
    phase: 'unknown',
    cursor: { lifecycleSequence: 0, at: null },
    population: { configured: [], ready: [], released: [], stopped: null },
    server: { pid: null, ready: false, saveAcknowledged: false, stopped: false },
    cognition: { state: 'unknown', requested: null, at: null, error: null },
    terminal: { reason: null, worldDigest: null, error: null },
    unavailable: { lifecycle: null },
  });
}

export function applyHabitatLensEvent(
  prior: HabitatLensState,
  event: HabitatLifecycleEvent,
): HabitatLensState {
  if (!validEnvelope(event) || event.sequence <= prior.cursor.lifecycleSequence) return prior;
  const state: any = structuredClone(prior);
  state.unavailable.lifecycle =
    event.sequence === prior.cursor.lifecycleSequence + 1
      ? prior.unavailable.lifecycle
      : `lifecycle sequence gap after ${prior.cursor.lifecycleSequence}; next event was ${event.sequence}`;
  state.cursor = { lifecycleSequence: event.sequence, at: event.at };

  switch (event.type) {
    case 'control_acquired':
      state.worldId = text(event.data?.owner?.world);
      state.phase = phase(event.data?.owner?.state) ?? 'starting';
      break;
    case 'run_configured':
      state.runId = text(event.data?.runId);
      state.worldId = text(event.data?.world?.id) ?? state.worldId;
      state.population.configured = entityIds(event.data?.population?.residents);
      state.phase = 'starting';
      break;
    case 'server_ready':
      state.server.pid = positiveInteger(event.data?.pid);
      state.server.ready = true;
      state.server.stopped = false;
      break;
    case 'controller_ready':
      addUnique(state.population.ready, text(event.data?.entityId));
      break;
    case 'resident_release_observed':
      addUnique(state.population.released, text(event.data?.entityId));
      break;
    case 'run_ready':
      state.phase = 'running';
      state.cognition.state = 'running';
      state.server.pid = positiveInteger(event.data?.serverPid) ?? state.server.pid;
      break;
    case 'resident_cognition_control_requested':
      state.cognition.state = 'transitioning';
      state.cognition.requested = event.data?.state === 'paused' ? 'paused' : 'running';
      state.cognition.at = event.at;
      state.cognition.error = null;
      break;
    case 'resident_cognition_control_acknowledged':
      state.cognition.state = event.data?.state === 'paused' ? 'paused' : 'running';
      state.cognition.requested = null;
      state.cognition.at = event.at;
      state.cognition.error = null;
      break;
    case 'resident_cognition_control_failed':
      state.cognition.state = 'failed';
      state.cognition.requested = null;
      state.cognition.at = event.at;
      state.cognition.error = text(event.data?.error);
      break;
    case 'control_state_changed':
      state.phase = phase(event.data?.state) ?? state.phase;
      state.server.pid = positiveInteger(event.data?.server?.pid) ?? state.server.pid;
      break;
    case 'run_stopping':
      state.phase = 'stopping';
      state.terminal.reason = text(event.data?.reason);
      break;
    case 'residents_stopped':
      state.population.stopped = nonNegativeInteger(event.data?.residentCount);
      break;
    case 'server_save_acknowledged':
      state.server.saveAcknowledged = true;
      break;
    case 'server_stopped':
      state.server.stopped = true;
      break;
    case 'run_terminal_world_state':
      state.terminal.worldDigest =
        text(event.data?.tree?.digest) ??
        text(event.data?.runtimeDigest) ??
        text(event.data?.worldDigest) ??
        text(event.data?.digest);
      break;
    case 'run_stopped':
      state.phase = 'stopped';
      state.terminal.reason = text(event.data?.reason) ?? state.terminal.reason;
      break;
    case 'run_start_failed':
      state.terminal.error = text(event.data?.error);
      break;
  }
  return freeze(state);
}

export function foldHabitatLens(events: readonly HabitatLifecycleEvent[]): HabitatLensState {
  return events.reduce(applyHabitatLensEvent, createHabitatLensState());
}

function phase(value: unknown): HabitatLensPhase | null {
  return [
    'starting',
    'running',
    'stopping',
    'stopped',
    'stopped_verified',
    'recovery_required',
  ].includes(String(value))
    ? value === 'stopped_verified'
      ? 'stopped'
      : (value as HabitatLensPhase)
    : null;
}

function entityIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((resident) => {
    const id = text(resident?.entityId);
    return id ? [id] : [];
  });
}

function addUnique(values: string[], value: string | null) {
  if (value && !values.includes(value)) values.push(value);
}

function validEnvelope(value: any): value is HabitatLifecycleEvent {
  return (
    Number.isSafeInteger(value?.sequence) &&
    value.sequence > 0 &&
    typeof value.at === 'string' &&
    typeof value.type === 'string' &&
    value.type.length > 0
  );
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const item of Object.values(value as Record<string, unknown>)) freeze(item, seen);
  return Object.freeze(value);
}
