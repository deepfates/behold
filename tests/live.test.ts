import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  listPlaceServerLogs,
  liveEpisodeAccountingScope,
  preserveResidentLyncFiles,
  preservePlaceServerLog,
  preserveTextileImport,
} from '../src/cli/live';

test('live resumes durable lives with a fresh bounded accounting scope per episode', () => {
  assert.equal(
    liveEpisodeAccountingScope('oxford-living:living', '000003'),
    'oxford-living:living:episode:000003',
  );
  assert.notEqual(
    liveEpisodeAccountingScope('oxford-living:living', '000003'),
    liveEpisodeAccountingScope('oxford-living:living', '000004'),
  );
  assert.throws(
    () => liveEpisodeAccountingScope('oxford-living:living', '3'),
    /six-digit episode id/,
  );
});

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

test('live aftermath freezes lifelong Lync bytes and makes one direct Textile import', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-lync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const episodeRoot = path.join(root, 'episodes', '000001');
  const firstLife = path.join(root, 'entities', 'First', 'lync');
  const secondLife = path.join(root, 'entities', 'Second', 'lync');
  fs.mkdirSync(firstLife, { recursive: true });
  fs.mkdirSync(secondLife, { recursive: true });
  const firstBytes = '{"v":1,"id":"first-root"}\n';
  const secondBytes = '{"v":1,"id":"second-root"}\n';
  const firstSource = path.join(firstLife, 'first.lync');
  const secondSource = path.join(secondLife, 'second.lync');
  fs.writeFileSync(firstSource, firstBytes);
  fs.writeFileSync(secondSource, secondBytes);

  const first = preserveResidentLyncFiles({
    entityId: 'First',
    directory: firstLife,
    destinationRoot: path.join(episodeRoot, 'resident-lync'),
  });
  const second = preserveResidentLyncFiles({
    entityId: 'Second',
    directory: secondLife,
    destinationRoot: path.join(episodeRoot, 'resident-lync'),
  });
  const textile = preserveTextileImport({
    sourceFiles: [...first, ...second],
    destination: path.join(episodeRoot, 'textile-resident-lives.lync'),
  });

  assert.equal(first[0]?.protocol, 'behold.live-lync-snapshot.v1');
  assert.equal(first[0]?.sourceFile, fs.realpathSync.native(firstSource));
  assert.equal(fs.readFileSync(first[0]!.file, 'utf8'), firstBytes);
  assert.equal(textile.protocol, 'behold.live-textile-import.v1');
  assert.equal(textile.sourceCount, 2);
  assert.equal(textile.sizeBytes, Buffer.byteLength(firstBytes + secondBytes));
  assert.equal(fs.readFileSync(textile.file, 'utf8'), firstBytes + secondBytes);

  fs.appendFileSync(firstSource, '{"v":1,"id":"later-turn"}\n');
  assert.equal(fs.readFileSync(first[0]!.file, 'utf8'), firstBytes);
  assert.equal(fs.readFileSync(textile.file, 'utf8'), firstBytes + secondBytes);
});
