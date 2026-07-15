import { createHash } from 'node:crypto';
import type { EntityLifeRangeReference, EntityTurn } from '../entity/loom';

export const MINECRAFT_INVENTORY_GAIN_PROTOCOL = 'behold.minecraft-inventory-gain.v1' as const;

export type MinecraftInventoryGainSpecification = Readonly<{
  protocol: typeof MINECRAFT_INVENTORY_GAIN_PROTOCOL;
  item: string;
  minimumGain: number;
  task: string;
  profiles: Readonly<{
    policy: 'neutral-benchmark-v1';
    actions: 'minecraft-player-v1';
    safety: 'vanilla-player-v1';
  }>;
  budgets: Readonly<{
    turns: number;
    providerCalls: number;
  }>;
}>;

export type MinecraftInventoryGainAssessment = Readonly<{
  protocol: 'behold.minecraft-inventory-gain-assessment.v1';
  status: 'passed' | 'failed';
  assertions: Readonly<Record<string, boolean>>;
  failed: readonly string[];
  binding: Readonly<{
    specificationSha256: string;
    worldId: string;
    entityId: string;
    body: Readonly<{ username: string; uuid: string }>;
    item: string;
    initialCount: number;
    terminalCount: number;
    persistedGain: number;
    turns: number;
    providerCalls: number;
    actions: readonly Readonly<{
      sequence: number;
      name: string | null;
      ok: boolean;
      terminalEvent: string;
    }>[];
    actRunId: string;
    restartRunId: string;
  }> | null;
}>;

/** One outcome-only task. It names no preferred Minecraft action or strategy. */
export function minecraftInventoryGainSpecification(input: {
  item: string;
  minimumGain?: number;
  turns?: number;
  providerCalls?: number;
}): MinecraftInventoryGainSpecification {
  const item = minecraftItem(input.item);
  const minimumGain = boundedInteger(input.minimumGain ?? 1, 1, 64, 'minimum gain');
  const turns = boundedInteger(input.turns ?? 6, 1, 32, 'turn budget');
  const providerCalls = boundedInteger(
    input.providerCalls ?? turns * 3,
    1,
    96,
    'provider-call budget',
  );
  return deepFreeze({
    protocol: MINECRAFT_INVENTORY_GAIN_PROTOCOL,
    item,
    minimumGain,
    task: `End this episode with at least ${minimumGain} more ${item} in your own inventory than you began with. Use only the ordinary Minecraft actions your current body can perceive and attempt. Choose how. Yield after the result is actually observable to you.`,
    profiles: {
      policy: 'neutral-benchmark-v1',
      actions: 'minecraft-player-v1',
      safety: 'vanilla-player-v1',
    },
    budgets: { turns, providerCalls },
  });
}

export function parseMinecraftInventoryGainSpecification(
  value: unknown,
): MinecraftInventoryGainSpecification {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Minecraft inventory-gain specification must be an object');
  }
  const candidate = value as any;
  const fields = ['protocol', 'item', 'minimumGain', 'task', 'profiles', 'budgets'];
  if (
    Object.keys(candidate).length !== fields.length ||
    fields.some((field) => !(field in candidate))
  ) {
    throw new Error('Minecraft inventory-gain specification fields differ from v1');
  }
  const expected = minecraftInventoryGainSpecification({
    item: candidate.item,
    minimumGain: candidate.minimumGain,
    turns: candidate.budgets?.turns,
    providerCalls: candidate.budgets?.providerCalls,
  });
  if (stableJson(candidate) !== stableJson(expected)) {
    throw new Error('Minecraft inventory-gain specification differs from its canonical form');
  }
  return expected;
}

export function minecraftInventoryGainSpecificationSha256(
  specification: MinecraftInventoryGainSpecification,
) {
  return sha256(stableJson(parseMinecraftInventoryGainSpecification(specification)));
}

/**
 * Score only body-owned evidence: the exact starting observation, recorded
 * resident turns, and a paused fresh-process observation of the same saved body.
 */
