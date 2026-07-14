import path from 'node:path';
import type { EntityTurn } from '../src/entity/loom';
import type { WorldLifecycleEvent } from '../src/runtime/world-control';
import type { CognitionBrokerEvent } from '../src/mind/cognition-broker';
import {
  COGNITION_ADMISSION_PROTOCOL,
  cognitionResidentKey,
  type CognitionAdmissionEvidence,
  type CognitionPurpose,
} from '../src/mind/cognition';
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

export type PopulationResidentArtifacts<BodyWitness = unknown> = Readonly<{
  entityId: string;
  actEvents: readonly RunJournalEvent[];
  resumeEvents: readonly RunJournalEvent[];
  trajectory: readonly EntityTurn[];
  bodyWitness: BodyWitness;
  files: Readonly<{
    actJournal: Readonly<{ file: string; bytes: number }>;
    resumeJournal: Readonly<{ file: string; bytes: number }>;
    loom: Readonly<{ file: string; bytes: number }>;
  }>;
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

export type PopulationResidentEvidence = PopulationResidentArtifacts<PopulationBodyWitness> &
  Readonly<{
    model: string;
    task: string;
    targetItem: string;
  }>;

export type PopulationEvidenceInput = Readonly<{
  worldId: string;
  actRunId: string;
  resumeRunId: string;
  actLifecycle: readonly WorldLifecycleEvent[];
  resumeLifecycle: readonly WorldLifecycleEvent[];
  actCognition?: readonly CognitionBrokerEvent[];
  resumeCognition?: readonly CognitionBrokerEvent[];
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
  const actCallRecords = input.residents.flatMap((resident) =>
    attributedPopulationModelCalls(resident.entityId, resident.actEvents),
  );
  const resumeCallRecords = input.residents.flatMap((resident) =>
    attributedPopulationModelCalls(resident.entityId, resident.resumeEvents),
  );
  const actCalls = actCallRecords.map((record) => record.call);
  const resumeCalls = resumeCallRecords.map((record) => record.call);
  const allCalls = [...actCalls, ...resumeCalls];
  const usage = summarizeUsage(allCalls);
  const actCognition = cognitionMetrics(input.actCognition);
  const resumeCognition = cognitionMetrics(input.resumeCognition);
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
    input.actCognition,
  );
  const resumeLifecycle = assessPopulationLifecycle(
    input.resumeLifecycle,
    input.worldId,
    input.resumeRunId,
    residentIds,
    input.budgets,
    input.resumeCognition,
  );
  const cognitionRequired =
    lifecycleDeclaresCognition(input.actLifecycle) ||
    lifecycleDeclaresCognition(input.resumeLifecycle);
  const cognitionEvidencePresent = actCognition != null && resumeCognition != null;
  const maxConcurrentModelCalls = cognitionEvidencePresent
    ? Math.max(actCognition.peakActive, resumeCognition.peakActive)
    : measuredModelConcurrency(allCalls);
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
    cognitionEvidencePresentWhenConfigured: !cognitionRequired || cognitionEvidencePresent,
    cognitionJournalsCloseEveryRequest:
      !cognitionRequired || (actCognition?.valid === true && resumeCognition?.valid === true),
    cognitionAdmissionsReconcileWithResidentCalls:
      !cognitionRequired ||
      (reconcilesCognition(actCallRecords, input.actCognition, input.actRunId) &&
        reconcilesCognition(resumeCallRecords, input.resumeCognition, input.resumeRunId)),
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
      cognition: { act: actCognition, resume: resumeCognition },
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
  cognitionEvents?: readonly CognitionBrokerEvent[],
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
  const configuredCognition = configuredPopulation?.cognition;
  const cognitionReady = lifecycleData(events, 'cognition_broker_ready');
  const cognitionDrained = lifecycleData(events, 'cognition_broker_drained');
  const journalStarted = cognitionEvents?.find((event) => event.type === 'started');
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
      Number(configuredPopulation?.maxConcurrentModelCalls) === budgets.maxConcurrentModelCalls &&
      Number(configuredPopulation?.maxConcurrentModelCalls) <= residentIds.length,
    cognitionUsesDefaultResidentLauncher:
      configuredPopulation?.cognition == null ||
      configuredPopulation?.residentProcessLauncher === 'default_node_process',
    cognitionBoundaryMatchesJournal:
      cognitionEvents == null ||
      (configuredCognition?.brokerId === journalStarted?.brokerId &&
        Number(configuredPopulation?.maxConcurrentModelCalls) ===
          Number((journalStarted?.data as any)?.concurrencyLimit) &&
        cognitionReady.length === 1 &&
        cognitionReady[0]?.brokerId === journalStarted?.brokerId &&
        Number(cognitionReady[0]?.concurrencyLimit) === budgets.maxConcurrentModelCalls &&
        cognitionDrained.length === 1 &&
        cognitionDrained[0]?.brokerId === journalStarted?.brokerId),
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

type AttributedPopulationModelCall = Readonly<{
  entityId: string;
  purpose: CognitionPurpose;
  call: any;
}>;

function attributedPopulationModelCalls(
  entityId: string,
  events: readonly RunJournalEvent[],
): AttributedPopulationModelCall[] {
  return events
    .filter((event) => event.type === 'model_turn' || event.type === 'model_auxiliary_call')
    .map((event) => ({
      entityId,
      purpose:
        event.type === 'model_auxiliary_call'
          ? ('loom_fold' as const)
          : ('resident_decision' as const),
      call: event.data?.call,
    }))
    .filter((record) => record.call?.protocol === 'behold.model-call.v1');
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

function cognitionMetrics(events: readonly CognitionBrokerEvent[] | undefined) {
  if (!events) return null;
  const accepted = new Set<string>();
  const admitted = new Set<string>();
  const terminal = new Set<string>();
  let active = 0;
  let peakActive = 0;
  let draining = false;
  let startedCount = 0;
  let drainingCount = 0;
  let drainedCount = 0;
  let valid = events[0]?.type === 'started' && events.at(-1)?.type === 'drained';
  for (const event of events) {
    const id = event.request?.brokerRequestId;
    if (event.type === 'started') {
      startedCount += 1;
    } else if (event.type === 'draining') {
      drainingCount += 1;
      draining = true;
    } else if (event.type === 'drained') {
      drainedCount += 1;
      if (!draining) valid = false;
    } else if (event.type === 'accepted') {
      if (draining || !id || accepted.has(id)) valid = false;
      else accepted.add(id);
    } else if (event.type === 'admitted') {
      if (draining || !id || !accepted.has(id) || admitted.has(id)) valid = false;
      else {
        admitted.add(id);
        active += 1;
        peakActive = Math.max(peakActive, active);
      }
    } else if (event.type === 'completed') {
      if (!id || !admitted.has(id) || terminal.has(id)) valid = false;
      else {
        terminal.add(id);
        active -= 1;
        if (active < 0) valid = false;
      }
    } else if (event.type === 'cancelled') {
      if (!id || !accepted.has(id) || terminal.has(id)) valid = false;
      else {
        terminal.add(id);
        if (admitted.has(id)) active -= 1;
        if (active < 0) valid = false;
      }
    }
  }
  if (
    startedCount !== 1 ||
    drainingCount !== 1 ||
    drainedCount !== 1 ||
    active !== 0 ||
    terminal.size !== accepted.size
  )
    valid = false;
  return {
    valid,
    eventCount: events.length,
    accepted: accepted.size,
    admitted: admitted.size,
    terminal: terminal.size,
    peakActive,
  };
}

function reconcilesCognition(
  records: readonly AttributedPopulationModelCall[],
  events: readonly CognitionBrokerEvent[] | undefined,
  runId: string,
) {
  if (!events || records.length === 0) return false;
  const admitted = new Map(
    events
      .filter((event) => event.type === 'admitted' && event.request)
      .map((event) => [event.request!.brokerRequestId, event] as const),
  );
  const completed = new Map(
    events
      .filter((event) => event.type === 'completed' && event.request)
      .map((event) => [event.request!.brokerRequestId, event] as const),
  );
  const recorded = new Set<string>();
  for (const record of records) {
    const admissions = Array.isArray(record.call?.admissions)
      ? (record.call.admissions as CognitionAdmissionEvidence[])
      : [];
    if (admissions.length === 0) return false;
    for (const admission of admissions) {
      const id = String(admission?.brokerRequestId || '');
      const event = admitted.get(id);
      if (
        !id ||
        recorded.has(id) ||
        !event?.request ||
        !completed.has(id) ||
        admission.protocol !== COGNITION_ADMISSION_PROTOCOL ||
        admission.brokerId !== event.brokerId ||
        admission.clientRequestId !== record.call.requestId ||
        admission.clientRequestId !== event.request.clientRequestId ||
        admission.residentKey !== cognitionResidentKey(runId, record.entityId) ||
        admission.model !== record.call.request?.model ||
        admission.priority !== event.request.priority ||
        admission.purpose !== record.purpose ||
        admission.purpose !== event.request.purpose ||
        admission.urgentTriggerSequence !== event.request.urgentTriggerSequence ||
        admission.residentKey !== event.request.residentKey ||
        admission.model !== event.request.model ||
        admission.bodySha256 !== event.request.bodySha256 ||
        !sameAdmissionPayload(admission, event.data)
      ) {
        return false;
      }
      recorded.add(id);
    }
  }
  return completed.size === recorded.size && [...completed.keys()].every((id) => recorded.has(id));
}

function sameAdmissionPayload(admission: CognitionAdmissionEvidence, value: any) {
  return (
    value?.protocol === admission.protocol &&
    value?.brokerId === admission.brokerId &&
    value?.brokerRequestId === admission.brokerRequestId &&
    value?.clientRequestId === admission.clientRequestId &&
    value?.residentKey === admission.residentKey &&
    value?.model === admission.model &&
    value?.bodySha256 === admission.bodySha256 &&
    value?.priority === admission.priority &&
    value?.purpose === admission.purpose &&
    value?.urgentTriggerSequence === admission.urgentTriggerSequence &&
    value?.queuedAt === admission.queuedAt &&
    value?.admittedAt === admission.admittedAt &&
    value?.queueMs === admission.queueMs &&
    value?.queueDepthOnArrival === admission.queueDepthOnArrival &&
    value?.activeBeforeAdmission === admission.activeBeforeAdmission &&
    value?.concurrencyLimit === admission.concurrencyLimit &&
    value?.admissionOrdinal === admission.admissionOrdinal
  );
}

function lifecycleDeclaresCognition(events: readonly WorldLifecycleEvent[]) {
  return lifecycleData(events, 'run_configured')[0]?.population?.cognition != null;
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
