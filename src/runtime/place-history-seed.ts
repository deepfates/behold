import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { digestTree } from '../../scripts/world-lab';
import {
  assertPlaceServedResumeContinuity,
  type PlaceServedWorldDescriptor,
} from './place-served-world';
import { verifyMinecraftWorldHistoryFork, type MinecraftWorldHistoryFork } from './world-history';

const PLACE_HISTORY_SEED_PROTOCOL = 'behold.place-history-seed.v1' as const;
const PLACE_RUNTIME_FILES = Object.freeze([
  'runtime-manifest.json',
  'server.properties',
  'eula.txt',
  'banned-ips.json',
  'banned-players.json',
  'ops.json',
  'whitelist.json',
]);

type SourceContinuity = ReturnType<typeof assertPlaceServedResumeContinuity>;

export type PlaceHistorySeedDependencies = Readonly<{
  verifyFork?: typeof verifyMinecraftWorldHistoryFork;
  assertSourceContinuity?: typeof assertPlaceServedResumeContinuity;
  validateStagedRuntime?: (runtimeRoot: string) => void;
}>;

/**
 * Bridge an authenticated stopped Behold world-history child into the exact
 * mutable runtime shape Place already owns. This is a new-session operation;
 * it copies no resident, controller, episode, cache, or log state.
 */
