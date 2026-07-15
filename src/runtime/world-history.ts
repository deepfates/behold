import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  digestTree,
  statusWorld,
  TREE_DIGEST_PROFILE,
  type RuntimeEvidence,
  type WorldLabDefinition,
} from '../../scripts/world-lab';
import {
  acquireWorldControl,
  inspectWorldControl,
  type HeldWorldControl,
  verifyWorldLifecycleJournal,
} from './world-control';

export const MINECRAFT_WORLD_HISTORY_PROTOCOL = 'behold.minecraft-world-history.v1' as const;
export const MINECRAFT_WORLD_HISTORY_LOOM_PROTOCOL =
  'behold.minecraft-world-history-loom.v1' as const;
export const MINECRAFT_WORLD_HISTORY_TURN_PROTOCOL =
  'behold.minecraft-world-history-turn.v1' as const;
export const MINECRAFT_CHECKPOINT_PROTOCOL = 'behold.minecraft-checkpoint.v1' as const;
const MINECRAFT_CHECKPOINT_ARTIFACT_PROTOCOL = 'behold.minecraft-checkpoint-artifact.v1' as const;
export const MINECRAFT_HISTORY_PROTOCOL = 'behold.minecraft-history.v1' as const;
export const MINECRAFT_HISTORY_SERVER_PROTOCOL = 'behold.minecraft-history-server.v1' as const;

export type MinecraftHistoryRequest = Readonly<{
  id: string;
  label: string;
  purpose: string;
}>;

export type MinecraftCheckpointRecord = Readonly<{
  protocol: typeof MINECRAFT_CHECKPOINT_PROTOCOL;
  artifactId: string;
  worldId: string;
  sourceEpoch: number;
  sourceRuntimePath: string;
  digestProfile: typeof TREE_DIGEST_PROFILE;
  digest: string;
  files: number;
  directories: number;
  bytes: number;
  artifactPath: string;
  capturedAt: string;
}>;

export type MinecraftHistoryRecord = Readonly<{
  protocol: typeof MINECRAFT_HISTORY_PROTOCOL;
  historyId: string;
  label: string;
  purpose: string;
  checkpointArtifactId: string;
  checkpointDigest: string;
  digestProfile: typeof TREE_DIGEST_PROFILE;
  initialDigest: string;
  worldPath: string;
  archiveRoot: string;
  materializedAt: string;
}>;

export type MinecraftHistoryServer = Readonly<{
  protocol: typeof MINECRAFT_HISTORY_SERVER_PROTOCOL;
  historyId: string;
  checkpointArtifactId: string;
  initialWorldDigest: string;
  serverDirectory: string;
  worldPath: string;
  host: string;
  port: number;
  template: Readonly<{
    directory: string;
    files: readonly Readonly<{ name: string; sha256: string }>[];
  }>;
  profile: Readonly<{
    levelName: string;
    onlineMode: false;
  }>;
  preparedFiles: readonly Readonly<{ name: string; sha256: string }>[];
  manifestFile: string;
  preparedAt: string;
}>;

export type MinecraftWorldHistoryFork = Readonly<{
  protocol: typeof MINECRAFT_WORLD_HISTORY_PROTOCOL;
  operationId: string;
  worldId: string;
  sourceEpoch: number;
  checkpoint: MinecraftCheckpointRecord;
  histories: readonly MinecraftHistoryRecord[];
  lineage: Readonly<{
    loomId: string;
    file: string;
    sourceTurnId: string;
    checkpointTurnId: string;
    historyTurnIds: readonly string[];
  }>;
  lifecycleJournal: string;
}>;

export type ForkStoppedMinecraftWorldOptions = Readonly<{
  operationId: string;
  worldId: string;
  world: WorldLabDefinition;
  controlRoot: string;
  historyRoot: string;
  histories: readonly MinecraftHistoryRequest[];
  actor: string;
  now?: () => Date;
}>;

export type WorldHistoryDependencies = Readonly<{
  inspectRuntime?: () => Promise<RuntimeEvidence>;
  beforeSourceRecheck?: () => void | Promise<void>;
}>;

type WorldHistoryLoomMeta = Readonly<{
  protocol: typeof MINECRAFT_WORLD_HISTORY_LOOM_PROTOCOL;
  worldId: string;
  operationId: string;
}>;

type WorldHistoryTurnMeta = Readonly<{
  protocol: typeof MINECRAFT_WORLD_HISTORY_TURN_PROTOCOL;
  kind: 'source' | 'checkpoint' | 'history';
}>;

type WorldHistoryTurn =
  | Readonly<{
      protocol: typeof MINECRAFT_WORLD_HISTORY_TURN_PROTOCOL;
      kind: 'source';
      worldId: string;
      sourceEpoch: number;
      runtimePath: string;
      runtimeDigest: string;
    }>
  | Readonly<{
      protocol: typeof MINECRAFT_WORLD_HISTORY_TURN_PROTOCOL;
      kind: 'checkpoint';
      checkpoint: MinecraftCheckpointRecord;
    }>
  | Readonly<{
      protocol: typeof MINECRAFT_WORLD_HISTORY_TURN_PROTOCOL;
      kind: 'history';
      history: MinecraftHistoryRecord;
    }>;

