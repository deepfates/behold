import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBlockName, summarizeSurvey, type SurveySample } from '../src/skills/survey';

test('classifyBlockName emits compact terrain symbols', () => {
  assert.equal(classifyBlockName('grass_block'), '.');
  assert.equal(classifyBlockName('stone_bricks'), '#');
  assert.equal(classifyBlockName('oak_log'), 'T');
  assert.equal(classifyBlockName('oak_planks'), 'W');
  assert.equal(classifyBlockName('water'), '~');
});

test('summarizeSurvey builds a stable map and highlights elevation', () => {
  const samples: SurveySample[] = [
    { x: 0, z: 0, y: 0, block: 'grass_block' },
    { x: 1, z: 0, y: 0, block: 'grass_block' },
    { x: 2, z: 0, y: 6, block: 'stone_bricks' },
    { x: 0, z: 1, y: 0, block: 'water' },
    { x: 1, z: 1, y: 0, block: 'oak_planks' },
    { x: 2, z: 1, y: 0, block: 'oak_log' },
  ];
  const result = summarizeSurvey(samples, { x: 1, y: 1, z: 0 }, 2, 1);
  assert.deepEqual(result.map, ['..#', '~WT']);
  assert.equal(result.elevation.median, 0);
  assert.deepEqual(result.highPoints, [{ x: 2, z: 0, y: 6, block: 'stone_bricks' }]);
});
