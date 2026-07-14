#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardwareFingerprint, loadBenchmark } from './benchmark-core.mjs';
import { sha256, timestamp } from './core.mjs';
import { deriveEvidencePlan, laneExpectation } from './evidence-contract.mjs';
import { parseSprintCompletion, summarizeEntities } from './ecology-core.mjs';
import {
  connectObserver,
  createProgressReporter,
  materializeRuntime,
  sampleProcess,
  sleep,
  sprintTicks,
  startMinecraftServer,
  stopMinecraftServer,
} from './minecraft-harness.mjs';
import { prepareObservationSite } from './observation-site.mjs';
import { classifyCase, summarizePerformance } from './performance-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parse(argv) {
  const out = {
    benchmark: path.join(repositoryRoot, 'docs/place-compiler/benchmarks/living-places-v1.json'),
    runId: `performance-${timestamp()}`,
    place: 'all',
    profile: 'all',
    repetitions: null,
    basePort: 25750,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--benchmark') out.benchmark = path.resolve(argv[++index]);
    else if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--place') out.place = argv[++index];
    else if (argv[index] === '--profile') out.profile = argv[++index];
    else if (argv[index] === '--repetitions') out.repetitions = Number(argv[++index]);
    else if (argv[index] === '--base-port') out.basePort = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(out.runId)) throw new Error('invalid run id');
  if (!Number.isInteger(out.basePort) || out.basePort < 1024 || out.basePort > 65000)
    throw new Error('invalid base port');
  if (out.repetitions != null && (!Number.isInteger(out.repetitions) || out.repetitions < 1))
    throw new Error('repetitions must be a positive integer');
  return out;
}

async function runCase(loaded, fixture, profileId, repetition, root, port, progress) {
  const caseId = `${fixture.placeId}-${profileId}-r${repetition}`;
  const caseRoot = path.join(root, 'runtimes', caseId);
  const evidenceRoot = path.join(root, 'cases');
  mkdirSync(evidenceRoot, { recursive: true });
  progress.emit('case', 'started', { caseId, placeId: fixture.placeId, profileId, repetition });
  const runtime = materializeRuntime({
    repositoryRoot,
    fixture,
    profileId,
    destination: caseRoot,
    port,
  });
  const server = await startMinecraftServer({
    repositoryRoot,
    runtimeRoot: caseRoot,
    runtime,
    logPath: path.join(evidenceRoot, `${caseId}-server.log`),
    progress,
  });
  let bot;
  let shutdown;
  let measurement;
  const samples = [];
  const sampler = setInterval(() => {
    const sample = sampleProcess(server.child.pid);
    if (sample) samples.push(sample);
  }, 250);
  try {
    const connected = await connectObserver({
      port,
      username: `PERF_${profileId}_${repetition}`.slice(0, 16),
      label: 'performance observer',
      progress,
    });
    bot = connected.bot;
    const site = await prepareObservationSite({
      server,
      bot,
      checkpoint: fixture.checkpoints[0],
      gameMode: loaded.profiles[profileId].minecraft.gameMode,
      label: 'performance observation site',
    });
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
    const measuredSprint = await sprintTicks(
      server,
      loaded.benchmark.performanceSweep.sprintTicks,
      loaded.benchmark.performanceSweep.maxWallSecondsPerCase,
      parseSprintCompletion,
      progress,
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
      benchmarkId: loaded.benchmark.id,
      placeId: fixture.placeId,
      runId: fixture.runId,
      worldTreeSha256: fixture.worldTreeSha256,
      profileId,
      profile: loaded.profiles[profileId],
      repetition,
      port,
      launch: server.launch,
      serverStartupMilliseconds: server.startupMilliseconds,
      observerConnectMilliseconds: connected.connectMilliseconds,
      observationSite: site,
      before,
      after,
      sprint: measuredSprint,
    };
  } finally {
    clearInterval(sampler);
    const last = sampleProcess(server.child.pid);
    if (last) samples.push(last);
    shutdown = await stopMinecraftServer({
      server,
      bot,
      reason: 'performance case complete',
      progress,
    });
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
  progress.emit('case', 'completed', { caseId, reportPath });
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
const repetitions = options.repetitions ?? loaded.benchmark.performanceSweep.repetitions;
const root = path.join(
  repositoryRoot,
  '.behold-artifacts/place-benchmarks',
  loaded.benchmark.id,
  options.runId,
);
if (existsSync(root)) throw new Error(`benchmark run exists: ${root}`);
mkdirSync(root, { recursive: true });
const progress = createProgressReporter({
  lane: 'performance',
  runId: options.runId,
  filePath: path.join(root, 'progress.jsonl'),
});
const cases = [];
let caseIndex = 0;
for (const fixture of fixtures) {
  for (const profileId of profiles) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      cases.push(
        await runCase(
          loaded,
          fixture,
          profileId,
          repetition,
          root,
          options.basePort + caseIndex,
          progress,
        ),
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
progress.emit('run', 'completed', { caseCount: cases.length });
await progress.close();
const evidencePlan = deriveEvidencePlan({
  benchmark: loaded.benchmark,
  fixtures,
  performanceProfiles: profiles,
  repetitions,
});
const manifest = {
  schemaVersion: 1,
  status: 'completed',
  kind: 'living-places-performance-sweep',
  benchmarkId: loaded.benchmark.id,
  runId: options.runId,
  createdAt: new Date().toISOString(),
  hardware: hardwareFingerprint(),
  benchmarkSha256: await sha256(loaded.path),
  expectation: laneExpectation(evidencePlan, 'performance'),
  progress: {
    path: 'progress.jsonl',
    sha256: await sha256(path.join(root, 'progress.jsonl')),
  },
  method: {
    substrate: 'real Minecraft 1.21.4 server with one protocol observer',
    ticksPerCase: loaded.benchmark.performanceSweep.sprintTicks,
    contractRepetitions: loaded.benchmark.performanceSweep.repetitions,
    selectedRepetitions: repetitions,
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
