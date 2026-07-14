#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  digestTree,
  loadWorldLabConfig,
  SESSION_LOCK,
  TREE_DIGEST_PROFILE,
  type WorldLabDefinition,
} from './world-lab';
import {
  isMinecraftReadyLine,
  isMinecraftSaveAcknowledgement,
  startManagedWorld,
} from './world-runner';
import { verifyAdmittedPlaceEpoch } from './place-epoch';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';

const PROTOCOL = 'behold.owned-world-proof.v1' as const;
const WORLD_ID = 'behold-owned-flat-v1';
const ENTITY_ID = 'ProofResident';
const LEVEL_SEED = '424242';
type ProofTarget = Readonly<{ x: number; y: number; z: number; item: 'apple'; count: 1 }>;
const TARGET: ProofTarget = Object.freeze({ x: 3, y: -60, z: 0, item: 'apple', count: 1 });
const SPAWN = Object.freeze({ x: 0, y: -60, z: 0 });

async function main() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: 'string' },
      port: { type: 'string' },
      'place-epoch': { type: 'string' },
      arrival: { type: 'string' },
      affordance: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help) {
    process.stdout.write(
      'Usage:\n' +
        '  owned-world-proof [--run <safe-id>] [--port <unused-loopback-port>]\n' +
        '  owned-world-proof --place-epoch <admitted-dir> --arrival <x,y,z> [--affordance <x,y,z>] [--run <safe-id>]\n',
    );
    return;
  }
  assertCleanRepository();
  const runId = safeSegment(
    String(parsed.values.run || `run-${new Date().toISOString().replace(/[:.]/g, '-')}`),
  );
  const admittedRoot = parsed.values['place-epoch']
    ? path.resolve(String(parsed.values['place-epoch']))
    : null;
  const admitted = admittedRoot ? verifyAdmittedPlaceEpoch(admittedRoot) : null;
  const admittedConfig = admitted
    ? loadWorldLabConfig(path.join(admittedRoot!, 'world-definition.json'))
    : null;
  const admittedWorld = admittedConfig?.worlds[admitted?.worldId ?? ''] ?? null;
  if (admitted && !admittedWorld) throw new Error('admitted Place epoch has no world definition');
  const configuredPort = admittedWorld?.server.port ?? 25575;
  const port = Number(parsed.values.port || configuredPort);
  if (admittedWorld && port !== configuredPort) {
    throw new Error(`admitted Place epoch requires port ${configuredPort}`);
  }
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`invalid proof port: ${parsed.values.port}`);
  }
  await assertPortAvailable(port);

  const repository = process.cwd();
  const root = path.resolve(
    '.behold-runtime',
    admitted ? 'place-epoch-proofs' : 'owned-world-proofs',
    runId,
  );
  if (fs.existsSync(root)) throw new Error(`proof run already exists: ${root}`);
  const serverDirectory = admitted ? admitted.paths.serverDirectory : path.join(root, 'server');
  const runtime = admitted ? admitted.paths.runtime : path.join(serverDirectory, 'world');
  const source = admitted ? admitted.paths.source : path.join(root, 'source');
  const baseline = admitted ? admitted.paths.baseline : path.join(root, 'baseline');
  const archiveRoot = admitted ? admitted.paths.archiveRoot : path.join(root, 'archive');
  const entityRoot = path.join(root, 'entities');
  const controlRoot = path.join(root, 'control');
  const evidenceRoot = path.join(root, 'evidence');
  for (const directory of [entityRoot, controlRoot, evidenceRoot]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  if (!admitted) {
    fs.mkdirSync(serverDirectory, { recursive: true });
    fs.mkdirSync(archiveRoot, { recursive: true });
  }

  const toolLock = JSON.parse(fs.readFileSync('docs/sf-world/tool-lock.json', 'utf8'));
  const serverJar = path.resolve(String(toolLock.tools.minecraftServer.path));
  const expectedServerJarSha256 = String(toolLock.tools.minecraftServer.sha256);
  const actualServerJarSha256 = sha256File(serverJar);
  if (actualServerJarSha256 !== expectedServerJarSha256) {
    throw new Error(`pinned server jar digest mismatch: ${actualServerJarSha256}`);
  }
  const java = bundledJava();
  const startedAt = new Date().toISOString();
  let worldId = WORLD_ID;
  let world: WorldLabDefinition;
  let sourceTree: ReturnType<typeof digestTree>;
  let baselineTree: ReturnType<typeof digestTree>;
  let admittedRuntimeTree: ReturnType<typeof digestTree> | null = null;
  let preparation: Awaited<ReturnType<typeof prepareWorld>>;
  let target: ProofTarget = TARGET;
  if (admitted && admittedWorld) {
    if (!parsed.values.arrival)
      throw new Error('--arrival x,y,z is required for a Place epoch proof');
    const arrival = parsePoint(String(parsed.values.arrival));
    const affordance = parsed.values.affordance
      ? parsePoint(String(parsed.values.affordance))
      : { x: arrival.x + 2, y: arrival.y, z: arrival.z };
    target = Object.freeze({
      x: affordance.x,
      y: affordance.y,
      z: affordance.z,
      item: 'apple',
      count: 1,
    });
    worldId = admitted.worldId;
    world = admittedWorld;
    sourceTree = digestTree(source);
    baselineTree = digestTree(baseline);
    admittedRuntimeTree = digestTree(runtime);
    if (
      sourceTree.digest !== admitted.behold.sourceTree.digest ||
      baselineTree.digest !== admitted.behold.baselineTree.digest ||
      admittedRuntimeTree.digest !== baselineTree.digest
    ) {
      throw new Error('admitted Place epoch drifted before continuity proof');
    }
    process.stdout.write(`[owned-world] preparing packaged Place epoch ${worldId}\n`);
    preparation = await prepareWorld({
      java,
      serverJar,
      serverDirectory,
      transcriptFile: path.join(evidenceRoot, 'preparation.log'),
      spawn: arrival,
      target,
    });
  } else {
    writeServerConfiguration(serverDirectory, port);
    process.stdout.write(`[owned-world] generating deterministic flat world in ${root}\n`);
    preparation = await prepareWorld({
      java,
      serverJar,
      serverDirectory,
      transcriptFile: path.join(evidenceRoot, 'generation.log'),
      spawn: SPAWN,
      target,
    });
    copyWorld(runtime, source);
    copyWorld(runtime, baseline);
    sourceTree = digestTree(source);
    baselineTree = digestTree(baseline);
    if (sourceTree.digest !== baselineTree.digest) {
      throw new Error('captured source and baseline are not identical');
    }
    world = {
      label: 'Behold-owned deterministic flat proof world',
      source: {
        path: source,
        digestProfile: TREE_DIGEST_PROFILE,
        expectedDigest: sourceTree.digest,
      },
      preparedBaseline: {
        path: baseline,
        digestProfile: TREE_DIGEST_PROFILE,
        expectedDigest: baselineTree.digest,
      },
      runtime: { worldPath: runtime, archiveRoot },
      server: { host: '127.0.0.1', port },
      notes: [
        `Generated by Minecraft 1.21.4 with level seed ${LEVEL_SEED}.`,
        `One dropped ${target.item} affordance is prepared at ${target.x},${target.y},${target.z}.`,
      ],
    };
    durableWriteJson(path.join(root, 'world-definition.json'), {
      schemaVersion: 2,
      worlds: { [worldId]: world },
    });
  }
  const initialRuntimeTree = digestTree(runtime);

  const transcript: string[] = [];
  const runPhase = async (phase: 'act' | 'resume') => {
    const proofFile = path.join(evidenceRoot, `${phase}.json`);
    const previous = {
      phase: process.env.BEHOLD_PROOF_PHASE,
      file: process.env.BEHOLD_PROOF_FILE,
    };
    process.env.BEHOLD_PROOF_PHASE = phase;
    process.env.BEHOLD_PROOF_FILE = proofFile;
    let run: Awaited<ReturnType<typeof startManagedWorld>> | null = null;
    try {
      run = await startManagedWorld(
        {
          worldId,
          world,
          controlRoot,
          serverDirectory,
          serverJar,
          expectedServerJarSha256,
          java,
          controllerEntry: path.resolve('dist/scripts/owned-world-inhabitant.js'),
          controllerEntityId: ENTITY_ID,
          controllerLeasePath: path.join(entityRoot, ENTITY_ID, 'runtime.lock'),
          model: 'script/behold-owned-world-proof-v1',
          task: 'owned-world-continuity-proof',
          allowTools: ['collect_nearby_item', 'inspect_volume'],
          startupTimeoutMs: 90_000,
          shutdownTimeoutMs: 90_000,
        },
        {
          stdout: (text) => {
            transcript.push(text);
            process.stdout.write(text);
          },
          stderr: (text) => {
            transcript.push(text);
            process.stderr.write(text);
          },
        },
      );
      const proofWait = new AbortController();
      try {
        await Promise.race([
          waitForFile(proofFile, 90_000, proofWait.signal),
          run.finished.then(() => {
            throw new Error(`${phase} controller exited before proof completion`);
          }),
        ]);
      } finally {
        proofWait.abort();
      }
      const proof = readJson(proofFile);
      validateInhabitantProof(proof, phase, worldId);
      await run.stop(`owned_world_${phase}_complete`);
      await run.finished;
      const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
      return {
        proofFile,
        proofSha256: sha256File(proofFile),
        proof,
        lifecycleFile: run.control.journalFile,
        lifecycleTipDigest: lifecycle.tipDigest,
        lifecycleEvents: lifecycle.events.length,
      };
    } catch (error) {
      if (run) await run.stop(`owned_world_${phase}_failed`).catch(() => {});
      throw error;
    } finally {
      restoreEnvironment('BEHOLD_PROOF_PHASE', previous.phase);
      restoreEnvironment('BEHOLD_PROOF_FILE', previous.file);
    }
  };

  process.stdout.write('[owned-world] running first embodied life\n');
  const act = await runPhase('act');
  const afterActTree = digestTree(runtime);
  process.stdout.write('[owned-world] restarting the same inhabitant\n');
  const resume = await runPhase('resume');
  const afterResumeTree = digestTree(runtime);

  const loomFiles = listFiles(path.join(entityRoot, ENTITY_ID, 'lync')).filter((file) =>
    file.endsWith('.lync'),
  );
  if (loomFiles.length !== 1)
    throw new Error(`expected one authoritative Lync log, found ${loomFiles.length}`);
  const assertions = {
    initialAffordanceObserved:
      act.proof.initialDroppedItems?.filter((item: any) => item?.name === target.item).length === 1,
    collectionConfirmedByMinecraft:
      act.proof.collection?.result?.ok === true &&
      act.proof.collection?.result?.item === target.item &&
      act.proof.collection?.result?.confirmation === 'mineflayer:playerCollect',
    independentConsequenceObserved:
      act.proof.independentWitness?.source === 'fresh_minecraft_connection' &&
      !act.proof.independentWitness?.droppedItems?.some((item: any) => item?.name === target.item),
    firstLifePersistedOneTurn: act.proof.resultingTurns === 1,
    restartLoadedPriorLife: resume.proof.priorTurns === 1,
    consequencePersistedAcrossRestart:
      resume.proof.initialObservation?.self?.inventory?.some(
        (item: any) => item?.name === target.item && item?.count === target.count,
      ) && !resume.proof.initialDroppedItems?.some((item: any) => item?.name === target.item),
    restartDidNotRepeatCollection: resume.proof.collectionAttempts === 0,
    restartExtendedSameLoom: resume.proof.resultingTurns === 2,
    lifecycleOwnedBothRuns: act.lifecycleEvents > 0 && resume.lifecycleEvents > 0,
  };
  const failed = Object.entries(assertions)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (failed.length) throw new Error(`owned-world assertions failed: ${failed.join(', ')}`);

  fs.writeFileSync(path.join(evidenceRoot, 'managed-transcript.log'), transcript.join(''), 'utf8');
  const reportFile = path.join(evidenceRoot, 'report.json');
  durableWriteJson(reportFile, {
    protocol: PROTOCOL,
    runId,
    worldId,
    entityId: ENTITY_ID,
    startedAt,
    completedAt: new Date().toISOString(),
    repository: {
      revision: gitRevision(),
      path: repository,
    },
    server: {
      version: String(toolLock.tools.minecraftServer.version),
      jar: serverJar,
      sha256: actualServerJarSha256,
      java,
      port,
      preparation,
      seed: admitted ? null : LEVEL_SEED,
    },
    placeEpoch: admitted,
    target,
    artifacts: {
      root,
      sourceTree,
      baselineTree,
      admittedRuntimeTree,
      initialRuntimeTree,
      afterActTree,
      afterResumeTree,
      loomFile: loomFiles[0],
      loomSha256: sha256File(loomFiles[0]),
      act: {
        proofFile: act.proofFile,
        proofSha256: act.proofSha256,
        lifecycleFile: act.lifecycleFile,
        lifecycleTipDigest: act.lifecycleTipDigest,
      },
      resume: {
        proofFile: resume.proofFile,
        proofSha256: resume.proofSha256,
        lifecycleFile: resume.lifecycleFile,
        lifecycleTipDigest: resume.lifecycleTipDigest,
      },
    },
    assertions,
  });
  process.stdout.write(`[owned-world] PASS ${reportFile}\n`);
}

