import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COME_SEE_DO_REPORT_ALLOW_TOOLS,
  isControllerReadyLine,
  isMinecraftReadyLine,
  isMinecraftSaveAcknowledgement,
  managedControllerProfile,
  recoverAbandonedManagedWorld,
  resetHeldManagedWorldFixture,
  startManagedWorld,
  WorldRunnerError,
} from '../scripts/world-runner';
import {
  acquireWorldControl,
  inspectWorldControl,
  verifyWorldLifecycleJournal,
} from '../src/runtime/world-control';
import {
  createFixtureExecutionCapability,
  digestTree,
  type OwnershipEvidence,
  type WorldLabDefinition,
} from '../scripts/world-lab';
import { verifyCognitionBrokerJournal } from '../src/mind/cognition-broker';
import { COGNITION_TRANSPORT_PROTOCOL } from '../src/mind/cognition';

const CLEAR: OwnershipEvidence = { state: 'clear', probe: 'fixture', owners: [] };
const ARTIFACTS_OK = { artifactIntegrityOk: true, artifacts: {} };

test('lifecycle markers require exact positive protocol lines', () => {
  assert.equal(
    isMinecraftReadyLine('[12:00:00] [Server thread/INFO]: Done (0.1s)! For help, type "help"'),
    true,
  );
  assert.equal(isMinecraftReadyLine('Not Done loading world'), false);
  assert.equal(isControllerReadyLine('[bot] Local world loaded.'), true);
  assert.equal(isControllerReadyLine('expected marker was: [bot] Local world loaded.'), false);
  assert.equal(
    isMinecraftSaveAcknowledgement('[12:00:01] [Server thread/INFO]: Saved the game'),
    true,
  );
  assert.equal(isMinecraftSaveAcknowledgement('Saved the game failed'), false);
});

test('the direct proof resident accepts the canonical managed-runner arguments', () => {
  const result = spawnSync(
    process.execPath,
    [path.resolve('dist/scripts/owned-world-inhabitant.js'), '--tickMs', '4000'],
    { encoding: 'utf8', env: { ...process.env, VIEWER_ENABLED: '0' } },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /owned-world inhabitant requires an entity name/);
  assert.doesNotMatch(result.stderr, /Unknown option/);
});

test('the normal managed controller is an untasked resident with no benchmark allowlist', () => {
  assert.deepEqual(managedControllerProfile(), {});
  assert.deepEqual(managedControllerProfile('  ordinary-life  ', '  '), {
    task: 'ordinary-life',
  });
  assert.throws(
    () => managedControllerProfile(undefined, 'importdf'),
    (error: any) => error?.code === 'controller_target_without_task',
  );
});

test('Come-See-Do-Report is an explicit managed evaluation profile', () => {
  assert.deepEqual(managedControllerProfile('come-see-do-report'), {
    task: 'come-see-do-report',
    target: 'importdf',
    allowTools: COME_SEE_DO_REPORT_ALLOW_TOOLS,
  });
  assert.deepEqual(managedControllerProfile('come-see-do-report', 'Builder'), {
    task: 'come-see-do-report',
    target: 'Builder',
    allowTools: COME_SEE_DO_REPORT_ALLOW_TOOLS,
  });
});

test('resident configuration rejects canonical identity collisions and process-budget overflow before inspecting or mutating the world', async (t) => {
  const fixture = makeFixture(t);
  let inspections = 0;
  const dependencies = {
    inspectRuntime: async () => {
      inspections += 1;
      return runtimeEvidence(null);
    },
    verifyArtifacts: async () => ARTIFACTS_OK,
  };
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          residents: [
            { entityId: 'Scout Life', model: 'fixture/model' },
            { entityId: 'Scout-Life', model: 'fixture/model' },
          ],
        },
        dependencies,
      ),
    (error: any) => error?.code === 'resident_identity_collision',
  );
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          maxResidents: 1,
          residents: [
            { entityId: 'Scout', model: 'fixture/model' },
            { entityId: 'Builder', model: 'fixture/model' },
          ],
        },
        dependencies,
      ),
    (error: any) => error?.code === 'resident_limit_exceeded',
  );
  assert.equal(inspections, 0);
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');

  await assert.rejects(
    () => startManagedWorld({ ...fixture.options, residentStartupDelayMs: -1 }, dependencies),
    (error: any) => error?.code === 'resident_start_delay_invalid',
  );
  assert.equal(inspections, 0);
  await assert.rejects(
    () => startManagedWorld({ ...fixture.options, maxConcurrentModelCalls: 2 }, dependencies),
    (error: any) => error?.code === 'model_concurrency_limit_invalid',
  );
  assert.equal(inspections, 0);
});

