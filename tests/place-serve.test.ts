import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PLACE_SERVE_CONTROL_PROTOCOL,
  startFrozenPlaceServeAuthority,
  verifyPlaceServeTranscript,
} from '../src/runtime/place-serve';

const REVISION = '1'.repeat(40);

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

  const save: any = await authority.save('fixture_basis');
  assert.match(save.acknowledgement, /Saved the game/);
  await authority.unfreeze();
  await authority.freeze();
  const stopped = await authority.stop('fixture_complete');
  assert.equal(stopped.code, 0);

  const transcript = verifyPlaceServeTranscript(fixture.transcriptFile);
  const sent = transcript.events
    .filter((event: any) => event.direction === 'sent')
    .map((event: any) => JSON.parse(event.line));
  assert.deepEqual(
    sent.map((request: any) => request.command),
    ['freeze', 'save', 'unfreeze', 'freeze', 'stop'],
  );
  for (const request of sent) {
    assert.equal(request.protocol, PLACE_SERVE_CONTROL_PROTOCOL);
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

function makePlaceServeFixture(
  t: test.TestContext,
  options: { driftReadyWorldIdentity?: boolean } = {},
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
  return {
    runtimeRoot,
    transcriptFile,
    serverJarSha256,
    worldTreeSha256,
    input: {
      placeCompilerRoot: placeRoot,
      releaseRoot,
      runtimeRoot,
      profileId: 'living',
      transcriptFile,
      acceptEula: true as const,
      serverJar,
      expectedPlaceCompilerRevision: REVISION,
      startupTimeoutMs: 5_000,
    },
    dependencies: {
      inspectPlaceCheckout: () => ({ revision: REVISION, clean: true }),
      stderr: () => {},
    },
  };
}

function fixturePlaceServer(options: { driftReadyWorldIdentity: boolean }) {
  return `
    import fs from 'node:fs';
    import path from 'node:path';
    import { createHash } from 'node:crypto';
    import { createInterface } from 'node:readline';
    const protocol = 'place-compiler-serve-control/v1';
    const args = process.argv.slice(2);
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
