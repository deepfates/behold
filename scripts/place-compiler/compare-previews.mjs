#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadPlaceRecipe, sha256 } from './core.mjs';

function parse(argv) {
  const out = { leftRun: null, rightRun: null, leftRecipe: null, rightRecipe: null, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--left-run') out.leftRun = path.resolve(argv[++i]);
    else if (argv[i] === '--right-run') out.rightRun = path.resolve(argv[++i]);
    else if (argv[i] === '--left-recipe') out.leftRecipe = path.resolve(argv[++i]);
    else if (argv[i] === '--right-recipe') out.rightRecipe = path.resolve(argv[++i]);
    else if (argv[i] === '--output') out.output = path.resolve(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  if (!out.leftRun || !out.rightRun || !out.output)
    throw new Error('--left-run, --right-run, and --output are required');
  return out;
}
async function source(runRoot, recipePath) {
  const manifest = JSON.parse(readFileSync(path.join(runRoot, 'generation-manifest.json'), 'utf8'));
  const fallback = recipePath ? loadPlaceRecipe(recipePath) : null;
  const place =
    manifest.place ??
    (fallback ? { ...fallback.recipe, recipeSha256: await sha256(fallback.path) } : null);
  if (!place) throw new Error(`legacy run requires an explicit recipe: ${runRoot}`);
  const output = path.join(runRoot, 'output');
  const worlds = readdirSync(output).filter((name) => name.startsWith('Arnis World '));
  if (worlds.length !== 1) throw new Error(`expected one world under ${runRoot}`);
  const preview = path.join(output, worlds[0], 'arnis_world_map.png');
  if (!existsSync(preview)) throw new Error(`missing map preview: ${preview}`);
  return { runRoot, manifest, place, preview };
}
function execute(args) {
  const result = spawnSync('magick', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ImageMagick failed: ${result.stderr}`);
}

const options = parse(process.argv.slice(2));
if (existsSync(options.output)) throw new Error(`output exists: ${options.output}`);
const left = await source(options.leftRun, options.leftRecipe);
const right = await source(options.rightRun, options.rightRecipe);
mkdirSync(options.output, { recursive: true });
const panels = [left, right].map((item, index) => {
  const panel = path.join(options.output, `panel-${index + 1}.png`);
  execute([
    item.preview,
    '-resize',
    '1200x900',
    '-gravity',
    'center',
    '-background',
    '#0c1220',
    '-extent',
    '1200x900',
    '-pointsize',
    '40',
    '-fill',
    'white',
    '-background',
    '#0c1220',
    `label:${item.place.name} · ${item.manifest.runId}`,
    '-append',
    panel,
  ]);
  return panel;
});
const comparison = path.join(options.output, 'place-compiler-two-place-proof.png');
execute([...panels, '+append', comparison]);
const version = spawnSync('magick', ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0];
const manifest = {
  schemaVersion: 1,
  kind: 'place-compiler-two-place-comparison',
  createdAt: new Date().toISOString(),
  tool: version,
  places: [left, right].map((item) => ({
    id: item.place.id,
    name: item.place.name,
    runId: item.manifest.runId,
    recipeSha256: item.place.recipeSha256,
    inputSha256: item.manifest.inputs.sha256,
    previewSha256: null,
  })),
  artifact: { file: path.basename(comparison), sha256: null },
};
for (let i = 0; i < manifest.places.length; i += 1)
  manifest.places[i].previewSha256 = await sha256([left, right][i].preview);
manifest.artifact.sha256 = await sha256(comparison);
writeFileSync(
  path.join(options.output, 'comparison-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: 'wx' },
);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
