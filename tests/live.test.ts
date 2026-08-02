import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertLiveMindRevisionCompatible,
  assessNativeHumanEntry,
  classifyLiveSessionEntry,
  createLiveBoundary,
  listPlaceServerLogs,
  liveEpisodeAccountingScope,
  liveResumeInstruction,
  nativeHumanJoinInstruction,
  preserveResidentLyncFiles,
  preservePlaceServerLog,
  preserveTextileImport,
  selectPendingLiveRecoveryEvidence,
  selectLiveHistorySeed,
  selectLiveResidentConfiguration,
  shouldRecordPlaceOnlyCleanup,
  summarizeExternalPlayers,
} from '../src/cli/live';
import {
  captureLiveLyncCheckpoint,
  captureLiveSelectedLife,
  LIVE_EPISODE_RECORD_V1_PROTOCOL,
  LIVE_EPISODE_RECORD_V2_PROTOCOL,
  materializeLiveEpisodeLyncCheckpoint,
  publishLiveCheckpointJson,
  sha256,
  stableJson,
  verifyLiveEpisodeLyncCheckpoint,
} from '../src/runtime/live-lync-checkpoint';

test('live history selection is paired and fresh-session-only', () => {
  assert.deepEqual(
    selectLiveHistorySeed({
      receipt: './fork.json',
      history: 'qwen-camera',
      sessionEntry: 'new',
    }),
    { receipt: path.resolve('./fork.json'), history: 'qwen-camera' },
  );
  assert.equal(
    selectLiveHistorySeed({ receipt: undefined, history: undefined, sessionEntry: 'resume' }),
    null,
  );
  assert.throws(
    () =>
      selectLiveHistorySeed({ receipt: './fork.json', history: undefined, sessionEntry: 'new' }),
    /must be supplied together/,
  );
  assert.throws(
    () =>
      selectLiveHistorySeed({
        receipt: './fork.json',
        history: 'qwen-camera',
        sessionEntry: 'resume',
      }),
    /only for a fresh live session/,
  );
});

test('live distinguishes a retryable pre-head first start from resume and recovery', () => {
  assert.equal(
    classifyLiveSessionEntry({
      planExists: false,
      descriptorExists: false,
      headExists: false,
      managedLifecycleCount: 0,
    }),
    'new',
  );
  assert.equal(
    classifyLiveSessionEntry({
      planExists: true,
      descriptorExists: true,
      headExists: false,
      managedLifecycleCount: 0,
    }),
    'first_start_retry',
  );
  assert.equal(
    classifyLiveSessionEntry({
      planExists: true,
      descriptorExists: true,
      headExists: true,
      managedLifecycleCount: 1,
    }),
    'resume',
  );
  assert.equal(
    classifyLiveSessionEntry({
      planExists: true,
      descriptorExists: true,
      headExists: false,
      managedLifecycleCount: 1,
    }),
    'recovery_required',
  );
  assert.throws(
    () =>
      classifyLiveSessionEntry({
        planExists: false,
        descriptorExists: true,
        headExists: false,
        managedLifecycleCount: 0,
      }),
    /genesis exists without its live session plan/,
  );
});

test('live keeps terminal signal protection installed through caller-owned cleanup', async () => {
  const signals = new EventEmitter();
  const boundary = createLiveBoundary(
    {
      finished: new Promise<void>(() => {}),
      stopRequested: new Promise<string>(() => {}),
    },
    60_000,
    signals as any,
  );

  signals.emit('SIGINT');
  assert.equal(await boundary.wait, 'SIGINT');
  assert.equal(signals.listenerCount('SIGINT'), 1);
  assert.equal(signals.listenerCount('SIGHUP'), 1);
  signals.emit('SIGHUP');
  assert.equal(signals.listenerCount('SIGHUP'), 1);

  boundary.dispose();
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  assert.equal(signals.listenerCount('SIGHUP'), 0);
});

test('live turns an exhausted resident purpose quota into a normal boundary stop', async () => {
  const signals = new EventEmitter();
  const boundary = createLiveBoundary(
    {
      finished: new Promise<void>(() => {}),
      stopRequested: Promise.resolve('resident_purpose_quota_exhausted'),
    },
    60_000,
    signals as any,
  );

  assert.equal(await boundary.wait, 'resident_purpose_quota_exhausted');
  boundary.dispose();
});

