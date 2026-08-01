import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PLACE_SERVE_CONTROL_PROTOCOL,
  preflightFrozenPlaceServeAuthority,
  startFrozenPlaceServeAuthority,
  verifyPlaceServeTranscript,
} from '../src/runtime/place-serve';

const REVISION = '1'.repeat(40);
const PACKAGE_VERSION = '0.1.0-alpha.0';
const PACKAGE_DIGEST = '2'.repeat(64);

test('Place served-release preflight proves admission without creating runtime state', (t) => {
  const fixture = makePlaceServeFixture(t);
  const { transcriptFile: _transcriptFile, ...input } = fixture.input;
  let spawnCalls = 0;
  const evidence = preflightFrozenPlaceServeAuthority(input, {
    ...fixture.dependencies,
    spawn: (() => {
      spawnCalls += 1;
      throw new Error('preflight must not spawn');
    }) as any,
  });

  assert.equal(evidence.placeCompilerRevision, REVISION);
  assert.equal(evidence.sourceWorldTreeSha256, fixture.worldTreeSha256);
  assert.equal(evidence.minecraftServerSha256, fixture.serverJarSha256);
  assert.equal(spawnCalls, 0);
  assert.equal(fs.existsSync(fixture.transcriptFile), false);
  assert.equal(fs.existsSync(fixture.runtimeRoot), false);
});

test('Place served-release preflight rejects identity drift without durable state', (t) => {
  const fixture = makePlaceServeFixture(t);
  const { transcriptFile: _transcriptFile, ...input } = fixture.input;
  assert.throws(
    () =>
      preflightFrozenPlaceServeAuthority(input, {
        ...fixture.dependencies,
        inspectPlaceCheckout: () => ({ revision: 'f'.repeat(40), clean: true }),
      }),
    (error: any) => {
      assert.equal(error.code, 'place_serve_revision_mismatch');
      return true;
    },
  );
  assert.equal(fs.existsSync(fixture.transcriptFile), false);
  assert.equal(fs.existsSync(fixture.runtimeRoot), false);
});

test('Place served-release adapter binds exact identity and acknowledged lifecycle', async (t) => {
  const fixture = makePlaceServeFixture(t);
  const authority = await startFrozenPlaceServeAuthority(fixture.input, fixture.dependencies);
  t.after(async () => {
    try {
      await authority.stop('test_fixture_cleanup');
    } catch {}
  });

  assert.equal(authority.authorityPid > 0, true);
  assert.equal(authority.serverPid, authority.authorityPid + 10_000);
  assert.equal(authority.initialTickState, 'frozen');
  assert.equal(authority.placeCompilerRevision, REVISION);
  assert.equal(authority.placeIdentity.sourceWorldTreeSha256, fixture.worldTreeSha256);
  assert.equal(authority.placeIdentity.minecraftServerSha256, fixture.serverJarSha256);
  assert.equal(
    authority.runtimeWorldPath,
    fs.realpathSync.native(path.join(fixture.runtimeRoot, 'world')),
  );

  const status: any = await authority.status();
  assert.deepEqual(status.state, { lifecycle: 'ready', ticks: 'frozen' });
  const save: any = await authority.save('fixture_basis');
  assert.match(save.acknowledgement, /Saved the game/);
  await authority.unfreeze();
  await authority.freeze();
  const stopped = await authority.stop('fixture_complete');
  assert.equal(stopped.exit.code, 0);
  assert.match(String(stopped.saveAcknowledgement), /Saved the game/);

  const transcript = verifyPlaceServeTranscript(fixture.transcriptFile);
  const sent = transcript.events
    .filter((event: any) => event.direction === 'sent')
    .map((event: any) => JSON.parse(event.line));
  assert.deepEqual(
    sent.map((request: any) => request.command),
    ['freeze', 'status', 'save', 'unfreeze', 'freeze', 'stop'],
  );
  for (const request of sent) {
    assert.equal(request.protocol, PLACE_SERVE_CONTROL_PROTOCOL);
    if (request.command === 'status') {
      assert.equal('expect' in request, false);
      continue;
    }
    assert.deepEqual(Object.keys(request.expect).sort(), [
      'minecraftServerSha256',
      'runtimeManifestSha256',
      'sourceReleaseManifestSha256',
      'sourceWorldTreeSha256',
    ]);
  }
  const received = transcript.events
    .filter((event: any) => event.direction === 'received')
    .map((event: any) => JSON.parse(event.line));
  assert.deepEqual(
    received.slice(0, 2).map((event: any) => event.event),
    ['prepared', 'ready'],
  );
  assert.equal(received.at(-1).event, 'stopped');
});

