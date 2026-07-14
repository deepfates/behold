#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPlaceRecipe, sha256 } from './core.mjs';

export function overpassQueryForBounds(bounds) {
  const box = `${bounds.minLat},${bounds.minLon},${bounds.maxLat},${bounds.maxLon}`;
  return `[out:json][timeout:600];(nwr(${box}););out body;>;out skel qt;`;
}

export function acquisitionMatchesPlaceRequest(acquisition, recipe) {
  return (
    acquisition?.kind === 'place-osm-snapshot-acquisition' &&
    acquisition.placeId === recipe.id &&
    acquisition.query === overpassQueryForBounds(recipe.geography.bounds)
  );
}

function parse(argv) {
  const options = {
    place: null,
    output: null,
    endpoint: 'https://overpass-api.de/api/interpreter',
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--place') options.place = path.resolve(argv[++index]);
    else if (argv[index] === '--output') options.output = path.resolve(argv[++index]);
    else if (argv[index] === '--endpoint') options.endpoint = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!options.place || !options.output) throw new Error('--place and --output are required');
  return options;
}

export async function fetchSnapshot(argv) {
  const options = parse(argv);
  const manifestPath = `${options.output}.manifest.json`;
  if (existsSync(options.output) || existsSync(manifestPath))
    throw new Error(`OSM snapshot output already exists: ${options.output}`);
  const { recipe } = loadPlaceRecipe(options.place);
  const query = overpassQueryForBounds(recipe.geography.bounds);
  const response = await fetch(options.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'user-agent': 'Behold-Place-Compiler/0.1',
    },
    body: new URLSearchParams({ data: query }),
  });
  if (!response.ok) throw new Error(`Overpass request failed: ${response.status}`);
  const payload = Buffer.from(await response.arrayBuffer());
  const document = JSON.parse(payload.toString('utf8'));
  if (!Array.isArray(document.elements) || document.elements.length === 0)
    throw new Error('Overpass response contains no elements');
  const payloadSha256 = createHash('sha256').update(payload).digest('hex');
  writeFileSync(options.output, payload, { flag: 'wx' });
  const manifest = {
    schemaVersion: 1,
    kind: 'place-osm-snapshot-acquisition',
    placeId: recipe.id,
    recipePath: options.place,
    recipeSha256: await sha256(options.place),
    endpoint: options.endpoint,
    query,
    fetchedAt: new Date().toISOString(),
    osmTimestamp: document.osm3s?.timestamp_osm_base ?? null,
    generator: document.generator ?? null,
    elementCount: document.elements.length,
    payload: {
      path: options.output,
      sizeBytes: payload.length,
      sha256: payloadSha256,
    },
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await fetchSnapshot(process.argv.slice(2));
