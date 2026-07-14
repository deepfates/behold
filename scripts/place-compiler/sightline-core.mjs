export function voxelLine(from, to, spacing = 1) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  const points = [];
  let previous = null;
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const point = {
      x: Math.floor(from.x + (to.x - from.x) * ratio),
      y: Math.floor(from.y + (to.y - from.y) * ratio),
      z: Math.floor(from.z + (to.z - from.z) * ratio),
      ratio,
      distance: distance * ratio,
    };
    const key = `${point.x},${point.y},${point.z}`;
    if (key !== previous) points.push(point);
    previous = key;
  }
  return { distance, points };
}

export function summarizeSightline(line, observations, endpointMarginBlocks = 3) {
  const interior = observations.filter(
    (item) =>
      item.distance >= endpointMarginBlocks &&
      item.distance <= line.distance - endpointMarginBlocks,
  );
  const opaque = interior.filter((item) => item.opaque);
  const translucent = interior.filter((item) => item.transparent && item.block && !item.air);
  return {
    distanceBlocks: line.distance,
    testedVoxelCount: interior.length,
    clear: opaque.length === 0,
    firstOpaque: opaque[0] ?? null,
    opaqueVoxelCount: opaque.length,
    translucentVoxelCount: translucent.length,
    clearDistanceBlocks: opaque[0]?.distance ?? line.distance,
  };
}
