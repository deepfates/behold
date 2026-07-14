export const RESIDENT_RECOVERY_WITNESS_PROTOCOL = 'behold.resident-recovery-witness.v2' as const;
export const RESIDENT_RECOVERY_WITNESS_PHASE_PROTOCOL =
  'behold.resident-recovery-witness-phase.v2' as const;

const MOVEMENT_TOOLS = new Set([
  'move_to',
  'move_direction',
  'cross_visible_door',
  'cross_place_door',
  'ascend_step',
  'descend_step',
]);
const SHELTER_TOOLS = new Set(['place_against', 'place_block', 'dig_block', 'toggle_block']);

/**
 * Derive the causal recovery claim only from a validated resident run journal.
 * The source run must contain its own body evidence and resident-authored acts;
 * the later witness is deliberately handled by a separate managed epoch.
 */
export function summarizeResidentRecoverySource(events: any[], entityId: string, worldId: string) {
  const started = events.find((event) => event?.type === 'run_started');
  if (!started) throw new Error('source journal has no run_started event');
  if (started.agent !== entityId || started.data?.circle?.id !== worldId) {
    throw new Error('source journal entity or world does not match requested witness');
  }

  const samples = conditionSamples(events);
  if (!samples.length) throw new Error('source journal has no valid body telemetry');
  const livedEvents = uniqueLivedEvents(events);
  const urgency = livedEvents.find(
    (event) =>
      event.source === 'body' &&
      event.salience === 'urgent' &&
      ((event.type === 'condition_changed' && criticalCondition(event.data?.current)) ||
        event.type === 'self_hurt'),
  );
  const crisisSamples = urgency
    ? samples.filter((sample) => sample.journalSequence >= urgency.journalSequence)
    : [];
  const nadir = [...crisisSamples].sort(
    (left, right) =>
      conditionSeverity(left.condition) - conditionSeverity(right.condition) ||
      left.journalSequence - right.journalSequence ||
      left.phaseOrder - right.phaseOrder,
  )[0];
  const final = samples.at(-1)!;
  const recoveryActions = urgency ? residentRecoveryActions(events, urgency, nadir ?? null) : [];
  const deathEvents = livedEvents
    .filter((event) => event.source === 'body' && event.type === 'died')
    .map(projectLivedEvent);

  return {
    entityId,
    worldId,
    managedRunId: String(started.data?.runId || ''),
    loomFile: String(started.data?.entityLoom || ''),
    initial: projectConditionSample(samples[0]),
    urgency: urgency ? projectLivedEvent(urgency) : null,
    nadir: nadir ? projectConditionSample(nadir) : null,
    final: projectConditionSample(final),
    recoveryActions,
    deathEvents,
  };
}