test('live accepts an owned habitat-lens stop request through the same boundary', async () => {
  const signals = new EventEmitter();
  const boundary = createLiveBoundary(
    {
      finished: new Promise<void>(() => {}),
      stopRequested: new Promise<string>(() => {}),
    },
    60_000,
    signals as any,
  );

  boundary.request('resident_lens_stop');
  assert.equal(await boundary.wait, 'resident_lens_stop');
  boundary.dispose();
});

test('live recovery can resume head publication after ownership was already released', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const worldId = 'fixture-world';
  const controlDirectory = path.join(root, 'control', worldId);
  fs.mkdirSync(controlDirectory, { recursive: true });
  const headFile = path.join(root, 'head.json');
  fs.writeFileSync(
    headFile,
    `${JSON.stringify({ worldId, lifecycle: { file: path.join(controlDirectory, 'lifecycle-8.jsonl') } })}\n`,
  );
  const completedEvidence = path.join(controlDirectory, 'recovery-9-aaaaaaaaaaaa.completed.json');
  fs.writeFileSync(
    completedEvidence,
    `${JSON.stringify({
      protocol: 'behold.world-recovery-evidence.v1',
      phase: 'completed',
      classification: 'abandoned_after_save_ack',
      world: worldId,
      epoch: 9,
    })}\n`,
  );

  assert.deepEqual(
    selectPendingLiveRecoveryEvidence({
      controlRoot: path.join(root, 'control'),
      worldId,
      headFile,
    }),
    { epoch: 9, classification: 'abandoned_after_save_ack', completedEvidence },
  );
});

test('live mind revision preserves resident identity, body, charter, cadence, and steering', () => {
  const original = [
    {
      entityId: 'Iris',
      bodyUsername: 'IrisBody',
      model: 'provider/model',
      mind: 'direct',
      policyProfile: 'legible-resident-v1',
      bodyProfile: 'minecraft-human-semantic-v1',
      actionProfile: 'minecraft-human-semantic-v1',
      safetyProfile: 'vanilla-player-v1',
      tickMs: 4000,
      urgentDecisionTimeoutMs: 5000,
      providerQuotas: { residentDecisionAttempts: 8, auxiliaryContextAttempts: 2 },
      providerRoute: { protocol: 'provider' },
    },
  ];
  assert.doesNotThrow(() =>
    assertLiveMindRevisionCompatible(original, [
      {
        ...original[0],
        model: 'local/model@4bit',
        urgentDecisionTimeoutMs: 15_000,
        providerQuotas: { residentDecisionAttempts: 16, auxiliaryContextAttempts: 4 },
        providerRoute: undefined,
        lmStudioLocal: { protocol: 'local' },
      },
    ]),
  );
  const uncoached = [{ ...original[0], policyProfile: 'resident-v2' }];
  assert.doesNotThrow(() =>
    assertLiveMindRevisionCompatible(uncoached, [
      { ...uncoached[0], policyProfile: 'resident-v3' },
    ]),
  );
  for (const changed of [
    { bodyUsername: 'OtherBody' },
    { tickMs: 1000 },
    { task: 'mine this block' },
    { policyProfile: 'neutral-benchmark-v1' },
  ]) {
    assert.throws(
      () => assertLiveMindRevisionCompatible(original, [{ ...original[0], ...changed }]),
      /may change only model/,
    );
  }
});

test('live resident configuration is self-contained after the session is created', () => {
  const residents = [{ entityId: 'Iris', model: 'provider/model' }] as any;
  const current = { residents, digest: 'current-digest', revision: null } as any;

  assert.throws(
    () =>
      selectLiveResidentConfiguration({
        requestedResidents: null,
        current: null,
        changeMinds: false,
        recover: false,
      }),
    /new live session requires --residents FILE/,
  );
  assert.equal(
    selectLiveResidentConfiguration({
      requestedResidents: null,
      current,
      changeMinds: false,
      recover: false,
    }).residents,
    residents,
  );
  assert.equal(
    selectLiveResidentConfiguration({
      requestedResidents: null,
      current,
      changeMinds: false,
      recover: true,
    }).residents,
    residents,
  );
  assert.throws(
    () =>
      selectLiveResidentConfiguration({
        requestedResidents: null,
        current,
        changeMinds: true,
        recover: false,
      }),
    /--change-minds requires --residents FILE/,
  );

  const changed = [{ entityId: 'Iris', model: 'local/model' }] as any;
  assert.throws(
    () =>
      selectLiveResidentConfiguration({
        requestedResidents: changed,
        current,
        changeMinds: false,
        recover: false,
      }),
    /resident minds differ/,
  );
  assert.throws(
    () =>
      selectLiveResidentConfiguration({
        requestedResidents: changed,
        current,
        changeMinds: true,
        recover: true,
      }),
    /--recover requires the session's current resident configuration/,
  );
  assert.equal(
    selectLiveResidentConfiguration({
      requestedResidents: changed,
      current,
      changeMinds: true,
      recover: false,
    }).writeRevision,
    true,
  );
});

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

