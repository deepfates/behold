export const RESIDENT_RECOVERY_WITNESS_PROTOCOL = 'behold.resident-recovery-witness.v1' as const;

export function assessResidentRecoveryWitness(report: any) {
  const source = report?.source ?? {};
  const witness = report?.witness ?? {};
  const condition = source.finalCondition ?? {};
  const witnessedCondition = witness.condition ?? {};
  const inspection = witness.inspection ?? {};
  const positionDelta = distance(source.finalPosition, witness.position);
  const healthImproved = improved(condition.health, witnessedCondition.health);
  const foodImproved = improved(condition.food, witnessedCondition.food);
  const defensibleCover =
    inspection.ok === true &&
    inspection.source === 'loaded_local_terrain' &&
    inspection.sealed === true &&
    inspection.fullyCovered === true &&
    Number(inspection.protectedRegionCellCount) >= 1 &&
    Number(inspection.closableEntranceCount) >= 1;
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
    sourceBodyWasCritical:
      atMost(condition.health, 4) || atMost(condition.food, 2) || atMost(condition.oxygen, 5),
    sourceContainsEmbodiedRecoveryWork:
      source.bodyMoved === true || source.verifiedWorldChange === true,
    freshMinecraftWitness:
      witness.source === 'fresh_minecraft_connection' &&
      witness.authority === 'external_evaluator' &&
      witness.worldStateCertified === true,
    persistedBodyPosition: positionDelta != null && positionDelta <= 0.35,
    sourceJournalUnchanged:
      sha256(source.journalSha256Before) &&
      source.journalSha256Before === source.journalSha256After,
    inhabitantLoomUnchanged:
      sha256(source.loomSha256Before) && source.loomSha256Before === source.loomSha256After,
    managedLifecycleVerified: report?.lifecycle?.verified === true,
    finalAuthorityReleased:
      report?.finalOwnership?.control === 'clear' &&
      report?.finalOwnership?.port === 'clear' &&
      report?.finalOwnership?.leases === 'clear',
    independentlyObservedRecovery: healthImproved || foodImproved || defensibleCover,
  });
  return Object.freeze({
    pass: Object.values(assertions).every(Boolean),
    assertions,
    measurements: Object.freeze({
      positionDelta,
      healthImproved,
      foodImproved,
      defensibleCover,
      sourceCondition: condition,
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

function improved(before: unknown, after: unknown) {
  const left = finiteOrNull(before);
  const right = finiteOrNull(after);
  return left != null && right != null && right > left;
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

function nonempty(value: unknown) {
  return typeof value === 'string' && value.length > 0;
}

function sha256(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
