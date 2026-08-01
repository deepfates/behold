import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { digestTree } from '../scripts/world-lab';
import { stagePlaceHistorySeed } from '../src/runtime/place-history-seed';

test('one verified unused history becomes only a fresh restartable Place runtime', async (t) => {
  const fixture = seedFixture(t);
  let validated = false;
  const record = await stagePlaceHistorySeed(fixture.input, {
    verifyFork: async () => fixture.verification as any,
    assertSourceContinuity: (() => fixture.continuity) as any,
    validateStagedRuntime(runtimeRoot) {
      validated = true;
      assert.equal(digestTree(path.join(runtimeRoot, 'world')).digest, fixture.worldDigest);
      assert.equal(fs.existsSync(path.join(runtimeRoot, 'runtime-manifest.json')), true);
    },
  });

  assert.equal(validated, true);
  assert.equal(record.historyId, 'gemma-semantic');
  assert.equal(record.checkpointDigest, fixture.worldDigest);
  assert.equal(digestTree(path.join(fixture.destination, 'world')).digest, fixture.worldDigest);
  assert.deepEqual(fs.readdirSync(fixture.destination).sort(), [
    'eula.txt',
    'ops.json',
    'runtime-manifest.json',
    'server.properties',
    'world',
  ]);
  assert.equal(fs.existsSync(path.join(fixture.destination, 'logs')), false);
  assert.equal(fs.existsSync(path.join(fixture.destination, 'usercache.json')), false);
  assert.equal(digestTree(fixture.sourceWorld).digest, fixture.worldDigest);
  assert.equal(digestTree(fixture.historyWorld).digest, fixture.worldDigest);
});

test('a failed Place preflight leaves no partial history-seeded runtime', async (t) => {
  const fixture = seedFixture(t);
  await assert.rejects(
    stagePlaceHistorySeed(fixture.input, {
      verifyFork: async () => fixture.verification as any,
      assertSourceContinuity: (() => fixture.continuity) as any,
      validateStagedRuntime() {
        throw new Error('fixture Place refusal');
      },
    }),
    /fixture Place refusal/,
  );
  assert.equal(fs.existsSync(fixture.destination), false);
  assert.equal(
    fs.readdirSync(path.dirname(fixture.destination)).some((name) => name.includes('history-seed')),
    false,
  );
  assert.equal(digestTree(fixture.sourceWorld).digest, fixture.worldDigest);
  assert.equal(digestTree(fixture.historyWorld).digest, fixture.worldDigest);
});

test('a previously diverged history is rejected before staging', async (t) => {
  const fixture = seedFixture(t);
  await assert.rejects(
    stagePlaceHistorySeed(fixture.input, {
      verifyFork: async () =>
        ({
          ...fixture.verification,
          histories: [
            {
              historyId: 'gemma-semantic',
              currentDigest: 'f'.repeat(64),
              diverged: true,
            },
          ],
        }) as any,
      assertSourceContinuity: (() => fixture.continuity) as any,
    }),
    /already diverged/,
  );
  assert.equal(fs.existsSync(fixture.destination), false);
});

function seedFixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-place-history-seed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceSession = path.join(root, 'source-session');
  const sourceRuntime = path.join(sourceSession, 'place-runtime');
  const sourceWorld = path.join(sourceRuntime, 'world');
  const historyWorld = path.join(root, 'histories', 'gemma-semantic', 'world');
  const releaseRoot = path.join(root, 'release');
  const serverJar = path.join(root, 'server.jar');
  for (const directory of [
    sourceWorld,
    historyWorld,
    releaseRoot,
    path.join(sourceSession, 'genesis'),
  ]) {
    fs.mkdirSync(path.join(directory, 'region'), { recursive: true });
  }
  fs.writeFileSync(path.join(sourceWorld, 'level.dat'), 'world level');
  fs.writeFileSync(path.join(sourceWorld, 'region', 'r.0.0.mca'), 'world region');
  fs.cpSync(sourceWorld, historyWorld, { recursive: true, force: true });
  const worldDigest = digestTree(sourceWorld).digest;
  const releaseDigest = 'a'.repeat(64);
  fs.writeFileSync(serverJar, 'server jar');
  const serverDigest = sha256File(serverJar);
  fs.writeFileSync(
    path.join(sourceRuntime, 'runtime-manifest.json'),
    `${JSON.stringify({
      schemaVersion: 2,
      kind: 'place-release-preview',
      profileId: 'living',
      world: 'world',
      sourceReleaseManifestSha256: releaseDigest,
      minecraftServerSha256: serverDigest,
    })}\n`,
  );
  fs.writeFileSync(
    path.join(sourceRuntime, 'server.properties'),
    'level-name=world\nonline-mode=false\n',
  );
  fs.writeFileSync(path.join(sourceRuntime, 'eula.txt'), 'eula=true\n');
  fs.writeFileSync(path.join(sourceRuntime, 'ops.json'), '[]\n');
  fs.mkdirSync(path.join(sourceRuntime, 'logs'));
  fs.writeFileSync(path.join(sourceRuntime, 'logs', 'server.log'), 'must not copy');
  fs.writeFileSync(path.join(sourceRuntime, 'usercache.json'), '[]\n');
  const descriptorFile = path.join(sourceSession, 'genesis', 'place-served-world.json');
  const headFile = path.join(sourceSession, 'head.json');
  fs.writeFileSync(descriptorFile, '{}\n');
  fs.writeFileSync(headFile, '{}\n');
  const history = {
    protocol: 'behold.minecraft-history.v1',
    historyId: 'gemma-semantic',
    label: 'Gemma semantic',
    purpose: 'One unsteered resident continuation.',
    checkpointArtifactId: `sha256-${worldDigest}`,
    checkpointDigest: worldDigest,
    digestProfile: 'behold.minecraft-tree-sha256.v1',
    initialDigest: worldDigest,
    worldPath: fs.realpathSync.native(historyWorld),
    archiveRoot: path.join(root, 'histories', 'gemma-semantic', 'archive'),
    materializedAt: '2026-08-01T00:00:00.000Z',
  };
  const receipt = {
    protocol: 'behold.minecraft-world-history.v1',
    operationId: 'model-perception-live-1',
    worldId: 'fixture-world',
    sourceEpoch: 3,
    checkpoint: {
      protocol: 'behold.minecraft-checkpoint.v1',
      artifactId: `sha256-${worldDigest}`,
      worldId: 'fixture-world',
      sourceEpoch: 3,
      sourceRuntimePath: fs.realpathSync.native(sourceWorld),
      digestProfile: 'behold.minecraft-tree-sha256.v1',
      digest: worldDigest,
      files: 2,
      directories: 2,
      bytes: 22,
      artifactPath: path.join(root, 'checkpoint', 'world'),
      capturedAt: '2026-08-01T00:00:00.000Z',
    },
    histories: [history],
    lineage: {
      loomId: 'fixture',
      file: path.join(root, 'fixture.lync'),
      sourceTurnId: 'source',
      checkpointTurnId: 'checkpoint',
      historyTurnIds: ['history'],
    },
    lifecycleJournal: path.join(root, 'lifecycle.jsonl'),
  };
  const receiptFile = path.join(root, 'receipt.json');
  fs.writeFileSync(receiptFile, `${JSON.stringify(receipt)}\n`);
  const descriptor = {
    worldId: 'fixture-world',
    origin: {
      profileId: 'living',
      sourceReleaseManifestSha256: releaseDigest,
      minecraftServerSha256: serverDigest,
    },
    paths: {
      release: fs.realpathSync.native(releaseRoot),
      runtimeRoot: fs.realpathSync.native(sourceRuntime),
      runtimeWorld: fs.realpathSync.native(sourceWorld),
    },
  };
  const continuity = {
    descriptor,
    world: {},
    head: { runtimeDigest: worldDigest },
    runtime: digestTree(sourceWorld),
  };
  const verification = {
    protocol: 'behold.minecraft-world-history-verification.v1',
    operationId: receipt.operationId,
    worldId: receipt.worldId,
    checkpointDigest: worldDigest,
    checkpointIntegrityOk: true,
    lineageIntegrityOk: true,
    lifecycleIntegrityOk: true,
    histories: [{ historyId: history.historyId, currentDigest: worldDigest, diverged: false }],
  };
  const destination = path.join(root, 'destination-session', 'place-runtime');
  return {
    input: {
      receiptFile,
      historyId: history.historyId,
      releaseRoot,
      serverJar,
      destinationRuntimeRoot: destination,
    },
    verification,
    continuity,
    destination,
    sourceWorld,
    historyWorld,
    worldDigest,
  };
}

function sha256File(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