type MinecraftCheckpointArtifactManifest = Readonly<{
  protocol: typeof MINECRAFT_CHECKPOINT_ARTIFACT_PROTOCOL;
  artifactId: string;
  digestProfile: typeof TREE_DIGEST_PROFILE;
  digest: string;
  files: number;
  directories: number;
  bytes: number;
}>;

/**
 * Seal one exact stopped Minecraft runtime and materialize independent writable
 * children. The source world remains the current history and is never renamed,
 * reset, or made writable through this operation.
 */
export async function forkStoppedMinecraftWorld(
  options: ForkStoppedMinecraftWorldOptions,
  dependencies: WorldHistoryDependencies = {},
): Promise<MinecraftWorldHistoryFork> {
  const operationId = safeSegment(options.operationId, 'world-history operation id');
  const worldId = safeSegment(options.worldId, 'world id');
  const actor = nonEmpty(options.actor, 'world-history actor');
  const histories = normalizeHistoryRequests(options.histories);
  const historyRoot = path.resolve(options.historyRoot);
  const inspectRuntime = dependencies.inspectRuntime ?? (() => statusWorld(worldId, options.world));
  const now = options.now ?? (() => new Date());

  const existing = inspectWorldControl(options.controlRoot, worldId);
  if (existing.state !== 'clear') {
    throw new Error(`world history requires clear world control; found ${existing.state}`);
  }
  assertStoppedRuntime(await inspectRuntime(), 'before_history_control');

  const control = acquireWorldControl({
    controlRoot: options.controlRoot,
    world: worldId,
    runtimePath: options.world.runtime.worldPath,
    now,
  });
  let operationCompleted = false;
  try {
    const held = control.record();
    assertStoppedRuntime(await inspectRuntime(), 'after_history_control');
    control.append('world_history_checkpoint_started', {
      operationId,
      historyCount: histories.length,
    });

    const sourcePath = fs.realpathSync.native(path.resolve(options.world.runtime.worldPath));
    if (pathsOverlap(sourcePath, historyRoot)) {
      throw new Error('world-history storage must be separate from the source Minecraft runtime');
    }
    const sourceBefore = digestTree(sourcePath);
    const checkpoint = captureCheckpoint({
      historyRoot,
      worldId,
      sourceEpoch: held.epoch,
      sourcePath,
      sourceDigest: sourceBefore,
      capturedAt: now().toISOString(),
    });
    await dependencies.beforeSourceRecheck?.();
    const sourceAfter = digestTree(sourcePath);
    if (sourceAfter.digest !== sourceBefore.digest) {
      throw new Error('source Minecraft runtime changed while its checkpoint was being sealed');
    }
    const materialized = histories.map((request) =>
      materializeHistory(historyRoot, checkpoint, request, now().toISOString()),
    );
    const lineage = await recordLineage({
      historyRoot,
      operationId,
      worldId,
      actor,
      sourceEpoch: held.epoch,
      sourcePath,
      sourceDigest: sourceBefore.digest,
      checkpoint,
      histories: materialized,
    });
    control.append('world_history_checkpoint_completed', {
      operationId,
      checkpointArtifactId: checkpoint.artifactId,
      checkpointDigest: checkpoint.digest,
      histories: materialized.map((history) => ({
        historyId: history.historyId,
        initialDigest: history.initialDigest,
      })),
      lineage: {
        loomId: lineage.loomId,
        sourceTurnId: lineage.sourceTurnId,
        checkpointTurnId: lineage.checkpointTurnId,
        historyTurnIds: lineage.historyTurnIds,
      },
    });
    operationCompleted = true;
    return deepFreeze({
      protocol: MINECRAFT_WORLD_HISTORY_PROTOCOL,
      operationId,
      worldId,
      sourceEpoch: held.epoch,
      checkpoint,
      histories: materialized,
      lineage,
      lifecycleJournal: control.journalFile,
    });
  } catch (error: any) {
    try {
      control.append('world_history_checkpoint_failed', {
        operationId,
        error: String(error?.message || error),
      });
    } catch {}
    throw error;
  } finally {
    releaseStoppedControl(control, operationCompleted);
  }
}

