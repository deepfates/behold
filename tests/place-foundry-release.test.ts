import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const contract = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../docs/place-compiler/releases/living-city-foundry-v2.json'),
    'utf8',
  ),
);

test('Foundry release binds one benchmark closure across three distinct places', () => {
  assert.equal(contract.kind, 'living-city-foundry-release-contract');
  assert.equal(contract.benchmarkId, 'living-places-v3');
  const places = ['san-francisco', 'lower-manhattan', 'venice-core'];
  assert.deepEqual(
    contract.placePackages.map((item: { placeId: string }) => item.placeId),
    places,
  );
  assert.deepEqual(
    contract.humanVisits.map((item: { placeId: string }) => item.placeId),
    places,
  );
  assert.equal(
    contract.humanVisits.filter((item: { captureRequired: boolean }) => item.captureRequired)
      .length,
    1,
  );
});

test('Foundry release records content identities and honest bounded frontiers', () => {
  const anchors = [
    contract.evidenceSet,
    contract.beholdEpochProof,
    ...contract.humanVisits,
    ...contract.capacity,
  ];
  assert.ok(anchors.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.ok(
    contract.placePackages.every(
      (item) =>
        /^[a-f0-9]{64}$/.test(item.manifestSha256) && /^[a-f0-9]{64}$/.test(item.checksumsSha256),
    ),
  );
  assert.ok(contract.frontiers.length >= 6);
});
