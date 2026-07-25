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
import { PLACE_V3_VERIFIER_REVISION, snapshotPlaceRelease } from '../scripts/place-release-v3';

const OXFORD_V3_RELEASE = process.env.BEHOLD_OXFORD_V3_RELEASE ?? '';
const OXFORD_V3_PRESERVATION = process.env.BEHOLD_OXFORD_V3_PRESERVATION ?? '';
const PLACE_COMPILER_ROOT = process.env.BEHOLD_PLACE_COMPILER_ROOT ?? '';
const OXFORD_SERVER_JAR = process.env.BEHOLD_OXFORD_SERVER_JAR ?? '';
const OXFORD_V3_INTEGRATION_ENABLED =
  process.env.BEHOLD_OXFORD_V3_INTEGRATION === '1' &&
  [OXFORD_V3_RELEASE, OXFORD_V3_PRESERVATION, PLACE_COMPILER_ROOT, OXFORD_SERVER_JAR].every(
    Boolean,
  );
const OXFORD_SERVER_SHA256 = '1066970b09e9c671844572291c4a871cc1ac2b85838bf7004fa0e778e10f1358';
const OXFORD_WORLD_SHA256 = '4160ae7e5a9c787bf727051f58dd147d96f52db33ad2a8ce0a6c440457acb91a';
const OXFORD_V3_EXPECTED = {
  placeId: 'oxford',
  runId: 'oxford-v1',
  artifactPreservationTreeSha256:
    '1cde506e1c2300db610d9111a8c36789eb970d8fc7a2e407403109d56167d48d',
  releaseManifestSha256: 'd9353e2481c3623483e19bd7790eafae754a3192a05df60ff4d269c68a692a46',
  releaseChecksumsSha256: '2e84931a46306c07f234d29af8898cbb2132caa6562dd5cec6a2015b969d5912',
  worldTreeSha256: OXFORD_WORLD_SHA256,
  archives: {
    'oxford-world-oxford-v1.tar.gz':
      '5d63e58f9dd6720560760c5be058270b7717f46424d31ed7818e681430af1a5b',
    'oxford-evidence-oxford-v1.tar.gz':
      'fd45c9d61c35acdd3ffd5d281d5bfa895634bed800549d64652d268262e93903',
    'oxford-reproduction-oxford-v1.tar.gz':
      '0e83393a5f1a636427985ef297c7c39485c2e8c5f0cc2284ed6d979563bee564',
    'oxford-inputs-oxford-v1.tar.gz':
      '34b931c77ebdd8e1dbbc92d48df2c995eca96a22f1310b1d036ce07901069cdc',
  },
  preservationSha256: 'f5e8ae6c23ddf4aa7f9abe53bcde2fd7a972c872af7519122528965cacbe1b73',
} as const;

