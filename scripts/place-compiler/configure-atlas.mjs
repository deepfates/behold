#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnvilWorldReader } from './anvil-reader.mjs';
import { loadPlaceRecipe, sha256 } from './core.mjs';
import { projectGeographicPoint } from './route-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parse(argv) {
  const out = { runRoot: null, place: null, atlasRoot: null, port: 8106, renderThreads: 2 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--run-root') out.runRoot = path.resolve(argv[++index]);
    else if (argv[index] === '--place') out.place = path.resolve(argv[++index]);
    else if (argv[index] === '--atlas-root') out.atlasRoot = path.resolve(argv[++index]);
    else if (argv[index] === '--port') out.port = Number(argv[++index]);
    else if (argv[index] === '--render-threads') out.renderThreads = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!out.runRoot || !out.place) throw new Error('--run-root and --place are required');
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535)
    throw new Error('port must be an integer from 1 through 65535');
  if (!Number.isInteger(out.renderThreads) || out.renderThreads < 1)
    throw new Error('render threads must be a positive integer');
  out.atlasRoot ??= path.join(out.runRoot, 'atlas');
  return out;
}

function worldUnder(runRoot) {
  const output = path.join(runRoot, 'output');
  const worlds = readdirSync(output).filter((name) => name.startsWith('Arnis World '));
  if (worlds.length !== 1) throw new Error(`expected one source world, found ${worlds.length}`);
  return path.join(output, worlds[0]);
}

function writeNew(file, contents) {
  writeFileSync(file, `${contents.trim()}\n`, { flag: 'wx' });
}

async function surfaceNear(reader, projected) {
  const candidates = [];
  for (let dx = -16; dx <= 16; dx += 4)
    for (let dz = -16; dz <= 16; dz += 4) {
      const x = Math.round(projected.x + dx);
      const z = Math.round(projected.z + dz);
      const column = await reader.scanColumn(x, z);
      if (column.top) candidates.push({ x, z, ...column.top });
    }
  if (!candidates.length) throw new Error('no generated surface near atlas marker');
  return candidates.sort(
    (left, right) =>
      right.y - left.y ||
      Math.hypot(left.x - projected.x, left.z - projected.z) -
        Math.hypot(right.x - projected.x, right.z - projected.z),
  )[0];
}

const options = parse(process.argv.slice(2));
if (existsSync(options.atlasRoot)) throw new Error(`atlas root exists: ${options.atlasRoot}`);
const recipe = loadPlaceRecipe(options.place);
const generation = JSON.parse(
  readFileSync(path.join(options.runRoot, 'generation-manifest.json'), 'utf8'),
);
if (generation.status !== 'generated') throw new Error('generation is not accepted');
const recipeSha256 = await sha256(recipe.path);
if (generation.place) {
  if (generation.place.id !== recipe.recipe.id || generation.place.recipeSha256 !== recipeSha256)
    throw new Error('place recipe and generation mismatch');
} else if (JSON.stringify(generation.geography) !== JSON.stringify(recipe.recipe.geography)) {
  throw new Error('legacy generation geography and place recipe mismatch');
}
const world = worldUnder(options.runRoot);
if (existsSync(path.join(world, 'session.lock')))
  throw new Error('immutable source world is locked');
const metadataPath = path.join(world, 'metadata.json');
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
const reader = new AnvilWorldReader(world);
const markers = [];
for (const landmark of recipe.recipe.landmarks) {
  const projected = projectGeographicPoint(metadata, landmark.lon, landmark.lat);
  const surface = await surfaceNear(reader, projected);
  markers.push({
    id: landmark.id,
    name: landmark.name,
    latitude: landmark.lat,
    longitude: landmark.lon,
    x: Math.round(projected.x),
    z: Math.round(projected.z),
    markerY: surface.y + 4,
    nearbySurface: surface,
  });
}
const spawn = projectGeographicPoint(
  metadata,
  recipe.recipe.geography.spawn.lon,
  recipe.recipe.geography.spawn.lat,
);
const caveCutoff = Math.max(-64, Math.min(...markers.map((marker) => marker.nearbySurface.y)) - 32);
const configRoot = path.join(options.atlasRoot, 'config');
const mapRoot = path.join(configRoot, 'maps');
const storageRoot = path.join(configRoot, 'storages');
const dataRoot = path.join(options.atlasRoot, 'data');
const webRoot = path.join(options.atlasRoot, 'web');
const logRoot = path.join(options.atlasRoot, 'logs');
for (const directory of [configRoot, mapRoot, storageRoot, dataRoot, webRoot, logRoot])
  mkdirSync(directory, { recursive: true });