/** A normal managed-runner definition for one isolated child history. */
export function minecraftHistoryWorldDefinition(
  parent: WorldLabDefinition,
  checkpoint: MinecraftCheckpointRecord,
  history: MinecraftHistoryRecord,
  port = parent.server.port,
): WorldLabDefinition {
  return deepFreeze({
    label: history.label,
    source: structuredClone(parent.source),
    preparedBaseline: {
      path: checkpoint.artifactPath,
      digestProfile: TREE_DIGEST_PROFILE,
      expectedDigest: checkpoint.digest,
    },
    runtime: { worldPath: history.worldPath, archiveRoot: history.archiveRoot },
    server: { host: parent.server.host, port },
    notes: [
      ...(parent.notes ?? []),
      `Writable history ${history.historyId} descended from ${checkpoint.artifactId}.`,
    ],
  });
}

const HISTORY_SERVER_POLICY_FILES = Object.freeze([
  'banned-ips.json',
  'banned-players.json',
  'ops.json',
  'whitelist.json',
]);

/**
 * Give one writable history its own vanilla server directory without copying
 * logs, caches, plugins, or another world's save. Minecraft remains the only
 * runtime mutator of history.worldPath.
 */
export function prepareMinecraftHistoryServer(
  input: Readonly<{
    history: MinecraftHistoryRecord;
    templateServerDirectory: string;
    host?: string;
    port: number;
    now?: () => Date;
  }>,
): MinecraftHistoryServer {
  const history = parseHistory(input.history);
  const port = boundedPort(input.port);
  const host = input.host?.trim() || '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Minecraft history servers currently require a loopback host');
  }
  const serverDirectory = path.dirname(history.worldPath);
  const levelName = path.basename(history.worldPath);
  if (!fs.existsSync(history.worldPath) || !fs.statSync(history.worldPath).isDirectory()) {
    throw new Error(`Minecraft history world is missing: ${history.worldPath}`);
  }
  const templateDirectory = fs.realpathSync.native(path.resolve(input.templateServerDirectory));
  if (!fs.statSync(templateDirectory).isDirectory()) {
    throw new Error('Minecraft history server template is not a directory');
  }
  if (pathsOverlap(templateDirectory, history.worldPath)) {
    throw new Error('Minecraft history server template must be outside the writable history');
  }
  const templatePropertiesFile = requiredPlainFile(templateDirectory, 'server.properties');
  const templateEulaFile = requiredPlainFile(templateDirectory, 'eula.txt');
  const eula = fs.readFileSync(templateEulaFile, 'utf8');
  if (!/^\s*eula\s*=\s*true\s*$/m.test(eula)) {
    throw new Error('Minecraft history server template has not accepted the EULA');
  }
  const properties = parseServerProperties(fs.readFileSync(templatePropertiesFile, 'utf8'));
  if (String(properties.get('online-mode') || 'true').toLowerCase() !== 'false') {
    throw new Error('Minecraft history server requires the currently supported offline body mode');
  }
  properties.set('level-name', levelName);
  properties.set('server-ip', host === 'localhost' ? '127.0.0.1' : host);
  properties.set('server-port', String(port));
  properties.set('query.port', String(port));
  const preparedProperties = serializeServerProperties(properties);
  const templateFiles = [templatePropertiesFile, templateEulaFile];
  const policyFiles = HISTORY_SERVER_POLICY_FILES.flatMap((name) => {
    const file = path.join(templateDirectory, name);
    if (!fs.existsSync(file)) return [];
    assertPlainFile(file);
    return [file];
  });
  templateFiles.push(...policyFiles);

  const manifestFile = path.join(serverDirectory, 'server-launch.json');
  if (fs.existsSync(manifestFile)) {
    const existing = parseHistoryServer(readJson(manifestFile));
    if (
      existing.historyId !== history.historyId ||
      existing.checkpointArtifactId !== history.checkpointArtifactId ||
      existing.host !== (host === 'localhost' ? '127.0.0.1' : host) ||
      existing.port !== port ||
      existing.serverDirectory !== serverDirectory ||
      existing.worldPath !== history.worldPath
    ) {
      throw new Error('existing Minecraft history server profile is inconsistent');
    }
    assertPreparedServerProfile(existing);
    return existing;
  }
  if (digestTree(history.worldPath).digest !== history.initialDigest) {
    throw new Error('Minecraft history server must be prepared before its world diverges');
  }

  const outputs = [
    { name: 'server.properties', bytes: Buffer.from(preparedProperties, 'utf8') },
    { name: 'eula.txt', bytes: fs.readFileSync(templateEulaFile) },
    ...policyFiles.map((file) => ({ name: path.basename(file), bytes: fs.readFileSync(file) })),
  ];
  for (const output of outputs) {
    const destination = path.join(serverDirectory, output.name);
    if (fs.existsSync(destination)) {
      throw new Error(`refusing to replace existing Minecraft history server file: ${destination}`);
    }
    durableWriteBytes(destination, output.bytes);
  }
  const preparedAt = (input.now ?? (() => new Date()))().toISOString();
  const record: MinecraftHistoryServer = {
    protocol: MINECRAFT_HISTORY_SERVER_PROTOCOL,
    historyId: history.historyId,
    checkpointArtifactId: history.checkpointArtifactId,
    initialWorldDigest: history.initialDigest,
    serverDirectory,
    worldPath: history.worldPath,
    host: host === 'localhost' ? '127.0.0.1' : host,
    port,
    template: {
      directory: templateDirectory,
      files: templateFiles.map((file) => ({
        name: path.basename(file),
        sha256: sha256File(file),
      })),
    },
    profile: { levelName, onlineMode: false },
    preparedFiles: outputs.map((output) => ({
      name: output.name,
      sha256: sha256Bytes(output.bytes),
    })),
    manifestFile,
    preparedAt,
  };
  durableWriteJson(manifestFile, record);
  assertPreparedServerProfile(record);
  return deepFreeze(record);
}

