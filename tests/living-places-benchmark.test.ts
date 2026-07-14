import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = path.resolve(__dirname, '..', '..');
const benchmarkCli = path.join(repositoryRoot, 'scripts/place-compiler/benchmark.mjs');
const benchmarkPath = path.join(
  repositoryRoot,
  'docs/place-compiler/benchmarks/living-places-v1.json',
);

test('Living Places v1 binds both immutable fixtures and keeps a score vector', () => {
  const result = spawnSync(process.execPath, [benchmarkCli, benchmarkPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.status, 'ready');
  assert.deepEqual(
    plan.fixtures.map((fixture: { placeId: string }) => fixture.placeId),
    ['san-francisco', 'lower-manhattan'],
  );
  assert.deepEqual(plan.dimensions, [
    'correspondence',
    'legibility',
    'habitability',
    'ecology',
    'experience',
    'capacity',
  ]);
  assert.equal(plan.profiles.living.policy.minecraftAuthoritative, true);
  assert.equal(plan.profiles.living.policy.customEcologyRequired, false);
  assert.equal(plan.execution.ecologySoak.sprintTicks, 24000);
  assert.ok(
    plan.fixtures.every((fixture: { checkpoints: unknown[] }) => fixture.checkpoints.length >= 4),
  );
});

test('Living Places v2 binds independently versioned experience policy', () => {
  const result = spawnSync(
    process.execPath,
    [
      benchmarkCli,
      path.join(repositoryRoot, 'docs/place-compiler/benchmarks/living-places-v2.json'),
    ],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.benchmarkId, 'living-places-v2');
  assert.deepEqual(
    plan.fixtures.map(
      (fixture: { experience: { arrival: { checkpointId: string } } }) =>
        fixture.experience.arrival.checkpointId,
    ),
    ['civic-center', 'city-hall'],
  );
  const bridge = plan.fixtures[1].checkpoints.find(
    (checkpoint: { id: string }) => checkpoint.id === 'brooklyn-bridge',
  );
  assert.equal(bridge.experienceOverride, true);
  assert.equal(bridge.sourceLat, 40.7069);
});

test('Living Places v3 adds a global-elevation canal city without changing the contract', () => {
  const result = spawnSync(
    process.execPath,
    [
      benchmarkCli,
      path.join(repositoryRoot, 'docs/place-compiler/benchmarks/living-places-v3.json'),
    ],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(
    plan.fixtures.map((fixture: { placeId: string }) => fixture.placeId),
    ['san-francisco', 'lower-manhattan', 'venice-core'],
  );
  assert.equal(plan.fixtures[2].experience.arrival.checkpointId, 'rialto-bridge');
  assert.equal(plan.fixtures[2].worldTreeSha256.length, 64);
});

test('Living Places refuses a benchmark that drops a telos dimension', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'living-places-'));
  try {
    const benchmark = JSON.parse(readFileSync(benchmarkPath, 'utf8'));
    benchmark.dimensions = benchmark.dimensions.filter((item: string) => item !== 'habitability');
    const invalid = path.join(temporary, 'invalid.json');
    writeFileSync(invalid, JSON.stringify(benchmark));
    const result = spawnSync(process.execPath, [benchmarkCli, invalid], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /score vector is missing a required dimension/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