export function assessResidentRecoveryWitness(report: any) {
  const source = report?.source ?? {};
  const witness = report?.witness ?? {};
  const initial = source.initial ?? {};
  const urgency = source.urgency ?? {};
  const nadir = source.nadir ?? {};
  const final = source.final ?? {};
  const nadirCondition = nadir.condition ?? {};
  const finalCondition = final.condition ?? {};
  const witnessedCondition = witness.condition ?? {};
  const inspection = witness.inspection ?? {};
  const positionDelta = distance(final.position, witness.position);
  const sourceHealthImproved = improved(nadirCondition.health, finalCondition.health);
  const sourceFoodImproved = improved(nadirCondition.food, finalCondition.food);
  const witnessedHealthPersisted = notWorse(finalCondition.health, witnessedCondition.health);
  const witnessedFoodPersisted = notWorse(finalCondition.food, witnessedCondition.food);
  const defensibleCover =
    inspection.ok === true &&
    inspection.source === 'loaded_local_terrain' &&
    inspection.sealed === true &&
    inspection.fullyCovered === true &&
    Number(inspection.protectedRegionCellCount) >= 1 &&
    Number(inspection.closableEntranceCount) >= 1;
  const recoveryActions = Array.isArray(source.recoveryActions) ? source.recoveryActions : [];
  const nourishmentAction = recoveryActions.some(
    (action: any) => action.kind === 'nourishment' && action.selectedFromCriticalBody === true,
  );
  const vitalityAction = recoveryActions.some(
    (action: any) =>
      ['nourishment', 'movement', 'sleep', 'defense'].includes(action.kind) &&
      action.selectedFromCriticalBody === true,
  );
  const spatialRecoveryAction = recoveryActions.some(
    (action: any) =>
      ['movement', 'shelter'].includes(action.kind) &&
      action.selectedFromCriticalBody === true &&
      actionNearFinal(action, final.position),
  );
  const vitalityRecovery =
    (sourceHealthImproved || sourceFoodImproved) &&
    (nourishmentAction || vitalityAction) &&
    (!sourceHealthImproved || witnessedHealthPersisted) &&
    (!sourceFoodImproved || witnessedFoodPersisted);
  const shelterRecovery = defensibleCover && spatialRecoveryAction;
  const recoveryActionCompletedAt = recoveryActions
    .map((action: any) => finiteOrNull(action.completedAt))
    .filter((value: number | null): value is number => value != null)
    .sort((left: number, right: number) => left - right)[0];
  const sourceChronology =
    positiveInteger(initial.journalSequence) &&
    positiveInteger(urgency.journalSequence) &&
    positiveInteger(nadir.journalSequence) &&
    positiveInteger(final.journalSequence) &&
    initial.journalSequence <= urgency.journalSequence &&
    urgency.journalSequence <= nadir.journalSequence &&
    recoveryActions.length > 0 &&
    recoveryActions.every(
      (action: any) =>
        positiveInteger(action.journalSequence) &&
        action.journalSequence >= nadir.journalSequence &&
        action.journalSequence <= final.journalSequence,
    );
  const finalHealth = finiteOrNull(finalCondition.health);
  const assertions = Object.freeze({
    protocol: report?.protocol === RESIDENT_RECOVERY_WITNESS_PROTOCOL,
    sourceIdentityBound:
      nonempty(source.entityId) &&
      nonempty(source.worldId) &&
      nonempty(source.managedRunId) &&
      source.entityId === witness.entityId &&
      source.worldId === witness.worldId,
    laterManagedEpoch:
      nonempty(witness.managedRunId) && witness.managedRunId !== source.managedRunId,
    bodyOriginUrgency:
      urgency.source === 'body' &&
      urgency.salience === 'urgent' &&
      ['condition_changed', 'self_hurt'].includes(String(urgency.type || '')),
    sourceBodyWasCritical: criticalCondition(nadirCondition),
    causalResidentRecoveryAction:
      recoveryActions.length > 0 &&
      recoveryActions.every(
        (action: any) =>
          action.source === 'llm' &&
          action.selectedFromCriticalBody === true &&
          nonempty(action.kind),
      ),
    sourceChronology,
    noDeathBeforeRestart:
      Array.isArray(source.deathEvents) &&
      source.deathEvents.length === 0 &&
      (finalHealth == null || finalHealth > 0),
    recoveryCompletedBeforeRestart: vitalityRecovery || shelterRecovery,
    freshMinecraftWitness:
      witness.protocol === RESIDENT_RECOVERY_WITNESS_PHASE_PROTOCOL &&
      witness.source === 'fresh_minecraft_connection' &&
      witness.authority === 'external_evaluator' &&
      witness.worldStateCertified === true,
    persistedBodyPosition: positionDelta != null && positionDelta <= 0.35,
    sourceJournalUnchanged:
      sha256(source.journalSha256Before) &&
      source.journalSha256Before === source.journalSha256After,
    inhabitantLoomUnchanged:
      sha256(source.loomSha256Before) && source.loomSha256Before === source.loomSha256After,
    witnessDidNotWriteResidentMemory:
      positiveInteger(witness.priorTurns) && witness.priorTurns === witness.resultingTurns,
    managedLifecycleVerified: report?.lifecycle?.verified === true,
    finalAuthorityReleased:
      report?.finalOwnership?.control === 'clear' &&
      report?.finalOwnership?.port === 'clear' &&
      report?.finalOwnership?.leases === 'clear',
    independentlyObservedPersistentRecovery: vitalityRecovery || shelterRecovery,
  });
  return Object.freeze({
    pass: Object.values(assertions).every(Boolean),
    assertions,
    measurements: Object.freeze({
      positionDelta,
      sourceHealthImproved,
      sourceFoodImproved,
      witnessedHealthPersisted,
      witnessedFoodPersisted,
      vitalityRecovery,
      shelterRecovery,
      defensibleCover,
      recoveryActionCompletedAt: recoveryActionCompletedAt ?? null,
      initialCondition: initial.condition ?? null,
      nadirCondition,
      finalCondition,
      witnessedCondition,
      shelter: Object.freeze({
        sealed: inspection.sealed ?? null,
        fullyCovered: inspection.fullyCovered ?? null,
        protectedRegionCellCount: finiteOrNull(inspection.protectedRegionCellCount),
        closableEntranceCount: finiteOrNull(inspection.closableEntranceCount),
        problems: Array.isArray(inspection.problems) ? inspection.problems : [],
      }),
    }),
  });
}

