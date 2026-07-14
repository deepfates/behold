#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardwareFingerprint, loadBenchmark } from './benchmark-core.mjs';
import {
  classifyCapacityCase,
  simulationChunkCount,
  summarizeCapacity,
  validateCapacityPlan,
} from './capacity-core.mjs';
import { sha256, timestamp } from './core.mjs';
import { parseSprintCompletion } from './ecology-core.mjs';
import {
  connectObserver,
  createProgressReporter,
  materializeRuntime,
  queryServer,
  sampleProcess,
  sleep,
  sprintTicks,
  startMinecraftServer,
  stopMinecraftServer,
  waitUntil,
} from './minecraft-harness.mjs';
import { prepareObservationSite } from './observation-site.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parse(argv) {
  const out = {
    benchmark: path.join(repositoryRoot, 'docs/place-compiler/benchmarks/living-places-v3.json'),
    plan: path.join(repositoryRoot, 'docs/place-compiler/capacity-frontier-v1.json'),
    place: 'san-francisco',
    profile: 'living',
    case: 'all',
    runId: `capacity-${timestamp()}`,
    basePort: 25880,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--benchmark') out.benchmark = path.resolve(argv[++index]);
    else if (argv[index] === '--plan') out.plan = path.resolve(argv[++index]);
    else if (argv[index] === '--place') out.place = argv[++index];
    else if (argv[index] === '--profile') out.profile = argv[++index];
    else if (argv[index] === '--case') out.case = argv[++index];
    else if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--base-port') out.basePort = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(out.runId)) throw new Error('invalid run id');
  if (!Number.isInteger(out.basePort) || out.basePort < 1024 || out.basePort > 65000)
    throw new Error('invalid base port');
  return out;
}

async function scoreCount(server, holder) {
  server.command(
    `execute store result score ${holder} capacity_fixture if entity @e[type=minecraft:villager,tag=capacity_fixture]`,
  );
  const match = await queryServer(
    server,
    `scoreboard players get ${holder} capacity_fixture`,
    new RegExp(`${holder} has (\\d+) \\[capacity_fixture\\]`),
    `${holder} capacity score`,
  );
  return Number(match[1]);
}

function processSummary(samples) {
  const startingRssBytes = samples[0]?.rssBytes ?? 0;
  const peakRssBytes = Math.max(0, ...samples.map((sample) => sample.rssBytes));
  return {
    sampleIntervalMilliseconds: 250,
    sampleCount: samples.length,
    startingRssBytes,
    peakRssBytes,
    peakIncreaseBytes: Math.max(0, peakRssBytes - startingRssBytes),
    peakCpuPercent: Math.max(0, ...samples.map((sample) => sample.cpuPercent)),
    samples,
  };
}

function distances(sites) {
  const values = [];
  for (let left = 0; left < sites.length; left += 1)
    for (let right = left + 1; right < sites.length; right += 1)
      values.push({
        from: sites[left].checkpointId,
        to: sites[right].checkpointId,
        blocks: Math.hypot(sites[left].x - sites[right].x, sites[left].z - sites[right].z),
      });
  return values;
}

