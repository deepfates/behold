#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardwareFingerprint, loadBenchmark } from './benchmark-core.mjs';
import {
  deriveEcologyFindings,
  parseSprintCompletion,
  summarizeEntities,
  summarizeTurnover,
} from './ecology-core.mjs';
import { sha256, timestamp } from './core.mjs';
import { deriveEvidencePlan, laneExpectation } from './evidence-contract.mjs';
import {
  connectObserver,
  createProgressReporter,
  materializeRuntime,
  queryServer,
  sleep,
  sprintTicks,
  startMinecraftServer,
  stopMinecraftServer,
} from './minecraft-harness.mjs';
import { prepareObservationSite } from './observation-site.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parse(argv) {
  const out = {
    benchmark: path.join(repositoryRoot, 'docs/place-compiler/benchmarks/living-places-v1.json'),
    runId: `ecology-${timestamp()}`,
    place: 'all',
    checkpoint: null,
    basePort: 25730,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--benchmark') out.benchmark = path.resolve(argv[++index]);
    else if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--place') out.place = argv[++index];
    else if (argv[index] === '--checkpoint') out.checkpoint = argv[++index];
    else if (argv[index] === '--base-port') out.basePort = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(out.runId)) throw new Error('invalid run id');
  if (!Number.isInteger(out.basePort) || out.basePort < 1024 || out.basePort > 65000)
    throw new Error('invalid base port');
  return out;
}

