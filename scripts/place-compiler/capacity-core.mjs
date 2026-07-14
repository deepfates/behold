function assert(condition, message) {
  if (!condition) throw new Error(`Capacity frontier: ${message}`);
}

export function validateCapacityPlan(plan, fixture) {
  assert(plan.schemaVersion === 1, 'unsupported schemaVersion');
  assert(plan.entity?.type === 'minecraft:villager', 'controlled entity type must be villager');
  assert(typeof plan.entity.ai === 'boolean', 'controlled entity AI policy must be explicit');
  assert(
    plan.entity.spacingBlocks == null ||
      (Number.isInteger(plan.entity.spacingBlocks) && plan.entity.spacingBlocks >= 1),
    'controlled entity spacing must be a positive integer',
  );
  assert(
    Array.isArray(plan.regionCheckpointIds) && plan.regionCheckpointIds.length >= 2,
    'needs regions',
  );
  const checkpointIds = new Set(fixture.checkpoints.map((checkpoint) => checkpoint.id));
  for (const id of plan.regionCheckpointIds)
    assert(checkpointIds.has(id), `unknown region checkpoint ${id}`);
  assert(Array.isArray(plan.cases) && plan.cases.length >= 2, 'needs at least two cases');
  const ids = new Set();
  for (const item of plan.cases) {
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id ?? ''), 'invalid case id');
    assert(!ids.has(item.id), `duplicate case ${item.id}`);
    ids.add(item.id);
    assert(
      Number.isInteger(item.activeRegions) &&
        item.activeRegions >= 1 &&
        item.activeRegions <= plan.regionCheckpointIds.length,
      `${item.id} has invalid activeRegions`,
    );
    assert(
      Number.isInteger(item.protocolBodies) && item.protocolBodies >= item.activeRegions,
      `${item.id} must keep every region embodied`,
    );
    assert(
      Number.isInteger(item.nativeEntities) && item.nativeEntities >= 0,
      `${item.id} has invalid nativeEntities`,
    );
    assert(
      item.activeAiEntities == null ||
        (Number.isInteger(item.activeAiEntities) &&
          item.activeAiEntities >= 0 &&
          item.activeAiEntities <= item.nativeEntities),
      `${item.id} has invalid activeAiEntities`,
    );
    assert(
      Number.isInteger(item.sprintTicks) && item.sprintTicks >= 1000,
      `${item.id} has an insufficient tick sprint`,
    );
  }
  return plan;
}

export function simulationChunkCount(sites, distance) {
  const chunks = new Set();
  for (const site of sites) {
    const centerX = Math.floor(site.x / 16);
    const centerZ = Math.floor(site.z / 16);
    for (let dx = -distance; dx <= distance; dx += 1)
      for (let dz = -distance; dz <= distance; dz += 1)
        chunks.add(`${centerX + dx},${centerZ + dz}`);
  }
  return chunks.size;
}

export function classifyCapacityCase(report) {
  const reasons = [];
  if (report.sprint.effectiveTps < 20) reasons.push('below-realtime-tps');
  if (report.liveness.connectedBodiesAfterSprint !== report.axes.protocolBodies)
    reasons.push('body-liveness-loss');
  if (report.entities.after !== report.axes.nativeEntities)
    reasons.push('controlled-entity-count-mismatch');
  if (report.restart.persistedEntities !== report.axes.nativeEntities)
    reasons.push('entity-persistence-mismatch');
  if (!report.shutdown.clean || !report.restart.shutdown.clean) reasons.push('unclean-shutdown');
  return {
    stable: reasons.length === 0,
    reasons,
    realtimeHeadroom: report.sprint.effectiveTps / 20,
  };
}

export function summarizeCapacity(reports) {
  const stable = reports.filter((report) => report.classification.stable);
  const maximum = (field) =>
    Math.max(
      0,
      ...stable.map((report) => (Number.isFinite(report.axes[field]) ? report.axes[field] : 0)),
    );
  return {
    stableCaseCount: stable.length,
    unstableCaseIds: reports
      .filter((report) => !report.classification.stable)
      .map((report) => report.caseId),
    demonstratedStableLowerBounds: {
      activeRegions: maximum('activeRegions'),
      protocolBodies: maximum('protocolBodies'),
      nativeEntities: maximum('nativeEntities'),
      ...(reports.some((report) => Number.isFinite(report.axes.activeAiEntities))
        ? { activeAiEntities: maximum('activeAiEntities') }
        : {}),
      combinedProtocolBodies: Math.max(
        0,
        ...stable
          .filter((report) => report.axes.nativeEntities > 0)
          .map((report) => report.axes.protocolBodies),
      ),
      combinedNativeEntities: Math.max(
        0,
        ...stable
          .filter((report) => report.axes.protocolBodies > report.axes.activeRegions)
          .map((report) => report.axes.nativeEntities),
      ),
    },
    claimBoundary:
      'These are substrate lower bounds for protocol bodies and native entities, not Behold inhabitants or concurrent inference.',
  };
}
