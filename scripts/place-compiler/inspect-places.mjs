#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';
import { hardwareFingerprint, loadBenchmark } from './benchmark-core.mjs';
import {
  classifySurface,
  deriveInspectionDefects,
  isAir,
  lineSamples,
  summarizeColumns,
  summarizeTransect,
} from './inspection-core.mjs';
import { sha256, timestamp } from './core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parse(argv) {
  const out = {
    benchmark: path.join(repositoryRoot, 'docs/place-compiler/benchmarks/living-places-v1.json'),
    runId: `inspection-${timestamp()}`,
    place: 'all',
    basePort: 25710,
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

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil(probe, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = probe();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function materialize(fixture, profile, destination, port) {
  const args = [
    path.join(repositoryRoot, 'scripts/place-compiler/materialize-runtime.mjs'),
    '--run-root',
    fixture.runRoot,
    '--recipe',
    fixture.recipePath,
    '--profile',
    profile,
    '--destination',
    destination,
    '--port',
    String(port),
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Runtime materialization failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function startServer(runtimeRoot, runtime, logPath) {
  const jarIndex = runtime.launch.indexOf('-jar');
  if (jarIndex < 0 || !runtime.launch[jarIndex + 1])
    throw new Error('runtime launch has no server jar');
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
    const text = chunk.toString();
    output += text;
    log.write(text);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('exit', () => log.end());
  await waitUntil(
    () => {
      if (child.exitCode != null)
        throw new Error(`Minecraft exited before readiness: ${child.exitCode}`);
      return output.includes('Done (');
    },
    120_000,
    'Minecraft readiness',
  );
  return { child, command: (value) => child.stdin.write(`${value}\n`), output: () => output };
}

async function connectInspector(port, username) {
  const bot = mineflayer.createBot({
    host: '127.0.0.1',
    port,
    username,
    auth: 'offline',
    version: '1.21.4',
    hideErrors: false,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Inspector spawn timed out')), 30_000);
    bot.once('spawn', () => {
      clearTimeout(timer);
      resolve();
    });
    bot.once('error', reject);
    bot.once('kicked', (reason) => reject(new Error(`Inspector kicked: ${String(reason)}`)));
  });
  return bot;
}

function blockName(bot, x, y, z) {
  try {
    return bot.blockAt(new Vec3(x, y, z), false)?.name ?? null;
  } catch {
    return null;
  }
}

async function loadColumn(bot, server, x, z, y, radius = 0) {
  server.command(
    radius > 0
      ? `forceload add ${x - radius} ${z - radius} ${x + radius} ${z + radius}`
      : `forceload add ${x} ${z}`,
  );
  server.command(`tp ${bot.username} ${x + 0.5} ${y} ${z + 0.5}`);
  await waitUntil(
    () =>
      Math.abs(bot.entity.position.x - (x + 0.5)) < 2 &&
      Math.abs(bot.entity.position.z - (z + 0.5)) < 2,
    10_000,
    `teleport to ${x},${z}`,
  );
  const chunkX = Math.floor(x / 16);
  const chunkZ = Math.floor(z / 16);
  try {
    const minimumChunkX = Math.floor((x - radius) / 16);
    const maximumChunkX = Math.floor((x + radius) / 16);
    const minimumChunkZ = Math.floor((z - radius) / 16);
    const maximumChunkZ = Math.floor((z + radius) / 16);
    await waitUntil(
      () => {
        for (let loadedX = minimumChunkX; loadedX <= maximumChunkX; loadedX += 1) {
          for (let loadedZ = minimumChunkZ; loadedZ <= maximumChunkZ; loadedZ += 1) {
            if (!bot.world.getColumn(loadedX, loadedZ)) return false;
          }
        }
        return true;
      },
      20_000,
      `chunks ${minimumChunkX},${minimumChunkZ} through ${maximumChunkX},${maximumChunkZ}`,
    );
  } catch (error) {
    const loaded = bot.world
      .getColumns()
      .map(({ chunkX: loadedX, chunkZ: loadedZ }) => [loadedX, loadedZ]);
    throw new Error(
      `${error.message}; observer=${bot.entity.position.toString()}; loaded=${JSON.stringify(loaded.slice(0, 20))}; loadedCount=${loaded.length}`,
    );
  }
}

function biomeValue(block) {
  const biome = block?.biome;
  if (typeof biome === 'string') return { name: biome || null, id: null };
  if (biome && typeof biome === 'object') {
    return {
      name: typeof biome.name === 'string' && biome.name.length ? biome.name : null,
      id: Number.isFinite(biome.id) ? biome.id : null,
    };
  }
  return null;
}

async function renderCheckpointMap(runtimeRoot, evidenceRoot, fixture, checkpoints, transects) {
  const worldRoot = path.join(runtimeRoot, 'world');
  const sourcePath = path.join(worldRoot, 'arnis_world_map.png');
  const metadata = JSON.parse(readFileSync(path.join(worldRoot, 'metadata.json'), 'utf8'));
  const identify = spawnSync('magick', ['identify', '-format', '%w %h', sourcePath], {
    encoding: 'utf8',
  });
  if (identify.status !== 0) throw new Error(`ImageMagick identify failed: ${identify.stderr}`);
  const [width, height] = identify.stdout.trim().split(/\s+/).map(Number);
  const pixel = ({ x, z }) => ({
    x: ((x - metadata.minMcX) / (metadata.maxMcX - metadata.minMcX)) * (width - 1),
    y: ((z - metadata.minMcZ) / (metadata.maxMcZ - metadata.minMcZ)) * (height - 1),
  });
  const escapeXml = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const elements = [];
  const lineWidth = Math.max(3, width / 900);
  for (const transect of transects) {
    const from = checkpoints.find((checkpoint) => checkpoint.id === transect.from);
    const to = checkpoints.find((checkpoint) => checkpoint.id === transect.to);
    const start = pixel(from.projected);
    const end = pixel(to.projected);
    elements.push(
      `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#ffd84d" stroke-opacity="0.9" stroke-width="${lineWidth}"/>`,
    );
  }
  const fontSize = Math.max(18, Math.round(width / 145));
  for (const checkpoint of checkpoints) {
    const point = pixel(checkpoint.projected);
    const mismatch =
      checkpoint.centerColumn?.classification === 'water' && !checkpoint.representativeGround;
    elements.push(
      `<circle cx="${point.x}" cy="${point.y}" r="${Math.max(10, width / 220)}" fill="${mismatch ? '#ff4d5e' : '#37e6d2'}" stroke="#10151d" stroke-width="${Math.max(4, width / 700)}"/>`,
    );
    const label = `${checkpoint.name} · y=${checkpoint.centerColumn?.y ?? 'none'} · ${checkpoint.centerColumn?.block ?? 'unobserved'}`;
    elements.push(
      `<text x="${point.x + fontSize}" y="${point.y}" dominant-baseline="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff" stroke="#10151d" stroke-width="${Math.max(5, width / 600)}" paint-order="stroke">${escapeXml(label)}</text>`,
    );
  }
  const overlayPath = path.join(evidenceRoot, `${fixture.placeId}-checkpoint-overlay.svg`);
  writeFileSync(
    overlayPath,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${elements.join('')}</svg>\n`,
    { flag: 'wx' },
  );
  const outputPath = path.join(evidenceRoot, `${fixture.placeId}-checkpoint-map.png`);
  const composite = spawnSync(
    'magick',
    [sourcePath, '(', '-background', 'none', overlayPath, ')', '-composite', outputPath],
    { encoding: 'utf8' },
  );
  if (composite.status !== 0) throw new Error(`ImageMagick composite failed: ${composite.stderr}`);
  return {
    path: outputPath,
    sha256: await sha256(outputPath),
    overlayPath,
    overlaySha256: await sha256(overlayPath),
  };
}

function surfaceAt(bot, x, z) {
  const minY = bot.game.minY ?? -64;
  const maxY = minY + (bot.game.height ?? 384) - 1;
  const columnLoaded = Boolean(bot.world.getColumn(Math.floor(x / 16), Math.floor(z / 16)));
  let sawLoadedBlock = false;
  for (let y = maxY; y >= minY; y -= 1) {
    let block;
    try {
      block = bot.blockAt(new Vec3(x, y, z), false);
    } catch {
      block = null;
    }
    if (!block) continue;
    sawLoadedBlock = true;
    if (isAir(block.name)) continue;
    const above = blockName(bot, x, y + 1, z);
    const aboveTwo = blockName(bot, x, y + 2, z);
    return {
      x,
      y,
      z,
      block: block.name,
      classification: classifySurface(block.name),
      biome: biomeValue(block),
      headroom: above != null && aboveTwo != null && isAir(above) && isAir(aboveTwo),
    };
  }
  return columnLoaded || sawLoadedBlock
    ? { x, y: null, z, block: 'air', classification: 'air', biome: null, headroom: false }
    : null;
}

async function inspectCheckpoint(bot, server, checkpoint, inspection) {
  const minY = bot.game.minY ?? -64;
  const highY = Math.min(minY + (bot.game.height ?? 384) - 16, 384);
  await loadColumn(bot, server, checkpoint.x, checkpoint.z, highY, inspection.columnRadius);
  const offsets = [];
  const step = Math.max(2, Math.floor(inspection.columnRadius / 2));
  for (let dx = -inspection.columnRadius; dx <= inspection.columnRadius; dx += step) {
    for (let dz = -inspection.columnRadius; dz <= inspection.columnRadius; dz += step)
      offsets.push([dx, dz]);
  }
  const columns = offsets.map(([dx, dz]) => surfaceAt(bot, checkpoint.x + dx, checkpoint.z + dz));
  const center = surfaceAt(bot, checkpoint.x, checkpoint.z);
  const candidates = columns.filter(
    (column) =>
      column && Number.isFinite(column.y) && column.headroom && column.classification !== 'water',
  );
  const orderedHeights = candidates.map((column) => column.y).sort((left, right) => left - right);
  const medianHeight = orderedHeights.length
    ? orderedHeights[Math.floor(orderedHeights.length / 2)]
    : null;
  const representativeGround =
    medianHeight == null
      ? null
      : [...candidates].sort(
          (left, right) =>
            Math.abs(left.y - medianHeight) - Math.abs(right.y - medianHeight) ||
            Math.hypot(left.x - checkpoint.x, left.z - checkpoint.z) -
              Math.hypot(right.x - checkpoint.x, right.z - checkpoint.z),
        )[0];
  return {
    id: checkpoint.id,
    name: checkpoint.name,
    latitude: checkpoint.lat,
    longitude: checkpoint.lon,
    projected: { x: checkpoint.x, z: checkpoint.z },
    observer: {
      mode: 'creative-teleport',
      altitude: bot.entity.position.y,
      loadedChunkCount: bot.world.getColumns().length,
    },
    centerColumn: center,
    representativeGround,
    aerialColumnField: summarizeColumns(columns),
  };
}

async function inspectTransect(bot, server, from, to) {
  const samples = [];
  for (const point of lineSamples(from, to)) {
    const minY = bot.game.minY ?? -64;
    await loadColumn(
      bot,
      server,
      point.x,
      point.z,
      Math.min(minY + (bot.game.height ?? 384) - 16, 256),
    );
    samples.push({ ...point, ...surfaceAt(bot, point.x, point.z) });
  }
  return {
    id: `${from.id}-to-${to.id}`,
    from: from.id,
    to: to.id,
    straightLineBlocks: Math.hypot(to.x - from.x, to.z - from.z),
    samples,
    summary: summarizeTransect(samples),
    interpretation: 'direct geographic transect; not a pathfinding or street-network claim',
  };
}

async function stopServer(server, bot) {
  try {
    bot?.end('inspection complete');
  } catch {}
  if (server.child.exitCode == null) {
    server.command('forceload remove all');
    server.command('save-all');
    server.command('stop');
    await waitUntil(() => server.child.exitCode != null, 30_000, 'clean server stop');
  }
}

async function inspectFixture(loaded, fixture, root, port) {
  const profileId = 'cinematic';
  const runtimeRoot = path.join(root, 'runtimes', `${fixture.placeId}-${profileId}`);
  const evidenceRoot = path.join(root, 'inspections');
  mkdirSync(evidenceRoot, { recursive: true });
  const runtime = materialize(fixture, profileId, runtimeRoot, port);
  const server = await startServer(
    runtimeRoot,
    runtime,
    path.join(evidenceRoot, `${fixture.placeId}-server.log`),
  );
  let bot;
  const startedAt = new Date().toISOString();
  try {
    bot = await connectInspector(port, `LP_${fixture.placeId.replaceAll('-', '_')}`.slice(0, 16));
    server.command(`gamemode creative ${bot.username}`);
    server.command(`effect give ${bot.username} minecraft:night_vision infinite 0 true`);
    server.command(`effect give ${bot.username} minecraft:slow_falling infinite 0 true`);
    await sleep(300);
    const checkpoints = [];
    for (const checkpoint of fixture.checkpoints)
      checkpoints.push(
        await inspectCheckpoint(bot, server, checkpoint, loaded.benchmark.inspections),
      );
    const transects = [];
    for (let index = 1; index < fixture.checkpoints.length; index += 1) {
      transects.push(
        await inspectTransect(
          bot,
          server,
          fixture.checkpoints[index - 1],
          fixture.checkpoints[index],
        ),
      );
    }
    const visualEvidence = await renderCheckpointMap(
      runtimeRoot,
      evidenceRoot,
      fixture,
      checkpoints,
      transects,
    );
    const defects = deriveInspectionDefects(fixture.placeId, checkpoints);
    const report = {
      schemaVersion: 1,
      status: 'completed',
      benchmarkId: loaded.benchmark.id,
      placeId: fixture.placeId,
      runId: fixture.runId,
      worldTreeSha256: fixture.worldTreeSha256,
      profileId,
      profile: loaded.profiles[profileId],
      startedAt,
      finishedAt: new Date().toISOString(),
      method: {
        substrate: 'real Minecraft 1.21.4 server and protocol client',
        ground: 'center column plus a nearby headroom-bearing surface at the local median height',
        aerial: 'spectator-loaded local column fields around geographic checkpoints',
        transects: 'bounded direct-line samples between consecutive landmarks; not pathfinding',
      },
      visualEvidence: {
        checkpointMapPath: path.basename(visualEvidence.path),
        checkpointMapSha256: visualEvidence.sha256,
        checkpointOverlayPath: path.basename(visualEvidence.overlayPath),
        checkpointOverlaySha256: visualEvidence.overlaySha256,
        basis: 'Arnis-generated world map with benchmark checkpoint and direct-transect overlays',
      },
      checkpoints,
      transects,
      defects,
    };
    const reportPath = path.join(evidenceRoot, `${fixture.placeId}.json`);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    return { placeId: fixture.placeId, reportPath, reportSha256: await sha256(reportPath) };
  } finally {
    await stopServer(server, bot);
  }
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
for (let index = 0; index < selected.length; index += 1) {
  results.push(await inspectFixture(loaded, selected[index], root, options.basePort + index));
}
const manifest = {
  schemaVersion: 1,
  status: 'completed',
  kind: 'living-places-inspection',
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
writeFileSync(
  path.join(root, 'inspection-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: 'wx' },
);
process.stdout.write(`${JSON.stringify({ root, manifest }, null, 2)}\n`);
