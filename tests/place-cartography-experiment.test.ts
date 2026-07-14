import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const modulePath = path.resolve(
  __dirname,
  '../../scripts/place-compiler/cartography-experiment.mjs',
);
const metricsModulePath = path.resolve(
  __dirname,
  '../../scripts/place-compiler/cartography-metrics.mjs',
);

test('one cartography policy compiles identically across contrasting windows', async () => {
  const { calibrationRecipe, validateExperiment } = await import(pathToFileURL(modulePath).href);
  const experiment = validateExperiment({
    schemaVersion: 1,
    id: 'experiment',
    question: 'Does the same policy survive two structurally different windows?',
    policies: ['literal-v1', 'minecraft-legible-v1'],
    windows: [
      {
        id: 'forest',
        name: 'Forest',
        structure: 'wooded paths and clearings',
        osmSnapshot: 'frozen/forest.json',
        bounds: { minLat: 1, minLon: 1, maxLat: 2, maxLon: 2 },
        spawn: { name: 'A', lat: 1.5, lon: 1.5 },
        landmarks: [
          { id: 'a', name: 'A', lat: 1.4, lon: 1.4 },
          { id: 'b', name: 'B', lat: 1.6, lon: 1.6 },
        ],
      },
      {
        id: 'city',
        name: 'City',
        structure: 'dense towers and broad streets',
        osmSnapshot: 'frozen/city.json',
        bounds: { minLat: 3, minLon: 3, maxLat: 4, maxLon: 4 },
        spawn: { name: 'C', lat: 3.5, lon: 3.5 },
        landmarks: [
          { id: 'c', name: 'C', lat: 3.4, lon: 3.4 },
          { id: 'd', name: 'D', lat: 3.6, lon: 3.6 },
        ],
      },
    ],
  });
  const recipes = experiment.windows.map((window: unknown) =>
    calibrationRecipe(experiment, window, 'minecraft-legible-v1'),
  );
  assert.equal(recipes[0].generation.cartographyPolicy, 'minecraft-legible-v1');
  assert.equal(recipes[1].generation.cartographyPolicy, 'minecraft-legible-v1');
  assert.notDeepEqual(recipes[0].geography.bounds, recipes[1].geography.bounds);
  assert.deepEqual(recipes[0].generation, recipes[1].generation);
});

test('cartography metrics use a deterministic bounded lattice', async () => {
  const { sampleLattice } = await import(pathToFileURL(metricsModulePath).href);
  const metadata = { minMcX: 0, maxMcX: 999, minMcZ: 0, maxMcZ: 99 };
  const first = sampleLattice(metadata, 100);
  const second = sampleLattice(metadata, 100);
  assert.deepEqual(first, second);
  assert(first.length <= 100);
  assert(
    first.every(({ x, z }: { x: number; z: number }) => x >= 0 && x <= 999 && z >= 0 && z <= 99),
  );
});

test('cartography metrics distinguish obstructing canopy from exposed surface', async () => {
  const { classifyTop, summarizeMeasurements } = await import(
    pathToFileURL(metricsModulePath).href
  );
  assert.equal(classifyTop('minecraft:oak_leaves'), 'tree');
  assert.equal(classifyTop('minecraft:stone_bricks'), 'exposed-solid');
  const summary = summarizeMeasurements([
    {
      topKind: 'tree',
      top: { y: 90, name: 'minecraft:oak_leaves' },
      ground: { y: 80, name: 'minecraft:grass_block' },
    },
    {
      topKind: 'exposed-solid',
      top: { y: 81, name: 'minecraft:stone' },
      ground: { y: 81, name: 'minecraft:stone' },
    },
  ]);
  assert.equal(summary.obstructingCanopyShare, 0.5);
  assert.equal(summary.severeCanopyShare, 0.5);
  assert.equal(summary.topShares['exposed-solid'], 0.5);
});
