import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(__dirname, '..', '..');
const generator = path.join(root, 'scripts/place-compiler/generate.mjs');
function dryRun(place: string) {
  const result = spawnSync(
    process.execPath,
    [
      generator,
      '--place',
      path.join(root, 'docs/place-compiler/places', place),
      '--run-id',
      'test-dry-run',
      '--dry-run',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('one place compiler emits both place commands and the same locked tool', () => {
  const sf = dryRun('san-francisco.json');
  const ny = dryRun('lower-manhattan.json');
  assert.equal(sf.place.id, 'san-francisco');
  assert.equal(ny.place.id, 'lower-manhattan');
  assert.equal(sf.generator.binarySha256, ny.generator.binarySha256);
  assert.equal(sf.command[sf.command.indexOf('--bbox') + 1], '37.707,-122.516,37.834,-122.349');
  assert.equal(ny.command[ny.command.indexOf('--bbox') + 1], '40.697,-74.021,40.721,-73.989');
  assert.equal(ny.command[ny.command.indexOf('--overture=false')], '--overture=false');
  assert.equal(sf.command[sf.command.indexOf('--cartography-policy') + 1], 'literal-v1');
});

test('living profile leaves ecology to Minecraft', () => {
  const living = dryRun('lower-manhattan.json').place.runtimeProfiles.living;
  assert.equal(living.policy.minecraftAuthoritative, true);
  assert.equal(living.policy.customEcologyRequired, false);
  assert.deepEqual(living.ecology, { daylightCycle: true, weatherCycle: true, mobSpawning: true });
});
