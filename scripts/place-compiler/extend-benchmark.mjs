#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaceRecipe, sha256 } from './core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--base') options.base = argv[++index];
    else if (key === '--recipe') options.recipe = argv[++index];
    else if (key === '--run-root') options.runRoot = argv[++index];
    else if (key === '--experience') options.experience = argv[++index];
    else if (key === '--output') options.output = argv[++index];
    else if (key === '--id') options.id = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${key}`);
  }
  for (const key of ['base', 'recipe', 'runRoot', 'output', 'id']) {
    if (!options[key])
      throw new Error(`missing --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.id)) throw new Error('invalid benchmark id');
  return options;
}

function repositoryRelative(value, label) {
  const absolute = path.resolve(value);
  if (absolute !== repositoryRoot && !absolute.startsWith(`${repositoryRoot}${path.sep}`))
    throw new Error(`${label} must remain inside the repository`);
  return { absolute, relative: path.relative(repositoryRoot, absolute) };
}

const options = parse(process.argv.slice(2));
const base = repositoryRelative(options.base, 'base benchmark');
const recipeFile = repositoryRelative(options.recipe, 'recipe');
const run = repositoryRelative(options.runRoot, 'run root');
const output = repositoryRelative(options.output, 'output');
const experienceFile = options.experience
  ? repositoryRelative(options.experience, 'experience')
  : null;
if (existsSync(output.absolute)) throw new Error(`output exists: ${output.absolute}`);

const benchmark = JSON.parse(readFileSync(base.absolute, 'utf8'));
const { recipe } = loadPlaceRecipe(recipeFile.absolute);
const generationPath = path.join(run.absolute, 'generation-manifest.json');
const validationPath = path.join(run.absolute, 'evidence', 'place-validation.json');
const treePath = path.join(run.absolute, 'evidence', 'world-checksums.json');
for (const required of [generationPath, validationPath, treePath]) {
  if (!existsSync(required)) throw new Error(`candidate evidence is missing: ${required}`);
}
const generation = JSON.parse(readFileSync(generationPath, 'utf8'));
const validation = JSON.parse(readFileSync(validationPath, 'utf8'));
const tree = JSON.parse(readFileSync(treePath, 'utf8'));
const recipeSha256 = await sha256(recipeFile.absolute);
if (
  generation.status !== 'generated' ||
  validation.status !== 'accepted' ||
  generation.place?.id !== recipe.id ||
  validation.placeId !== recipe.id ||
  generation.place.recipeSha256 !== recipeSha256 ||
  validation.evidence?.recipeSha256 !== recipeSha256 ||
  validation.evidence?.worldTreeSha256 !== tree.treeSha256
)
  throw new Error('candidate generation, validation, recipe, and world tree do not close');
if (benchmark.fixtures.some((fixture) => fixture.placeId === recipe.id))
  throw new Error(`base benchmark already contains ${recipe.id}`);

const fixture = {
  placeId: recipe.id,
  runId: generation.runId,
  runRoot: run.relative,
  recipePath: recipeFile.relative,
  recipeSha256,
  inputSha256: generation.inputs.sha256,
  worldTreeSha256: tree.treeSha256,
  worldFileCount: tree.fileCount,
  worldSizeBytes: tree.totalSizeBytes,
  ...(experienceFile
    ? {
        experiencePath: experienceFile.relative,
        experienceSha256: await sha256(experienceFile.absolute),
      }
    : {}),
};
const extended = {
  ...benchmark,
  id: options.id,
  purpose: `${benchmark.purpose} Candidate ${recipe.name} is appended from accepted generation evidence.`,
  fixtures: [...benchmark.fixtures, fixture],
};
writeFileSync(output.absolute, `${JSON.stringify(extended, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(
  `${JSON.stringify({ output: output.relative, benchmarkId: extended.id, fixture }, null, 2)}\n`,
);
