import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const modulePath = path.resolve(__dirname, '../../scripts/place-compiler/capacity-core.mjs');

test('capacity plans keep causal axes explicit and every region embodied', async () => {
  const { validateCapacityPlan } = await import(pathToFileURL(modulePath).href);
  const fixture = { checkpoints: [{ id: 'a' }, { id: 'b' }] };
  assert.throws(
    () =>
      validateCapacityPlan(
        {
          schemaVersion: 1,
          entity: { type: 'minecraft:villager', ai: true, spacingBlocks: 1 },
          regionCheckpointIds: ['a', 'b'],
          cases: [
            {
              id: 'bad',
              activeRegions: 2,
              protocolBodies: 1,
              nativeEntities: 0,
              sprintTicks: 1000,
            },
            {
              id: 'other',
              activeRegions: 1,
              protocolBodies: 1,
              nativeEntities: 0,
              sprintTicks: 1000,
            },
          ],
        },
        fixture,
      ),
    /must keep every region embodied/,
  );
});

test('capacity summaries are lower bounds and never inhabitant claims', async () => {
  const { simulationChunkCount, summarizeCapacity } = await import(pathToFileURL(modulePath).href);
  assert.equal(simulationChunkCount([{ x: 0, z: 0 }], 1), 9);
  assert.equal(
    simulationChunkCount(
      [
        { x: 0, z: 0 },
        { x: 1600, z: 0 },
      ],
      1,
    ),
    18,
  );
  const summary = summarizeCapacity([
    {
      caseId: 'stable',
      axes: { activeRegions: 3, protocolBodies: 16, nativeEntities: 512 },
      classification: { stable: true },
    },
  ]);
  assert.equal(summary.demonstratedStableLowerBounds.protocolBodies, 16);
  assert.equal(summary.demonstratedStableLowerBounds.nativeEntities, 512);
  assert.equal('activeAiEntities' in summary.demonstratedStableLowerBounds, false);
  assert.match(summary.claimBoundary, /not Behold inhabitants/);
});
