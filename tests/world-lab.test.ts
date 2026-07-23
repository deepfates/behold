import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { Worker } from 'node:worker_threads';
import {
  createFixtureExecutionCapability,
  digestTree,
  inspectTopology,
  recoverWorldReset,
  resetWorld,
  runCli,
  SafetyRefusal,
  ResetExecutionError,
  statusWorld,
  TREE_DIGEST_PROFILE,
  validateWorldLabConfig,
  verifyWorld,
  type OwnershipEvidence,
  type WorldLabDefinition,
  type WorldLabDependencies,
} from '../scripts/world-lab';

const CLEAR: OwnershipEvidence = {
  state: 'clear',
  probe: 'fixture',
  owners: [],
};

const clearProbes: Pick<WorldLabDependencies, 'probeSessionLock' | 'probeListeningPort'> = {
  probeSessionLock: async () => ({ ...CLEAR }),
  probeListeningPort: async () => ({ ...CLEAR }),
};

test('tree digest is deterministic, includes structure, and excludes only root session.lock', (t) => {
  const left = temporaryDirectory(t);
  const right = temporaryDirectory(t);
  write(path.join(left, 'z.txt'), 'last');
  write(path.join(left, 'nested', 'a.txt'), 'first');
  write(path.join(left, 'session.lock'), 'owned once');

  write(path.join(right, 'nested', 'a.txt'), 'first');
  write(path.join(right, 'session.lock'), 'different ephemeral bytes');
  write(path.join(right, 'z.txt'), 'last');

  const first = digestTree(left);
  const second = digestTree(right);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.excluded, ['session.lock']);
  assert.deepEqual(second.excluded, ['session.lock']);

  fs.writeFileSync(path.join(left, 'session.lock'), 'changed while stopped');
  const afterLockChange = digestTree(left);
  assert.equal(afterLockChange.digest, first.digest);

  fs.mkdirSync(path.join(left, 'empty'));
  assert.notEqual(digestTree(left).digest, digestTree(right).digest);
  fs.mkdirSync(path.join(right, 'empty'));
  assert.equal(digestTree(left).digest, digestTree(right).digest);

  write(path.join(left, 'nested', 'session.lock'), 'nested artifact state');
  assert.notEqual(digestTree(left).digest, digestTree(right).digest);
  write(path.join(right, 'nested', 'session.lock'), 'nested artifact state');
  assert.equal(digestTree(left).digest, digestTree(right).digest);
});

