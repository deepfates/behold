import { landmarkFamily } from './bootstrap-core.mjs';

function safeGround(checkpoint) {
  return Boolean(
    checkpoint?.representativeGround?.headroom &&
    checkpoint.representativeGround.classification !== 'water',
  );
}

function distance(left, right) {
  return Math.hypot(left.projected.x - right.projected.x, left.projected.z - right.projected.z);
}

export function deriveVisitCandidate(recipe, inspection) {
  const checkpoints = new Map(
    inspection.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]),
  );
  const spawnLandmark = recipe.landmarks.find(
    (landmark) => landmark.name.toLowerCase() === recipe.geography.spawn.name.toLowerCase(),
  );
  const safeLandmarks = recipe.landmarks.filter((landmark) =>
    safeGround(checkpoints.get(landmark.id)),
  );
  if (!safeLandmarks.length) throw new Error('visit candidate has no measured safe landmark');
  const arrival =
    (spawnLandmark && safeGround(checkpoints.get(spawnLandmark.id)) && spawnLandmark) ||
    safeLandmarks[0];
  const arrivalCheckpoint = checkpoints.get(arrival.id);
  const familyPriority = { transit: 7, civic: 6, education: 5, culture: 4, district: 3, other: 2 };
  const destinations = safeLandmarks
    .filter((landmark) => landmark.id !== arrival.id)
    .map((landmark) => {
      const checkpoint = checkpoints.get(landmark.id);
      const blocks = distance(arrivalCheckpoint, checkpoint);
      const family = landmarkFamily({ category: landmark.source?.category ?? '' });
      const rangeFit = blocks >= 300 && blocks <= 1800 ? 1 : 0;
      return {
        landmark,
        checkpoint,
        blocks,
        family,
        score: rangeFit * 100 + (familyPriority[family] ?? 1) * 10 - Math.abs(blocks - 900) / 100,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.landmark.id.localeCompare(right.landmark.id),
    );
  if (!destinations.length) throw new Error('visit candidate has no measured ground destination');
  const destination = destinations[0];
  const revealCandidates = safeLandmarks
    .filter((landmark) => landmark.id !== arrival.id)
    .map((landmark) => {
      const checkpoint = checkpoints.get(landmark.id);
      const family = landmarkFamily({ category: landmark.source?.category ?? '' });
      return {
        landmark,
        checkpoint,
        family,
        score:
          (family === 'vertical' ? 1000 : family === 'landscape' ? 500 : 0) +
          checkpoint.representativeGround.y,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.landmark.id.localeCompare(right.landmark.id),
    );
  if (!revealCandidates.length) throw new Error('visit candidate has no measured reveal');
  const reveal = revealCandidates[0];
  return {
    policy: 'measured-arrival-ground-leg-terrain-reveal-v1',
    arrival: { landmark: arrival, checkpoint: arrivalCheckpoint },
    groundDestination: destination,
    reveal,
    consideredGroundDestinations: destinations.map(({ landmark, blocks, family, score }) => ({
      id: landmark.id,
      blocks,
      family,
      score,
    })),
  };
}
