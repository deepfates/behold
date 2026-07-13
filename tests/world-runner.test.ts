import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isControllerReadyLine,
  isMinecraftReadyLine,
  isMinecraftSaveAcknowledgement,
  resetHeldManagedWorldFixture,
  startManagedWorld,
  WorldRunnerError,
} from '../scripts/world-runner';
import { acquireWorldControl, inspectWorldControl } from '../src/runtime/world-control';
import {
  createFixtureExecutionCapability,
  digestTree,
  type OwnershipEvidence,
  type WorldLabDefinition,
} from '../scripts/world-lab';

const CLEAR: OwnershipEvidence = { state: 'clear', probe: 'fixture', owners: [] };
const ARTIFACTS_OK = { artifactIntegrityOk: true, artifacts: {} };

test('lifecycle markers require exact positive protocol lines', () => {
  assert.equal(
    isMinecraftReadyLine('[12:00:00] [Server thread/INFO]: Done (0.1s)! For help, type "help"'),
    true,
  );
  assert.equal(isMinecraftReadyLine('Not Done loading world'), false);
  assert.equal(isControllerReadyLine('[bot] Spawned in the world.'), true);
  assert.equal(isControllerReadyLine('expected marker was: [bot] Spawned in the world.'), false);
  assert.equal(
    isMinecraftSaveAcknowledgement('[12:00:01] [Server thread/INFO]: Saved the game'),
    true,
  );
  assert.equal(isMinecraftSaveAcknowledgement('Saved the game failed'), false);
});

test('managed world runner owns readiness, controller lease, save, stop, and durable evidence', async (t) => {
  const fixture = makeFixture(t);
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
  const spawnController = ({ runId }: { runId: string }) => {
    const script = `
      const fs = require('node:fs');
      const os = require('node:os');
      const lease = process.argv[1];
      const entityId = process.argv[2];
      const managedRunId = process.argv[3];
      fs.writeFileSync(lease, JSON.stringify({
        protocol: 'behold.entity-runtime-lease.v1',
        entityId,
        pid: process.pid,
        hostname: os.hostname(),
        managedRunId,
      }));
      console.log('[bot] Spawned in the world.');
      process.stdin.resume();
      process.stdin.on('end', () => {
        fs.unlinkSync(lease);
        process.exit(0);
      });
    `;
    return spawn(process.execPath, ['-e', script, fixture.lease, 'Scout', runId], {
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
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'held');
  assert.equal(run.runId, 'fixture-1');
  assert.equal(fs.existsSync(fixture.lease), true);
  assert.equal(run.control.record().state, 'running');

  await run.stop('fixture_complete');
  await run.finished;

  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
  assert.equal(fs.existsSync(fixture.lease), false);
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
  const spawnController = ({ runId }: { runId: string }) => {
    const script = `
      const fs = require('node:fs');
      const os = require('node:os');
      const lease = process.argv[1];
      const managedRunId = process.argv[2];
      fs.writeFileSync(lease, JSON.stringify({
        protocol: 'behold.entity-runtime-lease.v1', entityId: 'Scout',
        pid: process.pid, hostname: os.hostname(), managedRunId
      }));
      console.log('[bot] Spawned in the world.');
      process.stdin.resume();
      process.stdin.on('end', () => { fs.unlinkSync(lease); process.exit(7); });
    `;
    return spawn(process.execPath, ['-e', script, fixture.lease, runId], {
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
  const lease = path.join(root, 'entities', 'Scout', 'runtime.lock');
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
      controllerEntityId: 'Scout',
      controllerLeasePath: lease,
      model: 'fixture/model',
      task: 'come-see-do-report',
      target: 'human',
      allowTools: ['chat', 'approach_entity'],
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
