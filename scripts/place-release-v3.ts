import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const PLACE_V3_VERIFIER_REVISION = '81fd4f49de5306ed8fc79cd6561d8577056437e2' as const;

type JsonRecord = Record<string, any>;

export type ExpectedPrivacySafePlaceRelease = Readonly<{
  placeId: string;
  runId: string;
  artifactPreservationTreeSha256: string;
  releaseManifestSha256: string;
  releaseChecksumsSha256: string;
  worldTreeSha256: string;
  archives: Readonly<Record<string, string>>;
  preservationSha256: string;
}>;

export type PrivacySafePlaceReleaseVerification = Readonly<{
  manifest: JsonRecord;
  artifactPreservationTreeSha256: string;
  releaseManifestSha256: string;
  releaseChecksumsSha256: string;
  compilerRevision: typeof PLACE_V3_VERIFIER_REVISION;
  verifier: Readonly<{
    result: 'verified';
    releaseEligible: true;
    disclosureCount: 0;
  }>;
  sourceSnapshot: PlaceReleaseSourceSnapshot;
}>;

export type PlaceReleaseSourceSnapshot = Readonly<{
  artifactPreservationTreeSha256: string;
  files: readonly Readonly<{
    name: string;
    sha256: string;
    sizeBytes: number;
    device: number;
    inode: number;
    mode: number;
  }>[];
}>;

export function verifyPrivacySafePlaceRelease(input: {
  releaseRoot: string;
  preservationFile: string;
  placeCompilerRoot: string;
  expected: ExpectedPrivacySafePlaceRelease;
}): PrivacySafePlaceReleaseVerification {
  const releaseRoot = plainDirectory(input.releaseRoot, 'Place V3 release');
  const preservationFile = readOnlyPlainFile(input.preservationFile, 'Place preservation receipt');
  const compilerRoot = plainDirectory(input.placeCompilerRoot, 'Place Compiler root');
  const verifierModule = readOnlyPlainFile(
    path.join(compilerRoot, 'scripts', 'place-compiler', 'verify-release.mjs'),
    'canonical Place verifier',
    false,
  );
  readOnlyPlainFile(
    path.join(compilerRoot, 'scripts', 'place-compiler', 'release-core.mjs'),
    'canonical Place release core',
    false,
  );
  assertCanonicalVerifierCheckout(compilerRoot);

  const expected = parseExpected(input.expected);
  const preservation = readJson(preservationFile, 'Place preservation receipt');
  verifyPreservationReceipt(preservation, preservationFile, expected);
  const before = snapshotPlaceRelease(releaseRoot);
  verifyPinnedSnapshot(before, expected);

  const canonical = invokeCanonicalVerifier(verifierModule, releaseRoot);
  assertCanonicalVerifierCheckout(compilerRoot);
  const manifest = canonical.manifest;
  if (
    canonical.status !== 'verified' ||
    canonical.releaseEligible !== true ||
    canonical.disclosureCount !== 0 ||
    manifest?.schemaVersion !== 3 ||
    manifest?.compiler !== 'behold-place-compiler' ||
    manifest?.placeId !== expected.placeId ||
    manifest?.runId !== expected.runId ||
    manifest?.portability?.status !== 'privacy-safe' ||
    manifest?.portability?.policy !== 'logical-coordinates-v1'
  ) {
    throw new Error('Canonical Place verifier did not return a privacy-eligible V3 release');
  }
  if (
    manifest.source?.worldTreeSha256 !== expected.worldTreeSha256 ||
    !sha256Value(manifest.source?.recipeSha256) ||
    !sha256Value(manifest.source?.toolLockSha256) ||
    !sha256Value(manifest.source?.osmSha256) ||
    !sha256Value(manifest.source?.generator?.binarySha256) ||
    !sha256Value(manifest.portability?.evidenceManifestSha256)
  ) {
    throw new Error('Place V3 source, portability, or world identity is incomplete or mismatched');
  }
  const manifestFromDisk = readJson(
    path.join(releaseRoot, 'release-manifest.json'),
    'Place release manifest',
  );
  if (stableJson(manifestFromDisk) !== stableJson(manifest)) {
    throw new Error('Canonical Place verifier result does not match the mounted manifest');
  }
  verifyPinnedArchives(manifest, expected.archives);
  const after = snapshotPlaceRelease(releaseRoot);
  assertPlaceReleaseUnchanged(before, after);
  return Object.freeze({
    manifest: deepFreeze(manifest),
    artifactPreservationTreeSha256: before.artifactPreservationTreeSha256,
    releaseManifestSha256: expected.releaseManifestSha256,
    releaseChecksumsSha256: expected.releaseChecksumsSha256,
    compilerRevision: PLACE_V3_VERIFIER_REVISION,
    verifier: Object.freeze({
      result: 'verified' as const,
      releaseEligible: true as const,
      disclosureCount: 0 as const,
    }),
    sourceSnapshot: before,
  });
}

