#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import minecraftDataLoader from 'minecraft-data';
import { AnvilWorldReader } from './anvil-reader.mjs';
import { loadPlaceRecipe, sha256, timestamp } from './core.mjs';
import { projectGeographicPoint } from './route-core.mjs';
import { summarizeSightline, voxelLine } from './sightline-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parse(argv) {
  const out = { runRoot: null, views: null, runId: `sightlines-${timestamp()}`, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--run-root') out.runRoot = path.resolve(argv[++index]);
    else if (argv[index] === '--views') out.views = path.resolve(argv[++index]);
    else if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--output') out.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!out.runRoot || !out.views) throw new Error('--run-root and --views are required');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(out.runId)) throw new Error('invalid run id');
  return out;
}

function worldUnder(runRoot) {
  const output = path.join(runRoot, 'output');
  const worlds = readdirSync(output).filter((name) => name.startsWith('Arnis World '));
  if (worlds.length !== 1) throw new Error(`expected one source world, found ${worlds.length}`);
  return path.join(output, worlds[0]);
}

async function localPeak(reader, projected, radius = 24, step = 4) {
  const candidates = [];
  for (let dx = -radius; dx <= radius; dx += step)
    for (let dz = -radius; dz <= radius; dz += step) {
      const column = await reader.scanColumn(
        Math.round(projected.x + dx),
        Math.round(projected.z + dz),
      );
      if (column.top)
        candidates.push({
          x: Math.round(projected.x + dx),
          z: Math.round(projected.z + dz),
          ...column.top,
        });
    }
  const center = await reader.scanColumn(Math.round(projected.x), Math.round(projected.z));
  if (center.top)
    candidates.push({ x: Math.round(projected.x), z: Math.round(projected.z), ...center.top });
  if (!candidates.length) throw new Error('no generated surface near sightline endpoint');
  return candidates.sort(
    (left, right) =>
      right.y - left.y ||
      Math.hypot(left.x - projected.x, left.z - projected.z) -
        Math.hypot(right.x - projected.x, right.z - projected.z),
  )[0];
}

async function observeLine(reader, minecraftData, from, to) {
  const line = voxelLine(from, to);
  const observations = [];
  for (const point of line.points) {
    const block = await reader.blockAt(point.x, point.y, point.z);
    const data = minecraftData.blocksByName[block?.replace(/^minecraft:/, '')];
    observations.push({
      ...point,
      block,
      air: !block || /^(?:minecraft:)?(?:air|cave_air|void_air)$/.test(block),
      transparent: data?.transparent ?? false,
      opaque: Boolean(block) && data?.transparent === false,
    });
  }
  return summarizeSightline(line, observations);
}

const options = parse(process.argv.slice(2));
const views = JSON.parse(readFileSync(options.views, 'utf8'));
const recipePath = path.resolve(repositoryRoot, views.placeRecipe);
if (!recipePath.startsWith(`${repositoryRoot}${path.sep}`))
  throw new Error('view recipe escapes repository');
const recipe = loadPlaceRecipe(recipePath);
const generation = JSON.parse(
  readFileSync(path.join(options.runRoot, 'generation-manifest.json'), 'utf8'),
);
const tree = JSON.parse(
  readFileSync(path.join(options.runRoot, 'evidence', 'world-checksums.json'), 'utf8'),
);
if (generation.status !== 'generated') throw new Error('generation is not accepted');
if (generation.place) {
  if (
    generation.place.id !== recipe.recipe.id ||
    generation.place.recipeSha256 !== (await sha256(recipe.path))
  )
    throw new Error('view recipe and generation mismatch');
} else if (JSON.stringify(generation.geography) !== JSON.stringify(recipe.recipe.geography)) {
  throw new Error('legacy generation geography and view recipe mismatch');
}
const world = worldUnder(options.runRoot);
if (existsSync(path.join(world, 'session.lock')))
  throw new Error('immutable source world is locked');
const metadata = JSON.parse(readFileSync(path.join(world, 'metadata.json'), 'utf8'));
const reader = new AnvilWorldReader(world);
const minecraftData = minecraftDataLoader('1.21.4');
const results = [];
for (const spec of views.sightlines) {
  const observerProjected = projectGeographicPoint(metadata, spec.observer.lon, spec.observer.lat);
  const targetProjected = projectGeographicPoint(metadata, spec.target.lon, spec.target.lat);
  const observerPeak = await localPeak(reader, observerProjected);
  const targetPeak = await localPeak(reader, targetProjected);
  const target = { x: targetPeak.x + 0.5, y: targetPeak.y + 2, z: targetPeak.z + 0.5 };
  const reveal = [];
  for (const lift of [2, 32, 64, 128, 256]) {
    const observer = { x: observerPeak.x + 0.5, y: observerPeak.y + lift, z: observerPeak.z + 0.5 };
    reveal.push({
      liftBlocks: lift,
      observer,
      sightline: await observeLine(reader, minecraftData, observer, target),
    });
  }
  results.push({
    id: spec.id,
    name: spec.name,
    observer: { declared: spec.observer, projected: observerProjected, localPeak: observerPeak },
    target: { declared: spec.target, projected: targetProjected, localPeak: targetPeak },
    reveal,
    minimumClearLiftBlocks: reveal.find((item) => item.sightline.clear)?.liftBlocks ?? null,
  });
}
const report = {
  schemaVersion: 1,
  kind: 'place-sightline-inspection',
  status: 'completed',
  runId: options.runId,
  placeId: recipe.recipe.id,
  sourceRunId: generation.runId,
  worldTreeSha256: tree.treeSha256,
  views: {
    path: path.relative(repositoryRoot, options.views),
    sha256: await sha256(options.views),
  },
  method: {
    authority: 'immutable generated Anvil block tree',
    endpoints:
      'highest generated surface in a bounded 49-by-49 field around each declared coordinate',
    line: 'one-block voxel ray with Minecraft transparency metadata and a three-block endpoint margin',
    reveal: 'same observer column at 2, 32, 64, 128, and 256 blocks above the local peak',
    nonClaim:
      'physical block visibility only; this does not claim client render distance, LOD availability, or active simulation',
    mutation: 'none',
  },
  results,
};
const output =
  options.output ??
  path.join(
    repositoryRoot,
    '.behold-artifacts/place-sightlines',
    recipe.recipe.id,
    options.runId,
    'sightline-report.json',
  );
if (existsSync(output)) throw new Error(`sightline report exists: ${output}`);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(
  `${JSON.stringify({ output, results: results.map(({ id, minimumClearLiftBlocks, reveal }) => ({ id, minimumClearLiftBlocks, base: reveal[0].sightline })) }, null, 2)}\n`,
);