/** Semantic verification remains valid after vanilla rewrites properties comments. */
export function verifyMinecraftHistoryServer(value: MinecraftHistoryServer) {
  const record = parseHistoryServer(value);
  const manifest = parseHistoryServer(readJson(record.manifestFile));
  if (stableJson(manifest) !== stableJson(record)) {
    throw new Error('Minecraft history server manifest differs from its receipt');
  }
  assertPreparedServerProfile(record);
  const currentWorld = digestTree(record.worldPath);
  return deepFreeze({
    protocol: MINECRAFT_HISTORY_SERVER_PROTOCOL,
    historyId: record.historyId,
    profileIntegrityOk: true,
    currentWorldDigest: currentWorld.digest,
    worldDiverged: currentWorld.digest !== record.initialWorldDigest,
  });
}

/**
 * Reopen the lineage loom and the filesystem artifacts independently of the
 * creator. Writable histories may have diverged; their current digests are
 * reported instead of being confused with their common initial checkpoint.
 */
export async function verifyMinecraftWorldHistoryFork(value: MinecraftWorldHistoryFork) {
  const artifactManifest = parseCheckpointArtifact(
    readJson(path.join(path.dirname(value.checkpoint.artifactPath), 'artifact.json')),
  );
  const checkpointDigest = digestTree(value.checkpoint.artifactPath);
  if (
    checkpointDigest.digest !== value.checkpoint.digest ||
    value.checkpoint.artifactId !== `sha256-${value.checkpoint.digest}` ||
    artifactManifest.artifactId !== value.checkpoint.artifactId ||
    artifactManifest.digest !== checkpointDigest.digest
  ) {
    throw new Error('Minecraft checkpoint artifact no longer matches its identity');
  }
  const histories = value.histories.map((history) => {
    const manifest = parseHistory(
      readJson(path.join(path.dirname(history.worldPath), 'history.json')),
    );
    if (JSON.stringify(manifest) !== JSON.stringify(history)) {
      throw new Error(`Minecraft history manifest differs from lineage: ${history.historyId}`);
    }
    if (
      history.checkpointArtifactId !== value.checkpoint.artifactId ||
      history.checkpointDigest !== value.checkpoint.digest ||
      history.initialDigest !== value.checkpoint.digest
    ) {
      throw new Error(`Minecraft history has a foreign checkpoint basis: ${history.historyId}`);
    }
    const current = digestTree(history.worldPath);
    return deepFreeze({
      historyId: history.historyId,
      currentDigest: current.digest,
      diverged: current.digest !== history.initialDigest,
    });
  });

  const directory = path.dirname(path.resolve(value.lineage.file));
  const [{ createFileEventStore }, { createLyncLooms, loomRootId }] = await Promise.all([
    import('@deepfates/lync/file-log'),
    import('@deepfates/lync/looms'),
  ]);
  const looms = createLyncLooms<WorldHistoryTurn, WorldHistoryLoomMeta, WorldHistoryTurnMeta>({
    store: createFileEventStore(directory),
    author: { actor: 'behold-world-history-verifier', via: 'behold@0.1.0-alpha.0' },
  });
  const loom = await looms.open(value.lineage.loomId);
  try {
    const info = await loom.info();
    if (
      info.meta?.protocol !== MINECRAFT_WORLD_HISTORY_LOOM_PROTOCOL ||
      info.meta.worldId !== value.worldId ||
      info.meta.operationId !== value.operationId ||
      path.join(directory, `${encodeURIComponent(loomRootId(loom.id))}.lync`) !==
        path.resolve(value.lineage.file)
    ) {
      throw new Error('Minecraft world-history loom metadata differs from its receipt');
    }
    const roots = await loom.childrenOf(null);
    if (roots.length !== 1 || roots[0].id !== value.lineage.sourceTurnId) {
      throw new Error('Minecraft world history requires one exact source root');
    }
    const source = roots[0];
    if (
      source.meta?.kind !== 'source' ||
      source.payload.kind !== 'source' ||
      source.payload.worldId !== value.worldId ||
      source.payload.sourceEpoch !== value.sourceEpoch ||
      source.payload.runtimeDigest !== value.checkpoint.digest
    ) {
      throw new Error('Minecraft world-history source turn differs from its receipt');
    }
    const checkpointChildren = await loom.childrenOf(source.id);
    if (
      checkpointChildren.length !== 1 ||
      checkpointChildren[0].id !== value.lineage.checkpointTurnId ||
      checkpointChildren[0].meta?.kind !== 'checkpoint' ||
      checkpointChildren[0].payload.kind !== 'checkpoint' ||
      JSON.stringify(checkpointChildren[0].payload.checkpoint) !== JSON.stringify(value.checkpoint)
    ) {
      throw new Error('Minecraft world-history checkpoint turn differs from its receipt');
    }
    const branchTurns = await loom.childrenOf(checkpointChildren[0].id);
    if (
      branchTurns.length !== value.histories.length ||
      branchTurns.some(
        (turn, index) =>
          turn.id !== value.lineage.historyTurnIds[index] ||
          turn.meta?.kind !== 'history' ||
          turn.payload.kind !== 'history' ||
          JSON.stringify(turn.payload.history) !== JSON.stringify(value.histories[index]),
      )
    ) {
      throw new Error('Minecraft world-history child turns differ from their receipt');
    }
  } finally {
    loom.close();
  }
  const lifecycle = verifyWorldLifecycleJournal(value.lifecycleJournal);
  const completed = lifecycle.events.filter(
    (event) => event.type === 'world_history_checkpoint_completed',
  );
  if (
    lifecycle.world !== value.worldId ||
    lifecycle.epoch !== value.sourceEpoch ||
    lifecycle.events[0]?.type !== 'control_acquired' ||
    lifecycle.events.at(-1)?.type !== 'control_released' ||
    completed.length !== 1 ||
    (completed[0].data as any)?.operationId !== value.operationId ||
    (completed[0].data as any)?.checkpointArtifactId !== value.checkpoint.artifactId ||
    (completed[0].data as any)?.lineage?.loomId !== value.lineage.loomId
  ) {
    throw new Error('Minecraft world-history lifecycle differs from its receipt');
  }
  return deepFreeze({
    protocol: 'behold.minecraft-world-history-verification.v1' as const,
    operationId: value.operationId,
    worldId: value.worldId,
    checkpointDigest: value.checkpoint.digest,
    checkpointIntegrityOk: true,
    lineageIntegrityOk: true,
    lifecycleIntegrityOk: true,
    histories,
  });
}