test('tree digest refuses same-size concurrent rewrites even when mtime is restored', async (t) => {
  const root = temporaryDirectory(t);
  const slowFile = path.join(root, 'a-slow.bin');
  const target = path.join(root, 'z-target.bin');
  fs.writeFileSync(slowFile, Buffer.alloc(64 * 1024 * 1024, 0x61));
  fs.writeFileSync(target, Buffer.alloc(1024 * 1024, 0x62));
  const targetStats = fs.statSync(target);
  const coordination = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const state = new Int32Array(coordination);
  const worker = new Worker(
    `
      const fs = require('node:fs');
      const { workerData } = require('node:worker_threads');
      const state = new Int32Array(workerData.coordination);
      Atomics.store(state, 0, 1);
      Atomics.notify(state, 0);
      Atomics.wait(state, 1, 0);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      fs.writeFileSync(workerData.target, Buffer.alloc(workerData.size, 0x63));
      fs.utimesSync(workerData.target, workerData.atimeMs / 1000, workerData.mtimeMs / 1000);
    `,
    {
      eval: true,
      workerData: {
        coordination,
        target,
        size: targetStats.size,
        atimeMs: targetStats.atimeMs,
        mtimeMs: targetStats.mtimeMs,
      },
    },
  );
  while (Atomics.load(state, 0) === 0) Atomics.wait(state, 0, 0, 100);
  Atomics.store(state, 1, 1);
  Atomics.notify(state, 1);

  assert.throws(() => digestTree(root), /changed while it was being hashed/);
  await new Promise<void>((resolve, reject) => {
    worker.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${code}`))));
    worker.once('error', reject);
  });
});

test('config validation requires absolute, disjoint paths and explicit baseline state', (t) => {
  const fixture = makeLab(t);
  const valid = validateWorldLabConfig({ schemaVersion: 2, worlds: { fixture: fixture.world } });
  assert.equal(valid.worlds.fixture.preparedBaseline?.path, fixture.baseline);

  assert.throws(
    () => validateWorldLabConfig({ schemaVersion: 1, worlds: { fixture: fixture.world } }),
    /schemaVersion 2/,
  );
  assert.throws(
    () =>
      validateWorldLabConfig({
        schemaVersion: 2,
        worlds: {
          fixture: {
            ...fixture.world,
            source: { path: fixture.source, expectedDigest: fixture.world.source.expectedDigest },
          },
        },
      }),
    /source\.digestProfile must be behold-tree-v2/,
  );

  const missingBaseline = validateWorldLabConfig({
    schemaVersion: 2,
    worlds: { fixture: { ...fixture.world, preparedBaseline: null } },
  });
  assert.equal(missingBaseline.worlds.fixture.preparedBaseline, null);

  assert.throws(
    () =>
      validateWorldLabConfig({
        schemaVersion: 2,
        worlds: {
          fixture: {
            ...fixture.world,
            source: {
              path: './relative',
              digestProfile: TREE_DIGEST_PROFILE,
              expectedDigest: '0'.repeat(64),
            },
          },
        },
      }),
    /non-root absolute path/,
  );
  assert.throws(
    () =>
      validateWorldLabConfig({
        schemaVersion: 2,
        worlds: {
          fixture: {
            ...fixture.world,
            preparedBaseline: {
              path: fixture.runtime,
              digestProfile: TREE_DIGEST_PROFILE,
              expectedDigest: '0'.repeat(64),
            },
          },
        },
      }),
    /paths must be distinct/,
  );
});

test('normalized aliases and archive roots inside source or baseline are rejected', (t) => {
  const fixture = makeLab(t);
  const dottedSourceAlias = `${path.dirname(fixture.source)}/./${path.basename(fixture.source)}`;

  assert.throws(
    () =>
      validateWorldLabConfig({
        schemaVersion: 2,
        worlds: {
          fixture: {
            ...fixture.world,
            preparedBaseline: {
              path: dottedSourceAlias,
              digestProfile: TREE_DIGEST_PROFILE,
              expectedDigest: fixture.world.source.expectedDigest,
            },
          },
        },
      }),
    /paths must be distinct/,
    '/tmp/.\/world-style aliases must normalize to the same artifact',
  );

  for (const archiveRoot of [
    path.join(fixture.source, 'archives'),
    path.join(fixture.baseline, 'archives'),
  ]) {
    assert.throws(
      () =>
        validateWorldLabConfig({
          schemaVersion: 2,
          worlds: {
            fixture: {
              ...fixture.world,
              runtime: { ...fixture.world.runtime, archiveRoot },
            },
          },
        }),
      /archive root may not overlap/,
    );
    fs.mkdirSync(archiveRoot, { recursive: true });
    const topology = inspectTopology({
      ...fixture.world,
      runtime: { ...fixture.world.runtime, archiveRoot },
    });
    assert.equal(topology.safe, false);
    assert.ok(
      topology.blockers.includes(
        archiveRoot.startsWith(fixture.source)
          ? 'archive_root_inside_source'
          : 'archive_root_inside_prepared_baseline',
      ),
    );
  }
});

test('canonical topology catches symlink and dev/inode aliases that lexical paths miss', (t) => {
  const fixture = makeLab(t);
  const baselineAlias = path.join(fixture.root, 'baseline-alias');
  fs.symlinkSync(fixture.source, baselineAlias, 'dir');
  const aliasedBaseline: WorldLabDefinition = {
    ...fixture.world,
    preparedBaseline: {
      path: baselineAlias,
      digestProfile: TREE_DIGEST_PROFILE,
      expectedDigest: fixture.world.source.expectedDigest,
    },
  };
  const baselineTopology = inspectTopology(aliasedBaseline);
  assert.equal(baselineTopology.safe, false);
  assert.ok(baselineTopology.blockers.includes('prepared_baseline_symbolic_link_refused'));
  assert.ok(baselineTopology.blockers.includes('source_prepared_baseline_alias'));
  assert.equal(
    baselineTopology.artifacts.source.device,
    baselineTopology.artifacts.preparedBaseline?.device,
  );
  assert.equal(
    baselineTopology.artifacts.source.inode,
    baselineTopology.artifacts.preparedBaseline?.inode,
  );

  const archiveAlias = path.join(fixture.root, 'archive-alias');
  fs.symlinkSync(fixture.source, archiveAlias, 'dir');
  const aliasedArchive: WorldLabDefinition = {
    ...fixture.world,
    runtime: { ...fixture.world.runtime, archiveRoot: archiveAlias },
  };
  const archiveTopology = inspectTopology(aliasedArchive);
  assert.equal(archiveTopology.safe, false);
  assert.ok(archiveTopology.blockers.includes('archive_root_symbolic_link_refused'));
  assert.ok(archiveTopology.blockers.includes('archive_root_aliases_source'));
});

test('status exposes owner evidence and reset refuses an owned live session lock without mutation', async (t) => {
  const fixture = makeLab(t);
  const canonicalRuntime = fs.realpathSync.native(fixture.runtime);
  const before = snapshot(fixture.root);
  const dependencies: WorldLabDependencies = {
    ...clearProbes,
    probeSessionLock: async (lockPath) =>
      lockPath.startsWith(canonicalRuntime)
        ? {
            state: 'owned',
            probe: 'fixture-lock-owner',
            owners: [{ pid: 41100, command: 'java', name: lockPath }],
          }
        : { ...CLEAR },
  };

  const status = await statusWorld('fixture', fixture.world, dependencies);
  assert.equal(status.safe, false);
  assert.deepEqual(status.blockers, ['runtime_session_lock_owned']);
  assert.equal(status.runtimeSessionLock.owners[0].pid, 41100);

  await assert.rejects(
    resetWorld('fixture', fixture.world, { mode: 'execute', runId: 'owned-lock' }, dependencies),
    (error: any) => {
      assert.ok(error instanceof SafetyRefusal);
      assert.ok(error.message.includes('runtime_session_lock_owned'));
      return true;
    },
  );
  assert.deepEqual(snapshot(fixture.root), before);
});

test('prepared baseline lock is probed independently and owned or unknown state blocks readiness', async (t) => {
  const fixture = makeLab(t);
  const runtimeLock = path.join(fs.realpathSync.native(fixture.runtime), 'session.lock');
  const baselineLock = path.join(fs.realpathSync.native(fixture.baseline), 'session.lock');
  const observed: string[] = [];
  const ownedBaseline: WorldLabDependencies = {
    ...clearProbes,
    probeSessionLock: async (lockPath) => {
      observed.push(lockPath);
      return lockPath === baselineLock
        ? {
            state: 'owned',
            probe: 'fixture-baseline-lock',
            owners: [{ pid: 77, command: 'java', name: lockPath }],
          }
        : { ...CLEAR };
    },
  };

  const owned = await verifyWorld('fixture', fixture.world, ownedBaseline);
  assert.deepEqual(observed.sort(), [baselineLock, runtimeLock].sort());
  assert.equal(owned.artifactIntegrityOk, true);
  assert.equal(owned.ok, false);
  assert.equal(owned.resetReady, false);
  assert.ok(owned.blockers.includes('prepared_baseline_session_lock_owned'));
  assert.equal(owned.runtime.preparedBaselineSessionLock?.owners[0].pid, 77);

  const unknown = await verifyWorld('fixture', fixture.world, {
    ...clearProbes,
    probeSessionLock: async (lockPath) =>
      lockPath === baselineLock
        ? { state: 'unknown', probe: 'fixture-baseline-lock', owners: [], detail: 'indeterminate' }
        : { ...CLEAR },
  });
  assert.equal(unknown.resetReady, false);
  assert.ok(unknown.blockers.includes('prepared_baseline_session_lock_probe_unknown'));
});

test('status exposes a listening owner and reset refuses it without mutation', async (t) => {
  const fixture = makeLab(t);
  const before = snapshot(fixture.root);
  const dependencies: WorldLabDependencies = {
    ...clearProbes,
    probeListeningPort: async (_host, port) => ({
      state: 'owned',
      probe: 'fixture-listener',
      owners: [{ pid: 99, command: 'java', name: `127.0.0.1:${port}` }],
    }),
  };

  const status = await statusWorld('fixture', fixture.world, dependencies);
  assert.equal(status.safe, false);
  assert.deepEqual(status.blockers, ['server_port_listening']);

  await assert.rejects(
    resetWorld('fixture', fixture.world, { mode: 'execute', runId: 'live-port' }, dependencies),
    (error: any) => {
      assert.ok(error instanceof SafetyRefusal);
      assert.ok(error.message.includes('server_port_listening'));
      return true;
    },
  );
  assert.deepEqual(snapshot(fixture.root), before);
});

test('default OS probes see a real listener and an actually open session lock', async (t) => {
  const lsof = spawnSync('lsof', ['-v'], { encoding: 'utf8' });
  if ((lsof.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    t.skip('lsof is unavailable on this host');
    return;
  }
  const fixture = makeLab(t);
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise<void>((resolve) => listener.close(() => resolve())));
  const address = listener.address();
  assert.ok(address && typeof address === 'object');
  const lockDescriptor = fs.openSync(path.join(fixture.runtime, 'session.lock'), 'r');
  t.after(() => fs.closeSync(lockDescriptor));
  const world: WorldLabDefinition = {
    ...fixture.world,
    server: { host: '127.0.0.1', port: address.port },
  };

  const status = await statusWorld('fixture', world);
  assert.equal(status.runtimeSessionLock.state, 'owned');
  assert.equal(status.serverPort.state, 'owned');
  assert.ok(status.runtimeSessionLock.owners.some((owner) => owner.pid === process.pid));
  assert.ok(status.serverPort.owners.some((owner) => owner.pid === process.pid));
  assert.ok(status.blockers.includes('runtime_session_lock_owned'));
  assert.ok(status.blockers.includes('server_port_listening'));
});

test('source digest mismatch refuses before creating stage or archive', async (t) => {
  const fixture = makeLab(t);
  const badWorld: WorldLabDefinition = {
    ...fixture.world,
    source: { ...fixture.world.source, expectedDigest: '0'.repeat(64) },
  };
  const before = snapshot(fixture.root);

  await assert.rejects(
    resetWorld('fixture', badWorld, { mode: 'execute', runId: 'bad-source' }, clearProbes),
    (error: any) => {
      assert.ok(error instanceof SafetyRefusal);
      assert.ok(error.message.includes('source_digest_mismatch'));
      return true;
    },
  );
  assert.deepEqual(snapshot(fixture.root), before);
  assert.equal(fs.existsSync(fixture.archiveRoot), true);
  assert.equal(
    fs.existsSync(path.join(path.dirname(fixture.runtime), '.world.stage-bad-source')),
    false,
  );
});

test('missing prepared baseline is reported and raw source is never promoted implicitly', async (t) => {
  const fixture = makeLab(t);
  const world: WorldLabDefinition = { ...fixture.world, preparedBaseline: null };
  const verification = await verifyWorld('fixture', world, clearProbes);
  assert.equal(verification.ok, false);
  assert.equal(verification.artifacts.source.matches, true);
  assert.equal(verification.artifacts.preparedBaseline.error, 'prepared_baseline_missing');
  assert.ok(verification.blockers.includes('prepared_baseline_missing'));

  await assert.rejects(
    resetWorld('fixture', world, { mode: 'dry-run', runId: 'no-baseline' }, clearProbes),
    (error: any) => {
      assert.ok(error instanceof SafetyRefusal);
      assert.ok(error.message.includes('prepared_baseline_missing'));
      return true;
    },
  );
});

test('CLI dry-run emits the complete staged plan and changes nothing', async (t) => {
  const fixture = makeLab(t);
  const configPath = path.join(fixture.root, 'worlds.json');
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ schemaVersion: 2, worlds: { fixture: fixture.world } }, null, 2)}\n`,
  );
  const before = snapshot(fixture.root);
  let stdout = '';
  let stderr = '';
  const code = await runCli(['reset', '--config', configPath, '--world', 'fixture', '--dry-run'], {
    ...clearProbes,
    now: () => new Date('2026-07-13T12:00:00.000Z'),
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });

  assert.equal(code, 0, stderr);
  const result = JSON.parse(stdout);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.plan.operations[0].operation, 'copy_prepared_baseline_to_sibling_stage');
  assert.equal(
    result.plan.operations[5].operation,
    'rollback_archive_to_runtime_if_activation_fails',
  );
  assert.match(result.plan.stagePath, /\.world\.stage-2026-07-13T12-00-00-000Z$/);
  assert.deepEqual(snapshot(fixture.root), before);

  stdout = '';
  stderr = '';
  const executeCode = await runCli(
    ['reset', '--config', configPath, '--world', 'fixture', '--execute'],
    {
      ...clearProbes,
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
  );
  assert.equal(executeCode, 1);
  assert.equal(stdout, '');
  assert.equal(JSON.parse(stderr).error, 'reset_execution_not_available');
  assert.deepEqual(snapshot(fixture.root), before);

  stdout = '';
  stderr = '';
  const readyVerifyCode = await runCli(['verify', '--config', configPath, '--world', 'fixture'], {
    ...clearProbes,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  assert.equal(readyVerifyCode, 0, stderr);
  assert.equal(JSON.parse(stdout).resetReady, true);

  stdout = '';
  stderr = '';
  const unsafeVerifyCode = await runCli(['verify', '--config', configPath, '--world', 'fixture'], {
    ...clearProbes,
    probeListeningPort: async () => ({
      state: 'owned',
      probe: 'fixture-listener',
      owners: [{ pid: 88, command: 'java' }],
    }),
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  const unsafeVerify = JSON.parse(stdout);
  assert.equal(unsafeVerifyCode, 2, stderr);
  assert.equal(unsafeVerify.artifactIntegrityOk, true);
  assert.equal(unsafeVerify.ok, false);
  assert.equal(unsafeVerify.resetReady, false);
  assert.deepEqual(unsafeVerify.blockers, ['server_port_listening']);
});

test('programmatic execute refuses real filesystem mutation without an issued fixture capability', async (t) => {
  const fixture = makeLab(t);
  const before = snapshot(fixture.root);
  await assert.rejects(
    resetWorld(
      'fixture',
      fixture.world,
      { mode: 'execute', runId: 'missing-capability' },
      clearProbes,
    ),
    (error: any) => {
      assert.ok(error instanceof SafetyRefusal);
      assert.ok(error.message.includes('fixture_execution_capability_required'));
      return true;
    },
  );
  assert.deepEqual(snapshot(fixture.root), before);

  const forged = {
    kind: 'behold-world-lab-temporary-fixture',
    root: fixture.root,
    canonicalRoot: fs.realpathSync.native(fixture.root),
    device: fs.statSync(fixture.root).dev,
    inode: fs.statSync(fixture.root).ino,
  } as any;
  await assert.rejects(
    resetWorld(
      'fixture',
      fixture.world,
      { mode: 'execute', runId: 'forged-capability' },
      { ...clearProbes, fixtureExecutionCapability: forged },
    ),
    /fixture_execution_capability_required/,
  );
  assert.deepEqual(snapshot(fixture.root), before);
});

test('fixture-only execute stages a verified baseline, archives the old run, and atomically activates', async (t) => {
  const fixture = makeLab(t);
  const oldRuntime = snapshot(fixture.runtime);
  const originalSource = snapshot(fixture.source);
  const result = await resetWorld(
    'fixture',
    fixture.world,
    { mode: 'execute', runId: 'fixture-success' },
    { ...clearProbes, fixtureExecutionCapability: fixture.fixtureCapability },
  );

  assert.equal(result.mode, 'executed');
  assert.equal(result.stageDigest, fixture.world.preparedBaseline?.expectedDigest);
  assert.equal(digestTree(fixture.runtime).digest, fixture.world.preparedBaseline?.expectedDigest);
  assert.equal(fs.readFileSync(path.join(fixture.runtime, 'level.dat'), 'utf8'), 'prepared-level');
  assert.equal(fs.existsSync(path.join(fixture.runtime, 'session.lock')), false);
  assert.equal(fs.existsSync(result.plan.stagePath), false);

  assert.ok(result.archivePath);
  assert.deepEqual(snapshot(result.archivePath!), oldRuntime);
  assert.equal(fs.readFileSync(path.join(result.archivePath!, 'old-run.txt'), 'utf8'), 'old-world');
  assert.deepEqual(snapshot(fixture.source), originalSource);
  assert.ok(result.journalPath);
  assert.equal(JSON.parse(fs.readFileSync(result.journalPath!, 'utf8')).phase, 'completed');
  assert.equal(fs.existsSync(path.join(path.dirname(fixture.runtime), '.world.reset.lock')), false);
});

test('per-runtime operation lock refuses concurrent resets with different run ids', async (t) => {
  const fixture = makeLab(t);
  let portProbeCalls = 0;
  let releaseLockedGate!: () => void;
  let reportLockedGate!: () => void;
  const lockedGateReached = new Promise<void>((resolve) => {
    reportLockedGate = resolve;
  });
  const holdLockedGate = new Promise<void>((resolve) => {
    releaseLockedGate = resolve;
  });
  const dependencies: WorldLabDependencies = {
    ...clearProbes,
    fixtureExecutionCapability: fixture.fixtureCapability,
    probeListeningPort: async () => {
      portProbeCalls += 1;
      if (portProbeCalls === 2) {
        reportLockedGate();
        await holdLockedGate;
      }
      return { ...CLEAR };
    },
  };

  const first = resetWorld(
    'fixture',
    fixture.world,
    { mode: 'execute', runId: 'concurrent-one' },
    dependencies,
  );
  await lockedGateReached;
  await assert.rejects(
    resetWorld(
      'fixture',
      fixture.world,
      { mode: 'execute', runId: 'concurrent-two' },
      dependencies,
    ),
    (error: any) => {
      assert.ok(error instanceof SafetyRefusal);
      assert.ok(error.message.includes('reset_operation_locked'));
      return true;
    },
  );
  releaseLockedGate();
  const completed = await first;

  assert.equal(completed.mode, 'executed');
  assert.equal(fs.existsSync(path.join(path.dirname(fixture.runtime), '.world.reset.lock')), false);
  assert.equal(
    fs.existsSync(path.join(path.dirname(fixture.runtime), '.world.reset-concurrent-two.json')),
    false,
  );
});

test('activation gate refuses a runtime changed while the verified stage is being prepared', async (t) => {
  const fixture = makeLab(t);
  const archive = path.join(fixture.archiveRoot, 'runtime-race-world');
  const stage = path.join(path.dirname(fixture.runtime), '.world.stage-runtime-race');
  const journalPath = path.join(path.dirname(fixture.runtime), '.world.reset-runtime-race.json');

  await assert.rejects(
    resetWorld(
      'fixture',
      fixture.world,
      { mode: 'execute', runId: 'runtime-race' },
      {
        ...clearProbes,
        fixtureExecutionCapability: fixture.fixtureCapability,
        mutationOperations: {
          copyDirectory(from, to) {
            fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: true });
            fs.rmSync(path.join(to, 'session.lock'), { force: true });
            write(path.join(fixture.runtime, 'concurrent-write.txt'), 'external writer');
          },
        },
      },
    ),
    (error: any) => {
      assert.ok(error instanceof ResetExecutionError);
      assert.match(error.evidence.activationError, /runtime_changed_during_reset/);
      assert.equal(error.evidence.rollbackAttempted, false);
      assert.equal(error.evidence.rollbackSucceeded, false);
      return true;
    },
  );

  assert.equal(fs.existsSync(archive), false);
  assert.equal(fs.existsSync(stage), true);
  assert.equal(fs.readFileSync(path.join(fixture.runtime, 'old-run.txt'), 'utf8'), 'old-world');
  assert.equal(
    fs.readFileSync(path.join(fixture.runtime, 'concurrent-write.txt'), 'utf8'),
    'external writer',
  );
  assert.equal(JSON.parse(fs.readFileSync(journalPath, 'utf8')).phase, 'recovery_required');
  assert.equal(fs.existsSync(path.join(path.dirname(fixture.runtime), '.world.reset.lock')), false);
});

test('a directory fsync failure after rename is reconciled before rollback is terminal', async (t) => {
  const fixture = makeLab(t);
  const oldRuntime = snapshot(fixture.runtime);
  const originalFsync = fs.fsyncSync;
  t.after(() => {
    fs.fsyncSync = originalFsync;
  });
  let armed = false;

  await assert.rejects(
    resetWorld(
      'fixture',
      fixture.world,
      { mode: 'execute', runId: 'rename-fsync-failure' },
      {
        ...clearProbes,
        fixtureExecutionCapability: fixture.fixtureCapability,
        mutationOperations: {
          rename(from, to) {
            fs.renameSync(from, to);
            if (!armed) {
              armed = true;
              fs.fsyncSync = ((descriptor: number) => {
                fs.fsyncSync = originalFsync;
                throw new Error(`injected directory fsync failure on ${descriptor}`);
              }) as typeof fs.fsyncSync;
            }
          },
        },
      },
    ),
    (error: any) => {
      assert.ok(error instanceof ResetExecutionError);
      assert.equal(error.evidence.rollbackAttempted, true);
      assert.equal(error.evidence.rollbackSucceeded, true);
      return true;
    },
  );
  fs.fsyncSync = originalFsync;

  const runtimeParent = path.dirname(fixture.runtime);
  assert.deepEqual(snapshot(fixture.runtime), oldRuntime);
  assert.equal(fs.existsSync(path.join(fixture.archiveRoot, 'rename-fsync-failure-world')), false);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(runtimeParent, '.world.reset-rename-fsync-failure.json'), 'utf8'),
    ).phase,
    'rolled_back',
  );
});

