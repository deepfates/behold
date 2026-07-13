import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acquireWorldControl,
  inspectWorldControl,
  verifyWorldLifecycleJournal,
  WORLD_OWNER_PROTOCOL,
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