function captureCheckpoint(input: {
  historyRoot: string;
  worldId: string;
  sourceEpoch: number;
  sourcePath: string;
  sourceDigest: ReturnType<typeof digestTree>;
  capturedAt: string;
}): MinecraftCheckpointRecord {
  const artifactId = `sha256-${input.sourceDigest.digest}`;
  const checkpointRoot = path.join(input.historyRoot, 'checkpoints', artifactId);
  const artifactPath = path.join(checkpointRoot, 'world');
  const manifestPath = path.join(checkpointRoot, 'artifact.json');
  if (fs.existsSync(checkpointRoot)) {
    const existing = parseCheckpointArtifact(readJson(manifestPath));
    const actual = digestTree(artifactPath);
    if (
      existing.artifactId !== artifactId ||
      existing.digest !== input.sourceDigest.digest ||
      actual.digest !== input.sourceDigest.digest
    ) {
      throw new Error(`existing Minecraft checkpoint is inconsistent: ${artifactId}`);
    }
    return deepFreeze({
      protocol: MINECRAFT_CHECKPOINT_PROTOCOL,
      artifactId,
      worldId: input.worldId,
      sourceEpoch: input.sourceEpoch,
      sourceRuntimePath: input.sourcePath,
      digestProfile: TREE_DIGEST_PROFILE,
      digest: existing.digest,
      files: existing.files,
      directories: existing.directories,
      bytes: existing.bytes,
      artifactPath,
      capturedAt: input.capturedAt,
    });
  }

  ensurePlainDirectory(path.join(input.historyRoot, 'checkpoints'));
  const staging = path.join(input.historyRoot, 'checkpoints', `.capture-${randomUUID()}`);
  try {
    fs.mkdirSync(staging, { mode: 0o700 });
    copyWorldTree(input.sourcePath, path.join(staging, 'world'));
    const copied = digestTree(path.join(staging, 'world'));
    if (copied.digest !== input.sourceDigest.digest) {
      throw new Error('Minecraft checkpoint copy differs from its stopped source');
    }
    const manifest: MinecraftCheckpointArtifactManifest = deepFreeze({
      protocol: MINECRAFT_CHECKPOINT_ARTIFACT_PROTOCOL,
      artifactId,
      digestProfile: TREE_DIGEST_PROFILE,
      digest: copied.digest,
      files: copied.files,
      directories: copied.directories,
      bytes: copied.bytes,
    });
    durableWriteJson(path.join(staging, 'artifact.json'), manifest);
    setTreeMode(staging, 0o555, 0o444);
    fsyncTree(staging);
    fs.renameSync(staging, checkpointRoot);
    fsyncDirectory(path.dirname(checkpointRoot));
    return deepFreeze({
      protocol: MINECRAFT_CHECKPOINT_PROTOCOL,
      artifactId,
      worldId: input.worldId,
      sourceEpoch: input.sourceEpoch,
      sourceRuntimePath: input.sourcePath,
      digestProfile: TREE_DIGEST_PROFILE,
      digest: copied.digest,
      files: copied.files,
      directories: copied.directories,
      bytes: copied.bytes,
      artifactPath: path.join(checkpointRoot, 'world'),
      capturedAt: input.capturedAt,
    });
  } catch (error) {
    makeWritable(staging);
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function materializeHistory(
  historyRoot: string,
  checkpoint: MinecraftCheckpointRecord,
  request: MinecraftHistoryRequest,
  materializedAt: string,
): MinecraftHistoryRecord {
  const historyRootPath = path.join(historyRoot, 'histories', request.id);
  const worldPath = path.join(historyRootPath, 'world');
  const archiveRoot = path.join(historyRootPath, 'archive');
  const manifestPath = path.join(historyRootPath, 'history.json');
  if (fs.existsSync(historyRootPath)) {
    const existing = parseHistory(readJson(manifestPath));
    const actual = digestTree(worldPath);
    if (
      existing.historyId !== request.id ||
      existing.label !== request.label ||
      existing.purpose !== request.purpose ||
      existing.checkpointArtifactId !== checkpoint.artifactId ||
      existing.initialDigest !== checkpoint.digest ||
      actual.digest !== checkpoint.digest
    ) {
      throw new Error(`existing Minecraft history is inconsistent: ${request.id}`);
    }
    return existing;
  }

  ensurePlainDirectory(path.join(historyRoot, 'histories'));
  const staging = path.join(historyRoot, 'histories', `.history-${randomUUID()}`);
  try {
    fs.mkdirSync(staging, { mode: 0o700 });
    copyWorldTree(checkpoint.artifactPath, path.join(staging, 'world'));
    fs.mkdirSync(path.join(staging, 'archive'), { mode: 0o700 });
    setTreeMode(path.join(staging, 'world'), 0o700, 0o600);
    const copied = digestTree(path.join(staging, 'world'));
    if (copied.digest !== checkpoint.digest) {
      throw new Error('writable Minecraft history differs from its checkpoint');
    }
    const history: MinecraftHistoryRecord = deepFreeze({
      protocol: MINECRAFT_HISTORY_PROTOCOL,
      historyId: request.id,
      label: request.label,
      purpose: request.purpose,
      checkpointArtifactId: checkpoint.artifactId,
      checkpointDigest: checkpoint.digest,
      digestProfile: TREE_DIGEST_PROFILE,
      initialDigest: copied.digest,
      worldPath: path.join(historyRootPath, 'world'),
      archiveRoot: path.join(historyRootPath, 'archive'),
      materializedAt,
    });
    durableWriteJson(path.join(staging, 'history.json'), history);
    fsyncTree(staging);
    fs.renameSync(staging, historyRootPath);
    fsyncDirectory(path.dirname(historyRootPath));
    return history;
  } catch (error) {
    makeWritable(staging);
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

async function recordLineage(input: {
  historyRoot: string;
  operationId: string;
  worldId: string;
  actor: string;
  sourceEpoch: number;
  sourcePath: string;
  sourceDigest: string;
  checkpoint: MinecraftCheckpointRecord;
  histories: readonly MinecraftHistoryRecord[];
}) {
  const directory = path.join(input.historyRoot, 'lineage');
  await fsPromises.mkdir(directory, { recursive: true });
  const [{ createFileEventStore }, { createLyncLooms, loomRootId }] = await Promise.all([
    import('@deepfates/lync/file-log'),
    import('@deepfates/lync/looms'),
  ]);
  const looms = createLyncLooms<WorldHistoryTurn, WorldHistoryLoomMeta, WorldHistoryTurnMeta>({
    store: createFileEventStore(directory),
    author: { actor: input.actor, via: 'behold@0.1.0-alpha.0' },
  });
  const info = await looms.create({
    protocol: MINECRAFT_WORLD_HISTORY_LOOM_PROTOCOL,
    worldId: input.worldId,
    operationId: input.operationId,
  });
  const loom = await looms.open(info.id);
  try {
    const source = await loom.appendTurn(
      null,
      {
        protocol: MINECRAFT_WORLD_HISTORY_TURN_PROTOCOL,
        kind: 'source',
        worldId: input.worldId,
        sourceEpoch: input.sourceEpoch,
        runtimePath: input.sourcePath,
        runtimeDigest: input.sourceDigest,
      },
      { protocol: MINECRAFT_WORLD_HISTORY_TURN_PROTOCOL, kind: 'source' },
    );
    const checkpoint = await loom.appendTurn(
      source.id,
      {
        protocol: MINECRAFT_WORLD_HISTORY_TURN_PROTOCOL,
        kind: 'checkpoint',
        checkpoint: input.checkpoint,
      },
      { protocol: MINECRAFT_WORLD_HISTORY_TURN_PROTOCOL, kind: 'checkpoint' },
    );
    const historyTurns = [];
    for (const history of input.histories) {
      historyTurns.push(
        await loom.appendTurn(
          checkpoint.id,
          {
            protocol: MINECRAFT_WORLD_HISTORY_TURN_PROTOCOL,
            kind: 'history',
            history,
          },
          { protocol: MINECRAFT_WORLD_HISTORY_TURN_PROTOCOL, kind: 'history' },
        ),
      );
    }
    return deepFreeze({
      loomId: loom.id,
      file: path.join(directory, `${encodeURIComponent(loomRootId(loom.id))}.lync`),
      sourceTurnId: source.id,
      checkpointTurnId: checkpoint.id,
      historyTurnIds: historyTurns.map((turn) => turn.id),
    });
  } finally {
    loom.close();
  }
}

function normalizeHistoryRequests(values: readonly MinecraftHistoryRequest[]) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 32) {
    throw new Error('world history requires between one and 32 child histories');
  }
  const ids = new Set<string>();
  return values.map((value, index) => {
    const id = safeSegment(value?.id, `history ${index} id`);
    if (ids.has(id)) throw new Error(`duplicate Minecraft history id: ${id}`);
    ids.add(id);
    return deepFreeze({
      id,
      label: boundedText(value?.label, `history ${id} label`, 2, 120),
      purpose: boundedText(value?.purpose, `history ${id} purpose`, 3, 1_000),
    });
  });
}

function assertStoppedRuntime(value: RuntimeEvidence, phase: string) {
  if (
    !value.safe ||
    !value.runtimeExists ||
    value.runtimeSessionLock.state !== 'clear' ||
    value.serverPort.state !== 'clear'
  ) {
    throw new Error(`world history requires a stopped runtime during ${phase}`);
  }
}

function releaseStoppedControl(control: HeldWorldControl, completed: boolean) {
  const record = control.record();
  if (record.state !== 'stopped_verified' || record.server || record.controllers.length) {
    throw new Error('world history lost stopped world-control invariants');
  }
  if (!completed) control.append('world_history_checkpoint_aborted');
  control.release();
}

function copyWorldTree(from: string, to: string) {
  fs.cpSync(from, to, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
    dereference: false,
    filter: (entry) => path.relative(from, entry) !== 'session.lock',
  });
}

function ensurePlainDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`world-history path is not a plain directory: ${directory}`);
  }
}

