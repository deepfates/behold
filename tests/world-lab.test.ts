import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createFixtureExecutionCapability,
  digestTree,
  inspectTopology,
  resetWorld,
  runCli,
  SafetyRefusal,
  ResetExecutionError,
  statusWorld,
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

test('tree digest is deterministic and excludes session.lock', (t) => {
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
});

test('config validation requires absolute, disjoint paths and explicit baseline state', (t) => {
  const fixture = makeLab(t);
  const valid = validateWorldLabConfig({ schemaVersion: 1, worlds: { fixture: fixture.world } });
  assert.equal(valid.worlds.fixture.preparedBaseline?.path, fixture.baseline);

  const missingBaseline = validateWorldLabConfig({
    schemaVersion: 1,
    worlds: { fixture: { ...fixture.world, preparedBaseline: null } },
  });
  assert.equal(missingBaseline.worlds.fixture.preparedBaseline, null);

  assert.throws(
    () =>
      validateWorldLabConfig({
        schemaVersion: 1,
        worlds: {
          fixture: {
            ...fixture.world,
            source: { path: './relative', expectedDigest: '0'.repeat(64) },
          },
        },
      }),
    /non-root absolute path/,
  );
  assert.throws(
    () =>
      validateWorldLabConfig({
        schemaVersion: 1,
        worlds: {
          fixture: {
            ...fixture.world,
            preparedBaseline: {
              path: fixture.runtime,
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
        schemaVersion: 1,
        worlds: {
          fixture: {
            ...fixture.world,
            preparedBaseline: {
              path: dottedSourceAlias,
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
          schemaVersion: 1,
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
    `${JSON.stringify({ schemaVersion: 1, worlds: { fixture: fixture.world } }, null, 2)}\n`,
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
    source: { path: source, expectedDigest: digestTree(source).digest },
    preparedBaseline: { path: baseline, expectedDigest: digestTree(baseline).digest },
    runtime: { worldPath: runtime, archiveRoot },
    server: { host: '127.0.0.1', port: 25565 },
  };
  const fixtureCapability = createFixtureExecutionCapability(root);
  return { root, source, baseline, server, runtime, archiveRoot, world, fixtureCapability };
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