async function prepareWorld(input: {
  java: string;
  serverJar: string;
  serverDirectory: string;
  transcriptFile: string;
  spawn: Readonly<{ x: number; y: number; z: number }>;
  target: Readonly<{ x: number; y: number; z: number; item: string; count: number }>;
}) {
  const startedAt = Date.now();
  const child = spawn(
    input.java,
    ['-Xms512M', '-Xmx1G', '-jar', fs.realpathSync.native(input.serverJar), 'nogui'],
    { cwd: input.serverDirectory, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const lines: string[] = [];
  const attach = (stream: NodeJS.ReadableStream, sink: NodeJS.WritableStream) => {
    let remainder = '';
    stream.on('data', (chunk) => {
      const text = String(chunk);
      sink.write(text);
      const parts = `${remainder}${text}`.split(/\r?\n/);
      remainder = parts.pop() || '';
      lines.push(...parts);
    });
  };
  attach(child.stdout, process.stdout);
  attach(child.stderr, process.stderr);
  const exit = waitForExit(child);
  await Promise.race([
    waitFor(() => lines.some(isMinecraftReadyLine), 90_000, 'generated server readiness'),
    exit.then((result) => {
      throw new Error(`generated server exited before readiness: ${JSON.stringify(result)}`);
    }),
  ]);
  for (const command of [
    'gamerule spawnRadius 0',
    'gamerule doDaylightCycle false',
    'time set day',
    'weather clear',
    `setworldspawn ${input.spawn.x} ${input.spawn.y} ${input.spawn.z}`,
    `kill @e[type=minecraft:item,x=${input.target.x},y=${input.target.y},z=${input.target.z},distance=..8]`,
    `summon minecraft:item ${input.target.x} ${input.target.y} ${input.target.z} {Item:{id:"minecraft:${input.target.item}",count:${input.target.count}}}`,
  ]) {
    child.stdin.write(`${command}\n`);
  }
  await waitFor(
    () => lines.some((line) => /Summoned new /.test(line)),
    30_000,
    'generated item affordance',
  );
  child.stdin.write('save-all flush\n');
  await waitFor(
    () => lines.some(isMinecraftSaveAcknowledgement),
    30_000,
    'generated world save acknowledgement',
  );
  child.stdin.write('stop\n');
  child.stdin.end();
  const result = await exit;
  if (result.code !== 0 || result.signal) {
    throw new Error(`generated server stopped abnormally: ${JSON.stringify(result)}`);
  }
  fs.writeFileSync(input.transcriptFile, `${lines.join('\n')}\n`, 'utf8');
  return { durationMs: Date.now() - startedAt, exit: result, transcriptFile: input.transcriptFile };
}

function writeServerConfiguration(directory: string, port: number) {
  const properties = [
    'allow-flight=true',
    'difficulty=peaceful',
    'enable-command-block=false',
    'enable-rcon=false',
    'enforce-secure-profile=false',
    'force-gamemode=true',
    'function-permission-level=2',
    'gamemode=survival',
    'generate-structures=false',
    `level-seed=${LEVEL_SEED}`,
    'level-type=minecraft:flat',
    'max-players=4',
    'motd=Behold owned-world proof',
    'online-mode=false',
    'player-idle-timeout=0',
    'prevent-proxy-connections=false',
    'pvp=false',
    'server-ip=127.0.0.1',
    `server-port=${port}`,
    'simulation-distance=4',
    'spawn-animals=false',
    'spawn-monsters=false',
    'spawn-npcs=false',
    'spawn-protection=0',
    'sync-chunk-writes=true',
    'view-distance=4',
    'white-list=false',
  ];
  fs.writeFileSync(path.join(directory, 'eula.txt'), 'eula=true\n', 'utf8');
  fs.writeFileSync(path.join(directory, 'server.properties'), `${properties.join('\n')}\n`, 'utf8');
}

function copyWorld(from: string, to: string) {
  fs.cpSync(from, to, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
    filter: (entry) => path.relative(from, entry) !== SESSION_LOCK,
  });
}

function validateInhabitantProof(value: any, phase: 'act' | 'resume', worldId: string) {
  if (
    value?.protocol !== 'behold.owned-world-inhabitant-proof.v1' ||
    value?.phase !== phase ||
    value?.entityId !== ENTITY_ID ||
    value?.circleId !== worldId ||
    !Array.isArray(value?.engineEvents)
  ) {
    throw new Error(`invalid ${phase} inhabitant proof`);
  }
}

function waitForFile(file: string, timeoutMs: number, signal?: AbortSignal) {
  return waitFor(() => fs.existsSync(file), timeoutMs, `proof file ${file}`, signal);
}

async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (condition()) return;
    await abortableDelay(100, signal);
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function assertPortAvailable(port: number) {
  return new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}

function assertCleanRepository() {
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    encoding: 'utf8',
  });
  if (status.status !== 0 || String(status.stdout).length > 0) {
    throw new Error('owned-world proof requires a clean Git worktree');
  }
}

function gitRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('could not resolve Git revision');
  return String(result.stdout).trim();
}

function bundledJava() {
  const candidate = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'minecraft',
    'runtime',
    'java-runtime-delta',
    'mac-os-arm64',
    'java-runtime-delta',
    'jre.bundle',
    'Contents',
    'Home',
    'bin',
    'java',
  );
  const java = process.env.SERVER_JAVA || (fs.existsSync(candidate) ? candidate : 'java');
  const version = spawnSync(java, ['-version'], { encoding: 'utf8' });
  if (version.status !== 0) throw new Error(`Java is unavailable: ${version.stderr}`);
  return java;
}

function sha256File(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listFiles(directory: string) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(full) : [full];
    })
    .sort();
}

function durableWriteJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
  const parent = fs.openSync(path.dirname(file), 'r');
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}

function safeSegment(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error(`unsafe run id: ${value}`);
  return value;
}

function parsePoint(value: string) {
  const coordinates = value.split(',').map(Number);
  if (
    coordinates.length !== 3 ||
    coordinates.some((coordinate) => !Number.isSafeInteger(coordinate))
  ) {
    throw new Error(`invalid arrival point: ${value}`);
  }
  return { x: coordinates[0], y: coordinates[1], z: coordinates[2] };
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

void main().catch((error) => {
  process.stderr.write(`[owned-world] ${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