test('live episode record preserves the one new Place server log byte-for-byte', (t) => {
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

test('live episode record refuses an ambiguous or missing Place server log', (t) => {
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

test('live episode record freezes lifelong Lync bytes and makes one direct Textile import', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-lync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const episodeRoot = path.join(root, 'episodes', '000001');
  const firstLife = path.join(root, 'entities', 'First', 'lync');
  const secondLife = path.join(root, 'entities', 'Second', 'lync');
  fs.mkdirSync(firstLife, { recursive: true });
  fs.mkdirSync(secondLife, { recursive: true });
  const firstBytes =
    '{"v":1,"id":"first-root","kind":"lync/loom","payload":{"meta":{"protocol":"behold.entity-loom.v1","profile":"org.behold.inhabitant.v1","entityId":"First"}}}\n';
  const secondBytes =
    '{"v":1,"id":"second-root","kind":"lync/loom","payload":{"meta":{"protocol":"behold.entity-loom.v1","profile":"org.behold.inhabitant.v2","entityId":"Second"}}}\n';
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
  assert.equal(first[0]?.presentationProfile, 'org.behold.inhabitant.v1');
  assert.equal(second[0]?.presentationProfile, 'org.behold.inhabitant.v2');
  assert.equal(first[0]?.sourceFile, fs.realpathSync.native(firstSource));
  assert.equal(fs.readFileSync(first[0]!.file, 'utf8'), firstBytes);
  assert.equal(textile.protocol, 'behold.live-textile-import.v1');
  assert.equal(textile.sourceCount, 2);
  assert.equal(textile.sizeBytes, Buffer.byteLength(firstBytes + secondBytes));
  assert.equal(fs.readFileSync(textile.file, 'utf8'), firstBytes + secondBytes);

  fs.appendFileSync(firstSource, '{"v":1,"id":"later-turn"}\n');
  assert.equal(fs.readFileSync(first[0]!.file, 'utf8'), firstBytes);
  assert.equal(fs.readFileSync(textile.file, 'utf8'), firstBytes + secondBytes);

  const legacyRecord = authenticatedLyncEpisode(
    LIVE_EPISODE_RECORD_V1_PROTOCOL,
    [
      {
        entityId: 'First',
        profile: 'org.behold.inhabitant.v1',
        sourceFiles: first,
      },
      {
        entityId: 'Second',
        profile: 'org.behold.inhabitant.v2',
        sourceFiles: second,
      },
    ],
    textile,
  );
  const verified = await verifyLiveEpisodeLyncCheckpoint(legacyRecord);
  assert.equal(verified.version, 1);
  assert.deepEqual(
    verified.orderedSources.map((source) => source.entityId),
    ['First', 'Second'],
  );
  const materialized = await materializeLiveEpisodeLyncCheckpoint(
    legacyRecord,
    path.join(root, 'review', 'legacy.lync'),
  );
  assert.equal(fs.readFileSync(materialized.file, 'utf8'), firstBytes + secondBytes);
});

test('live v2 checkpoint binds ordered canonical prefixes without copying lives or a union', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-lync-v2-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const episodeRoot = path.join(root, 'episodes', '000002');
  const secondDirectory = path.join(root, 'entities', 'Second', 'lync');
  const firstDirectory = path.join(root, 'entities', 'First', 'lync');
  fs.mkdirSync(secondDirectory, { recursive: true });
  fs.mkdirSync(firstDirectory, { recursive: true });
  const secondBytes = residentLyncBytes('Second', 'org.behold.inhabitant.v2', 'second-root');
  const firstABytes = residentLyncBytes('First', 'org.behold.inhabitant.v1', 'first-a');
  const firstZBytes = residentLyncBytes('First', 'org.behold.inhabitant.v1', 'first-z');
  const secondSource = path.join(secondDirectory, 'second.lync');
  const firstASource = path.join(firstDirectory, 'a-first.lync');
  const firstZSource = path.join(firstDirectory, 'z-first.lync');
  fs.writeFileSync(secondSource, secondBytes);
  fs.writeFileSync(firstZSource, firstZBytes);
  fs.writeFileSync(firstASource, firstABytes);
  fs.writeFileSync(path.join(secondDirectory, 'second.conflicts'), '{"conflict":true}\n');
  fs.writeFileSync(path.join(secondDirectory, 'pending.events'), '{"pending":true}\n');

  const checkpoint = captureLiveLyncCheckpoint({
    episodeRoot,
    residents: [
      { entityId: 'Second', directory: secondDirectory },
      { entityId: 'First', directory: firstDirectory },
    ],
  });
  const record = authenticatedLyncEpisode(
    LIVE_EPISODE_RECORD_V2_PROTOCOL,
    checkpoint.lives,
    checkpoint.artifact,
  );
  const retriedCheckpoint = captureLiveLyncCheckpoint({
    episodeRoot,
    residents: [
      { entityId: 'Second', directory: secondDirectory },
      { entityId: 'First', directory: firstDirectory },
    ],
  });
  assert.deepEqual(retriedCheckpoint, checkpoint);

  assert.deepEqual(fs.readdirSync(episodeRoot), ['textile-resident-lives.sources.json']);
  assert.equal(fs.existsSync(path.join(episodeRoot, 'resident-lync')), false);
  assert.equal(fs.existsSync(path.join(episodeRoot, 'textile-resident-lives.lync')), false);
  const manifest = JSON.parse(fs.readFileSync(checkpoint.artifact.file, 'utf8'));
  assert.equal(manifest.protocol, 'behold.live-textile-source-set.v2');
  assert.equal(manifest.construction, 'ordered_prefix_set');
  assert.equal(manifest.sourceCount, 3);
  assert.equal(manifest.totalSizeBytes, Buffer.byteLength(secondBytes + firstABytes + firstZBytes));
  assert.deepEqual(
    manifest.sources.map((source: any) => [
      source.order,
      source.entityId,
      path.basename(source.sourceFile),
    ]),
    [
      [0, 'Second', 'second.lync'],
      [1, 'First', 'a-first.lync'],
      [2, 'First', 'z-first.lync'],
    ],
  );
  for (const source of manifest.sources) {
    assert.equal(source.protocol, 'behold.live-lync-prefix.v2');
    assert.equal(source.startOffset, 0);
    assert.equal(source.endOffset, source.sizeBytes);
    assert.equal(source.preservation, 'immutable_prefix_of_canonical_append_only_source');
  }
  assert.deepEqual(
    checkpoint.lives[0]!.canonicalSourceFiles.map((source) => [
      path.basename(source.sourceFile),
      source.sourceKind,
      source.presentationProfile,
    ]),
    [
      ['second.conflicts', 'conflicts', null],
      ['second.lync', 'loom', 'org.behold.inhabitant.v2'],
      ['pending.events', 'pending', null],
    ],
  );

  fs.appendFileSync(secondSource, '{"v":1,"id":"second-later"}\n');
  fs.appendFileSync(firstASource, '{"v":1,"id":"first-later"}\n');
  const verified = await verifyLiveEpisodeLyncCheckpoint(record);
  assert.equal(verified.version, 2);
  assert.deepEqual(
    verified.orderedSources.map((source) => path.basename(source.sourceFile)),
    ['second.lync', 'a-first.lync', 'z-first.lync'],
  );
  const materialized = await materializeLiveEpisodeLyncCheckpoint(
    record,
    path.join(root, 'review', 'v2.lync'),
  );
  assert.equal(fs.readFileSync(materialized.file, 'utf8'), secondBytes + firstABytes + firstZBytes);
});

test('live v2 checkpoint binds the exact selected Lync branch head', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-selected-life-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'entities', 'First', 'lync');
  fs.mkdirSync(directory, { recursive: true });
  const [{ createFileEventStore }, { createLyncLooms }] = await Promise.all([
    import('@deepfates/lync/file-log'),
    import('@deepfates/lync/looms'),
  ]);
  const store = createFileEventStore(directory);
  const looms = createLyncLooms({
    store,
    author: { actor: 'First', via: 'behold-test' },
  });
  const info = await looms.create({
    protocol: 'behold.entity-loom.v1',
    profile: 'org.behold.inhabitant.v2',
    entityId: 'First',
    circleId: 'minecraft://selected-life-test',
  });
  const loom = await looms.open(info.id);
  const first = await loom.appendTurn(null, { entityId: 'First', sequence: 1 });
  loom.close();
  fs.writeFileSync(
    path.join(directory, 'manifest.json'),
    `${JSON.stringify({
      protocol: 'behold.entity-loom-manifest.v1',
      entityId: 'First',
      loomId: info.id,
      tipTurnId: first.id,
    })}\n`,
  );

  const selectedLife = await captureLiveSelectedLife({
    entityId: 'First',
    directory,
  });
  const checkpoint = captureLiveLyncCheckpoint({
    episodeRoot: path.join(root, 'episode'),
    residents: [{ entityId: 'First', directory, canonicalCheckpoint: selectedLife.checkpoint }],
  });
  const lives = [{ ...checkpoint.lives[0], selectedLife }];
  const record = authenticatedLyncEpisode(
    LIVE_EPISODE_RECORD_V2_PROTOCOL,
    lives,
    checkpoint.artifact,
  );
  const continued = await looms.open(info.id);
  await continued.appendTurn(first.id, { entityId: 'First', sequence: 2 });
  continued.close();
  const verified = await verifyLiveEpisodeLyncCheckpoint(record);

  assert.equal(selectedLife.loomId, info.id);
  assert.equal(selectedLife.tipTurnId, first.id);
  assert.equal(selectedLife.depth, 1);
  assert.equal(selectedLife.circleId, 'minecraft://selected-life-test');
  assert.match(selectedLife.chainDigest!, /^[a-f0-9]{64}$/);
  assert.equal(verified.version, 2);
  if (verified.version !== 2) throw new Error('expected a v2 selected-life checkpoint');
  assert.equal(verified.selectedLives[0]?.tipTurnId, first.id);

  const wrongSelection = authenticatedLyncEpisode(
    LIVE_EPISODE_RECORD_V2_PROTOCOL,
    [{ ...lives[0], selectedLife: { ...selectedLife, tipTurnId: 'wrong-tip' } }],
    checkpoint.artifact,
  );
  await assert.rejects(
    verifyLiveEpisodeLyncCheckpoint(wrongSelection),
    /selected Lync checkpoint identity differs/,
  );
});

