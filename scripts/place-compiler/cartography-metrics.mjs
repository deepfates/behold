#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnvilWorldReader } from './anvil-reader.mjs';
import { sha256 } from './core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AIR = /^(?:minecraft:)?(?:air|cave_air|void_air)$/;
const WATER = /^(?:minecraft:)?(?:water|lava)$/;
const TREE = /(?:leaves|(?:^|_)(?:log|wood)$|stem$|hyphae$|mangrove_roots$)/;
const LOW_PLANT =
  /(?:grass|fern|flower|sapling|vine|moss|cactus|bamboo|crop|wheat|carrots|potatoes|beetroots|sugar_cane|seagrass|kelp)/;

function assert(condition, message) {
  if (!condition) throw new Error(`Cartography metrics: ${message}`);
}

export function classifyTop(name) {
  if (!name || AIR.test(name)) return 'missing';
  const normalized = name.replace(/^minecraft:/, '');
  if (WATER.test(name)) return 'water';
  if (TREE.test(normalized)) return 'tree';
  if (LOW_PLANT.test(normalized)) return 'low-plant';
  return 'exposed-solid';
}

export function isUnderlyingSurface(name) {
  const kind = classifyTop(name);
  return kind === 'exposed-solid';
}

export function sampleLattice(metadata, maximumSamples = 4096) {
  const width = metadata.maxMcX - metadata.minMcX + 1;
  const depth = metadata.maxMcZ - metadata.minMcZ + 1;
  assert(width > 0 && depth > 0, 'world metadata has invalid bounds');
  assert(Number.isInteger(maximumSamples) && maximumSamples >= 4, 'sample count must be >= 4');
  const xCount = Math.max(2, Math.round(Math.sqrt((maximumSamples * width) / depth)));
  const zCount = Math.max(2, Math.floor(maximumSamples / xCount));
  const coordinate = (minimum, size, index, count) =>
    Math.min(minimum + size - 1, Math.floor(minimum + ((index + 0.5) * size) / count));
  return Array.from({ length: zCount }, (_, zIndex) =>
    Array.from({ length: xCount }, (_unused, xIndex) => ({
      x: coordinate(metadata.minMcX, width, xIndex, xCount),
      z: coordinate(metadata.minMcZ, depth, zIndex, zCount),
    })),
  ).flat();
}

export function summarizeMeasurements(measurements) {
  const counts = {
    missing: 0,
    water: 0,
    tree: 0,
    'low-plant': 0,
    'exposed-solid': 0,
  };
  const canopyGaps = [];
  let obstructingCanopy = 0;
  let severeCanopy = 0;
  let underlyingSurfaceMissing = 0;
  for (const measurement of measurements) {
    counts[measurement.topKind] += 1;
    if (!measurement.ground) underlyingSurfaceMissing += 1;
    if (measurement.topKind !== 'tree' || !measurement.ground) continue;
    const gap = measurement.top.y - measurement.ground.y;
    canopyGaps.push(gap);
    if (gap >= 2) obstructingCanopy += 1;
    if (gap >= 8) severeCanopy += 1;
  }
  const total = measurements.length;
  return {
    sampleCount: total,
    topCounts: counts,
    topShares: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value / total])),
    underlyingSurfaceMissingCount: underlyingSurfaceMissing,
    underlyingSurfaceMissingShare: underlyingSurfaceMissing / total,
    obstructingCanopyCount: obstructingCanopy,
    obstructingCanopyShare: obstructingCanopy / total,
    severeCanopyCount: severeCanopy,
    severeCanopyShare: severeCanopy / total,
    meanCanopyGap:
      canopyGaps.length === 0
        ? null
        : canopyGaps.reduce((sum, value) => sum + value, 0) / canopyGaps.length,
    maximumCanopyGap: canopyGaps.length === 0 ? null : Math.max(...canopyGaps),
  };
}

