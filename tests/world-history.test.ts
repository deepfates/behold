import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  digestTree,
  TREE_DIGEST_PROFILE,
  type RuntimeEvidence,
  type WorldLabDefinition,
} from '../scripts/world-lab';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import {
  forkStoppedMinecraftWorld,
  prepareMinecraftHistoryServer,
  verifyMinecraftWorldHistoryFork,
  verifyMinecraftHistoryServer,
} from '../src/runtime/world-history';

test('one stopped Minecraft checkpoint creates isolated writable histories and Lync lineage', async (t) => {
  const fixture = worldFixture(t);
  const sourceBefore = digestTree(fixture.runtime).digest;
  const result = await forkStoppedMinecraftWorld(
    {
      operationId: 'matched-minds-1',
      worldId: 'fixture-world',
      world: fixture.world,
      controlRoot: fixture.controlRoot,
      historyRoot: fixture.historyRoot,
      actor: 'test-evaluator',
      now: clock(),
      histories: [
        { id: 'direct', label: 'Direct mind', purpose: 'Run the direct mind from the checkpoint.' },
        { id: 'ax', label: 'Ax mind', purpose: 'Run the Ax mind from the same checkpoint.' },
      ],
    },
    { inspectRuntime: async () => stoppedEvidence(fixture.runtime) },
  );

  assert.equal(result.checkpoint.digest, sourceBefore);
  assert.equal(result.histories.length, 2);
  assert.equal(result.histories[0].initialDigest, result.histories[1].initialDigest);
  assert.equal(result.histories[0].initialDigest, result.checkpoint.digest);
  assert.ok(fs.existsSync(result.lineage.file));
  assert.notEqual(result.lineage.sourceTurnId, result.lineage.checkpointTurnId);
  assert.equal(new Set(result.lineage.historyTurnIds).size, 2);
  assert.equal(fs.existsSync(path.join(fixture.controlRoot, 'fixture-world', 'owner.json')), false);

  fs.writeFileSync(
    path.join(result.histories[0].worldPath, 'region', 'r.0.0.mca'),
    'direct changed',
  );
  assert.equal(
    fs.readFileSync(path.join(fixture.runtime, 'region', 'r.0.0.mca'), 'utf8'),
    'source',
  );
  assert.equal(
    fs.readFileSync(path.join(result.histories[1].worldPath, 'region', 'r.0.0.mca'), 'utf8'),
    'source',
  );
  assert.equal(digestTree(result.checkpoint.artifactPath).digest, result.checkpoint.digest);
  const verified = await verifyMinecraftWorldHistoryFork(result);
  assert.equal(verified.checkpointIntegrityOk, true);
  assert.equal(verified.lineageIntegrityOk, true);
  assert.equal(verified.lifecycleIntegrityOk, true);
  assert.deepEqual(verified.histories, [
    {
      historyId: 'direct',
      currentDigest: digestTree(result.histories[0].worldPath).digest,
      diverged: true,
    },
    { historyId: 'ax', currentDigest: result.checkpoint.digest, diverged: false },
  ]);

  const lifecycle = verifyWorldLifecycleJournal(result.lifecycleJournal);
  assert.deepEqual(
    lifecycle.events.map((event) => event.type),
    [
      'control_acquired',
      'world_history_checkpoint_started',
      'world_history_checkpoint_completed',
      'control_released',
    ],
  );
});

test('checkpoint sealing fails closed if the source changes under lifecycle authority', async (t) => {
  const fixture = worldFixture(t);
  await assert.rejects(
    forkStoppedMinecraftWorld(
      {
        operationId: 'source-race-1',
        worldId: 'fixture-world',
        world: fixture.world,
        controlRoot: fixture.controlRoot,
        historyRoot: fixture.historyRoot,
        actor: 'test-evaluator',
        histories: [{ id: 'candidate', label: 'Candidate', purpose: 'Detect a source race.' }],
      },
      {
        inspectRuntime: async () => stoppedEvidence(fixture.runtime),
        beforeSourceRecheck: () =>
          fs.writeFileSync(path.join(fixture.runtime, 'region', 'r.0.0.mca'), 'source changed'),
      },
    ),
    /source Minecraft runtime changed/,
  );
  assert.equal(fs.existsSync(path.join(fixture.controlRoot, 'fixture-world', 'owner.json')), false);
});

