#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CARTOGRAPHY_POLICIES, sha256, timestamp, validatePlaceRecipe } from './core.mjs';
import { generate } from './generate.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function assert(condition, message) {
  if (!condition) throw new Error(`Cartography experiment: ${message}`);
}

export function validateExperiment(value, source = '<experiment>') {
  assert(value?.schemaVersion === 1, `${source} is not a v1 experiment`);
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id ?? ''), `${source} has invalid id`);
  assert(typeof value.question === 'string' && value.question.length >= 20, 'question is missing');
  assert(
    Array.isArray(value.policies) &&
      value.policies.length >= 2 &&
      value.policies.every((policy) => CARTOGRAPHY_POLICIES.includes(policy)),
    'policies must be supported cartography policies',
  );
  assert(Array.isArray(value.windows) && value.windows.length >= 2, 'needs contrasting windows');
  for (const window of value.windows) {
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(window.id ?? ''), 'window has invalid id');
    assert(
      typeof window.structure === 'string' && window.structure.length >= 12,
      `${window.id} lacks structural rationale`,
    );
    assert(
      !path.isAbsolute(window.osmSnapshot),
      `${window.id} snapshot must be repository-relative`,
    );
    assert(
      Array.isArray(window.landmarks) && window.landmarks.length >= 2,
      `${window.id} needs landmarks`,
    );
  }
  return value;
}

export function calibrationRecipe(experiment, window, policy) {
  return validatePlaceRecipe({
    schemaVersion: 1,
    id: `calibration-${window.id}-${policy}`,
    name: `${window.name} · ${policy}`,
    toolLock: 'docs/sf-world/tool-lock.json',
    geography: {
      bounds: window.bounds,
      projection: 'local',
      scaleBlocksPerMeter: 1,
      rotationDegrees: 0,
      spawn: window.spawn,
    },
    generation: {
      cartographyPolicy: policy,
      terrain: true,
      interiors: false,
      overture: false,
      fillGround: true,
      extendedHeight: true,
      bakedLighting: false,
      mapPreview: true,
      startingMap: true,
      gameMode: 'creative',
      worldTime: 6000,
    },
    resources: { generationThreads: 4, nice: 10 },
    runtimeProfiles: ['cinematic', 'playable', 'living'],
    dataSources: {
      osm: { provider: 'frozen experiment snapshot', snapshotPolicy: 'digest-bound' },
      elevation: { provider: 'Arnis locked provider chain' },
      landCover: { provider: 'ESA WorldCover through locked Arnis' },
      buildings: { providers: ['OpenStreetMap'] },
    },
    landmarks: window.landmarks,
    provenance: {
      kind: 'bounded-cartography-experiment',
      experimentId: experiment.id,
      structuralClass: window.structure,
    },
  });
}

