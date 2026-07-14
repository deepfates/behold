#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ai, ax } from '@ax-llm/ax';
import { draftRecipe } from './bootstrap-core.mjs';
import { openFoundryLoom } from './foundry-loom.mjs';
import {
  materializeSemanticSelection,
  semanticFinalists,
  validateSemanticSelection,
} from './semantic-place-core.mjs';
import { sha256Value } from './world-intent-core.mjs';

const AX_VERSION = '23.0.0';
const SIGNATURE_VERSION = 'place-interpretation-v1';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

function parse(argv) {
  const options = { root: null, attempt: null, outputId: 'semantic-v1', model: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') options.root = path.resolve(argv[++index]);
    else if (argv[index] === '--attempt') options.attempt = argv[++index];
    else if (argv[index] === '--output-id') options.outputId = argv[++index];
    else if (argv[index] === '--model') options.model = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!options.root || !options.attempt) throw new Error('--root and --attempt are required');
  options.model ||= process.env.FOUNDRY_MODEL || process.env.LLM_MODEL;
  if (!options.model) throw new Error('FOUNDRY_MODEL or LLM_MODEL is required');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.outputId)) throw new Error('invalid output id');
  return options;
}

const hashBytes = (value) => createHash('sha256').update(value).digest('hex');

export async function interpretPlace(argv) {
  const options = parse(argv);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for semantic interpretation');
  const attemptRoot = path.join(options.root, 'attempts', options.attempt);
  const output = path.join(attemptRoot, options.outputId);
  if (existsSync(output)) throw new Error(`semantic output exists: ${output}`);
  mkdirSync(output);
  const seed = JSON.parse(readFileSync(path.join(options.root, 'place-seed.json'), 'utf8'));
  const candidatesDocument = JSON.parse(
    readFileSync(path.join(attemptRoot, 'landmark-candidates.json'), 'utf8'),
  );
  const arrivals = JSON.parse(
    readFileSync(path.join(attemptRoot, 'spawn-candidates.json'), 'utf8'),
  );
  const finalists = semanticFinalists(candidatesDocument.candidates);
  const input = {
    intent: {
      query: seed.intent.query,
      purpose: seed.intent.purpose,
      creativeDirection: seed.intent.creativeDirection,
      requiredQualities: seed.intent.requiredQualities,
    },
    resolvedPlace: {
      name: seed.resolution.selected.name,
      displayName: seed.resolution.selected.displayName,
      center: seed.resolution.selected.center,
    },
    landmarkCandidates: finalists,
    arrivalCandidates: arrivals.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      lat: item.lat,
      lon: item.lon,
      spawnScore: item.spawnScore,
    })),
    requiredLandmarkCount: 8,
  };
  const allowedLandmarks = new Set(finalists.map((item) => item.id));
  const allowedArrivals = new Set(arrivals.map((item) => item.id));
  const program = ax(`
    "Interpret a real place from bounded sourced candidates. Select exactly eight landmarks that jointly express the user's intent and the place's recognizable civic, cultural, landscape, movement, and everyday character. Prefer the defining institution or feature over merely well-tagged minor examples. Select one to three plausible arrival candidates. Use only supplied ids; never invent facts, names, ids, or coordinates. These are semantic proposals only: Minecraft will verify physical safety and visibility."
    intent:json,
    resolvedPlace:json,
    landmarkCandidates:json,
    arrivalCandidates:json,
    requiredLandmarkCount:number
    ->
    selectedIds:string[],
    arrivalCandidateIds:string[],
    placeCharacter:string,
    rationale:string
  `);
  program.addAssert((outputValue) => {
    if (!Array.isArray(outputValue?.selectedIds) || outputValue.selectedIds.length !== 8)
      return 'selectedIds must contain exactly eight ids.';
    if (new Set(outputValue.selectedIds).size !== 8) return 'selectedIds must be unique.';
    if (outputValue.selectedIds.some((id) => !allowedLandmarks.has(id)))
      return 'Every selectedIds value must exactly match a supplied landmark candidate id.';
    if (
      !Array.isArray(outputValue?.arrivalCandidateIds) ||
      outputValue.arrivalCandidateIds.length < 1 ||
      outputValue.arrivalCandidateIds.length > 3 ||
      outputValue.arrivalCandidateIds.some((id) => !allowedArrivals.has(id))
    )
      return 'arrivalCandidateIds must contain one to three supplied arrival candidate ids.';
    return true;
  });
  const llm = ai({
    name: 'openai',
    apiKey,
    apiURL: OPENROUTER_URL,
    config: { model: options.model },
    options: { stream: false },
  });
  const startedAt = new Date();
  program.resetUsage();
  const raw = await program.forward(llm, input, {
    stream: false,
    maxRetries: 2,
    modelConfig: { temperature: 0.1 },
    excludeContentFromTrace: true,
  });
  const completedAt = new Date();
  const validated = validateSemanticSelection(raw, finalists, arrivals, 8);
  const materialized = materializeSemanticSelection(
    validated,
    candidatesDocument.candidates,
    arrivals,
  );
  const recipe = draftRecipe(seed, materialized.selected, materialized.arrivals);
  recipe.provenance = {
    ...recipe.provenance,
    kind: 'autonomous-semantic-draft',
    semanticPolicy: SIGNATURE_VERSION,
  };
  const call = {
    schemaVersion: 1,
    kind: 'earth-to-living-world-semantic-call',
    status: 'completed',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt - startedAt,
    adapter: { name: 'ax', version: AX_VERSION, signatureVersion: SIGNATURE_VERSION },
    provider: { protocol: 'OpenAI-compatible', endpoint: OPENROUTER_URL, model: options.model },
    request: { sha256: sha256Value(input), candidateCount: finalists.length, input },
    response: { output: validated, usage: program.getUsage() },
  };
  const callPath = path.join(output, 'semantic-call.json');
  const selectionPath = path.join(output, 'semantic-selection.json');
  const recipePath = path.join(output, 'draft-place-recipe.json');
  writeFileSync(callPath, `${JSON.stringify(call, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(
    selectionPath,
    `${JSON.stringify({ ...validated, selected: materialized.selected, arrivals: materialized.arrivals }, null, 2)}\n`,
    { flag: 'wx' },
  );
  writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`, { flag: 'wx' });
  const callSha256 = hashBytes(readFileSync(callPath));
  const history = await openFoundryLoom(options.root);
  await history.append(
    {
      kind: 'semantic/place-interpretation-proposed',
      call: { path: path.relative(options.root, callPath), sha256: callSha256 },
      selection: validated,
      authority: 'bounded semantic proposal over frozen candidates; no physical claim',
    },
    { stage: 'semantic-interpretation', status: 'proposed' },
  );
  const diagnostics = await history.diagnostics();
  const result = {
    schemaVersion: 1,
    kind: 'earth-to-living-world-semantic-selection',
    status: 'proposed',
    model: options.model,
    call: { path: 'semantic-call.json', sha256: callSha256 },
    selection: { path: 'semantic-selection.json', selectedCount: 8 },
    recipe: { path: 'draft-place-recipe.json', sha256: sha256Value(recipe) },
    authority: 'proposal-only; requires representation review and later Minecraft verification',
    history: { protocol: history.protocol, loomId: history.loomId, tipTurnId: history.tipTurnId },
  };
  writeFileSync(
    path.join(output, 'semantic-manifest.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    {
      flag: 'wx',
    },
  );
  history.close();
  if (diagnostics.conflicts || diagnostics.pending || diagnostics.garbage)
    throw new Error(`world compilation history is unhealthy: ${JSON.stringify(diagnostics)}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await interpretPlace(process.argv.slice(2));
