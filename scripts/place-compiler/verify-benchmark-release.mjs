#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from './core.mjs';

function extractJson(archive, entry) {
  const result = spawnSync('tar', ['-xOf', archive, `./${entry}`], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`cannot extract ${entry}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const root = path.resolve(process.argv[2] ?? '.');
const manifestPath = path.join(root, 'release-manifest.json');
const sumsPath = path.join(root, 'SHA256SUMS');
if (!existsSync(manifestPath) || !existsSync(sumsPath))
  throw new Error('release manifest or checksum file missing');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || manifest.compiler !== 'behold-living-places-benchmark')
  throw new Error('unsupported benchmark release');
const sums = new Map(
  readFileSync(sumsPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})  ([^/]+)$/);
      if (!match) throw new Error(`malformed checksum: ${line}`);
      return [match[2], match[1]];
    }),
);
const required = new Map([
  [
    'contract-and-reproduction',
    [
      'docs/place-compiler/benchmark-v1.schema.json',
      'docs/place-compiler/benchmarks/living-places-v1-findings.json',
      'docs/place-compiler/reports/2026-07-13-living-places-benchmark-v1.md',
      'scripts/place-compiler/inspect-places.mjs',
      'scripts/place-compiler/soak-ecology.mjs',
      'scripts/place-compiler/sweep-performance.mjs',
    ],
  ],
  [
    'inspection-evidence',
    [
      'inspection-manifest.json',
      'inspections/san-francisco.json',
      'inspections/lower-manhattan.json',
      'checkpoint-map.png',
    ],
  ],
  [
    'ecology-evidence',
    ['ecology-manifest.json', 'soaks/san-francisco.json', 'soaks/lower-manhattan.json'],
  ],
  [
    'performance-evidence',
    [
      'performance-manifest.json',
      'cases/san-francisco-cinematic-r1.json',
      'cases/lower-manhattan-living-r2.json',
    ],
  ],
]);
const roles = new Map();
for (const item of manifest.archives) {
  if (roles.has(item.role) || path.basename(item.file) !== item.file)
    throw new Error(`duplicate role or unsafe archive name: ${item.role}`);
  roles.set(item.role, item);
  const file = path.join(root, item.file);
  if (
    !existsSync(file) ||
    statSync(file).size !== item.sizeBytes ||
    sums.get(item.file) !== item.sha256 ||
    (await sha256(file)) !== item.sha256
  )
    throw new Error(`archive integrity failure: ${item.file}`);
  const listing = spawnSync('tar', ['-tzf', file], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (listing.status !== 0) throw new Error(`cannot list ${item.file}`);
  const entries = listing.stdout.split('\n').filter(Boolean);
  if (
    entries.some((entry) => {
      const normalized = entry.replace(/^\.\//, '');
      return normalized.startsWith('/') || normalized.split('/').includes('..');
    })
  )
    throw new Error(`unsafe path in ${item.file}`);
  if (entries.some((entry) => entry.includes('/runtimes/') || entry.endsWith('/session.lock')))
    throw new Error(`mutable runtime leaked into ${item.file}`);
  for (const needle of required.get(item.role) ?? [])
    if (!listing.stdout.includes(needle)) throw new Error(`${item.role} missing ${needle}`);
  process.stdout.write(`${item.file}: VERIFIED (${entries.length} entries)\n`);
}
for (const role of required.keys()) if (!roles.has(role)) throw new Error(`missing role: ${role}`);
if (
  sums.get('release-manifest.json') !== (await sha256(manifestPath)) ||
  sums.size !== manifest.archives.length + 1
)
  throw new Error('checksum closure failure');
const inspection = extractJson(
  path.join(root, roles.get('inspection-evidence').file),
  'inspection-manifest.json',
);
const ecology = extractJson(
  path.join(root, roles.get('ecology-evidence').file),
  'ecology-manifest.json',
);
const performance = extractJson(
  path.join(root, roles.get('performance-evidence').file),
  'performance-manifest.json',
);
const findings = extractJson(
  path.join(root, roles.get('contract-and-reproduction').file),
  'docs/place-compiler/benchmarks/living-places-v1-findings.json',
);
for (const evidence of [inspection, ecology, performance, findings])
  if ((evidence.benchmarkId ?? evidence.id) !== manifest.benchmarkId)
    throw new Error('packaged benchmark identity mismatch');
if (
  inspection.results.length !== 2 ||
  ecology.results.length !== 2 ||
  performance.cases.length !== 12
)
  throw new Error('packaged evidence cardinality mismatch');
const places = new Set(manifest.fixtureWorlds.map((fixture) => fixture.placeId));
if (!places.has('san-francisco') || !places.has('lower-manhattan') || places.size !== 2)
  throw new Error('release does not bind both fixture worlds');
if (
  manifest.commands.length < 6 ||
  !manifest.commands.some((command) => command.includes('verify-benchmark-release'))
)
  throw new Error('reproduction commands incomplete');
if (!manifest.artifactToWorldEpochBoundary.includes('optional consumers'))
  throw new Error('artifact-to-world-epoch boundary missing');
process.stdout.write(
  `release ${manifest.releaseId} (${manifest.benchmarkId}): VERIFIED; 2 places, 12 performance cases\n`,
);
