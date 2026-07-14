export function projectGeographicPoint(metadata, longitude, latitude) {
  return {
    x:
      metadata.minMcX +
      ((longitude - metadata.minGeoLon) / (metadata.maxGeoLon - metadata.minGeoLon)) *
        (metadata.maxMcX - metadata.minMcX),
    z:
      metadata.minMcZ +
      (1 - (latitude - metadata.minGeoLat) / (metadata.maxGeoLat - metadata.minGeoLat)) *
        (metadata.maxMcZ - metadata.minMcZ),
  };
}

export function sampleRouteGeometry(coordinates, metadata, spacingBlocks) {
  const samples = [];
  let previous = null;
  for (let sourceIndex = 0; sourceIndex < coordinates.length; sourceIndex += 1) {
    const [longitude, latitude, elevation] = coordinates[sourceIndex];
    const projected = projectGeographicPoint(metadata, longitude, latitude);
    if (
      previous &&
      sourceIndex !== coordinates.length - 1 &&
      Math.hypot(projected.x - previous.x, projected.z - previous.z) < spacingBlocks
    )
      continue;
    const sample = {
      sourceIndex,
      longitude,
      latitude,
      sourceElevation: elevation ?? null,
      x: Math.round(projected.x),
      z: Math.round(projected.z),
    };
    if (!previous || sample.x !== previous.x || sample.z !== previous.z) samples.push(sample);
    previous = sample;
  }
  return samples;
}

export function chooseDirectedSurface(candidates, previousOffset = { dx: 0, dz: 0 }) {
  const viable = candidates.filter((candidate) => candidate.clear);
  if (!viable.length) return null;
  return [...viable].sort(
    (left, right) =>
      Math.hypot(left.dx, left.dz) - Math.hypot(right.dx, right.dz) ||
      Math.hypot(left.dx - previousOffset.dx, left.dz - previousOffset.dz) -
        Math.hypot(right.dx - previousOffset.dx, right.dz - previousOffset.dz) ||
      left.surfaceY - right.surfaceY ||
      left.x - right.x ||
      left.z - right.z,
  )[0];
}

export function hasTwoBlockHeadroom(feet, head) {
  const air = /^(?:minecraft:)?(?:air|cave_air|void_air)$/;
  return (!feet || air.test(feet)) && (!head || air.test(head));
}

export function summarizeRouteSamples(samples, swept) {
  const statusCounts = Object.fromEntries(
    ['exact-clear', 'offset-clear', 'unresolved'].map((status) => [
      status,
      samples.filter((sample) => sample.status === status).length,
    ]),
  );
  return {
    sampleCount: samples.length,
    statusCounts,
    resolvedShare: samples.length
      ? (statusCounts['exact-clear'] + statusCounts['offset-clear']) / samples.length
      : 0,
    swept: {
      testedPoints: swept.testedPoints,
      blockedPoints: swept.blockedPoints,
      unsupportedPoints: swept.unsupportedPoints,
      collisionFreeShare: swept.testedPoints ? 1 - swept.blockedPoints / swept.testedPoints : 0,
      traversableShare: swept.testedPoints ? 1 - swept.defects.length / swept.testedPoints : 0,
    },
  };
}
