import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const modulePath = path.resolve(__dirname, '../../scripts/place-compiler/quality-loop-core.mjs');

test('quality loop separates green acceptance from retained frontiers', async () => {
  const { evaluateQualityFixture } = await import(pathToFileURL(modulePath).href);
  const fixture = {
    placeId: 'place',
    experience: {
      arrival: {
        checkpointId: 'safe',
        acceptance: { minimumNativeTicks: 24000, maximumObserverDeaths: 0 },
      },
      checkpointOverrides: [
        { checkpointId: 'bridge', lat: 1, lon: 2, rationale: 'A sufficiently long rationale.' },
      ],
    },
  };
  const result = evaluateQualityFixture(
    fixture,
    {
      placeId: 'place',
      observationSite: { checkpointId: 'safe' },
      before: { gametime: 10 },
      after: { gametime: 24010 },
      observerLifecycle: { deathMessages: [] },
      assertions: { minecraftAuthoritative: true, nativeRulesEnabled: true },
      shutdown: { clean: true },
      findings: [{ id: 'honest-amber' }],
    },
    {
      placeId: 'place',
      checkpoints: [
        {
          id: 'bridge',
          latitude: 1,
          longitude: 2,
          representativeGround: { classification: 'built' },
        },
      ],
      defects: [],
    },
  );
  assert.equal(result.status, 'green');
  assert.equal(result.frontiers.length, 1);
});