export function assessMinecraftInventoryGain(input: {
  specification: MinecraftInventoryGainSpecification;
  expected: Readonly<{
    worldId: string;
    entityId: string;
    bodyUsername: string;
    model: string;
    mind: 'direct' | 'ax';
    actRunId: string;
    restartRunId: string;
  }>;
  actEvents: readonly any[];
  restartEvents: readonly any[];
  life: EntityLifeRangeReference;
  lifeTurns: readonly EntityTurn[];
  episodeDefinition: unknown;
}): MinecraftInventoryGainAssessment {
  const specification = parseMinecraftInventoryGainSpecification(input.specification);
  const specificationSha256 = minecraftInventoryGainSpecificationSha256(specification);
  const actStarted = oneEvent(input.actEvents, 'run_started');
  const restartStarted = oneEvent(input.restartEvents, 'run_started');
  const initialModelTurn = input.actEvents.find((event) => event?.type === 'model_turn');
  const restartReady = oneEvent(input.restartEvents, 'local_world_ready');
  const entityEvents = input.actEvents.filter((event) => event?.type === 'entity_turn');
  const entityTurns = entityEvents.map((event) => event?.data);
  const initialSelf = initialModelTurn?.data?.observation?.self;
  const terminalSelf = restartReady?.data?.self;
  const initialCount = inventoryCount(initialSelf?.inventory, specification.item);
  const terminalCount = inventoryCount(terminalSelf?.inventory, specification.item);
  const persistedGain = terminalCount - initialCount;
  const actObservedCount = Math.max(
    initialCount,
    ...entityTurns.map((turn) =>
      inventoryCount(turn?.nextObservation?.self?.inventory, specification.item),
    ),
    ...input.actEvents
      .filter((event) => event?.type === 'model_turn')
      .map((event) =>
        inventoryCount(event?.data?.observation?.self?.inventory, specification.item),
      ),
  );
  const initialBody = bodyIdentity(initialSelf?.body);
  const terminalBody = bodyIdentity(terminalSelf?.body);
  const bodyGainEvents = [
    ...entityTurns.flatMap((turn) => turn?.nextObservation?.events ?? []),
    ...input.actEvents
      .filter((event) => event?.type === 'model_turn' && event !== initialModelTurn)
      .flatMap((event) => event?.data?.observation?.events ?? []),
  ].filter(
    (event) =>
      event?.type === 'inventory_changed' &&
      event?.isNew !== false &&
      inventoryCount(event?.data?.added, specification.item) > 0,
  );
  const actions = entityTurns.map((turn) => ({
    sequence: Number(turn?.sequence),
    name: typeof turn?.action?.name === 'string' ? turn.action.name : null,
    ok: turn?.outcome?.ok === true,
    terminalEvent: String(turn?.outcome?.eventType || ''),
  }));
  const modelEvents = input.actEvents.filter(
    (event) => event?.type === 'model_turn' || event?.type === 'model_call_failed',
  );
  const providerCalls = modelEvents.reduce(
    (sum, event) =>
      sum + (Array.isArray(event?.data?.call?.admissions) ? event.data.call.admissions.length : 0),
    0,
  );
  const assertions = {
    actConfiguration:
      actStarted?.data?.runId === input.expected.actRunId &&
      actStarted?.data?.circle?.id === input.expected.worldId &&
      actStarted?.data?.model === input.expected.model &&
      actStarted?.data?.controller?.mindAdapter === input.expected.mind &&
      actStarted?.data?.controller?.policyProfile === specification.profiles.policy &&
      actStarted?.data?.controller?.actionProfile === specification.profiles.actions &&
      actStarted?.data?.controller?.safetyProfile === specification.profiles.safety &&
      actStarted?.data?.controller?.maxTurnSteps === specification.budgets.turns &&
      actStarted?.data?.controller?.resumeAfterBudget === false &&
      actStarted?.data?.controller?.allowTools == null &&
      actStarted?.data?.task === specification.task &&
      actStarted?.data?.priorEntityTurns === 0,
    restartConfiguration:
      restartStarted?.data?.runId === input.expected.restartRunId &&
      restartStarted?.data?.circle?.id === input.expected.worldId &&
      restartStarted?.data?.model === input.expected.model &&
      restartStarted?.data?.controller?.mindAdapter === input.expected.mind &&
      restartStarted?.data?.controller?.policyProfile === specification.profiles.policy &&
      restartStarted?.data?.controller?.actionProfile === specification.profiles.actions &&
      restartStarted?.data?.controller?.safetyProfile === specification.profiles.safety &&
      restartStarted?.data?.controller?.paused === true &&
      restartStarted?.data?.priorEntityTurns === entityTurns.length,
    exactBody:
      initialBody != null &&
      terminalBody != null &&
      initialBody.username === input.expected.bodyUsername &&
      terminalBody.username === input.expected.bodyUsername &&
      initialBody.uuid === terminalBody.uuid &&
      initialSelf?.identity === input.expected.entityId &&
      terminalSelf?.identity === input.expected.entityId,
    boundedTrajectory:
      entityTurns.length > 0 &&
      entityTurns.length <= specification.budgets.turns &&
      entityTurns.every(
        (turn, index) =>
          Number(turn?.sequence) === index + 1 &&
          typeof turn?.outcome?.eventType === 'string' &&
          typeof turn?.outcome?.ok === 'boolean',
      ),
    providerBudget:
      providerCalls > 0 &&
      providerCalls <= specification.budgets.providerCalls &&
      modelEvents.every((event) => Array.isArray(event?.data?.call?.admissions)),
    exactLife:
      input.life.entityId === input.expected.entityId &&
      input.life.circleId === input.expected.worldId &&
      input.life.sequences.start === 1 &&
      input.life.sequences.end === entityTurns.length &&
      stableJson(input.lifeTurns) === stableJson(entityTurns),
    exactEpisode: episodeMatches(input.episodeDefinition, input.life, specificationSha256),
    noModelFailure: !input.actEvents.some((event) => event?.type === 'model_call_failed'),
    gainObservedBeforeStop: actObservedCount >= initialCount + specification.minimumGain,
    bodyReportedGain: bodyGainEvents.length > 0,
    gainPersisted: persistedGain >= specification.minimumGain,
  };
  const failed = Object.entries(assertions)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return deepFreeze({
    protocol: 'behold.minecraft-inventory-gain-assessment.v1' as const,
    status: failed.length === 0 ? ('passed' as const) : ('failed' as const),
    assertions,
    failed,
    binding:
      initialBody == null || terminalBody == null
        ? null
        : {
            specificationSha256,
            worldId: input.expected.worldId,
            entityId: input.expected.entityId,
            body: initialBody,
            item: specification.item,
            initialCount,
            terminalCount,
            persistedGain,
            turns: entityTurns.length,
            providerCalls,
            actions,
            actRunId: input.expected.actRunId,
            restartRunId: input.expected.restartRunId,
          },
  });
}