test('Behold admits a verified Place release and binds both digest domains', (t) => {
  const fixture = makeReleaseFixture(t);
  const destination = path.join(fixture.root, 'admitted');
  const descriptor = admitPlaceRelease({
    releaseContract: 'legacy-v2-integrity-only',
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
  assert.equal(descriptor.place.releaseIdentity.contract, 'legacy-v2-integrity-only');
  assert.equal(descriptor.place.releaseIdentity.privacyEligibility, 'legacy-ineligible');
  assert.equal(descriptor.place.releaseIdentity.canonicalVerifier, null);
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
        releaseContract: 'legacy-v2-integrity-only',
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
    releaseContract: 'legacy-v2-integrity-only',
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
    releaseContract: 'legacy-v2-integrity-only',
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

test('failed materialization removes its private stage without touching a raced destination', (t) => {
  const fixture = makeReleaseFixture(t);
  const destination = path.join(fixture.root, 'raced-destination');
  const marker = path.join(destination, 'owner-marker');
  assert.throws(
    () =>
      admitPlaceRelease({
        releaseContract: 'legacy-v2-integrity-only',
        releaseRoot: fixture.release,
        profileId: 'living',
        destinationRoot: destination,
        serverJar: fixture.serverJar,
        expectedServerJarSha256: fixture.serverSha256,
        port: 25595,
        progress: (event) => {
          if (event.stage !== 'profile-materialization' || event.status !== 'completed') return;
          fs.mkdirSync(destination);
          fs.writeFileSync(marker, 'not Behold admission state\n');
        },
      }),
    /ENOTEMPTY|EEXIST/,
  );
  assert.equal(fs.readFileSync(marker, 'utf8'), 'not Behold admission state\n');
  assert.deepEqual(
    fs.readdirSync(fixture.root).filter((name) => name.startsWith('.raced-destination.stage-')),
    [],
  );
});

test('privacy-safe V3 admission fails clearly without the pinned canonical verifier', (t) => {
  const fixture = makeReleaseFixture(t);
  const receipt = path.join(fixture.root, 'preservation.json');
  fs.writeFileSync(receipt, '{}\n');
  fs.chmodSync(receipt, 0o444);
  const destination = path.join(fixture.root, 'must-not-exist');
  assert.throws(
    () =>
      admitPlaceRelease({
        releaseContract: 'privacy-safe-v3',
        releaseRoot: fixture.release,
        preservationFile: receipt,
        placeCompilerRoot: fixture.root,
        expectedRelease: OXFORD_V3_EXPECTED,
        profileId: 'living',
        destinationRoot: destination,
        serverJar: fixture.serverJar,
        expectedServerJarSha256: fixture.serverSha256,
        port: 25596,
      }),
    /canonical Place verifier is unavailable/,
  );
  assert.equal(fs.existsSync(destination), false);
});

test('privacy-safe V3 admission rejects a verifier checkout at another revision', (t) => {
  const fixture = makeReleaseFixture(t);
  const receipt = path.join(fixture.root, 'preservation.json');
  fs.writeFileSync(receipt, '{}\n');
  fs.chmodSync(receipt, 0o444);
  const compilerRoot = path.join(fixture.root, 'place-compiler');
  makeMismatchedPlaceCompiler(compilerRoot);
  const destination = path.join(fixture.root, 'must-not-exist-version');
  assert.throws(
    () =>
      admitPlaceRelease({
        releaseContract: 'privacy-safe-v3',
        releaseRoot: fixture.release,
        preservationFile: receipt,
        placeCompilerRoot: compilerRoot,
        expectedRelease: OXFORD_V3_EXPECTED,
        profileId: 'living',
        destinationRoot: destination,
        serverJar: fixture.serverJar,
        expectedServerJarSha256: fixture.serverSha256,
        port: 25597,
      }),
    /Canonical Place verifier revision mismatch/,
  );
  assert.equal(fs.existsSync(destination), false);
});

test(
  'exact mounted Oxford V3 release admits without source mutation and binds its epoch identity',
  { skip: !OXFORD_V3_INTEGRATION_ENABLED },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-oxford-v3-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const destination = path.join(root, 'admitted');
    const before = snapshotPlaceRelease(OXFORD_V3_RELEASE);
    const descriptor = admitPlaceRelease({
      releaseContract: 'privacy-safe-v3',
      releaseRoot: OXFORD_V3_RELEASE,
      preservationFile: OXFORD_V3_PRESERVATION,
      placeCompilerRoot: PLACE_COMPILER_ROOT,
      expectedRelease: OXFORD_V3_EXPECTED,
      profileId: 'living',
      destinationRoot: destination,
      serverJar: OXFORD_SERVER_JAR,
      expectedServerJarSha256: OXFORD_SERVER_SHA256,
      port: 25598,
    });

    assert.deepEqual(snapshotPlaceRelease(OXFORD_V3_RELEASE), before);
    assert.equal(descriptor.place.releaseIdentity.contract, 'privacy-safe-v3');
    assert.equal(descriptor.place.releaseIdentity.privacyEligibility, 'privacy-safe');
    assert.deepEqual(descriptor.place.releaseIdentity.canonicalVerifier, {
      revision: PLACE_V3_VERIFIER_REVISION,
      status: 'verified',
      releaseEligible: true,
      disclosureCount: 0,
    });
    assert.deepEqual(descriptor.place.releaseIdentity.source, {
      recipePath: 'release/place-recipe.json',
      recipeSha256: '9a07b39f69d859c3a82a6f45b2a71318974b0511f16c4e48ff85d00907c4a377',
      toolLockPath: 'docs/sf-world/tool-lock.json',
      toolLockSha256: 'f9041686dbc6bbb086353fd6f73266e2f368a315ece0a3bfecc5776884b9209f',
      inputSha256: '7626990aab76d71a242cb0481c1cf74eb966a49ae5afef207fa979d37251d4d7',
      worldTreeSha256: OXFORD_WORLD_SHA256,
      generatorBinarySha256: '4b50682348f6de2f1f63ba1e6be6eade96f5f4a6a9fed9b39dc28dec2bfce853',
    });
    assert.equal(descriptor.place.declaredWorldTreeSha256, OXFORD_WORLD_SHA256);
    assert.equal(descriptor.place.verifiedWorldTreeSha256, OXFORD_WORLD_SHA256);
    assert.equal(descriptor.worldId, `oxford-${descriptor.behold.epochIdentitySha256}`);
    assert.deepEqual(verifyAdmittedPlaceEpoch(destination), descriptor);

    const preservation = JSON.parse(fs.readFileSync(OXFORD_V3_PRESERVATION, 'utf8'));
    const evidence = JSON.stringify(descriptor);
    for (const privateCoordinate of [
      OXFORD_V3_RELEASE,
      OXFORD_V3_PRESERVATION,
      PLACE_COMPILER_ROOT,
      preservation.source,
      preservation.destination,
      preservation.compiler.repository,
    ]) {
      assert.equal(evidence.includes(privateCoordinate), false);
    }
    t.diagnostic(
      JSON.stringify({
        worldId: descriptor.worldId,
        releaseIdentitySha256: descriptor.place.releaseIdentitySha256,
        epochIdentitySha256: descriptor.behold.epochIdentitySha256,
        sourceTreeSha256: descriptor.behold.sourceTree.digest,
        baselineTreeSha256: descriptor.behold.baselineTree.digest,
      }),
    );
  },
);

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

function makeMismatchedPlaceCompiler(root: string) {
  const scripts = path.join(root, 'scripts', 'place-compiler');
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(
    path.join(scripts, 'verify-release.mjs'),
    'export function verifyRelease() {}\n',
  );
  fs.writeFileSync(path.join(scripts, 'release-core.mjs'), 'export const fixture = true;\n');
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    [
      '-c',
      'user.name=Behold Tests',
      '-c',
      'user.email=behold-tests@example.invalid',
      'commit',
      '-qm',
      'fixture verifier',
    ],
  ]) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  }
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
