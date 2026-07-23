#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function usage() {
  console.error(
    'Usage: configure-bluemap.mjs --run-root PATH [--atlas-root PATH] [--port PORT] [--render-threads N] [--force]',
  );
}

function parseArguments(argv) {
  const options = { runRoot: null, atlasRoot: null, port: 8106, renderThreads: 2, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--run-root') options.runRoot = path.resolve(argv[++index]);
    else if (argument === '--atlas-root') options.atlasRoot = path.resolve(argv[++index]);
    else if (argument === '--port') options.port = Number.parseInt(argv[++index], 10);
    else if (argument === '--render-threads')
      options.renderThreads = Number.parseInt(argv[++index], 10);
    else if (argument === '--force') options.force = true;
    else {
      usage();
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (
    !options.runRoot ||
    !Number.isInteger(options.port) ||
    !Number.isInteger(options.renderThreads)
  ) {
    usage();
    throw new Error('--run-root, an integer --port, and an integer --render-threads are required');
  }
  if (options.port < 1 || options.port > 65535) throw new Error(`Invalid port: ${options.port}`);
  if (options.renderThreads < 1) throw new Error('Render thread count must be positive');
  options.atlasRoot ??= path.join(options.runRoot, 'atlas');
  return options;
}

function hoconString(value) {
  return JSON.stringify(value);
}

function writeConfig(filePath, contents, force) {
  if (existsSync(filePath) && !force) throw new Error(`Refusing to overwrite config: ${filePath}`);
  writeFileSync(filePath, `${contents.trim()}\n`, { flag: force ? 'w' : 'wx' });
}

function findWorld(runRoot) {
  const outputRoot = path.join(runRoot, 'output');
  const worldName = readdirSync(outputRoot).find((name) => name.startsWith('Arnis World '));
  if (!worldName) throw new Error(`No generated Arnis world found under ${outputRoot}`);
  const worldPath = path.join(outputRoot, worldName);
  if (existsSync(path.join(worldPath, 'session.lock'))) {
    throw new Error(`Refusing to configure an atlas from a world with session.lock: ${worldPath}`);
  }
  return worldPath;
}

const options = parseArguments(process.argv.slice(2));
const worldPath = findWorld(options.runRoot);
const metadataPath = path.join(worldPath, 'metadata.json');
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const landmarksPath = path.join(repositoryRoot, 'docs/sf-world/landmarks.json');
const landmarkDocument = JSON.parse(readFileSync(landmarksPath, 'utf8'));
if (metadata.projection !== 'local' || metadata.scale !== 1) {
  throw new Error(`Unexpected coordinate system in ${metadataPath}`);
}
if (landmarkDocument.schemaVersion !== 1 || !Array.isArray(landmarkDocument.landmarks)) {
  throw new Error(`Malformed landmark document: ${landmarksPath}`);
}
for (const landmark of landmarkDocument.landmarks) {
  if (!/^[a-z0-9-]+$/.test(landmark.id)) throw new Error(`Invalid landmark id: ${landmark.id}`);
  for (const coordinate of ['x', 'markerY', 'z']) {
    if (!Number.isFinite(landmark[coordinate]))
      throw new Error(`Invalid ${coordinate} for ${landmark.id}`);
  }
}
const civicCenter = landmarkDocument.landmarks.find((landmark) => landmark.id === 'civic-center');
if (!civicCenter) throw new Error('Landmark document is missing civic-center');
const verifiedLandmarks = landmarkDocument.landmarks.filter(
  (landmark) => landmark.kind !== 'neighborhood',
);
const neighborhoods = landmarkDocument.landmarks.filter(
  (landmark) => landmark.kind === 'neighborhood',
);
function markerLines(places) {
  return places
    .map(
      (place) =>
        `      ${place.id}: { type: "poi", position: { x: ${place.x}, y: ${place.markerY}, z: ${place.z} }, label: ${hoconString(place.label)}, detail: ${hoconString(place.detail)}, icon: "assets/poi.svg", anchor: { x: 25, y: 45 } }`,
    )
    .join('\n');
}

const configRoot = path.join(options.atlasRoot, 'config');
const dataRoot = path.join(options.atlasRoot, 'data');
const logRoot = path.join(options.atlasRoot, 'logs');
const webRoot = path.join(options.atlasRoot, 'web');
const mapRoot = path.join(configRoot, 'maps');
const storageRoot = path.join(configRoot, 'storages');
for (const directory of [configRoot, dataRoot, logRoot, webRoot, mapRoot, storageRoot]) {
  mkdirSync(directory, { recursive: true });
}

writeConfig(
  path.join(configRoot, 'core.conf'),
  `
accept-download: true
data: ${hoconString(dataRoot)}
render-thread-count: ${options.renderThreads}
render-thread-priority: 1
scan-for-mod-resources: true
metrics: false
log: {
  file: ${hoconString(path.join(logRoot, 'debug.log'))}
  append: false
}
`,
  options.force,
);

writeConfig(
  path.join(configRoot, 'webapp.conf'),
  `
enabled: true
webroot: ${hoconString(webRoot)}
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
styles: []
`,
  options.force,
);

writeConfig(
  path.join(configRoot, 'webserver.conf'),
  `
enabled: true
webroot: ${hoconString(webRoot)}
ip: "127.0.0.1"
port: ${options.port}
log: {
  file: ${hoconString(path.join(logRoot, 'webserver.log'))}
  append: false
  format: "%1$s \\"%3$s %4$s %5$s\\" %6$s %7$s"
}
`,
  options.force,
);

writeConfig(
  path.join(storageRoot, 'file.conf'),
  `
storage-type: file
root: ${hoconString(path.join(webRoot, 'maps'))}
compression: gzip
`,
  options.force,
);

writeConfig(
  path.join(mapRoot, 'overworld.conf'),
  `
world: ${hoconString(worldPath)}
dimension: "minecraft:overworld"
name: "San Francisco"
sorting: 0
start-pos: { x: ${civicCenter.x}, z: ${civicCenter.z} }
sky-color: "#7dabff"
void-color: "#000000"
sky-light: 1
ambient-light: 0.1
remove-caves-below-y: 55
cave-detection-ocean-floor: -5
cave-detection-uses-block-light: false
min-inhabited-time: 0
render-mask: [{
  min-x: ${metadata.minMcX}
  max-x: ${metadata.maxMcX}
  min-z: ${metadata.minMcZ}
  max-z: ${metadata.maxMcZ}
}]
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
    label: "San Francisco landmarks"
    toggleable: true
    default-hidden: false
    sorting: 0
    markers: {
${markerLines(verifiedLandmarks)}
    }
  }
  neighborhoods: {
    label: "San Francisco neighborhoods"
    toggleable: true
    default-hidden: false
    sorting: 1
    markers: {
${markerLines(neighborhoods)}
    }
  }
}
`,
  options.force,
);

const result = {
  schemaVersion: 1,
  runRoot: options.runRoot,
  atlasRoot: options.atlasRoot,
  worldPath,
  metadataPath,
  port: options.port,
  renderThreads: options.renderThreads,
  landmarksPath,
  placeCount: landmarkDocument.landmarks.length,
  landmarkCount: verifiedLandmarks.length,
  neighborhoodCount: neighborhoods.length,
  mapBounds: {
    minX: metadata.minMcX,
    maxX: metadata.maxMcX,
    minZ: metadata.minMcZ,
    maxZ: metadata.maxMcZ,
  },
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