function conditionSamples(events: any[]) {
  const samples: any[] = [];
  for (const envelope of events) {
    const journalSequence = Number(envelope?.sequence);
    if (!positiveInteger(journalSequence)) continue;
    if (envelope.type === 'spawned' || envelope.type === 'observation') {
      pushConditionSample(samples, envelope.data?.self, envelope, 'observation', 0);
    } else if (envelope.type === 'model_turn') {
      pushConditionSample(samples, envelope.data?.observation?.self, envelope, 'model_decision', 1);
    } else if (envelope.type === 'entity_turn') {
      pushConditionSample(samples, envelope.data?.observation?.self, envelope, 'action_start', 2);
      pushConditionSample(samples, envelope.data?.nextObservation?.self, envelope, 'action_end', 3);
    }
  }
  return samples.sort(
    (left, right) =>
      left.journalSequence - right.journalSequence || left.phaseOrder - right.phaseOrder,
  );
}

function pushConditionSample(
  samples: any[],
  self: any,
  envelope: any,
  phase: string,
  phaseOrder: number,
) {
  const condition = normalizeCondition(self?.condition);
  if (!hasConditionTelemetry(condition)) return;
  samples.push({
    journalSequence: Number(envelope.sequence),
    observationSequence: finiteOrNull(
      phase === 'action_start'
        ? envelope.data?.observation?.sequence
        : phase === 'action_end'
          ? envelope.data?.nextObservation?.sequence
          : (envelope.data?.sequence ?? envelope.data?.observation?.sequence),
    ),
    atMs:
      finiteOrNull(
        phase === 'action_start'
          ? envelope.data?.startedAt
          : phase === 'action_end'
            ? envelope.data?.completedAt
            : envelope.data?.observedAt,
      ) ?? Date.parse(String(envelope.at || '')),
    phase,
    phaseOrder,
    condition,
    position: normalizePosition(self?.pose?.position),
  });
}

function uniqueLivedEvents(events: any[]) {
  const found = new Map<string, any>();
  for (const envelope of events) {
    const candidates =
      envelope?.type === 'spawned' || envelope?.type === 'observation'
        ? envelope.data?.events
        : envelope?.type === 'model_turn'
          ? envelope.data?.observation?.events
          : envelope?.type === 'entity_turn'
            ? [
                ...(envelope.data?.observation?.events ?? []),
                ...(envelope.data?.nextObservation?.events ?? []),
              ]
            : [];
    for (const event of Array.isArray(candidates) ? candidates : []) {
      const key = `${event?.sequence ?? 'none'}:${event?.at ?? 'none'}:${event?.type ?? 'none'}`;
      if (!found.has(key)) {
        found.set(key, { ...event, journalSequence: Number(envelope.sequence) });
      }
    }
  }
  return [...found.values()].sort(
    (left, right) =>
      left.journalSequence - right.journalSequence ||
      Number(left.sequence ?? 0) - Number(right.sequence ?? 0),
  );
}

function residentRecoveryActions(events: any[], urgency: any, nadir: any) {
  if (!nadir) return [];
  return events.flatMap((envelope) => {
    if (envelope?.type !== 'entity_turn') return [];
    const turn = envelope.data ?? {};
    if (Number(envelope.sequence) < Number(nadir.journalSequence)) return [];
    const action = turn.action ?? {};
    if (action.source !== 'llm') return [];
    const before = normalizeCondition(turn.observation?.self?.condition);
    const selectedFromCriticalBody =
      criticalCondition(before) ||
      turn.attention?.mode === 'urgent' ||
      turn.attention?.continuingCondition === 'critical_body_condition';
    if (!selectedFromCriticalBody) return [];
    const result = turn.outcome?.result ?? {};
    const kind = recoveryActionKind(action.name, turn.outcome, result);
    if (!kind) return [];
    return [
      {
        journalSequence: Number(envelope.sequence),
        turnSequence: Number(turn.sequence),
        completedAt: finiteOrNull(turn.completedAt),
        source: action.source,
        name: String(action.name || ''),
        kind,
        selectedFromCriticalBody,
        urgencyEventSequence: finiteOrNull(urgency.sequence),
        outcomeOk: turn.outcome?.ok === true,
        bodyMoved: movementDistance(result) > 0.2,
        bodyDisplacement: movementDistance(result),
        positionAfter: normalizePosition(
          result.final ?? turn.nextObservation?.self?.pose?.position,
        ),
        mutationPositions: mutationPositions(result),
        confirmation: result.confirmation ?? null,
        status: result.status ?? null,
      },
    ];
  });
}

