#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function parse(argv) {
  const options = { runRoot: null, atlasRoot: null, port: 8116, renderThreads: 2, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--run-root') options.runRoot = path.resolve(argv[++i]);
    else if (argv[i] === '--atlas-root') options.atlasRoot = path.resolve(argv[++i]);
    else if (argv[i] === '--port') options.port = Number(argv[++i]);
    else if (argv[i] === '--render-threads') options.renderThreads = Number(argv[++i]);
    else if (argv[i] === '--force') options.force = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  if (!options.runRoot) throw new Error('--run-root is required');
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)
    throw new Error('invalid port');
  if (!Number.isInteger(options.renderThreads) || options.renderThreads < 1)
    throw new Error('invalid render thread count');
  options.atlasRoot ??= path.join(options.runRoot, 'atlas');
  return options;
}

function write(file, content, force) {
  if (existsSync(file) && !force) throw new Error(`refusing to overwrite ${file}`);
  writeFileSync(file, `${content.trim()}\n`, { flag: force ? 'w' : 'wx' });
}

function q(value) {
  return JSON.stringify(value);
}

const options = parse(process.argv.slice(2));
const manifest = JSON.parse(
  readFileSync(path.join(options.runRoot, 'generation-manifest.json'), 'utf8'),
);
if (manifest.schemaVersion !== 2) throw new Error('unsupported generation manifest');
const output = path.join(options.runRoot, 'output');
const worlds = readdirSync(output).filter((name) => name.startsWith('Arnis World '));
if (worlds.length !== 1) throw new Error(`expected one world, found ${worlds.length}`);
const world = path.join(output, worlds[0]);
if (existsSync(path.join(world, 'session.lock'))) throw new Error('source world is locked');
const metadata = JSON.parse(readFileSync(path.join(world, 'metadata.json'), 'utf8'));
const { minMcX, maxMcX, minMcZ, maxMcZ, minGeoLat, maxGeoLat, minGeoLon, maxGeoLon } = metadata;
const project = ({ lat, lon }) => ({
  x: Math.trunc(minMcX + ((lon - minGeoLon) / (maxGeoLon - minGeoLon)) * (maxMcX - minMcX)),
  z: Math.trunc(minMcZ + (1 - (lat - minGeoLat) / (maxGeoLat - minGeoLat)) * (maxMcZ - minMcZ)),
});
const markers = manifest.place.landmarks.map((landmark) => ({ ...landmark, ...project(landmark) }));
const spawn = project(manifest.place.geography.spawn);
const roots = {
  config: path.join(options.atlasRoot, 'config'),
  data: path.join(options.atlasRoot, 'data'),
  logs: path.join(options.atlasRoot, 'logs'),
  web: path.join(options.atlasRoot, 'web'),
};
for (const directory of [
  roots.config,
  roots.data,
  roots.logs,
  roots.web,
  path.join(roots.config, 'maps'),
  path.join(roots.config, 'storages'),
])
  mkdirSync(directory, { recursive: true });
write(
  path.join(roots.config, 'core.conf'),
  `
accept-download: true
data: ${q(roots.data)}
render-thread-count: ${options.renderThreads}
render-thread-priority: 1
scan-for-mod-resources: true
metrics: false
log: { file: ${q(path.join(roots.logs, 'debug.log'))}, append: false }
`,
  options.force,
);
write(
  path.join(roots.config, 'webapp.conf'),
  `
enabled: true
webroot: ${q(roots.web)}
update-settings-file: true
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
`,
  options.force,
);
write(
  path.join(roots.config, 'webserver.conf'),
  `
enabled: true
webroot: ${q(roots.web)}
ip: "127.0.0.1"
port: ${options.port}
log: { file: ${q(path.join(roots.logs, 'webserver.log'))}, append: false }
`,
  options.force,
);
write(
  path.join(roots.config, 'storages', 'file.conf'),
  `
storage-type: file
root: ${q(path.join(roots.web, 'maps'))}
compression: gzip
`,
  options.force,
);
const markerLines = markers
  .map(
    (marker) =>
      `      ${marker.id}: { type: "poi", position: { x: ${marker.x}, y: 100, z: ${marker.z} }, label: ${q(marker.name)}, detail: ${q(`${marker.lat}, ${marker.lon}`)}, icon: "assets/poi.svg", anchor: { x: 25, y: 45 } }`,
  )
  .join('\n');
write(
  path.join(roots.config, 'maps', 'overworld.conf'),
  `
world: ${q(world)}
dimension: "minecraft:overworld"
name: ${q(manifest.place.name)}
sorting: 0
start-pos: { x: ${spawn.x}, z: ${spawn.z} }
sky-color: "#7dabff"
void-color: "#000000"
sky-light: 1
ambient-light: 0.1
remove-caves-below-y: 0
min-inhabited-time: 0
render-mask: [{ min-x: ${minMcX}, max-x: ${maxMcX}, min-z: ${minMcZ}, max-z: ${maxMcZ} }]
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
    label: ${q(`${manifest.place.name} landmarks`)}
    toggleable: true
    default-hidden: false
    markers: {
${markerLines}
    }
  }
}
`,
  options.force,
);
const result = {
  schemaVersion: 1,
  placeId: manifest.place.id,
  runId: manifest.runId,
  world,
  atlasRoot: options.atlasRoot,
  port: options.port,
  renderThreads: options.renderThreads,
  bounds: { minMcX, maxMcX, minMcZ, maxMcZ },
  markers,
};
writeFileSync(
  path.join(options.atlasRoot, 'atlas-manifest.json'),
  `${JSON.stringify(result, null, 2)}\n`,
  { flag: options.force ? 'w' : 'wx' },
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
