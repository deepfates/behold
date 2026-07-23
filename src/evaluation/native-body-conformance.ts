export const NATIVE_BODY_CONFORMANCE_PROTOCOL = 'behold.native-body-conformance.v2' as const;
export const NATIVE_BODY_PHASE_PROTOCOL = 'behold.native-body-conformance-phase.v1' as const;

export function assessNativeBodyConformance(report: any) {
  const phase = report?.phase;
  const turn = phase?.turn;
  const result = turn?.result;
  const durableTurn = turn?.turn;
  const events = Array.isArray(turn?.events) ? turn.events : [];
  const actionId = durableTurn?.action?.id;
  const event = (type: string) =>
    events
      .map((candidate: any, index: number) => ({ candidate, index }))
      .filter(
        ({ candidate }: any) =>
          candidate?.type === type && candidate?.data?.intent?.id === actionId,
      );
  const permissionEvents = event('permission_decision');
  const startedEvents = event('action_started');
  const completedEvents = event('action_completed');
  const permission = permissionEvents[0];
  const started = startedEvents[0];
  const completed = completedEvents[0];
  const target = phase?.target;
  const start = phase?.bodyBefore;
  const navigation = result?.navigation;
  const change =
    Array.isArray(result?.changes) && result.changes.length === 1 ? result.changes[0] : null;
  const witnessBlock = Array.isArray(report?.independentWitness?.blocks)
    ? report.independentWitness.blocks.find((candidate: any) =>
        samePosition(candidate?.position, target),
      )
    : null;
  const horizontal =
    start && navigation?.final
      ? Math.hypot(
          Number(navigation.final.x) - Number(start.x),
          Number(navigation.final.z) - Number(start.z),
        )
      : Infinity;
  const vertical =
    start && navigation?.final ? Math.abs(Number(navigation.final.y) - Number(start.y)) : Infinity;
  const initialDirt = inventoryCount(phase?.initialObservation, 'dirt');
  const finalDirt = inventoryCount(phase?.finalObservation, 'dirt');
  const actorDimension = String(durableTurn?.observation?.self?.condition?.dimension || '');
  const actorAfterDimension = String(
    durableTurn?.nextObservation?.self?.condition?.dimension || '',
  );
  const witnessDimension = String(report?.independentWitness?.dimension || '');
  const quiescenceAt = Date.parse(String(report?.lifecycle?.quiescence?.at || ''));
  const permissionIntent = permission?.candidate?.data?.intent;

  const assertions = {
    protocol:
      report?.protocol === NATIVE_BODY_CONFORMANCE_PROTOCOL &&
      phase?.protocol === NATIVE_BODY_PHASE_PROTOCOL,
    sourceIdentity:
      typeof report?.repositoryRevision === 'string' &&
      report.repositoryRevision.length === 40 &&
      phase?.repositoryRevision === report.repositoryRevision,
    managedIdentity:
      typeof report?.worldId === 'string' &&
      report.worldId === phase?.worldId &&
      report?.managedRunId === phase?.managedRunId &&
      phase?.initialObservation?.circle?.id === report.worldId &&
      phase?.initialObservation?.circle?.managedRunId === report.managedRunId,
    bodyInitiallyOccupiesTarget:
      finitePosition(start) &&
      finitePosition(target) &&
      Math.floor(start.x) === target.x &&
      Math.floor(start.y) === target.y &&
      Math.floor(start.z) === target.z,
    fixtureSetupDeclared:
      phase?.fixtureSetup?.kind === 'pathfinder_preposition_before_recorded_action' &&
      finitePosition(phase?.fixtureSetup?.destination) &&
      Math.floor(phase.fixtureSetup.destination.x) === target?.x &&
      Math.floor(phase.fixtureSetup.destination.y) === target?.y &&
      Math.floor(phase.fixtureSetup.destination.z) === target?.z,
    sameAdmittedPlayerAction:
      turn?.action?.name === 'place_block' &&
      turn?.action?.source === 'script' &&
      samePosition(turn?.action?.input, target) &&
      turn?.action?.input?.name === 'dirt' &&
      phase?.model === 'script/native-body-conformance-v1',
    authenticActionLifecycle:
      permissionEvents.length === 1 &&
      startedEvents.length === 1 &&
      completedEvents.length === 1 &&
      permission.index < started.index &&
      started.index < completed.index &&
      Number.isFinite(permission.candidate?.at) &&
      Number.isFinite(started.candidate?.at) &&
      Number.isFinite(completed.candidate?.at) &&
      permission.candidate.at <= started.candidate.at &&
      started.candidate.at <= completed.candidate.at &&
      permission.candidate?.data?.authorization?.ok === true &&
      stableJson(permission.candidate?.data?.authorization) ===
        stableJson(started.candidate?.data?.authorization) &&
      stableJson(permission.candidate?.data?.authorization) ===
        stableJson(completed.candidate?.data?.authorization) &&
      stableJson(permissionIntent) === stableJson(started.candidate?.data?.intent) &&
      stableJson(permissionIntent) === stableJson(completed.candidate?.data?.intent) &&
      permissionIntent?.id === durableTurn?.action?.id &&
      permissionIntent?.source === durableTurn?.action?.source &&
      permissionIntent?.tool === durableTurn?.action?.name &&
      stableJson(permissionIntent?.input) === stableJson(durableTurn?.action?.input) &&
      permissionIntent?.observationSequence === durableTurn?.observation?.sequence &&
      permissionIntent?.decidedAt === durableTurn?.startedAt &&
      stableJson(turn?.action) === stableJson(durableTurn?.action) &&
      stableJson(result) === stableJson(durableTurn?.outcome?.result) &&
      stableJson(result) === stableJson(completed.candidate?.data?.result),
    boundedStepAside:
      result?.ok === true &&
      navigation?.ok === true &&
      navigation?.target === 'placement step-aside' &&
      samePosition(navigation?.start, start) &&
      Number.isFinite(horizontal) &&
      horizontal > 0.25 &&
      horizontal <= 3.25 &&
      Number.isFinite(vertical) &&
      vertical <= 2.25,
    exactMinecraftConsequence:
      change?.verb === 'place' &&
      samePosition(change?.position, target) &&
      change?.before === 'air' &&
      change?.after === 'dirt' &&
      change?.verified === true &&
      change?.observed === true &&
      change?.confirmation?.source === 'mineflayer:blockUpdate' &&
      Number.isFinite(change?.confirmation?.observedAt) &&
      Number.isFinite(change?.confirmation?.beforeStateId) &&
      Number.isFinite(change?.confirmation?.afterStateId) &&
      samePosition(change?.confirmation?.position, change?.position) &&
      change.confirmation.dimension === actorDimension &&
      change.confirmation.before?.name === change?.before &&
      change.confirmation.after?.name === change?.after &&
      change.confirmation.before?.stateId === change.confirmation.beforeStateId &&
      change.confirmation.after?.stateId === change.confirmation.afterStateId &&
      change.confirmation.observedAt >= started?.candidate?.at &&
      change.confirmation.observedAt <= completed?.candidate?.at,
    inventoryConsequence: initialDirt >= 1 && finalDirt === initialDirt - 1,
    independentWitness:
      report?.independentWitness?.source === 'fresh_minecraft_connection' &&
      report?.independentWitness?.entityId !== phase?.entityId &&
      report?.independentWitness?.worldId === report?.worldId &&
      report?.independentWitness?.managedRunId === report?.managedRunId &&
      Number.isFinite(report?.independentWitness?.observedAt) &&
      report.independentWitness.observedAt >= completed?.candidate?.at &&
      report?.lifecycle?.quiescence?.reason === 'native_body_before_independent_witness' &&
      Number.isFinite(quiescenceAt) &&
      completed.candidate.at <= quiescenceAt &&
      report.independentWitness.observedAt >= quiescenceAt &&
      actorDimension.length > 0 &&
      actorAfterDimension === actorDimension &&
      actorDimension === witnessDimension &&
      witnessBlock?.name === 'dirt' &&
      Number.isFinite(witnessBlock?.stateId) &&
      witnessBlock.stateId === change?.confirmation?.afterStateId,
    durableTurn:
      phase?.priorTurns === 0 &&
      phase?.resultingTurns === 1 &&
      typeof report?.loomSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(report.loomSha256),
    cleanManagedStop:
      report?.lifecycle?.verified === true &&
      typeof report?.lifecycle?.tipDigest === 'string' &&
      /^[a-f0-9]{64}$/.test(report.lifecycle.tipDigest) &&
      report?.finalOwnership?.control === 'clear' &&
      report?.finalOwnership?.port === 'clear' &&
      report?.finalOwnership?.leases === 'clear',
  };
  return {
    protocol: NATIVE_BODY_CONFORMANCE_PROTOCOL,
    assertions,
    pass: Object.values(assertions).every(Boolean),
  };
}

function inventoryCount(observation: any, name: string) {
  return (Array.isArray(observation?.self?.inventory) ? observation.self.inventory : [])
    .filter((item: any) => String(item?.name) === name)
    .reduce((sum: number, item: any) => sum + Math.max(0, Number(item?.count) || 0), 0);
}

function finitePosition(value: any): value is { x: number; y: number; z: number } {
  return [value?.x, value?.y, value?.z].every(Number.isFinite);
}

function samePosition(left: any, right: any) {
  return (
    finitePosition(left) &&
    finitePosition(right) &&
    Number(left.x) === Number(right.x) &&
    Number(left.y) === Number(right.y) &&
    Number(left.z) === Number(right.z)
  );
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
