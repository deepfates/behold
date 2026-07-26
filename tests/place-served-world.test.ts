import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digestTree } from '../scripts/world-lab';
import {
  PLACE_SERVED_WORLD_PROTOCOL,
  assertPlaceServedAuthority,
  assertPlaceServedResumeContinuity,
  establishPlaceServedWorldBasis,
  recordPlaceServedWorldHead,
  verifyPlaceServedWorldBasis,
} from '../src/runtime/place-served-world';
import { acquireWorldControl } from '../src/runtime/world-control';
import type { FrozenPlaceServeAuthority, PlaceServeIdentity } from '../src/runtime/place-serve';

test('a frozen saved Place runtime becomes one immutable Behold adoption basis and clean resume head', (t) => {
  const fixture = makeFixture(t);
  const established = establishPlaceServedWorldBasis(
    {
      sessionRoot: fixture.sessionRoot,
      authority: fixture.authority,
      saveEvidence: fixture.saveTerminal,
    },
    { assertAuthorityOwnership: () => {} },
  );

  assert.equal(established.descriptor.protocol, PLACE_SERVED_WORLD_PROTOCOL);
  assert.equal(
    established.descriptor.origin.sourceWorldTreeSha256,
    fixture.identity.sourceWorldTreeSha256,
  );
  assert.notEqual(
    established.descriptor.origin.sourceWorldTreeSha256,
    established.descriptor.adoptionBasis.runtimeDigest,
  );
  assert.equal(
    fs.existsSync(path.join(established.descriptor.paths.source, 'session.lock')),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(established.descriptor.paths.preparedBaseline, 'session.lock')),
    false,
  );
  assert.equal(fs.existsSync(path.join(fixture.runtimeWorld, 'session.lock')), true);
  assert.equal(
    digestTree(established.descriptor.paths.source).digest,
    digestTree(established.descriptor.paths.preparedBaseline).digest,
  );
  assert.equal(
    fs.statSync(path.join(established.descriptor.paths.source, 'level.dat')).mode & 0o222,
    0,
  );

  const verified = verifyPlaceServedWorldBasis(established.descriptor.paths.descriptor);
  assert.equal(verified.descriptor.worldId, established.descriptor.worldId);
  assert.equal(
    assertPlaceServedAuthority(verified.descriptor, fixture.authority),
    fixture.authority,
  );
  const initial = assertPlaceServedResumeContinuity(
    established.descriptor.paths.descriptor,
    fixture.headFile,
  );
  assert.equal(initial.head, null);
  assert.equal(initial.runtime.digest, established.descriptor.adoptionBasis.runtimeDigest);

  fs.writeFileSync(path.join(fixture.runtimeWorld, 'resident-built.txt'), 'persistent consequence');
  const control = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: established.descriptor.worldId,
    runtimePath: fixture.runtimeWorld,
  });
  const jarSha256 = fixture.identity.minecraftServerSha256;
  control.update('starting', { server: { pid: process.pid, jarSha256 } });
  control.update('running');
  control.update('stopping');
  const terminalWorldState = {
    protocol: 'behold.managed-terminal-world-state.v1',
    runtime: control.record().runtime,
    tree: digestTree(fixture.runtimeWorld),
  };
  const terminal = control.append('run_terminal_world_state', terminalWorldState);
  control.update('stopped_verified', { server: null, controllers: [] });
  control.append('run_stopped', { reason: 'fixture_complete', terminalWorldState });
  const lifecycleFile = control.journalFile;
  control.release();

  const head = recordPlaceServedWorldHead({
    descriptorFile: established.descriptor.paths.descriptor,
    lifecycleFile,
    headFile: fixture.headFile,
  });
  assert.equal(head.lifecycle.terminalSequence, terminal.sequence);
  const resumed = assertPlaceServedResumeContinuity(
    established.descriptor.paths.descriptor,
    fixture.headFile,
  );
  assert.equal(resumed.head.runtimeDigest, digestTree(fixture.runtimeWorld).digest);

  fs.writeFileSync(path.join(fixture.runtimeWorld, 'setup-tick.txt'), 'real pre-release change');
  const failedControl = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: established.descriptor.worldId,
    runtimePath: fixture.runtimeWorld,
  });
  failedControl.append('run_configured', {
    world: { id: established.descriptor.worldId },
    serverAuthority: { kind: 'place-release-serve', identity: fixture.authority.identity },
  });
  failedControl.append('cognition_broker_ready', {});
  failedControl.append('run_start_failed', { error: 'fixture release refusal' });
  failedControl.update('stopping');
  failedControl.append('cognition_broker_drained', {
    snapshot: { accepted: 0, admitted: 0 },
  });
  const failedTerminal = failedControl.append('failed_start_terminal_world_state', {
    protocol: 'behold.managed-terminal-world-state.v1',
    runtime: failedControl.record().runtime,
    tree: digestTree(fixture.runtimeWorld),
  });
  failedControl.update('stopped_verified', { server: null, controllers: [] });
  failedControl.append('failed_start_cleanup_completed');
  const failedLifecycleFile = failedControl.journalFile;
  failedControl.release();

  const failedHead = recordPlaceServedWorldHead({
    descriptorFile: established.descriptor.paths.descriptor,
    lifecycleFile: failedLifecycleFile,
    headFile: fixture.headFile,
  });
  assert.equal(failedHead.terminalKind, 'failed_start_cleanup');
  assert.equal(failedHead.lifecycle.terminalSequence, failedTerminal.sequence);
  assert.equal(failedHead.runtimeDigest, digestTree(fixture.runtimeWorld).digest);
  assert.equal(
    assertPlaceServedResumeContinuity(established.descriptor.paths.descriptor, fixture.headFile)
      .head.runtimeDigest,
    failedHead.runtimeDigest,
  );

  fs.writeFileSync(path.join(fixture.runtimeWorld, 'resident-built.txt'), 'out of band mutation');
  assert.throws(
    () =>
      assertPlaceServedResumeContinuity(established.descriptor.paths.descriptor, fixture.headFile),
    /differs from the last clean Behold history state/,
  );
});

