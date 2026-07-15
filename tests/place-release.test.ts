import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test('release archive requirements distinguish exact files, directories, and extensions', async () => {
  const modulePath = path.resolve(__dirname, '../../scripts/place-compiler/release-core.mjs');
  const { archiveMemberSatisfies } = await import(pathToFileURL(modulePath).href);
  assert.equal(archiveMemberSatisfies('Arnis World 1/level.dat', 'level.dat'), true);
  assert.equal(
    archiveMemberSatisfies('docs/place-compiler/places/sf.json', 'docs/place-compiler/places/'),
    true,
  );
  assert.equal(archiveMemberSatisfies('Arnis World 1/region/r.0.0.mca', '.mca'), true);
  assert.equal(archiveMemberSatisfies('Arnis World 1/region/r.0.0.mca.tmp', '.mca'), false);
  assert.equal(archiveMemberSatisfies('Arnis World 1/not-level.dat.bak', 'level.dat'), false);
});
