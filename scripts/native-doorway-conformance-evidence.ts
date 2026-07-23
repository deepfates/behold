export const NATIVE_DOORWAY_CONFORMANCE_PROTOCOL = 'behold.native-doorway-conformance.v1' as const;
export const NATIVE_DOORWAY_PHASE_PROTOCOL = 'behold.native-doorway-conformance-phase.v1' as const;

export function assessNativeDoorwayConformance(report: any) {
  const phase = report?.phase;
  const first = phase?.firstCrossing;
  const reused = phase?.reusedCrossing;
  const firstResult = first?.result;
  const reusedResult = reused?.result;
  const remembered = Array.isArray(phase?.memoryAfterFirst) ? phase.memoryAfterFirst[0] : null;
  const restarted = Array.isArray(phase?.memoryAfterRestart) ? phase.memoryAfterRestart[0] : null;
  const witness = report?.independentWitness;
  const finalFeet = feetCell(phase?.finalObservation?.self?.pose?.position);
  const witnessFeet = feetCell(witness?.resident?.position);
  const forbiddenMemory = JSON.stringify(phase?.memoryAfterRestart ?? []).match(
    /sealed-space|covered-space|shared-capacity|closable-entrance|protectedBodyCells"\s*:\s*\[[^\]]/,
  );

  const assertions = {
    protocol:
      report?.protocol === NATIVE_DOORWAY_CONFORMANCE_PROTOCOL &&
      phase?.protocol === NATIVE_DOORWAY_PHASE_PROTOCOL,
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
    exactFirstPersonSelection:
      first?.action?.name === 'cross_visible_door' &&
      first?.action?.source === 'script' &&
      first?.action?.input?.focus === phase?.initialObservation?.scene?.focus?.id &&
      phase?.initialObservation?.scene?.focus?.source === 'cursor' &&
      phase?.initialObservation?.scene?.focus?.reachable === true &&
      phase?.initialObservation?.scene?.focus?.name === 'oak_door',
    crossedSelectedAperture:
      firstResult?.ok === true &&
      firstResult?.protocol === 'behold.visible-door-crossing.v1' &&
      firstResult?.crossed === true &&
      firstResult?.crossing?.doorCellOccupied === true &&
      firstResult?.crossing?.confirmation === 'mineflayer:body_crossed_selected_door_cell' &&
      sameDoorColumn(firstResult?.focus?.position, firstResult?.door) &&
      samePosition(
        feetCell(first?.turn?.nextObservation?.self?.pose?.position),
        firstResult?.toFeet,
      ),
    attributedDoorUse:
      confirmedTransition(firstResult?.doorOpened, false, true) &&
      confirmedTransition(firstResult?.doorClosed, true, false),
    residentEarnedMemory:
      phase?.memoryAfterFirst?.length === 1 &&
      remembered?.evidence === 'doorway_crossed' &&
      remembered?.circleId === report?.worldId &&
      remembered?.provenance?.kind === 'embodied_doorway' &&
      remembered?.provenance?.witnessAction === 'cross_visible_door' &&
      remembered?.affordances?.length === 1 &&
      remembered.affordances[0] === 'witnessed-doorway-crossing' &&
      remembered?.protectedBodyCells?.length === 0 &&
      remembered?.entrances?.length === 0 &&
      remembered?.doorways?.length === 1 &&
      !forbiddenMemory,
    restartProjection:
      restarted?.id === remembered?.id &&
      JSON.stringify(phase?.memoryAfterRestart) === JSON.stringify(phase?.memoryAfterFirst),
    directionNeutralReuse:
      reused?.action?.name === 'cross_place_door' &&
      reused?.action?.source === 'script' &&
      reused?.action?.input?.id === restarted?.id &&
      reusedResult?.ok === true &&
      reusedResult?.crossed === true &&
      samePosition(reusedResult?.fromFeet, firstResult?.toFeet) &&
      samePosition(reusedResult?.toFeet, firstResult?.fromFeet) &&
      samePosition(finalFeet, firstResult?.fromFeet),
    independentWitness:
      witness?.source === 'fresh_minecraft_connection' &&
      witness?.entityId !== phase?.entityId &&
      witness?.worldId === report?.worldId &&
      witness?.managedRunId === report?.managedRunId &&
      witness?.door?.name === 'oak_door' &&
      witness?.door?.open === false &&
      witness?.resident?.username === phase?.entityId &&
      samePosition(witnessFeet, firstResult?.fromFeet),
    durableTurns:
      phase?.priorTurns === 0 &&
      phase?.resultingTurns === 2 &&
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
    protocol: NATIVE_DOORWAY_CONFORMANCE_PROTOCOL,
    assertions,
    pass: Object.values(assertions).every(Boolean),
  };
}

function confirmedTransition(value: any, before: boolean, after: boolean) {
  return (
    value?.ok === true &&
    value?.changed?.property === 'open' &&
    value?.changed?.before === before &&
    value?.changed?.after === after &&
    value?.confirmation?.source === 'mineflayer:blockUpdate'
  );
}

function feetCell(value: any) {
  if (![value?.x, value?.y, value?.z].every((part) => Number.isFinite(Number(part)))) return null;
  return {
    x: Math.floor(Number(value.x)),
    y: Math.floor(Number(value.y)),
    z: Math.floor(Number(value.z)),
  };
}

function samePosition(left: any, right: any) {
  return (
    [left?.x, left?.y, left?.z, right?.x, right?.y, right?.z].every((part) =>
      Number.isFinite(Number(part)),
    ) &&
    Number(left.x) === Number(right.x) &&
    Number(left.y) === Number(right.y) &&
    Number(left.z) === Number(right.z)
  );
}

function sameDoorColumn(focus: any, door: any) {
  return (
    Number(focus?.x) === Number(door?.lower?.x) &&
    Number(focus?.z) === Number(door?.lower?.z) &&
    [Number(door?.lower?.y), Number(door?.upper?.y)].includes(Number(focus?.y))
  );
}