test('durable journal reconciles runtime-absent crash state and a dead operation lock', async (t) => {
  const fixture = makeLab(t);
  const oldRuntime = snapshot(fixture.runtime);
  let renameCount = 0;

  await assert.rejects(
    resetWorld(
      'fixture',
      fixture.world,
      { mode: 'execute', runId: 'crash-state' },
      {
        ...clearProbes,
        fixtureExecutionCapability: fixture.fixtureCapability,
        mutationOperations: {
          rename(from, to) {
            renameCount += 1;
            if (renameCount >= 2) throw new Error('simulated process loss during activation');
            fs.renameSync(from, to);
          },
        },
      },
    ),
    (error: any) => {
      assert.ok(error instanceof ResetExecutionError);
      assert.equal(error.evidence.rollbackSucceeded, false);
      assert.ok(error.evidence.journalPath);
      return true;
    },
  );

  const runtimeParent = path.dirname(fixture.runtime);
  const archive = path.join(fixture.archiveRoot, 'crash-state-world');
  const stage = path.join(runtimeParent, '.world.stage-crash-state');
  const journalPath = path.join(runtimeParent, '.world.reset-crash-state.json');
  const lockPath = path.join(runtimeParent, '.world.reset.lock');
  assert.equal(fs.existsSync(fixture.runtime), false);
  assert.equal(fs.existsSync(archive), true);
  assert.equal(fs.existsSync(stage), true);
  assert.equal(JSON.parse(fs.readFileSync(journalPath, 'utf8')).phase, 'recovery_required');

  fs.writeFileSync(
    lockPath,
    `${JSON.stringify({
      protocol: 'behold-world-lab-operation-lock.v1',
      world: 'fixture',
      runId: 'crash-state',
      pid: 999_999_999,
      hostname: os.hostname(),
      token: 'dead-fixture-owner',
      createdAt: '2026-07-13T00:00:00.000Z',
    })}\n`,
  );

  const recovered = await recoverWorldReset('fixture', fixture.world, 'crash-state', {
    fixtureExecutionCapability: fixture.fixtureCapability,
  });

  assert.equal(recovered.action, 'rollback_restored');
  assert.equal(recovered.journal.phase, 'recovered_rolled_back');
  assert.deepEqual(snapshot(fixture.runtime), oldRuntime);
  assert.equal(fs.existsSync(archive), false);
  assert.equal(fs.existsSync(stage), true, 'verified stage remains as recovery evidence');
  assert.equal(fs.existsSync(lockPath), false);
});

