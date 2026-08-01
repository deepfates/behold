import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LIVE_EPISODE_RECORD_V1_PROTOCOL = 'behold.live-episode-record.v1' as const;
export const LIVE_EPISODE_RECORD_V2_PROTOCOL = 'behold.live-episode-record.v2' as const;
export const LIVE_LYNC_PREFIX_PROTOCOL = 'behold.live-lync-prefix.v2' as const;
export const LIVE_TEXTILE_SOURCE_SET_PROTOCOL = 'behold.live-textile-source-set.v2' as const;

const LIVE_LYNC_SNAPSHOT_V1_PROTOCOL = 'behold.live-lync-snapshot.v1' as const;
const LIVE_TEXTILE_IMPORT_V1_PROTOCOL = 'behold.live-textile-import.v1' as const;
const SUPPORTED_PROFILES = ['org.behold.inhabitant.v1', 'org.behold.inhabitant.v2'] as const;
const READ_BUFFER_BYTES = 64 * 1024;
const MAX_ROOT_LINE_BYTES = 1024 * 1024;

type PresentationProfile = (typeof SUPPORTED_PROFILES)[number];

export type LiveLyncPrefix = Readonly<{
  protocol: typeof LIVE_LYNC_PREFIX_PROTOCOL;
  entityId: string;
  sourceFile: string;
  startOffset: 0;
  endOffset: number;
  sizeBytes: number;
  sha256: string;
  presentationProfile: PresentationProfile;
  preservation: 'immutable_prefix_of_canonical_append_only_source';
}>;

type ResidentSourceInput = Readonly<{ entityId: string; directory: string }>;

export function captureLiveLyncCheckpoint(input: {
  episodeRoot: string;
  residents: ReadonlyArray<ResidentSourceInput>;
}) {
  if (input.residents.length === 0) {
    throw new Error('live Lync checkpoint requires at least one resident');
  }
  const seenEntities = new Set<string>();
  const seenSources = new Map<string, string>();
  const seenBasenames = new Map<string, string>();
  const lives = input.residents.map((resident) => {
    if (seenEntities.has(resident.entityId)) {
      throw new Error(`duplicate resident in live Lync checkpoint: ${resident.entityId}`);
    }
    seenEntities.add(resident.entityId);
    const directory = plainDirectory(resident.directory, `${resident.entityId} Lync directory`);
    const names = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.lync'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    if (names.length === 0) {
      throw new Error(`live episode record requires a Lync source for ${resident.entityId}`);
    }
    const sourceFiles = names.map((name) => {
      const prefix = capturePrefix(path.join(directory, name), resident.entityId);
      if (path.dirname(prefix.sourceFile) !== directory) {
        throw new Error(`resident Lync source escapes ${resident.entityId}'s canonical directory`);
      }
      const priorEntity = seenSources.get(prefix.sourceFile);
      if (priorEntity != null) {
        throw new Error(
          `resident Lync source ${prefix.sourceFile} is shared by ${priorEntity} and ${resident.entityId}`,
        );
      }
      seenSources.set(prefix.sourceFile, resident.entityId);
      const basename = path.basename(prefix.sourceFile);
      const priorPath = seenBasenames.get(basename);
      if (priorPath != null && priorPath !== prefix.sourceFile) {
        throw new Error(`resident Lync source basename is ambiguous: ${basename}`);
      }
      seenBasenames.set(basename, prefix.sourceFile);
      return prefix;
    });
    const profiles = [...new Set(sourceFiles.map((source) => source.presentationProfile))];
    if (profiles.length !== 1) {
      throw new Error(`resident ${resident.entityId} has mixed Lync presentation profiles`);
    }
    return deepFreeze({
      entityId: resident.entityId,
      profile: profiles[0]!,
      lyncDirectory: directory,
      sourceFiles,
    });
  });

  const sources = lives
    .flatMap((life) => life.sourceFiles)
    .map((source, order) => ({
      order,
      protocol: source.protocol,
      entityId: source.entityId,
      presentationProfile: source.presentationProfile,
      sourceFile: source.sourceFile,
      startOffset: source.startOffset,
      endOffset: source.endOffset,
      sizeBytes: source.sizeBytes,
      sha256: source.sha256,
      preservation: source.preservation,
    }));
  const totalSizeBytes = sources.reduce((sum, source) => sum + source.sizeBytes, 0);
  const manifestBase = {
    protocol: LIVE_TEXTILE_SOURCE_SET_PROTOCOL,
    construction: 'ordered_prefix_set' as const,
    sourceCount: sources.length,
    totalSizeBytes,
    sources,
  };
  const manifest = deepFreeze({
    ...manifestBase,
    digest: sha256(stableJson(manifestBase)),
  });
  const manifestFile = path.join(
    path.resolve(input.episodeRoot),
    'textile-resident-lives.sources.json',
  );
  publishLiveCheckpointJson(manifestFile, manifest);
  const artifact = deepFreeze({
    protocol: LIVE_TEXTILE_SOURCE_SET_PROTOCOL,
    file: manifestFile,
    sha256: sha256File(manifestFile),
    sizeBytes: fs.statSync(manifestFile).size,
    sourceCount: sources.length,
    totalSizeBytes,
    manifestDigest: manifest.digest,
    construction: 'ordered_prefix_set' as const,
  });
  return deepFreeze({ lives, artifact });
}

