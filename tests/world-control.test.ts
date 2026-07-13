import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acquireWorldControl,
  authorizeManagedWorldResetCapability,
  beginManagedControllerAdmission,
  confirmManagedControllerAdmission,
  inspectEntityLeaseFence,
  inspectWorldControl,
  issueManagedWorldResetCapability,
  settleManagedWorldResetCapability,
  verifyWorldLifecycleJournal,
  WORLD_OWNER_PROTOCOL,
  type ManagedWorldResetScope,
} from '../src/runtime/world-control';

test('world control is exclusive, durable, sequenced, and releases only when stopped', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-world-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'runtime');
  const controlRoot = path.join(root, 'control');
  fs.mkdirSync(runtime);
  let clock = 0;
  const control = acquireWorldControl({
    controlRoot,
    world: 'sf-test',
    runtimePath: runtime,
    pid: 42,
    hostname: 'fixture-host',
    now: () => new Date(++clock * 1000),
  });

  const held = inspectWorldControl(controlRoot, 'sf-test');
  assert.equal(held.state, 'held');
  if (held.state === 'held') {
    assert.equal(held.record.protocol, WORLD_OWNER_PROTOCOL);
    assert.equal(held.record.managerPid, 42);
    assert.equal(held.record.state, 'stopped_verified');
  }
  assert.throws(
    () => acquireWorldControl({ controlRoot, world: 'sf-test', runtimePath: runtime }),
    /already controlled/,
  );

  control.update('starting', { server: { pid: 43, jarSha256: 'abc' } });
  assert.throws(() => control.release(), /cannot release from state starting/);
  control.update('running', {
    controllers: [{ entityId: 'Scout', pid: 44, leasePath: '/tmp/scout.lock' }],
  });
  control.append('fixture_ready', { ok: true });
  control.update('stopping', { controllers: [] });
  control.update('stopped_verified', { server: null });
  control.release();

  assert.equal(inspectWorldControl(controlRoot, 'sf-test').state, 'clear');
  const events = fs
    .readFileSync(control.journalFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_event, index) => index + 1),
  );
  assert.equal(events[0].type, 'control_acquired');
  assert.equal(events.at(-1).type, 'control_released');
  const verified = verifyWorldLifecycleJournal(control.journalFile);
  assert.equal(verified.events.length, events.length);
  assert.equal(verified.tipDigest, events.at(-1).digest);

  const second = acquireWorldControl({ controlRoot, world: 'sf-test', runtimePath: runtime });
  assert.equal(second.record().epoch, 2);
  second.release();
});

test('world control fails closed when its owner record is replaced or malformed', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-world-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'runtime');
  const controlRoot = path.join(root, 'control');
  fs.mkdirSync(runtime);
  const control = acquireWorldControl({ controlRoot, world: 'fixture', runtimePath: runtime });

  fs.unlinkSync(control.file);
  fs.writeFileSync(control.file, '{}\n');
  assert.equal(inspectWorldControl(controlRoot, 'fixture').state, 'invalid');
  assert.throws(() => control.update('running'), /record was replaced/);
  assert.throws(() => control.release(), /record was replaced/);
});

test('world lifecycle verification rejects edits and reordering and exposes a truncated tip', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-world-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'runtime');
  const controlRoot = path.join(root, 'control');
  fs.mkdirSync(runtime);
  const control = acquireWorldControl({ controlRoot, world: 'fixture', runtimePath: runtime });
  control.append('one', { value: 1 });
  control.append('two', { value: 2 });
  control.release();
  const original = fs.readFileSync(control.journalFile, 'utf8');
  const lines = original.trim().split('\n');

  fs.writeFileSync(control.journalFile, `${lines[0]}\n${lines[2]}\n${lines[1]}\n`);
  assert.throws(() => verifyWorldLifecycleJournal(control.journalFile), /Invalid/);
  fs.writeFileSync(control.journalFile, original.replace('"value":1', '"value":9'));
  assert.throws(() => verifyWorldLifecycleJournal(control.journalFile), /Invalid/);
  fs.writeFileSync(control.journalFile, `${lines.slice(0, -1).join('\n')}\n`);
  const truncated = verifyWorldLifecycleJournal(control.journalFile);
  assert.notEqual(truncated.tipDigest, JSON.parse(lines.at(-1)!).digest);
});

test('managed reset authority is opaque, exact, one-shot, and transition fenced', (t) => {
  const fixture = makeResetControlFixture(t);
  const control = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: 'fixture',
    runtimePath: fixture.runtime,
  });
  assert.throws(() => control.update('running'), /Invalid world control transition/);
  assert.throws(() => control.update('resetting'), /managed reset capability/);

  const capability = issueManagedWorldResetCapability(control, fixture.scope);
  assert.equal(control.record().state, 'resetting');
  assert.equal(authorizeManagedWorldResetCapability(capability, fixture.scope).length, 32);
  assert.throws(
    () => authorizeManagedWorldResetCapability({ ...capability }, fixture.scope),
    /absent or settled/,
  );
  assert.throws(
    () =>
      authorizeManagedWorldResetCapability(capability, {
        ...fixture.scope,
        runId: 'different-run',
      }),
    /no longer valid/,
  );

  settleManagedWorldResetCapability(capability, 'unchanged');
  assert.equal(control.record().state, 'stopped_verified');
  assert.throws(
    () => authorizeManagedWorldResetCapability(capability, fixture.scope),
    /absent or settled/,
  );
  control.release();
});