function setTreeMode(root: string, directoryMode: number, fileMode: number) {
  fs.chmodSync(root, directoryMode);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`world-history tree contains symlink: ${full}`);
    if (entry.isDirectory()) setTreeMode(full, directoryMode, fileMode);
    else if (entry.isFile()) fs.chmodSync(full, fileMode);
    else throw new Error(`world-history tree contains unsupported entry: ${full}`);
  }
}

function makeWritable(root: string) {
  if (!fs.existsSync(root)) return;
  try {
    setTreeMode(root, 0o700, 0o600);
  } catch {}
}

function fsyncTree(root: string) {
  const directories: string[] = [root];
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`cannot fsync symlink: ${full}`);
      if (entry.isDirectory()) {
        directories.push(full);
        visit(full);
      } else if (entry.isFile()) files.push(full);
      else throw new Error(`cannot fsync unsupported entry: ${full}`);
    }
  };
  visit(root);
  for (const file of files) {
    const descriptor = fs.openSync(file, 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }
  for (const directory of directories.reverse()) fsyncDirectory(directory);
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function durableWriteJson(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
}

function parseCheckpointArtifact(value: any): MinecraftCheckpointArtifactManifest {
  if (
    value?.protocol !== MINECRAFT_CHECKPOINT_ARTIFACT_PROTOCOL ||
    value.digestProfile !== TREE_DIGEST_PROFILE ||
    !/^[a-f0-9]{64}$/.test(String(value.digest || '')) ||
    value.artifactId !== `sha256-${value.digest}`
  ) {
    throw new Error('invalid Minecraft checkpoint artifact manifest');
  }
  return deepFreeze(value as MinecraftCheckpointArtifactManifest);
}

function parseHistory(value: any): MinecraftHistoryRecord {
  if (
    value?.protocol !== MINECRAFT_HISTORY_PROTOCOL ||
    value.digestProfile !== TREE_DIGEST_PROFILE ||
    !/^[a-f0-9]{64}$/.test(String(value.initialDigest || ''))
  ) {
    throw new Error('invalid Minecraft history manifest');
  }
  return deepFreeze(value as MinecraftHistoryRecord);
}

function parseHistoryServer(value: any): MinecraftHistoryServer {
  if (
    value?.protocol !== MINECRAFT_HISTORY_SERVER_PROTOCOL ||
    typeof value.historyId !== 'string' ||
    typeof value.checkpointArtifactId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(String(value.initialWorldDigest || '')) ||
    typeof value.serverDirectory !== 'string' ||
    typeof value.worldPath !== 'string' ||
    value.host !== '127.0.0.1' ||
    !Number.isSafeInteger(value.port) ||
    value.port < 1024 ||
    value.port > 65_535 ||
    value.profile?.onlineMode !== false ||
    typeof value.profile?.levelName !== 'string' ||
    !Array.isArray(value.template?.files) ||
    !Array.isArray(value.preparedFiles) ||
    typeof value.manifestFile !== 'string' ||
    typeof value.preparedAt !== 'string'
  ) {
    throw new Error('invalid Minecraft history server profile');
  }
  return deepFreeze(value as MinecraftHistoryServer);
}

function assertPreparedServerProfile(record: MinecraftHistoryServer) {
  if (
    path.resolve(record.serverDirectory) !== path.dirname(path.resolve(record.worldPath)) ||
    path.basename(record.worldPath) !== record.profile.levelName
  ) {
    throw new Error('Minecraft history server profile does not own its declared world path');
  }
  const propertiesFile = requiredPlainFile(record.serverDirectory, 'server.properties');
  const eulaFile = requiredPlainFile(record.serverDirectory, 'eula.txt');
  const properties = parseServerProperties(fs.readFileSync(propertiesFile, 'utf8'));
  const expected = new Map<string, string>([
    ['level-name', record.profile.levelName],
    ['online-mode', 'false'],
    ['server-ip', record.host],
    ['server-port', String(record.port)],
    ['query.port', String(record.port)],
  ]);
  for (const [name, value] of expected) {
    if (String(properties.get(name) || '').toLowerCase() !== value.toLowerCase()) {
      throw new Error(`Minecraft history server property ${name} differs from its profile`);
    }
  }
  if (!/^\s*eula\s*=\s*true\s*$/m.test(fs.readFileSync(eulaFile, 'utf8'))) {
    throw new Error('Minecraft history server EULA evidence is missing');
  }
  for (const prepared of record.preparedFiles) {
    if (
      typeof prepared?.name !== 'string' ||
      !/^[A-Za-z0-9._-]+$/.test(prepared.name) ||
      !/^[a-f0-9]{64}$/.test(String(prepared.sha256 || ''))
    ) {
      throw new Error('Minecraft history server prepared-file record is invalid');
    }
    const file = requiredPlainFile(record.serverDirectory, prepared.name);
    // Vanilla rewrites server.properties comments and order. Its active
    // semantics are checked above; access-policy files remain byte-bound.
    if (prepared.name !== 'server.properties' && sha256File(file) !== prepared.sha256) {
      throw new Error(`Minecraft history server file drifted: ${prepared.name}`);
    }
  }
}

function parseServerProperties(source: string) {
  const values = new Map<string, string>();
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const equals = line.indexOf('=');
    const colon = line.indexOf(':');
    const separator = [equals, colon]
      .filter((value) => value >= 0)
      .sort((left, right) => left - right)[0];
    if (separator == null) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key) continue;
    if (values.has(key)) throw new Error(`duplicate Minecraft server property: ${key}`);
    values.set(key, value);
  }
  return values;
}

