import path from 'node:path';
import type { EntityTurn } from '../src/entity/loom';
import type { WorldLifecycleEvent } from '../src/runtime/world-control';
import {
  assessOwnedWorldModelEvidence,
  eventData,
  summarizeUsage,
  type IndependentWorldWitness,
  type RunJournalEvent,
} from './owned-world-model-evidence';

export const POPULATION_PROOF_PROTOCOL = 'behold.owned-world-population-proof.v1' as const;

export type PopulationProofBudgets = Readonly<{
  maxResidents: number;
  maxConcurrentModelCalls: number;
  maxTotalModelCalls: number;
  maxTotalTokens: number;
  maxSingleCallLatencyMs: number;
  maxTotalModelCostUsd: number;
  maxJournalBytesPerResident: number;
  maxLoomBytesPerResident: number;
  maxProofWallMs: number;
}>;

export type PopulationBodyWitness = Readonly<{
  entityId: string;
  worldId: string;
  managedRunId: string;
  source: 'fresh_minecraft_connection';
  observedAt: number;
  inventory: readonly Readonly<{ name: string; count: number }>[];
  droppedItems: readonly Readonly<{ name: string; count: number }>[];
}>;

export type PopulationResidentEvidence = Readonly<{
  entityId: string;
  model: string;
  task: string;
  targetItem: string;
  actEvents: readonly RunJournalEvent[];
  resumeEvents: readonly RunJournalEvent[];
  trajectory: readonly EntityTurn[];
  bodyWitness: PopulationBodyWitness;
  files: Readonly<{
    actJournal: Readonly<{ file: string; bytes: number }>;
    resumeJournal: Readonly<{ file: string; bytes: number }>;
    loom: Readonly<{ file: string; bytes: number }>;
  }>;
}>;

export type PopulationEvidenceInput = Readonly<{
  worldId: string;
  actRunId: string;
  resumeRunId: string;
  actLifecycle: readonly WorldLifecycleEvent[];
  resumeLifecycle: readonly WorldLifecycleEvent[];
  independentWitness: IndependentWorldWitness;
  residents: readonly PopulationResidentEvidence[];
  budgets: PopulationProofBudgets;
  proofWallMs: number;
}>;

