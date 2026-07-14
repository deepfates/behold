import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const corePath = path.resolve(__dirname, '../../scripts/place-compiler/visit-candidate-core.mjs');

test('visit candidate keeps a measured spawn, chooses a useful ground leg, and reveals terrain', async () => {
  const { deriveVisitCandidate } = await import(pathToFileURL(corePath).href);
  const landmarks = [
    { id: 'park', name: 'Park', lat: 1, lon: 1, source: { category: 'leisure:park' } },
    { id: 'station', name: 'Station', lat: 1, lon: 2, source: { category: 'railway:station' } },
    { id: 'museum', name: 'Museum', lat: 1, lon: 3, source: { category: 'tourism:museum' } },
    { id: 'hill', name: 'Hill', lat: 1, lon: 4, source: { category: 'tourism:viewpoint' } },
  ];
  const checkpoint = (id: string, x: number, y: number) => ({
    id,
    projected: { x, z: 0 },
    representativeGround: { x, y, z: 0, headroom: true, classification: 'built' },
  });
  const result = deriveVisitCandidate(
    { geography: { spawn: { name: 'Park' } }, landmarks },
    {
      checkpoints: [
        checkpoint('park', 0, 4),
        checkpoint('station', 800, 10),
        checkpoint('museum', 500, 20),
        checkpoint('hill', 1200, 100),
      ],
    },
  );
  assert.equal(result.arrival.landmark.id, 'park');
  assert.equal(result.groundDestination.landmark.id, 'station');
  assert.equal(result.reveal.landmark.id, 'hill');
  const fallback = deriveVisitCandidate(
    { geography: { spawn: { name: 'Park' } }, landmarks },
    {
      checkpoints: [
        checkpoint('park', 0, 4),
        checkpoint('station', 800, 10),
        checkpoint('museum', 500, 20),
        checkpoint('hill', 1200, 100),
      ],
    },
    { rejectedDestinationIds: ['station'] },
  );
  assert.equal(fallback.groundDestination.landmark.id, 'museum');
});
