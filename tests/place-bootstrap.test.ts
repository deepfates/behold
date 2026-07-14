import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const corePath = path.resolve(__dirname, '../../scripts/place-compiler/bootstrap-core.mjs');
const bounds = { minLat: 37.8, minLon: -122.4, maxLat: 37.9, maxLon: -122.2 };

test('bootstrap derives named, sourced, spatially distributed landmark candidates', async () => {
  const { deriveLandmarkCandidates, selectRepresentativeLandmarks, spawnCandidates } = await import(
    pathToFileURL(corePath).href
  );
  const document = {
    elements: [
      {
        type: 'node',
        id: 1,
        lat: 37.85,
        lon: -122.3,
        tags: { name: 'Civic Park', leisure: 'park', wikidata: 'Q1' },
      },
      {
        type: 'node',
        id: 2,
        lat: 37.86,
        lon: -122.29,
        tags: { name: 'City Hall', amenity: 'townhall', wikipedia: 'en:City Hall' },
      },
      {
        type: 'node',
        id: 3,
        lat: 37.88,
        lon: -122.22,
        tags: { name: 'Hill Tower', man_made: 'tower' },
      },
      {
        type: 'node',
        id: 4,
        lat: 38.0,
        lon: -122.3,
        tags: { name: 'Outside', tourism: 'attraction' },
      },
    ],
  };
  const candidates = deriveLandmarkCandidates(document, bounds);
  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].name, 'City Hall');
  const intent = {
    purpose: 'Create a civic living place.',
    creativeDirection: 'Connect city and landscape.',
    requiredQualities: [],
  };
  const spawns = spawnCandidates(candidates, { lat: 37.85, lon: -122.3 });
  const selected = selectRepresentativeLandmarks(candidates, intent, 3, [spawns[0]]);
  assert.equal(new Set(selected.map((item: { id: string }) => item.id)).size, 3);
  assert.equal(spawns[0].name, 'Civic Park');
});

test('bootstrap computes centers for named ways from their frozen member nodes', async () => {
  const { deriveLandmarkCandidates } = await import(pathToFileURL(corePath).href);
  const document = {
    elements: [
      { type: 'way', id: 9, nodes: [1, 2, 3], tags: { name: 'University', amenity: 'university' } },
      { type: 'node', id: 1, lat: 37.84, lon: -122.3 },
      { type: 'node', id: 2, lat: 37.85, lon: -122.29 },
      { type: 'node', id: 3, lat: 37.86, lon: -122.28 },
    ],
  };
  const [candidate] = deriveLandmarkCandidates(document, bounds);
  assert.equal(candidate.name, 'University');
  assert.equal(candidate.lat, 37.85);
  assert.equal(candidate.lon, -122.29);
});
