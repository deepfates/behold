#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const root = path.resolve(process.argv[2] ?? '.');
const manifestPath = path.join(root, 'release-manifest.json');
const sumsPath = path.join(root, 'SHA256SUMS');
if (!existsSync(manifestPath) || !existsSync(sumsPath))
  throw new Error('release manifest or checksums missing');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 2 || manifest.compiler !== 'behold-place-compiler')
  throw new Error('unsupported release manifest');
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
  ['immutable-world', ['level.dat', 'metadata.json', '.mca']],
  [
    'generation-evidence',
    ['generation-manifest.json', 'process.json', 'place-validation.json', 'world-checksums.json'],
  ],
  [
    'reproduction-kit',
    [
      'docs/place-compiler/places/',
      'scripts/place-compiler/generate.mjs',
      'docs/sf-world/tool-lock.json',
    ],
  ],
]);
const roles = new Set();
for (const archive of manifest.archives) {
  if (roles.has(archive.role) || path.basename(archive.file) !== archive.file)
    throw new Error(`duplicate role or unsafe filename: ${archive.role}`);
  roles.add(archive.role);
  const file = path.join(root, archive.file);
  if (
    !existsSync(file) ||
    statSync(file).size !== archive.sizeBytes ||
    sums.get(archive.file) !== archive.sha256 ||
    (await sha256(file)) !== archive.sha256
  )
    throw new Error(`archive integrity failure: ${archive.file}`);
  const listing = spawnSync('tar', ['-tzf', file], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (listing.status !== 0) throw new Error(`cannot list archive: ${archive.file}`);
  const entries = listing.stdout.split('\n');
  if (entries.some((entry) => entry.startsWith('/') || entry.split('/').includes('..')))
    throw new Error(`unsafe archive path: ${archive.file}`);
  if (
    archive.role === 'immutable-world' &&
    entries.some((entry) => entry.endsWith('/session.lock'))
  )
    throw new Error('immutable world contains session.lock');
  for (const needle of required.get(archive.role) ?? [])
    if (!listing.stdout.includes(needle))
      throw new Error(`${archive.role} archive missing ${needle}`);
  process.stdout.write(`${archive.file}: VERIFIED (${entries.length - 1} entries)\n`);
}
for (const role of required.keys())
  if (!roles.has(role)) throw new Error(`missing required role: ${role}`);
if (
  sums.get('release-manifest.json') !== (await sha256(manifestPath)) ||
  sums.size !== manifest.archives.length + 1
)
  throw new Error('release manifest checksum closure failed');
process.stdout.write(`release ${manifest.runId} (${manifest.placeId}): VERIFIED\n`);