test('managed cognition keeps the provider key in the runner and drains before Minecraft stops', async (t) => {
  const fixture = makeFixture(t);
  const captureFile = path.join(fixture.root, 'controller-environment.json');
  const controllerEntry = path.join(fixture.root, 'fixture-controller.js');
  fs.writeFileSync(
    controllerEntry,
    `
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const crypto = require('node:crypto');
      const entityId = process.argv[2];
      const lease = path.join(process.env.BEHOLD_ENTITY_DIR, entityId, 'runtime.lock');
      fs.mkdirSync(path.dirname(lease), { recursive: true });
      fs.writeFileSync(lease, JSON.stringify({
        protocol: 'behold.entity-runtime-lease.v1', entityId,
        pid: process.pid, hostname: os.hostname(), managedRunId: process.env.BEHOLD_RUN_ID
      }));
      const localKey = String(process.env.OPENROUTER_API_KEY || '');
      fs.writeFileSync(${JSON.stringify(captureFile)}, JSON.stringify({
        keySha256: crypto.createHash('sha256').update(localKey).digest('hex'),
        keyLength: localKey.length,
        endpoint: process.env.OPENROUTER_BASE_URL,
        transport: process.env.BEHOLD_COGNITION_TRANSPORT,
        refererPresent: process.env.OPENROUTER_REFERER != null,
        titlePresent: process.env.OPENROUTER_TITLE != null,
        ambientCloudCredentialPresent: process.env.AWS_SECRET_ACCESS_KEY != null,
        dotenvDisabled: process.env.BEHOLD_LOAD_DOTENV === '0'
      }));
      console.log('[bot] Local world loaded.');
      process.stdin.resume();
      process.stdin.on('end', () => {
        if (fs.existsSync(lease)) fs.unlinkSync(lease);
        process.exit(0);
      });
    `,
  );
  const prior = {
    key: process.env.OPENROUTER_API_KEY,
    base: process.env.OPENROUTER_BASE_URL,
    referer: process.env.OPENROUTER_REFERER,
    title: process.env.OPENROUTER_TITLE,
    cloud: process.env.AWS_SECRET_ACCESS_KEY,
  };
  const providerSecret = 'provider-secret-never-in-child';
  process.env.OPENROUTER_API_KEY = providerSecret;
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
  process.env.OPENROUTER_REFERER = 'https://private.example';
  process.env.OPENROUTER_TITLE = 'private title';
  process.env.AWS_SECRET_ACCESS_KEY = 'ambient-cloud-secret';
  t.after(() => {
    restoreTestEnvironment('OPENROUTER_API_KEY', prior.key);
    restoreTestEnvironment('OPENROUTER_BASE_URL', prior.base);
    restoreTestEnvironment('OPENROUTER_REFERER', prior.referer);
    restoreTestEnvironment('OPENROUTER_TITLE', prior.title);
    restoreTestEnvironment('AWS_SECRET_ACCESS_KEY', prior.cloud);
  });

  let serverPid: number | null = null;
  let serverAlive = false;
  const spawnServer = () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
          const readline = require('node:readline');
          console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
          const rl = readline.createInterface({ input: process.stdin });
          rl.on('line', (line) => {
            if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
            if (line === 'stop') process.exit(0);
          });
        `,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    ) as ChildProcessWithoutNullStreams;
    serverPid = child.pid!;
    serverAlive = true;
    child.once('exit', () => {
      serverAlive = false;
    });
    return child;
  };
  const run = await startManagedWorld(
    { ...fixture.options, controllerEntry, maxConcurrentModelCalls: 1 },
    {
      spawnServer,
      verifyArtifacts: async () => ARTIFACTS_OK,
      inspectRuntime: async () => runtimeEvidence(serverAlive && serverPid ? serverPid : null),
      stdout: () => {},
      stderr: () => {},
    },
  );
  assert.ok(run.cognition);
  assert.equal(run.cognition.concurrencyLimit, 1);
  const captured = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  assert.notEqual(captured.keySha256, createHash('sha256').update(providerSecret).digest('hex'));
  assert.ok(captured.keyLength >= 32);
  assert.match(captured.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/v1\/chat\/completions$/);
  assert.equal(captured.transport, COGNITION_TRANSPORT_PROTOCOL);
  assert.equal(captured.refererPresent, false);
  assert.equal(captured.titlePresent, false);
  assert.equal(captured.ambientCloudCredentialPresent, false);
  assert.equal(captured.dotenvDisabled, true);

  await run.stop('cognition_fixture_complete');
  await run.finished;
  const verified = verifyCognitionBrokerJournal(run.cognition.journalFile);
  assert.equal(verified.peakActive, 0);
  const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile).events;
  const drained = lifecycle.findIndex((event) => event.type === 'cognition_broker_drained');
  const saved = lifecycle.findIndex((event) => event.type === 'server_save_acknowledged');
  assert.ok(drained >= 0 && saved > drained);
  assert.equal(lifecycle.at(-1)?.type, 'control_released');
});

test('recovery preserves evidence before releasing an exact dead same-host epoch', async (t) => {
  const fixture = makeFixture(t);
  const entityRoot = path.dirname(path.dirname(fixture.lease));
  const builderLease = path.join(entityRoot, 'Builder', 'runtime.lock');
  fs.mkdirSync(path.dirname(builderLease), { recursive: true });
  fs.writeFileSync(
    path.join(path.dirname(fixture.lease), 'circle.json'),
    JSON.stringify({
      protocol: 'behold.entity-circle-binding.v1',
      entityId: 'Scout',
      circleId: 'fixture',
    }),
  );
  fs.writeFileSync(
    path.join(path.dirname(builderLease), 'circle.json'),
    JSON.stringify({
      protocol: 'behold.entity-circle-binding.v1',
      entityId: 'Builder',
      circleId: 'fixture',
    }),
  );
  const worldControlModule = path.resolve(__dirname, '../src/runtime/world-control.js');
  const abandoned = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const fs = require('node:fs');
        const os = require('node:os');
        const { acquireWorldControl } = require(process.argv[1]);
        const controlRoot = process.argv[2];
        const runtime = process.argv[3];
        const scoutLease = process.argv[4];
        const builderLease = process.argv[5];
        const control = acquireWorldControl({
          controlRoot, world: 'fixture', runtimePath: runtime,
          pid: process.pid, hostname: os.hostname()
        });
        fs.writeFileSync(scoutLease, JSON.stringify({
          protocol: 'behold.entity-runtime-lease.v1', entityId: 'Scout',
          pid: process.pid, hostname: os.hostname(), managedRunId: 'fixture-1',
          startedAt: Date.now(), token: 'fixture-token'
        }));
        fs.writeFileSync(builderLease, JSON.stringify({
          protocol: 'behold.entity-runtime-lease.v1', entityId: 'Builder',
          pid: process.pid, hostname: os.hostname(), managedRunId: 'fixture-1',
          startedAt: Date.now(), token: 'builder-token'
        }));
        control.update('starting', {
          server: { pid: process.pid, jarSha256: 'abc' },
          controllers: [
            { entityId: 'Scout', pid: process.pid, leasePath: scoutLease },
            { entityId: 'Builder', pid: process.pid, leasePath: builderLease }
          ]
        });
        control.update('recovery_required');
      `,
      worldControlModule,
      fixture.controlRoot,
      fixture.options.world.runtime.worldPath,
      fixture.lease,
      builderLease,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(abandoned.status, 0, abandoned.stderr);
  const held = inspectWorldControl(fixture.controlRoot, 'fixture');
  assert.equal(held.state, 'held');
  assert.equal(held.state === 'held' ? held.record.state : null, 'recovery_required');
  const lifecycleFile = path.join(fixture.controlRoot, 'fixture', 'lifecycle-1.jsonl');
  const lifecycleTip = verifyWorldLifecycleJournal(lifecycleFile).tipDigest;

  let clock = 0;
  const recovered = await recoverAbandonedManagedWorld(
    {
      worldId: 'fixture',
      world: fixture.options.world,
      controlRoot: fixture.controlRoot,
      entityRoot,
    },
    {
      inspectRuntime: async () => runtimeEvidence(null),
      now: () => new Date(++clock * 1000),
    },
  );

  assert.equal(recovered.classification, 'abandoned_unclean_shutdown');
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
  assert.equal(fs.existsSync(fixture.lease), false);
  assert.equal(fs.existsSync(builderLease), false);
  assert.equal(fs.existsSync(recovered.preparedEvidence), true);
  assert.equal(fs.existsSync(recovered.completedEvidence), true);
  const prepared = JSON.parse(fs.readFileSync(recovered.preparedEvidence, 'utf8'));
  const completed = JSON.parse(fs.readFileSync(recovered.completedEvidence, 'utf8'));
  assert.equal(prepared.lifecycle.tipDigest, lifecycleTip);
  assert.equal(prepared.lifecycle.saveAcknowledged, false);
  assert.equal(prepared.controllerLeases.length, 2);
  assert.deepEqual(prepared.controllerLeases.map((lease: any) => lease.record.entityId).sort(), [
    'Builder',
    'Scout',
  ]);
  assert.ok(
    prepared.controllerLeases.every((lease: any) => lease.record.managedRunId === 'fixture-1'),
  );
  assert.equal(completed.preparedSha256.length, 64);
  assert.equal(verifyWorldLifecycleJournal(lifecycleFile).tipDigest, lifecycleTip);

  const next = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: 'fixture',
    runtimePath: fixture.options.world.runtime.worldPath,
  });
  assert.equal(next.record().epoch, 2);
  next.release();
});

