import { readFileSync } from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(`Place experience: ${message}`);
}

export function loadPlaceExperience(experiencePath, recipe) {
  const experience = JSON.parse(readFileSync(experiencePath, 'utf8'));
  assert(experience.schemaVersion === 1, 'unsupported schemaVersion');
  assert(experience.placeId === recipe.id, 'place identity mismatch');
  const landmarkIds = new Set(recipe.landmarks.map((landmark) => landmark.id));
  assert(
    landmarkIds.has(experience.arrival?.checkpointId),
    'arrival checkpoint must name a recipe landmark',
  );
  assert(
    experience.arrival?.selectionPolicy === 'measured-natural-surface',
    'arrival selectionPolicy must be measured-natural-surface',
  );
  assert(
    Number.isInteger(experience.arrival?.acceptance?.minimumNativeTicks) &&
      experience.arrival.acceptance.minimumNativeTicks >= 24000,
    'arrival acceptance must cover at least one native Minecraft day',
  );
  assert(
    Number.isInteger(experience.arrival?.acceptance?.maximumObserverDeaths) &&
      experience.arrival.acceptance.maximumObserverDeaths >= 0,
    'arrival acceptance maximumObserverDeaths must be a non-negative integer',
  );

  const overrideIds = new Set();
  for (const override of experience.checkpointOverrides ?? []) {
    assert(landmarkIds.has(override.checkpointId), 'checkpoint override names an unknown landmark');
    assert(!overrideIds.has(override.checkpointId), 'duplicate checkpoint override');
    overrideIds.add(override.checkpointId);
    assert(
      Number.isFinite(override.lat) && Number.isFinite(override.lon),
      'invalid override point',
    );
    assert(
      typeof override.rationale === 'string' && override.rationale.length >= 20,
      'checkpoint override requires a substantive rationale',
    );
  }

  for (const transition of experience.presentationTransitions ?? []) {
    assert(
      ['ground', 'aerial'].includes(transition.mode),
      'presentation transition mode must be ground or aerial',
    );
    assert(
      typeof transition.rationale === 'string' && transition.rationale.length >= 20,
      'presentation transition requires a substantive rationale',
    );
  }
  return experience;
}

export function experienceLandmarks(recipe, experience) {
  const overrides = new Map(
    (experience?.checkpointOverrides ?? []).map((override) => [override.checkpointId, override]),
  );
  return recipe.landmarks.map((landmark) => {
    const override = overrides.get(landmark.id);
    return override
      ? {
          ...landmark,
          lat: override.lat,
          lon: override.lon,
          sourceLat: landmark.lat,
          sourceLon: landmark.lon,
          experienceOverride: true,
          overrideRationale: override.rationale,
        }
      : landmark;
  });
}