function assertCanonicalVerifierCheckout(compilerRoot: string) {
  const revision = spawnSync('git', ['-C', compilerRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (revision.status !== 0 || revision.stdout.trim() !== PLACE_V3_VERIFIER_REVISION) {
    throw new Error('Canonical Place verifier revision mismatch');
  }
  const verifierDiff = spawnSync(
    'git',
    [
      '-C',
      compilerRoot,
      'diff',
      '--quiet',
      'HEAD',
      '--',
      'scripts/place-compiler/verify-release.mjs',
      'scripts/place-compiler/release-core.mjs',
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  if (verifierDiff.status !== 0) {
    throw new Error('Canonical Place verifier differs from revision 81fd4f4');
  }
}

export function snapshotPlaceRelease(rootValue: string): PlaceReleaseSourceSnapshot {
  const root = plainDirectory(rootValue, 'Place release');
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
  if (entries.length < 3) throw new Error('Place release closure is incomplete');
  const files = entries.map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Place release contains a non-file entry: ${entry.name}`);
    }
    const file = path.join(root, entry.name);
    const stats = fs.lstatSync(file);
    if ((stats.mode & 0o222) !== 0) {
      throw new Error(`Place release source must be read-only: ${entry.name}`);
    }
    return Object.freeze({
      name: entry.name,
      sha256: sha256File(file),
      sizeBytes: stats.size,
      device: stats.dev,
      inode: stats.ino,
      mode: stats.mode,
    });
  });
  const records = files.map((file) => `${file.sha256}  ./${file.name}\n`).join('');
  return Object.freeze({
    artifactPreservationTreeSha256: createHash('sha256').update(records, 'utf8').digest('hex'),
    files: Object.freeze(files),
  });
}

export function assertPlaceReleaseUnchanged(
  before: PlaceReleaseSourceSnapshot,
  after: PlaceReleaseSourceSnapshot,
) {
  if (stableJson(before) !== stableJson(after)) {
    throw new Error('Place release source changed during admission');
  }
}

function invokeCanonicalVerifier(modulePath: string, releaseRoot: string) {
  const bridge = [
    "import { pathToFileURL } from 'node:url';",
    'const modulePath = process.env.BEHOLD_CANONICAL_PLACE_VERIFIER;',
    "if (!modulePath) throw new Error('canonical verifier module missing');",
    'const verifier = await import(pathToFileURL(modulePath).href);',
    "if (typeof verifier.verifyRelease !== 'function') throw new Error('verifyRelease export missing');",
    'const result = await verifier.verifyRelease(process.argv[1], { quiet: true });',
    'process.stdout.write(JSON.stringify(result));',
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', bridge, releaseRoot],
    {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, BEHOLD_CANONICAL_PLACE_VERIFIER: modulePath },
    },
  );
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || 'canonical verifier failed')
      .trim()
      .slice(0, 2_000);
    throw new Error(`Canonical Place verifier rejected the release: ${detail}`);
  }
  try {
    return JSON.parse(result.stdout) as JsonRecord;
  } catch {
    throw new Error('Canonical Place verifier returned malformed evidence');
  }
}

function verifyPinnedSnapshot(
  snapshot: PlaceReleaseSourceSnapshot,
  expected: ExpectedPrivacySafePlaceRelease,
) {
  if (snapshot.artifactPreservationTreeSha256 !== expected.artifactPreservationTreeSha256) {
    throw new Error('Pinned Place artifact-preservation tree digest mismatch');
  }
  const actual = Object.fromEntries(snapshot.files.map((file) => [file.name, file.sha256]));
  const expectedFiles = {
    SHA256SUMS: expected.releaseChecksumsSha256,
    'release-manifest.json': expected.releaseManifestSha256,
    ...expected.archives,
  };
  if (stableJson(actual) !== stableJson(expectedFiles)) {
    throw new Error('Pinned Place release file closure mismatch');
  }
}

function verifyPinnedArchives(manifest: JsonRecord, expected: Readonly<Record<string, string>>) {
  if (!Array.isArray(manifest.archives)) throw new Error('Place V3 archives are missing');
  const actual = Object.fromEntries(
    manifest.archives.map((archive: JsonRecord) => [archive.file, archive.sha256]),
  );
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error('Pinned Place archive identities mismatch');
  }
}

function verifyPreservationReceipt(
  receipt: JsonRecord,
  receiptFile: string,
  expected: ExpectedPrivacySafePlaceRelease,
) {
  if (
    sha256File(receiptFile) !== expected.preservationSha256 ||
    receipt.schemaVersion !== 1 ||
    receipt.kind !== 'place-compiler-release-preservation' ||
    receipt.compiler?.commit !== PLACE_V3_VERIFIER_REVISION ||
    receipt.copy?.sourceMutated !== false ||
    receipt.copy?.destinationReadOnly !== true ||
    receipt.verification?.destinationAfterRename !== 'VERIFIED-PORTABLE' ||
    receipt.identity?.releaseTreeSha256 !== expected.artifactPreservationTreeSha256 ||
    receipt.identity?.releaseManifestSha256 !== expected.releaseManifestSha256 ||
    receipt.identity?.sha256sumsSha256 !== expected.releaseChecksumsSha256 ||
    receipt.identity?.worldTreeSha256 !== expected.worldTreeSha256 ||
    stableJson(receipt.identity?.archives) !== stableJson(expected.archives)
  ) {
    throw new Error('Place preservation receipt identity or verification mismatch');
  }
}

function parseExpected(value: ExpectedPrivacySafePlaceRelease) {
  if (
    !safeSegment(value?.placeId) ||
    !safeSegment(value?.runId) ||
    !sha256Value(value?.artifactPreservationTreeSha256) ||
    !sha256Value(value?.releaseManifestSha256) ||
    !sha256Value(value?.releaseChecksumsSha256) ||
    !sha256Value(value?.worldTreeSha256) ||
    !sha256Value(value?.preservationSha256) ||
    !value.archives ||
    Object.keys(value.archives).length < 3 ||
    Object.entries(value.archives).some(
      ([name, digest]) => path.basename(name) !== name || !sha256Value(digest),
    )
  ) {
    throw new Error('Pinned Place V3 identity is malformed');
  }
  return deepFreeze({ ...value, archives: { ...value.archives } });
}

function sha256File(file: string) {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function readJson(file: string, label: string): JsonRecord {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    return value;
  } catch (error: any) {
    throw new Error(`${label} is malformed: ${error?.message || String(error)}`);
  }
}

function plainDirectory(value: string, label: string) {
  const directory = path.resolve(value);
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(directory);
  } catch {
    throw new Error(`${label} is unavailable`);
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a plain directory`);
  }
  return directory;
}

function readOnlyPlainFile(value: string, label: string, requireReadOnly = true) {
  const file = path.resolve(value);
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(file);
  } catch {
    throw new Error(`${label} is unavailable`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} is not a plain file`);
  if (requireReadOnly && (stats.mode & 0o222) !== 0) throw new Error(`${label} must be read-only`);
  return file;
}

function safeSegment(value: unknown) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function sha256Value(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as JsonRecord)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as JsonRecord)) deepFreeze(child);
  }
  return value;
}