test('live v2 checkpoint rejects prefix mutation, truncation, and source replacement', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-lync-v2-tamper-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'entities', 'First', 'lync');
  fs.mkdirSync(directory, { recursive: true });
  const original = `${residentLyncBytes('First', 'org.behold.inhabitant.v1', 'first-root')}{"v":1,"id":"first-turn"}\n`;
  const source = path.join(directory, 'first.lync');
  fs.writeFileSync(source, original);
  const checkpoint = captureLiveLyncCheckpoint({
    episodeRoot: path.join(root, 'episode'),
    residents: [{ entityId: 'First', directory }],
  });
  const record = authenticatedLyncEpisode(
    LIVE_EPISODE_RECORD_V2_PROTOCOL,
    checkpoint.lives,
    checkpoint.artifact,
  );

  fs.writeFileSync(source, original.replace('first-turn', 'evil--turn'));
  await assert.rejects(verifyLiveEpisodeLyncCheckpoint(record), /prefix digest mismatch/);

  fs.writeFileSync(source, original.slice(0, -8));
  await assert.rejects(verifyLiveEpisodeLyncCheckpoint(record), /prefix was truncated/);

  fs.writeFileSync(source, original);
  fs.renameSync(source, `${source}.replaced`);
  fs.symlinkSync(`${source}.replaced`, source);
  await assert.rejects(verifyLiveEpisodeLyncCheckpoint(record), /must be a plain file/);
});

