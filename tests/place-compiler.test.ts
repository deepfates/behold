import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = path.resolve(__dirname, '..', '..');
const generator = path.join(repositoryRoot, 'scripts/place-compiler/generate.mjs');
const places = path.join(repositoryRoot, 'docs/place-compiler/places');

function dryRun(place: string) {
  const result = spawnSync(
    process.execPath,
    [generator, '--place', path.join(places, place), '--run-id', 'test-dry-run', '--dry-run'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('place recipes compile through one generator without place-specific core arguments', () => {
  const sanFrancisco = dryRun('san-francisco.json');
  const lowerManhattan = dryRun('lower-manhattan.json');
  assert.equal(sanFrancisco.compiler.name, 'behold-place-compiler');
  assert.equal(lowerManhattan.compiler.name, 'behold-place-compiler');
  assert.equal(sanFrancisco.place.id, 'san-francisco');
  assert.equal(lowerManhattan.place.id, 'lower-manhattan');
  assert.equal(sanFrancisco.generator.binarySha256, lowerManhattan.generator.binarySha256);
  assert.deepEqual(Object.keys(sanFrancisco.place.runtimeProfiles), [
    'cinematic',
    'playable',
    'living',
  ]);
  assert.deepEqual(Object.keys(lowerManhattan.place.runtimeProfiles), [
    'cinematic',
    'playable',
    'living',
  ]);
  const sfBbox = sanFrancisco.command[sanFrancisco.command.indexOf('--bbox') + 1];
  const nyBbox = lowerManhattan.command[lowerManhattan.command.indexOf('--bbox') + 1];
  assert.equal(sfBbox, '37.707,-122.516,37.834,-122.349');
  assert.equal(nyBbox, '40.697,-74.021,40.721,-73.989');
  assert.equal(
    sanFrancisco.command.some((argument: string) =>
      argument.toLowerCase().includes('sanfrancisco'),
    ),
    false,
  );
});

test('place recipe validation rejects geographic claims outside the generated bounds', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'place-compiler-'));
  try {
    const recipe = JSON.parse(readFileSync(path.join(places, 'lower-manhattan.json'), 'utf8'));
    recipe.landmarks[0].lat = 41;
    const recipePath = path.join(root, 'invalid.json');
    writeFileSync(recipePath, JSON.stringify(recipe));
    const result = spawnSync(process.execPath, [generator, '--place', recipePath, '--dry-run'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /landmark one-world-trade is outside bounds/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('living runtime profile keeps Minecraft authoritative', () => {
  const lowerManhattan = dryRun('lower-manhattan.json');
  const living = lowerManhattan.place.runtimeProfiles.living;
  assert.equal(living.policy.minecraftAuthoritative, true);
  assert.equal(living.policy.customEcologyRequired, false);
  assert.deepEqual(living.ecology, {
    daylightCycle: true,
    weatherCycle: true,
    mobSpawning: true,
  });
});
