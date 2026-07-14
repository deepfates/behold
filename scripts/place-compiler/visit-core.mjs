import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from './core.mjs';

const assert = (condition, message) => {
  if (!condition) throw new Error(`Place visit: ${message}`);
};

export async function loadVisitContract(contractPath, repositoryRoot, loadedBenchmark) {
  const absolute = path.resolve(contractPath);
  const contract = JSON.parse(readFileSync(absolute, 'utf8'));
  assert(contract.schemaVersion === 1, 'unsupported contract schema');
  assert(contract.id && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(contract.id), 'invalid contract id');
  assert(
    path.resolve(repositoryRoot, contract.benchmark) === loadedBenchmark.path,
    'benchmark mismatch',
  );
  const expected = loadedBenchmark.fixtures.map((fixture) => fixture.placeId).sort();
  assert(
    JSON.stringify(Object.keys(contract.places ?? {}).sort()) === JSON.stringify(expected),
    'contract must name every accepted place exactly once',
  );
  const places = {};
  for (const fixture of loadedBenchmark.fixtures) {
    const references = contract.places[fixture.placeId];
    const verified = {};
    for (const role of ['inspection', 'map', 'route', 'sightline']) {
      const reference = references?.[role];
      assert(reference && typeof reference.path === 'string', `${fixture.placeId} lacks ${role}`);
      assert(!path.isAbsolute(reference.path), `${fixture.placeId} ${role} path must be relative`);
      assert(/^[a-f0-9]{64}$/.test(reference.sha256), `${fixture.placeId} ${role} digest invalid`);
      const file = path.resolve(repositoryRoot, reference.path);
      assert(
        file.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`),
        `${fixture.placeId} ${role} escapes repository`,
      );
      assert(existsSync(file), `${fixture.placeId} ${role} missing`);
      assert(
        (await sha256(file)) === reference.sha256,
        `${fixture.placeId} ${role} digest mismatch`,
      );
      verified[role] = { ...reference, file };
    }
    const inspection = JSON.parse(readFileSync(verified.inspection.file, 'utf8'));
    const route = JSON.parse(readFileSync(verified.route.file, 'utf8'));
    const sightline = JSON.parse(readFileSync(verified.sightline.file, 'utf8'));
    const recipe = JSON.parse(readFileSync(fixture.recipePath, 'utf8'));
    assert(
      inspection.placeId === fixture.placeId,
      `${fixture.placeId} inspection identity mismatch`,
    );
    assert(route.placeId === fixture.placeId, `${fixture.placeId} route identity mismatch`);
    assert(sightline.placeId === fixture.placeId, `${fixture.placeId} sightline identity mismatch`);
    assert(
      route.worldTreeSha256 === fixture.worldTreeSha256 &&
        sightline.worldTreeSha256 === fixture.worldTreeSha256,
      `${fixture.placeId} geographic evidence world-tree mismatch`,
    );
    places[fixture.placeId] = {
      fixture,
      recipe,
      references: verified,
      inspection,
      route,
      sightline,
    };
  }
  return { path: absolute, sha256: await sha256(absolute), contract, places };
}

export function deriveVisitPlan(loadedPlace) {
  const { fixture, recipe, inspection, route, sightline } = loadedPlace;
  const arrivalId = fixture.experience?.arrival?.checkpointId;
  assert(arrivalId, `${fixture.placeId} has no accepted experience arrival`);
  const arrivalCheckpoint = inspection.checkpoints?.find((item) => item.id === arrivalId);
  const arrivalGround = arrivalCheckpoint?.representativeGround;
  assert(
    arrivalGround && Number.isFinite(arrivalGround.y) && arrivalGround.headroom,
    `${fixture.placeId} accepted arrival has no inspected ground`,
  );
  const arrival = {
    checkpointId: arrivalId,
    name: arrivalCheckpoint.name,
    x: arrivalGround.x,
    y: arrivalGround.y + 1,
    z: arrivalGround.z,
    support: arrivalGround.block,
  };
  const groundLeg = chooseGroundLeg(route, arrival);
  const reveal = chooseReveal(sightline);
  return {
    placeId: fixture.placeId,
    placeName: recipe.name,
    sourceRunId: fixture.runId,
    worldTreeSha256: fixture.worldTreeSha256,
    arrival,
    groundLeg,
    reveal,
    landmarks: fixture.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      name: checkpoint.name,
      x: checkpoint.x,
      z: checkpoint.z,
    })),
  };
}

export function derivePresentationFocus(reveal, lookDistance = 128, lookDown = 36) {
  assert(
    Number.isFinite(reveal?.observer?.x) &&
      Number.isFinite(reveal?.observer?.y) &&
      Number.isFinite(reveal?.observer?.z) &&
      Number.isFinite(reveal?.target?.x) &&
      Number.isFinite(reveal?.target?.z),
    'reveal lacks finite presentation coordinates',
  );
  assert(
    Number.isFinite(lookDistance) && lookDistance > 0 && Number.isFinite(lookDown) && lookDown >= 0,
    'presentation focus requires a positive distance and non-negative look-down',
  );
  const deltaX = reveal.target.x - reveal.observer.x;
  const deltaZ = reveal.target.z - reveal.observer.z;
  const horizontalDistance = Math.hypot(deltaX, deltaZ);
  assert(horizontalDistance > 0, 'reveal target must differ from observer horizontally');
  return {
    x: reveal.observer.x + (deltaX / horizontalDistance) * lookDistance,
    y: reveal.observer.y - lookDown,
    z: reveal.observer.z + (deltaZ / horizontalDistance) * lookDistance,
  };
}

export function chooseGroundLeg(route, arrival, targetBlocks = 64) {
  const samples = route.samples ?? [];
  const defectEdges = new Set(
    (route.swept?.defects ?? []).map((defect) => `${defect.fromSample}:${defect.toSample}`),
  );
  const runs = [];
  let run = [];
  for (let index = 0; index < samples.length; index += 1) {
    const selected = samples[index]?.selected;
    const edgeClear =
      index === 0 || (samples[index - 1]?.selected && !defectEdges.has(`${index - 1}:${index}`));
    if (!selected || !edgeClear) {
      if (run.length > 1) runs.push(run);
      run = selected ? [index] : [];
    } else run.push(index);
  }
  if (run.length > 1) runs.push(run);
  const candidates = [];
  for (const indices of runs) {
    for (let start = 0; start < indices.length - 1; start += 1) {
      const picked = [indices[start]];
      let blocks = 0;
      for (let cursor = start + 1; cursor < indices.length; cursor += 1) {
        const from = samples[indices[cursor - 1]].selected;
        const to = samples[indices[cursor]].selected;
        blocks += Math.hypot(to.x - from.x, to.z - from.z);
        picked.push(indices[cursor]);
        if (blocks >= targetBlocks) break;
      }
      if (blocks >= Math.min(24, targetBlocks)) candidates.push({ indices: picked, blocks });
    }
  }
  assert(candidates.length, `${route.placeId} route has no bounded collision-valid ground leg`);
  const chosen = candidates.sort((left, right) => {
    const leftStart = samples[left.indices[0]].selected;
    const rightStart = samples[right.indices[0]].selected;
    return (
      Math.hypot(leftStart.x - arrival.x, leftStart.z - arrival.z) -
        Math.hypot(rightStart.x - arrival.x, rightStart.z - arrival.z) ||
      Math.abs(left.blocks - targetBlocks) - Math.abs(right.blocks - targetBlocks)
    );
  })[0];
  const waypoints = chosen.indices.map((index) => {
    const selected = samples[index].selected;
    return { sampleIndex: index, x: selected.x, y: selected.surfaceY + 1, z: selected.z };
  });
  return {
    routeId: route.route.id,
    routeName: route.route.name,
    auditedTraversableShare: route.summary.swept.traversableShare,
    startDistanceFromArrival: Math.hypot(waypoints[0].x - arrival.x, waypoints[0].z - arrival.z),
    distanceBlocks: chosen.blocks,
    waypoints,
    evidence: 'consecutive resolved samples with zero swept one-block defects',
  };
}

export function chooseReveal(sightline) {
  assert(sightline.results?.length, `${sightline.placeId} has no sightline results`);
  const clear = sightline.results.filter((result) => result.minimumClearLiftBlocks != null);
  const selected = (clear.length ? clear : sightline.results).sort((left, right) => {
    const leftLift =
      left.minimumClearLiftBlocks ?? Math.max(...left.reveal.map((item) => item.liftBlocks));
    const rightLift =
      right.minimumClearLiftBlocks ?? Math.max(...right.reveal.map((item) => item.liftBlocks));
    return leftLift - rightLift || left.id.localeCompare(right.id);
  })[0];
  const lift =
    selected.minimumClearLiftBlocks ?? Math.max(...selected.reveal.map((item) => item.liftBlocks));
  const measurement = selected.reveal.find((item) => item.liftBlocks === lift);
  return {
    sightlineId: selected.id,
    name: selected.name,
    liftBlocks: lift,
    clear: Boolean(measurement.sightline.clear),
    observer: measurement.observer,
    target: selected.target.localPeak,
    limitation: measurement.sightline.clear
      ? null
      : 'No tested lift cleared the voxel ray; this is the highest measured reveal, not a clear-sightline claim.',
  };
}