test('live v2 checkpoint rejects reordered manifests and ambiguous resident sources', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-lync-v2-order-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const firstDirectory = path.join(root, 'First');
  const secondDirectory = path.join(root, 'Second');
  fs.mkdirSync(firstDirectory);
  fs.mkdirSync(secondDirectory);
  fs.writeFileSync(
    path.join(firstDirectory, 'first.lync'),
    residentLyncBytes('First', 'org.behold.inhabitant.v1', 'first-root'),
  );
  fs.writeFileSync(
    path.join(secondDirectory, 'second.lync'),
    residentLyncBytes('Second', 'org.behold.inhabitant.v2', 'second-root'),
  );
  const checkpoint = captureLiveLyncCheckpoint({
    episodeRoot: path.join(root, 'episode'),
    residents: [
      { entityId: 'First', directory: firstDirectory },
      { entityId: 'Second', directory: secondDirectory },
    ],
  });
  const changedClaimLives = JSON.parse(JSON.stringify(checkpoint.lives));
  changedClaimLives[0].sourceFiles[0].preservation = 'unbound_source';
  await assert.rejects(
    verifyLiveEpisodeLyncCheckpoint(
      authenticatedLyncEpisode(
        LIVE_EPISODE_RECORD_V2_PROTOCOL,
        changedClaimLives,
        checkpoint.artifact,
      ),
    ),
    /malformed live v2 Lync prefix/,
  );
  const manifest = JSON.parse(fs.readFileSync(checkpoint.artifact.file, 'utf8'));
  manifest.sources.reverse();
  const { digest: _oldDigest, ...manifestBase } = manifest;
  manifest.digest = sha256(stableJson(manifestBase));
  fs.writeFileSync(checkpoint.artifact.file, `${JSON.stringify(manifest, null, 2)}\n`);
  const reorderedArtifact = {
    ...checkpoint.artifact,
    sha256: fileSha256(checkpoint.artifact.file),
    sizeBytes: fs.statSync(checkpoint.artifact.file).size,
    manifestDigest: manifest.digest,
  };
  const reorderedRecord = authenticatedLyncEpisode(
    LIVE_EPISODE_RECORD_V2_PROTOCOL,
    checkpoint.lives,
    reorderedArtifact,
  );
  await assert.rejects(
    verifyLiveEpisodeLyncCheckpoint(reorderedRecord),
    /order differs from resident sources/,
  );

  const ambiguousRoot = path.join(root, 'ambiguous');
  const ambiguousFirst = path.join(ambiguousRoot, 'First');
  const ambiguousSecond = path.join(ambiguousRoot, 'Second');
  fs.mkdirSync(ambiguousFirst, { recursive: true });
  fs.mkdirSync(ambiguousSecond, { recursive: true });
  fs.writeFileSync(
    path.join(ambiguousFirst, 'life.lync'),
    residentLyncBytes('First', 'org.behold.inhabitant.v1', 'first-root'),
  );
  fs.writeFileSync(
    path.join(ambiguousSecond, 'life.lync'),
    residentLyncBytes('Second', 'org.behold.inhabitant.v2', 'second-root'),
  );
  assert.throws(
    () =>
      captureLiveLyncCheckpoint({
        episodeRoot: path.join(root, 'ambiguous-episode'),
        residents: [
          { entityId: 'First', directory: ambiguousFirst },
          { entityId: 'Second', directory: ambiguousSecond },
        ],
      }),
    /basename is ambiguous/,
  );
});

