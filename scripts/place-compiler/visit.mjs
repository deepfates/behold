#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vec3 } from 'vec3';
import pathfinderPackage from 'mineflayer-pathfinder';
import { loadBenchmark } from './benchmark-core.mjs';
import { sha256, timestamp } from './core.mjs';
import {
  connectObserver,
  createProgressReporter,
  materializeRuntime,
  sleep,
  startMinecraftServer,
  stopMinecraftServer,
  waitUntil,
} from './minecraft-harness.mjs';
import { deriveVisitPlan, loadVisitContract } from './visit-core.mjs';

const { goals, Movements, pathfinder: pathfinderPlugin } = pathfinderPackage;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parse(argv) {
  const out = {
    contract: path.join(repositoryRoot, 'docs/place-compiler/visits/living-places-v1.json'),
    benchmark: path.join(repositoryRoot, 'docs/place-compiler/benchmarks/living-places-v3.json'),
    place: null,
    profile: 'cinematic',
    runId: `visit-${timestamp()}`,
    port: 25582,
    output: null,
    launchClient: false,
    visitorName: 'Visitor',
    captureSeconds: 0,
    hold: false,
    verify: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--contract') out.contract = path.resolve(argv[++index]);
    else if (argv[index] === '--benchmark') out.benchmark = path.resolve(argv[++index]);
    else if (argv[index] === '--place') out.place = argv[++index];
    else if (argv[index] === '--profile') out.profile = argv[++index];
    else if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--port') out.port = Number(argv[++index]);
    else if (argv[index] === '--output') out.output = path.resolve(argv[++index]);
    else if (argv[index] === '--launch-client') out.launchClient = true;
    else if (argv[index] === '--visitor-name') out.visitorName = argv[++index];
    else if (argv[index] === '--capture-seconds') out.captureSeconds = Number(argv[++index]);
    else if (argv[index] === '--hold') out.hold = true;
    else if (argv[index] === '--verify') out.verify = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(out.runId)) throw new Error('invalid visit run id');
  if (!Number.isInteger(out.port) || out.port < 1024 || out.port > 65535)
    throw new Error('invalid visit port');
  if (!/^[A-Za-z0-9_]{1,16}$/.test(out.visitorName)) throw new Error('invalid visitor name');
  if (!Number.isFinite(out.captureSeconds) || out.captureSeconds < 0)
    throw new Error('capture seconds must be non-negative');
  if (out.captureSeconds > 0 && !out.launchClient)
    throw new Error('--capture-seconds requires --launch-client');
  if (!out.verify && !out.place) throw new Error('--place is required unless --verify is used');
  return out;
}

const options = parse(process.argv.slice(2));
const loadedBenchmark = await loadBenchmark(options.benchmark, repositoryRoot);
const loadedVisit = await loadVisitContract(options.contract, repositoryRoot, loadedBenchmark);
if (options.verify) {
  const plans = Object.values(loadedVisit.places).map(deriveVisitPlan);
  process.stdout.write(
    `${JSON.stringify({ status: 'verified', contractId: loadedVisit.contract.id, plans }, null, 2)}\n`,
  );
  process.exit(0);
}
const place = loadedVisit.places[options.place];
if (!place) throw new Error(`visit contract has no accepted place ${options.place}`);
if (!loadedBenchmark.profiles[options.profile])
  throw new Error(`unknown profile ${options.profile}`);
const plan = deriveVisitPlan(place);
const output =
  options.output ??
  path.join(
    repositoryRoot,
    '.behold-artifacts/place-visits',
    loadedVisit.contract.id,
    options.runId,
  );
if (existsSync(output)) throw new Error(`visit output exists: ${output}`);
mkdirSync(output, { recursive: true });
const runtimeRoot = path.join(output, '.runtime');
const evidenceRoot = path.join(output, 'evidence');
mkdirSync(evidenceRoot, { recursive: true });
const progressPath = path.join(output, 'progress.jsonl');
const progress = createProgressReporter({
  lane: 'human-visit',
  runId: options.runId,
  filePath: progressPath,
});
let server = null;
let director = null;
let client = null;
let capture = null;
let captureExecutable = null;
let shutdown = null;
let failure = null;
const startedAt = new Date().toISOString();