test('Place served-release adapter fails closed on ready identity drift', async (t) => {
  const fixture = makePlaceServeFixture(t, { driftReadyWorldIdentity: true });
  await assert.rejects(
    startFrozenPlaceServeAuthority(fixture.input, fixture.dependencies),
    (error: any) => {
      assert.equal(error.code, 'place_serve_protocol_invalid');
      assert.match(error.message, /release or server bytes/);
      return true;
    },
  );
  const transcript = verifyPlaceServeTranscript(fixture.transcriptFile);
  assert.deepEqual(
    transcript.events
      .filter((event: any) => event.direction === 'received')
      .map((event: any) => JSON.parse(event.line).event),
    ['prepared', 'ready'],
  );
  assert.equal(
    transcript.events.some((event: any) => event.direction === 'sent'),
    false,
  );
});

test('Place served-release adapter preflights and runs an exact installed binary', async (t) => {
  const fixture = makePlaceServeFixture(t, { installed: true });
  const authority = await startFrozenPlaceServeAuthority(fixture.input, fixture.dependencies);
  t.after(async () => {
    try {
      await authority.stop('test_fixture_cleanup');
    } catch {}
  });
  assert.equal(
    authority.placeCompilerRevision,
    `npm:place-compiler@${PACKAGE_VERSION}#${PACKAGE_DIGEST}`,
  );
  assert.equal(authority.placeIdentity.sourceWorldTreeSha256, fixture.worldTreeSha256);
  const stopped = await authority.stop('installed_fixture_complete');
  assert.equal(stopped.exit.code, 0);
});

test('Place served-release adapter rejects installed package identity drift before serving', async (t) => {
  const fixture = makePlaceServeFixture(t, { installed: true });
  await assert.rejects(
    startFrozenPlaceServeAuthority(
      {
        ...fixture.input,
        expectedPlaceCompilerPackage: {
          name: 'place-compiler',
          version: PACKAGE_VERSION,
          distributionSha256: '3'.repeat(64),
        },
      },
      fixture.dependencies,
    ),
    (error: any) => {
      assert.equal(error.code, 'place_serve_package_identity_mismatch');
      return true;
    },
  );
  assert.equal(fs.existsSync(fixture.transcriptFile), false);
  assert.equal(fs.existsSync(fixture.runtimeRoot), false);
});

function makePlaceServeFixture(
  t: test.TestContext,
  options: { driftReadyWorldIdentity?: boolean; installed?: boolean } = {},
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-place-serve-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const placeRoot = path.join(root, 'place');
  const releaseRoot = path.join(root, 'release');
  const runtimeRoot = path.join(root, 'runtime');
  const transcriptFile = path.join(root, 'session', 'place-control.jsonl');
  const placeEntry = path.join(placeRoot, 'scripts', 'place-compiler', 'place.mjs');
  const serverJar = path.join(root, 'server.jar');
  fs.mkdirSync(path.dirname(placeEntry), { recursive: true });
  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.writeFileSync(serverJar, 'fixture minecraft server');
  const serverJarSha256 = sha256File(serverJar);
  const worldTreeSha256 = 'b'.repeat(64);
  fs.writeFileSync(
    path.join(releaseRoot, 'release-manifest.json'),
    `${JSON.stringify({ schemaVersion: 3, source: { worldTreeSha256 } })}\n`,
  );
  fs.writeFileSync(
    placeEntry,
    fixturePlaceServer({ driftReadyWorldIdentity: Boolean(options.driftReadyWorldIdentity) }),
  );
  fs.chmodSync(placeEntry, 0o755);
  const compilerInput = options.installed
    ? {
        placeCompilerBinary: placeEntry,
        expectedPlaceCompilerPackage: {
          name: 'place-compiler',
          version: PACKAGE_VERSION,
          distributionSha256: PACKAGE_DIGEST,
        },
      }
    : {
        placeCompilerRoot: placeRoot,
        expectedPlaceCompilerRevision: REVISION,
      };
  return {
    runtimeRoot,
    transcriptFile,
    serverJarSha256,
    worldTreeSha256,
    input: {
      ...compilerInput,
      releaseRoot,
      runtimeRoot,
      profileId: 'living',
      transcriptFile,
      acceptEula: true as const,
      serverJar,
      startupTimeoutMs: 5_000,
    },
    dependencies: {
      inspectPlaceCheckout: () => ({ revision: REVISION, clean: true }),
      stderr: () => {},
    },
  };
}

