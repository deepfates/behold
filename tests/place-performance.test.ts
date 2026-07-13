import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const modulePath = path.resolve(__dirname, '../../scripts/place-compiler/performance-core.mjs');

function measurement(profileId: string, repetition: number, tps: number, clean = true) {
  return {
    placeId: 'test-place',
    profileId,
    repetition,
    serverStartupMilliseconds: 1000,
    sprint: { effectiveTps: tps, observedWallMilliseconds: 2000 },
    process: { peakRssBytes: 1024 * repetition },
    shutdown: { clean },
  };
}

test('performance stability requires realtime headroom and clean shutdown', async () => {
  const { classifyCase } = await import(pathToFileURL(modulePath).href);
  assert.deepEqual(classifyCase(measurement('living', 1, 100), 180), {
    stable: true,
    reasons: [],
    realtimeHeadroom: 5,
  });
  assert.deepEqual(classifyCase(measurement('living', 1, 10, false), 180), {
    stable: false,
    reasons: ['unclean-shutdown', 'below-realtime-tps'],
    realtimeHeadroom: 0.5,
  });
});

test('performance summaries retain named operating points and repetitions', async () => {
  const { summarizePerformance } = await import(pathToFileURL(modulePath).href);
  const cases = [measurement('living', 1, 80), measurement('living', 2, 120)];
  const profiles = { living: { minecraft: { simulationDistance: 12 } } };
  const [summary] = summarizePerformance(cases, profiles, 180);
  assert.equal(summary.medianEffectiveTps, 100);
  assert.equal(summary.minimumRealtimeHeadroom, 4);
  assert.deepEqual(summary.operatingPoint, profiles.living);
  assert.equal(summary.repetitions, 2);
});
