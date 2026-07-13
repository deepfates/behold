#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
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
  sha256,
  timestamp,
} from './core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parse(argv) {
  const options = { place: null, runId: null, osmJson: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--place') options.place = path.resolve(argv[++i]);
    else if (argv[i] === '--run-id') options.runId = argv[++i];
    else if (argv[i] === '--osm-json') options.osmJson = path.resolve(argv[++i]);
    else if (argv[i] === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  if (!options.place) throw new Error('--place is required');
  return options;
}

export async function generate(argv) {
  const options = parse(argv);
  const loaded = loadPlaceRecipe(options.place);
  const recipe = loaded.recipe;
  const toolLockPath = path.join(repositoryRoot, recipe.toolLock);
  const toolLock = JSON.parse(readFileSync(toolLockPath, 'utf8'));
  const arnis = toolLock.tools?.arnisPatched;
  if (!arnis) throw new Error('tool lock lacks tools.arnisPatched');
  const binary = path.join(repositoryRoot, arnis.path);
  if (!existsSync(binary) || (await sha256(binary)) !== arnis.sha256)
    throw new Error(`missing or invalid Arnis binary: ${binary}`);
  if (options.osmJson && !existsSync(options.osmJson))
    throw new Error(`missing OSM snapshot: ${options.osmJson}`);
  const runId = options.runId ?? `${recipe.id}-${timestamp()}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) throw new Error(`invalid run id: ${runId}`);
  const runRoot = path.join(repositoryRoot, '.behold-artifacts/places', recipe.id, 'runs', runId);
  if (existsSync(runRoot)) throw new Error(`run root exists: ${runRoot}`);
  const outputRoot = path.join(runRoot, 'output');
  const inputRoot = path.join(runRoot, 'inputs');
  const isolatedHome = path.join(runRoot, 'generator-home');
  const osmJson = path.join(inputRoot, `${recipe.id}-overpass.json`);
  const profilesPath = path.join(repositoryRoot, 'docs/place-compiler/runtime-profiles.json');
  const profiles = loadRuntimeProfiles(profilesPath, recipe.runtimeProfiles);
  const compilerSources = [
    'scripts/place-compiler/core.mjs',
    'scripts/place-compiler/generate.mjs',
    'scripts/place-compiler/validate-run.mjs',
    'scripts/place-compiler/materialize-runtime.mjs',
    'scripts/place-compiler/package-release.mjs',
    'scripts/place-compiler/verify-release.mjs',
    'scripts/place-compiler/compare-previews.mjs',
    'docs/place-compiler/runtime-profiles.json',
    path.relative(repositoryRoot, loaded.path),
  ];
  const compilerSourceDigests = Object.fromEntries(
    await Promise.all(
      compilerSources.map(async (source) => [
        source,
        await sha256(path.join(repositoryRoot, source)),
      ]),
    ),
  );
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).stdout.trim();
  const scopedStatus = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--', 'scripts/place-compiler', 'docs/place-compiler'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  ).stdout.trim();
  if (!options.dryRun && scopedStatus.length > 0) {
    throw new Error(`Place Compiler sources must be clean before generation:\n${scopedStatus}`);
  }
  const args = compileArnisArguments(recipe, outputRoot, osmJson, Boolean(options.osmJson));
  const runner = path.join(repositoryRoot, 'scripts/sf-world/run-recorded.mjs');
  const command = [
    'nice',
    '-n',
    String(recipe.resources.nice),
    process.execPath,
    runner,
    runRoot,
    binary,
    ...args,
  ];
  const inputDigest = options.osmJson ? await sha256(options.osmJson) : null;
  const manifest = {
    schemaVersion: 2,
    compiler: { name: 'behold-place-compiler', schemaVersion: 1 },
    repository: {
      revision,
      scopedDirty: scopedStatus.length > 0,
      compilerSourceDigests,
    },
    runId,
    status: options.dryRun ? 'dry-run' : 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    place: {
      ...recipe,
      recipePath: path.relative(repositoryRoot, loaded.path),
      recipeSha256: await sha256(loaded.path),
      runtimeProfiles: profiles,
    },
    generator: {
      name: 'Arnis',
      baseVersion: arnis.baseVersion,
      binaryPath: arnis.path,
      binarySha256: arnis.sha256,
      patchPath: arnis.patchPath,
      toolLockPath: recipe.toolLock,
      toolLockSha256: await sha256(toolLockPath),
      minecraftVersion: toolLock.tools.minecraftServer.version,
      minecraftServerPath: toolLock.tools.minecraftServer.path,
      minecraftServerSha256: toolLock.tools.minecraftServer.sha256,
    },
    environment: {
      HOME: isolatedHome,
      ARNIS_STREAM_TO_DISK: '1',
      RAYON_NUM_THREADS: String(recipe.resources.generationThreads),
      nice: recipe.resources.nice,
    },
    inputs: {
      osmJson,
      sourceOsmJson: options.osmJson,
      mode: options.osmJson ? 'copied-snapshot' : 'fetch-and-save',
      sizeBytes: options.osmJson ? statSync(options.osmJson).size : null,
      sha256: inputDigest,
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
    if ((await sha256(osmJson)) !== inputDigest) throw new Error('copied OSM digest mismatch');
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await generate(process.argv.slice(2));
