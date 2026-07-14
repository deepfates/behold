#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaceRecipe, sha256 } from './core.mjs';
import { deriveVisitCandidate } from './visit-candidate-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const options = { rejectedDestinationIds: [] };
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key === '--recipe') options.recipe = path.resolve(process.argv[++index]);
  else if (key === '--inspection') options.inspection = path.resolve(process.argv[++index]);
  else if (key === '--run-root') options.runRoot = path.resolve(process.argv[++index]);
  else if (key === '--output') options.output = path.resolve(process.argv[++index]);
  else if (key === '--reject-destination')
    options.rejectedDestinationIds.push(process.argv[++index]);
  else throw new Error(`Unknown or incomplete argument: ${key}`);
}
for (const key of ['recipe', 'inspection', 'runRoot', 'output']) {
  if (!options[key]) throw new Error(`--${key} is required`);
  if (!options[key].startsWith(`${repositoryRoot}${path.sep}`))
    throw new Error(`${key} must remain inside the repository`);
}
if (existsSync(options.output)) throw new Error(`output exists: ${options.output}`);
const { recipe } = loadPlaceRecipe(options.recipe);
const inspection = JSON.parse(readFileSync(options.inspection, 'utf8'));
if (inspection.status !== 'completed' || inspection.placeId !== recipe.id)
  throw new Error('inspection and recipe identity do not close');
const worlds = readdirSync(path.join(options.runRoot, 'output')).filter((name) =>
  name.startsWith('Arnis World '),
);
if (worlds.length !== 1) throw new Error(`expected one generated world, found ${worlds.length}`);
const metadata = JSON.parse(
  readFileSync(path.join(options.runRoot, 'output', worlds[0], 'metadata.json'), 'utf8'),
);
const selection = deriveVisitCandidate(recipe, inspection, options);
mkdirSync(options.output, { recursive: false });

function observedWaypoint(landmark, checkpoint) {
  const point = checkpoint.representativeGround;
  return {
    name: landmark.name,
    lat:
      metadata.minGeoLat +
      (1 - (point.z - metadata.minMcZ) / (metadata.maxMcZ - metadata.minMcZ)) *
        (metadata.maxGeoLat - metadata.minGeoLat),
    lon:
      metadata.minGeoLon +
      ((point.x - metadata.minMcX) / (metadata.maxMcX - metadata.minMcX)) *
        (metadata.maxGeoLon - metadata.minGeoLon),
  };
}

const selectedPoints = [selection.arrival, selection.groundDestination].map((item) => ({
  id: item.landmark.id,
  source: { lat: item.landmark.lat, lon: item.landmark.lon },
  observed: observedWaypoint(item.landmark, item.checkpoint),
  projected: item.checkpoint.projected,
  measuredGround: item.checkpoint.representativeGround,
}));
const overrides = selectedPoints
  .filter(
    (item) =>
      item.projected.x !== item.measuredGround.x || item.projected.z !== item.measuredGround.z,
  )
  .map((item) => ({
    checkpointId: item.id,
    lat: item.observed.lat,
    lon: item.observed.lon,
    rationale:
      'Use the independently observed headroom-bearing Minecraft surface nearest the source landmark rather than aiming into its generated structure.',
  }));

const experience = {
  schemaVersion: 1,
  placeId: recipe.id,
  arrival: {
    checkpointId: selection.arrival.landmark.id,
    selectionPolicy: 'measured-natural-surface',
    acceptance: { minimumNativeTicks: 24000, maximumObserverDeaths: 0 },
  },
  ...(overrides.length ? { checkpointOverrides: overrides } : {}),
};
const routeSpec = {
  schemaVersion: 1,
  placeRecipe: path.relative(repositoryRoot, options.recipe),
  id: `${selection.arrival.landmark.id}-to-${selection.groundDestination.landmark.id}`,
  name: `${selection.arrival.landmark.name} to ${selection.groundDestination.landmark.name}`,
  mode: 'ground',
  profile: 'trekking',
  waypoints: selectedPoints.map((item) => item.observed),
};
const experiencePath = path.join(options.output, 'experience.json');
const routeSpecPath = path.join(options.output, 'ground-route.spec.json');
writeFileSync(experiencePath, `${JSON.stringify(experience, null, 2)}\n`, { flag: 'wx' });
writeFileSync(routeSpecPath, `${JSON.stringify(routeSpec, null, 2)}\n`, { flag: 'wx' });
const manifest = {
  schemaVersion: 1,
  kind: 'place-visit-candidate',
  status: 'proposed',
  placeId: recipe.id,
  policy: selection.policy,
  recipeSha256: await sha256(options.recipe),
  inspectionSha256: await sha256(options.inspection),
  arrival: {
    checkpointId: selection.arrival.landmark.id,
    measuredGround: selection.arrival.checkpoint.representativeGround,
  },
  groundDestination: {
    checkpointId: selection.groundDestination.landmark.id,
    family: selection.groundDestination.family,
    straightLineBlocks: selection.groundDestination.blocks,
  },
  reveal: {
    checkpointId: selection.reveal.landmark.id,
    family: selection.reveal.family,
    measuredGround: selection.reveal.checkpoint.representativeGround,
  },
  consideredGroundDestinations: selection.consideredGroundDestinations,
  rejectedDestinationIds: options.rejectedDestinationIds,
  measuredWaypointPolicy: 'observed-headroom-bearing-surface-v1',
  outputs: { experience: 'experience.json', routeSpec: 'ground-route.spec.json' },
};
writeFileSync(
  path.join(options.output, 'visit-candidate.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  {
    flag: 'wx',
  },
);
process.stdout.write(`${JSON.stringify({ output: options.output, manifest }, null, 2)}\n`);