test('managed world runner owns conjunctive readiness, distinct leases, drain, save, and stop for two residents', async (t) => {
  const fixture = makeFixture(t);
  const builderLease = path.join(fixture.options.entityRoot, 'Builder', 'runtime.lock');
  const options = {
    ...fixture.options,
    residentStartupDelayMs: 1,
    residents: [
      ...fixture.options.residents,
      {
        entityId: 'Builder',
        model: 'fixture/alternate-model',
        mind: 'ax' as const,
        tickMs: 1500,
      },
    ],
  };
  const commandLog = path.join(fixture.root, 'server-commands.log');
  let serverPid: number | null = null;
  let serverAlive = false;

  const spawnServer = () => {
    const script = `
      const fs = require('node:fs');
      const readline = require('node:readline');
      const log = process.argv[1];
      console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        fs.appendFileSync(log, line + '\\n');
        if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
        if (line === 'stop') process.exit(0);
      });
    `;
    const child = spawn(process.execPath, ['-e', script, commandLog], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    serverPid = child.pid!;
    serverAlive = true;
    child.once('exit', () => {
      serverAlive = false;
    });
    return child;
  };
  const spawnController = ({ runId, resident, leasePath }: any) => {
    const script = `
      const fs = require('node:fs');
      const os = require('node:os');
      const lease = process.argv[1];
      const entityId = process.argv[2];
      const managedRunId = process.argv[3];
      fs.mkdirSync(require('node:path').dirname(lease), { recursive: true });
      fs.writeFileSync(lease, JSON.stringify({
        protocol: 'behold.entity-runtime-lease.v1',
        entityId,
        pid: process.pid,
        hostname: os.hostname(),
        managedRunId,
      }));
      console.log('[bot] Local world loaded.');
      process.stdin.resume();
      process.stdin.on('end', () => {
        fs.unlinkSync(lease);
        process.exit(0);
      });
    `;
    return spawn(process.execPath, ['-e', script, leasePath, resident.entityId, runId], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
  };

  const run = await startManagedWorld(options, {
    spawnServer,
    spawnController,
    verifyArtifacts: async () => ARTIFACTS_OK,
    inspectRuntime: async () => runtimeEvidence(serverAlive && serverPid ? serverPid : null),
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'held');
  assert.equal(run.runId, 'fixture-1');
  assert.equal(fs.existsSync(fixture.lease), true);
  assert.equal(fs.existsSync(builderLease), true);
  assert.equal(run.control.record().state, 'running');
  assert.deepEqual(
    run.residents.map((resident) => resident.entityId),
    ['Scout', 'Builder'],
  );
  assert.equal(new Set(run.residents.map((resident) => resident.leasePath)).size, 2);
  assert.equal(new Set(run.residents.map((resident) => resident.journalDirectory)).size, 2);
  assert.equal(run.control.record().controllers.length, 2);

  await run.quiesceResidents('fixture_witness');
  assert.equal(fs.existsSync(fixture.lease), false);
  assert.equal(fs.existsSync(builderLease), false);
  assert.equal(run.control.record().state, 'running');
  assert.deepEqual(run.control.record().controllers, []);
  assert.equal(serverAlive, true);

  await run.stop('fixture_complete');
  await run.finished;

  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
  assert.equal(fs.existsSync(fixture.lease), false);
  assert.equal(fs.existsSync(builderLease), false);
  assert.deepEqual(fs.readFileSync(commandLog, 'utf8').trim().split('\n'), [
    'save-all flush',
    'stop',
  ]);
  const events = fs
    .readFileSync(run.control.journalFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.type === 'server_ready'));
  assert.ok(events.some((event) => event.type === 'run_ready'));
  assert.equal(events.filter((event) => event.type === 'controller_ready').length, 2);
  assert.deepEqual(events.find((event) => event.type === 'resident_start_stagger')?.data, {
    afterEntityId: 'Scout',
    beforeEntityId: 'Builder',
    milliseconds: 1,
  });
  assert.ok(events.some((event) => event.type === 'residents_quiesced'));
  assert.ok(events.some((event) => event.type === 'server_save_acknowledged'));
  assert.ok(events.some((event) => event.type === 'run_stopped'));
  assert.equal(events.at(-1).type, 'control_released');
});

test('held lifecycle authority executes the canonical reset and rebinds the runtime inode', async (t) => {
  const fixture = makeManagedResetFixture(t);
  const beforeInode = fs.statSync(fixture.runtime).ino;
  const control = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: 'fixture',
    runtimePath: fixture.runtime,
  });
  const clear = async (): Promise<OwnershipEvidence> => ({ ...CLEAR });

  const result = await resetHeldManagedWorldFixture(
    {
      worldId: 'fixture',
      world: fixture.world,
      control,
      resetRunId: 'managed-reset-one',
      entityRoot: fixture.entityRoot,
    },
    {
      probeSessionLock: clear,
      probeListeningPort: clear,
      fixtureExecutionCapability: fixture.fixtureCapability,
    },
  );

  assert.equal(result.mode, 'executed');
  assert.equal(control.record().state, 'stopped_verified');
  assert.equal(control.record().runtime.inode, fs.statSync(fixture.runtime).ino);
  assert.notEqual(control.record().runtime.inode, beforeInode);
  assert.equal(digestTree(fixture.runtime).digest, fixture.world.preparedBaseline?.expectedDigest);
  assert.equal(fs.readFileSync(path.join(fixture.runtime, 'level.dat'), 'utf8'), 'prepared');
  assert.equal(
    fs.readFileSync(path.join(result.archivePath!, 'old-run.txt'), 'utf8'),
    'persistent consequence',
  );
  const firstActivatedInode = control.record().runtime.inode;
  control.release();
  const secondControl = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: 'fixture',
    runtimePath: fixture.runtime,
  });
  assert.equal(secondControl.record().epoch, 2);
  const second = await resetHeldManagedWorldFixture(
    {
      worldId: 'fixture',
      world: fixture.world,
      control: secondControl,
      resetRunId: 'managed-reset-two',
      entityRoot: fixture.entityRoot,
    },
    {
      probeSessionLock: clear,
      probeListeningPort: clear,
      fixtureExecutionCapability: fixture.fixtureCapability,
    },
  );
  assert.equal(second.mode, 'executed');
  assert.equal(secondControl.record().state, 'stopped_verified');
  assert.notEqual(secondControl.record().runtime.inode, firstActivatedInode);
  assert.equal(digestTree(fixture.runtime).digest, fixture.world.preparedBaseline?.expectedDigest);
  secondControl.release();
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('a controller lease appearing during staging fences activation and requires recovery', async (t) => {
  const fixture = makeManagedResetFixture(t);
  const control = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: 'fixture',
    runtimePath: fixture.runtime,
  });
  const clear = async (): Promise<OwnershipEvidence> => ({ ...CLEAR });

  await assert.rejects(
    () =>
      resetHeldManagedWorldFixture(
        {
          worldId: 'fixture',
          world: fixture.world,
          control,
          resetRunId: 'lease-race',
          entityRoot: fixture.entityRoot,
        },
        {
          probeSessionLock: clear,
          probeListeningPort: clear,
          mutationOperations: {
            copyDirectory(from, to) {
              fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: true });
              const entityDirectory = path.join(fixture.entityRoot, 'Scout');
              fs.mkdirSync(entityDirectory, { recursive: true });
              fs.writeFileSync(
                path.join(entityDirectory, 'circle.json'),
                JSON.stringify({
                  protocol: 'behold.entity-circle-binding.v1',
                  entityId: 'Scout',
                  circleId: 'minecraft://127.0.0.1:25598',
                }),
              );
              fs.writeFileSync(
                path.join(entityDirectory, 'runtime.lock'),
                JSON.stringify({
                  protocol: 'behold.entity-runtime-lease.v1',
                  entityId: 'Scout',
                  pid: 77,
                }),
              );
            },
          },
          fixtureExecutionCapability: fixture.fixtureCapability,
        },
      ),
    /Baseline activation failed/,
  );

  assert.equal(control.record().state, 'recovery_required');
  assert.equal(
    fs.readFileSync(path.join(fixture.runtime, 'old-run.txt'), 'utf8'),
    'persistent consequence',
  );
  assert.throws(() => control.release(), /cannot release/);
});

