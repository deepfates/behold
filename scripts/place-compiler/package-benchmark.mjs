#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, timestamp } from './core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const epoch = new Date(0);

function parse(argv) {
  const out = {
    benchmark: path.join(repositoryRoot, 'docs/place-compiler/benchmarks/living-places-v1.json'),
    findings: path.join(
      repositoryRoot,
      'docs/place-compiler/benchmarks/living-places-v1-findings.json',
    ),
    inspection: path.join(
      repositoryRoot,
      '.behold-artifacts/place-benchmarks/living-places-v1/inspection-two-place-v7',
    ),
    ecology: path.join(
      repositoryRoot,
      '.behold-artifacts/place-benchmarks/living-places-v1/ecology-two-place-v2',
    ),
    performance: path.join(
      repositoryRoot,
      '.behold-artifacts/place-benchmarks/living-places-v1/performance-two-place-v1',
    ),
    releaseId: `living-places-v1-${timestamp()}`,
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--benchmark') out.benchmark = path.resolve(argv[++index]);
    else if (argv[index] === '--findings') out.findings = path.resolve(argv[++index]);
    else if (argv[index] === '--inspection') out.inspection = path.resolve(argv[++index]);
    else if (argv[index] === '--ecology') out.ecology = path.resolve(argv[++index]);
    else if (argv[index] === '--performance') out.performance = path.resolve(argv[++index]);
    else if (argv[index] === '--release-id') out.releaseId = argv[++index];
    else if (argv[index] === '--output') out.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(out.releaseId)) throw new Error('invalid release id');
  return out;
}

const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

function copy(source, destination) {
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  utimesSync(destination, epoch, epoch);
}

function copyTree(source, destination, accept = () => true) {
  const status = statSync(source);
  if (status.isFile()) {
    if (accept(source)) copy(source, destination);
    return;
  }
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source).sort())
    copyTree(path.join(source, name), path.join(destination, name), accept);
  utimesSync(destination, epoch, epoch);
}

function normalizeTimes(root) {
  if (statSync(root).isDirectory())
    for (const name of readdirSync(root).sort()) normalizeTimes(path.join(root, name));
  utimesSync(root, epoch, epoch);
}