writeNew(
  path.join(configRoot, 'core.conf'),
  `accept-download: true
data: ${JSON.stringify(dataRoot)}
render-thread-count: ${options.renderThreads}
render-thread-priority: 1
scan-for-mod-resources: true
metrics: false
log: { file: ${JSON.stringify(path.join(logRoot, 'debug.log'))}, append: false }`,
);
writeNew(
  path.join(configRoot, 'webapp.conf'),
  `enabled: true
webroot: ${JSON.stringify(webRoot)}
update-settings-file: true
use-cookies: true
default-to-flat-view: false
min-zoom-distance: 5
max-zoom-distance: 100000
resolution-default: 1
hires-slider-max: 500
hires-slider-default: 100
hires-slider-min: 0
lowres-slider-max: 7000
lowres-slider-default: 2000
lowres-slider-min: 500
scripts: []
styles: []`,
);
writeNew(
  path.join(configRoot, 'webserver.conf'),
  `enabled: true
webroot: ${JSON.stringify(webRoot)}
ip: "127.0.0.1"
port: ${options.port}
log: { file: ${JSON.stringify(path.join(logRoot, 'webserver.log'))}, append: false, format: "%1$s \\"%3$s %4$s %5$s\\" %6$s %7$s" }`,
);
writeNew(
  path.join(storageRoot, 'file.conf'),
  `storage-type: file
root: ${JSON.stringify(path.join(webRoot, 'maps'))}
compression: gzip`,
);
const markerLines = markers
  .map(
    (marker) =>
      `      ${marker.id}: { type: "poi", position: { x: ${marker.x}, y: ${marker.markerY}, z: ${marker.z} }, label: ${JSON.stringify(marker.name)}, detail: ${JSON.stringify(`${marker.latitude}, ${marker.longitude}`)}, icon: "assets/poi.svg", anchor: { x: 25, y: 45 } }`,
  )
  .join('\n');
writeNew(
  path.join(mapRoot, 'overworld.conf'),
  `world: ${JSON.stringify(world)}
dimension: "minecraft:overworld"
name: ${JSON.stringify(recipe.recipe.name)}
sorting: 0
start-pos: { x: ${Math.round(spawn.x)}, z: ${Math.round(spawn.z)} }
sky-color: "#7dabff"
void-color: "#000000"
sky-light: 1
ambient-light: 0.1
remove-caves-below-y: ${caveCutoff}
cave-detection-ocean-floor: -5
cave-detection-uses-block-light: false
min-inhabited-time: 0
render-mask: [{ min-x: ${metadata.minMcX}, max-x: ${metadata.maxMcX}, min-z: ${metadata.minMcZ}, max-z: ${metadata.maxMcZ} }]
render-edges: true
edge-light-strength: 8
enable-perspective-view: true
enable-flat-view: true
enable-free-flight-view: true
enable-hires: true
storage: "file"
ignore-missing-light-data: false
marker-sets: {
  landmarks: {
    label: ${JSON.stringify(`${recipe.recipe.name} landmarks`)}
    toggleable: true
    default-hidden: false
    sorting: 0
    markers: {
${markerLines}
    }
  }
}`,
);
const manifest = {
  schemaVersion: 1,
  kind: 'place-atlas-configuration',
  placeId: recipe.recipe.id,
  sourceRunId: generation.runId,
  recipe: { path: path.relative(repositoryRoot, recipe.path), sha256: recipeSha256 },
  world,
  metadataPath,
  atlasRoot: options.atlasRoot,
  server: { host: '127.0.0.1', port: options.port },
  renderThreads: options.renderThreads,
  mapBounds: {
    minX: metadata.minMcX,
    maxX: metadata.maxMcX,
    minZ: metadata.minMcZ,
    maxZ: metadata.maxMcZ,
  },
  caveCutoff,
  markers,
};
writeNew(path.join(options.atlasRoot, 'atlas-manifest.json'), JSON.stringify(manifest, null, 2));
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
