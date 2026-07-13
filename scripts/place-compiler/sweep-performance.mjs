#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';
import { hardwareFingerprint, loadBenchmark } from './benchmark-core.mjs';
import { sha256, timestamp } from './core.mjs';
import { parseSprintCompletion, summarizeEntities } from './ecology-core.mjs';
import { isAir } from './inspection-core.mjs';
import { classifyCase, summarizePerformance } from './performance-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function parse(argv) {
  const out = {
    benchmark: path.join(repositoryRoot, 'docs/place-compiler/benchmarks/living-places-v1.json'),
    runId: `performance-${timestamp()}`,
    place: 'all',
    profile: 'all',
    basePort: 25750,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--benchmark') out.benchmark = path.resolve(argv[++index]);
    else if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--place') out.place = argv[++index];
    else if (argv[index] === '--profile') out.profile = argv[++index];
    else if (argv[index] === '--base-port') out.basePort = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(out.runId)) throw new Error('invalid run id');
  if (!Number.isInteger(out.basePort) || out.basePort < 1024 || out.basePort > 65000)
    throw new Error('invalid base port');
  return out;
}

async function waitUntil(probe, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = probe();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function materialize(fixture, profileId, destination, port) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, 'scripts/place-compiler/materialize-runtime.mjs'),
      '--run-root',
      fixture.runRoot,
      '--recipe',
      fixture.recipePath,
      '--profile',
      profileId,
      '--destination',
      destination,
      '--port',
      String(port),
    ],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`Runtime materialization failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function processSample(pid) {
  const result = spawnSync('ps', ['-o', 'rss=,%cpu=', '-p', String(pid)], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  const [rssKiB, cpuPercent] = result.stdout.trim().split(/\s+/).map(Number);
  return { at: new Date().toISOString(), rssBytes: rssKiB * 1024, cpuPercent };
}

async function startServer(runtimeRoot, runtime, logPath) {
  const jarIndex = runtime.launch.indexOf('-jar');
  const jar = path.resolve(repositoryRoot, runtime.launch[jarIndex + 1]);
  if ((await sha256(jar)) !== runtime.minecraftServerSha256)
    throw new Error('Minecraft server digest mismatch');
  const log = createWriteStream(logPath, { flags: 'wx' });
  const started = process.hrtime.bigint();
  const child = spawn('java', ['-Xms1G', '-Xmx6G', '-jar', jar, 'nogui'], {
    cwd: runtimeRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  const capture = (chunk) => {
    const value = chunk.toString();
    output += value;
    log.write(value);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('exit', () => log.end());
  await waitUntil(
    () => {
      if (child.exitCode != null) throw new Error(`Minecraft exited early: ${child.exitCode}`);
      return output.includes('Done (');
    },
    120_000,
    'Minecraft readiness',
  );
  return {
    child,
    command: (value) => child.stdin.write(`${value}\n`),
    output: () => output,
    startupMilliseconds: Number(process.hrtime.bigint() - started) / 1e6,
  };
}

async function connectObserver(port, username) {
  const started = process.hrtime.bigint();
  const bot = mineflayer.createBot({
    host: '127.0.0.1',
    port,
    username,
    auth: 'offline',
    version: '1.21.4',
    hideErrors: false,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Performance observer timed out')), 30_000);
    bot.once('spawn', () => {
      clearTimeout(timer);
      resolve();
    });
    bot.once('error', reject);
    bot.once('kicked', (reason) => reject(new Error(`Performance observer kicked: ${reason}`)));
  });
  return { bot, connectMilliseconds: Number(process.hrtime.bigint() - started) / 1e6 };
}

function standableSurface(bot, x, z) {
  const minimumY = bot.game.minY ?? -64;
  const maximumY = minimumY + (bot.game.height ?? 384) - 1;
  for (let y = maximumY; y >= minimumY; y -= 1) {
    const block = bot.blockAt(new Vec3(x, y, z), false);
    if (!block || isAir(block.name)) continue;
    const above = bot.blockAt(new Vec3(x, y + 1, z), false);
    const aboveTwo = bot.blockAt(new Vec3(x, y + 2, z), false);
    if (
      above &&
      aboveTwo &&
      isAir(above.name) &&
      isAir(aboveTwo.name) &&
      !/(water|lava)/.test(block.name)
    )
      return { x, y, z, block: block.name };
  }
  return null;
}

async function prepareSite(server, bot, checkpoint, intendedGameMode) {
  const highY = Math.min((bot.game.minY ?? -64) + (bot.game.height ?? 384) - 16, 384);
  server.command(`gamemode spectator ${bot.username}`);
  server.command(`tp ${bot.username} ${checkpoint.x + 0.5} ${highY} ${checkpoint.z + 0.5}`);
  await waitUntil(
    () => bot.world.getColumn(Math.floor(checkpoint.x / 16), Math.floor(checkpoint.z / 16)),
    20_000,
    'checkpoint chunk',
  );
  await sleep(250);
  const candidates = [];
  for (let dx = -8; dx <= 8; dx += 4)
    for (let dz = -8; dz <= 8; dz += 4) {
      const surface = standableSurface(bot, checkpoint.x + dx, checkpoint.z + dz);
      if (surface) candidates.push(surface);
    }
  if (!candidates.length) throw new Error(`No standable site near ${checkpoint.id}`);
  const heights = candidates.map((item) => item.y).sort((left, right) => left - right);
  const medianY = heights[Math.floor(heights.length / 2)];
  const site = [...candidates].sort(
    (left, right) =>
      Math.abs(left.y - medianY) - Math.abs(right.y - medianY) ||
      Math.hypot(left.x - checkpoint.x, left.z - checkpoint.z) -
        Math.hypot(right.x - checkpoint.x, right.z - checkpoint.z),
  )[0];
  server.command(`tp ${bot.username} ${site.x + 0.5} ${site.y + 1} ${site.z + 0.5}`);
  server.command(`spawnpoint ${bot.username} ${site.x} ${site.y + 1} ${site.z}`);
  server.command(`gamemode ${intendedGameMode} ${bot.username}`);
  await waitUntil(
    () => Math.abs(bot.entity.position.y - (site.y + 1)) < 2,
    10_000,
    'site placement',
  );
  return { checkpointId: checkpoint.id, ...site };
}

async function sprint(server, ticks, timeoutSeconds) {
  const offset = server.output().length;
  const started = process.hrtime.bigint();
  server.command(`tick sprint ${ticks}`);
  const completion = await waitUntil(
    () => parseSprintCompletion(server.output().slice(offset), ticks),
    timeoutSeconds * 1000,
    `${ticks}-tick sprint`,
  );
  return {
    ...completion,
    observedWallMilliseconds: Number(process.hrtime.bigint() - started) / 1e6,
  };
}

async function stop(server, bot) {
  try {
    bot?.end('performance case complete');
  } catch {}
  if (server.child.exitCode == null) {
    server.command('save-all');
    server.command('stop');
    await waitUntil(() => server.child.exitCode != null, 30_000, 'clean server stop');
  }
  return { clean: server.child.exitCode === 0, exitCode: server.child.exitCode };
}

async function runCase(loaded, fixture, profileId, repetition, root, port) {
  const caseId = `${fixture.placeId}-${profileId}-r${repetition}`;
  const caseRoot = path.join(root, 'runtimes', caseId);
  const evidenceRoot = path.join(root, 'cases');
  mkdirSync(evidenceRoot, { recursive: true });
  const runtime = materialize(fixture, profileId, caseRoot, port);
  const server = await startServer(
    caseRoot,
    runtime,
    path.join(evidenceRoot, `${caseId}-server.log`),
  );
  let bot;
  let shutdown;
  let measurement;
  const samples = [];
  const sampler = setInterval(() => {
    const sample = processSample(server.child.pid);
    if (sample) samples.push(sample);
  }, 250);
  try {
    const connected = await connectObserver(port, `PERF_${profileId}_${repetition}`.slice(0, 16));
    bot = connected.bot;
    const site = await prepareSite(
      server,
      bot,
      fixture.checkpoints[0],
      loaded.profiles[profileId].minecraft.gameMode,
    );
    await sleep(500);
    const before = {
      loadedChunkCount: bot.world.getColumns().length,
      entities: summarizeEntities(
        bot.entities,
        bot.entity.id,
        bot.entity.position,
        loaded.benchmark.inspections.observationRadius,
      ),
    };
    const measuredSprint = await sprint(
      server,
      loaded.benchmark.performanceSweep.sprintTicks,
      loaded.benchmark.performanceSweep.maxWallSecondsPerCase,
    );
    await sleep(100);
    const after = {
      loadedChunkCount: bot.world.getColumns().length,
      entities: summarizeEntities(
        bot.entities,
        bot.entity.id,
        bot.entity.position,
        loaded.benchmark.inspections.observationRadius,
      ),
    };
    measurement = {
      caseId,
      placeId: fixture.placeId,
      runId: fixture.runId,
      worldTreeSha256: fixture.worldTreeSha256,
      profileId,
      profile: loaded.profiles[profileId],
      repetition,
      port,
      serverStartupMilliseconds: server.startupMilliseconds,
      observerConnectMilliseconds: connected.connectMilliseconds,
      observationSite: site,
      before,
      after,
      sprint: measuredSprint,
    };
  } finally {
    clearInterval(sampler);
    const last = processSample(server.child.pid);
    if (last) samples.push(last);
    shutdown = await stop(server, bot);
  }
  measurement.shutdown = shutdown;
  measurement.process = {
    sampleIntervalMilliseconds: 250,
    samples,
    peakRssBytes: Math.max(...samples.map((sample) => sample.rssBytes)),
    peakCpuPercent: Math.max(...samples.map((sample) => sample.cpuPercent)),
  };
  measurement.classification = classifyCase(
    measurement,
    loaded.benchmark.performanceSweep.maxWallSecondsPerCase,
  );
  const reportPath = path.join(evidenceRoot, `${caseId}.json`);
  writeFileSync(reportPath, `${JSON.stringify(measurement, null, 2)}\n`, { flag: 'wx' });
  return { ...measurement, reportPath, reportSha256: await sha256(reportPath) };
}

const options = parse(process.argv.slice(2));
const loaded = await loadBenchmark(options.benchmark, repositoryRoot);
const fixtures =
  options.place === 'all'
    ? loaded.fixtures
    : loaded.fixtures.filter((fixture) => fixture.placeId === options.place);
const profiles =
  options.profile === 'all'
    ? loaded.benchmark.performanceSweep.profiles
    : loaded.benchmark.performanceSweep.profiles.filter((profile) => profile === options.profile);
if (!fixtures.length || !profiles.length) throw new Error('No selected performance cases');
const root = path.join(
  repositoryRoot,
  '.behold-artifacts/place-benchmarks',
  loaded.benchmark.id,
  options.runId,
);
if (existsSync(root)) throw new Error(`benchmark run exists: ${root}`);
mkdirSync(root, { recursive: true });
const cases = [];
let caseIndex = 0;
for (const fixture of fixtures) {
  for (const profileId of profiles) {
    for (
      let repetition = 1;
      repetition <= loaded.benchmark.performanceSweep.repetitions;
      repetition += 1
    ) {
      cases.push(
        await runCase(loaded, fixture, profileId, repetition, root, options.basePort + caseIndex),
      );
      caseIndex += 1;
    }
  }
}
const summary = summarizePerformance(
  cases,
  loaded.profiles,
  loaded.benchmark.performanceSweep.maxWallSecondsPerCase,
);
const manifest = {
  schemaVersion: 1,
  status: 'completed',
  kind: 'living-places-performance-sweep',
  benchmarkId: loaded.benchmark.id,
  runId: options.runId,
  createdAt: new Date().toISOString(),
  hardware: hardwareFingerprint(),
  benchmarkSha256: await sha256(loaded.path),
  method: {
    substrate: 'real Minecraft 1.21.4 server with one protocol observer',
    ticksPerCase: loaded.benchmark.performanceSweep.sprintTicks,
    repetitions: loaded.benchmark.performanceSweep.repetitions,
    processSamplingMilliseconds: 250,
    stabilityFloorTps: 20,
  },
  summary,
  cases: cases.map((item) => ({
    caseId: item.caseId,
    reportPath: path.relative(root, item.reportPath),
    reportSha256: item.reportSha256,
  })),
};
writeFileSync(
  path.join(root, 'performance-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: 'wx' },
);
process.stdout.write(`${JSON.stringify({ root, manifest }, null, 2)}\n`);