test('managed world runner refuses foreign ownership before spawning or taking control', async (t) => {
  const fixture = makeFixture(t);
  let spawns = 0;
  await assert.rejects(
    () =>
      startManagedWorld(fixture.options, {
        inspectRuntime: async () => runtimeEvidence(999),
        verifyArtifacts: async () => ARTIFACTS_OK,
        spawnServer: () => {
          spawns += 1;
          throw new Error('must not spawn');
        },
      }),
    (error: any) => {
      assert.ok(error instanceof WorldRunnerError);
      assert.equal(error.code, 'world_not_stopped');
      return true;
    },
  );
  assert.equal(spawns, 0);
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('managed world runner refuses an existing controller lease bound to the world', async (t) => {
  const fixture = makeFixture(t);
  const entityDirectory = path.join(path.dirname(path.dirname(fixture.lease)), 'Other');
  fs.mkdirSync(entityDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(entityDirectory, 'circle.json'),
    JSON.stringify({
      protocol: 'behold.entity-circle-binding.v1',
      entityId: 'Other',
      circleId: 'fixture',
    }),
  );
  fs.writeFileSync(
    path.join(entityDirectory, 'runtime.lock'),
    JSON.stringify({ protocol: 'behold.entity-runtime-lease.v1', entityId: 'Other', pid: 99 }),
  );
  let spawns = 0;
  await assert.rejects(
    () =>
      startManagedWorld(fixture.options, {
        inspectRuntime: async () => runtimeEvidence(null),
        verifyArtifacts: async () => ARTIFACTS_OK,
        spawnServer: () => {
          spawns += 1;
          throw new Error('must not spawn');
        },
      }),
    (error: any) => {
      assert.equal(error.code, 'world_controller_lease_not_clear');
      return true;
    },
  );
  assert.equal(spawns, 0);
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('managed world runner directly refuses its configured lease even with another circle binding', async (t) => {
  const fixture = makeFixture(t);
  const entityDirectory = path.dirname(fixture.lease);
  fs.writeFileSync(
    path.join(entityDirectory, 'circle.json'),
    JSON.stringify({
      protocol: 'behold.entity-circle-binding.v1',
      entityId: 'Scout',
      circleId: 'another-world',
    }),
  );
  fs.writeFileSync(
    fixture.lease,
    JSON.stringify({ protocol: 'behold.entity-runtime-lease.v1', entityId: 'Scout', pid: 100 }),
  );
  await assert.rejects(
    () =>
      startManagedWorld(fixture.options, {
        inspectRuntime: async () => runtimeEvidence(null),
        verifyArtifacts: async () => ARTIFACTS_OK,
      }),
    (error: any) => {
      assert.equal(error.code, 'configured_controller_lease_present');
      return true;
    },
  );
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('managed world runner verifies the pinned server jar before acquiring authority', async (t) => {
  const fixture = makeFixture(t);
  await assert.rejects(
    () =>
      startManagedWorld(
        { ...fixture.options, expectedServerJarSha256: '0'.repeat(64) },
        {
          inspectRuntime: async () => runtimeEvidence(null),
          verifyArtifacts: async () => ARTIFACTS_OK,
        },
      ),
    (error: any) => {
      assert.equal(error.code, 'server_jar_digest_mismatch');
      return true;
    },
  );
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('managed world runner refuses unverified source or baseline artifacts before control', async (t) => {
  const fixture = makeFixture(t);
  await assert.rejects(
    () =>
      startManagedWorld(fixture.options, {
        inspectRuntime: async () => runtimeEvidence(null),
        verifyArtifacts: async () => ({
          artifactIntegrityOk: false,
          artifacts: { preparedBaseline: { matches: false } },
        }),
      }),
    (error: any) => {
      assert.equal(error.code, 'world_artifact_integrity_failed');
      return true;
    },
  );
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('a failed readiness proof cleanly saves and stops the child it started', async (t) => {
  const fixture = makeFixture(t);
  const commandLog = path.join(fixture.root, 'failed-start-commands.log');
  const spawnServer = () => {
    const script = `
      const fs = require('node:fs');
      const readline = require('node:readline');
      const log = process.argv[1];
      console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        fs.appendFileSync(log, line + '\\n');
        if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
        if (line === 'stop') process.exit(0);
      });
    `;
    return spawn(process.execPath, ['-e', script, commandLog], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
  };

  await assert.rejects(
    () =>
      startManagedWorld(
        { ...fixture.options, startupTimeoutMs: 150, shutdownTimeoutMs: 1000 },
        {
          spawnServer,
          verifyArtifacts: async () => ARTIFACTS_OK,
          inspectRuntime: async () => runtimeEvidence(null),
          stdout: () => {},
          stderr: () => {},
        },
      ),
    (error: any) => {
      assert.equal(error.code, 'runner_timeout');
      return true;
    },
  );

  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
  assert.deepEqual(fs.readFileSync(commandLog, 'utf8').trim().split('\n'), [
    'save-all flush',
    'stop',
  ]);
});

test('an early child exit is recorded and releases control when OS evidence is clear', async (t) => {
  const fixture = makeFixture(t);
  await assert.rejects(
    () =>
      startManagedWorld(fixture.options, {
        spawnServer: () =>
          spawn(
            process.execPath,
            ['-e', "console.error('fixture boot failure'); process.exit(7)"],
            {
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          ) as ChildProcessWithoutNullStreams,
        inspectRuntime: async () => runtimeEvidence(null),
        verifyArtifacts: async () => ARTIFACTS_OK,
        stdout: () => {},
        stderr: () => {},
      }),
    (error: any) => {
      assert.equal(error.code, 'child_exited_before_ready');
      assert.equal(error.evidence.code, 7);
      return true;
    },
  );
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('one resident exiting makes the shared epoch unhealthy and drains every remaining child', async (t) => {
  const fixture = makeFixture(t);
  let serverPid: number | null = null;
  let serverAlive = false;
  const spawnServer = () => {
    const script = `
      const readline = require('node:readline');
      console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
        if (line === 'stop') process.exit(0);
      });
    `;
    const child = spawn(process.execPath, ['-e', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    serverPid = child.pid!;
    serverAlive = true;
    child.once('exit', () => {
      serverAlive = false;
    });
    return child;
  };
  const spawnController = ({ runId, resident, leasePath }: any) => {
    const script = `
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const lease = process.argv[1];
      const entityId = process.argv[2];
      const managedRunId = process.argv[3];
      const fail = process.argv[4] === 'fail';
      fs.mkdirSync(path.dirname(lease), { recursive: true });
      fs.writeFileSync(lease, JSON.stringify({
        protocol: 'behold.entity-runtime-lease.v1', entityId,
        pid: process.pid, hostname: os.hostname(), managedRunId
      }));
      console.log('[bot] Local world loaded.');
      process.stdin.resume();
      process.stdin.on('end', () => {
        if (fs.existsSync(lease)) fs.unlinkSync(lease);
        process.exit(0);
      });
      if (fail) setTimeout(() => {
        if (fs.existsSync(lease)) fs.unlinkSync(lease);
        process.exit(7);
      }, 500);
    `;
    return spawn(
      process.execPath,
      [
        '-e',
        script,
        leasePath,
        resident.entityId,
        runId,
        resident.entityId === 'Builder' ? 'fail' : 'live',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    ) as ChildProcessWithoutNullStreams;
  };
  const run = await startManagedWorld(
    {
      ...fixture.options,
      residents: [
        { entityId: 'Scout', model: 'fixture/model' },
        { entityId: 'Builder', model: 'fixture/model' },
      ],
    },
    {
      spawnServer,
      spawnController,
      verifyArtifacts: async () => ARTIFACTS_OK,
      inspectRuntime: async () => runtimeEvidence(serverAlive && serverPid ? serverPid : null),
      stdout: () => {},
      stderr: () => {},
    },
  );

  await assert.rejects(
    run.finished,
    (error: any) =>
      error?.code === 'managed_child_exited' && error?.evidence?.name === 'controller:Builder',
  );
  await assert.rejects(
    () => run.stop('resident_failed'),
    (error: any) =>
      error?.code === 'managed_child_exit_abnormal' &&
      error.evidence.some((exit: any) => exit.name === 'controller:Builder' && exit.code === 7),
  );
  assert.equal(serverAlive, false);
  assert.equal(fs.existsSync(fixture.lease), false);
  assert.equal(
    fs.existsSync(path.join(fixture.options.entityRoot, 'Builder', 'runtime.lock')),
    false,
  );
  const inspection = inspectWorldControl(fixture.controlRoot, 'fixture');
  assert.equal(inspection.state, 'held');
  assert.equal(inspection.state === 'held' ? inspection.record.state : null, 'recovery_required');
});

test('world ownership is never released while any resident lease remains', async (t) => {
  const fixture = makeFixture(t);
  let server: ChildProcessWithoutNullStreams | null = null;
  let serverAlive = false;
  const spawnServer = () => {
    const script = `
      const readline = require('node:readline');
      console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
        if (line === 'stop') process.exit(0);
      });
    `;
    server = spawn(process.execPath, ['-e', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    serverAlive = true;
    server.once('exit', () => {
      serverAlive = false;
    });
    return server;
  };
  const spawnController = ({ runId, resident, leasePath }: any) => {
    const script = `
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const lease = process.argv[1];
      const entityId = process.argv[2];
      const managedRunId = process.argv[3];
      const retain = process.argv[4] === 'retain';
      fs.mkdirSync(path.dirname(lease), { recursive: true });
      fs.writeFileSync(lease, JSON.stringify({
        protocol: 'behold.entity-runtime-lease.v1', entityId,
        pid: process.pid, hostname: os.hostname(), managedRunId
      }));
      console.log('[bot] Local world loaded.');
      process.stdin.resume();
      process.stdin.on('end', () => {
        if (!retain && fs.existsSync(lease)) fs.unlinkSync(lease);
        process.exit(0);
      });
    `;
    return spawn(
      process.execPath,
      [
        '-e',
        script,
        leasePath,
        resident.entityId,
        runId,
        resident.entityId === 'Builder' ? 'retain' : 'release',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    ) as ChildProcessWithoutNullStreams;
  };
  const run = await startManagedWorld(
    {
      ...fixture.options,
      residents: [
        { entityId: 'Scout', model: 'fixture/model' },
        { entityId: 'Builder', model: 'fixture/model' },
      ],
      shutdownTimeoutMs: 200,
    },
    {
      spawnServer,
      spawnController,
      verifyArtifacts: async () => ARTIFACTS_OK,
      inspectRuntime: async () => runtimeEvidence(serverAlive && server?.pid ? server.pid : null),
      stdout: () => {},
      stderr: () => {},
    },
  );
  const retainedLease = path.join(fixture.options.entityRoot, 'Builder', 'runtime.lock');

  await assert.rejects(
    () => run.stop('retained_lease_fixture'),
    (error: any) =>
      error?.code === 'runner_timeout' && String(error?.evidence?.label).includes('Builder'),
  );
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'held');
  assert.equal(fs.existsSync(fixture.lease), false);
  assert.equal(fs.existsSync(retainedLease), true);

  if (server && server.exitCode === null && server.signalCode === null) {
    server.stdin.write('stop\n');
    server.stdin.end();
    await new Promise<void>((resolve) => server!.once('exit', () => resolve()));
  }
});

test('abnormal child exits can clear OS resources but never release successful control', async (t) => {
  const fixture = makeFixture(t);
  let serverPid: number | null = null;
  let serverAlive = false;
  const spawnServer = () => {
    const script = `
      const readline = require('node:readline');
      console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
        if (line === 'stop') process.exit(9);
      });
    `;
    const child = spawn(process.execPath, ['-e', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    serverPid = child.pid!;
    serverAlive = true;
    child.once('exit', () => {
      serverAlive = false;
    });
    return child;
  };
  const spawnController = ({ runId, resident, leasePath }: any) => {
    const script = `
      const fs = require('node:fs');
      const os = require('node:os');
      const lease = process.argv[1];
      const entityId = process.argv[2];
      const managedRunId = process.argv[3];
      fs.writeFileSync(lease, JSON.stringify({
        protocol: 'behold.entity-runtime-lease.v1', entityId,
        pid: process.pid, hostname: os.hostname(), managedRunId
      }));
      console.log('[bot] Local world loaded.');
      process.stdin.resume();
      process.stdin.on('end', () => { fs.unlinkSync(lease); process.exit(7); });
    `;
    return spawn(process.execPath, ['-e', script, leasePath, resident.entityId, runId], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
  };
  const run = await startManagedWorld(fixture.options, {
    spawnServer,
    spawnController,
    verifyArtifacts: async () => ARTIFACTS_OK,
    inspectRuntime: async () => runtimeEvidence(serverAlive && serverPid ? serverPid : null),
    stdout: () => {},
    stderr: () => {},
  });

  await assert.rejects(
    () => run.stop('abnormal_fixture'),
    (error: any) => {
      assert.equal(error.code, 'managed_child_exit_abnormal');
      assert.deepEqual(error.evidence.map((exit: any) => exit.code).sort(), [7, 9]);
      return true;
    },
  );
  await run.finished;
  const inspection = inspectWorldControl(fixture.controlRoot, 'fixture');
  assert.equal(inspection.state, 'held');
  if (inspection.state === 'held') {
    assert.equal(inspection.record.state, 'recovery_required');
    assert.equal(inspection.record.server, null);
    assert.deepEqual(inspection.record.controllers, []);
  }
});

function makeFixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-world-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const baseline = path.join(root, 'baseline');
  const runtime = path.join(root, 'server', 'world');
  const archive = path.join(root, 'archive');
  const controlRoot = path.join(root, 'control');
  const entityRoot = path.join(root, 'entities');
  const runRoot = path.join(root, 'runs');
  const lease = path.join(entityRoot, 'Scout', 'runtime.lock');
  const jar = path.join(root, 'server', 'server.jar');
  for (const directory of [source, baseline, runtime, archive, path.dirname(lease)]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(jar, 'fixture server jar');
  const digest = createHash('sha256').update(fs.readFileSync(jar)).digest('hex');
  const world: WorldLabDefinition = {
    source: { path: source, digestProfile: 'behold-tree-v2', expectedDigest: '1'.repeat(64) },
    preparedBaseline: {
      path: baseline,
      digestProfile: 'behold-tree-v2',
      expectedDigest: '2'.repeat(64),
    },
    runtime: { worldPath: runtime, archiveRoot: archive },
    server: { host: '127.0.0.1', port: 25599 },
  };
  return {
    root,
    controlRoot,
    lease,
    options: {
      worldId: 'fixture',
      world,
      controlRoot,
      serverDirectory: path.dirname(jar),
      serverJar: jar,
      expectedServerJarSha256: digest,
      java: process.execPath,
      controllerEntry: '/fixture/controller.js',
      entityRoot,
      runRoot,
      residents: [
        {
          entityId: 'Scout',
          model: 'fixture/model',
          task: 'come-see-do-report',
          target: 'human',
          allowTools: ['chat', 'approach_entity'],
        },
      ],
      startupTimeoutMs: 3000,
      shutdownTimeoutMs: 3000,
    },
  };
}

function makeManagedResetFixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-world-lab-managed-reset-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const baseline = path.join(root, 'baseline');
  const runtime = path.join(root, 'server', 'world');
  const archiveRoot = path.join(root, 'archive');
  const controlRoot = path.join(root, 'control');
  const entityRoot = path.join(root, 'entities');
  for (const directory of [source, baseline, runtime, archiveRoot, entityRoot]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(path.join(source, 'source.txt'), 'recovered source');
  fs.writeFileSync(path.join(baseline, 'level.dat'), 'prepared');
  fs.writeFileSync(path.join(runtime, 'old-run.txt'), 'persistent consequence');
  const world: WorldLabDefinition = {
    source: {
      path: source,
      digestProfile: 'behold-tree-v2',
      expectedDigest: digestTree(source).digest,
    },
    preparedBaseline: {
      path: baseline,
      digestProfile: 'behold-tree-v2',
      expectedDigest: digestTree(baseline).digest,
    },
    runtime: { worldPath: runtime, archiveRoot },
    server: { host: '127.0.0.1', port: 25598 },
  };
  const fixtureCapability = createFixtureExecutionCapability(root);
  return { root, runtime, archiveRoot, controlRoot, entityRoot, world, fixtureCapability };
}

function runtimeEvidence(ownerPid: number | null): any {
  const ownership: OwnershipEvidence = ownerPid
    ? { state: 'owned', probe: 'fixture', owners: [{ pid: ownerPid }] }
    : CLEAR;
  return {
    runtimeExists: true,
    runtimePath: '/fixture/runtime',
    runtimeSessionLockPath: '/fixture/runtime/session.lock',
    runtimeSessionLock: ownership,
    preparedBaselineSessionLockPath: '/fixture/baseline/session.lock',
    preparedBaselineSessionLock: CLEAR,
    serverPort: ownership,
    topology: { safe: true, blockers: [], artifacts: {} },
    safe: ownerPid == null,
    blockers: ownerPid == null ? [] : ['runtime_session_lock_owned', 'server_port_listening'],
  };
}

function restoreTestEnvironment(name: string, value: string | undefined) {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}