function worldRoot(runRoot) {
  const outputRoot = path.join(runRoot, 'output');
  const worlds = readdirSync(outputRoot).filter((entry) => entry.startsWith('Arnis World '));
  assert(worlds.length === 1, `${runRoot} does not contain exactly one generated world`);
  return path.join(outputRoot, worlds[0]);
}

async function measureWorld(root, coordinates) {
  const reader = new AnvilWorldReader(root);
  const measurements = [];
  for (const coordinate of coordinates) {
    const { top, accepted: ground } = await reader.scanColumn(coordinate.x, coordinate.z, {
      accept: isUnderlyingSurface,
      transparent: (name) => AIR.test(name),
    });
    measurements.push({ ...coordinate, top, ground, topKind: classifyTop(top?.name) });
  }
  return summarizeMeasurements(measurements);
}

function parse(argv) {
  const options = { manifest: null, maximumSamples: 4096 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--manifest') options.manifest = path.resolve(argv[++index]);
    else if (argv[index] === '--samples') options.maximumSamples = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  assert(options.manifest, '--manifest is required');
  assert(existsSync(options.manifest), `manifest is missing: ${options.manifest}`);
  return options;
}

export async function measureExperiment(argv) {
  const options = parse(argv);
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'));
  assert(manifest.kind === 'bounded-cartography-experiment', 'manifest has the wrong kind');
  const results = [];
  for (const window of manifest.windows) {
    const pair = manifest.results.filter((result) => result.windowId === window.id);
    assert(pair.length === 2, `${window.id} does not have exactly two policy results`);
    const roots = pair.map((result) => worldRoot(path.join(repositoryRoot, result.runRoot)));
    const metadata = roots.map((root) => JSON.parse(readFileSync(path.join(root, 'metadata.json'), 'utf8')));
    assert(JSON.stringify(metadata[0]) === JSON.stringify(metadata[1]), `${window.id} metadata differs`);
    const coordinates = sampleLattice(metadata[0], options.maximumSamples);
    for (let index = 0; index < pair.length; index += 1) {
      process.stderr.write(`Measuring ${window.id} · ${pair[index].policy} (${coordinates.length} columns)\n`);
      results.push({
        windowId: window.id,
        policy: pair[index].policy,
        worldRoot: path.relative(repositoryRoot, roots[index]),
        worldMetadataSha256: await sha256(path.join(roots[index], 'metadata.json')),
        metrics: await measureWorld(roots[index], coordinates),
      });
    }
  }
  const comparisons = manifest.windows.map((window) => {
    const literal = results.find(
      (result) => result.windowId === window.id && result.policy === 'literal-v1',
    );
    const legible = results.find(
      (result) => result.windowId === window.id && result.policy === 'minecraft-legible-v1',
    );
    assert(literal && legible, `${window.id} is missing the expected policy pair`);
    const delta = (key) => legible.metrics[key] - literal.metrics[key];
    return {
      windowId: window.id,
      obstructingCanopyShareDelta: delta('obstructingCanopyShare'),
      severeCanopyShareDelta: delta('severeCanopyShare'),
      exposedSolidShareDelta:
        legible.metrics.topShares['exposed-solid'] - literal.metrics.topShares['exposed-solid'],
      underlyingSurfaceMissingShareDelta: delta('underlyingSurfaceMissingShare'),
    };
  });
  const report = {
    schemaVersion: 1,
    kind: 'cartography-structural-metrics',
    experimentRunId: manifest.runId,
    experimentManifest: path.relative(repositoryRoot, options.manifest),
    experimentManifestSha256: await sha256(options.manifest),
    sampling: {
      method: 'deterministic cell-centered rectangular lattice',
      maximumColumnsPerWorld: options.maximumSamples,
      interpretation:
        'Structural canopy and exposed-surface evidence only; not a substitute for route traversal or human visual review.',
    },
    results,
    comparisons,
  };
  const output = path.join(path.dirname(options.manifest), 'structural-metrics.json');
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${output}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  measureExperiment(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