test('live v2 checkpoint refuses a symlink source or an incomplete Lync root line', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-lync-v2-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const symlinkDirectory = path.join(root, 'symlink');
  fs.mkdirSync(symlinkDirectory);
  const target = path.join(root, 'target.lync');
  fs.writeFileSync(target, residentLyncBytes('First', 'org.behold.inhabitant.v1', 'root'));
  fs.symlinkSync(target, path.join(symlinkDirectory, 'life.lync'));
  assert.throws(
    () =>
      captureLiveLyncCheckpoint({
        episodeRoot: path.join(root, 'symlink-episode'),
        residents: [{ entityId: 'First', directory: symlinkDirectory }],
      }),
    /requires a Lync source/,
  );

  const incompleteDirectory = path.join(root, 'incomplete');
  fs.mkdirSync(incompleteDirectory);
  fs.writeFileSync(path.join(incompleteDirectory, 'life.lync'), '{"v":1');
  assert.throws(
    () =>
      captureLiveLyncCheckpoint({
        episodeRoot: path.join(root, 'incomplete-episode'),
        residents: [{ entityId: 'First', directory: incompleteDirectory }],
      }),
    /no complete root line/,
  );
});

test('live checkpoint JSON publication is atomic and exact-idempotent', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-checkpoint-json-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'checkpoint.json');
  const value = { protocol: 'fixture.v1', sources: [{ sizeBytes: 42 }] };

  assert.equal(publishLiveCheckpointJson(file, value), file);
  assert.equal(publishLiveCheckpointJson(file, value), file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), value);
  assert.throws(
    () => publishLiveCheckpointJson(file, { ...value, sources: [] }),
    /differs from the exact retry/,
  );
  assert.deepEqual(
    fs.readdirSync(root).filter((name) => name.endsWith('.tmp')),
    [],
  );

  const partial = path.join(root, 'partial.json');
  fs.writeFileSync(partial, '{"protocol":');
  assert.throws(() => publishLiveCheckpointJson(partial, value), /differs from the exact retry/);
  assert.equal(fs.readFileSync(partial, 'utf8'), '{"protocol":');
});

