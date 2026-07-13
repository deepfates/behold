#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';
import { hardwareFingerprint, loadBenchmark } from './benchmark-core.mjs';
import {
  deriveEcologyFindings,
  parseSprintCompletion,
  summarizeEntities,
  summarizeTurnover,
} from './ecology-core.mjs';
import { sha256, timestamp } from './core.mjs';
import { isAir } from './inspection-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function parse(argv) {
  const out = {
    benchmark: path.join(repositoryRoot, 'docs/place-compiler/benchmarks/living-places-v1.json'),
    runId: `ecology-${timestamp()}`,
    place: 'all',
    basePort: 25730,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--benchmark') out.benchmark = path.resolve(argv[++index]);
    else if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--place') out.place = argv[++index];
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

function materialize(fixture, destination, port) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, 'scripts/place-compiler/materialize-runtime.mjs'),
      '--run-root',
      fixture.runRoot,
      '--recipe',
      fixture.recipePath,
      '--profile',
      'living',
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

async function startServer(runtimeRoot, runtime, logPath) {
  const jarIndex = runtime.launch.indexOf('-jar');
  if (jarIndex < 0 || !runtime.launch[jarIndex + 1]) throw new Error('runtime launch has no jar');
  const jar = path.resolve(repositoryRoot, runtime.launch[jarIndex + 1]);
  if ((await sha256(jar)) !== runtime.minecraftServerSha256)
    throw new Error('Minecraft server digest mismatch');
  const log = createWriteStream(logPath, { flags: 'wx' });
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
  };
}