function serializeServerProperties(values: ReadonlyMap<string, string>) {
  return `${[...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

function requiredPlainFile(directory: string, name: string) {
  const file = path.join(directory, name);
  if (!fs.existsSync(file)) throw new Error(`required Minecraft server file is missing: ${file}`);
  assertPlainFile(file);
  return file;
}

function assertPlainFile(file: string) {
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Minecraft server input is not a plain file: ${file}`);
  }
}

function boundedPort(value: number) {
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65_535) {
    throw new Error('Minecraft history server port must be an integer from 1024 through 65535');
  }
  return value;
}

function sha256File(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256Bytes(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function durableWriteBytes(file: string, value: Uint8Array) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
}

function readJson(file: string) {
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`not a plain JSON file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function safeSegment(value: unknown, label: string) {
  const text = nonEmpty(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(text)) throw new Error(`invalid ${label}`);
  return text;
}

function nonEmpty(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a string`);
  return value.trim();
}

function boundedText(value: unknown, label: string, minimum: number, maximum: number) {
  const text = nonEmpty(value, label);
  if (text.length < minimum || text.length > maximum) {
    throw new Error(`${label} must contain ${minimum} through ${maximum} characters`);
  }
  return text;
}

function pathsOverlap(left: string, right: string) {
  const relative = path.relative(path.resolve(left), path.resolve(right));
  const reverse = path.relative(path.resolve(right), path.resolve(left));
  return isContained(relative) || isContained(reverse);
}

function isContained(relative: string) {
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