try {
  progress.emit('contract', 'verified', {
    placeId: plan.placeId,
    contractId: loadedVisit.contract.id,
    contractSha256: loadedVisit.sha256,
  });
  const runtime = materializeRuntime({
    repositoryRoot,
    fixture: place.fixture,
    profileId: options.profile,
    destination: runtimeRoot,
    port: options.port,
  });
  progress.emit('runtime', 'materialized', { placeId: plan.placeId, profileId: options.profile });
  if (options.captureSeconds > 0) {
    captureExecutable = prepareWindowCapture(runtimeRoot);
    progress.emit('capture-tool', 'ready');
  }
  installVisitDatapack(path.join(runtimeRoot, 'world'), plan);
  writeGuide(output, plan, options);
  copyFileSync(place.references.map.file, path.join(evidenceRoot, 'checkpoint-map.png'));
  copyFileSync(
    path.join(runtimeRoot, 'runtime-manifest.json'),
    path.join(evidenceRoot, 'runtime-manifest.json'),
  );
  server = await startMinecraftServer({
    repositoryRoot,
    runtimeRoot,
    runtime,
    logPath: path.join(evidenceRoot, 'server.log'),
    progress,
  });
  ({ bot: director } = await connectObserver({
    port: options.port,
    username: 'VisitProof',
    label: 'visit director',
    progress,
  }));
  director.loadPlugin(pathfinderPlugin);
  const movements = new Movements(director);
  movements.canDig = false;
  movements.allow1by1towers = false;
  movements.allowParkour = false;
  movements.canOpenDoors = true;
  director.pathfinder.setMovements(movements);

  if (options.launchClient) {
    client = launchNativeClient(options);
    await waitUntil(
      () => server.output().includes(`${options.visitorName} joined the game`),
      90_000,
      'native visitor join',
    );
    progress.emit('client', 'connected', { username: options.visitorName });
    server.command(`gamemode spectator ${options.visitorName}`);
    server.command(`spectate ${director.username} ${options.visitorName}`);
    if (options.captureSeconds > 0) {
      progress.emit('client', 'settling', { milliseconds: 8_000 });
      await sleep(8_000);
    }
  }

  const stages = {};
  stages.arrival = await proveArrival(server, director, plan, progress);
  if (options.launchClient) {
    progress.emit('arrival', 'presented', { milliseconds: 3_000 });
    await sleep(3_000);
  }
  const beginCapture =
    options.captureSeconds > 0
      ? async () => {
          const movie = path.join(evidenceRoot, 'visit.mov');
          capture = launchWindowCapture(captureExecutable, movie, options.captureSeconds);
          await sleep(1_000);
          progress.emit('capture', 'started', { seconds: options.captureSeconds });
        }
      : null;
  stages.groundLeg = await proveGroundLeg(
    server,
    director,
    plan,
    progress,
    options.launchClient ? 3_000 : 0,
    beginCapture,
  );
  if (options.launchClient) server.command(`execute as ${options.visitorName} run spectate`);
  stages.reveal = await proveReveal(server, director, plan, progress, options.visitorName);
  if (capture) {
    const result = await waitForChild(
      capture,
      (options.captureSeconds + 30) * 1000,
      'window capture',
    );
    if (result.code !== 0)
      throw new Error(`window capture exited ${result.code}: ${result.output}`);
    progress.emit('capture', 'completed');
  }
  if (options.hold) {
    progress.emit('visit', 'ready', {
      placeId: plan.placeId,
      join: `127.0.0.1:${options.port}`,
      guide: path.join(output, 'GUIDE.md'),
    });
    await waitForSignal();
  }
  shutdown = await stopMinecraftServer({
    server,
    bot: director,
    reason: 'human visit complete',
    progress,
  });
  director = null;
  server = null;
  await stopClient(client);
  client = null;
  rmSync(runtimeRoot, { recursive: true, force: true });
  await progress.close();
  const captureEvidence = await captureFiles(output);
  const report = {
    schemaVersion: 1,
    kind: 'place-human-visit',
    status: 'completed',
    runId: options.runId,
    startedAt,
    completedAt: new Date().toISOString(),
    placeId: plan.placeId,
    sourceRunId: plan.sourceRunId,
    worldTreeSha256: plan.worldTreeSha256,
    profileId: options.profile,
    contract: {
      id: loadedVisit.contract.id,
      path: path.relative(repositoryRoot, loadedVisit.path),
      sha256: loadedVisit.sha256,
    },
    join: { address: `127.0.0.1:${options.port}`, noAgentRequired: true },
    plan,
    stages,
    client: {
      launched: options.launchClient,
      username: options.launchClient ? options.visitorName : null,
      captured: captureEvidence.some((item) => item.path === 'evidence/visit.mov'),
    },
    shutdown,
    evidence: captureEvidence,
    progress: { path: 'progress.jsonl', sha256: await sha256(progressPath) },
  };
  writeFileSync(path.join(output, 'visit-report.json'), `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
  });
  process.stdout.write(`${JSON.stringify({ output, report }, null, 2)}\n`);
} catch (error) {
  failure = error;
  progress.emit('visit', 'failed', {
    placeId: plan.placeId,
    error: error instanceof Error ? error.message : String(error),
  });
  if (capture) capture.kill('SIGTERM');
  if (server) {
    await stopMinecraftServer({
      server,
      bot: director,
      reason: 'human visit failed',
      progress,
    }).catch(() => {});
  }
  await stopClient(client).catch(() => {});
  await progress.close().catch(() => {});
} finally {
  if (failure) throw failure;
}

async function proveArrival(server, bot, visit, progress) {
  const arrival = visit.arrival;
  progress.emit('arrival', 'started', { checkpointId: arrival.checkpointId });
  server.command(`gamemode creative ${bot.username}`);
  server.command(`effect give ${bot.username} minecraft:night_vision infinite 0 true`);
  server.command(`forceload add ${arrival.x} ${arrival.z}`);
  server.command(`tp ${bot.username} ${arrival.x + 0.5} ${arrival.y} ${arrival.z + 0.5}`);
  await waitPosition(bot, arrival, 2, 'accepted arrival');
  await waitUntil(
    () => bot.world.getColumn(Math.floor(arrival.x / 16), Math.floor(arrival.z / 16)),
    30_000,
    'accepted arrival chunk',
  );
  const support = bot.blockAt(new Vec3(arrival.x, arrival.y - 1, arrival.z), false)?.name ?? null;
  const feet = bot.blockAt(new Vec3(arrival.x, arrival.y, arrival.z), false)?.name ?? null;
  const head = bot.blockAt(new Vec3(arrival.x, arrival.y + 1, arrival.z), false)?.name ?? null;
  const result = {
    checkpointId: arrival.checkpointId,
    position: point(bot.entity.position),
    expectedSupport: arrival.support.replace(/^minecraft:/, ''),
    support,
    feet,
    head,
    accepted:
      support === arrival.support.replace(/^minecraft:/, '') &&
      ['air', 'cave_air', 'void_air'].includes(feet) &&
      ['air', 'cave_air', 'void_air'].includes(head),
  };
  if (!result.accepted) throw new Error(`arrival runtime mismatch: ${JSON.stringify(result)}`);
  progress.emit('arrival', 'completed', { checkpointId: arrival.checkpointId });
  return result;
}

async function proveGroundLeg(
  server,
  bot,
  visit,
  progress,
  presentationHoldMilliseconds = 0,
  beforeTraversal = null,
) {
  const leg = visit.groundLeg;
  progress.emit('ground-leg', 'started', {
    routeId: leg.routeId,
    distanceBlocks: leg.distanceBlocks,
  });
  const start = leg.waypoints[0];
  server.command(`gamemode creative ${bot.username}`);
  server.command(`tp ${bot.username} ${start.x + 0.5} ${start.y} ${start.z + 0.5}`);
  await waitPosition(bot, start, 2, 'ground leg start');
  // A forced server chunk is not sent to a distant client. Move the observer to the
  // corridor first, then require every audited waypoint chunk in its client view.
  await ensureGroundCorridor(server, bot, leg, progress);
  if (presentationHoldMilliseconds > 0) {
    progress.emit('ground-corridor', 'presenting', {
      routeId: leg.routeId,
      milliseconds: presentationHoldMilliseconds,
    });
    await sleep(presentationHoldMilliseconds);
  }
  if (beforeTraversal) await beforeTraversal();
  const observed = [point(bot.entity.position)];
  const traversals = [];
  for (const [offset, waypoint] of leg.waypoints.slice(1).entries()) {
    const waypointIndex = offset + 1;
    const timeoutMs = traversalTimeoutMs(bot.entity.position, waypoint);
    progress.emit('ground-waypoint', 'started', {
      routeId: leg.routeId,
      waypointIndex,
      sampleIndex: waypoint.sampleIndex,
      timeoutMs,
      target: waypoint,
    });
    const traversal = await traverseWaypoint(bot, waypoint, waypointIndex, timeoutMs);
    observed.push(point(bot.entity.position));
    traversals.push(traversal);
    progress.emit('ground-waypoint', 'completed', {
      routeId: leg.routeId,
      waypointIndex,
      sampleIndex: waypoint.sampleIndex,
      elapsedMilliseconds: traversal.elapsedMilliseconds,
      position: point(bot.entity.position),
    });
  }
  const end = leg.waypoints.at(-1);
  const finalDistance = Math.hypot(
    bot.entity.position.x - end.x,
    bot.entity.position.y - end.y,
    bot.entity.position.z - end.z,
  );
  if (finalDistance > 2.5)
    throw new Error(`ground leg ended ${finalDistance.toFixed(2)} blocks away`);
  const result = {
    routeId: leg.routeId,
    plannedDistanceBlocks: leg.distanceBlocks,
    waypointCount: leg.waypoints.length,
    observed,
    traversals,
    finalDistance,
    collisionValidEvidence: leg.evidence,
  };
  progress.emit('ground-leg', 'completed', { routeId: leg.routeId });
  return result;
}

async function ensureGroundCorridor(server, bot, leg, progress) {
  const chunks = [
    ...new Map(
      leg.waypoints.map((waypoint) => {
        const chunkX = Math.floor(waypoint.x / 16);
        const chunkZ = Math.floor(waypoint.z / 16);
        return [`${chunkX}:${chunkZ}`, { chunkX, chunkZ, x: waypoint.x, z: waypoint.z }];
      }),
    ).values(),
  ];
  progress.emit('ground-corridor', 'loading', {
    routeId: leg.routeId,
    chunkCount: chunks.length,
  });
  for (const chunk of chunks) server.command(`forceload add ${chunk.x} ${chunk.z}`);
  await waitUntil(
    () => chunks.every((chunk) => bot.world.getColumn(chunk.chunkX, chunk.chunkZ)),
    30_000,
    `ground corridor ${leg.routeId}`,
  );
  progress.emit('ground-corridor', 'ready', {
    routeId: leg.routeId,
    chunkCount: chunks.length,
  });
}

function traversalTimeoutMs(from, waypoint) {
  const distance = Math.hypot(from.x - waypoint.x, from.y - waypoint.y, from.z - waypoint.z);
  return Math.min(60_000, Math.max(15_000, Math.ceil(10_000 + distance * 1_500)));
}

async function traverseWaypoint(bot, waypoint, waypointIndex, timeoutMs) {
  const startedAt = performance.now();
  const resets = [];
  const pathUpdates = [];
  const onReset = (reason) => {
    if (resets.length < 20) resets.push(String(reason));
  };
  const onUpdate = (result) => {
    if (pathUpdates.length < 20) {
      pathUpdates.push({ status: result.status, pathNodes: result.path?.length ?? null });
    }
  };
  bot.on('path_reset', onReset);
  bot.on('path_update', onUpdate);
  let timer;
  try {
    await Promise.race([
      bot.pathfinder.goto(new goals.GoalNear(waypoint.x, waypoint.y, waypoint.z, 1)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const diagnostic = {
            waypointIndex,
            target: waypoint,
            position: point(bot.entity.position),
            distance: bot.entity.position.distanceTo(new Vec3(waypoint.x, waypoint.y, waypoint.z)),
            resets,
            pathUpdates,
          };
          reject(
            new Error(
              `ground waypoint ${waypointIndex} timed out after ${timeoutMs}ms: ${JSON.stringify(diagnostic)}`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
    return {
      waypointIndex,
      sampleIndex: waypoint.sampleIndex,
      elapsedMilliseconds: performance.now() - startedAt,
      resets,
      pathUpdates,
    };
  } catch (error) {
    bot.pathfinder.setGoal(null);
    throw error;
  } finally {
    clearTimeout(timer);
    bot.removeListener('path_reset', onReset);
    bot.removeListener('path_update', onUpdate);
  }
}

async function proveReveal(server, bot, visit, progress, visitorName) {
  const reveal = visit.reveal;
  progress.emit('reveal', 'started', {
    sightlineId: reveal.sightlineId,
    liftBlocks: reveal.liftBlocks,
  });
  bot.pathfinder.stop();
  bot.physicsEnabled = false;
  server.command(`gamemode spectator ${bot.username}`);
  server.command(
    `tp ${bot.username} ${reveal.observer.x} ${reveal.observer.y} ${reveal.observer.z} facing ${reveal.target.x} ${reveal.target.y + 2} ${reveal.target.z}`,
  );
  if (options.launchClient) {
    server.command(
      `tp ${visitorName} ${reveal.observer.x} ${reveal.observer.y} ${reveal.observer.z} facing ${reveal.target.x} ${reveal.target.y + 2} ${reveal.target.z}`,
    );
  }
  await waitPosition(bot, reveal.observer, 2, 'city reveal');
  await sleep(2_000);
  const result = {
    sightlineId: reveal.sightlineId,
    position: point(bot.entity.position),
    yaw: bot.entity.yaw,
    pitch: bot.entity.pitch,
    measuredClear: reveal.clear,
    liftBlocks: reveal.liftBlocks,
    limitation: reveal.limitation,
  };
  progress.emit('reveal', 'completed', { sightlineId: reveal.sightlineId });
  return result;
}

function installVisitDatapack(world, visit) {
  const root = path.join(world, 'datapacks', 'place-human-visit');
  const functions = path.join(root, 'data', 'place_visit', 'function');
  const tags = path.join(root, 'data', 'minecraft', 'tags', 'function');
  mkdirSync(functions, { recursive: true });
  mkdirSync(tags, { recursive: true });
  writeFileSync(
    path.join(root, 'pack.mcmeta'),
    `${JSON.stringify({ pack: { pack_format: 61, description: `${visit.placeName} human visit` } }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(tags, 'load.json'),
    `${JSON.stringify({ values: ['place_visit:load'] })}\n`,
  );
  writeFileSync(
    path.join(tags, 'tick.json'),
    `${JSON.stringify({ values: ['place_visit:tick'] })}\n`,
  );
  writeFileSync(
    path.join(functions, 'load.mcfunction'),
    'scoreboard objectives add place_visit trigger\n',
  );
  const start = visit.groundLeg.waypoints[0];
  const reveal = visit.reveal;
  writeFileSync(
    path.join(functions, 'tick.mcfunction'),
    [
      'scoreboard players enable @a place_visit',
      `execute as @a[scores={place_visit=1}] run function place_visit:arrival`,
      `execute as @a[scores={place_visit=2}] run function place_visit:ground`,
      `execute as @a[scores={place_visit=3}] run function place_visit:reveal`,
      '',
    ].join('\n'),
  );
  writeVisitFunction(functions, 'arrival', [
    'gamemode creative @s',
    'effect give @s minecraft:night_vision infinite 0 true',
    `tp @s ${visit.arrival.x + 0.5} ${visit.arrival.y} ${visit.arrival.z + 0.5}`,
    `tellraw @s {"text":"${escapeCommandText(visit.arrival.name)} · accepted arrival","color":"aqua"}`,
  ]);
  writeVisitFunction(functions, 'ground', [
    'gamemode creative @s',
    `tp @s ${start.x + 0.5} ${start.y} ${start.z + 0.5}`,
    `tellraw @s {"text":"${escapeCommandText(visit.groundLeg.routeName)} · collision-audited ground leg","color":"green"}`,
  ]);
  writeVisitFunction(functions, 'reveal', [
    'gamemode spectator @s',
    `tp @s ${reveal.observer.x} ${reveal.observer.y} ${reveal.observer.z} facing ${reveal.target.x} ${reveal.target.y + 2} ${reveal.target.z}`,
    `tellraw @s {"text":"${escapeCommandText(reveal.name)} · ${reveal.liftBlocks}-block reveal","color":"gold"}`,
  ]);
}

function writeVisitFunction(directory, name, commands) {
  writeFileSync(
    path.join(directory, `${name}.mcfunction`),
    `${[...commands, 'scoreboard players set @s place_visit 0'].join('\n')}\n`,
  );
}

function writeGuide(root, visit, options) {
  const guide = {
    schemaVersion: 1,
    placeId: visit.placeId,
    placeName: visit.placeName,
    profileId: options.profile,
    joinAddress: `127.0.0.1:${options.port}`,
    map: 'evidence/checkpoint-map.png',
    controls: [
      { command: '/trigger place_visit set 1', destination: visit.arrival.name },
      {
        command: '/trigger place_visit set 2',
        destination: `${visit.groundLeg.routeName} ground leg`,
      },
      { command: '/trigger place_visit set 3', destination: `${visit.reveal.name} reveal` },
    ],
    plan: visit,
  };
  writeFileSync(path.join(root, 'visit-guide.json'), `${JSON.stringify(guide, null, 2)}\n`, {
    flag: 'wx',
  });
  writeFileSync(
    path.join(root, 'GUIDE.md'),
    [
      `# Visit ${visit.placeName}`,
      '',
      `Join \`${guide.joinAddress}\` with Minecraft 1.21.4. No agent or operator permissions are required.`,
      '',
      'Open chat and use:',
      '',
      ...guide.controls.map((control) => `- \`${control.command}\` — ${control.destination}`),
      '',
      `The arrival is the measured ${visit.arrival.checkpointId} surface. The ground leg is ${visit.groundLeg.distanceBlocks.toFixed(1)} blocks from the audited ${visit.groundLeg.routeName} route. The reveal uses ${visit.reveal.sightlineId} at a ${visit.reveal.liftBlocks}-block lift.`,
      '',
      'The checkpoint map is `evidence/checkpoint-map.png`.',
      '',
    ].join('\n'),
    { flag: 'wx' },
  );
}

function launchNativeClient(options) {
  const child = spawn('npm', ['run', 'native'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NATIVE_MC_SERVER: `127.0.0.1:${options.port}`,
      NATIVE_MC_USERNAME: options.visitorName,
      NATIVE_MC_HIDE_GUI: options.captureSeconds > 0 ? 'true' : 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stderr.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

function prepareWindowCapture(runtimeRoot) {
  const source = path.join(repositoryRoot, 'scripts/sf-world/capture-window.swift');
  const executable = path.join(runtimeRoot, 'capture-window');
  const result = spawnSync(
    'xcrun',
    ['swiftc', '-parse-as-library', '-O', source, '-o', executable],
    { cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000 },
  );
  if (result.status !== 0) {
    throw new Error(`window capture build failed: ${result.stderr || result.stdout}`);
  }
  return executable;
}

function launchWindowCapture(executable, output, seconds) {
  return spawn(executable, ['Minecraft', String(seconds), output], {
    cwd: repositoryRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function stopClient(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await waitForChild(child, 15_000, 'native client stop').catch(() => child.kill('SIGKILL'));
}

function waitForChild(child, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout?.on('data', (chunk) => (output += String(chunk)));
    child.stderr?.on('data', (chunk) => (output += String(chunk)));
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output });
    });
  });
}

function waitForSignal() {
  return new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
}

function waitPosition(bot, expected, radius, label) {
  return waitUntil(
    () =>
      bot.entity &&
      Math.hypot(
        bot.entity.position.x - expected.x,
        bot.entity.position.y - expected.y,
        bot.entity.position.z - expected.z,
      ) <= radius,
    15_000,
    label,
  );
}

function point(position) {
  return { x: position.x, y: position.y, z: position.z };
}

async function captureFiles(root) {
  const files = [];
  for (const name of [
    'GUIDE.md',
    'visit-guide.json',
    'progress.jsonl',
    'evidence/checkpoint-map.png',
    'evidence/runtime-manifest.json',
    'evidence/server.log',
    'evidence/visit.mov',
  ]) {
    const file = path.join(root, name);
    if (existsSync(file))
      files.push({ path: name, sizeBytes: statSync(file).size, sha256: await sha256(file) });
  }
  return files;
}

function escapeCommandText(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