test('native-human treatment requires the server and every resident to witness the declared join', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-native-human-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ecology = path.join(root, 'minecraft-server.log');
  fs.writeFileSync(
    ecology,
    '[12:00:00] [Server thread/INFO]: Ada joined the game\n[12:01:00] [Server thread/INFO]: Ada left the game\n',
  );
  const residents = ['First', 'Second'].map((entityId, index) => {
    const journalDirectory = path.join(root, entityId);
    fs.mkdirSync(journalDirectory);
    fs.writeFileSync(
      path.join(journalDirectory, 'run.jsonl'),
      `${JSON.stringify({
        sequence: index + 4,
        at: `2026-07-26T12:00:0${index}.000Z`,
        agent: entityId,
        type: 'external_player_intervention',
        data: {
          protocol: 'behold.external-player-intervention.v1',
          kind: 'joined',
          username: 'Ada',
          classification: 'native_human_or_unmanaged_player',
        },
      })}\n`,
    );
    return { entityId, bodyUsername: entityId, journalDirectory };
  });

  const treatment = assessNativeHumanEntry({
    declaredPlayer: 'Ada',
    endpoint: { host: '127.0.0.1', port: 25565 },
    ecologyLogFile: ecology,
    residents,
  });
  assert.equal(treatment.protocol, 'behold.live-native-human.v2');
  assert.equal(treatment.classification, 'operator_declared_native_human');
  assert.deepEqual(treatment.entry, {
    client: 'minecraft_java',
    method: 'multiplayer_direct_connection',
    address: '127.0.0.1:25565',
  });
  assert.equal(treatment.assessment.passed, true);
  assert.equal(treatment.evidence.serverJoins[0]?.line, 1);
  assert.deepEqual(
    treatment.evidence.residentWitnesses.map((resident) => resident.observed),
    [true, true],
  );

  fs.writeFileSync(path.join(residents[1]!.journalDirectory, 'run.jsonl'), '');
  const missingWitness = assessNativeHumanEntry({
    declaredPlayer: 'Ada',
    endpoint: { host: '127.0.0.1', port: 25565 },
    ecologyLogFile: ecology,
    residents,
  });
  assert.equal(missingWitness.assessment.assertions.authoritativeServerJoin, true);
  assert.equal(missingWitness.assessment.assertions.witnessedByEveryResident, false);
  assert.equal(missingWitness.assessment.passed, false);
  assert.throws(
    () =>
      assessNativeHumanEntry({
        declaredPlayer: 'First',
        endpoint: { host: '127.0.0.1', port: 25565 },
        ecologyLogFile: ecology,
        residents,
      }),
    /collides with a managed resident body/,
  );
});

