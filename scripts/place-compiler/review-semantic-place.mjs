#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFoundryLoom } from './foundry-loom.mjs';
import { evaluateSemanticRepresentation } from './semantic-place-core.mjs';

function parse(argv) {
  const options = { root: null, attempt: null, semanticId: 'semantic-v1' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') options.root = path.resolve(argv[++index]);
    else if (argv[index] === '--attempt') options.attempt = argv[++index];
    else if (argv[index] === '--semantic-id') options.semanticId = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!options.root || !options.attempt) throw new Error('--root and --attempt are required');
  return options;
}

const hashBytes = (value) => createHash('sha256').update(value).digest('hex');

export async function reviewSemanticPlace(argv) {
  const options = parse(argv);
  const semanticRoot = path.join(options.root, 'attempts', options.attempt, options.semanticId);
  const selectionPath = path.join(semanticRoot, 'semantic-selection.json');
  const recipePath = path.join(semanticRoot, 'draft-place-recipe.json');
  const judgmentPath = path.join(semanticRoot, 'semantic-judgment.json');
  if (!existsSync(selectionPath) || !existsSync(recipePath))
    throw new Error(`semantic proposal is incomplete: ${semanticRoot}`);
  if (existsSync(judgmentPath)) throw new Error(`semantic judgment exists: ${judgmentPath}`);
  const selection = JSON.parse(readFileSync(selectionPath, 'utf8'));
  const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
  const evaluation = evaluateSemanticRepresentation(selection, 8);
  const judgment = {
    schemaVersion: 1,
    kind: 'earth-to-living-world-semantic-judgment',
    ...evaluation,
    proposal: {
      path: path.relative(options.root, selectionPath),
      sha256: hashBytes(readFileSync(selectionPath)),
    },
    recipe: {
      path: path.relative(options.root, recipePath),
      sha256: hashBytes(readFileSync(recipePath)),
    },
    authority:
      'representation-quality judgment only; accepted representations remain physically unverified until Minecraft observation',
  };
  writeFileSync(judgmentPath, `${JSON.stringify(judgment, null, 2)}\n`, { flag: 'wx' });
  const history = await openFoundryLoom(options.root);
  await history.append(
    {
      kind: `semantic/place-interpretation-${evaluation.status}`,
      judgment: {
        path: path.relative(options.root, judgmentPath),
        sha256: hashBytes(readFileSync(judgmentPath)),
      },
      checks: evaluation.checks,
      correction:
        evaluation.status === 'rejected'
          ? 'The semantic proposal is retained but is not the active representation.'
          : null,
    },
    { stage: 'semantic-interpretation', status: evaluation.status },
  );
  if (evaluation.status === 'accepted')
    await history.append(
      {
        kind: 'place-representation/selected',
        policy: 'ax-grounded-place-interpretation-v1',
        recipePath: path.relative(options.root, recipePath),
        recipeSha256: hashBytes(readFileSync(recipePath)),
        recipe,
        physicalStatus: 'unverified-until-generation-and-minecraft-observation',
      },
      { stage: 'semantic-interpretation', status: 'selected' },
    );
  const diagnostics = await history.diagnostics();
  const result = {
    status: evaluation.status,
    judgmentPath,
    history: { protocol: history.protocol, loomId: history.loomId, tipTurnId: history.tipTurnId },
  };
  history.close();
  if (diagnostics.conflicts || diagnostics.pending || diagnostics.garbage)
    throw new Error(`world compilation history is unhealthy: ${JSON.stringify(diagnostics)}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await reviewSemanticPlace(process.argv.slice(2));
