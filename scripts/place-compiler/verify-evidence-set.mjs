#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBenchmark } from './benchmark-core.mjs';
import { sha256 } from './core.mjs';
import { deriveEvidencePlan } from './evidence-contract.mjs';
import { verifyEvidenceSelection } from './evidence-set-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = path.resolve(process.argv[2] ?? 'evidence-set.json');
if (!existsSync(file)) throw new Error(`evidence set is missing: ${file}`);
const document = JSON.parse(readFileSync(file, 'utf8'));
if (
  document.schemaVersion !== 1 ||
  document.kind !== 'living-city-foundry-evidence-set' ||
  !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(document.setId ?? '')
)
  throw new Error('unsupported evidence set');

function repositoryPath(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value))
    throw new Error(`${label} must be repository-relative`);
  const resolved = path.resolve(repositoryRoot, value);
  if (!resolved.startsWith(`${repositoryRoot}${path.sep}`))
    throw new Error(`${label} escapes repository`);
  return resolved;
}

const benchmarkPath = repositoryPath(document.benchmark.path, 'benchmark.path');
if ((await sha256(benchmarkPath)) !== document.benchmark.sha256)
  throw new Error('benchmark digest mismatch');
const loaded = await loadBenchmark(benchmarkPath, repositoryRoot);
if (loaded.benchmark.id !== document.benchmark.id) throw new Error('benchmark identity mismatch');
const expectedPlan = deriveEvidencePlan({ benchmark: loaded.benchmark, fixtures: loaded.fixtures });
if (JSON.stringify(document.plan) !== JSON.stringify(expectedPlan))
  throw new Error('evidence plan mismatch');
const laneRoots = Object.fromEntries(
  ['inspection', 'ecology', 'performance'].map((lane) => {
    if (!document.lanes?.[lane]) throw new Error(`evidence set missing ${lane} lane`);
    return [lane, repositoryPath(document.lanes[lane].root, `${lane}.root`)];
  }),
);
const verified = await verifyEvidenceSelection({
  benchmark: loaded.benchmark,
  fixtures: loaded.fixtures,
  laneRoots,
});
for (const [lane, result] of Object.entries(verified)) {
  const selected = document.lanes[lane];
  if (
    path.basename(result.manifestPath) !== selected.manifestPath ||
    result.manifestSha256 !== selected.manifestSha256
  )
    throw new Error(`${lane} manifest selection mismatch`);
  const files = result.referencedFiles.map((item) => path.relative(repositoryRoot, item));
  if (JSON.stringify(files) !== JSON.stringify(selected.referencedFiles))
    throw new Error(`${lane} referenced-file closure mismatch`);
}
process.stdout.write(
  `evidence set ${document.setId} (${document.benchmark.id}): VERIFIED; ${document.plan.places.length} places, ${document.plan.expectedCaseCount} cases\n`,
);