test('a fresh process recovers after the reset process is killed at either rename boundary', async (t) => {
  for (const killAfterRename of [1, 2]) {
    const fixture = makeLab(t);
    const oldRuntime = snapshot(fixture.runtime);
    const result = runKilledResetChild(fixture, `killed-${killAfterRename}`, killAfterRename);
    assert.equal(result.signal, 'SIGKILL', result.stderr);

    const recovered = await recoverWorldReset(
      'fixture',
      fixture.world,
      `killed-${killAfterRename}`,
      { fixtureExecutionCapability: fixture.fixtureCapability },
    );
    if (killAfterRename === 1) {
      assert.equal(recovered.action, 'rollback_restored');
      assert.deepEqual(snapshot(fixture.runtime), oldRuntime);
    } else {
      assert.equal(recovered.action, 'activation_accepted');
      assert.equal(
        digestTree(fixture.runtime).digest,
        fixture.world.preparedBaseline?.expectedDigest,
      );
    }
    assert.equal(
      fs.existsSync(path.join(path.dirname(fixture.runtime), '.world.reset.lock')),
      false,
    );
  }
});

test('a recovery-required transaction fences every later run id for the same runtime', async (t) => {
  const fixture = makeLab(t);
  let renameCount = 0;

  await assert.rejects(
    resetWorld(
      'fixture',
      fixture.world,
      { mode: 'execute', runId: 'unresolved-first' },
      {
        ...clearProbes,
        fixtureExecutionCapability: fixture.fixtureCapability,
        mutationOperations: {
          rename(from, to) {
            renameCount += 1;
            if (renameCount === 3) throw new Error('rollback cannot move active runtime');
            fs.renameSync(from, to);
            if (renameCount === 2) write(path.join(to, 'corrupt-after-activation.txt'), 'bad');
          },
        },
      },
    ),
    (error: any) => {
      assert.ok(error instanceof ResetExecutionError);
      assert.equal(error.evidence.rollbackSucceeded, false);
      return true;
    },
  );

  const runtimeParent = path.dirname(fixture.runtime);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(runtimeParent, '.world.reset-unresolved-first.json'), 'utf8'),
    ).phase,
    'recovery_required',
  );
  const beforeSecond = snapshot(fixture.root);
  await assert.rejects(
    resetWorld(
      'fixture',
      fixture.world,
      { mode: 'execute', runId: 'unresolved-second' },
      { ...clearProbes, fixtureExecutionCapability: fixture.fixtureCapability },
    ),
    (error: any) => {
      assert.ok(error instanceof SafetyRefusal);
      assert.ok(error.message.includes('unresolved_reset_transaction'));
      return true;
    },
  );
  assert.deepEqual(snapshot(fixture.root), beforeSecond);
  assert.equal(
    fs.existsSync(path.join(runtimeParent, '.world.reset-unresolved-second.json')),
    false,
  );
  assert.equal(fs.existsSync(path.join(fixture.archiveRoot, 'unresolved-second-world')), false);
});

