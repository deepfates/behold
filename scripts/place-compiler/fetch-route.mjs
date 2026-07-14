#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaceRecipe, sha256 } from './core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parse(argv) {
  const out = { spec: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--spec') out.spec = path.resolve(argv[++index]);
    else if (argv[index] === '--output') out.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!out.spec) throw new Error('--spec is required');
  return out;
}

const options = parse(process.argv.slice(2));
const route = JSON.parse(readFileSync(options.spec, 'utf8'));
if (
  route.schemaVersion !== 1 ||
  route.mode !== 'ground' ||
  !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route.id ?? '') ||
  !Array.isArray(route.waypoints) ||
  route.waypoints.length < 2
)
  throw new Error('invalid route spec');
const recipePath = path.resolve(repositoryRoot, route.placeRecipe);
if (!recipePath.startsWith(`${repositoryRoot}${path.sep}`))
  throw new Error('route place recipe escapes repository');
const loaded = loadPlaceRecipe(recipePath);
const bounds = loaded.recipe.geography.bounds;
if (
  route.waypoints.some(
    (waypoint) =>
      typeof waypoint.name !== 'string' ||
      !Number.isFinite(waypoint.lat) ||
      !Number.isFinite(waypoint.lon) ||
      waypoint.lat < bounds.minLat ||
      waypoint.lat > bounds.maxLat ||
      waypoint.lon < bounds.minLon ||
      waypoint.lon > bounds.maxLon,
  )
)
  throw new Error('route waypoint is invalid or outside place bounds');
const request = new URL('https://brouter.de/brouter');
request.searchParams.set(
  'lonlats',
  route.waypoints.map((waypoint) => `${waypoint.lon},${waypoint.lat}`).join('|'),
);
request.searchParams.set('profile', route.profile);
request.searchParams.set('alternativeidx', '0');
request.searchParams.set('format', 'geojson');
const response = await fetch(request);
if (!response.ok) throw new Error(`BRouter returned ${response.status} ${response.statusText}`);
const body = await response.text();
const geojson = JSON.parse(body);
const feature = geojson.features?.[0];
if (feature?.geometry?.type !== 'LineString' || feature.geometry.coordinates.length < 2)
  throw new Error('BRouter returned no LineString route');
if (
  feature.geometry.coordinates.some(
    ([longitude, latitude]) =>
      latitude < bounds.minLat ||
      latitude > bounds.maxLat ||
      longitude < bounds.minLon ||
      longitude > bounds.maxLon,
  )
)
  throw new Error('BRouter route leaves the generated place bounds');
const document = {
  schemaVersion: 1,
  kind: 'place-ground-route',
  placeId: loaded.recipe.id,
  routeId: route.id,
  name: route.name,
  specPath: path.relative(repositoryRoot, options.spec),
  specSha256: await sha256(options.spec),
  recipePath: path.relative(repositoryRoot, loaded.path),
  recipeSha256: await sha256(loaded.path),
  source: {
    engine: 'BRouter',
    service: 'https://brouter.de/brouter',
    profile: route.profile,
    responseSha256: sha256Text(body),
  },
  waypoints: route.waypoints,
  properties: {
    trackLengthMeters: feature.properties?.['track-length'] ?? null,
    ascentMeters: feature.properties?.['filtered ascend'] ?? null,
    descentMeters: feature.properties?.['filtered descend'] ?? null,
  },
  geometry: { type: 'LineString', coordinates: feature.geometry.coordinates },
};
const output =
  options.output ??
  path.join(repositoryRoot, 'docs/place-compiler/routes', `${loaded.recipe.id}-${route.id}.json`);
if (existsSync(output)) throw new Error(`route output exists: ${output}`);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(
  `${JSON.stringify({ output, points: document.geometry.coordinates.length }, null, 2)}\n`,
);

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}
