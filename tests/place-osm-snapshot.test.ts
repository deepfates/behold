import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const modulePath = path.resolve(__dirname, '../../scripts/place-compiler/fetch-osm-snapshot.mjs');

test('OSM acquisition derives one exact recursive query from recipe bounds', async () => {
  const { overpassQueryForBounds } = await import(pathToFileURL(modulePath).href);
  assert.equal(
    overpassQueryForBounds({ minLat: 1, minLon: 2, maxLat: 3, maxLon: 4 }),
    '[out:json][timeout:600];(nwr(1,2,3,4););out body;>;out skel qt;',
  );
});

test('a frozen OSM request survives non-geographic recipe revisions only', async () => {
  const { acquisitionMatchesPlaceRequest, overpassQueryForBounds } = await import(
    pathToFileURL(modulePath).href
  );
  const bounds = { minLat: 1, minLon: 2, maxLat: 3, maxLon: 4 };
  const acquisition = {
    kind: 'place-osm-snapshot-acquisition',
    placeId: 'place',
    recipeSha256: 'historical-recipe-digest',
    query: overpassQueryForBounds(bounds),
  };
  const revised = {
    id: 'place',
    geography: { bounds },
    generation: { cartographyPolicy: 'minecraft-legible-v1' },
  };
  assert.equal(acquisitionMatchesPlaceRequest(acquisition, revised), true);
  assert.equal(
    acquisitionMatchesPlaceRequest(acquisition, {
      ...revised,
      geography: { bounds: { ...bounds, maxLon: 5 } },
    }),
    false,
  );
});