async function archive(stage, destination) {
  normalizeTimes(stage);
  const result = spawnSync(
    'tar',
    [
      '--format',
      'ustar',
      '--options',
      'gzip:compression-level=6,gzip:!timestamp',
      '--no-xattrs',
      '--uid',
      '0',
      '--gid',
      '0',
      '--uname',
      'root',
      '--gname',
      'root',
      '-czf',
      destination,
      '-C',
      stage,
      '.',
    ],
    { encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' } },
  );
  if (result.status !== 0) throw new Error(`archive failed: ${result.stderr}`);
  return { sizeBytes: statSync(destination).size, sha256: await sha256(destination) };
}

function assertManifest(source, filename, kind, benchmarkId, expectedCount) {
  const file = path.join(source, filename);
  if (!existsSync(file)) throw new Error(`missing ${filename}`);
  const manifest = json(file);
  if (
    manifest.status !== 'completed' ||
    manifest.kind !== kind ||
    manifest.benchmarkId !== benchmarkId
  )
    throw new Error(`invalid ${filename}`);
  const count = manifest.results?.length ?? manifest.cases?.length ?? 0;
  if (count !== expectedCount)
    throw new Error(`${filename} expected ${expectedCount}, found ${count}`);
  return { file, manifest };
}

const options = parse(process.argv.slice(2));
const benchmark = json(options.benchmark);
const findings = json(options.findings);
if (
  benchmark.id !== findings.benchmarkId ||
  (await sha256(options.benchmark)) !== findings.benchmarkSha256
)
  throw new Error('benchmark/findings identity mismatch');
const inspection = assertManifest(
  options.inspection,
  'inspection-manifest.json',
  'living-places-inspection',
  benchmark.id,
  2,
);
const ecology = assertManifest(
  options.ecology,
  'ecology-manifest.json',
  'living-places-ecology-soak',
  benchmark.id,
  2,
);
const performance = assertManifest(
  options.performance,
  'performance-manifest.json',
  'living-places-performance-sweep',
  benchmark.id,
  12,
);
if (
  (await sha256(inspection.file)) !== findings.canonicalRuns.inspection.manifestSha256 ||
  (await sha256(ecology.file)) !== findings.canonicalRuns.ecology.manifestSha256 ||
  (await sha256(performance.file)) !== findings.canonicalRuns.performance.manifestSha256
)
  throw new Error('canonical evidence digest mismatch');

const output =
  options.output ??
  path.join(
    repositoryRoot,
    '.behold-artifacts/place-benchmarks',
    benchmark.id,
    'releases',
    options.releaseId,
  );
if (existsSync(output)) throw new Error(`release exists: ${output}`);
mkdirSync(output, { recursive: true });
const stageRoot = path.join(output, '.stage');
mkdirSync(stageRoot);
const archives = [];
try {
  const contractStage = path.join(stageRoot, 'contract');
  for (const relative of [
    'docs/place-compiler/README.md',
    'docs/place-compiler/benchmark-v1.schema.json',
    'docs/place-compiler/benchmarks/living-places-v1.json',
    'docs/place-compiler/benchmarks/living-places-v1-findings.json',
    'docs/place-compiler/reports/2026-07-13-living-places-benchmark-v1.md',
    'docs/place-compiler/runtime-profiles.json',
    'docs/place-compiler/places/san-francisco.json',
    'docs/place-compiler/places/lower-manhattan.json',
    'docs/sf-world/tool-lock.json',
  ])
    copy(path.join(repositoryRoot, relative), path.join(contractStage, relative));
  copyTree(
    path.join(repositoryRoot, 'scripts/place-compiler'),
    path.join(contractStage, 'scripts/place-compiler'),
    (file) => file.endsWith('.mjs'),
  );
  for (const name of readdirSync(path.join(repositoryRoot, 'tests')).filter((name) =>
    /^(living-places|place-(inspection|ecology|performance))/.test(name),
  ))
    copy(path.join(repositoryRoot, 'tests', name), path.join(contractStage, 'tests', name));

  const evidencePlans = [
    {
      role: 'inspection-evidence',
      source: options.inspection,
      manifest: 'inspection-manifest.json',
      directory: 'inspections',
      accept: (file) => /\.(json|log|png|svg)$/.test(file),
    },
    {
      role: 'ecology-evidence',
      source: options.ecology,
      manifest: 'ecology-manifest.json',
      directory: 'soaks',
      accept: (file) => /\.(json|log)$/.test(file),
    },
    {
      role: 'performance-evidence',
      source: options.performance,
      manifest: 'performance-manifest.json',
      directory: 'cases',
      accept: (file) => /\.(json|log)$/.test(file),
    },
  ];
  const plans = [
    { role: 'contract-and-reproduction', stage: contractStage },
    ...evidencePlans.map((plan) => {
      const stage = path.join(stageRoot, plan.role);
      copy(path.join(plan.source, plan.manifest), path.join(stage, plan.manifest));
      copyTree(
        path.join(plan.source, plan.directory),
        path.join(stage, plan.directory),
        plan.accept,
      );
      return { role: plan.role, stage };
    }),
  ];
  for (const plan of plans) {
    const file = `${plan.role}.tar.gz`;
    const destination = path.join(output, file);
    archives.push({ role: plan.role, file, ...(await archive(plan.stage, destination)) });
  }
} finally {
  rmSync(stageRoot, { recursive: true, force: true });
}

const commit = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});
if (commit.status !== 0) throw new Error('cannot resolve git commit');
const release = {
  schemaVersion: 1,
  compiler: 'behold-living-places-benchmark',
  releaseId: options.releaseId,
  benchmarkId: benchmark.id,
  createdAt: new Date().toISOString(),
  gitCommit: commit.stdout.trim(),
  fixtureWorlds: benchmark.fixtures.map((fixture) => ({
    placeId: fixture.placeId,
    runId: fixture.runId,
    worldTreeSha256: fixture.worldTreeSha256,
  })),
  canonicalRuns: findings.canonicalRuns,
  commands: [
    'node scripts/place-compiler/benchmark.mjs',
    'node scripts/place-compiler/inspect-places.mjs --run-id <new-inspection-id>',
    'node scripts/place-compiler/soak-ecology.mjs --run-id <new-ecology-id>',
    'node scripts/place-compiler/sweep-performance.mjs --run-id <new-performance-id>',
    'node scripts/place-compiler/package-benchmark.mjs --release-id <new-release-id>',
    'node scripts/place-compiler/verify-benchmark-release.mjs <release-directory>',
  ],
  artifactToWorldEpochBoundary:
    'Place artifact plus runtime profile may become a world epoch; Behold identities, minds, looms, and lifecycles remain optional consumers and are not package dependencies.',
  archives,
};
const manifestPath = path.join(output, 'release-manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(release, null, 2)}\n`, { flag: 'wx' });
const sums = [
  ...archives.map((item) => `${item.sha256}  ${item.file}`),
  `${await sha256(manifestPath)}  release-manifest.json`,
];
writeFileSync(path.join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({ output, release }, null, 2)}\n`);