test('recovery refuses a corrupted archive without moving or deleting evidence', async (t) => {
  const fixture = makeLab(t);
  let renameCount = 0;

  await assert.rejects(
    resetWorld(
      'fixture',
      fixture.world,
      { mode: 'execute', runId: 'corrupt-archive' },
      {
        ...clearProbes,
        fixtureExecutionCapability: fixture.fixtureCapability,
        mutationOperations: {
          rename(from, to) {
            renameCount += 1;
            if (renameCount >= 2) throw new Error('simulated process loss during activation');
            fs.renameSync(from, to);
          },
        },
      },
    ),
    ResetExecutionError,
  );

  const runtimeParent = path.dirname(fixture.runtime);
  const archive = path.join(fixture.archiveRoot, 'corrupt-archive-world');
  const journalPath = path.join(runtimeParent, '.world.reset-corrupt-archive.json');
  write(path.join(archive, 'old-run.txt'), 'corrupted after crash');

  await assert.rejects(
    recoverWorldReset('fixture', fixture.world, 'corrupt-archive', {
      fixtureExecutionCapability: fixture.fixtureCapability,
    }),
    (error: any) => {
      assert.ok(error instanceof SafetyRefusal);
      assert.ok(error.message.includes('recovery_archive_digest_mismatch'));
      return true;
    },
  );

  assert.equal(fs.existsSync(fixture.runtime), false);
  assert.equal(fs.existsSync(archive), true);
  assert.equal(fs.readFileSync(path.join(archive, 'old-run.txt'), 'utf8'), 'corrupted after crash');
  assert.equal(JSON.parse(fs.readFileSync(journalPath, 'utf8')).phase, 'recovery_required');
  assert.equal(fs.existsSync(path.join(runtimeParent, '.world.reset.lock')), false);
});

