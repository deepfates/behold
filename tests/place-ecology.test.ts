import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Vec3 } from 'vec3';

const modulePath = path.resolve(__dirname, '../../scripts/place-compiler/ecology-core.mjs');

test('tick sprint evidence is parsed without inventing results', async () => {
  const { parseSprintCompletion } = await import(pathToFileURL(modulePath).href);
  assert.deepEqual(
    parseSprintCompletion('Sprint completed in 1200.5 ms (0.05 ms/tick, 19991.67 TPS)', 24000),
    {
      requestedTicks: 24000,
      wallMilliseconds: 1200.5,
      millisecondsPerTick: 0.05,
      effectiveTps: 19991.67,
      serverFormat: 'duration',
    },
  );
  assert.deepEqual(
    parseSprintCompletion('Sprint completed with 400 ticks per second, or 2.5 ms per tick', 24000),
    {
      requestedTicks: 24000,
      wallMilliseconds: 60000,
      millisecondsPerTick: 2.5,
      effectiveTps: 400,
      serverFormat: 'rate',
    },
  );
  assert.equal(parseSprintCompletion('sprint failed', 24000), null);
});

test('entity observations are bounded and turnover is explicit', async () => {
  const { summarizeEntities, summarizeTurnover } = await import(pathToFileURL(modulePath).href);
  const before = summarizeEntities(
    {
      1: { id: 1, name: 'player', type: 'player', position: new Vec3(0, 64, 0) },
      2: { id: 2, name: 'cow', type: 'mob', position: new Vec3(5, 64, 0) },
      3: { id: 3, name: 'zombie', type: 'mob', position: new Vec3(500, 64, 0) },
    },
    1,
    new Vec3(0, 64, 0),
    128,
  );
  const after = { ...before, total: 1, ids: [4] };
  assert.equal(before.total, 1);
  assert.deepEqual(before.byName, { cow: 1 });
  assert.deepEqual(summarizeTurnover(before, after), {
    appearedEntityIds: [4],
    disappearedEntityIds: [2],
    netEntityCount: 0,
  });
});

test('ecology findings retain survival failure location and scope', async () => {
  const { deriveEcologyFindings } = await import(pathToFileURL(modulePath).href);
  const before = {
    observer: { position: { x: 10, y: 64, z: 20 } },
    entities: { total: 1, byType: { animal: 1 } },
  };
  const after = {
    observer: { position: { x: 12, y: 64, z: 22 } },
    entities: { total: 40, byType: { hostile: 35, animal: 5 } },
  };
  const findings = deriveEcologyFindings('test-place', before, after, {
    deathMessages: ['Observer was slain by Zombie'],
  });
  assert.equal(findings.length, 2);
  assert.deepEqual(findings[0].location, before.observer.position);
  assert.match(findings[1].qualification, /not a world-wide mob census/);
});
