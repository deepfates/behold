import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertLiveMindRevisionCompatible,
  assessNativeHumanEntry,
  createLiveBoundary,
  listPlaceServerLogs,
  liveEpisodeAccountingScope,
  liveResumeInstruction,
  nativeHumanJoinInstruction,
  preserveResidentLyncFiles,
  preservePlaceServerLog,
  preserveTextileImport,
  selectLiveResidentConfiguration,
  shouldRecordPlaceOnlyCleanup,
} from '../src/cli/live';

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
      providerQuotas: { residentDecisionAttempts: 8, auxiliaryContextAttempts: 2 },
      providerRoute: { protocol: 'provider' },
    },
  ];
  assert.doesNotThrow(() =>
    assertLiveMindRevisionCompatible(original, [
      {
        ...original[0],
        model: 'local/model@4bit',
        providerQuotas: { residentDecisionAttempts: 16, auxiliaryContextAttempts: 4 },
        providerRoute: undefined,
        lmStudioLocal: { protocol: 'local' },
      },
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

test('live episode record freezes lifelong Lync bytes and makes one direct Textile import', (t) => {
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
