import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const modulePath = path.resolve(__dirname, '../../scripts/place-compiler/inspection-core.mjs');

test('surface classifications remain small and Minecraft-native', async () => {
  const { classifySurface } = await import(pathToFileURL(modulePath).href);
  assert.equal(classifySurface('water'), 'water');
  assert.equal(classifySurface('oak_leaves'), 'vegetation');
  assert.equal(classifySurface('gray_concrete'), 'built');
  assert.equal(classifySurface('dirt'), 'terrain');
  assert.equal(classifySurface('air'), 'air');
});

test('column and transect summaries separate evidence from judgment', async () => {
  const { summarizeColumns, summarizeTransect } = await import(pathToFileURL(modulePath).href);
  const columns = [
    { y: 64, block: 'stone', classification: 'built' },
    { y: 65, block: 'grass_block', classification: 'vegetation' },
    { y: 63, block: 'water', classification: 'water' },
    null,
  ];
  const summary = summarizeColumns(columns);
  assert.equal(summary.coverage, 0.75);
  assert.equal(summary.surfacedShare, 0.75);
  assert.equal(summary.surfaceRelief, 2);
  assert.equal(summary.classificationCounts.water, 1);
  const transect = summarizeTransect([
    { y: 64, classification: 'built', headroom: true },
    { y: 64, classification: 'built', headroom: true },
    { y: 66, classification: 'built', headroom: true },
  ]);
  assert.equal(transect.maximumObservedStep, 2);
  assert.equal(transect.directWalkabilityShare, 0.5);
});

test('defects preserve coordinates and qualify sparse evidence', async () => {
  const { deriveInspectionDefects } = await import(pathToFileURL(modulePath).href);
  const checkpoints = Array.from({ length: 4 }, (_, index) => ({
    id: `point-${index}`,
    name: index === 3 ? 'Bridge' : `Point ${index}`,
    latitude: 40 + index / 100,
    longitude: -74,
    projected: { x: index * 100, z: index * 200 },
    centerColumn: {
      y: 62,
      block: index === 3 ? 'water' : 'stone',
      classification: index === 3 ? 'water' : 'built',
      biome: { id: 40 },
    },
    representativeGround: index === 3 ? null : { y: 62, block: 'stone' },
    aerialColumnField: { surfacedShare: 1 },
  }));
  const defects = deriveInspectionDefects('test-place', checkpoints);
  assert.equal(defects.length, 2);
  assert.deepEqual(defects[0].location, {
    latitude: 40.03,
    longitude: -74,
    x: 300,
    z: 600,
  });
  assert.match(defects[1].qualification, /not a full-world biome census/);
});