function parse(argv) {
  const options = {
    experiment: path.join(
      repositoryRoot,
      'docs/place-compiler/cartography-experiments/minecraft-legible-v1.json',
    ),
    runId: null,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--experiment') options.experiment = path.resolve(argv[++index]);
    else if (argv[index] === '--run-id') options.runId = argv[++index];
    else if (argv[index] === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  return options;
}

function worldPreview(runRoot) {
  const outputRoot = path.join(runRoot, 'output');
  const worlds = readdirSync(outputRoot).filter((entry) => entry.startsWith('Arnis World '));
  assert(worlds.length === 1, `${runRoot} does not contain exactly one generated world`);
  return path.join(outputRoot, worlds[0], 'arnis_world_map.png');
}

function magick(args) {
  const result = spawnSync('magick', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ImageMagick failed: ${result.stderr}`);
}

export async function runExperiment(argv) {
  const options = parse(argv);
  const experiment = validateExperiment(
    JSON.parse(readFileSync(options.experiment, 'utf8')),
    options.experiment,
  );
  const runId = options.runId ?? `${experiment.id}-${timestamp()}`;
  assert(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId), 'invalid run id');
  const experimentRoot = path.join(
    repositoryRoot,
    '.behold-artifacts/cartography-experiments',
    runId,
  );
  assert(!existsSync(experimentRoot), `output exists: ${experimentRoot}`);
  const recipeRoot = path.join(experimentRoot, 'recipes');
  const comparisonRoot = path.join(experimentRoot, 'comparisons');
  mkdirSync(recipeRoot, { recursive: true });
  mkdirSync(comparisonRoot, { recursive: true });

  const results = [];
  for (const window of experiment.windows) {
    const snapshot = path.join(repositoryRoot, window.osmSnapshot);
    assert(existsSync(snapshot), `${window.id} snapshot is missing`);
    for (const policy of experiment.policies) {
      const recipe = calibrationRecipe(experiment, window, policy);
      const recipePath = path.join(recipeRoot, `${window.id}-${policy}.json`);
      writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`, { flag: 'wx' });
      const generationRunId = `${runId}-${window.id}-${policy}`;
      const manifest = await generate([
        '--place',
        recipePath,
        '--run-id',
        generationRunId,
        '--osm-json',
        snapshot,
        ...(options.dryRun ? ['--dry-run'] : []),
      ]);
      results.push({
        windowId: window.id,
        structure: window.structure,
        policy,
        recipePath,
        generationRunId,
        runRoot: path.dirname(manifest.outputRoot),
        manifest,
      });
    }
  }

  if (!options.dryRun) {
    for (const window of experiment.windows) {
      const pair = results.filter((result) => result.windowId === window.id);
      assert(pair.length === 2, `${window.id} does not have a policy pair`);
      const panels = [];
      for (const result of pair) {
        const panel = path.join(comparisonRoot, `${window.id}-${result.policy}.png`);
        magick([
          worldPreview(result.runRoot),
          '-resize',
          '1000x800',
          '-gravity',
          'center',
          '-background',
          '#0c1220',
          '-extent',
          '1000x800',
          '-pointsize',
          '34',
          '-fill',
          'white',
          '-background',
          '#0c1220',
          `label:${window.name} · ${result.policy}`,
          '-append',
          panel,
        ]);
        panels.push(panel);
      }
      magick([...panels, '+append', path.join(comparisonRoot, `${window.id}.png`)]);
    }
    magick([
      ...experiment.windows.map((window) => path.join(comparisonRoot, `${window.id}.png`)),
      '-append',
      path.join(comparisonRoot, 'all-windows.png'),
    ]);
  }

  const manifest = {
    schemaVersion: 1,
    kind: 'bounded-cartography-experiment',
    experimentId: experiment.id,
    question: experiment.question,
    runId,
    createdAt: new Date().toISOString(),
    status: options.dryRun ? 'dry-run' : 'generated-awaiting-review',
    experimentPath: path.relative(repositoryRoot, options.experiment),
    experimentSha256: await sha256(options.experiment),
    policies: experiment.policies,
    windows: experiment.windows.map(({ id, name, structure, osmSnapshot }) => ({
      id,
      name,
      structure,
      osmSnapshot,
    })),
    results: await Promise.all(
      results.map(async (result) => ({
        windowId: result.windowId,
        structure: result.structure,
        policy: result.policy,
        recipePath: path.relative(repositoryRoot, result.recipePath),
        recipeSha256: await sha256(result.recipePath),
        generationRunId: result.generationRunId,
        runRoot: path.relative(repositoryRoot, result.runRoot),
        inputSha256: result.manifest.inputs.sha256,
        binarySha256: result.manifest.generator.binarySha256,
        previewSha256: options.dryRun ? null : await sha256(worldPreview(result.runRoot)),
      })),
    ),
    comparison: options.dryRun
      ? null
      : {
          path: 'comparisons/all-windows.png',
          sha256: await sha256(path.join(comparisonRoot, 'all-windows.png')),
        },
    decision: null,
  };
  writeFileSync(
    path.join(experimentRoot, 'experiment-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    {
      flag: 'wx',
    },
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runExperiment(process.argv.slice(2));