test('recovery rejects a journal edit that attempts to bless corrupted archive bytes', async (t) => {
  const fixture = makeLab(t);
  let renameCount = 0;

  await assert.rejects(
    resetWorld(
      'fixture',
      fixture.world,
      { mode: 'execute', runId: 'journal-digest-tamper' },
      {
        ...clearProbes,
        fixtureExecutionCapability: fixture.fixtureCapability,
        mutationOperations: {
          rename(from, to) {
            renameCount += 1;
            if (renameCount >= 2) throw new Error('simulated process loss during activation');
            fs.renameSync(from, to);
          },
        },
      },
    ),
    ResetExecutionError,
  );

  const runtimeParent = path.dirname(fixture.runtime);
  const archive = path.join(fixture.archiveRoot, 'journal-digest-tamper-world');
  const journalPath = path.join(runtimeParent, '.world.reset-journal-digest-tamper.json');
  write(path.join(archive, 'old-run.txt'), 'CORRUPT!');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  journal.preResetRuntimeDigest = digestTree(archive).digest;
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

  await assert.rejects(
    recoverWorldReset('fixture', fixture.world, 'journal-digest-tamper', {
      fixtureExecutionCapability: fixture.fixtureCapability,
    }),
    (error: any) => {
      assert.equal(error.code, 'invalid_reset_journal_authentication');
      return true;
    },
  );
  assert.equal(fs.existsSync(fixture.runtime), false);
  assert.equal(fs.existsSync(archive), true);
});

