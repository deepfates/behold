#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaceRecipe, sha256 } from './core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function fail(message) {
  throw new Error(`Place validation failed: ${message}`);
}

function findWorld(runRoot) {
  const output = path.join(runRoot, 'output');
  if (!existsSync(output)) fail(`missing output directory: ${output}`);
  const worlds = readdirSync(output).filter((name) => name.startsWith('Arnis World '));
  if (worlds.length !== 1) fail(`expected one Arnis world, found ${worlds.length}`);
  return path.join(output, worlds[0]);
}

function llToXz(metadata, latitude, longitude) {
  const x =
    metadata.minMcX +
    ((longitude - metadata.minGeoLon) / (metadata.maxGeoLon - metadata.minGeoLon)) *
      (metadata.maxMcX - metadata.minMcX);
  const z =
    metadata.minMcZ +
    (1 - (latitude - metadata.minGeoLat) / (metadata.maxGeoLat - metadata.minGeoLat)) *
      (metadata.maxMcZ - metadata.minMcZ);
  return { x: Math.trunc(x), z: Math.trunc(z), rawX: x, rawZ: z };
}

function close(actual, expected, tolerance, label) {
  if (Math.abs(actual - expected) > tolerance)
    fail(`${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
}

async function main(argv) {
  const runRoot = path.resolve(argv[0] ?? '');
  if (!argv[0] || !existsSync(runRoot)) fail(`missing run root: ${runRoot}`);
  const manifestPath = path.join(runRoot, 'generation-manifest.json');
  if (!existsSync(manifestPath)) fail('missing generation-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 2 || manifest.compiler?.name !== 'behold-place-compiler')
    fail('unsupported generation manifest');
  if (manifest.status !== 'generated' || manifest.exitCode !== 0)
    fail(`run is not successfully generated (${manifest.status})`);

  const recipePath = path.join(repositoryRoot, manifest.place.recipePath);
  const { recipe } = loadPlaceRecipe(recipePath);
  if (recipe.id !== manifest.place.id) fail('recipe id disagrees with manifest');
  if ((await sha256(recipePath)) !== manifest.place.recipeSha256)
    fail('recipe has changed since generation');
  const toolLockPath = path.join(repositoryRoot, manifest.generator.toolLockPath);
  if ((await sha256(toolLockPath)) !== manifest.generator.toolLockSha256)
    fail('tool lock has changed since generation');
  if (
    (await sha256(path.join(repositoryRoot, manifest.generator.binaryPath))) !==
    manifest.generator.binarySha256
  )
    fail('generator binary digest mismatch');
  if (!existsSync(manifest.inputs.osmJson)) fail('captured OSM input is missing');
  if ((await sha256(manifest.inputs.osmJson)) !== manifest.inputs.sha256)
    fail('captured OSM digest mismatch');

  const worldPath = findWorld(runRoot);
  if (existsSync(path.join(worldPath, 'session.lock'))) fail('source world is currently locked');
  const required = ['level.dat', 'metadata.json', 'region'];
  for (const entry of required)
    if (!existsSync(path.join(worldPath, entry))) fail(`world is missing ${entry}`);
  const regionFiles = readdirSync(path.join(worldPath, 'region')).filter((name) =>
    name.endsWith('.mca'),
  );
  if (regionFiles.length === 0) fail('world has no region files');
  const emptyRegion = regionFiles.find(
    (name) => statSync(path.join(worldPath, 'region', name)).size === 0,
  );
  if (emptyRegion) fail(`empty region file: ${emptyRegion}`);

  const metadata = JSON.parse(readFileSync(path.join(worldPath, 'metadata.json'), 'utf8'));
  const bounds = recipe.geography.bounds;
  if (metadata.projection !== recipe.geography.projection) fail('projection mismatch');
  close(metadata.minGeoLat, bounds.minLat, 1e-9, 'min latitude');
  close(metadata.maxGeoLat, bounds.maxLat, 1e-9, 'max latitude');
  close(metadata.minGeoLon, bounds.minLon, 1e-9, 'min longitude');
  close(metadata.maxGeoLon, bounds.maxLon, 1e-9, 'max longitude');
  close(metadata.scale, recipe.geography.scaleBlocksPerMeter, 1e-9, 'scale');
  if (!(metadata.maxMcX > metadata.minMcX && metadata.maxMcZ > metadata.minMcZ))
    fail('Minecraft bounds are empty');

  const landmarks = recipe.landmarks.map((landmark) => ({
    ...landmark,
    ...llToXz(metadata, landmark.lat, landmark.lon),
  }));
  const outside = landmarks.find(
    (landmark) =>
      landmark.x < metadata.minMcX ||
      landmark.x > metadata.maxMcX ||
      landmark.z < metadata.minMcZ ||
      landmark.z > metadata.maxMcZ,
  );
  if (outside) fail(`landmark mapped outside world: ${outside.id}`);
  const spawn = llToXz(metadata, recipe.geography.spawn.lat, recipe.geography.spawn.lon);
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
    },
    world: {
      path: worldPath,
      regionCount: regionFiles.length,
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
    spawn: { ...recipe.geography.spawn, ...spawn },
    landmarks,
    runtimeProfiles: Object.keys(manifest.place.runtimeProfiles),
    checks: [
      'manifest-chain',
      'recipe-digest',
      'tool-lock-digest',
      'generator-digest',
      'osm-digest',
      'world-structure',
      'coordinate-bounds',
      'landmark-projection',
    ],
  };
  const evidenceRoot = path.join(runRoot, 'evidence');
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(
    path.join(evidenceRoot, 'place-validation.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main(process.argv.slice(2));
