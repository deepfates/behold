#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import minecraftDataLoader from 'minecraft-data';
import { AnvilWorldReader } from './anvil-reader.mjs';
import { loadPlaceRecipe, sha256, timestamp } from './core.mjs';
import {
  chooseDirectedSurface,
  hasTwoBlockHeadroom,
  sampleRouteGeometry,
  summarizeRouteSamples,
} from './route-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AIR = /^(?:minecraft:)?(?:air|cave_air|void_air)$/;

function parse(argv) {
  const out = {
    runRoot: null,
    route: null,
    policy: null,
    runId: `route-${timestamp()}`,
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--run-root') out.runRoot = path.resolve(argv[++index]);
    else if (argv[index] === '--route') out.route = path.resolve(argv[++index]);
    else if (argv[index] === '--policy') out.policy = path.resolve(argv[++index]);
    else if (argv[index] === '--run-id') out.runId = argv[++index];
    else if (argv[index] === '--output') out.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!out.runRoot || !out.route) throw new Error('--run-root and --route are required');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(out.runId)) throw new Error('invalid run id');
  out.policy ??= path.join(repositoryRoot, 'docs/place-compiler/route-policy.json');
  return out;
}

function worldUnder(runRoot) {
  const output = path.join(runRoot, 'output');
  const worlds = readdirSync(output).filter((name) => name.startsWith('Arnis World '));
  if (worlds.length !== 1) throw new Error(`expected one source world, found ${worlds.length}`);
  return path.join(output, worlds[0]);
}

function collision(data, name) {
  const short = name?.replace(/^minecraft:/, '');
  return short ? data.blocksByName[short]?.boundingBox !== 'empty' : false;
}

async function inspectCandidate(reader, surfaces, policy, x, z, dx, dz) {
  const column = await reader.scanColumn(x, z, { accept: (name) => surfaces.has(name) });
  if (!column.accepted) return { x, z, dx, dz, clear: false, reason: 'no-route-surface' };
  const feet = await reader.blockAt(x, column.accepted.y + 1, z);
  const head = await reader.blockAt(x, column.accepted.y + 2, z);
  const clear = hasTwoBlockHeadroom(feet, head);
  return {
    x,
    z,
    dx,
    dz,
    surfaceY: column.accepted.y,
    surface: column.accepted.name,
    top: column.top,
    feet,
    head,
    clear,
    reason: clear ? null : 'occupied-route-column',
  };
}

const options = parse(process.argv.slice(2));
const generationPath = path.join(options.runRoot, 'generation-manifest.json');
const treePath = path.join(options.runRoot, 'evidence', 'world-checksums.json');
const generation = JSON.parse(readFileSync(generationPath, 'utf8'));
const tree = JSON.parse(readFileSync(treePath, 'utf8'));
const route = JSON.parse(readFileSync(options.route, 'utf8'));
const policy = JSON.parse(readFileSync(options.policy, 'utf8'));
const recipePath = path.resolve(repositoryRoot, route.recipePath);
if (!recipePath.startsWith(`${repositoryRoot}${path.sep}`))
  throw new Error('route recipe path escapes repository');
const recipe = loadPlaceRecipe(recipePath);
if (
  generation.status !== 'generated' ||
  recipe.recipe.id !== route.placeId ||
  (await sha256(recipe.path)) !== route.recipeSha256
)
  throw new Error('route, recipe, and generation identity mismatch');
if (generation.place) {
  if (generation.place.id !== route.placeId || generation.place.recipeSha256 !== route.recipeSha256)
    throw new Error('route was not generated from this place recipe');
} else if (JSON.stringify(generation.geography) !== JSON.stringify(recipe.recipe.geography)) {
  throw new Error('legacy generation geography does not match route recipe');
}
const world = worldUnder(options.runRoot);
if (existsSync(path.join(world, 'session.lock')))
  throw new Error('immutable source world is locked');
