#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { overpassQueryForBounds } from './fetch-osm-snapshot.mjs';
import { openFoundryLoom } from './foundry-loom.mjs';
import {
  deriveLandmarkCandidates,
  draftRecipe,
  selectRepresentativeLandmarks,
  sourceProfile,
  spawnCandidates,
} from './bootstrap-core.mjs';
import { sha256, validatePlaceRecipe } from './core.mjs';
import { sha256Value } from './world-intent-core.mjs';

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'Behold-Earth-to-Living-World/0.1 (+https://github.com/deepfates/behold)';
const hashBytes = (value) => createHash('sha256').update(value).digest('hex');

function parse(argv) {
  const options = {
    root: null,
    endpoint: DEFAULT_ENDPOINT,
    attempt: 'bootstrap-v1',
    revisionEvidence: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') options.root = path.resolve(argv[++index]);
    else if (argv[index] === '--endpoint') options.endpoint = argv[++index];
    else if (argv[index] === '--attempt') options.attempt = argv[++index];
    else if (argv[index] === '--revision-evidence') options.revisionEvidence = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!options.root) throw new Error('--root is required');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.attempt)) throw new Error('invalid attempt id');
  return options;
}

export async function bootstrapPlace(argv, dependencies = {}) {
  const options = parse(argv);
  const seedPath = path.join(options.root, 'place-seed.json');
  if (!existsSync(seedPath)) throw new Error(`place seed missing: ${seedPath}`);
  const output = path.join(options.root, 'attempts', options.attempt);
  if (existsSync(output)) throw new Error(`bootstrap output exists: ${output}`);
  mkdirSync(output, { recursive: true });
  const sources = path.join(options.root, 'sources');
  mkdirSync(sources, { recursive: true });
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  const history = await openFoundryLoom(options.root);
  const startedAt = new Date();
  const query = overpassQueryForBounds(seed.geography.bounds);
  const requestRecord = {
    method: 'POST',
    endpoint: options.endpoint,
    query,
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'user-agent': USER_AGENT,
    },
  };
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const osmPath = path.join(sources, 'osm-overpass.json');
  let payload;
  let sourceMode;
  try {
    if (existsSync(osmPath)) {
      payload = readFileSync(osmPath);
      sourceMode = 'frozen-reuse';
    } else {
      const response = await fetcher(options.endpoint, {
        method: 'POST',
        headers: requestRecord.headers,
        body: new URLSearchParams({ data: query }),
      });
      if (!response.ok) throw new Error(`OSM acquisition failed: HTTP ${response.status}`);
      payload = Buffer.from(await response.arrayBuffer());
      writeFileSync(osmPath, payload, { flag: 'wx' });
      sourceMode = 'network-acquisition';
    }
  } catch (error) {
    await history.append(
      {
        kind: 'stage/failed',
        stage: 'source-acquisition',
        error: error instanceof Error ? error.message : String(error),
        request: requestRecord,
      },
      { stage: 'source-acquisition', status: 'failed' },
    );
    history.close();
    throw error;
  }
  const document = JSON.parse(payload.toString('utf8'));
  if (!Array.isArray(document.elements) || !document.elements.length)
    throw new Error('OSM acquisition returned no elements');
  const osmSha256 = hashBytes(payload);
  const profile = sourceProfile(document, seed.geography.derivation.areaKm2);
  const candidates = deriveLandmarkCandidates(document, seed.geography.bounds);
  const spawns = spawnCandidates(candidates, seed.resolution.selected.center);
  const landmarks = selectRepresentativeLandmarks(
    candidates,
    seed.intent,
    8,
    spawns.length ? [spawns[0]] : [],
  );
  const recipe = validatePlaceRecipe(draftRecipe(seed, landmarks, spawns), '<autonomous draft>');
  const profilePath = path.join(output, 'source-profile.json');
  const candidatePath = path.join(output, 'landmark-candidates.json');
  const spawnPath = path.join(output, 'spawn-candidates.json');
  const recipePath = path.join(output, 'draft-place-recipe.json');
  writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(
    candidatePath,
    `${JSON.stringify({ candidates, selected: landmarks }, null, 2)}\n`,
    { flag: 'wx' },
  );
  writeFileSync(spawnPath, `${JSON.stringify(spawns, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`, { flag: 'wx' });
  const generationInputPath = path.join(output, 'frozen-osm.json');
  copyFileSync(osmPath, generationInputPath, constants.COPYFILE_FICLONE);
  if ((await sha256(generationInputPath)) !== osmSha256)
    throw new Error('Bootstrap: generation input clone digest mismatch');
  const acquisitionPath = `${generationInputPath}.manifest.json`;
  const acquisition = {
    schemaVersion: 1,
    kind: 'place-osm-snapshot-acquisition',
    placeId: recipe.id,
    recipePath,
    recipeSha256: await sha256(recipePath),
    endpoint: options.endpoint,
    query,
    fetchedAt: document.osm3s?.timestamp_osm_base ?? startedAt.toISOString(),
    osmTimestamp: document.osm3s?.timestamp_osm_base ?? null,
    generator: document.generator ?? null,
    elementCount: document.elements.length,
    payload: {
      path: generationInputPath,
      sizeBytes: payload.length,
      sha256: osmSha256,
    },
    provenance: {
      mode: sourceMode,
      sharedSourcePath: path.relative(options.root, osmPath),
      placeSeedId: seed.seedId,
      attemptId: options.attempt,
    },
  };
  writeFileSync(acquisitionPath, `${JSON.stringify(acquisition, null, 2)}\n`, { flag: 'wx' });
  await history.append(
    {
      kind: sourceMode === 'frozen-reuse' ? 'source/osm-reused' : 'source/osm-frozen',
      evidence: {
        path: path.relative(options.root, osmPath),
        sizeBytes: payload.length,
        sha256: osmSha256,
      },
      request: { ...requestRecord, sha256: sha256Value(requestRecord) },
      generationInput: {
        path: path.relative(options.root, generationInputPath),
        acquisitionPath: path.relative(options.root, acquisitionPath),
      },
      profile,
    },
    { stage: 'source-acquisition', status: 'completed' },
  );
  if (options.revisionEvidence)
    await history.append(
      {
        kind: 'compiler/revision-applied',
        scope: 'shared-bootstrap-policy',
        policy: 'intent-aware-category-diversity-v2',
        priorEvidence: options.revisionEvidence,
        diagnosis:
          'Top-score-only landmark selection collapsed representation into one category and filtered spawn candidates too early.',
        repair:
          'Select across intent-relevant category families and rank spawn candidates independently over the full source candidate set.',
      },
      { stage: 'bootstrap', status: 'revision' },
    );
  await history.append(
    {
      kind: 'place-representation/proposed',
      attemptId: options.attempt,
      evidence: {
        candidatesPath: path.relative(options.root, candidatePath),
        spawnPath: path.relative(options.root, spawnPath),
        recipePath: path.relative(options.root, recipePath),
      },
      counts: {
        candidates: candidates.length,
        selectedLandmarks: landmarks.length,
        spawnCandidates: spawns.length,
      },
      recipe,
      authority:
        'deterministic source-derived draft; Minecraft observation must accept or revise it',
      selectionPolicy: 'intent-aware-category-diversity-v2',
      semanticCalls: 0,
    },
    { stage: 'bootstrap', status: 'proposed' },
  );
  const completedAt = new Date();
  const manifest = {
    schemaVersion: 1,
    kind: 'earth-to-living-world-bootstrap',
    status: 'completed',
    seedId: seed.seedId,
    attemptId: options.attempt,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt - startedAt,
    source: {
      mode: sourceMode,
      path: path.relative(options.root, osmPath),
      sizeBytes: statSync(osmPath).size,
      sha256: osmSha256,
      requestSha256: sha256Value(requestRecord),
    },
    outputs: {
      sourceProfile: 'source-profile.json',
      landmarkCandidates: 'landmark-candidates.json',
      spawnCandidates: 'spawn-candidates.json',
      draftRecipe: 'draft-place-recipe.json',
      generationInput: 'frozen-osm.json',
      acquisitionManifest: 'frozen-osm.json.manifest.json',
      recipeSha256: await sha256(recipePath),
    },
    costs: { overpassRequests: sourceMode === 'network-acquisition' ? 1 : 0, semanticCalls: 0 },
    history: { protocol: history.protocol, loomId: history.loomId, tipTurnId: history.tipTurnId },
  };
  writeFileSync(
    path.join(output, 'bootstrap-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  );
  appendFileSync(
    path.join(options.root, 'progress.jsonl'),
    `${JSON.stringify({ at: completedAt.toISOString(), stage: 'bootstrap', status: 'completed', seedId: seed.seedId, landmarkCount: landmarks.length })}\n`,
  );
  const diagnostics = await history.diagnostics();
  history.close();
  if (diagnostics.conflicts || diagnostics.pending || diagnostics.garbage)
    throw new Error(`world compilation history is unhealthy: ${JSON.stringify(diagnostics)}`);
  process.stdout.write(
    `${JSON.stringify({ manifest, profile, landmarks, spawns, recipe }, null, 2)}\n`,
  );
  return { manifest, profile, landmarks, spawns, recipe };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await bootstrapPlace(process.argv.slice(2));