async function connectObserver(port, placeId) {
  const bot = mineflayer.createBot({
    host: '127.0.0.1',
    port,
    username: `ECO_${placeId.replaceAll('-', '_')}`.slice(0, 16),
    auth: 'offline',
    version: '1.21.4',
    hideErrors: false,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Ecology observer spawn timed out')), 30_000);
    bot.once('spawn', () => {
      clearTimeout(timer);
      resolve();
    });
    bot.once('error', reject);
    bot.once('kicked', (reason) => reject(new Error(`Ecology observer kicked: ${reason}`)));
  });
  return bot;
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

async function prepareObservationSite(server, bot, checkpoint) {
  const highY = Math.min((bot.game.minY ?? -64) + (bot.game.height ?? 384) - 16, 384);
  server.command(`gamemode spectator ${bot.username}`);
  server.command(`tp ${bot.username} ${checkpoint.x + 0.5} ${highY} ${checkpoint.z + 0.5}`);
  await waitUntil(
    () =>
      Math.abs(bot.entity.position.x - (checkpoint.x + 0.5)) < 2 &&
      Math.abs(bot.entity.position.z - (checkpoint.z + 0.5)) < 2 &&
      bot.world.getColumn(Math.floor(checkpoint.x / 16), Math.floor(checkpoint.z / 16)),
    20_000,
    `observation checkpoint ${checkpoint.id}`,
  );
  await sleep(250);
  const candidates = [];
  for (let dx = -8; dx <= 8; dx += 4) {
    for (let dz = -8; dz <= 8; dz += 4) {
      const surface = standableSurface(bot, checkpoint.x + dx, checkpoint.z + dz);
      if (surface) candidates.push(surface);
    }
  }
  if (!candidates.length) throw new Error(`No standable ecology site near ${checkpoint.id}`);
  const heights = candidates.map((candidate) => candidate.y).sort((left, right) => left - right);
  const medianY = heights[Math.floor(heights.length / 2)];
  const site = [...candidates].sort(
    (left, right) =>
      Math.abs(left.y - medianY) - Math.abs(right.y - medianY) ||
      Math.hypot(left.x - checkpoint.x, left.z - checkpoint.z) -
        Math.hypot(right.x - checkpoint.x, right.z - checkpoint.z),
  )[0];
  server.command(`tp ${bot.username} ${site.x + 0.5} ${site.y + 1} ${site.z + 0.5}`);
  server.command(`spawnpoint ${bot.username} ${site.x} ${site.y + 1} ${site.z}`);
  server.command(`gamemode survival ${bot.username}`);
  await waitUntil(
    () => Math.abs(bot.entity.position.y - (site.y + 1)) < 2,
    10_000,
    'survival observation placement',
  );
  return { checkpointId: checkpoint.id, ...site };
}

async function query(server, command, pattern, label) {
  const offset = server.output().length;
  server.command(command);
  const match = await waitUntil(() => server.output().slice(offset).match(pattern), 10_000, label);
  return match;
}

async function sprint(server, ticks, timeoutSeconds) {
  const offset = server.output().length;
  const wallStarted = process.hrtime.bigint();
  server.command(`tick sprint ${ticks}`);
  const completion = await waitUntil(
    () => parseSprintCompletion(server.output().slice(offset), ticks),
    timeoutSeconds * 1000,
    `${ticks}-tick sprint`,
  );
  return {
    ...completion,
    observedWallMilliseconds: Number(process.hrtime.bigint() - wallStarted) / 1e6,
  };
}

async function snapshot(server, bot, radius) {
  const daytime = Number(
    (await query(server, 'time query daytime', /The time is (\d+)/, 'daytime query'))[1],
  );
  const gametime = Number(
    (await query(server, 'time query gametime', /The time is (\d+)/, 'gametime query'))[1],
  );
  const day = Number((await query(server, 'time query day', /The time is (\d+)/, 'day query'))[1]);
  const gamerules = {};
  for (const rule of ['doDaylightCycle', 'doWeatherCycle', 'doMobSpawning']) {
    const match = await query(
      server,
      `gamerule ${rule}`,
      new RegExp(`${rule} is currently set to: (true|false)`, 'i'),
      `${rule} query`,
    );
    gamerules[rule] = match[1].toLowerCase() === 'true';
  }
  gamerules.randomTickSpeed = Number(
    (
      await query(
        server,
        'gamerule randomTickSpeed',
        /randomTickSpeed is currently set to: (\d+)/i,
        'randomTickSpeed query',
      )
    )[1],
  );
  return {
    daytime,
    gametime,
    day,
    weather: {
      raining: Boolean(bot.isRaining),
      rainState: bot.rainState,
      thunderState: bot.thunderState,
    },
    observer: {
      position: bot.entity.position,
      health: bot.health,
      food: bot.food,
      gameMode: bot.game.gameMode,
      loadedChunkCount: bot.world.getColumns().length,
    },
    gamerules,
    entities: summarizeEntities(bot.entities, bot.entity.id, bot.entity.position, radius),
  };
}

async function stop(server, bot) {
  try {
    bot?.end('ecology soak complete');
  } catch {}
  if (server.child.exitCode == null) {
    server.command('save-all');
    server.command('stop');
    await waitUntil(() => server.child.exitCode != null, 30_000, 'clean server stop');
  }
  return { clean: server.child.exitCode === 0, exitCode: server.child.exitCode };
}

async function soakFixture(loaded, fixture, root, port) {
  const config = loaded.benchmark.ecologySoak;
  const runtimeRoot = path.join(root, 'runtimes', `${fixture.placeId}-living`);
  const evidenceRoot = path.join(root, 'soaks');
  mkdirSync(evidenceRoot, { recursive: true });
  const runtime = materialize(fixture, runtimeRoot, port);
  const server = await startServer(
    runtimeRoot,
    runtime,
    path.join(evidenceRoot, `${fixture.placeId}-server.log`),
  );
  let bot;
  let report;
  let shutdown;
  const startedAt = new Date().toISOString();
  try {
    bot = await connectObserver(port, fixture.placeId);
    const observationSite = await prepareObservationSite(server, bot, fixture.checkpoints[0]);
    await sleep(500);
    const settle = await sprint(server, config.settleTicks, config.maxWallSeconds);
    await sleep(250);
    const before = await snapshot(server, bot, loaded.benchmark.inspections.observationRadius);
    const day = await sprint(server, config.sprintTicks, config.maxWallSeconds);
    await sleep(250);
    const after = await snapshot(server, bot, loaded.benchmark.inspections.observationRadius);
    const deathMessages = server
      .output()
      .split('\n')
      .filter(
        (line) =>
          line.includes(bot.username) &&
          /(slain|died|fell|drowned|burned|blew up|killed|starved|suffocated|withered)/i.test(line),
      );
    const lifecycle = {
      deathMessages,
      observerConnectedAfterSprint: Boolean(bot.entity),
    };
    report = {
      schemaVersion: 1,
      status: 'completed',
      benchmarkId: loaded.benchmark.id,
      placeId: fixture.placeId,
      runId: fixture.runId,
      worldTreeSha256: fixture.worldTreeSha256,
      profileId: 'living',
      profile: loaded.profiles.living,
      startedAt,
      finishedAt: new Date().toISOString(),
      method: {
        substrate: 'real Minecraft 1.21.4 server and protocol observer',
        authority: 'native Minecraft time, weather, gamerules, spawning, and entity lifecycle',
        observerScope: `protocol-visible entities within ${loaded.benchmark.inspections.observationRadius} blocks of the fixture spawn`,
        acceleration: 'vanilla server tick sprint; no parallel ecology or Behold identity',
      },
      observationSite,
      settle,
      daySprint: day,
      before,
      after,
      turnover: summarizeTurnover(before.entities, after.entities),
      observerLifecycle: lifecycle,
      findings: deriveEcologyFindings(fixture.placeId, before, after, lifecycle),
      assertions: {
        minecraftAuthoritative: loaded.profiles.living.policy.minecraftAuthoritative,
        customEcologyRequired: loaded.profiles.living.policy.customEcologyRequired,
        nativeRulesEnabled:
          after.gamerules.doDaylightCycle &&
          after.gamerules.doWeatherCycle &&
          after.gamerules.doMobSpawning &&
          after.gamerules.randomTickSpeed > 0,
        fullMinecraftDayRequested: config.sprintTicks >= 24000,
        fullMinecraftDayAdvanced: after.gametime - before.gametime >= config.sprintTicks,
        immutableSourceUnlocked: !existsSync(path.join(fixture.world, 'session.lock')),
      },
    };
  } finally {
    shutdown = await stop(server, bot);
  }
  report.shutdown = shutdown;
  const reportPath = path.join(evidenceRoot, `${fixture.placeId}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return { placeId: fixture.placeId, reportPath, reportSha256: await sha256(reportPath) };
}

const options = parse(process.argv.slice(2));
const loaded = await loadBenchmark(options.benchmark, repositoryRoot);
const selected =
  options.place === 'all'
    ? loaded.fixtures
    : loaded.fixtures.filter((fixture) => fixture.placeId === options.place);
if (!selected.length) throw new Error(`No selected fixture: ${options.place}`);
const root = path.join(
  repositoryRoot,
  '.behold-artifacts/place-benchmarks',
  loaded.benchmark.id,
  options.runId,
);
if (existsSync(root)) throw new Error(`benchmark run exists: ${root}`);
mkdirSync(root, { recursive: true });
const results = [];
for (let index = 0; index < selected.length; index += 1)
  results.push(await soakFixture(loaded, selected[index], root, options.basePort + index));
const manifest = {
  schemaVersion: 1,
  status: 'completed',
  kind: 'living-places-ecology-soak',
  benchmarkId: loaded.benchmark.id,
  runId: options.runId,
  createdAt: new Date().toISOString(),
  hardware: hardwareFingerprint(),
  benchmarkSha256: await sha256(loaded.path),
  results: results.map((result) => ({
    ...result,
    reportPath: path.relative(root, result.reportPath),
  })),
};
writeFileSync(path.join(root, 'ecology-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: 'wx',
});
process.stdout.write(`${JSON.stringify({ root, manifest }, null, 2)}\n`);
