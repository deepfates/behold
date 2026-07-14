#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPlaceSeed, sha256Value, validateWorldIntent } from './world-intent-core.mjs';
import { createFoundryLoom } from './foundry-loom.mjs';

const DEFAULT_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Behold-Earth-to-Living-World/0.1 (+https://github.com/deepfates/behold)';

function parse(argv) {
  const options = { intent: null, output: null, endpoint: DEFAULT_ENDPOINT };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--intent') options.intent = path.resolve(argv[++index]);
    else if (argv[index] === '--output') options.output = path.resolve(argv[++index]);
    else if (argv[index] === '--endpoint') options.endpoint = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!options.intent || !options.output) throw new Error('--intent and --output are required');
  return options;
}

const hashBytes = (value) => createHash('sha256').update(value).digest('hex');

export function resolverRequest(endpoint, intent) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries({
    q: intent.query,
    format: 'jsonv2',
    limit: '5',
    addressdetails: '1',
    extratags: '1',
    namedetails: '1',
    polygon_geojson: '1',
    polygon_threshold: '0.001',
  }))
    url.searchParams.set(key, value);
  return url;
}

export async function resolvePlace(argv, dependencies = {}) {
  const options = parse(argv);
  if (existsSync(options.output)) throw new Error(`resolution output exists: ${options.output}`);
  const intent = validateWorldIntent(
    JSON.parse(readFileSync(options.intent, 'utf8')),
    options.intent,
  );
  mkdirSync(path.dirname(options.output), { recursive: true });
  mkdirSync(options.output, { recursive: false });
  const history = await createFoundryLoom(options.output, {
    intentId: intent.id,
    intentSha256: sha256Value(intent),
  });
  await history.append(
    {
      kind: 'world-intent/accepted',
      intent,
      evidence: { path: options.intent, sha256: sha256Value(intent) },
    },
    { stage: 'intent', status: 'accepted' },
  );
  const request = resolverRequest(options.endpoint, intent);
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now();
  let response;
  let payload;
  try {
    response = await fetcher(request, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`place resolution failed: HTTP ${response.status}`);
    payload = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    await history.append(
      {
        kind: 'stage/failed',
        stage: 'resolution',
        error: error instanceof Error ? error.message : String(error),
        request: request.toString(),
      },
      { stage: 'resolution', status: 'failed' },
    );
    history.close();
    throw error;
  }
  const candidates = JSON.parse(payload.toString('utf8'));
  const completedAt = now();
  const responseSha256 = hashBytes(payload);
  const requestRecord = {
    method: 'GET',
    url: request.toString(),
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  };
  const rawRelative = 'resolution-response.json';
  const seed = buildPlaceSeed(intent, candidates, {
    resolver: { name: 'Nominatim', endpoint: options.endpoint, format: 'jsonv2' },
    requestSha256: sha256Value(requestRecord),
    responseSha256,
    responsePath: rawRelative,
  });
  const resolutionTurn = await history.append(
    {
      kind: 'place-resolution/observed',
      request: requestRecord,
      response: { path: rawRelative, sizeBytes: payload.length, sha256: responseSha256 },
      selection: seed.resolution,
      geography: seed.geography,
      costs: { resolverRequests: 1, semanticCalls: 0 },
    },
    { stage: 'resolution', status: 'completed' },
  );
  seed.compilationHistory = {
    protocol: history.protocol,
    loomId: history.loomId,
    tipTurnId: resolutionTurn.id,
    manifestPath: 'history/manifest.json',
    lyncPath: path.relative(options.output, history.file),
  };
  const manifest = {
    schemaVersion: 1,
    kind: 'earth-to-living-world-resolution',
    status: 'completed',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    intentPath: options.intent,
    intentSha256: sha256Value(intent),
    request: requestRecord,
    requestSha256: sha256Value(requestRecord),
    response: { path: rawRelative, sizeBytes: payload.length, sha256: responseSha256 },
    selected: {
      displayName: seed.resolution.selected.displayName,
      osm: seed.resolution.selected.osm,
      candidateCount: seed.resolution.candidates.length,
    },
    costs: { resolverRequests: 1, semanticCalls: 0 },
    output: { path: 'place-seed.json', seedId: seed.seedId },
  };
  writeFileSync(path.join(options.output, rawRelative), payload, { flag: 'wx' });
  writeFileSync(
    path.join(options.output, 'place-seed.json'),
    `${JSON.stringify(seed, null, 2)}\n`,
    {
      flag: 'wx',
    },
  );
  writeFileSync(
    path.join(options.output, 'resolution-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  );
  const diagnostics = await history.diagnostics();
  if (diagnostics.conflicts || diagnostics.pending || diagnostics.garbage)
    throw new Error(`world compilation history is unhealthy: ${JSON.stringify(diagnostics)}`);
  history.close();
  writeFileSync(
    path.join(options.output, 'progress.jsonl'),
    `${JSON.stringify({ at: completedAt.toISOString(), stage: 'resolution', status: 'completed', seedId: seed.seedId })}\n`,
    { flag: 'wx' },
  );
  process.stdout.write(`${JSON.stringify({ manifest, seed }, null, 2)}\n`);
  return { manifest, seed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await resolvePlace(process.argv.slice(2));