export function assessOwnedWorldPopulationEvidence(input: PopulationEvidenceInput) {
  const residentIds = input.residents.map((resident) => resident.entityId);
  const targetItems = input.residents.map((resident) => resident.targetItem);
  const perResident = input.residents.map((resident) => {
    const individual = assessOwnedWorldModelEvidence(
      resident.actEvents,
      resident.resumeEvents,
      input.independentWitness,
      {
        worldId: input.worldId,
        entityId: resident.entityId,
        model: resident.model,
        task: resident.task,
        targetItem: resident.targetItem,
        actRunId: input.actRunId,
        resumeRunId: input.resumeRunId,
      },
    );
    const calls = populationModelCalls([...resident.actEvents, ...resident.resumeEvents]);
    const usage = summarizeUsage(calls);
    return {
      entityId: resident.entityId,
      targetItem: resident.targetItem,
      individual,
      metrics: {
        usage,
        journalBytes: resident.files.actJournal.bytes + resident.files.resumeJournal.bytes,
        loomBytes: resident.files.loom.bytes,
        actTurns: eventData(resident.actEvents, 'entity_turn').length,
        resumeTurns: eventData(resident.resumeEvents, 'entity_turn').length,
      },
    };
  });
  const allCalls = input.residents.flatMap((resident) =>
    populationModelCalls([...resident.actEvents, ...resident.resumeEvents]),
  );
  const usage = summarizeUsage(allCalls);
  const maxConcurrentModelCalls = measuredModelConcurrency(allCalls);
  const maxResidentJournalBytes = Math.max(
    0,
    ...input.residents.map(
      (resident) => resident.files.actJournal.bytes + resident.files.resumeJournal.bytes,
    ),
  );
  const maxResidentLoomBytes = Math.max(
    0,
    ...input.residents.map((resident) => resident.files.loom.bytes),
  );
  const actLifecycle = assessPopulationLifecycle(
    input.actLifecycle,
    input.worldId,
    input.actRunId,
    residentIds,
    input.budgets,
  );
  const resumeLifecycle = assessPopulationLifecycle(
    input.resumeLifecycle,
    input.worldId,
    input.resumeRunId,
    residentIds,
    input.budgets,
  );
  const allTurnIds = new Map(
    input.residents.map((resident) => [
      resident.entityId,
      resident.trajectory.map((turn) => turn.id).filter(Boolean),
    ]),
  );

  const assertions = {
    exactlyTwoDistinctResidents:
      input.residents.length === 2 &&
      new Set(residentIds.map(canonicalIdentity)).size === input.residents.length,
    distinctTargetConsequences:
      targetItems.every(Boolean) &&
      new Set(targetItems.map(canonicalIdentity)).size === targetItems.length,
    sharedActEpoch:
      input.actRunId !== input.resumeRunId &&
      input.residents.every(
        (resident) => eventData(resident.actEvents, 'run_started')[0]?.runId === input.actRunId,
      ),
    sharedResumeEpoch: input.residents.every(
      (resident) => eventData(resident.resumeEvents, 'run_started')[0]?.runId === input.resumeRunId,
    ),
    everyResidentPassedCausalProof: perResident.every(
      (resident) => resident.individual.failed.length === 0,
    ),
    journalsStayResidentScoped: input.residents.every((resident) =>
      [...resident.actEvents, ...resident.resumeEvents].every(
        (event) => event.agent === resident.entityId,
      ),
    ),
    trajectoriesStayResidentScoped: input.residents.every((resident) =>
      resident.trajectory.every(
        (turn) =>
          turn.entityId === resident.entityId &&
          turn.observation?.self?.identity === resident.entityId &&
          turn.nextObservation?.self?.identity === resident.entityId,
      ),
    ),
    noForeignTurnIdsReachModelContext: input.residents.every((resident) => {
      const foreignIds = [...allTurnIds.entries()]
        .filter(([entityId]) => entityId !== resident.entityId)
        .flatMap(([, ids]) => ids);
      return populationModelCalls([...resident.actEvents, ...resident.resumeEvents]).every(
        (call) => {
          const request = JSON.stringify(call?.request?.body ?? null);
          return foreignIds.every((turnId) => !request.includes(turnId));
        },
      );
    }),
    evidenceFilesAreDistinct: distinctCanonicalPaths(
      input.residents.flatMap((resident) => [
        resident.files.actJournal.file,
        resident.files.resumeJournal.file,
        resident.files.loom.file,
      ]),
    ),
    freshBodiesRetainOnlyOwnTarget: input.residents.every((resident) => {
      const witness = resident.bodyWitness;
      const own = populationInventoryCount(witness.inventory, resident.targetItem);
      const foreign = input.residents
        .filter((other) => other.entityId !== resident.entityId)
        .reduce(
          (count, other) => count + populationInventoryCount(witness.inventory, other.targetItem),
          0,
        );
      return (
        witness.source === 'fresh_minecraft_connection' &&
        witness.entityId === resident.entityId &&
        witness.worldId === input.worldId &&
        witness.managedRunId === input.actRunId &&
        own === 1 &&
        foreign === 0
      );
    }),
    actLifecycleProvesPopulation: actLifecycle.failed.length === 0,
    resumeLifecycleProvesPopulation: resumeLifecycle.failed.length === 0,
    usageAndCostRecorded:
      usage.callCount > 0 &&
      usage.totalTokens > 0 &&
      usage.callsWithCost === usage.callCount &&
      usage.totalCost !== null,
    residentProcessBudgetHeld: input.residents.length <= input.budgets.maxResidents,
    modelConcurrencyBudgetHeld: maxConcurrentModelCalls <= input.budgets.maxConcurrentModelCalls,
    modelCallBudgetHeld: usage.callCount <= input.budgets.maxTotalModelCalls,
    tokenBudgetHeld: usage.totalTokens <= input.budgets.maxTotalTokens,
    latencyBudgetHeld: usage.maxLatencyMs <= input.budgets.maxSingleCallLatencyMs,
    costBudgetHeld:
      usage.totalCost !== null && usage.totalCost <= input.budgets.maxTotalModelCostUsd,
    journalStorageBudgetHeld:
      maxResidentJournalBytes > 0 &&
      maxResidentJournalBytes <= input.budgets.maxJournalBytesPerResident,
    loomStorageBudgetHeld:
      maxResidentLoomBytes > 0 && maxResidentLoomBytes <= input.budgets.maxLoomBytesPerResident,
    wallTimeBudgetHeld: input.proofWallMs > 0 && input.proofWallMs <= input.budgets.maxProofWallMs,
  };
  const failed = Object.entries(assertions)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return {
    assertions,
    failed,
    residents: perResident,
    lifecycle: { act: actLifecycle, resume: resumeLifecycle },
    metrics: {
      usage,
      maxConcurrentModelCalls,
      maxResidentJournalBytes,
      maxResidentLoomBytes,
      proofWallMs: input.proofWallMs,
      callsPerSecond: input.proofWallMs > 0 ? usage.callCount / (input.proofWallMs / 1000) : null,
    },
    budgets: input.budgets,
  };
}

