import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const repositoryRoot = path.resolve(__dirname, '..', '..');
const corePath = path.join(repositoryRoot, 'scripts/place-compiler/experience-core.mjs');

test('place experiences select safe arrivals without mutating place recipes', async () => {
  const { experienceLandmarks, loadPlaceExperience } = await import(pathToFileURL(corePath).href);
  const recipe = {
    id: 'lower-manhattan',
    landmarks: [
      { id: 'city-hall', lat: 1, lon: 2 },
      { id: 'brooklyn-bridge', lat: 3, lon: 4 },
    ],
  };
  const experience = loadPlaceExperience(
    path.join(repositoryRoot, 'docs/place-compiler/experiences/lower-manhattan.json'),
    recipe,
  );
  const landmarks = experienceLandmarks(recipe, experience);
  assert.equal(experience.arrival.checkpointId, 'city-hall');
  assert.equal(landmarks[1].experienceOverride, true);
  assert.equal(landmarks[1].sourceLat, 3);
  assert.equal(recipe.landmarks[1].lat, 3);
});

test('place experiences refuse an arrival outside the recipe landmarks', async () => {
  const { loadPlaceExperience } = await import(pathToFileURL(corePath).href);
  assert.throws(
    () =>
      loadPlaceExperience(
        path.join(repositoryRoot, 'docs/place-compiler/experiences/san-francisco.json'),
        { id: 'san-francisco', landmarks: [{ id: 'somewhere-else' }] },
      ),
    /arrival checkpoint must name a recipe landmark/,
  );
});
