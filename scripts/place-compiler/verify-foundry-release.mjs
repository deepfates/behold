#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from './core.mjs';

const root = path.resolve(process.argv[2] ?? '.');
const manifestPath = path.join(root, 'release-manifest.json');
const sumsPath = path.join(root, 'SHA256SUMS');
if (!existsSync(manifestPath) || !existsSync(sumsPath)) throw new Error('release closure missing');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const hashBytes = (value) => createHash('sha256').update(value).digest('hex');
if (manifest.schemaVersion !== 1 || manifest.kind !== 'living-city-foundry-release')
  throw new Error('unsupported foundry release');
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
const archive = path.join(root, manifest.archive.file);
if (
  !existsSync(archive) ||
  statSync(archive).size !== manifest.archive.sizeBytes ||
  (await sha256(archive)) !== manifest.archive.sha256 ||
  sums.get(manifest.archive.file) !== manifest.archive.sha256
)
  throw new Error('archive integrity failure');
if (sums.get('release-manifest.json') !== (await sha256(manifestPath)) || sums.size !== 2)
  throw new Error('checksum closure failure');
const extract = spawnSync('tar', ['-xOf', archive, './FOUNDry-MANIFEST.json'], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});
if (extract.status !== 0) throw new Error('embedded manifest missing');
const embedded = JSON.parse(extract.stdout);
if (hashBytes(Buffer.from(extract.stdout)) !== manifest.contentTreeSha256)
  throw new Error('embedded manifest digest mismatch');
const listing = spawnSync('tar', ['-tzf', archive], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});
if (listing.status !== 0) throw new Error('cannot list archive');
const names = listing.stdout
  .split('\n')
  .filter((name) => name && name !== './' && !name.endsWith('/'))
  .map((name) => name.replace(/^\.\//, ''));
if (
  names.some((name) => name.startsWith('/') || name.split('/').includes('..')) ||
  new Set(names).size !== names.length
)
  throw new Error('unsafe or duplicate archive path');
if (
  embedded.entries.length !== manifest.contentEntries ||
  names.length !== embedded.entries.length + 1
)
  throw new Error('entry cardinality mismatch');
for (const entry of embedded.entries) {
  const data = spawnSync('tar', ['-xOf', archive, `./${entry.path}`], {
    maxBuffer: 512 * 1024 * 1024,
  });
  if (
    data.status !== 0 ||
    data.stdout.length !== entry.sizeBytes ||
    hashBytes(data.stdout) !== entry.sha256
  )
    throw new Error(`entry integrity failure: ${entry.path}`);
}
const requiredPlaces = ['san-francisco', 'lower-manhattan', 'venice-core'];
if (
  JSON.stringify(manifest.places) !== JSON.stringify(requiredPlaces) ||
  manifest.stories.inspection !== 3 ||
  manifest.stories.ecologyDays !== 3 ||
  manifest.stories.performanceCases !== 18 ||
  manifest.stories.humanVisits !== 3 ||
  manifest.stories.capturedVisits < 1 ||
  manifest.stories.beholdEpochProofs !== 1
)
  throw new Error('user-story coverage incomplete');
if (!Array.isArray(manifest.frontiers) || manifest.frontiers.length < 6)
  throw new Error('honest frontier disclosure missing');
for (const needle of [
  'contract/living-city-foundry-v2.json',
  'visits/san-francisco/evidence/visit.mov',
  'behold-epoch/evidence/report.json',
  'reproduction/scripts/place-compiler/generate.mjs',
])
  if (!names.includes(needle)) throw new Error(`required closure member missing: ${needle}`);
process.stdout.write(
  `release ${manifest.releaseId}: VERIFIED; 3 places, 3 visits, 18 performance cases, ${embedded.entries.length} content entries\n`,
);