async function runCase({ loaded, fixture, plan, item, index, root, port, progress }) {
  const caseId = item.id;
  const runtimeRoot = path.join(root, 'runtimes', caseId);
  const caseRoot = path.join(root, 'cases');
  mkdirSync(caseRoot, { recursive: true });
  progress.emit('case', 'started', { caseId, ...item });
  const runtime = materializeRuntime({
    repositoryRoot,
    fixture,
    profileId: loaded.profiles.living ? 'living' : 'playable',
    destination: runtimeRoot,
    port,
    maxPlayers: item.protocolBodies + 2,
  });
  const server = await startMinecraftServer({
    repositoryRoot,
    runtimeRoot,
    runtime,
    logPath: path.join(caseRoot, `${caseId}-server.log`),
    progress,
  });
  const serverSamples = [];
  const harnessSamples = [];
  const sample = () => {
    const serverSample = sampleProcess(server.child.pid);
    const harnessSample = sampleProcess(process.pid);
    if (serverSample) serverSamples.push(serverSample);
    if (harnessSample) harnessSamples.push(harnessSample);
  };
  const sampler = setInterval(sample, 250);
  sample();
  const bots = [];
  const bodyErrors = [];
  let report;
  let shutdown;
  try {
    server.command('gamerule doMobSpawning false');
    server.command('kill @e[type=!minecraft:player]');
    server.command('scoreboard objectives add capacity_fixture dummy');
    progress.emit('body-batch', 'connecting', { caseId, bodyCount: item.protocolBodies });
    for (let bodyIndex = 0; bodyIndex < item.protocolBodies; bodyIndex += 1) {
      const username = `CAP${index}_${bodyIndex}`.slice(0, 16);
      const connected = await connectObserver({
        port,
        username,
        label: `capacity body ${bodyIndex}`,
      });
      connected.bot.on('error', (error) =>
        bodyErrors.push({ username, at: new Date().toISOString(), error: String(error) }),
      );
      connected.bot.on('kicked', (reason) =>
        bodyErrors.push({ username, at: new Date().toISOString(), kicked: String(reason) }),
      );
      bots.push(connected.bot);
    }
    progress.emit('body-batch', 'connected', { caseId, bodyCount: bots.length });

    const checkpoints = plan.regionCheckpointIds
      .slice(0, item.activeRegions)
      .map((id) => fixture.checkpoints.find((checkpoint) => checkpoint.id === id));
    const sites = [];
    for (let regionIndex = 0; regionIndex < checkpoints.length; regionIndex += 1) {
      const leader = bots[regionIndex];
      const naturalSite = await prepareObservationSite({
        server,
        bot: leader,
        checkpoint: checkpoints[regionIndex],
        gameMode: 'spectator',
        label: `capacity region ${checkpoints[regionIndex].id}`,
      });
      if (plan.arena?.enabled) {
        const y = naturalSite.y + plan.arena.heightOffsetBlocks;
        const radius = plan.arena.halfWidthBlocks;
        server.command(
          `fill ${naturalSite.x - radius} ${y} ${naturalSite.z - radius} ${naturalSite.x + radius} ${y} ${naturalSite.z + radius} minecraft:smooth_stone`,
        );
        for (let airY = y + 1; airY <= y + 4; airY += 1)
          server.command(
            `fill ${naturalSite.x - radius} ${airY} ${naturalSite.z - radius} ${naturalSite.x + radius} ${airY} ${naturalSite.z + radius} minecraft:air`,
          );
        sites.push({
          ...naturalSite,
          sourceSurfaceY: naturalSite.y,
          y,
          block: 'smooth_stone',
          syntheticArena: true,
        });
      } else sites.push(naturalSite);
    }
    for (let bodyIndex = 0; bodyIndex < bots.length; bodyIndex += 1) {
      const site = sites[bodyIndex % sites.length];
      server.command(`gamemode spectator ${bots[bodyIndex].username}`);
      server.command(
        `tp ${bots[bodyIndex].username} ${site.x + 0.5} ${site.y + 2} ${site.z + 0.5}`,
      );
    }
    await waitUntil(
      () =>
        bots.every((bot, bodyIndex) => {
          const site = sites[bodyIndex % sites.length];
          return Math.hypot(bot.entity.position.x - site.x, bot.entity.position.z - site.z) < 4;
        }),
      20_000,
      'capacity body placement',
    );

    progress.emit('entity-batch', 'spawning', { caseId, entityCount: item.nativeEntities });
    const perSite = Math.ceil(item.nativeEntities / sites.length);
    const gridWidth = Math.max(1, Math.ceil(Math.sqrt(perSite)));
    const spacing = plan.entity.spacingBlocks ?? 1;
    const activeAiEntities = item.activeAiEntities ?? (plan.entity.ai ? item.nativeEntities : 0);
    for (let entityIndex = 0; entityIndex < item.nativeEntities; entityIndex += 1) {
      const site = sites[entityIndex % sites.length];
      const localIndex = Math.floor(entityIndex / sites.length);
      const dx = (localIndex % gridWidth) * spacing - Math.floor((gridWidth * spacing) / 2);
      const dz =
        Math.floor(localIndex / gridWidth) * spacing - Math.floor((gridWidth * spacing) / 2);
      server.command(
        `summon minecraft:villager ${site.x + dx + 0.5} ${site.y + 1} ${site.z + dz + 0.5} {Tags:["capacity_fixture"],PersistenceRequired:1b,Invulnerable:1b,Silent:1b,NoAI:${entityIndex < activeAiEntities ? '0b' : '1b'}}`,
      );
    }
    const beforeEntities = await scoreCount(server, 'before');
    progress.emit('entity-batch', 'ready', { caseId, entityCount: beforeEntities });
    await sleep(500);
    const before = {
      connectedBodies: bots.filter((bot) => Boolean(bot.entity)).length,
      clientLoadedChunks: bots.map((bot) => bot.world.getColumns().length),
      controlledEntities: beforeEntities,
    };
    const sprint = await sprintTicks(
      server,
      item.sprintTicks,
      300,
      parseSprintCompletion,
      progress,
    );
    await sleep(250);
    const afterEntities = await scoreCount(server, 'after');
    report = {
      schemaVersion: 1,
      kind: 'place-capacity-case',
      status: 'completed',
      caseId,
      placeId: fixture.placeId,
      sourceRunId: fixture.runId,
      worldTreeSha256: fixture.worldTreeSha256,
      profileId: runtime.profileId,
      axes: item,
      experimentalControls: {
        naturalMobSpawning: false,
        preexistingNonPlayerEntitiesCleared: true,
        controlledEntity: plan.entity,
        activeAiEntities,
        syntheticArena: plan.arena ?? { enabled: false },
        inferenceWorkload: 0,
        beholdInhabitants: 0,
      },
      runtimeLaunch: server.launch,
      regions: {
        sites,
        pairwiseDistances: distances(sites),
        forceloadedChunkCount: sites.length,
        declaredDistinctSimulationChunks: simulationChunkCount(
          sites,
          runtime.profile.minecraft.simulationDistance,
        ),
        qualification:
          'Declared simulation-distance chunk union around separated bodies; not render or LOD reach and not a direct server chunk census.',
      },
      before,
      sprint,
      entities: { requested: item.nativeEntities, before: beforeEntities, after: afterEntities },
      liveness: {
        connectedBodiesAfterSprint: bots.filter((bot) => Boolean(bot.entity)).length,
        clientLoadedChunksAfter: bots.map((bot) => bot.world.getColumns().length),
        bodyErrors,
      },
      serverDiagnostics: server
        .output()
        .split('\n')
        .filter((line) => /(WARN|ERROR|Exception|Can't keep up)/i.test(line)),
    };
  } finally {
    clearInterval(sampler);
    sample();
    for (const bot of bots) {
      try {
        bot.end('capacity case complete');
      } catch {}
    }
    shutdown = await stopMinecraftServer({
      server,
      reason: 'capacity case persistence checkpoint',
      progress,
    });
  }
  report.shutdown = shutdown;
  report.process = {
    server: processSummary(serverSamples),
    harnessAndProtocolClients: processSummary(harnessSamples),
    qualification:
      'Server and long-lived Node harness are separate. Per-case harness peak increase is causal evidence; absolute harness RSS can retain chunks from earlier cases.',
  };

  const restart = await startMinecraftServer({
    repositoryRoot,
    runtimeRoot,
    runtime,
    logPath: path.join(caseRoot, `${caseId}-restart-server.log`),
    progress,
  });
  let restartShutdown;
  let persistedEntities;
  const restartAuditBots = [];
  let restartClientLoadedChunks = [];
  try {
    for (let regionIndex = 0; regionIndex < report.regions.sites.length; regionIndex += 1) {
      const connected = await connectObserver({
        port,
        username: `AUD${index}_${regionIndex}`,
        label: `restart region audit ${regionIndex}`,
      });
      restartAuditBots.push(connected.bot);
      const site = report.regions.sites[regionIndex];
      restart.command(`gamemode spectator ${connected.bot.username}`);
      restart.command(`tp ${connected.bot.username} ${site.x + 0.5} ${site.y + 2} ${site.z + 0.5}`);
    }
    await waitUntil(
      () =>
        restartAuditBots.every((bot, regionIndex) => {
          const site = report.regions.sites[regionIndex];
          return Math.hypot(bot.entity.position.x - site.x, bot.entity.position.z - site.z) < 4;
        }),
      20_000,
      'restart region audit placement',
    );
    await waitUntil(
      () => restartAuditBots.every((bot) => bot.world.getColumns().length >= 80),
      30_000,
      'restart audit chunk coverage',
      250,
    );
    await sleep(500);
    restartClientLoadedChunks = restartAuditBots.map((bot) => bot.world.getColumns().length);
    persistedEntities = await scoreCount(restart, 'persisted');
  } finally {
    for (const bot of restartAuditBots) {
      try {
        bot.end('restart persistence audit complete');
      } catch {}
    }
    restartShutdown = await stopMinecraftServer({
      server: restart,
      reason: 'capacity restart verification complete',
      beforeStop: ['kill @e[tag=capacity_fixture]', 'forceload remove all'],
      progress,
    });
  }
  report.restart = {
    startupMilliseconds: restart.startupMilliseconds,
    persistedEntities,
    auditBodies: restartAuditBots.length,
    auditClientLoadedChunks: restartClientLoadedChunks,
    shutdown: restartShutdown,
  };
  report.classification = classifyCapacityCase(report);
  const reportPath = path.join(caseRoot, `${caseId}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  progress.emit('case', 'completed', {
    caseId,
    stable: report.classification.stable,
    effectiveTps: report.sprint.effectiveTps,
  });
  return { report, reportPath, reportSha256: await sha256(reportPath) };
}

const options = parse(process.argv.slice(2));
const loaded = await loadBenchmark(options.benchmark, repositoryRoot);
const fixture = loaded.fixtures.find((item) => item.placeId === options.place);
if (!fixture) throw new Error(`unknown place ${options.place}`);
if (!loaded.profiles[options.profile]) throw new Error(`unknown profile ${options.profile}`);
if (options.profile !== 'living')
  throw new Error('capacity frontier v1 requires the living profile');
const plan = validateCapacityPlan(JSON.parse(readFileSync(options.plan, 'utf8')), fixture);
const selectedCases =
  options.case === 'all' ? plan.cases : plan.cases.filter((item) => item.id === options.case);
if (!selectedCases.length) throw new Error(`unknown capacity case ${options.case}`);
const root = path.join(
  repositoryRoot,
  '.behold-artifacts/place-capacity',
  fixture.placeId,
  options.runId,
);
if (existsSync(root)) throw new Error(`capacity run exists: ${root}`);
mkdirSync(root, { recursive: true });
const progress = createProgressReporter({
  lane: 'capacity',
  runId: options.runId,
  filePath: path.join(root, 'progress.jsonl'),
});
const cases = [];
for (let index = 0; index < selectedCases.length; index += 1)
  cases.push(
    await runCase({
      loaded,
      fixture,
      plan,
      item: selectedCases[index],
      index,
      root,
      port: options.basePort + index,
      progress,
    }),
  );
progress.emit('run', 'completed', { caseCount: cases.length });
await progress.close();
const manifest = {
  schemaVersion: 1,
  kind: 'place-capacity-frontier',
  status: 'completed',
  runId: options.runId,
  benchmarkId: loaded.benchmark.id,
  benchmarkSha256: await sha256(loaded.path),
  plan: { path: path.relative(repositoryRoot, options.plan), sha256: await sha256(options.plan) },
  placeId: fixture.placeId,
  sourceRunId: fixture.runId,
  worldTreeSha256: fixture.worldTreeSha256,
  hardware: hardwareFingerprint(),
  summary: summarizeCapacity(cases.map((item) => item.report)),
  selection: { requestedCase: options.case, selectedCaseCount: selectedCases.length },
  progress: { path: 'progress.jsonl', sha256: await sha256(path.join(root, 'progress.jsonl')) },
  cases: cases.map((item) => ({
    caseId: item.report.caseId,
    reportPath: path.relative(root, item.reportPath),
    reportSha256: item.reportSha256,
  })),
};
writeFileSync(path.join(root, 'capacity-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: 'wx',
});
process.stdout.write(`${JSON.stringify({ root, manifest }, null, 2)}\n`);