function fixturePlaceServer(options: { driftReadyWorldIdentity: boolean }) {
  return `#!/usr/bin/env node
    import fs from 'node:fs';
    import path from 'node:path';
    import { createHash } from 'node:crypto';
    import { createInterface } from 'node:readline';
    const protocol = 'place-compiler-serve-control/v1';
    const args = process.argv.slice(2);
    if (args[0] === 'version' && args[1] === '--json') {
      process.stdout.write(JSON.stringify({
        name: 'place-compiler',
        version: '${PACKAGE_VERSION}',
        distributionSha256: '${PACKAGE_DIGEST}',
        serveControlProtocol: protocol,
        releaseSchemaVersion: 3,
      }) + '\\n');
      process.exit(0);
    }
    const value = (name) => args[args.indexOf(name) + 1];
    if (args[0] !== 'serve' || !args.includes('--accept-eula') || !args.includes('--control-jsonl')) process.exit(7);
    const releasePath = path.resolve(args[1]);
    const runtimePath = path.resolve(value('--runtime'));
    const serverJar = path.resolve(value('--server-jar'));
    const profileId = value('--profile');
    fs.mkdirSync(path.join(runtimePath, 'world'), { recursive: true });
    const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const manifest = JSON.parse(fs.readFileSync(path.join(releasePath, 'release-manifest.json')));
    const runtimeManifest = {
      schemaVersion: 2,
      kind: 'place-release-preview',
      placeId: 'fixture-place',
      sourceRunId: 'fixture-release-v3',
      sourceReleaseManifestSha256: sha(path.join(releasePath, 'release-manifest.json')),
      sourceWorldTreeSha256: manifest.source.worldTreeSha256,
      minecraftServerSha256: sha(serverJar),
      minecraftVersion: '1.21.4',
      profileId,
      port: 25565,
      world: 'world',
    };
    fs.writeFileSync(path.join(runtimePath, 'runtime-manifest.json'), JSON.stringify(runtimeManifest));
    const identity = {
      placeId: 'fixture-place',
      placeName: 'Fixture Place',
      sourceRunId: 'fixture-release-v3',
      sourceReleaseManifestSha256: sha(path.join(releasePath, 'release-manifest.json')),
      sourceWorldTreeSha256: manifest.source.worldTreeSha256,
      minecraftServerSha256: sha(serverJar),
      runtimeManifestSha256: sha(path.join(runtimePath, 'runtime-manifest.json')),
      minecraftVersion: '1.21.4',
      profileId,
      releasePath,
      runtimePath,
      endpoint: { host: '127.0.0.1', port: 25565 },
      processes: { controlPid: process.pid, javaPid: null },
    };
    const emit = (event) => process.stdout.write(JSON.stringify({ protocol, at: new Date().toISOString(), ...event }) + '\\n');
    emit({ event: 'prepared', identity, state: { lifecycle: 'prepared', ticks: 'unknown' } });
    identity.processes.javaPid = process.pid + 10000;
    const readyIdentity = ${options.driftReadyWorldIdentity ? `{ ...identity, sourceWorldTreeSha256: '${'f'.repeat(64)}' }` : 'identity'};
    emit({ event: 'ready', identity: readyIdentity, state: { lifecycle: 'ready', ticks: 'running' } });
    let ticks = 'running';
    const lines = createInterface({ input: process.stdin, terminal: false });
    lines.on('line', (line) => {
      const request = JSON.parse(line);
      if (request.command === 'freeze') ticks = 'frozen';
      if (request.command === 'unfreeze') ticks = 'running';
      const stopping = request.command === 'stop';
      emit({
        event: 'command_terminal',
        requestId: request.requestId,
        command: request.command,
        ok: true,
        identity,
        state: { lifecycle: stopping ? 'stopped' : 'ready', ticks },
        acknowledgement: request.command === 'save' || stopping ? '[Server thread/INFO]: Saved the game' : '[Server thread/INFO]: game is ' + ticks,
      });
      if (stopping) {
        emit({ event: 'stopped', identity, state: { lifecycle: 'stopped', ticks }, java: { pid: identity.processes.javaPid, cleanExit: true, exitCode: 0 } });
        process.exit(0);
      }
    });
    process.stdin.on('end', () => process.exit(0));
  `;
}

function sha256File(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