const metadata = JSON.parse(readFileSync(path.join(world, 'metadata.json'), 'utf8'));
const surfaces = new Set([...policy.surfaceBlocks.primary, ...policy.surfaceBlocks.secondary]);
const reader = new AnvilWorldReader(world);
const sourceSamples = sampleRouteGeometry(
  route.geometry.coordinates,
  metadata,
  policy.pointSpacingBlocks,
);
const samples = [];
let previousOffset = { dx: 0, dz: 0 };
for (const source of sourceSamples) {
  const candidates = [await inspectCandidate(reader, surfaces, policy, source.x, source.z, 0, 0)];
  if (!candidates[0].clear) {
    for (let dx = -policy.lateralSearchBlocks; dx <= policy.lateralSearchBlocks; dx += 1)
      for (let dz = -policy.lateralSearchBlocks; dz <= policy.lateralSearchBlocks; dz += 1) {
        if ((dx === 0 && dz === 0) || Math.hypot(dx, dz) > policy.lateralSearchBlocks) continue;
        candidates.push(
          await inspectCandidate(reader, surfaces, policy, source.x + dx, source.z + dz, dx, dz),
        );
      }
  }
  const selected = chooseDirectedSurface(candidates, previousOffset);
  const status = !selected
    ? 'unresolved'
    : selected.dx === 0 && selected.dz === 0
      ? 'exact-clear'
      : 'offset-clear';
  if (selected) previousOffset = { dx: selected.dx, dz: selected.dz };
  else previousOffset = { dx: 0, dz: 0 };
  samples.push({ ...source, status, selected, center: candidates[0] });
}

const minecraftData = minecraftDataLoader(policy.minecraftVersion);
const swept = {
  spacingBlocks: 1,
  testedPoints: 0,
  blockedPoints: 0,
  unsupportedPoints: 0,
  defects: [],
};
for (let index = 1; index < samples.length; index += 1) {
  const from = samples[index - 1].selected;
  const to = samples[index].selected;
  if (!from || !to) continue;
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / swept.spacingBlocks));
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const x = Math.round(from.x + (to.x - from.x) * ratio);
    const z = Math.round(from.z + (to.z - from.z) * ratio);
    const expectedY = from.surfaceY + (to.surfaceY - from.surfaceY) * ratio;
    let support = null;
    for (const delta of [1, 0, -1, 2, -2]) {
      const y = Math.round(expectedY + delta);
      const name = await reader.blockAt(x, y, z);
      if (surfaces.has(name)) {
        support = { y, name };
        break;
      }
    }
    const feet = support ? await reader.blockAt(x, support.y + 1, z) : null;
    const head = support ? await reader.blockAt(x, support.y + 2, z) : null;
    const blocked = support && (collision(minecraftData, feet) || collision(minecraftData, head));
    swept.testedPoints += 1;
    if (!support) swept.unsupportedPoints += 1;
    if (blocked) swept.blockedPoints += 1;
    if (!support || blocked)
      swept.defects.push({
        fromSample: index - 1,
        toSample: index,
        x,
        z,
        expectedY,
        support,
        feet,
        head,
        blocked,
      });
  }
}
const report = {
  schemaVersion: 1,
  kind: 'place-ground-route-inspection',
  status: 'completed',
  runId: options.runId,
  placeId: route.placeId,
  sourceRunId: generation.runId,
  worldTreeSha256: tree.treeSha256,
  route: {
    path: path.relative(repositoryRoot, options.route),
    sha256: await sha256(options.route),
    id: route.routeId,
    name: route.name,
    sourcePointCount: route.geometry.coordinates.length,
  },
  policy: {
    path: path.relative(repositoryRoot, options.policy),
    sha256: await sha256(options.policy),
  },
  method: {
    authority: 'frozen geographic route plus immutable generated Anvil block tree',
    pointInspection:
      'recognized generated route surface, actor headroom, and bounded lateral reconciliation',
    sweptInspection:
      'one-block continuous actor collision and route-support sampling between resolved points',
    mutation: 'none',
    legacyGenerationIdentityFallback: !generation.place,
  },
  summary: summarizeRouteSamples(samples, swept),
  samples,
  swept,
};
const output =
  options.output ??
  path.join(
    repositoryRoot,
    '.behold-artifacts/place-routes',
    route.placeId,
    options.runId,
    'route-report.json',
  );
if (existsSync(output)) throw new Error(`route report exists: ${output}`);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({ output, summary: report.summary }, null, 2)}\n`);
