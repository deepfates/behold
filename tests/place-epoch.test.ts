import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  admitPlaceRelease,
  PLACE_EPOCH_PROTOCOL,
  verifyAdmittedPlaceEpoch,
} from '../scripts/place-epoch';

test('Behold admits a verified Place release and binds both digest domains', (t) => {
  const fixture = makeReleaseFixture(t);
  const destination = path.join(fixture.root, 'admitted');
  const descriptor = admitPlaceRelease({
    releaseRoot: fixture.release,
    profileId: 'living',
    destinationRoot: destination,
    serverJar: fixture.serverJar,
    expectedServerJarSha256: fixture.serverSha256,
    port: 25591,
  });

  assert.equal(descriptor.protocol, PLACE_EPOCH_PROTOCOL);
  assert.equal(descriptor.place.id, 'fixture-place');
  assert.equal(descriptor.place.declaredWorldTreeSha256, fixture.worldTreeSha256);
  assert.equal(descriptor.place.verifiedWorldTreeSha256, fixture.worldTreeSha256);
  assert.match(descriptor.worldId, /^fixture-place-[a-f0-9]{16}$/);
  assert.notEqual(descriptor.behold.sourceTree.digest, descriptor.behold.baselineTree.digest);
  assert.equal(fs.readFileSync(path.join(destination, 'source', 'level.dat'), 'utf8'), 'world');
  assert.equal(
    fs.existsSync(
      path.join(
        destination,
        'baseline',
        'datapacks',
        'behold-place-profile',
        'data',
        'behold_place_profile',
        'function',
        'load.mcfunction',
      ),
    ),
    true,
  );
  assert.deepEqual(verifyAdmittedPlaceEpoch(destination), descriptor);
});

test('Behold refuses a release whose archive no longer matches checksum closure', (t) => {
  const fixture = makeReleaseFixture(t);
  fs.appendFileSync(path.join(fixture.release, fixture.worldArchive), 'tamper');
  assert.throws(
    () =>
      admitPlaceRelease({
        releaseRoot: fixture.release,
        profileId: 'living',
        destinationRoot: path.join(fixture.root, 'refused'),
        serverJar: fixture.serverJar,
        expectedServerJarSha256: fixture.serverSha256,
        port: 25592,
      }),
    /archive integrity failure/,
  );
});

test('admitted epoch verification detects baseline drift', (t) => {
  const fixture = makeReleaseFixture(t);
  const destination = path.join(fixture.root, 'admitted-drift');
  admitPlaceRelease({
    releaseRoot: fixture.release,
    profileId: 'living',
    destinationRoot: destination,
    serverJar: fixture.serverJar,
    expectedServerJarSha256: fixture.serverSha256,
    port: 25593,
  });
  fs.appendFileSync(path.join(destination, 'baseline', 'level.dat'), 'drift');
  assert.throws(() => verifyAdmittedPlaceEpoch(destination), /baseline tree digest mismatch/);
});

test('admitted epoch verification refuses descriptor paths outside its materialized root', (t) => {
  const fixture = makeReleaseFixture(t);
  const destination = path.join(fixture.root, 'admitted-path-tamper');
  admitPlaceRelease({
    releaseRoot: fixture.release,
    profileId: 'living',
    destinationRoot: destination,
    serverJar: fixture.serverJar,
    expectedServerJarSha256: fixture.serverSha256,
    port: 25594,
  });
  const descriptorFile = path.join(destination, 'place-epoch.json');
  const descriptor = JSON.parse(fs.readFileSync(descriptorFile, 'utf8'));
  descriptor.paths.runtime = path.join(fixture.root, 'some-other-world');
  fs.writeFileSync(descriptorFile, `${JSON.stringify(descriptor, null, 2)}\n`);
  assert.throws(
    () => verifyAdmittedPlaceEpoch(destination),
    /runtime path escapes or disagrees with its root/,
  );
});

function makeReleaseFixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-place-epoch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stage = path.join(root, 'stage');
  const world = path.join(stage, 'world', 'Fixture World');
  const evidence = path.join(stage, 'evidence');
  const reproduction = path.join(stage, 'reproduction');
  const release = path.join(root, 'release');
  for (const directory of [world, evidence, reproduction, release]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(path.join(world, 'level.dat'), 'world');
  fs.mkdirSync(path.join(world, 'region'));
  fs.writeFileSync(path.join(world, 'region', 'r.0.0.mca'), 'region');
  fs.writeFileSync(path.join(world, 'metadata.json'), '{}\n');
  const worldTreeSha256 = portableTreeDigest(world);
  const profile = {
    purpose: 'Fixture living profile',
    minecraft: {
      gameMode: 'survival',
      difficulty: 'normal',
      viewDistance: 12,
      simulationDistance: 10,
    },
    ecology: { daylightCycle: true, weatherCycle: true, mobSpawning: true },
  };
  fs.writeFileSync(
    path.join(evidence, 'generation-manifest.json'),
    `${JSON.stringify({
      status: 'generated',
      runId: 'fixture-run-v1',
      place: {
        id: 'fixture-place',
        recipeSha256: '1'.repeat(64),
        runtimeProfiles: { living: profile },
      },
      inputs: { sha256: '2'.repeat(64) },
    })}\n`,
  );
  fs.writeFileSync(path.join(reproduction, 'README.md'), 'fixture');
  const worldArchive = 'fixture-world.tar.gz';
  const evidenceArchive = 'fixture-evidence.tar.gz';
  const reproductionArchive = 'fixture-reproduction.tar.gz';
  tar(path.join(stage, 'world'), release, worldArchive, ['Fixture World']);
  tar(evidence, release, evidenceArchive, ['generation-manifest.json']);
  tar(reproduction, release, reproductionArchive, ['README.md']);
  const archives = [
    archiveRecord(release, 'immutable-world', worldArchive),
    archiveRecord(release, 'generation-evidence', evidenceArchive),
    archiveRecord(release, 'reproduction-kit', reproductionArchive),
  ];
  const manifest = {
    schemaVersion: 2,
    compiler: 'behold-place-compiler',
    placeId: 'fixture-place',
    placeName: 'Fixture Place',
    runId: 'fixture-run-v1',
    source: {
      recipeSha256: '1'.repeat(64),
      osmSha256: '2'.repeat(64),
      worldTreeSha256,
    },
    runtimeProfiles: ['living'],
    archives,
  };
  const manifestPath = path.join(release, 'release-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(
    path.join(release, 'SHA256SUMS'),
    `${[
      ...archives.map((archive) => `${archive.sha256}  ${archive.file}`),
      `${sha256File(manifestPath)}  release-manifest.json`,
    ].join('\n')}\n`,
  );
  const serverJar = path.join(root, 'server.jar');
  fs.writeFileSync(serverJar, 'pinned-server');
  return {
    root,
    release,
    serverJar,
    serverSha256: sha256File(serverJar),
    worldTreeSha256,
    worldArchive,
  };
}

function tar(cwd: string, output: string, name: string, entries: string[]) {
  const result = spawnSync(
    '/usr/bin/tar',
    ['-czf', path.join(output, name), '-C', cwd, ...entries],
    {
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) throw new Error(result.stderr);
}

function archiveRecord(root: string, role: string, file: string) {
  const absolute = path.join(root, file);
  return { role, file, sizeBytes: fs.statSync(absolute).size, sha256: sha256File(absolute) };
}

function portableTreeDigest(root: string) {
  const files: string[] = [];
  const visit = (directory: string, relative: string) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const portable = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(directory, entry.name), portable);
      else files.push(portable);
    }
  };
  visit(root, '');
  const hash = createHash('sha256');
  for (const relative of files) {
    const file = path.join(root, ...relative.split('/'));
    hash.update(`${sha256File(file)}  ${fs.statSync(file).size}  ${relative}\n`);
  }
  return hash.digest('hex');
}

function sha256File(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
