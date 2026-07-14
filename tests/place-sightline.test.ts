import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const modulePath = path.resolve(__dirname, '../../scripts/place-compiler/sightline-core.mjs');

test('voxel sightlines deduplicate cells and preserve physical distance', async () => {
  const { voxelLine } = await import(pathToFileURL(modulePath).href);
  const line = voxelLine({ x: 0.5, y: 64.5, z: 0.5 }, { x: 10.5, y: 64.5, z: 0.5 });
  assert.equal(line.distance, 10);
  assert.equal(line.points[0].x, 0);
  assert.equal(line.points.at(-1)?.x, 10);
  assert.equal(new Set(line.points.map((point: { x: number }) => point.x)).size, 11);
});

test('sightline summaries separate opaque and translucent evidence', async () => {
  const { summarizeSightline } = await import(pathToFileURL(modulePath).href);
  const line = { distance: 10 };
  const observations = [
    { distance: 1, block: 'stone', opaque: true, transparent: false, air: false },
    { distance: 4, block: 'glass', opaque: false, transparent: true, air: false },
    { distance: 6, block: 'stone', opaque: true, transparent: false, air: false },
  ];
  assert.deepEqual(summarizeSightline(line, observations), {
    distanceBlocks: 10,
    testedVoxelCount: 2,
    clear: false,
    firstOpaque: observations[2],
    opaqueVoxelCount: 1,
    translucentVoxelCount: 1,
    clearDistanceBlocks: 6,
  });
});