export function inventoryCount(value: unknown, item: string) {
  if (!Array.isArray(value)) return 0;
  return value.reduce(
    (sum, stack: any) =>
      stack?.name === item && Number.isFinite(Number(stack?.count))
        ? sum + Math.max(0, Number(stack.count))
        : sum,
    0,
  );
}

function episodeMatches(value: any, life: EntityLifeRangeReference, specificationSha256: string) {
  return (
    value?.protocol === 'behold.evaluation-episode.v1' &&
    value?.suite?.id === 'minecraft-inventory-gain' &&
    value?.suite?.version === '1' &&
    value?.suite?.caseId === 'persisted-inventory-gain' &&
    value?.suite?.specificationSha256 === specificationSha256 &&
    stableJson(value?.life) === stableJson(life)
  );
}

function bodyIdentity(value: any): { username: string; uuid: string } | null {
  return typeof value?.username === 'string' && typeof value?.uuid === 'string'
    ? { username: value.username, uuid: value.uuid }
    : null;
}

function oneEvent(events: readonly any[], type: string) {
  const matching = events.filter((event) => event?.type === type);
  return matching.length === 1 ? matching[0] : null;
}

function minecraftItem(value: unknown) {
  const item = String(value || '').trim();
  if (!/^[a-z0-9_:-]{1,128}$/.test(item)) throw new Error('Minecraft item is invalid');
  return item;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return number;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