test('world-bound entity leases fence reset and ambiguity remains recovery-required', (t) => {
  const fixture = makeResetControlFixture(t);
  const entityDirectory = path.join(fixture.entityRoot, 'Scout');
  fs.mkdirSync(entityDirectory);
  fs.writeFileSync(
    path.join(entityDirectory, 'circle.json'),
    JSON.stringify({
      protocol: 'behold.entity-circle-binding.v1',
      entityId: 'Scout',
      circleId: fixture.scope.circleIds[0],
    }),
  );
  fs.writeFileSync(
    path.join(entityDirectory, 'runtime.lock'),
    JSON.stringify({ protocol: 'behold.entity-runtime-lease.v1', entityId: 'Scout', pid: 42 }),
  );
  assert.equal(inspectEntityLeaseFence(fixture.entityRoot, fixture.scope.circleIds).state, 'owned');

  const control = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: 'fixture',
    runtimePath: fixture.runtime,
  });
  assert.throws(
    () => issueManagedWorldResetCapability(control, fixture.scope),
    /entity lease fence is owned/,
  );
  assert.equal(control.record().state, 'stopped_verified');

  fs.unlinkSync(path.join(entityDirectory, 'runtime.lock'));
  const capability = issueManagedWorldResetCapability(control, fixture.scope);
  fs.writeFileSync(path.join(entityDirectory, 'runtime.lock'), '{}\n');
  assert.throws(
    () => authorizeManagedWorldResetCapability(capability, fixture.scope),
    /entity lease fence is unknown/,
  );
  settleManagedWorldResetCapability(capability, 'recovery_required');
  assert.equal(control.record().state, 'recovery_required');
  assert.throws(() => control.release(), /cannot release/);
});

test('managed reset refuses child ownership and owner replacement invalidates an issued capability', (t) => {
  const first = makeResetControlFixture(t);
  const running = acquireWorldControl({
    controlRoot: first.controlRoot,
    world: 'fixture',
    runtimePath: first.runtime,
  });
  running.update('starting', { server: { pid: 91, jarSha256: 'abc' } });
  assert.throws(
    () => issueManagedWorldResetCapability(running, first.scope),
    /cannot begin from state starting/,
  );
  running.update('stopping', { server: null });
  running.update('stopped_verified');
  running.release();

  const second = makeResetControlFixture(t);
  const replaced = acquireWorldControl({
    controlRoot: second.controlRoot,
    world: 'fixture',
    runtimePath: second.runtime,
  });
  const capability = issueManagedWorldResetCapability(replaced, second.scope);
  fs.unlinkSync(replaced.file);
  fs.writeFileSync(replaced.file, '{}\n');
  assert.throws(
    () => authorizeManagedWorldResetCapability(capability, second.scope),
    /record was replaced/,
  );
});

test('managed controller admission rechecks the same owner epoch after its lease is durable', (t) => {
  const fixture = makeResetControlFixture(t);
  const control = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: 'fixture',
    runtimePath: fixture.runtime,
  });
  assert.throws(
    () =>
      beginManagedControllerAdmission({
        controlFile: control.file,
        world: 'fixture',
        runId: 'fixture-1',
      }),
    /blocked while world is stopped_verified/,
  );
  control.update('starting', { server: { pid: 44, jarSha256: 'abc' } });
  const proof = beginManagedControllerAdmission({
    controlFile: control.file,
    world: 'fixture',
    runId: 'fixture-1',
  });
  assert.equal(confirmManagedControllerAdmission(proof).state, 'starting');
  control.update('stopping');
  assert.throws(() => confirmManagedControllerAdmission(proof), /blocked while world is stopping/);
  control.update('stopped_verified', { server: null });
  control.release();
});

function makeResetControlFixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-world-reset-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'runtime');
  const baseline = path.join(root, 'baseline');
  const archiveRoot = path.join(root, 'archive');
  const entityRoot = path.join(root, 'entities');
  const controlRoot = path.join(root, 'control');
  for (const directory of [runtime, baseline, archiveRoot, entityRoot]) fs.mkdirSync(directory);
  const scope: ManagedWorldResetScope = {
    world: 'fixture',
    runId: 'reset-one',
    worldConfigDigest: '1'.repeat(64),
    baselinePath: baseline,
    baselineDigest: '2'.repeat(64),
    runtimePath: runtime,
    archiveRoot,
    stagePath: path.join(root, '.runtime.stage-reset-one'),
    archivePath: path.join(archiveRoot, 'reset-one-runtime'),
    entityRoot,
    circleIds: ['minecraft://127.0.0.1:25599'],
  };
  return { root, runtime, controlRoot, entityRoot, scope };
}
