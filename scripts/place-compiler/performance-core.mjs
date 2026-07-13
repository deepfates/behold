function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function classifyCase(measurement, maxWallSeconds) {
  const reasons = [];
  if (!measurement.shutdown.clean) reasons.push('unclean-shutdown');
  if (measurement.sprint.effectiveTps < 20) reasons.push('below-realtime-tps');
  if (measurement.sprint.observedWallMilliseconds > maxWallSeconds * 1000)
    reasons.push('wall-budget-exceeded');
  return {
    stable: reasons.length === 0,
    reasons,
    realtimeHeadroom: measurement.sprint.effectiveTps / 20,
  };
}

export function summarizePerformance(cases, profiles, maxWallSeconds) {
  const groups = new Map();
  for (const item of cases) {
    const key = `${item.placeId}:${item.profileId}`;
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, repetitions]) => {
    const [placeId, profileId] = key.split(':');
    const classified = repetitions.map((item) => classifyCase(item, maxWallSeconds));
    const tps = repetitions.map((item) => item.sprint.effectiveTps);
    const rss = repetitions.map((item) => item.process.peakRssBytes);
    return {
      placeId,
      profileId,
      operatingPoint: profiles[profileId],
      repetitions: repetitions.length,
      stable: classified.every((item) => item.stable),
      instabilityReasons: [...new Set(classified.flatMap((item) => item.reasons))],
      medianEffectiveTps: median(tps),
      minimumEffectiveTps: Math.min(...tps),
      maximumEffectiveTps: Math.max(...tps),
      minimumRealtimeHeadroom: Math.min(...classified.map((item) => item.realtimeHeadroom)),
      medianPeakRssBytes: median(rss),
      maximumPeakRssBytes: Math.max(...rss),
      medianStartupMilliseconds: median(repetitions.map((item) => item.serverStartupMilliseconds)),
    };
  });
}