test('recovery binds journal paths to the configured world instead of trusting editable JSON', async (t) => {
  const fixture = makeLab(t);
  let renameCount = 0;

  await assert.rejects(
    resetWorld(
      'fixture',
      fixture.world,
      { mode: 'execute', runId: 'journal-path-tamper' },
      {
        ...clearProbes,
        fixtureExecutionCapability: fixture.fixtureCapability,
        mutationOperations: {
          rename(from, to) {
            renameCount += 1;
            if (renameCount >= 2) throw new Error('simulated process loss during activation');
            fs.renameSync(from, to);
          },
        },
      },
    ),
    ResetExecutionError,
  );

  const runtimeParent = path.dirname(fixture.runtime);
  const journalPath = path.join(runtimeParent, '.world.reset-journal-path-tamper.json');
  const realArchive = path.join(fixture.archiveRoot, 'journal-path-tamper-world');
  const forgedArchive = path.join(fixture.root, 'forged-old-world');
  fs.renameSync(realArchive, forgedArchive);
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  journal.plan.archivePath = forgedArchive;
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

  await assert.rejects(
    recoverWorldReset('fixture', fixture.world, 'journal-path-tamper', {
      fixtureExecutionCapability: fixture.fixtureCapability,
    }),
    (error: any) => {
      assert.equal(error.code, 'invalid_reset_journal_authentication');
      return true;
    },
  );

  assert.equal(fs.existsSync(fixture.runtime), false);
  assert.equal(fs.existsSync(forgedArchive), true);
  assert.equal(fs.existsSync(path.join(runtimeParent, '.world.reset.lock')), false);
});