test('an existing child may be reused only when its complete fork basis still matches', async (t) => {
  const fixture = worldFixture(t);
  const options = {
    operationId: 'idempotent-fork-1',
    worldId: 'fixture-world',
    world: fixture.world,
    controlRoot: fixture.controlRoot,
    historyRoot: fixture.historyRoot,
    actor: 'test-evaluator',
    histories: [{ id: 'candidate', label: 'Candidate', purpose: 'One exact experiment.' }],
  } as const;
  const first = await forkStoppedMinecraftWorld(options, {
    inspectRuntime: async () => stoppedEvidence(fixture.runtime),
  });
  const second = await forkStoppedMinecraftWorld(options, {
    inspectRuntime: async () => stoppedEvidence(fixture.runtime),
  });
  assert.equal(second.checkpoint.artifactId, first.checkpoint.artifactId);
  assert.equal(second.histories[0].worldPath, first.histories[0].worldPath);

  await assert.rejects(
    forkStoppedMinecraftWorld(
      {
        ...options,
        histories: [{ id: 'candidate', label: 'Changed label', purpose: 'One exact experiment.' }],
      },
      { inspectRuntime: async () => stoppedEvidence(fixture.runtime) },
    ),
    /existing Minecraft history is inconsistent/,
  );
});

test('checkpointing refuses active or ambiguous runtime evidence before copying', async (t) => {
  const fixture = worldFixture(t);
  const active = stoppedEvidence(fixture.runtime);
  active.serverPort = { state: 'owned', probe: 'fixture', owners: [{ pid: 42 }] };
  active.safe = false;
  active.blockers = ['server_port_listening'];
  await assert.rejects(
    forkStoppedMinecraftWorld(
      {
        operationId: 'active-refusal-1',
        worldId: 'fixture-world',
        world: fixture.world,
        controlRoot: fixture.controlRoot,
        historyRoot: fixture.historyRoot,
        actor: 'test-evaluator',
        histories: [{ id: 'candidate', label: 'Candidate', purpose: 'Must not be copied.' }],
      },
      { inspectRuntime: async () => active },
    ),
    /requires a stopped runtime/,
  );
  assert.equal(fs.existsSync(path.join(fixture.historyRoot, 'checkpoints')), false);
});

test('a child history receives an isolated vanilla server profile without copying runtime cruft', async (t) => {
  const fixture = worldFixture(t);
  const fork = await forkStoppedMinecraftWorld(
    {
      operationId: 'launchable-history-1',
      worldId: 'fixture-world',
      world: fixture.world,
      controlRoot: fixture.controlRoot,
      historyRoot: fixture.historyRoot,
      actor: 'test-evaluator',
      histories: [{ id: 'candidate', label: 'Candidate', purpose: 'Launch one child.' }],
    },
    { inspectRuntime: async () => stoppedEvidence(fixture.runtime) },
  );
  const child = fork.histories[0];
  const initialDigest = digestTree(child.worldPath).digest;
  const server = prepareMinecraftHistoryServer({
    history: child,
    templateServerDirectory: fixture.templateServer,
    host: '127.0.0.1',
    port: 25_599,
    now: () => new Date('2026-07-14T00:00:00.000Z'),
  });

  assert.equal(server.serverDirectory, path.dirname(child.worldPath));
  assert.equal(server.worldPath, child.worldPath);
  assert.equal(digestTree(child.worldPath).digest, initialDigest);
  assert.match(
    fs.readFileSync(path.join(server.serverDirectory, 'server.properties'), 'utf8'),
    /^level-name=world$/m,
  );
  assert.match(
    fs.readFileSync(path.join(server.serverDirectory, 'server.properties'), 'utf8'),
    /^server-port=25599$/m,
  );
  assert.equal(fs.existsSync(path.join(server.serverDirectory, 'usercache.json')), false);
  assert.equal(fs.readFileSync(path.join(server.serverDirectory, 'ops.json'), 'utf8'), '[]\n');
  assert.deepEqual(verifyMinecraftHistoryServer(server), {
    protocol: 'behold.minecraft-history-server.v1',
    historyId: 'candidate',
    profileIntegrityOk: true,
    currentWorldDigest: initialDigest,
    worldDiverged: false,
  });
  assert.deepEqual(
    prepareMinecraftHistoryServer({
      history: child,
      templateServerDirectory: fixture.templateServer,
      port: 25_599,
    }),
    server,
  );

  fs.writeFileSync(path.join(child.worldPath, 'region', 'continued.mca'), 'later history');
  assert.deepEqual(
    prepareMinecraftHistoryServer({
      history: child,
      templateServerDirectory: fixture.templateServer,
      port: 25_599,
    }),
    server,
  );
  assert.equal(verifyMinecraftHistoryServer(server).worldDiverged, true);
});

function worldFixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-world-history-'));
  t.after(() => {
    makeTreeWritable(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'source');
  const baseline = path.join(root, 'baseline');
  const runtime = path.join(root, 'runtime');
  const archive = path.join(root, 'archive');
  const templateServer = path.join(root, 'template-server');
  for (const directory of [source, baseline, runtime, archive, templateServer]) {
    fs.mkdirSync(directory);
  }
  fs.writeFileSync(
    path.join(templateServer, 'server.properties'),
    [
      'difficulty=normal',
      'level-name=world',
      'online-mode=false',
      'query.port=25565',
      'server-ip=127.0.0.1',
      'server-port=25565',
    ].join('\n') + '\n',
  );
  fs.writeFileSync(path.join(templateServer, 'eula.txt'), 'eula=true\n');
  fs.writeFileSync(path.join(templateServer, 'ops.json'), '[]\n');
  fs.writeFileSync(path.join(templateServer, 'usercache.json'), '[{"name":"old"}]\n');
  fs.mkdirSync(path.join(runtime, 'region'));
  fs.writeFileSync(path.join(runtime, 'level.dat'), 'level');
  fs.writeFileSync(path.join(runtime, 'region', 'r.0.0.mca'), 'source');
  fs.writeFileSync(path.join(source, 'level.dat'), 'source artifact');
  fs.writeFileSync(path.join(baseline, 'level.dat'), 'baseline artifact');
  const world: WorldLabDefinition = {
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
    runtime: { worldPath: runtime, archiveRoot: archive },
    server: { host: '127.0.0.1', port: 25599 },
  };
  return {
    root,
    runtime,
    controlRoot: path.join(root, 'control'),
    historyRoot: path.join(root, 'histories-root'),
    templateServer,
    world,
  };
}

function stoppedEvidence(runtimePath: string): RuntimeEvidence {
  return {
    runtimeExists: true,
    runtimePath,
    runtimeSessionLockPath: path.join(runtimePath, 'session.lock'),
    runtimeSessionLock: { state: 'clear', probe: 'fixture', owners: [] },
    preparedBaselineSessionLockPath: null,
    preparedBaselineSessionLock: null,
    serverPort: { state: 'clear', probe: 'fixture', owners: [] },
    topology: { artifacts: {} as any, safe: true, blockers: [] },
    safe: true,
    blockers: [],
  };
}

function clock() {
  let tick = 0;
  return () => new Date(1_800_000_000_000 + tick++ * 1_000);
}

function makeTreeWritable(root: string) {
  if (!fs.existsSync(root)) return;
  fs.chmodSync(root, 0o700);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) makeTreeWritable(full);
    else if (entry.isFile()) fs.chmodSync(full, 0o600);
  }
}
