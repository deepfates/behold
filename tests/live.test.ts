import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listPlaceServerLogs, preservePlaceServerLog } from '../src/cli/live';

test('live aftermath preserves the one new Place server log byte-for-byte', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-ecology-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, 'runtime');
  const logs = path.join(runtimeRoot, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'server-20260726T010000Z.log'), 'prior episode\n');
  const before = new Set(listPlaceServerLogs(runtimeRoot));
  const source = path.join(logs, 'server-20260726T020000Z.log');
  fs.writeFileSync(source, 'resident joined\nresident died\nserver stopped\n');

  const preserved = preservePlaceServerLog({
    runtimeRoot,
    filesBefore: before,
    destination: path.join(root, 'episode', 'minecraft-server.log'),
  });

  assert.equal(preserved.protocol, 'behold.live-ecology-log.v1');
  assert.equal(preserved.sourceFile, fs.realpathSync.native(source));
  assert.equal(fs.readFileSync(preserved.file, 'utf8'), fs.readFileSync(source, 'utf8'));
  assert.equal(preserved.sizeBytes, fs.statSync(source).size);
  assert.match(preserved.sha256, /^[a-f0-9]{64}$/);
});

test('live aftermath refuses an ambiguous or missing Place server log', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-ecology-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, 'runtime');
  const logs = path.join(runtimeRoot, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const before = new Set(listPlaceServerLogs(runtimeRoot));
  const input = {
    runtimeRoot,
    filesBefore: before,
    destination: path.join(root, 'episode', 'minecraft-server.log'),
  };

  assert.throws(() => preservePlaceServerLog(input), /exactly one new Place server log; found 0/);
  fs.writeFileSync(path.join(logs, 'server-20260726T020000Z.log'), 'one\n');
  fs.writeFileSync(path.join(logs, 'server-20260726T020001Z.log'), 'two\n');
  assert.throws(() => preservePlaceServerLog(input), /exactly one new Place server log; found 2/);
});