test('activation rename failure rolls the old run back and retains the verified stage as evidence', async (t) => {
  const fixture = makeLab(t);
  const oldRuntime = snapshot(fixture.runtime);
  let renameCount = 0;

  await assert.rejects(
    resetWorld(
      'fixture',
      fixture.world,
      { mode: 'execute', runId: 'rollback-case' },
      {
        ...clearProbes,
        fixtureExecutionCapability: fixture.fixtureCapability,
        mutationOperations: {
          rename(from, to) {
            renameCount += 1;
            if (renameCount === 2) throw new Error('induced activation rename failure');
            fs.renameSync(from, to);
          },
        },
      },
    ),
    (error: any) => {
      assert.ok(error instanceof ResetExecutionError);
      assert.equal(error.evidence.rollbackAttempted, true);
      assert.equal(error.evidence.rollbackSucceeded, true);
      assert.match(error.evidence.activationError, /induced activation rename failure/);
      return true;
    },
  );

  assert.equal(renameCount, 3);
  assert.deepEqual(snapshot(fixture.runtime), oldRuntime);
  const stage = path.join(path.dirname(fixture.runtime), '.world.stage-rollback-case');
  const archive = path.join(fixture.archiveRoot, 'rollback-case-world');
  assert.equal(fs.existsSync(stage), true);
  assert.equal(digestTree(stage).digest, fixture.world.preparedBaseline?.expectedDigest);
  assert.equal(fs.existsSync(archive), false);
});

function makeLab(t: test.TestContext) {
  const root = temporaryDirectory(t);
  const source = path.join(root, 'raw-source');
  const baseline = path.join(root, 'prepared-baseline');
  const server = path.join(root, 'server');
  const runtime = path.join(server, 'world');
  const archiveRoot = path.join(root, 'archives');

  fs.mkdirSync(archiveRoot, { recursive: true });

  write(path.join(source, 'metadata.json'), '{"source":true}\n');
  write(path.join(source, 'region', 'r.0.0.mca'), 'source-map');

  write(path.join(baseline, 'level.dat'), 'prepared-level');
  write(path.join(baseline, 'region', 'r.0.0.mca'), 'prepared-map');
  write(path.join(baseline, 'empty', '.keep'), 'fixture');
  write(path.join(baseline, 'session.lock'), 'not part of baseline identity');

  write(path.join(runtime, 'old-run.txt'), 'old-world');
  write(path.join(runtime, 'region', 'r.0.0.mca'), 'changed-map');
  write(path.join(runtime, 'session.lock'), 'stale but unowned fixture lock');

  const world: WorldLabDefinition = {
    label: 'fixture',
    source: {
      path: source,
      digestProfile: TREE_DIGEST_PROFILE,
      expectedDigest: digestTree(source).digest,
    },
    preparedBaseline: {
      path: baseline,
      digestProfile: TREE_DIGEST_PROFILE,
      expectedDigest: digestTree(baseline).digest,
    },
    runtime: { worldPath: runtime, archiveRoot },
    server: { host: '127.0.0.1', port: 25565 },
  };
  const fixtureCapability = createFixtureExecutionCapability(root);
  return { root, source, baseline, server, runtime, archiveRoot, world, fixtureCapability };
}

function runKilledResetChild(
  fixture: ReturnType<typeof makeLab>,
  runId: string,
  killAfterRename: number,
) {
  const modulePath = path.resolve('dist/scripts/world-lab.js');
  const program = `
    const fs = require('node:fs');
    const { createFixtureExecutionCapability, resetWorld } = require(${JSON.stringify(modulePath)});
    const root = ${JSON.stringify(fixture.root)};
    const world = ${JSON.stringify(fixture.world)};
    const runId = ${JSON.stringify(runId)};
    const killAfterRename = ${killAfterRename};
    let renameCount = 0;
    const clear = async () => ({ state: 'clear', probe: 'killed-child', owners: [] });
    resetWorld('fixture', world, { mode: 'execute', runId }, {
      probeSessionLock: clear,
      probeListeningPort: clear,
      fixtureExecutionCapability: createFixtureExecutionCapability(root),
      mutationOperations: {
        rename(from, to) {
          renameCount += 1;
          fs.renameSync(from, to);
          if (renameCount === killAfterRename) process.kill(process.pid, 'SIGKILL');
        },
      },
    }).then(() => process.exit(0)).catch((error) => {
      process.stderr.write(String(error && (error.stack || error)));
      process.exit(70);
    });
  `;
  return spawnSync(process.execPath, ['-e', program], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function temporaryDirectory(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-world-lab-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function write(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function snapshot(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  function walk(directory: string) {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        result.push(`directory:${relative}`);
        walk(full);
      } else {
        result.push(`file:${relative}:${fs.readFileSync(full).toString('base64')}`);
      }
    }
  }
  walk(root);
  return result;
}
