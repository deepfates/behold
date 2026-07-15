#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { archiveMemberSatisfies } from './release-core.mjs';

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function safeArchiveEntry(entry, label) {
  if (
    typeof entry !== 'string' ||
    !entry ||
    path.posix.isAbsolute(entry) ||
    entry.includes('\\') ||
    entry.split('/').includes('..')
  )
    throw new Error(`unsafe ${label}: ${entry}`);
  return entry;
}
function extractEntry(archive, entry) {
  const result = spawnSync('tar', ['-xOzf', archive, entry], {
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`cannot extract ${entry} from ${path.basename(archive)}`);
  return result.stdout;
}
const root = path.resolve(process.argv[2] ?? '.');
const manifestPath = path.join(root, 'release-manifest.json');
const sumsPath = path.join(root, 'SHA256SUMS');
if (!existsSync(manifestPath) || !existsSync(sumsPath))
  throw new Error('release manifest or checksums missing');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (![2, 3].includes(manifest.schemaVersion) || manifest.compiler !== 'behold-place-compiler')
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
const archiveByRole = new Map();
const entriesByRole = new Map();
for (const archive of manifest.archives) {
  if (roles.has(archive.role) || path.basename(archive.file) !== archive.file)
    throw new Error(`duplicate role or unsafe filename: ${archive.role}`);
  roles.add(archive.role);
  archiveByRole.set(archive.role, path.join(root, archive.file));
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
  const entries = listing.stdout
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^\.\//, ''));
  entriesByRole.set(archive.role, new Set(entries));
  if (entries.some((entry) => entry.startsWith('/') || entry.split('/').includes('..')))
    throw new Error(`unsafe archive path: ${archive.file}`);
  if (
    archive.role === 'immutable-world' &&
    entries.some((entry) => entry.endsWith('/session.lock'))
  )
    throw new Error('immutable world contains session.lock');
  for (const needle of required.get(archive.role) ?? [])
    if (!entries.some((entry) => archiveMemberSatisfies(entry, needle)))
      throw new Error(`${archive.role} archive missing ${needle}`);
  process.stdout.write(`${archive.file}: VERIFIED (${entries.length} entries)\n`);
}
for (const role of required.keys())
  if (!roles.has(role)) throw new Error(`missing required role: ${role}`);
if (
  sums.get('release-manifest.json') !== (await sha256(manifestPath)) ||
  sums.size !== manifest.archives.length + 1
)
  throw new Error('release manifest checksum closure failed');
if (manifest.schemaVersion === 3) verifyGeneratorClosure(manifest, archiveByRole, entriesByRole);
process.stdout.write(
  `release ${manifest.runId} (${manifest.placeId}): ${manifest.schemaVersion === 3 ? 'VERIFIED' : 'LEGACY-INTEGRITY-VERIFIED'}\n`,
);

function verifyGeneratorClosure(release, archives, listings) {
  const generator = release.source?.generator;
  if (!generator || !Array.isArray(generator.patches) || generator.patches.length < 1)
    throw new Error('v3 release lacks generator reproduction closure');
  const reproduction = archives.get('reproduction-kit');
  const evidence = archives.get('generation-evidence');
  const reproductionEntries = listings.get('reproduction-kit');
  const toolLockPath = safeArchiveEntry(release.source.toolLockPath, 'tool lock path');
  const buildManifestPath = safeArchiveEntry(
    generator.buildManifestPath,
    'generator build manifest path',
  );
  const patchPaths = generator.patches.map((patch) =>
    safeArchiveEntry(patch?.path, 'generator patch path'),
  );
  if (new Set(patchPaths).size !== patchPaths.length)
    throw new Error('duplicate generator patch path');
  for (const entry of [toolLockPath, buildManifestPath, ...patchPaths])
    if (!reproductionEntries.has(entry)) throw new Error(`reproduction kit missing exact ${entry}`);

  const toolLockBytes = extractEntry(reproduction, toolLockPath);
  const buildManifestBytes = extractEntry(reproduction, buildManifestPath);
  if (sha256Bytes(toolLockBytes) !== release.source.toolLockSha256)
    throw new Error('archived tool lock digest mismatch');
  if (sha256Bytes(buildManifestBytes) !== generator.buildManifestSha256)
    throw new Error('archived generator build manifest digest mismatch');
  const toolLock = JSON.parse(toolLockBytes.toString('utf8'));
  const buildManifest = JSON.parse(buildManifestBytes.toString('utf8'));
  const generation = JSON.parse(
    extractEntry(evidence, 'generation-manifest.json').toString('utf8'),
  );
  const locked = toolLock.tools?.arnisPatched;
  const official = toolLock.tools?.arnisOfficial;
  const lockedPatchPaths = locked?.patchPaths ?? [locked?.patchPath];
  const generatedPatchPaths = generation.generator?.patchPaths ?? [generation.generator?.patchPath];
  if (
    JSON.stringify(patchPaths) !== JSON.stringify(lockedPatchPaths) ||
    JSON.stringify(patchPaths) !== JSON.stringify(generatedPatchPaths) ||
    JSON.stringify(patchPaths) !== JSON.stringify(buildManifest.patches?.map((patch) => patch.path))
  )
    throw new Error('generator patch sets disagree');
  for (const [index, patch] of generator.patches.entries()) {
    const digest = sha256Bytes(extractEntry(reproduction, patch.path));
    if (
      !/^[a-f0-9]{64}$/.test(patch.sha256) ||
      digest !== patch.sha256 ||
      digest !== buildManifest.patches[index]?.sha256
    )
      throw new Error(`generator patch digest mismatch: ${patch.path}`);
  }
  if (
    generator.baseVersion !== generation.generator?.baseVersion ||
    generator.baseVersion !== buildManifest.base?.version ||
    generator.binarySha256 !== generation.generator?.binarySha256 ||
    generator.binarySha256 !== locked?.sha256 ||
    generator.binarySha256 !== buildManifest.build?.sha256 ||
    generator.binarySizeBytes !== locked?.sizeBytes ||
    generator.binarySizeBytes !== buildManifest.build?.sizeBytes ||
    generator.sourceArchiveSha256 !== official?.sourceArchiveSha256 ||
    generator.sourceArchiveSha256 !== buildManifest.sourceArchive?.sha256 ||
    generator.sourceArchiveSizeBytes !== official?.sourceArchiveSizeBytes ||
    generator.sourceArchiveSizeBytes !== buildManifest.sourceArchive?.sizeBytes ||
    generator.buildCommand !== locked?.buildCommand ||
    generator.buildCommand !== buildManifest.build?.command ||
    generator.testCommand !== locked?.testCommand ||
    generator.testCommand !== buildManifest.build?.testCommand
  )
    throw new Error('generator reproduction metadata disagrees');
}
