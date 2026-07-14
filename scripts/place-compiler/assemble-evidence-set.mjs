#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBenchmark } from './benchmark-core.mjs';
import { sha256, timestamp } from './core.mjs';
import { deriveEvidencePlan } from './evidence-contract.mjs';
import { verifyEvidenceSelection } from './evidence-set-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parse(argv) {
  const out = {
    benchmark: null,
    inspection: null,
    ecology: null,
    performance: null,
    setId: `evidence-set-${timestamp()}`,
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--benchmark') out.benchmark = path.resolve(argv[++index]);
    else if (key === '--inspection') out.inspection = path.resolve(argv[++index]);
    else if (key === '--ecology') out.ecology = path.resolve(argv[++index]);
    else if (key === '--performance') out.performance = path.resolve(argv[++index]);
    else if (key === '--set-id') out.setId = argv[++index];
    else if (key === '--output') out.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${key}`);
  }
  if (!out.benchmark || !out.inspection || !out.ecology || !out.performance)
    throw new Error('--benchmark and all three evidence lane roots are required');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(out.setId)) throw new Error('invalid set id');
  return out;
}

function relative(file, label) {
  const value = path.relative(repositoryRoot, file);
  if (!value || value.startsWith('..') || path.isAbsolute(value))
    throw new Error(`${label} must be inside the repository`);
  return value;
}

const options = parse(process.argv.slice(2));
const loaded = await loadBenchmark(options.benchmark, repositoryRoot);
const selection = await verifyEvidenceSelection({
  benchmark: loaded.benchmark,
  fixtures: loaded.fixtures,
  laneRoots: {
    inspection: options.inspection,
    ecology: options.ecology,
    performance: options.performance,
  },
});
const output =
  options.output ??
  path.join(
    repositoryRoot,
    '.behold-artifacts/place-benchmarks',
    loaded.benchmark.id,
    'evidence-sets',
    options.setId,
  );
if (existsSync(output)) throw new Error(`evidence set exists: ${output}`);
mkdirSync(output, { recursive: true });
const document = {
  schemaVersion: 1,
  kind: 'living-city-foundry-evidence-set',
  setId: options.setId,
  benchmark: {
    id: loaded.benchmark.id,
    path: relative(loaded.path, 'benchmark'),
    sha256: await sha256(loaded.path),
  },
  plan: deriveEvidencePlan({ benchmark: loaded.benchmark, fixtures: loaded.fixtures }),
  lanes: Object.fromEntries(
    Object.entries(selection).map(([lane, item]) => [
      lane,
      {
        root: relative(item.root, `${lane} root`),
        manifestPath: path.basename(item.manifestPath),
        manifestSha256: item.manifestSha256,
        referencedFiles: item.referencedFiles.map((file) => relative(file, `${lane} file`)),
      },
    ]),
  ),
};
const file = path.join(output, 'evidence-set.json');
writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(
  `${JSON.stringify({ file, sha256: await sha256(file), document }, null, 2)}\n`,
);
