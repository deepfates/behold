export const NATIVE_BODY_CONFORMANCE_PROTOCOL = 'behold.native-body-conformance.v1' as const;
export const NATIVE_BODY_PHASE_PROTOCOL = 'behold.native-body-conformance-phase.v1' as const;

export function assessNativeBodyConformance(report: any) {
  const phase = report?.phase;
  const turn = phase?.turn;
  const result = turn?.result;
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
    sameAdmittedPlayerAction:
      turn?.action?.name === 'place_block' &&
      turn?.action?.source === 'script' &&
      samePosition(turn?.action?.input, target) &&
      turn?.action?.input?.name === 'dirt' &&
      phase?.model === 'script/native-body-conformance-v1',
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
      change?.confirmation?.source === 'mineflayer:blockUpdate',
    inventoryConsequence: initialDirt >= 1 && finalDirt === initialDirt - 1,
    independentWitness:
      report?.independentWitness?.source === 'fresh_minecraft_connection' &&
      report?.independentWitness?.entityId !== phase?.entityId &&
      report?.independentWitness?.worldId === report?.worldId &&
      report?.independentWitness?.managedRunId === report?.managedRunId &&
      witnessBlock?.name === 'dirt',
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
