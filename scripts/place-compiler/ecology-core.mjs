export function parseSprintCompletion(output, requestedTicks) {
  const timed = output.match(
    /Sprint completed in\s+([0-9.]+)\s*(?:ms|milliseconds?)\s*\(([0-9.]+)\s*(?:ms|milliseconds?)\/tick,\s*([0-9.]+)\s*TPS\)/i,
  );
  if (timed)
    return {
      requestedTicks,
      wallMilliseconds: Number(timed[1]),
      millisecondsPerTick: Number(timed[2]),
      effectiveTps: Number(timed[3]),
      serverFormat: 'duration',
    };
  const rate = output.match(
    /Sprint completed with\s+([0-9.]+)\s+ticks per second,\s+or\s+([0-9.]+)\s+ms per tick/i,
  );
  if (!rate) return null;
  const effectiveTps = Number(rate[1]);
  return {
    requestedTicks,
    wallMilliseconds: (requestedTicks / effectiveTps) * 1000,
    millisecondsPerTick: Number(rate[2]),
    effectiveTps,
    serverFormat: 'rate',
  };
}

export function summarizeEntities(entities, observerId, origin, radius) {
  const nearby = Object.values(entities).filter((entity) => {
    if (entity.id === observerId || !entity.position) return false;
    return entity.position.distanceTo(origin) <= radius;
  });
  const count = (field) =>
    Object.fromEntries(
      [...new Set(nearby.map((entity) => entity[field] ?? 'unknown'))]
        .map((value) => [
          value,
          nearby.filter((entity) => (entity[field] ?? 'unknown') === value).length,
        ])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    );
  return {
    radius,
    total: nearby.length,
    ids: nearby.map((entity) => entity.id).sort((left, right) => left - right),
    byType: count('type'),
    byName: count('name'),
  };
}

export function summarizeTurnover(before, after) {
  const beforeIds = new Set(before.ids);
  const afterIds = new Set(after.ids);
  return {
    appearedEntityIds: after.ids.filter((id) => !beforeIds.has(id)),
    disappearedEntityIds: before.ids.filter((id) => !afterIds.has(id)),
    netEntityCount: after.total - before.total,
  };
}

export function deriveEcologyFindings(placeId, before, after, lifecycle) {
  const findings = [];
  if (lifecycle.deathMessages.length) {
    findings.push({
      id: `${placeId}-spawn-survival-pressure`,
      severity: 'high',
      dimensions: ['habitability', 'ecology', 'experience'],
      kind: 'observer-death-during-native-day',
      summary: `The survival observer died ${lifecycle.deathMessages.length} time(s) during one accelerated native day`,
      location: before.observer.position,
      evidence: lifecycle.deathMessages,
    });
  }
  const hostile = after.entities.byType.hostile ?? 0;
  if (after.entities.total >= 20 && hostile / after.entities.total >= 0.75) {
    findings.push({
      id: `${placeId}-hostile-spawn-dominance`,
      severity: 'medium',
      dimensions: ['habitability', 'ecology'],
      kind: 'hostile-entity-dominance-candidate',
      summary: `${hostile} of ${after.entities.total} protocol-visible entities were hostile after the native day`,
      location: after.observer.position,
      qualification: 'Bounded spawn-region observation, not a world-wide mob census.',
    });
  }
  return findings;
}