async function snapshot(server, bot, radius) {
  const daytime = Number(
    (await queryServer(server, 'time query daytime', /The time is (\d+)/, 'daytime query'))[1],
  );
  const gametime = Number(
    (await queryServer(server, 'time query gametime', /The time is (\d+)/, 'gametime query'))[1],
  );
  const day = Number(
    (await queryServer(server, 'time query day', /The time is (\d+)/, 'day query'))[1],
  );
  const gamerules = {};
  for (const rule of ['doDaylightCycle', 'doWeatherCycle', 'doMobSpawning']) {
    const match = await queryServer(
      server,
      `gamerule ${rule}`,
      new RegExp(`${rule} is currently set to: (true|false)`, 'i'),
      `${rule} query`,
    );
    gamerules[rule] = match[1].toLowerCase() === 'true';
  }
  gamerules.randomTickSpeed = Number(
    (
      await queryServer(
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

async function soakFixture(loaded, fixture, root, port, progress, checkpointId = null) {
  const config = loaded.benchmark.ecologySoak;
  const runtimeRoot = path.join(root, 'runtimes', `${fixture.placeId}-living`);
  const evidenceRoot = path.join(root, 'soaks');
  mkdirSync(evidenceRoot, { recursive: true });
  progress.emit('fixture', 'started', { placeId: fixture.placeId, profileId: 'living' });
  const runtime = materializeRuntime({
    repositoryRoot,
    fixture,
    profileId: 'living',
    destination: runtimeRoot,
    port,
  });
  const server = await startMinecraftServer({
    repositoryRoot,
    runtimeRoot,
    runtime,
    logPath: path.join(evidenceRoot, `${fixture.placeId}-server.log`),
    progress,
  });
  let bot;
  let report;
  let shutdown;
  const startedAt = new Date().toISOString();
  try {
    bot = (
      await connectObserver({
        port,
        username: `ECO_${fixture.placeId.replaceAll('-', '_')}`.slice(0, 16),
        label: 'ecology observer',
        progress,
      })
    ).bot;
    const checkpoint = checkpointId
      ? fixture.checkpoints.find((item) => item.id === checkpointId)
      : (fixture.checkpoints.find(
          (item) => item.id === fixture.experience?.arrival?.checkpointId,
        ) ?? fixture.checkpoints[0]);
    if (!checkpoint) throw new Error(`Unknown ecology checkpoint: ${checkpointId}`);
    const observationSite = await prepareObservationSite({
      server,
      bot,
      checkpoint,
      gameMode: 'survival',
      label: `observation checkpoint ${checkpoint.id}`,
    });
    await sleep(500);
    const settle = await sprintTicks(
      server,
      config.settleTicks,
      config.maxWallSeconds,
      parseSprintCompletion,
      progress,
    );
    await sleep(250);
    const before = await snapshot(server, bot, loaded.benchmark.inspections.observationRadius);
    const day = await sprintTicks(
      server,
      config.sprintTicks,
      config.maxWallSeconds,
      parseSprintCompletion,
      progress,
    );
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
      runtimeLaunch: server.launch,
      startedAt,
      finishedAt: new Date().toISOString(),
      method: {
        substrate: 'real Minecraft 1.21.4 server and protocol observer',
        authority: 'native Minecraft time, weather, gamerules, spawning, and entity lifecycle',
        observerScope: `protocol-visible entities within ${loaded.benchmark.inspections.observationRadius} blocks of the fixture spawn`,
        acceleration: 'vanilla server tick sprint; no parallel ecology or Behold identity',
        arrivalSelection: fixture.experience
          ? 'declared place experience arrival'
          : 'first recipe landmark fallback',
      },
      experience: fixture.experience
        ? {
            path: path.relative(repositoryRoot, fixture.experiencePath),
            sha256: fixture.experienceSha256,
            arrival: fixture.experience.arrival,
          }
        : null,
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
    shutdown = await stopMinecraftServer({
      server,
      bot,
      reason: 'ecology soak complete',
      beforeStop: ['forceload remove all'],
      progress,
    });
  }
  report.shutdown = shutdown;
  const reportPath = path.join(evidenceRoot, `${fixture.placeId}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  progress.emit('fixture', 'completed', { placeId: fixture.placeId, reportPath });
  return { placeId: fixture.placeId, reportPath, reportSha256: await sha256(reportPath) };
}

const options = parse(process.argv.slice(2));
const loaded = await loadBenchmark(options.benchmark, repositoryRoot);
const selected =
  options.place === 'all'
    ? loaded.fixtures
    : loaded.fixtures.filter((fixture) => fixture.placeId === options.place);
if (!selected.length) throw new Error(`No selected fixture: ${options.place}`);
if (options.checkpoint && selected.length !== 1)
  throw new Error('--checkpoint requires exactly one selected place');
const root = path.join(
  repositoryRoot,
  '.behold-artifacts/place-benchmarks',
  loaded.benchmark.id,
  options.runId,
);
if (existsSync(root)) throw new Error(`benchmark run exists: ${root}`);
mkdirSync(root, { recursive: true });
const progress = createProgressReporter({
  lane: 'ecology',
  runId: options.runId,
  filePath: path.join(root, 'progress.jsonl'),
});
const results = [];
for (let index = 0; index < selected.length; index += 1)
  results.push(
    await soakFixture(
      loaded,
      selected[index],
      root,
      options.basePort + index,
      progress,
      options.checkpoint,
    ),
  );
progress.emit('run', 'completed', { resultCount: results.length });
await progress.close();
const evidencePlan = deriveEvidencePlan({ benchmark: loaded.benchmark, fixtures: selected });
const manifest = {
  schemaVersion: 1,
  status: 'completed',
  kind: 'living-places-ecology-soak',
  benchmarkId: loaded.benchmark.id,
  runId: options.runId,
  createdAt: new Date().toISOString(),
  hardware: hardwareFingerprint(),
  benchmarkSha256: await sha256(loaded.path),
  expectation: laneExpectation(evidencePlan, 'ecology'),
  progress: {
    path: 'progress.jsonl',
    sha256: await sha256(path.join(root, 'progress.jsonl')),
  },
  results: results.map((result) => ({
    ...result,
    reportPath: path.relative(root, result.reportPath),
  })),
};
writeFileSync(path.join(root, 'ecology-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: 'wx',
});
process.stdout.write(`${JSON.stringify({ root, manifest }, null, 2)}\n`);
