import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const modulePath = path.resolve(__dirname, '../../scripts/place-compiler/route-core.mjs');

test('route sampling projects geography and keeps endpoints', async () => {
  const { projectGeographicPoint, sampleRouteGeometry } = await import(
    pathToFileURL(modulePath).href
  );
  const metadata = {
    minMcX: 0,
    maxMcX: 1000,
    minMcZ: 0,
    maxMcZ: 1000,
    minGeoLon: -10,
    maxGeoLon: 0,
    minGeoLat: 40,
    maxGeoLat: 50,
  };
  assert.deepEqual(projectGeographicPoint(metadata, -5, 45), { x: 500, z: 500 });
  const samples = sampleRouteGeometry(
    [
      [-10, 50],
      [-9.99, 49.99],
      [0, 40],
    ],
    metadata,
    10,
  );
  assert.equal(samples[0].sourceIndex, 0);
  assert.equal(samples.at(-1)?.sourceIndex, 2);
});

test('directed routes prefer clear nearby surfaces and summarize honest gaps', async () => {
  const { chooseDirectedSurface, hasTwoBlockHeadroom, summarizeRouteSamples } = await import(
    pathToFileURL(modulePath).href
  );
  assert.equal(hasTwoBlockHeadroom('minecraft:air', 'minecraft:air'), true);
  assert.equal(hasTwoBlockHeadroom('minecraft:air', 'minecraft:oak_leaves'), false);
  // High canopy is deliberately absent from this contract: only the body's two cells determine
  // whether a route column is passable.
  const selected = chooseDirectedSurface(
    [
      { x: 0, z: 0, dx: 0, dz: 0, surfaceY: 64, clear: false },
      { x: 2, z: 0, dx: 2, dz: 0, surfaceY: 64, clear: true },
      { x: 0, z: 2, dx: 0, dz: 2, surfaceY: 64, clear: true },
    ],
    { dx: 0, dz: 1 },
  );
  assert.deepEqual(selected, { x: 0, z: 2, dx: 0, dz: 2, surfaceY: 64, clear: true });
  assert.deepEqual(
    summarizeRouteSamples(
      [{ status: 'exact-clear' }, { status: 'offset-clear' }, { status: 'unresolved' }],
      { testedPoints: 10, blockedPoints: 1, unsupportedPoints: 2, defects: [{}, {}, {}] },
    ),
    {
      sampleCount: 3,
      statusCounts: { 'exact-clear': 1, 'offset-clear': 1, unresolved: 1 },
      resolvedShare: 2 / 3,
      swept: {
        testedPoints: 10,
        blockedPoints: 1,
        unsupportedPoints: 2,
        collisionFreeShare: 0.9,
        traversableShare: 0.7,
      },
    },
  );
});
