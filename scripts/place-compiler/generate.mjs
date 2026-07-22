#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  compileArnisArguments,
  loadPlaceRecipe,
  loadRuntimeProfiles,
  recipeSnapshot,
  sha256,
  timestamp,
} from './core.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptRoot, '../..');
const defaultProfilesPath = path.join(repositoryRoot, 'docs/place-compiler/runtime-profiles.json');

function usage() {
  console.error('Usage: generate.mjs --place RECIPE [--run-id ID] [--osm-json PATH] [--dry-run]');
}

function parseArguments(argv) {
  const options = { place: null, runId: null, osmJson: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--place') options.place = path.resolve(argv[++index]);
    else if (argument === '--run-id') options.runId = argv[++index];
    else if (argument === '--osm-json') options.osmJson = path.resolve(argv[++index]);
    else if (argument === '--dry-run') options.dryRun = true;
    else {
      usage();
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (!options.place) {
    usage();
    throw new Error('--place is required');
  }
  return options;
}

export async function generate(argv) {
  const options = parseArguments(argv);
  const loaded = loadPlaceRecipe(options.place);
  const recipe = loaded.recipe;
  const recipeRelativePath = path.relative(repositoryRoot, loaded.path);
  const toolLockPath = path.join(repositoryRoot, recipe.toolLock);
  const toolLock = JSON.parse(readFileSync(toolLockPath, 'utf8'));
  const arnis = toolLock.tools?.arnisPatched;
  if (!arnis) throw new Error(`Tool lock has no tools.arnisPatched: ${toolLockPath}`);
  const minecraftServer = toolLock.tools?.minecraftServer;
  if (!minecraftServer) throw new Error(`Tool lock has no tools.minecraftServer: ${toolLockPath}`);
  const arnisBinary = path.join(repositoryRoot, arnis.path);
  if (!existsSync(arnisBinary)) throw new Error(`Missing pinned Arnis binary: ${arnisBinary}`);
  const binarySha256 = await sha256(arnisBinary);
  if (binarySha256 !== arnis.sha256) {
    throw new Error(`Arnis checksum mismatch: expected ${arnis.sha256}, got ${binarySha256}`);
  }
  if (options.osmJson && !existsSync(options.osmJson)) {
    throw new Error(`Missing OSM snapshot: ${options.osmJson}`);
  }

  const runId = options.runId ?? `${recipe.id}-${timestamp()}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) throw new Error(`Invalid run id: ${runId}`);
  const runRoot = path.join(repositoryRoot, '.behold-artifacts/places', recipe.id, 'runs', runId);
  const outputRoot = path.join(runRoot, 'output');
  const inputRoot = path.join(runRoot, 'inputs');
  const isolatedHome = path.join(runRoot, 'generator-home');
  const osmJson = path.join(inputRoot, `${recipe.id}-overpass.json`);
  if (existsSync(runRoot)) throw new Error(`Run root already exists: ${runRoot}`);

  const profiles = loadRuntimeProfiles(defaultProfilesPath, recipe.runtimeProfiles);
  const arnisArguments = compileArnisArguments(
    recipe,
    outputRoot,
    osmJson,
    Boolean(options.osmJson),
  );
  const runner = path.join(repositoryRoot, 'scripts/sf-world/run-recorded.mjs');
  const command = [
    'nice',
    '-n',
    String(recipe.resources.nice),
    process.execPath,
    runner,
    runRoot,
    arnisBinary,
    ...arnisArguments,
  ];
  const recipeSha256 = await sha256(loaded.path);
  const osmSha256 = options.osmJson ? await sha256(options.osmJson) : null;
  const manifest = {
    schemaVersion: 2,
    compiler: { name: 'behold-place-compiler', schemaVersion: 1 },
    runId,
    status: options.dryRun ? 'dry-run' : 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    place: recipeSnapshot(recipe, recipeRelativePath, recipeSha256, profiles),
    generator: {
      name: 'Arnis',
      baseVersion: arnis.baseVersion,
      binaryPath: arnis.path,
      binarySha256,
      patchPath: arnis.patchPath,
      toolLockPath: recipe.toolLock,
      toolLockSha256: await sha256(toolLockPath),
      minecraftVersion: minecraftServer.version,
      minecraftServerPath: minecraftServer.path,
      minecraftServerSha256: minecraftServer.sha256,
    },
    resources: recipe.resources,
    environment: {
      ARNIS_STREAM_TO_DISK: '1',
      RAYON_NUM_THREADS: String(recipe.resources.generationThreads),
      HOME: isolatedHome,
      nice: recipe.resources.nice,
    },
    inputs: {
      osmJson,
      sourceOsmJson: options.osmJson,
      mode: options.osmJson ? 'copied-snapshot' : 'fetch-and-save',
      sizeBytes: options.osmJson ? statSync(options.osmJson).size : null,
      sha256: osmSha256,
    },
    outputRoot,
    command,
  };

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  }
  mkdirSync(inputRoot, { recursive: true });
  if (options.osmJson) {
    copyFileSync(options.osmJson, osmJson, constants.COPYFILE_FICLONE);
    if ((await sha256(osmJson)) !== osmSha256) throw new Error('Copied OSM checksum mismatch');
  }
  writeFileSync(
    path.join(runRoot, 'generation-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  );
  const child = spawn(command[0], command.slice(1), {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      HOME: isolatedHome,
      ARNIS_STREAM_TO_DISK: '1',
      RAYON_NUM_THREADS: String(recipe.resources.generationThreads),
    },
    stdio: 'inherit',
  });
  const result = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  manifest.finishedAt = new Date().toISOString();
  manifest.exitCode = result.exitCode;
  manifest.signal = result.signal;
  manifest.status = result.exitCode === 0 ? 'generated' : 'failed';
  if (existsSync(osmJson)) {
    manifest.inputs.sizeBytes = statSync(osmJson).size;
    manifest.inputs.sha256 = await sha256(osmJson);
  }
  writeFileSync(
    path.join(runRoot, 'generation-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  if (result.exitCode !== 0) process.exitCode = result.exitCode ?? 1;
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generate(process.argv.slice(2));
}
