import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FileLoomCheckpoint } from '@deepfates/lync/file-loom-checkpoint' with {
  'resolution-mode': 'import',
};

export const LIVE_EPISODE_RECORD_V1_PROTOCOL = 'behold.live-episode-record.v1' as const;
export const LIVE_EPISODE_RECORD_V2_PROTOCOL = 'behold.live-episode-record.v2' as const;
export const LIVE_LYNC_PREFIX_PROTOCOL = 'behold.live-lync-prefix.v2' as const;
export const LIVE_LYNC_CANONICAL_PREFIX_PROTOCOL = 'behold.live-lync-canonical-prefix.v1' as const;
export const LIVE_SELECTED_LIFE_PROTOCOL = 'behold.live-selected-life.v1' as const;
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

export type LiveLyncCanonicalPrefix = Readonly<{
  protocol: typeof LIVE_LYNC_CANONICAL_PREFIX_PROTOCOL;
  entityId: string;
  sourceFile: string;
  sourceKind: 'loom' | 'conflicts' | 'pending';
  presentationProfile: PresentationProfile | null;
  startOffset: 0;
  endOffset: number;
  sizeBytes: number;
  sha256: string;
  preservation: 'immutable_prefix_of_canonical_append_only_source';
}>;

export type LiveSelectedLife = Readonly<{
  protocol: typeof LIVE_SELECTED_LIFE_PROTOCOL;
  entityId: string;
  circleId: string | null;
  loomId: string;
  tipTurnId: string | null;
  depth: number;
  bodyDigest: string | null;
  chainDigest: string | null;
  canonical: Readonly<{
    source: string;
    line: number;
    start: number;
    end: number;
    terminator: '' | '\n';
    rawSha256: string;
  }> | null;
  checkpoint: FileLoomCheckpoint | null;
}>;