test('served-world verification rejects a changed immutable adoption checkpoint', (t) => {
  const fixture = makeFixture(t);
  const established = establishPlaceServedWorldBasis(
    {
      sessionRoot: fixture.sessionRoot,
      authority: fixture.authority,
      saveEvidence: fixture.saveTerminal,
    },
    { assertAuthorityOwnership: () => {} },
  );
  const level = path.join(established.descriptor.paths.source, 'level.dat');
  fs.chmodSync(level, 0o644);
  fs.writeFileSync(level, 'tampered genesis');
  assert.throws(
    () => verifyPlaceServedWorldBasis(established.descriptor.paths.descriptor),
    /content identity no longer matches/,
  );
});

test('served-world head refuses to normalize a failure after population release', (t) => {
  const fixture = makeFixture(t);
  const established = establishPlaceServedWorldBasis(
    {
      sessionRoot: fixture.sessionRoot,
      authority: fixture.authority,
      saveEvidence: fixture.saveTerminal,
    },
    { assertAuthorityOwnership: () => {} },
  );
  const control = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: established.descriptor.worldId,
    runtimePath: fixture.runtimeWorld,
  });
  control.append('run_configured', {
    world: { id: established.descriptor.worldId },
    serverAuthority: { kind: 'place-release-serve', identity: fixture.authority.identity },
  });
  control.append('cognition_broker_ready', {});
  control.append('experiment_released', { releaseId: 'fixture-release' });
  control.append('run_start_failed', { error: 'fixture post-release failure' });
  control.append('cognition_broker_drained', {
    snapshot: { accepted: 0, admitted: 0 },
  });
  control.append('failed_start_terminal_world_state', {
    protocol: 'behold.managed-terminal-world-state.v1',
    runtime: control.record().runtime,
    tree: digestTree(fixture.runtimeWorld),
  });
  control.update('stopped_verified', { server: null, controllers: [] });
  control.append('failed_start_cleanup_completed');
  const lifecycleFile = control.journalFile;
  control.release();

  assert.throws(
    () =>
      recordPlaceServedWorldHead({
        descriptorFile: established.descriptor.paths.descriptor,
        lifecycleFile,
        headFile: fixture.headFile,
      }),
    /Only a clean stopped Behold lifecycle/,
  );
});

function makeFixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-place-served-world-'));
  t.after(() => {
    makeWritable(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const sessionRoot = path.join(root, 'session');
  const releaseRoot = path.join(root, 'release');
  const runtimeRoot = path.join(root, 'place-runtime');
  const runtimeWorld = path.join(runtimeRoot, 'world');
  const transcriptFile = path.join(sessionRoot, 'episodes', 'one', 'place-control.jsonl');
  const headFile = path.join(sessionRoot, 'head.json');
  const controlRoot = path.join(sessionRoot, 'control');
  fs.mkdirSync(runtimeWorld, { recursive: true });
  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.mkdirSync(path.dirname(transcriptFile), { recursive: true });
  fs.writeFileSync(path.join(runtimeWorld, 'level.dat'), 'fixture saved world');
  fs.mkdirSync(path.join(runtimeWorld, 'region'));
  fs.writeFileSync(path.join(runtimeWorld, 'region', 'r.0.0.mca'), 'fixture region');
  fs.writeFileSync(path.join(runtimeWorld, 'session.lock'), 'owned by fixture Java');
  const releaseManifest = {
    schemaVersion: 3,
    source: { worldTreeSha256: 'b'.repeat(64) },
  };
  fs.writeFileSync(
    path.join(releaseRoot, 'release-manifest.json'),
    `${JSON.stringify(releaseManifest)}\n`,
  );
  const runtimeManifest = {
    schemaVersion: 2,
    kind: 'place-release-preview',
    placeId: 'oxford-fixture',
    sourceRunId: 'oxford-v3',
    profileId: 'living',
    world: 'world',
  };
  fs.writeFileSync(
    path.join(runtimeRoot, 'runtime-manifest.json'),
    `${JSON.stringify(runtimeManifest)}\n`,
  );
  const identity: PlaceServeIdentity = {
    placeId: 'oxford-fixture',
    placeName: 'Oxford Fixture',
    sourceRunId: 'oxford-v3',
    sourceReleaseManifestSha256: sha256File(path.join(releaseRoot, 'release-manifest.json')),
    sourceWorldTreeSha256: releaseManifest.source.worldTreeSha256,
    minecraftServerSha256: 'c'.repeat(64),
    runtimeManifestSha256: sha256File(path.join(runtimeRoot, 'runtime-manifest.json')),
    minecraftVersion: '1.21.4',
    profileId: 'living',
    releasePath: fs.realpathSync.native(releaseRoot),
    runtimePath: fs.realpathSync.native(runtimeRoot),
    endpoint: { host: '127.0.0.1', port: 25599 },
    processes: { controlPid: 9001, javaPid: 9002 },
  };
  const freezeTerminal = terminal(identity, 'behold:1:freeze', 'freeze');
  const saveTerminal = terminal(identity, 'behold:2:save', 'save');
  writeTranscript(transcriptFile, [
    {
      protocol: 'place-compiler-serve-control/v1',
      event: 'ready',
      at: '2026-07-26T00:00:00.000Z',
      identity,
      state: { lifecycle: 'ready', ticks: 'running' },
    },
    freezeTerminal,
    saveTerminal,
  ]);
  let resolved = false;
  const exit = new Promise<any>((resolve) => {
    if (!resolved) {
      resolved = true;
      resolve({ name: 'place-release-serve', code: 0, signal: null });
    }
  });
  const authority: FrozenPlaceServeAuthority = Object.freeze({
    protocol: 'behold.external-minecraft-server-authority.v1',
    kind: 'place-release-serve',
    authorityPid: identity.processes.controlPid,
    serverPid: identity.processes.javaPid,
    runtimeWorldPath: fs.realpathSync.native(runtimeWorld),
    host: '127.0.0.1',
    port: identity.endpoint.port,
    minecraftServerSha256: identity.minecraftServerSha256,
    initialTickState: 'frozen',
    initialTickEvidence: freezeTerminal,
    identity: Object.freeze({
      protocol: 'place-compiler-serve-control/v1',
      placeCompilerRevision: '1'.repeat(40),
      ...identity,
    }),
    placeIdentity: identity,
    placeCompilerRevision: '1'.repeat(40),
    minecraftServerJar: path.join(root, 'fixture-server.jar'),
    transcriptFile,
    exit,
    async freeze() {
      return freezeTerminal;
    },
    async save() {
      return saveTerminal;
    },
    async unfreeze() {
      return null;
    },
    async stop() {
      return exit;
    },
  });
  return {
    sessionRoot,
    runtimeWorld,
    transcriptFile,
    headFile,
    controlRoot,
    identity,
    freezeTerminal,
    saveTerminal,
    authority,
  };
}

function terminal(identity: PlaceServeIdentity, requestId: string, command: 'freeze' | 'save') {
  return {
    protocol: 'place-compiler-serve-control/v1',
    event: 'command_terminal',
    at: '2026-07-26T00:00:01.000Z',
    requestId,
    command,
    ok: true,
    identity,
    state: { lifecycle: 'ready', ticks: 'frozen' },
    acknowledgement:
      command === 'freeze'
        ? '[Server thread/INFO]: The game is frozen'
        : '[Server thread/INFO]: Saved the game',
  };
}

function writeTranscript(file: string, messages: unknown[]) {
  let previousDigest: string | null = null;
  const events = messages.map((message, index) => {
    const line = JSON.stringify(message);
    const base = {
      protocol: 'behold.place-serve-transcript.v1',
      sequence: index + 1,
      at: `2026-07-26T00:00:0${index}.000Z`,
      direction: 'received',
      line,
      lineSha256: sha256(line),
      previousDigest,
    };
    const event = { ...base, digest: sha256(stableJson(base)) };
    previousDigest = event.digest;
    return event;
  });
  fs.writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
}

function makeWritable(root: string) {
  if (!fs.existsSync(root)) return;
  const stats = fs.lstatSync(root);
  if (stats.isDirectory()) {
    fs.chmodSync(root, 0o755);
    for (const entry of fs.readdirSync(root)) makeWritable(path.join(root, entry));
  } else fs.chmodSync(root, 0o644);
}

function sha256File(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