export function assessPopulationLifecycle(
  events: readonly WorldLifecycleEvent[],
  worldId: string,
  runId: string,
  residentIds: readonly string[],
  budgets: PopulationProofBudgets,
) {
  const configured = lifecycleData(events, 'run_configured')[0];
  const configuredPopulation = configured?.population;
  const configuredIds = Array.isArray(configuredPopulation?.residents)
    ? configuredPopulation.residents.map((resident: any) => String(resident?.entityId || ''))
    : [];
  const started = lifecycleData(events, 'controller_started').map((event) =>
    String(event?.entityId || ''),
  );
  const ready = lifecycleData(events, 'controller_ready').map((event) =>
    String(event?.entityId || ''),
  );
  const runReady = lifecycleData(events, 'run_ready')[0];
  const runReadyIds = Array.isArray(runReady?.residents)
    ? runReady.residents.map((resident: any) => String(resident?.entityId || ''))
    : [];
  const assertions = {
    journalEnvelopeMatchesEpoch:
      events.length > 0 &&
      events.every(
        (event) =>
          event.world === worldId && Number.isSafeInteger(event.epoch) && event.sequence > 0,
      ),
    configuredExactPopulation: configured?.runId === runId && sameSet(configuredIds, residentIds),
    configuredBudgets:
      Number(configuredPopulation?.residentCount) === residentIds.length &&
      Number(configuredPopulation?.maxResidentProcesses) === budgets.maxResidents &&
      Number(configuredPopulation?.maxConcurrentModelCalls) === residentIds.length &&
      residentIds.length <= budgets.maxConcurrentModelCalls,
    everyControllerStartedOnce:
      sameSet(started, residentIds) && started.length === residentIds.length,
    everyControllerReadyOnce: sameSet(ready, residentIds) && ready.length === residentIds.length,
    runReadyIsConjunctive:
      sameSet(runReadyIds, residentIds) && runReadyIds.length === residentIds.length,
    residentsQuiesced: lifecycleData(events, 'residents_quiesced').length === 1,
    worldSavedAndStopped:
      lifecycleData(events, 'server_save_acknowledged').length === 1 &&
      lifecycleData(events, 'run_stopped').length === 1 &&
      lifecycleData(events, 'control_released').length === 1 &&
      events.at(-1)?.type === 'control_released',
  };
  return {
    assertions,
    failed: Object.entries(assertions)
      .filter(([, value]) => !value)
      .map(([name]) => name),
    startup: startupMetrics(events, residentIds),
  };
}

function startupMetrics(events: readonly WorldLifecycleEvent[], residentIds: readonly string[]) {
  return residentIds.map((entityId) => {
    const started = events.find(
      (event) => event.type === 'controller_started' && (event.data as any)?.entityId === entityId,
    );
    const ready = events.find(
      (event) => event.type === 'controller_ready' && (event.data as any)?.entityId === entityId,
    );
    const startedAt = started ? Date.parse(started.at) : NaN;
    const readyAt = ready ? Date.parse(ready.at) : NaN;
    return {
      entityId,
      startedAt: started?.at ?? null,
      readyAt: ready?.at ?? null,
      readinessLatencyMs:
        Number.isFinite(startedAt) && Number.isFinite(readyAt)
          ? Math.max(0, readyAt - startedAt)
          : null,
    };
  });
}

export function populationModelCalls(events: readonly RunJournalEvent[]) {
  return events
    .filter((event) => event.type === 'model_turn' || event.type === 'model_auxiliary_call')
    .map((event) => event.data?.call)
    .filter((call) => call?.protocol === 'behold.model-call.v1');
}

export function measuredModelConcurrency(calls: readonly any[]) {
  const edges = calls.flatMap((call, index) => {
    const startedAt = Number(call?.startedAt);
    const completedAt = Number(call?.completedAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
      return [];
    }
    return [
      { at: startedAt, delta: 1, index },
      { at: completedAt, delta: -1, index },
    ];
  });
  edges.sort(
    (left, right) => left.at - right.at || left.delta - right.delta || left.index - right.index,
  );
  let active = 0;
  let maximum = 0;
  for (const edge of edges) {
    active += edge.delta;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

function lifecycleData(events: readonly WorldLifecycleEvent[], type: string): any[] {
  return events.filter((event) => event.type === type).map((event) => event.data);
}

export function populationInventoryCount(
  inventory: readonly Readonly<{ name: string; count: number }>[],
  name: string,
) {
  return inventory
    .filter((item) => item.name === name)
    .reduce((count, item) => count + Math.max(0, Number(item.count) || 0), 0);
}

function sameSet(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    new Set(left.map(canonicalIdentity)).size === left.length &&
    left.every((value) =>
      right.some((candidate) => canonicalIdentity(candidate) === canonicalIdentity(value)),
    )
  );
}

export function distinctCanonicalPaths(files: readonly string[]) {
  return (
    files.every((file) => path.isAbsolute(file)) &&
    new Set(files.map((file) => canonicalIdentity(path.normalize(file)))).size === files.length
  );
}

export function canonicalIdentity(value: string) {
  return String(value).normalize('NFKC').toLocaleLowerCase('en-US');
}
