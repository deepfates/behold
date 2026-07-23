#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptRoot, '../..');
const toolLockPath = path.join(repositoryRoot, 'docs/sf-world/tool-lock.json');
const toolLock = JSON.parse(readFileSync(toolLockPath, 'utf8'));
const arnis = toolLock.tools.arnisPatched;

function usage() {
  console.error(
    'Usage: generate.mjs [--run-id ID] [--osm-json PATH] [--dry-run]\n' +
      'Generates the fixed San Francisco bbox under .behold-artifacts/sf/runs/full-city/.',
  );
}

function parseArguments(argv) {
  const options = { runId: null, osmJson: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--run-id') options.runId = argv[++index];
    else if (argument === '--osm-json') options.osmJson = argv[++index];
    else {
      usage();
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  return options;
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

const options = parseArguments(process.argv.slice(2));
const runId = options.runId ?? `sf-full-v3-${timestamp()}`;
const runRoot = path.join(repositoryRoot, '.behold-artifacts/sf/runs/full-city', runId);
const outputRoot = path.join(runRoot, 'output');
const inputRoot = path.join(runRoot, 'inputs');
const arnisBinary = path.join(repositoryRoot, arnis.path);
const providedOsmJson = options.osmJson ? path.resolve(options.osmJson) : null;
const osmJson = path.join(inputRoot, 'SanFrancisco-overpass.json');

if (!existsSync(arnisBinary)) throw new Error(`Missing pinned Arnis binary: ${arnisBinary}`);
const binarySha256 = await sha256(arnisBinary);
if (binarySha256 !== arnis.sha256) {
  throw new Error(`Arnis checksum mismatch: expected ${arnis.sha256}, got ${binarySha256}`);
}
if (providedOsmJson && !existsSync(providedOsmJson)) {
  throw new Error(`Missing OSM snapshot: ${providedOsmJson}`);
}
if (existsSync(runRoot)) throw new Error(`Run root already exists: ${runRoot}`);
const osmJsonSha256 = providedOsmJson ? await sha256(providedOsmJson) : null;

const arnisArguments = [
  '--output-dir',
  outputRoot,
  '--bbox',
  '37.707,-122.516,37.834,-122.349',
  '--scale',
  '1',
  '--projection',
  'local',
  '--terrain',
  '--interior=true',
  '--overture=true',
  '--fillground',
  '--disable-height-limit',
  '--bake-lighting',
  '--map-preview',
  '--map-item=true',
  '--gamemode',
  'creative',
  '--world-time',
  '6000',
  '--spawn-lat',
  '37.7793',
  '--spawn-lng=-122.4193',
  '--rotation',
  '0',
  ...(providedOsmJson ? ['--file', osmJson] : ['--save-json-file', osmJson]),
];
const runner = path.join(scriptRoot, 'run-recorded.mjs');
const command = [
  'nice',
  '-n',
  '10',
  process.execPath,
  runner,
  runRoot,
  arnisBinary,
  ...arnisArguments,
];
const manifest = {
  schemaVersion: 1,
  runId,
  status: options.dryRun ? 'dry-run' : 'running',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  generator: {
    name: 'Arnis',
    baseVersion: '3.0.0',
    binaryPath: arnis.path,
    binarySha256,
    patchPath: arnis.patchPath,
  },
  geography: {
    bounds: { minLat: 37.707, minLon: -122.516, maxLat: 37.834, maxLon: -122.349 },
    projection: 'local',
    scaleBlocksPerMeter: 1,
    rotationDegrees: 0,
    spawn: { name: 'Civic Center', lat: 37.7793, lon: -122.4193 },
  },
  settings: {
    terrain: true,
    interiors: true,
    overture: true,
    fillGround: true,
    extendedHeight: true,
    bakedLighting: true,
    mapPreview: true,
    startingMap: true,
    gameMode: 'creative',
    worldTime: 6000,
  },
  environment: { ARNIS_STREAM_TO_DISK: '1', RAYON_NUM_THREADS: '4', nice: 10 },
  inputs: {
    osmJson,
    sourceOsmJson: providedOsmJson,
    mode: providedOsmJson ? 'copied-snapshot' : 'fetch-and-save',
    sizeBytes: providedOsmJson ? statSync(providedOsmJson).size : null,
    sha256: osmJsonSha256,
  },
  outputRoot,
  command,
};

if (options.dryRun) {
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  process.exit(0);
}

mkdirSync(inputRoot, { recursive: true });
if (providedOsmJson) {
  copyFileSync(providedOsmJson, osmJson, constants.COPYFILE_FICLONE);
  const copiedSha256 = await sha256(osmJson);
  if (copiedSha256 !== osmJsonSha256) {
    throw new Error(`Copied OSM checksum mismatch: expected ${osmJsonSha256}, got ${copiedSha256}`);
  }
}
writeFileSync(
  path.join(runRoot, 'generation-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  {
    flag: 'wx',
  },
);

const child = spawn(command[0], command.slice(1), {
  cwd: repositoryRoot,
  env: { ...process.env, ARNIS_STREAM_TO_DISK: '1', RAYON_NUM_THREADS: '4' },
  stdio: 'inherit',
});

child.on('close', async (exitCode, signal) => {
  manifest.finishedAt = new Date().toISOString();
  manifest.exitCode = exitCode;
  manifest.signal = signal;
  manifest.status = exitCode === 0 ? 'generated' : 'failed';
  if (existsSync(osmJson)) {
    manifest.inputs.sizeBytes = statSync(osmJson).size;
    manifest.inputs.sha256 = await sha256(osmJson);
  }
  writeFileSync(
    path.join(runRoot, 'generation-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.exit(exitCode ?? 1);
});