/**
 * Authenticate the Lync portion of either historical copied v1 episode records
 * or current canonical-prefix v2 records. This never writes or materializes a
 * union; callers may hand the returned ordered sources to a compatible reader.
 */
export function verifyLiveEpisodeLyncCheckpoint(record: any) {
  verifyEpisodeRecordDigest(record);
  if (record.protocol === LIVE_EPISODE_RECORD_V1_PROTOCOL) return verifyV1(record);
  if (record.protocol === LIVE_EPISODE_RECORD_V2_PROTOCOL) return verifyV2(record);
  throw new Error('unsupported live episode record protocol');
}

export function readAndVerifyLiveEpisodeLyncCheckpoint(fileValue: string) {
  const file = plainFile(fileValue, 'live episode record');
  return verifyLiveEpisodeLyncCheckpoint(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function materializeLiveEpisodeLyncCheckpoint(record: any, destinationValue: string) {
  const verified = verifyLiveEpisodeLyncCheckpoint(record);
  const destination = path.resolve(destinationValue);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const output = fs.openSync(
    destination,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600,
  );
  let complete = false;
  try {
    for (const source of verified.orderedSources) {
      appendVerifiedPrefix(source, output);
    }
    fs.fsyncSync(output);
    complete = true;
  } finally {
    fs.closeSync(output);
    if (!complete) fs.unlinkSync(destination);
  }
  return deepFreeze({
    file: destination,
    sha256: sha256File(destination),
    sizeBytes: exactMaterializedSize(destination, verified.orderedSources),
    sourceCount: verified.orderedSources.length,
    construction: 'ordered_prefix_materialization' as const,
  });
}

function appendVerifiedPrefix(source: any, output: number) {
  const descriptor = openReadOnlyNoFollow(source.sourceFile, 'Lync materialization source');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  try {
    const before = regularFileStats(descriptor, 'Lync materialization source');
    if (before.size < source.sizeBytes)
      throw new Error('Lync materialization source was truncated');
    let position = 0;
    while (position < source.sizeBytes) {
      const requested = Math.min(buffer.length, source.sizeBytes - position);
      const bytesRead = fs.readSync(descriptor, buffer, 0, requested, position);
      if (bytesRead === 0) throw new Error('Lync materialization source was truncated');
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        written += fs.writeSync(output, buffer, written, bytesRead - written);
      }
      position += bytesRead;
    }
    const after = regularFileStats(descriptor, 'Lync materialization source');
    if (!sameFile(before, after) || after.size < source.sizeBytes) {
      throw new Error('Lync materialization source changed while reading');
    }
    if (hash.digest('hex') !== source.sha256) {
      throw new Error('Lync materialization source prefix digest mismatch');
    }
    assertPathStillNamesDescriptor(
      source.sourceFile,
      before,
      source.sizeBytes,
      'Lync materialization source',
    );
  } finally {
    fs.closeSync(descriptor);
  }
}

function capturePrefix(fileValue: string, entityId: string): LiveLyncPrefix {
  const resolved = path.resolve(fileValue);
  const descriptor = openReadOnlyNoFollow(resolved, `${entityId} Lync source`);
  try {
    const before = regularFileStats(descriptor, `${entityId} Lync source`);
    const sourceFile = fs.realpathSync.native(resolved);
    if (sourceFile !== resolved) {
      throw new Error(`${entityId} Lync source path is not canonical`);
    }
    const sizeBytes = exactFileSize(before.size, `${entityId} Lync source`);
    const captured = hashDescriptorPrefix(descriptor, sizeBytes, true);
    const after = regularFileStats(descriptor, `${entityId} Lync source`);
    if (!sameSnapshot(before, after)) {
      throw new Error(`Lync source was not stable while capturing ${entityId}`);
    }
    assertPathStillNamesExactSnapshot(sourceFile, before, `${entityId} Lync source`);
    return deepFreeze({
      protocol: LIVE_LYNC_PREFIX_PROTOCOL,
      entityId,
      sourceFile,
      startOffset: 0,
      endOffset: sizeBytes,
      sizeBytes,
      sha256: captured.sha256,
      presentationProfile: presentationProfile(captured.firstLine, entityId),
      preservation: 'immutable_prefix_of_canonical_append_only_source',
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

function verifyV2(record: any) {
  const lives = episodeLives(record);
  const flattened = lives.flatMap((life: any) => {
    if (!Array.isArray(life.sourceFiles) || life.sourceFiles.length === 0) {
      throw new Error(`live v2 episode has no Lync sources for ${life.entityId}`);
    }
    const directory = plainDirectory(life.lyncDirectory, `${life.entityId} Lync directory`);
    return life.sourceFiles.map((source: any) => {
      if (
        source?.protocol !== LIVE_LYNC_PREFIX_PROTOCOL ||
        source.entityId !== life.entityId ||
        source.startOffset !== 0 ||
        source.endOffset !== source.sizeBytes ||
        !Number.isSafeInteger(source.sizeBytes) ||
        source.sizeBytes < 0 ||
        !exactSha256(source.sha256) ||
        source.presentationProfile !== life.profile ||
        source.preservation !== 'immutable_prefix_of_canonical_append_only_source'
      ) {
        throw new Error(`malformed live v2 Lync prefix for ${life.entityId}`);
      }
      const sourceFile = plainFile(source.sourceFile, `${life.entityId} Lync prefix source`);
      if (source.sourceFile !== sourceFile) {
        throw new Error(`live v2 Lync prefix path is not canonical for ${life.entityId}`);
      }
      if (path.dirname(sourceFile) !== directory) {
        throw new Error(`live v2 Lync prefix escapes ${life.entityId}'s canonical directory`);
      }
      const verified = verifyPrefix(sourceFile, source.sizeBytes, source.sha256, life.entityId);
      if (verified.profile !== source.presentationProfile) {
        throw new Error(`live v2 Lync prefix profile changed for ${life.entityId}`);
      }
      return source;
    });
  });
  assertResidentIsolation(flattened);
  assertUniqueSourceBasenames(flattened);

  const artifact = record?.textile?.artifact;
  if (
    artifact?.protocol !== LIVE_TEXTILE_SOURCE_SET_PROTOCOL ||
    artifact.construction !== 'ordered_prefix_set' ||
    artifact.sourceCount !== flattened.length ||
    artifact.totalSizeBytes !==
      flattened.reduce((sum: number, source: any) => sum + source.sizeBytes, 0) ||
    !exactSha256(artifact.sha256) ||
    !exactSha256(artifact.manifestDigest)
  ) {
    throw new Error('live v2 Textile source-set descriptor is malformed');
  }
  const manifestFile = plainFile(artifact.file, 'live v2 Textile source-set manifest');
  if (
    fs.statSync(manifestFile).size !== artifact.sizeBytes ||
    sha256File(manifestFile) !== artifact.sha256
  ) {
    throw new Error('live v2 Textile source-set manifest changed');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const { digest, ...manifestBase } = manifest ?? {};
  if (
    manifest?.protocol !== LIVE_TEXTILE_SOURCE_SET_PROTOCOL ||
    manifest.construction !== 'ordered_prefix_set' ||
    manifest.sourceCount !== flattened.length ||
    manifest.totalSizeBytes !== artifact.totalSizeBytes ||
    digest !== artifact.manifestDigest ||
    digest !== sha256(stableJson(manifestBase))
  ) {
    throw new Error('live v2 Textile source-set manifest is malformed or unauthenticated');
  }
  const expectedSources = flattened.map((source: any, order: number) => ({
    order,
    protocol: source.protocol,
    entityId: source.entityId,
    presentationProfile: source.presentationProfile,
    sourceFile: source.sourceFile,
    startOffset: source.startOffset,
    endOffset: source.endOffset,
    sizeBytes: source.sizeBytes,
    sha256: source.sha256,
    preservation: source.preservation,
  }));
  if (stableJson(manifest.sources) !== stableJson(expectedSources)) {
    throw new Error('live v2 Textile source-set order differs from resident sources');
  }
  return deepFreeze({ version: 2 as const, orderedSources: expectedSources, artifact });
}

function verifyV1(record: any) {
  const lives = episodeLives(record);
  const flattened = lives.flatMap((life: any) => {
    if (!Array.isArray(life.sourceFiles) || life.sourceFiles.length === 0) {
      throw new Error(`live v1 episode has no Lync snapshots for ${life.entityId}`);
    }
    return life.sourceFiles.map((source: any) => {
      if (
        source?.protocol !== LIVE_LYNC_SNAPSHOT_V1_PROTOCOL ||
        !Number.isSafeInteger(source.sizeBytes) ||
        source.sizeBytes < 0 ||
        !exactSha256(source.sha256)
      ) {
        throw new Error(`malformed live v1 Lync snapshot for ${life.entityId}`);
      }
      const file = plainFile(source.file, `${life.entityId} Lync snapshot`);
      if (fs.statSync(file).size !== source.sizeBytes || sha256File(file) !== source.sha256) {
        throw new Error(`live v1 Lync snapshot changed for ${life.entityId}`);
      }
      return { ...source, entityId: life.entityId, file };
    });
  });
  const artifact = record?.textile?.artifact;
  if (
    artifact?.protocol !== LIVE_TEXTILE_IMPORT_V1_PROTOCOL ||
    artifact.construction !== 'ordered_byte_concatenation' ||
    artifact.sourceCount !== flattened.length ||
    !exactSha256(artifact.sha256)
  ) {
    throw new Error('live v1 Textile union descriptor is malformed');
  }
  const unionFile = plainFile(artifact.file, 'live v1 Textile union');
  const expectedSize = flattened.reduce((sum: number, source: any) => sum + source.sizeBytes, 0);
  const expectedUnionSha256 = sha256Files(flattened.map((source: any) => source.file));
  if (
    artifact.sizeBytes !== expectedSize ||
    fs.statSync(unionFile).size !== expectedSize ||
    artifact.sha256 !== expectedUnionSha256 ||
    sha256File(unionFile) !== expectedUnionSha256
  ) {
    throw new Error('live v1 Textile union changed or differs from its ordered snapshots');
  }
  return deepFreeze({
    version: 1 as const,
    orderedSources: flattened.map((source: any, order: number) => ({
      order,
      entityId: source.entityId,
      presentationProfile: source.presentationProfile ?? null,
      sourceFile: source.file,
      startOffset: 0 as const,
      endOffset: source.sizeBytes,
      sizeBytes: source.sizeBytes,
      sha256: source.sha256,
    })),
    artifact,
  });
}

function verifyPrefix(file: string, sizeBytes: number, expectedSha256: string, entityId: string) {
  const descriptor = openReadOnlyNoFollow(file, `${entityId} Lync prefix source`);
  try {
    const before = regularFileStats(descriptor, `${entityId} Lync prefix source`);
    if (before.size < sizeBytes) {
      throw new Error(`live v2 Lync prefix was truncated for ${entityId}`);
    }
    const actual = hashDescriptorPrefix(descriptor, sizeBytes, true);
    const after = regularFileStats(descriptor, `${entityId} Lync prefix source`);
    if (!sameFile(before, after) || after.size < sizeBytes) {
      throw new Error(`live v2 Lync prefix changed while verifying ${entityId}`);
    }
    assertPathStillNamesDescriptor(file, before, sizeBytes, `${entityId} Lync prefix source`);
    if (actual.sha256 !== expectedSha256) {
      throw new Error(`live v2 Lync prefix digest mismatch for ${entityId}`);
    }
    return { profile: presentationProfile(actual.firstLine, entityId) };
  } finally {
    fs.closeSync(descriptor);
  }
}

function hashDescriptorPrefix(descriptor: number, sizeBytes: number, retainFirstLine: boolean) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  const rootChunks: Buffer[] = [];
  let rootBytes = 0;
  let rootComplete = !retainFirstLine;
  let position = 0;
  while (position < sizeBytes) {
    const requested = Math.min(buffer.length, sizeBytes - position);
    const bytesRead = fs.readSync(descriptor, buffer, 0, requested, position);
    if (bytesRead === 0) throw new Error('Lync source was truncated while reading its prefix');
    const chunk = buffer.subarray(0, bytesRead);
    hash.update(chunk);
    if (!rootComplete) {
      const newline = chunk.indexOf(0x0a);
      const take = newline < 0 ? chunk.length : newline;
      rootBytes += take;
      if (rootBytes > MAX_ROOT_LINE_BYTES) throw new Error('Lync root line is unreasonably large');
      rootChunks.push(Buffer.from(chunk.subarray(0, take)));
      rootComplete = newline >= 0;
    }
    position += bytesRead;
  }
  if (retainFirstLine && !rootComplete) throw new Error('Lync prefix has no complete root line');
  return { sha256: hash.digest('hex'), firstLine: Buffer.concat(rootChunks).toString('utf8') };
}

function presentationProfile(firstLine: string, entityId: string): PresentationProfile {
  let root: any;
  try {
    root = JSON.parse(firstLine);
  } catch {
    throw new Error(`Lync source has an invalid root for ${entityId}`);
  }
  const meta = root?.kind === 'lync/loom' ? root?.payload?.meta : null;
  if (
    meta?.protocol !== 'behold.entity-loom.v1' ||
    meta?.entityId !== entityId ||
    !SUPPORTED_PROFILES.includes(meta?.profile)
  ) {
    throw new Error('Lync source does not declare a supported resident presentation profile');
  }
  return meta.profile;
}

function assertResidentIsolation(sources: any[]) {
  const owners = new Map<string, string>();
  for (const source of sources) {
    const prior = owners.get(source.sourceFile);
    if (prior != null) {
      throw new Error(
        `live Lync source is duplicated for residents ${prior} and ${source.entityId}`,
      );
    }
    owners.set(source.sourceFile, source.entityId);
  }
}

function exactMaterializedSize(file: string, sources: ReadonlyArray<any>) {
  const expected = sources.reduce((sum, source) => sum + source.sizeBytes, 0);
  const actual = fs.statSync(file).size;
  if (actual !== expected) throw new Error('ordered Lync materialization has the wrong byte count');
  return actual;
}

function assertUniqueSourceBasenames(sources: any[]) {
  const pathsByBasename = new Map<string, string>();
  for (const source of sources) {
    const basename = path.basename(source.sourceFile);
    const prior = pathsByBasename.get(basename);
    if (prior != null && prior !== source.sourceFile) {
      throw new Error(`live Lync source basename is ambiguous: ${basename}`);
    }
    pathsByBasename.set(basename, source.sourceFile);
  }
}

function assertPathStillNamesDescriptor(
  file: string,
  expected: fs.Stats,
  minimumSize: number,
  label: string,
) {
  const descriptor = openReadOnlyNoFollow(file, label);
  try {
    const current = regularFileStats(descriptor, label);
    if (!sameFile(expected, current) || current.size < minimumSize) {
      throw new Error(`${label} path changed while it was being authenticated`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function openReadOnlyNoFollow(file: string, label: string) {
  try {
    return fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error: any) {
    throw new Error(`${label} must be an accessible no-follow regular file: ${error.message}`);
  }
}

function regularFileStats(descriptor: number, label: string) {
  const stats = fs.fstatSync(descriptor);
  if (!stats.isFile()) throw new Error(`${label} must be a regular file`);
  return stats;
}

function sameFile(left: fs.Stats, right: fs.Stats) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left: fs.Stats, right: fs.Stats) {
  return (
    sameFile(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function assertPathStillNamesExactSnapshot(file: string, expected: fs.Stats, label: string) {
  const descriptor = openReadOnlyNoFollow(file, label);
  try {
    const current = regularFileStats(descriptor, label);
    if (!sameSnapshot(expected, current)) {
      throw new Error(`${label} path changed while it was being captured`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function exactFileSize(size: number, label: string) {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`${label} size is not exact`);
  return size;
}

function episodeLives(record: any) {
  if (!Array.isArray(record?.lives) || record.lives.length === 0) {
    throw new Error('live episode record has no resident lives');
  }
  return record.lives;
}

function verifyEpisodeRecordDigest(record: any) {
  if (!record || typeof record !== 'object') throw new Error('live episode record is malformed');
  const { digest, ...base } = record;
  if (!exactSha256(digest) || digest !== sha256(stableJson(base))) {
    throw new Error('live episode record is unauthenticated');
  }
}

function plainDirectory(value: string, label: string) {
  const resolved = path.resolve(value);
  const stats = fs.lstatSync(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a plain directory`);
  }
  return fs.realpathSync.native(resolved);
}

function plainFile(value: string, label: string) {
  const resolved = path.resolve(value);
  const stats = fs.lstatSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a plain file`);
  return fs.realpathSync.native(resolved);
}

export function publishLiveCheckpointJson(fileValue: string, value: unknown) {
  const file = path.resolve(fileValue);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    assertExactPublishedBytes(file, bytes);
    syncDirectory(path.dirname(file));
    return file;
  }
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  let published = false;
  try {
    const descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    try {
      fs.linkSync(temporary, file);
      published = true;
      syncDirectory(path.dirname(file));
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      assertExactPublishedBytes(file, bytes);
      published = true;
      syncDirectory(path.dirname(file));
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  if (!published) throw new Error('live checkpoint JSON was not published');
  return file;
}

function assertExactPublishedBytes(file: string, expected: Buffer) {
  const published = plainFile(file, 'published live checkpoint JSON');
  const actual = fs.readFileSync(published);
  if (!actual.equals(expected)) {
    throw new Error('existing live checkpoint JSON differs from the exact retry');
  }
}

function syncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function sha256File(file: string) {
  const descriptor = openReadOnlyNoFollow(file, 'digest input');
  try {
    const stats = regularFileStats(descriptor, 'digest input');
    return hashDescriptorPrefix(descriptor, exactFileSize(stats.size, 'digest input'), false)
      .sha256;
  } finally {
    fs.closeSync(descriptor);
  }
}

function sha256Files(files: string[]) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  for (const file of files) {
    const descriptor = openReadOnlyNoFollow(file, 'ordered digest input');
    try {
      for (;;) {
        const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        hash.update(buffer.subarray(0, bytesRead));
      }
    } finally {
      fs.closeSync(descriptor);
    }
  }
  return hash.digest('hex');
}

function exactSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
