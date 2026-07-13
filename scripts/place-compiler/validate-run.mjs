#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaceRecipe, sha256 } from './core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fail = (message) => {
  throw new Error(`Place validation failed: ${message}`);
};
function close(actual, expected, label) {
  if (Math.abs(actual - expected) > 1e-9) fail(`${label}: expected ${expected}, got ${actual}`);
}
function project(metadata, lat, lon) {
  return {
    x: Math.trunc(
      metadata.minMcX +
        ((lon - metadata.minGeoLon) / (metadata.maxGeoLon - metadata.minGeoLon)) *
          (metadata.maxMcX - metadata.minMcX),
    ),
    z: Math.trunc(
      metadata.minMcZ +
        (1 - (lat - metadata.minGeoLat) / (metadata.maxGeoLat - metadata.minGeoLat)) *
          (metadata.maxMcZ - metadata.minMcZ),
    ),
  };
}

const runRoot = path.resolve(process.argv[2] ?? '');
const manifestPath = path.join(runRoot, 'generation-manifest.json');
if (!process.argv[2] || !existsSync(manifestPath)) fail('missing run or generation manifest');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 2 || manifest.status !== 'generated' || manifest.exitCode !== 0)
  fail('run is not a successful Place Compiler generation');
const recipePath = path.join(repositoryRoot, manifest.place.recipePath);
const { recipe } = loadPlaceRecipe(recipePath);
if ((await sha256(recipePath)) !== manifest.place.recipeSha256)
  fail('recipe has changed since generation');
const toolLockPath = path.join(repositoryRoot, manifest.generator.toolLockPath);
if ((await sha256(toolLockPath)) !== manifest.generator.toolLockSha256)
  fail('tool lock has changed since generation');
if (
  (await sha256(path.join(repositoryRoot, manifest.generator.binaryPath))) !==
  manifest.generator.binarySha256
)
  fail('generator digest mismatch');
if (
  !existsSync(manifest.inputs.osmJson) ||
  (await sha256(manifest.inputs.osmJson)) !== manifest.inputs.sha256
)
  fail('captured OSM missing or changed');
const output = path.join(runRoot, 'output');
const names = readdirSync(output).filter((name) => name.startsWith('Arnis World '));
if (names.length !== 1) fail(`expected one world, found ${names.length}`);
const world = path.join(output, names[0]);
if (existsSync(path.join(world, 'session.lock'))) fail('source world is locked');
for (const entry of ['level.dat', 'metadata.json', 'region'])
  if (!existsSync(path.join(world, entry))) fail(`world missing ${entry}`);
const regions = readdirSync(path.join(world, 'region')).filter((name) => name.endsWith('.mca'));
if (
  !regions.length ||
  regions.some((name) => statSync(path.join(world, 'region', name)).size === 0)
)
  fail('world has no valid region files');
const metadata = JSON.parse(readFileSync(path.join(world, 'metadata.json'), 'utf8'));
const bounds = recipe.geography.bounds;
close(metadata.minGeoLat, bounds.minLat, 'minLat');
close(metadata.maxGeoLat, bounds.maxLat, 'maxLat');
close(metadata.minGeoLon, bounds.minLon, 'minLon');
close(metadata.maxGeoLon, bounds.maxLon, 'maxLon');
close(metadata.scale, recipe.geography.scaleBlocksPerMeter, 'scale');
if (
  metadata.projection !== recipe.geography.projection ||
  !(metadata.maxMcX > metadata.minMcX && metadata.maxMcZ > metadata.minMcZ)
)
  fail('invalid generated coordinate system');
const landmarks = recipe.landmarks.map((item) => ({
  ...item,
  ...project(metadata, item.lat, item.lon),
}));
const outside = landmarks.find(
  (item) =>
    item.x < metadata.minMcX ||
    item.x > metadata.maxMcX ||
    item.z < metadata.minMcZ ||
    item.z > metadata.maxMcZ,
);
if (outside) fail(`landmark mapped outside world: ${outside.id}`);
const worldChecksums = path.join(runRoot, 'evidence', 'world-checksums.json');
if (!existsSync(worldChecksums)) fail('world checksum manifest is missing');
const report = {
  schemaVersion: 1,
  status: 'accepted',
  validatedAt: new Date().toISOString(),
  runId: manifest.runId,
  placeId: recipe.id,
  evidence: {
    recipeSha256: manifest.place.recipeSha256,
    toolLockSha256: manifest.generator.toolLockSha256,
    generatorSha256: manifest.generator.binarySha256,
    osmSha256: manifest.inputs.sha256,
    worldTreeSha256: JSON.parse(readFileSync(worldChecksums, 'utf8')).treeSha256,
  },
  world: {
    path: world,
    regionCount: regions.length,
    minecraftBounds: {
      minX: metadata.minMcX,
      maxX: metadata.maxMcX,
      minZ: metadata.minMcZ,
      maxZ: metadata.maxMcZ,
    },
    geographicBounds: bounds,
    projection: metadata.projection,
    scaleBlocksPerMeter: metadata.scale,
  },
  spawn: {
    ...recipe.geography.spawn,
    ...project(metadata, recipe.geography.spawn.lat, recipe.geography.spawn.lon),
  },
  landmarks,
  runtimeProfiles: Object.keys(manifest.place.runtimeProfiles),
  checks: [
    'manifest-chain',
    'recipe-digest',
    'tool-lock-digest',
    'generator-digest',
    'osm-digest',
    'world-tree',
    'world-structure',
    'coordinate-bounds',
    'landmark-projection',
  ],
};
mkdirSync(path.join(runRoot, 'evidence'), { recursive: true });
writeFileSync(
  path.join(runRoot, 'evidence', 'place-validation.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