export async function stagePlaceHistorySeed(
  input: Readonly<{
    receiptFile: string;
    historyId: string;
    releaseRoot: string;
    serverJar: string;
    destinationRuntimeRoot: string;
  }>,
  dependencies: PlaceHistorySeedDependencies = {},
) {
  const receiptFile = plainFile(input.receiptFile, 'world-history receipt');
  const receiptBytes = fs.readFileSync(receiptFile);
  const receiptSha256 = sha256Bytes(receiptBytes);
  const receipt = JSON.parse(receiptBytes.toString('utf8')) as MinecraftWorldHistoryFork;
  const verifyFork = dependencies.verifyFork ?? verifyMinecraftWorldHistoryFork;
  const verification = await verifyFork(receipt);
  const historyId = safeSegment(input.historyId, 'history id');
  const history = receipt.histories.find((candidate) => candidate.historyId === historyId);
  const verifiedHistory = verification.histories.find(
    (candidate) => candidate.historyId === historyId,
  );
  if (!history || !verifiedHistory)
    throw new Error(`world-history receipt has no child ${historyId}`);
  if (verifiedHistory.diverged || verifiedHistory.currentDigest !== history.initialDigest) {
    throw new Error(`world-history child ${historyId} has already diverged from its checkpoint`);
  }

  const sourceWorld = plainDirectory(receipt.checkpoint.sourceRuntimePath, 'source runtime world');
  const sourceRuntimeRoot = plainDirectory(path.dirname(sourceWorld), 'source Place runtime');
  const sourceSessionRoot = plainDirectory(path.dirname(sourceRuntimeRoot), 'source live session');
  const descriptorFile = plainFile(
    path.join(sourceSessionRoot, 'genesis', 'place-served-world.json'),
    'source served-world descriptor',
  );
  const headFile = plainFile(path.join(sourceSessionRoot, 'head.json'), 'source served-world head');
  const assertContinuity = dependencies.assertSourceContinuity ?? assertPlaceServedResumeContinuity;
  const source = assertContinuity(descriptorFile, headFile) as SourceContinuity;
  assertSeedBasis({
    input,
    receipt,
    history,
    verification,
    source,
    sourceWorld,
    sourceRuntimeRoot,
  });

  const destination = path.resolve(input.destinationRuntimeRoot);
  if (fs.existsSync(destination)) {
    throw new Error(`history-seeded Place runtime destination exists: ${destination}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const staging = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.history-seed-${randomUUID()}`,
  );
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    const sourceFiles = snapshotRuntimeFiles(sourceRuntimeRoot);
    for (const item of sourceFiles) {
      fs.copyFileSync(item.source, path.join(staging, item.name), fs.constants.COPYFILE_FICLONE);
    }
    copyPlainTree(history.worldPath, path.join(staging, 'world'));
    const copied = digestTree(path.join(staging, 'world'));
    const childAfter = digestTree(history.worldPath);
    if (
      copied.digest !== history.initialDigest ||
      childAfter.digest !== history.initialDigest ||
      sha256Bytes(fs.readFileSync(receiptFile)) !== receiptSha256
    ) {
      throw new Error('world-history basis changed while its Place runtime was being staged');
    }
    assertRuntimeFilesUnchanged(sourceFiles);
    const sourceAfter = assertContinuity(descriptorFile, headFile) as SourceContinuity;
    if (
      sourceAfter.runtime.digest !== receipt.checkpoint.digest ||
      sourceAfter.head?.runtimeDigest !== receipt.checkpoint.digest
    ) {
      throw new Error('source Place head changed while its history child was being staged');
    }
    dependencies.validateStagedRuntime?.(staging);
    syncPlainTree(staging);
    fs.renameSync(staging, destination);
    fsyncDirectory(path.dirname(destination));
    return Object.freeze({
      protocol: PLACE_HISTORY_SEED_PROTOCOL,
      receiptFile,
      receiptSha256,
      operationId: receipt.operationId,
      worldId: receipt.worldId,
      checkpointDigest: receipt.checkpoint.digest,
      historyId,
      initialDigest: history.initialDigest,
      sourceSessionRoot,
      sourceRuntimeRoot,
      destinationRuntimeRoot: destination,
      runtimeManifestSha256: sha256File(path.join(destination, 'runtime-manifest.json')),
    });
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function assertSeedBasis(input: {
  input: Readonly<{ releaseRoot: string; serverJar: string }>;
  receipt: MinecraftWorldHistoryFork;
  history: MinecraftWorldHistoryFork['histories'][number];
  verification: Awaited<ReturnType<typeof verifyMinecraftWorldHistoryFork>>;
  source: SourceContinuity;
  sourceWorld: string;
  sourceRuntimeRoot: string;
}) {
  const { receipt, history, verification, source, sourceWorld, sourceRuntimeRoot } = input;
  const descriptor: PlaceServedWorldDescriptor = source.descriptor;
  const releaseRoot = plainDirectory(input.input.releaseRoot, 'Place release');
  const serverJar = plainFile(input.input.serverJar, 'Minecraft server JAR');
  if (!source.head)
    throw new Error('world-history live seed requires an authenticated source head');
  if (
    verification.worldId !== receipt.worldId ||
    descriptor.worldId !== receipt.worldId ||
    descriptor.paths.runtimeRoot !== sourceRuntimeRoot ||
    descriptor.paths.runtimeWorld !== sourceWorld ||
    receipt.checkpoint.digest !== source.runtime.digest ||
    receipt.checkpoint.digest !== source.head.runtimeDigest ||
    receipt.checkpoint.digest !== history.initialDigest
  ) {
    throw new Error('world-history receipt differs from its stopped Place source head');
  }
  if (descriptor.paths.release !== releaseRoot) {
    throw new Error('world-history source release differs from the requested Place release');
  }
  if (descriptor.origin.profileId !== 'living') {
    throw new Error('world-history source does not use the ordinary living Place profile');
  }
  if (sha256File(serverJar) !== descriptor.origin.minecraftServerSha256) {
    throw new Error('world-history source server differs from the requested Minecraft server');
  }
  const runtimeManifest = JSON.parse(
    fs.readFileSync(
      plainFile(path.join(sourceRuntimeRoot, 'runtime-manifest.json'), 'runtime manifest'),
      'utf8',
    ),
  );
  if (
    runtimeManifest?.schemaVersion !== 2 ||
    runtimeManifest?.kind !== 'place-release-preview' ||
    runtimeManifest?.profileId !== 'living' ||
    runtimeManifest?.world !== 'world' ||
    runtimeManifest?.sourceReleaseManifestSha256 !==
      descriptor.origin.sourceReleaseManifestSha256 ||
    runtimeManifest?.minecraftServerSha256 !== descriptor.origin.minecraftServerSha256
  ) {
    throw new Error(
      'world-history source runtime manifest is not an ordinary living Place runtime',
    );
  }
}

function snapshotRuntimeFiles(root: string) {
  return PLACE_RUNTIME_FILES.flatMap((name) => {
    const source = path.join(root, name);
    if (!fs.existsSync(source)) {
      if (['runtime-manifest.json', 'server.properties', 'eula.txt'].includes(name)) {
        throw new Error(`source Place runtime lacks required file ${name}`);
      }
      return [];
    }
    plainFile(source, `source Place runtime ${name}`);
    return [{ name, source, sha256: sha256File(source) }];
  });
}

function assertRuntimeFilesUnchanged(
  files: readonly { source: string; name: string; sha256: string }[],
) {
  for (const file of files) {
    if (sha256File(file.source) !== file.sha256) {
      throw new Error(`source Place runtime file changed while staging: ${file.name}`);
    }
  }
}

function copyPlainTree(source: string, destination: string) {
  const sourceRoot = plainDirectory(source, 'history child world');
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const from = path.join(sourceRoot, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyPlainTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE);
    else throw new Error(`history child world contains unsupported entry: ${from}`);
  }
}

function syncPlainTree(root: string) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) syncPlainTree(full);
    else if (entry.isFile()) {
      const descriptor = fs.openSync(full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    } else throw new Error(`staged Place runtime contains unsupported entry: ${full}`);
  }
  fsyncDirectory(root);
}

function plainFile(value: string, label: string) {
  const file = path.resolve(value);
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} is not a plain file`);
  return file;
}

function plainDirectory(value: string, label: string) {
  const directory = path.resolve(value);
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a plain directory`);
  }
  return fs.realpathSync.native(directory);
}

function safeSegment(value: string, label: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || ''))) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function sha256File(file: string) {
  return sha256Bytes(fs.readFileSync(plainFile(file, 'digest input')));
}

function sha256Bytes(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