function recoveryActionKind(name: unknown, outcome: any, result: any) {
  const tool = String(name || '');
  if (tool === 'consume' && outcome?.ok === true && result?.ok !== false) return 'nourishment';
  if (MOVEMENT_TOOLS.has(tool) && movementDistance(result) > 0.2) return 'movement';
  if (SHELTER_TOOLS.has(tool) && verifiedMutation(result)) return 'shelter';
  if (tool === 'sleep_in_bed' && outcome?.ok === true && result?.ok !== false) return 'sleep';
  if (
    tool === 'attack_entity' &&
    outcome?.ok === true &&
    result?.status === 'target_defeated' &&
    result?.confirmation === 'mineflayer:entityDead'
  ) {
    return 'defense';
  }
  return null;
}

function movementDistance(result: any) {
  const explicit = finiteOrNull(result?.bodyDisplacement);
  if (explicit != null) return explicit;
  const start = normalizePosition(result?.start);
  const final = normalizePosition(result?.final);
  return distance(start, final) ?? 0;
}

function verifiedMutation(result: any) {
  if (result?.verified === true && result?.observed === true) return true;
  return Array.isArray(result?.changes)
    ? result.changes.some((change: any) => change?.verified === true && change?.observed === true)
    : false;
}

function mutationPositions(result: any) {
  const candidates = [
    result?.block?.position,
    ...(Array.isArray(result?.changes)
      ? result.changes.map((change: any) => change?.position)
      : []),
  ];
  return candidates.map(normalizePosition).filter(Boolean);
}

function actionNearFinal(action: any, finalPosition: any) {
  const afterDelta = distance(action?.positionAfter, finalPosition);
  if (afterDelta != null && afterDelta <= 1.5) return true;
  return Array.isArray(action?.mutationPositions)
    ? action.mutationPositions.some((position: any) => {
        const delta = distance(position, finalPosition);
        return delta != null && delta <= 8;
      })
    : false;
}

function projectConditionSample(sample: any) {
  return {
    journalSequence: sample.journalSequence,
    observationSequence: sample.observationSequence,
    atMs: sample.atMs,
    phase: sample.phase,
    condition: sample.condition,
    position: sample.position,
  };
}

function projectLivedEvent(event: any) {
  return {
    journalSequence: Number(event.journalSequence),
    eventSequence: finiteOrNull(event.sequence),
    atMs: finiteOrNull(event.at),
    type: String(event.type || ''),
    salience: String(event.salience || ''),
    source: String(event.source || ''),
    condition: normalizeCondition(event.data?.current),
  };
}

function normalizeCondition(value: any) {
  return {
    health: finiteOrNull(value?.health),
    food: finiteOrNull(value?.food),
    oxygen: finiteOrNull(value?.oxygen),
    dimension: typeof value?.dimension === 'string' ? value.dimension : null,
    isDay: typeof value?.isDay === 'boolean' ? value.isDay : null,
  };
}

function normalizePosition(value: any) {
  if (!value) return null;
  const x = finiteOrNull(value.x);
  const y = finiteOrNull(value.y);
  const z = finiteOrNull(value.z);
  return x == null || y == null || z == null ? null : { x, y, z };
}

function hasConditionTelemetry(condition: any) {
  return [condition.health, condition.food, condition.oxygen].some(
    (value) => finiteOrNull(value) != null,
  );
}

function criticalCondition(condition: any) {
  return atMost(condition?.health, 4) || atMost(condition?.food, 2) || atMost(condition?.oxygen, 5);
}

function conditionSeverity(condition: any) {
  const values = [
    ratio(condition?.health, 4),
    ratio(condition?.food, 2),
    ratio(condition?.oxygen, 5),
  ].filter((value): value is number => value != null);
  return values.length ? Math.min(...values) : Number.POSITIVE_INFINITY;
}

function ratio(value: unknown, threshold: number) {
  const number = finiteOrNull(value);
  return number == null ? null : number / threshold;
}

function improved(before: unknown, after: unknown) {
  const left = finiteOrNull(before);
  const right = finiteOrNull(after);
  return left != null && right != null && right > left;
}

function notWorse(before: unknown, after: unknown) {
  const left = finiteOrNull(before);
  const right = finiteOrNull(after);
  return left != null && right != null && right >= left;
}

function atMost(value: unknown, threshold: number) {
  const number = finiteOrNull(value);
  return number != null && number <= threshold;
}

function distance(left: any, right: any) {
  if (!left || !right) return null;
  const values = [left.x, left.y, left.z, right.x, right.y, right.z].map(finiteOrNull);
  if (values.some((value) => value == null)) return null;
  return Math.hypot(values[3]! - values[0]!, values[4]! - values[1]!, values[5]! - values[2]!);
}

function finiteOrNull(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
}

function nonempty(value: unknown) {
  return typeof value === 'string' && value.length > 0;
}

function sha256(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
