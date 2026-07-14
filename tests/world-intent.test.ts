import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const corePath = path.resolve(__dirname, '../../scripts/place-compiler/world-intent-core.mjs');

const intent = {
  schemaVersion: 1,
  id: 'example-place-v1',
  query: 'Example Place, California',
  purpose: 'Create a recognizable living city test fixture.',
  creativeDirection: 'Connect the civic center, terrain, and daily life.',
  requiredQualities: ['safe arrival'],
  budget: {
    targetAreaKm2: 16,
    maximumAreaKm2: 20,
    maximumSideBlocks: 5000,
    scaleBlocksPerMeter: 1,
    maximumGenerationMinutes: 120,
    maximumDiskGiB: 20,
  },
};

const candidate = {
  place_id: 1,
  osm_type: 'relation',
  osm_id: 2,
  lat: '37.87',
  lon: '-122.27',
  category: 'boundary',
  type: 'administrative',
  place_rank: 16,
  importance: 0.7,
  display_name: 'Example Place, California, United States',
  boundingbox: ['37.80', '37.94', '-122.36', '-122.18'],
  namedetails: { name: 'Example Place' },
};

test('world intent derives a bounded content-addressed place seed', async () => {
  const { buildPlaceSeed } = await import(pathToFileURL(corePath).href);
  const seed = buildPlaceSeed(intent, [candidate], {
    resolver: { name: 'fixture' },
    requestSha256: '1'.repeat(64),
    responseSha256: '2'.repeat(64),
    responsePath: 'resolution-response.json',
  });
  assert.match(seed.seedId, /^example-place-v1-[a-f0-9]{12}$/);
  assert.equal(seed.resolution.decision.semanticCallRequired, false);
  assert.ok(seed.geography.derivation.areaKm2 <= intent.budget.maximumAreaKm2);
  assert.ok(seed.geography.derivation.widthBlocks <= intent.budget.maximumSideBlocks);
  assert.ok(seed.geography.derivation.heightBlocks <= intent.budget.maximumSideBlocks);
  assert.deepEqual(seed.semanticDecisions, []);
});

test('world compilation history keeps selected and rejected branches', async (t) => {
  const historyPath = path.resolve(__dirname, '../../scripts/place-compiler/foundry-loom.mjs');
  const { createFoundryLoom, readFoundryHistory } = await import(pathToFileURL(historyPath).href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-foundry-loom-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let next = 0;
  const history = await createFoundryLoom(
    root,
    { intentId: 'fixture', intentSha256: 'a'.repeat(64) },
    { now: () => 1_700_000_000_000 + next, createId: () => `event-${++next}` },
  );
  const observed = await history.append({ kind: 'observation', value: 1 });
  const rejected = await history.branch(observed.id, { kind: 'proposal', value: 'rejected' });
  const selected = await history.append({ kind: 'proposal', value: 'selected' });
  history.close();
  const loaded = await readFoundryHistory(root);
  assert.deepEqual(
    loaded.turns.map((turn: { id: string }) => turn.id),
    [observed.id, selected.id],
  );
  assert.equal(loaded.manifest.tipTurnId, selected.id);
  assert.ok(!loaded.turns.some((turn: { id: string }) => turn.id === rejected.id));
  assert.equal(loaded.diagnostics.conflicts, 0);
  assert.equal(loaded.diagnostics.pending, 0);
});

test('world intent refuses invalid budgets and empty resolver evidence', async () => {
  const { buildPlaceSeed, validateWorldIntent } = await import(pathToFileURL(corePath).href);
  assert.throws(
    () => validateWorldIntent({ ...intent, budget: { ...intent.budget, targetAreaKm2: 30 } }),
    /target area cannot exceed maximum area/,
  );
  assert.throws(
    () =>
      buildPlaceSeed(intent, [], {
        resolver: { name: 'fixture' },
        requestSha256: '1'.repeat(64),
        responseSha256: '2'.repeat(64),
        responsePath: 'resolution-response.json',
      }),
    /resolver returned no candidates/,
  );
});