type ResidentSourceInput = Readonly<{
  entityId: string;
  directory: string;
  canonicalCheckpoint?: FileLoomCheckpoint | null;
}>;

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
    const canonicalNames = resident.canonicalCheckpoint
      ? resident.canonicalCheckpoint.sources.map((source) => source.file)
      : fs
          .readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && isCanonicalLyncSourceName(entry.name))
          .map((entry) => entry.name)
          .sort(compareCanonicalLyncSourceNames);
    const loomNames = canonicalNames.filter((name) => name.endsWith('.lync'));
    if (loomNames.length === 0) {
      throw new Error(`live episode record requires a Lync source for ${resident.entityId}`);
    }
    const canonicalSourceFiles = canonicalNames.map((name) => {
      const prefix = captureCanonicalPrefix(path.join(directory, name), resident.entityId);
      const checkpointSource = resident.canonicalCheckpoint?.sources.find(
        (source) => source.file === name,
      );
      if (
        checkpointSource &&
        (checkpointSource.size !== prefix.sizeBytes || checkpointSource.sha256 !== prefix.sha256)
      ) {
        throw new Error(
          `Lync checkpoint source changed before episode capture for ${resident.entityId}`,
        );
      }
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
      return prefix;
    });
    const sourceFiles = canonicalSourceFiles
      .filter((source) => source.sourceKind === 'loom')
      .map((source) => captureTextilePrefix(source));
    for (const source of sourceFiles) {
      const basename = path.basename(source.sourceFile);
      const priorPath = seenBasenames.get(basename);
      if (priorPath != null && priorPath !== source.sourceFile) {
        throw new Error(`resident Lync source basename is ambiguous: ${basename}`);
      }
      seenBasenames.set(basename, source.sourceFile);
    }
    const profiles = [...new Set(sourceFiles.map((source) => source.presentationProfile))];
    if (profiles.length !== 1) {
      throw new Error(`resident ${resident.entityId} has mixed Lync presentation profiles`);
    }
    return deepFreeze({
      entityId: resident.entityId,
      profile: profiles[0]!,
      lyncDirectory: directory,
      sourceFiles,
      canonicalSourceFiles,
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
 * Bind Behold's selected private branch after the resident controller has
 * drained and closed. Lync supplies the canonical locator and chain identity;
 * the episode record supplies the immutable selection statement.
 */
export async function captureLiveSelectedLife(input: {
  entityId: string;
  directory: string;
}): Promise<LiveSelectedLife> {
  const directory = plainDirectory(input.directory, `${input.entityId} Lync directory`);
  const manifestFile = plainFile(
    path.join(directory, 'manifest.json'),
    `${input.entityId} selected-life manifest`,
  );
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (
    manifest?.protocol !== 'behold.entity-loom-manifest.v1' ||
    manifest.entityId !== input.entityId ||
    typeof manifest.loomId !== 'string' ||
    !manifest.loomId.startsWith('lync:') ||
    (manifest.tipTurnId !== null && typeof manifest.tipTurnId !== 'string')
  ) {
    throw new Error(`invalid selected-life manifest for ${input.entityId}`);
  }
  const { openFileLoomCursor } = await import('@deepfates/lync/file-loom-cursor');
  const cursor = await openFileLoomCursor({
    dir: directory,
    loomId: manifest.loomId,
    author: { actor: 'behold-episode-checkpoint', via: 'behold@0.1.0-alpha.0' },
  });
  try {
    const info = await cursor.info();
    const meta = info.meta as Record<string, unknown> | undefined;
    if (
      meta?.protocol !== 'behold.entity-loom.v1' ||
      meta.entityId !== input.entityId ||
      !SUPPORTED_PROFILES.includes(meta.profile as PresentationProfile)
    ) {
      throw new Error(`selected Lync loom does not belong to ${input.entityId}`);
    }
    const circleId = typeof meta.circleId === 'string' && meta.circleId ? meta.circleId : null;
    if (manifest.tipTurnId === null) {
      return deepFreeze({
        protocol: LIVE_SELECTED_LIFE_PROTOCOL,
        entityId: input.entityId,
        circleId,
        loomId: manifest.loomId,
        tipTurnId: null,
        depth: 0,
        bodyDigest: null,
        chainDigest: null,
        canonical: null,
        checkpoint: null,
      });
    }

    const { captureFileLoomCheckpoint } = await import('@deepfates/lync/file-loom-checkpoint');
    const checkpoint = await captureFileLoomCheckpoint({
      dir: directory,
      loomId: manifest.loomId,
      tip: manifest.tipTurnId,
    });
    const tip = checkpoint.tip;
    return deepFreeze({
      protocol: LIVE_SELECTED_LIFE_PROTOCOL,
      entityId: input.entityId,
      circleId,
      loomId: manifest.loomId,
      tipTurnId: checkpoint.tip.id,
      depth: tip.depth,
      bodyDigest: tip.bodyDigest,
      chainDigest: tip.chainDigest,
      canonical: {
        source: checkpoint.tip.locator.file,
        line: checkpoint.tip.locator.line,
        start: checkpoint.tip.locator.start,
        end: checkpoint.tip.locator.end,
        terminator: checkpoint.tip.locator.terminator,
        rawSha256: checkpoint.tip.locator.rawSha256,
      },
      checkpoint,
    });
  } finally {
    cursor.close();
  }
}

/**
 * Authenticate the Lync portion of either historical copied v1 episode records
 * or current canonical-prefix v2 records. This never writes or materializes a
 * union; callers may hand the returned ordered sources to a compatible reader.
 */
export async function verifyLiveEpisodeLyncCheckpoint(record: any) {
  verifyEpisodeRecordDigest(record);
  if (record.protocol === LIVE_EPISODE_RECORD_V1_PROTOCOL) return verifyV1(record);
  if (record.protocol === LIVE_EPISODE_RECORD_V2_PROTOCOL) return verifyV2(record);
  throw new Error('unsupported live episode record protocol');
}

export async function readAndVerifyLiveEpisodeLyncCheckpoint(fileValue: string) {
  const file = plainFile(fileValue, 'live episode record');
  return verifyLiveEpisodeLyncCheckpoint(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export async function materializeLiveEpisodeLyncCheckpoint(record: any, destinationValue: string) {
  const verified = await verifyLiveEpisodeLyncCheckpoint(record);
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

function captureCanonicalPrefix(fileValue: string, entityId: string): LiveLyncCanonicalPrefix {
  const resolved = path.resolve(fileValue);
  const descriptor = openReadOnlyNoFollow(resolved, `${entityId} Lync source`);
  try {
    const before = regularFileStats(descriptor, `${entityId} Lync source`);
    const sourceFile = fs.realpathSync.native(resolved);
    if (sourceFile !== resolved) {
      throw new Error(`${entityId} Lync source path is not canonical`);
    }
    const sizeBytes = exactFileSize(before.size, `${entityId} Lync source`);
    const sourceKind = canonicalLyncSourceKind(path.basename(sourceFile));
    const captured = hashDescriptorPrefix(descriptor, sizeBytes, sourceKind === 'loom');
    const after = regularFileStats(descriptor, `${entityId} Lync source`);
    if (!sameSnapshot(before, after)) {
      throw new Error(`Lync source was not stable while capturing ${entityId}`);
    }
    assertPathStillNamesExactSnapshot(sourceFile, before, `${entityId} Lync source`);
    return deepFreeze({
      protocol: LIVE_LYNC_CANONICAL_PREFIX_PROTOCOL,
      entityId,
      sourceFile,
      sourceKind,
      presentationProfile:
        sourceKind === 'loom' ? presentationProfile(captured.firstLine, entityId) : null,
      startOffset: 0,
      endOffset: sizeBytes,
      sizeBytes,
      sha256: captured.sha256,
      preservation: 'immutable_prefix_of_canonical_append_only_source',
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

function captureTextilePrefix(source: LiveLyncCanonicalPrefix): LiveLyncPrefix {
  if (source.sourceKind !== 'loom' || source.presentationProfile == null) {
    throw new Error('only canonical Lync loom files are Textile presentation sources');
  }
  return deepFreeze({
    protocol: LIVE_LYNC_PREFIX_PROTOCOL,
    entityId: source.entityId,
    sourceFile: source.sourceFile,
    startOffset: 0,
    endOffset: source.endOffset,
    sizeBytes: source.sizeBytes,
    sha256: source.sha256,
    presentationProfile: source.presentationProfile,
    preservation: source.preservation,
  });
}

function isCanonicalLyncSourceName(name: string) {
  return name.endsWith('.lync') || name.endsWith('.conflicts') || name === 'pending.events';
}

function canonicalLyncSourceKind(name: string): LiveLyncCanonicalPrefix['sourceKind'] {
  if (name.endsWith('.lync')) return 'loom';
  if (name.endsWith('.conflicts')) return 'conflicts';
  if (name === 'pending.events') return 'pending';
  throw new Error(`unsupported canonical Lync source ${name}`);
}

function compareCanonicalLyncSourceNames(left: string, right: string) {
  if (left === 'pending.events') return right === 'pending.events' ? 0 : 1;
  if (right === 'pending.events') return -1;
  return left.localeCompare(right);
}

async function verifyV2(record: any) {
  const lives = episodeLives(record);
  const selectedLives: LiveSelectedLife[] = [];
  const selectionCoverage: Array<
    Readonly<{ entityId: string; status: 'bound' | 'canonical-prefixes-only' | 'textile-only' }>
  > = [];
  const flattened: any[] = [];
  for (const life of lives) {
    if (!Array.isArray(life.sourceFiles) || life.sourceFiles.length === 0) {
      throw new Error(`live v2 episode has no Lync sources for ${life.entityId}`);
    }
    const directory = plainDirectory(life.lyncDirectory, `${life.entityId} Lync directory`);
    const textileSources = life.sourceFiles.map((source: any) => {
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
    const hasCanonicalSources = life.canonicalSourceFiles !== undefined;
    const hasSelectedLife = life.selectedLife !== undefined;
    if (hasSelectedLife && !hasCanonicalSources) {
      throw new Error(`live v2 checkpoint selection fields are incomplete for ${life.entityId}`);
    }
    if (hasCanonicalSources && hasSelectedLife) {
      const canonicalSources = verifyCanonicalLifeCheckpoint(life, directory, textileSources);
      selectedLives.push(
        await verifySelectedLifeCheckpoint(
          life.selectedLife,
          life.entityId,
          directory,
          canonicalSources,
        ),
      );
      selectionCoverage.push({ entityId: life.entityId, status: 'bound' });
    } else if (hasCanonicalSources) {
      verifyCanonicalLifeCheckpoint(life, directory, textileSources);
      selectionCoverage.push({ entityId: life.entityId, status: 'canonical-prefixes-only' });
    } else {
      selectionCoverage.push({ entityId: life.entityId, status: 'textile-only' });
    }
    flattened.push(...textileSources);
  }
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
  return deepFreeze({
    version: 2 as const,
    orderedSources: expectedSources,
    selectedLives,
    selectionCoverage,
    artifact,
  });
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

function verifyCanonicalLifeCheckpoint(
  life: any,
  directory: string,
  textileSources: ReadonlyArray<any>,
): LiveLyncCanonicalPrefix[] {
  if (!Array.isArray(life.canonicalSourceFiles) || life.canonicalSourceFiles.length === 0) {
    throw new Error(`live v2 episode has no canonical Lync sources for ${life.entityId}`);
  }
  const sources = life.canonicalSourceFiles.map((source: any) => {
    const sourceKind = canonicalLyncSourceKind(path.basename(String(source?.sourceFile || '')));
    if (
      source?.protocol !== LIVE_LYNC_CANONICAL_PREFIX_PROTOCOL ||
      source.entityId !== life.entityId ||
      source.sourceKind !== sourceKind ||
      source.startOffset !== 0 ||
      source.endOffset !== source.sizeBytes ||
      !Number.isSafeInteger(source.sizeBytes) ||
      source.sizeBytes < 0 ||
      !exactSha256(source.sha256) ||
      source.preservation !== 'immutable_prefix_of_canonical_append_only_source' ||
      (sourceKind === 'loom'
        ? !SUPPORTED_PROFILES.includes(source.presentationProfile)
        : source.presentationProfile !== null)
    ) {
      throw new Error(`malformed canonical Lync prefix for ${life.entityId}`);
    }
    const sourceFile = plainFile(source.sourceFile, `${life.entityId} canonical Lync source`);
    if (source.sourceFile !== sourceFile || path.dirname(sourceFile) !== directory) {
      throw new Error(`canonical Lync prefix escapes ${life.entityId}'s directory`);
    }
    const verified = verifyCanonicalPrefix(sourceFile, source);
    if (sourceKind === 'loom' && verified.profile !== source.presentationProfile) {
      throw new Error(`canonical Lync profile changed for ${life.entityId}`);
    }
    return source as LiveLyncCanonicalPrefix;
  });
  assertCanonicalSourceSet(life.entityId, directory, sources);
  const expectedTextile = sources
    .filter((source) => source.sourceKind === 'loom')
    .map((source) => ({
      sourceFile: source.sourceFile,
      sizeBytes: source.sizeBytes,
      sha256: source.sha256,
      presentationProfile: source.presentationProfile,
    }));
  const actualTextile = textileSources.map((source) => ({
    sourceFile: source.sourceFile,
    sizeBytes: source.sizeBytes,
    sha256: source.sha256,
    presentationProfile: source.presentationProfile,
  }));
  if (stableJson(expectedTextile) !== stableJson(actualTextile)) {
    throw new Error(`Textile sources differ from canonical loom sources for ${life.entityId}`);
  }
  return sources;
}

function verifyCanonicalPrefix(file: string, source: LiveLyncCanonicalPrefix) {
  const descriptor = openReadOnlyNoFollow(file, `${source.entityId} canonical Lync source`);
  try {
    const before = regularFileStats(descriptor, `${source.entityId} canonical Lync source`);
    if (before.size < source.sizeBytes) {
      throw new Error(`canonical Lync prefix was truncated for ${source.entityId}`);
    }
    const actual = hashDescriptorPrefix(descriptor, source.sizeBytes, source.sourceKind === 'loom');
    const after = regularFileStats(descriptor, `${source.entityId} canonical Lync source`);
    if (!sameFile(before, after) || after.size < source.sizeBytes) {
      throw new Error(`canonical Lync prefix changed while verifying ${source.entityId}`);
    }
    assertPathStillNamesDescriptor(
      file,
      before,
      source.sizeBytes,
      `${source.entityId} canonical Lync source`,
    );
    if (actual.sha256 !== source.sha256) {
      throw new Error(`canonical Lync prefix digest mismatch for ${source.entityId}`);
    }
    return {
      profile:
        source.sourceKind === 'loom'
          ? presentationProfile(actual.firstLine, source.entityId)
          : null,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertCanonicalSourceSet(
  entityId: string,
  directory: string,
  sources: ReadonlyArray<LiveLyncCanonicalPrefix>,
) {
  const names = sources.map((source) => {
    if (source.entityId !== entityId || path.dirname(source.sourceFile) !== directory) {
      throw new Error(`canonical Lync source ownership differs for ${entityId}`);
    }
    return path.basename(source.sourceFile);
  });
  if (new Set(names).size !== names.length) {
    throw new Error(`canonical Lync source is duplicated for ${entityId}`);
  }
  const ordered = [...names].sort(compareCanonicalLyncSourceNames);
  if (stableJson(names) !== stableJson(ordered)) {
    throw new Error(`canonical Lync source order changed for ${entityId}`);
  }
  if (!sources.some((source) => source.sourceKind === 'loom')) {
    throw new Error(`canonical Lync source set has no loom for ${entityId}`);
  }
}

async function verifySelectedLifeCheckpoint(
  selected: any,
  entityId: string,
  directory: string,
  sources: ReadonlyArray<LiveLyncCanonicalPrefix>,
): Promise<LiveSelectedLife> {
  if (
    selected?.protocol !== LIVE_SELECTED_LIFE_PROTOCOL ||
    selected.entityId !== entityId ||
    (selected.circleId !== null && typeof selected.circleId !== 'string') ||
    typeof selected.loomId !== 'string' ||
    !selected.loomId.startsWith('lync:') ||
    !Number.isSafeInteger(selected.depth) ||
    selected.depth < 0
  ) {
    throw new Error(`malformed selected Lync life for ${entityId}`);
  }
  if (selected.depth === 0) {
    if (
      selected.tipTurnId !== null ||
      selected.bodyDigest !== null ||
      selected.chainDigest !== null ||
      selected.canonical !== null ||
      selected.checkpoint !== null
    ) {
      throw new Error(`empty selected Lync life has a tip for ${entityId}`);
    }
    return selected as LiveSelectedLife;
  }
  const canonical = selected.canonical;
  if (
    typeof selected.tipTurnId !== 'string' ||
    !exactSha256(selected.bodyDigest) ||
    !exactSha256(selected.chainDigest) ||
    !canonical ||
    typeof canonical.source !== 'string' ||
    !Number.isSafeInteger(canonical.line) ||
    canonical.line < 2 ||
    !Number.isSafeInteger(canonical.start) ||
    !Number.isSafeInteger(canonical.end) ||
    canonical.start < 0 ||
    canonical.end <= canonical.start ||
    !['', '\n'].includes(canonical.terminator) ||
    !exactSha256(canonical.rawSha256)
  ) {
    throw new Error(`malformed selected Lync tip for ${entityId}`);
  }
  const checkpoint = selected.checkpoint as FileLoomCheckpoint | undefined;
  if (
    !checkpoint ||
    checkpoint.loomId !== selected.loomId ||
    checkpoint.tip.id !== selected.tipTurnId
  ) {
    throw new Error(`selected Lync checkpoint identity differs for ${entityId}`);
  }
  const expectedSources = sources.map((source) => ({
    file: path.basename(source.sourceFile),
    size: source.sizeBytes,
    sha256: source.sha256,
  }));
  if (stableJson(checkpoint.sources) !== stableJson(expectedSources)) {
    throw new Error(`selected Lync checkpoint source set differs for ${entityId}`);
  }
  const { verifyFileLoomCheckpoint } = await import('@deepfates/lync/file-loom-checkpoint');
  const actual = await verifyFileLoomCheckpoint(directory, checkpoint);
  if (
    actual.id !== selected.tipTurnId ||
    actual.depth !== selected.depth ||
    actual.bodyDigest !== selected.bodyDigest ||
    actual.chainDigest !== selected.chainDigest ||
    actual.locator.file !== canonical.source ||
    actual.locator.line !== canonical.line ||
    actual.locator.start !== canonical.start ||
    actual.locator.end !== canonical.end ||
    actual.locator.terminator !== canonical.terminator ||
    actual.locator.rawSha256 !== canonical.rawSha256
  ) {
    throw new Error(`selected Lync tip identity differs for ${entityId}`);
  }
  return selected as LiveSelectedLife;
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