test('episode external-player summary is independent of optional human assessment', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-live-external-players-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ecology = path.join(root, 'minecraft-server.log');
  fs.writeFileSync(
    ecology,
    [
      '[12:00:00] [Server thread/INFO]: Ada[/127.0.0.1:50000] logged in with entity id 3 at (1, 2, 3)',
      '[12:00:00] [Server thread/INFO]: Ada joined the game',
      '[12:00:01] [Server thread/INFO]: First joined the game',
      '[12:00:02] [Server thread/INFO]: [Not Secure] <Ada> Follow me.',
      '[12:00:03] [Server thread/INFO]: Ada was slain by Zombie',
      '',
    ].join('\n'),
  );
  const residents = ['First', 'Second'].map((entityId, index) => {
    const journalDirectory = path.join(root, entityId);
    fs.mkdirSync(journalDirectory);
    fs.writeFileSync(
      path.join(journalDirectory, 'run.jsonl'),
      `${JSON.stringify({
        sequence: index + 2,
        at: `2026-08-02T12:00:0${index}.000Z`,
        agent: entityId,
        type: index === 0 ? 'setup_external_player_intervention' : 'external_player_intervention',
        data: {
          protocol: 'behold.external-player-intervention.v1',
          kind: index === 0 ? 'joined' : 'chat',
          username: 'Ada',
          classification: 'native_human_or_unmanaged_player',
          ...(index === 0 ? {} : { channel: 'public', text: 'Follow me.' }),
        },
      })}\n`,
    );
    return { entityId, bodyUsername: entityId, journalDirectory };
  });

  const summary = summarizeExternalPlayers({ ecologyLogFile: ecology, residents });
  assert.equal(summary.protocol, 'behold.live-external-players.v1');
  assert.deepEqual(
    summary.players.map((player) => player.username),
    ['Ada'],
  );
  assert.equal(summary.players[0]?.classification, 'unmanaged_player_client_provenance_unknown');
  assert.deepEqual(
    summary.players[0]?.serverEvents.map((event) => event.kind),
    ['logged_in', 'joined', 'chat', 'event'],
  );
  assert.deepEqual(
    summary.players[0]?.residentWitnesses.map((witness) => ({
      entityId: witness.entityId,
      observed: witness.observed,
      phase: witness.events[0]?.phase,
    })),
    [
      { entityId: 'First', observed: true, phase: 'setup' },
      { entityId: 'Second', observed: true, phase: 'runtime' },
    ],
  );
});

test('native-human readiness names the ordinary client path and a completed episode keeps its head', () => {
  assert.equal(
    nativeHumanJoinInstruction('127.0.0.1', 25565, '1.21.4', 'Ada'),
    '[behold live] native human Ada: in Minecraft Java 1.21.4, open Multiplayer > Direct Connection and join 127.0.0.1:25565\n',
  );
  assert.equal(
    shouldRecordPlaceOnlyCleanup({
      cleanStop: true,
      hasAuthority: true,
      hadExistingPlan: true,
      managedLifecycleObserved: false,
      headExists: true,
    }),
    false,
  );
  assert.equal(
    shouldRecordPlaceOnlyCleanup({
      cleanStop: false,
      hasAuthority: true,
      hadExistingPlan: true,
      managedLifecycleObserved: false,
      headExists: true,
    }),
    true,
  );
});

test('live resume instruction retains the exact Place runtime and native-player check', () => {
  assert.equal(
    liveResumeInstruction({
      releaseRoot: '/places/Oxford release',
      sessionId: 'oxford-life',
      nativePlayer: 'importdf',
      placeCompiler: { kind: 'checkout', root: '/worktrees/place-103deac' },
    }),
    "behold live '/places/Oxford release' --accept-eula --session oxford-life --place-compiler /worktrees/place-103deac --native-player importdf",
  );

  assert.equal(
    liveResumeInstruction({
      releaseRoot: '/places/oxford',
      sessionId: 'oxford-life',
      nativePlayer: null,
      placeCompiler: {
        kind: 'binary',
        binary: '/bin/place-compiler',
        version: '1.2.3',
        distributionSha256: 'a'.repeat(64),
      },
    }),
    `behold live /places/oxford --accept-eula --session oxford-life --place-compiler-bin /bin/place-compiler --place-compiler-version 1.2.3 --place-compiler-distribution-sha256 ${'a'.repeat(64)}`,
  );
});

function residentLyncBytes(
  entityId: string,
  profile: 'org.behold.inhabitant.v1' | 'org.behold.inhabitant.v2',
  id: string,
) {
  return `${JSON.stringify({
    v: 1,
    id,
    kind: 'lync/loom',
    payload: { meta: { protocol: 'behold.entity-loom.v1', profile, entityId } },
  })}\n`;
}

function authenticatedLyncEpisode(protocol: string, lives: any, artifact: any) {
  const base = {
    protocol,
    lives,
    textile: { artifact },
  };
  return { ...base, digest: sha256(stableJson(base)) };
}

function fileSha256(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
