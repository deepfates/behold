#!/usr/bin/env node
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

export const CONFIG_SCHEMA_VERSION = 2;
export const SESSION_LOCK = 'session.lock';
export const TREE_DIGEST_PROFILE = 'behold-tree-v2';

export interface HashedDirectory {
  path: string;
  digestProfile: typeof TREE_DIGEST_PROFILE;
  expectedDigest: string;
}

export interface WorldLabDefinition {
  label?: string;
  source: HashedDirectory;
  /** A stopped, task-prepared snapshot. The raw source must never stand in for this. */
  preparedBaseline: HashedDirectory | null;
  runtime: {
    worldPath: string;
    archiveRoot: string;
  };
  server: {
    host: '127.0.0.1' | 'localhost' | '::1';
    port: number;
  };
  notes?: string[];
}

export interface WorldLabConfig {
  schemaVersion: 2;
  worlds: Record<string, WorldLabDefinition>;
}

export interface TreeDigest {
  algorithm: 'sha256';
  profile: typeof TREE_DIGEST_PROFILE;
  digest: string;
  files: number;
  directories: number;
  bytes: number;
  excluded: string[];
}

export interface ProcessOwner {
  pid: number;
  command?: string;
  name?: string;
}

export interface OwnershipEvidence {
  state: 'clear' | 'owned' | 'unknown';
  probe: string;
  owners: ProcessOwner[];
  detail?: string;
}

export type CanonicalArtifactRole =
  | 'source'
  | 'prepared_baseline'
  | 'runtime_world'
  | 'archive_root';

export interface CanonicalArtifactEvidence {
  role: CanonicalArtifactRole;
  configuredPath: string;
  normalizedPath: string;
  exists: boolean;
  canonicalPath: string | null;
  device: number | null;
  inode: number | null;
  plainDirectory: boolean;
  symbolicLink: boolean;
  error?: string;
}

export interface TopologyEvidence {
  artifacts: {
    source: CanonicalArtifactEvidence;
    preparedBaseline: CanonicalArtifactEvidence | null;
    runtime: CanonicalArtifactEvidence;
    archiveRoot: CanonicalArtifactEvidence;
  };
  safe: boolean;
  blockers: string[];
}

export interface RuntimeEvidence {
  runtimeExists: boolean;
  runtimePath: string;
  runtimeSessionLockPath: string;
  runtimeSessionLock: OwnershipEvidence;
  preparedBaselineSessionLockPath: string | null;
  preparedBaselineSessionLock: OwnershipEvidence | null;
  serverPort: OwnershipEvidence;
  topology: TopologyEvidence;
  safe: boolean;
  blockers: string[];
}

export interface ArtifactVerification {
  role: 'source' | 'prepared_baseline';
  path: string | null;
  expectedDigest: string | null;
  actualDigest: string | null;
  exists: boolean;
  matches: boolean;
  error?: string;
}

export interface WorldVerification {
  world: string;
  /** Overall verify result. It is true only when resetReady is true. */
  ok: boolean;
  artifactIntegrityOk: boolean;
  resetReady: boolean;
  artifacts: {
    source: ArtifactVerification;
    preparedBaseline: ArtifactVerification;
  };
  runtime: RuntimeEvidence;
  blockers: string[];
}

export interface ResetPlan {
  world: string;
  runId: string;
  baselinePath: string;
  runtimePath: string;
  stagePath: string;
  archivePath: string;
  digestProfile: typeof TREE_DIGEST_PROFILE;
  expectedBaselineDigest: string;
  operations: Array<{
    order: number;
    operation: string;
    from?: string;
    to?: string;
    note?: string;
  }>;
}

export interface ResetResult {
  mode: 'dry-run' | 'executed';
  plan: ResetPlan;
  verification: WorldVerification;
  stageDigest?: string;
  archivePath?: string;
  journalPath?: string;
}

export type ResetPhase =
  | 'intent_recorded'
  | 'stage_verified'
  | 'runtime_archived'
  | 'activated'
  | 'completed'
  | 'rolled_back'
  | 'recovery_required'
  | 'recovered_rolled_back'
  | 'recovered_completed';

export interface ResetJournal {
  protocol: 'behold-world-lab-reset.v1';
  world: string;
  runId: string;
  phase: ResetPhase;
  plan: ResetPlan;
  createdAt: string;
  updatedAt: string;
  preResetRuntimeDigest: string;
  digestProfile: typeof TREE_DIGEST_PROFILE;
  expectedBaselineDigest: string;
  identities: {
    source: ArtifactIdentity;
    preparedBaseline: ArtifactIdentity;
    runtime: ArtifactIdentity;
    archiveRoot: ArtifactIdentity;
  };
  events: Array<{ phase: ResetPhase; at: string; detail?: string }>;
  journalMac: string;
}

export interface ResetRecoveryResult {
  mode: 'recovered';
  journalPath: string;
  journal: ResetJournal;
  action: 'rollback_restored' | 'activation_accepted' | 'already_rolled_back';
}

type ArtifactIdentity = {
  canonicalPath: string;
  device: number;
  inode: number;
};

type OperationLockRecord = {
  protocol: 'behold-world-lab-operation-lock.v1';
  world: string;
  runId: string;
  pid: number;
  hostname: string;
  token: string;
  createdAt: string;
};

type HeldOperationLock = {
  path: string;
  token: string;
  release(): void;
};

export interface WorldLabProbes {
  probeSessionLock(lockPath: string): Promise<OwnershipEvidence>;
  probeListeningPort(host: string, port: number): Promise<OwnershipEvidence>;
}

export interface MutationOperations {
  copyDirectory(from: string, to: string): void;
  makeDirectory(target: string): void;
  rename(from: string, to: string): void;
}

export interface WorldLabDependencies extends Partial<WorldLabProbes> {
  mutationOperations?: Partial<MutationOperations>;
  fixtureExecutionCapability?: FixtureExecutionCapability;
  now?: () => Date;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export interface FixtureExecutionCapability {
  readonly kind: 'behold-world-lab-temporary-fixture';
  readonly root: string;
  readonly canonicalRoot: string;
  readonly device: number;
  readonly inode: number;
}

export class WorldLabError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly evidence?: unknown,
  ) {
    super(message);
    this.name = 'WorldLabError';
  }
}

export class SafetyRefusal extends WorldLabError {
  constructor(blockers: string[], evidence: unknown) {
    super(`World reset refused: ${blockers.join(', ')}`, 'reset_safety_refusal', evidence);
    this.name = 'SafetyRefusal';
  }
}

export class ResetExecutionError extends WorldLabError {
  declare readonly evidence: {
    plan: ResetPlan;
    activationError: string;
    rollbackAttempted: boolean;
    rollbackSucceeded: boolean;
    rollbackError?: string;
    journalPath?: string;
  };

  constructor(message: string, evidence: ResetExecutionError['evidence']) {
    super(message, 'reset_activation_failed', evidence);
    this.name = 'ResetExecutionError';
    this.evidence = evidence;
  }
}

const issuedFixtureCapabilities = new WeakSet<object>();
const fixtureAuthorityKeys = new WeakMap<object, Buffer>();
const FIXTURE_AUTHORITY_KEY_FILE = '.behold-world-lab-authority.key';

/**
 * Grants mutation authority only for a freshly-created world-lab directory
 * beneath the operating system's temporary directory. It cannot authorize a
 * real Minecraft source, baseline, or runtime path.
 */
export function createFixtureExecutionCapability(rootPath: string): FixtureExecutionCapability {
  const root = canonicalizeDirectory('runtime_world', rootPath);
  if (!root.canonicalPath || root.error) {
    throw new WorldLabError(
      `Fixture root cannot be canonicalized: ${rootPath}`,
      'fixture_root_unavailable',
      root,
    );
  }
  const temporaryRoot = fs.realpathSync.native(os.tmpdir());
  if (
    !isInsideOrEqual(temporaryRoot, root.canonicalPath) ||
    !path.basename(root.canonicalPath).startsWith('behold-world-lab-')
  ) {
    throw new WorldLabError(
      'Fixture execution is restricted to behold-world-lab-* directories under os.tmpdir()',
      'fixture_root_outside_temporary_directory',
      { root: root.canonicalPath, temporaryRoot },
    );
  }
  const capability: FixtureExecutionCapability = Object.freeze({
    kind: 'behold-world-lab-temporary-fixture',
    root: rootPath,
    canonicalRoot: root.canonicalPath,
    device: root.device!,
    inode: root.inode!,
  });
  const authorityKey = loadOrCreateFixtureAuthorityKey(root.canonicalPath);
  issuedFixtureCapabilities.add(capability);
  fixtureAuthorityKeys.set(capability, authorityKey);
  return capability;
}

function loadOrCreateFixtureAuthorityKey(root: string) {
  const keyPath = path.join(root, FIXTURE_AUTHORITY_KEY_FILE);
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(keyPath, 'wx', 0o600);
    const key = randomBytes(32);
    fs.writeFileSync(descriptor, key);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fsyncDirectory(root);
  } catch (error: any) {
    if (descriptor !== null) fs.closeSync(descriptor);
    if (error?.code !== 'EEXIST') throw error;
  }

  return readFixtureAuthorityKey(root);
}

function readFixtureAuthorityKey(root: string) {
  const keyPath = path.join(root, FIXTURE_AUTHORITY_KEY_FILE);
  const stats = fs.lstatSync(keyPath);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size !== 32 ||
    (stats.mode & 0o077) !== 0
  ) {
    throw new WorldLabError(
      'Fixture reset authority key must be a private 32-byte regular file',
      'fixture_authority_key_invalid',
      { keyPath, mode: stats.mode & 0o777, size: stats.size },
    );
  }
  return fs.readFileSync(keyPath);
}

function requireFixtureAuthorityKey(capability: FixtureExecutionCapability | undefined) {
  if (!capability || !issuedFixtureCapabilities.has(capability)) {
    throw new SafetyRefusal(['fixture_execution_capability_required'], {});
  }
  const expectedKey = fixtureAuthorityKeys.get(capability);
  const currentRoot = canonicalizeDirectory('runtime_world', capability.root);
  let currentKey: Buffer | null = null;
  try {
    currentKey = readFixtureAuthorityKey(capability.canonicalRoot);
  } catch {
    // Report the same fail-closed capability error without leaking key material.
  }
  if (
    !expectedKey ||
    !currentKey ||
    currentKey.length !== expectedKey.length ||
    !timingSafeEqual(currentKey, expectedKey) ||
    currentRoot.error ||
    currentRoot.canonicalPath !== capability.canonicalRoot ||
    currentRoot.device !== capability.device ||
    currentRoot.inode !== capability.inode
  ) {
    throw new SafetyRefusal(['fixture_execution_capability_invalid'], {
      capability,
      currentRoot,
      authorityKeyAvailable: currentKey !== null,
    });
  }
  return expectedKey;
}

const defaultMutationOperations: MutationOperations = {
  copyDirectory(from, to) {
    fs.cpSync(from, to, {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
      dereference: false,
      filter: (entry) => portableRelative(from, entry) !== SESSION_LOCK,
    });
  },
  makeDirectory(target) {
    fs.mkdirSync(target, { recursive: true });
  },
  rename(from, to) {
    fs.renameSync(from, to);
  },
};

const defaultProbes: WorldLabProbes = {
  async probeSessionLock(lockPath) {
    if (!fs.existsSync(lockPath)) {
      return {
        state: 'clear',
        probe: 'lsof-file-owner',
        owners: [],
        detail: 'session.lock does not exist',
      };
    }
    return probeWithLsof(['-Fpcn', '--', lockPath], 'lsof-file-owner');
  },
  async probeListeningPort(_host, port) {
    // Any listener on the configured lab port is enough to refuse a reset.
    return probeWithLsof(['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpcn'], 'lsof-listening-port');
  },
};

/**
 * Hashes file content, entry types, and relative paths, including empty
 * directories. Only Minecraft's root session.lock is excluded. Entry metadata
 * is sampled before and after hashing as a whole-tree generation fence.
 */
export function digestTree(rootPath: string): TreeDigest {
  const root = path.resolve(rootPath);
  assertPlainDirectory(root, 'digest_root');

  const initial = scanDigestTree(root);

  const tree = createHash('sha256');
  let files = 0;
  let directories = 0;
  let bytes = 0;

  for (const entry of initial.entries) {
    if (entry.type === 'directory') {
      directories += 1;
      tree.update(`D  ./${entry.relative}/\n`);
      continue;
    }

    if (entry.relative.includes('\n')) {
      throw new WorldLabError(
        `Refusing filename containing a newline: ${entry.full}`,
        'unsafe_filename',
        { path: entry.full },
      );
    }

    const before = fs.statSync(entry.full);
    assertDigestEntryUnchanged(entry, before);
    const contents = fs.readFileSync(entry.full);
    const after = fs.statSync(entry.full);
    assertDigestEntryUnchanged(entry, after);

    const fileDigest = createHash('sha256').update(contents).digest('hex');
    files += 1;
    bytes += contents.byteLength;
    tree.update(`F ${fileDigest}  ./${entry.relative}\n`);
  }

  const final = scanDigestTree(root);
  if (digestGeneration(initial.entries) !== digestGeneration(final.entries)) {
    throw new WorldLabError(
      `Tree changed while it was being hashed: ${root}`,
      'tree_changed_during_digest',
      { path: root },
    );
  }

  return {
    algorithm: 'sha256',
    profile: TREE_DIGEST_PROFILE,
    digest: tree.digest('hex'),
    files,
    directories,
    bytes,
    excluded: initial.excluded,
  };
}

type DigestTreeEntry = {
  type: 'directory' | 'file';
  relative: string;
  full: string;
  device: number;
  inode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

function scanDigestTree(root: string) {
  const entries: DigestTreeEntry[] = [];
  const excluded: string[] = [];

  function walk(directory: string) {
    const children = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const child of children) {
      const full = path.join(directory, child.name);
      const relative = portableRelative(root, full);
      if (relative === SESSION_LOCK) {
        excluded.push(relative);
        continue;
      }
      if (child.isSymbolicLink()) {
        throw new WorldLabError(
          `Refusing to hash symbolic link: ${full}`,
          'symbolic_link_refused',
          { path: full },
        );
      }
      if (!child.isDirectory() && !child.isFile()) {
        throw new WorldLabError(
          `Unsupported filesystem entry: ${full}`,
          'unsupported_filesystem_entry',
          { path: full },
        );
      }
      const stats = fs.statSync(full);
      entries.push({
        type: child.isDirectory() ? 'directory' : 'file',
        relative,
        full,
        device: stats.dev,
        inode: stats.ino,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
      });
      if (child.isDirectory()) walk(full);
    }
  }

  walk(root);
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.relative), Buffer.from(b.relative)));
  excluded.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return { entries, excluded };
}

function assertDigestEntryUnchanged(entry: DigestTreeEntry, stats: fs.Stats) {
  if (
    entry.device !== stats.dev ||
    entry.inode !== stats.ino ||
    entry.size !== stats.size ||
    entry.mtimeMs !== stats.mtimeMs ||
    entry.ctimeMs !== stats.ctimeMs
  ) {
    throw new WorldLabError(
      `Filesystem entry changed while it was being hashed: ${entry.full}`,
      'tree_changed_during_digest',
      { path: entry.full },
    );
  }
}

function digestGeneration(entries: DigestTreeEntry[]) {
  return entries
    .map(
      (entry) =>
        `${entry.type}\0${entry.relative}\0${entry.device}\0${entry.inode}\0${entry.size}\0${entry.mtimeMs}\0${entry.ctimeMs}`,
    )
    .join('\n');
}

export function loadWorldLabConfig(configPath: string): WorldLabConfig {
  const absolute = path.resolve(configPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (error: any) {
    throw new WorldLabError(
      `Could not read world-lab config ${absolute}: ${String(error?.message || error)}`,
      'config_read_failed',
      { path: absolute },
    );
  }
  return validateWorldLabConfig(parsed);
}

export function validateWorldLabConfig(value: unknown): WorldLabConfig {
  if (!isRecord(value) || value.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new WorldLabError(
      `world-lab config requires schemaVersion ${CONFIG_SCHEMA_VERSION}`,
      'invalid_config_schema',
    );
  }
  if (!isRecord(value.worlds) || Object.keys(value.worlds).length === 0) {
    throw new WorldLabError(
      'world-lab config requires at least one world',
      'invalid_config_worlds',
    );
  }

  for (const [worldId, candidate] of Object.entries(value.worlds)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(worldId)) {
      throw new WorldLabError(`Invalid world id: ${worldId}`, 'invalid_world_id');
    }
    validateWorldDefinition(worldId, candidate);
  }
  return value as unknown as WorldLabConfig;
}

export function inspectTopology(world: WorldLabDefinition): TopologyEvidence {
  const source = canonicalizeDirectory('source', world.source.path);
  const preparedBaseline = world.preparedBaseline
    ? canonicalizeDirectory('prepared_baseline', world.preparedBaseline.path)
    : null;
  const runtime = canonicalizeDirectory('runtime_world', world.runtime.worldPath);
  const archiveRoot = canonicalizeDirectory('archive_root', world.runtime.archiveRoot);
  const blockers: string[] = [];

  for (const artifact of [source, preparedBaseline, runtime, archiveRoot]) {
    if (artifact?.error) blockers.push(artifact.error);
  }
  if (!preparedBaseline) blockers.push('prepared_baseline_missing');

  if (preparedBaseline) {
    appendArtifactRelationshipBlockers(
      blockers,
      source,
      preparedBaseline,
      'source_prepared_baseline',
    );
    appendArtifactRelationshipBlockers(
      blockers,
      preparedBaseline,
      runtime,
      'prepared_baseline_runtime',
    );
  }
  appendArtifactRelationshipBlockers(blockers, source, runtime, 'source_runtime');

  for (const [name, artifact] of [
    ['source', source],
    ['prepared_baseline', preparedBaseline],
    ['runtime', runtime],
  ] as const) {
    if (!artifact) continue;
    appendArchiveRelationshipBlockers(blockers, archiveRoot, artifact, name);
  }

  const uniqueBlockers = [...new Set(blockers)];
  return {
    artifacts: { source, preparedBaseline, runtime, archiveRoot },
    safe: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
  };
}

export async function statusWorld(
  worldId: string,
  world: WorldLabDefinition,
  dependencies: WorldLabDependencies = {},
): Promise<
  RuntimeEvidence & { world: string; baselineConfigured: boolean; sourceExists: boolean }
> {
  const probes = resolveProbes(dependencies);
  const topology = inspectTopology(world);
  const runtimeArtifact = topology.artifacts.runtime;
  const baselineArtifact = topology.artifacts.preparedBaseline;
  const runtimePath = runtimeArtifact.canonicalPath || runtimeArtifact.normalizedPath;
  const runtimeLockPath = path.join(runtimePath, SESSION_LOCK);
  const baselineLockPath = baselineArtifact
    ? path.join(baselineArtifact.canonicalPath || baselineArtifact.normalizedPath, SESSION_LOCK)
    : null;
  const [runtimeSessionLock, preparedBaselineSessionLock, serverPort] = await Promise.all([
    probes.probeSessionLock(runtimeLockPath),
    baselineLockPath
      ? probes.probeSessionLock(baselineLockPath)
      : Promise.resolve<OwnershipEvidence | null>(null),
    probes.probeListeningPort(world.server.host, world.server.port),
  ]);

  const runtimeExists = runtimeArtifact.exists && runtimeArtifact.plainDirectory;
  const blockers: string[] = [...topology.blockers];
  if (!runtimeExists) blockers.push('runtime_world_missing');
  appendOwnershipBlocker(
    blockers,
    runtimeSessionLock,
    'runtime_session_lock_owned',
    'runtime_session_lock_probe_unknown',
  );
  if (preparedBaselineSessionLock) {
    appendOwnershipBlocker(
      blockers,
      preparedBaselineSessionLock,
      'prepared_baseline_session_lock_owned',
      'prepared_baseline_session_lock_probe_unknown',
    );
  }
  appendOwnershipBlocker(
    blockers,
    serverPort,
    'server_port_listening',
    'server_port_probe_unknown',
  );

  return {
    world: worldId,
    baselineConfigured: world.preparedBaseline !== null,
    sourceExists: topology.artifacts.source.exists,
    runtimeExists,
    runtimePath,
    runtimeSessionLockPath: runtimeLockPath,
    runtimeSessionLock,
    preparedBaselineSessionLockPath: baselineLockPath,
    preparedBaselineSessionLock,
    serverPort,
    topology,
    safe: [...new Set(blockers)].length === 0,
    blockers: [...new Set(blockers)],
  };
}

export async function verifyWorld(
  worldId: string,
  world: WorldLabDefinition,
  dependencies: WorldLabDependencies = {},
): Promise<WorldVerification> {
  const runtime = await statusWorld(worldId, world, dependencies);
  const source = verifyArtifact('source', world.source, runtime.topology.artifacts.source);
  const preparedBaseline = world.preparedBaseline
    ? verifyArtifact(
        'prepared_baseline',
        world.preparedBaseline,
        runtime.topology.artifacts.preparedBaseline!,
      )
    : missingPreparedBaseline();

  const blockers = [...runtime.blockers];
  appendArtifactBlockers(blockers, source, 'source');
  appendArtifactBlockers(blockers, preparedBaseline, 'prepared_baseline');
  const uniqueBlockers = [...new Set(blockers)];
  const artifactIntegrityOk = source.matches && preparedBaseline.matches;
  const resetReady = artifactIntegrityOk && runtime.safe;

  return {
    world: worldId,
    ok: resetReady,
    artifactIntegrityOk,
    resetReady,
    artifacts: { source, preparedBaseline },
    runtime,
    blockers: uniqueBlockers,
  };
}

export function createResetPlan(
  worldId: string,
  world: WorldLabDefinition,
  runId: string,
): ResetPlan {
  if (!world.preparedBaseline) {
    throw new SafetyRefusal(['prepared_baseline_missing'], {
      world: worldId,
      sourceIsNotBaseline: true,
    });
  }
  const topology = inspectTopology(world);
  if (!topology.safe) throw new SafetyRefusal(topology.blockers, topology);
  return createResetPlanFromTopology(worldId, world, runId, topology);
}

function createResetPlanFromTopology(
  worldId: string,
  world: WorldLabDefinition,
  runId: string,
  topology: TopologyEvidence,
): ResetPlan {
  assertSafeRunId(runId);
  const baselinePath = requireCanonical(topology.artifacts.preparedBaseline!);
  const runtimePath = requireCanonical(topology.artifacts.runtime);
  const archiveRoot = requireCanonical(topology.artifacts.archiveRoot);
  const runtimeParent = path.dirname(runtimePath);
  const runtimeName = path.basename(runtimePath);
  const stagePath = path.join(runtimeParent, `.${runtimeName}.stage-${runId}`);
  const archivePath = path.join(archiveRoot, `${runId}-${runtimeName}`);
  const plan: ResetPlan = {
    world: worldId,
    runId,
    baselinePath,
    runtimePath,
    stagePath,
    archivePath,
    digestProfile: TREE_DIGEST_PROFILE,
    expectedBaselineDigest: world.preparedBaseline.expectedDigest,
    operations: [
      {
        order: 1,
        operation: 'copy_prepared_baseline_to_sibling_stage',
        from: baselinePath,
        to: stagePath,
        note: 'session.lock is excluded',
      },
      { order: 2, operation: 'verify_stage_digest' },
      { order: 3, operation: 'repeat_lock_and_port_refusal_checks' },
      {
        order: 4,
        operation: 'rename_current_run_to_archive',
        from: runtimePath,
        to: archivePath,
      },
      {
        order: 5,
        operation: 'rename_stage_to_runtime',
        from: stagePath,
        to: runtimePath,
      },
      {
        order: 6,
        operation: 'rollback_archive_to_runtime_if_activation_fails',
        from: archivePath,
        to: runtimePath,
      },
    ],
  };
  assertProjectedPlanTopology(plan, topology);
  return plan;
}

/**
 * The execute mode is a programmatic seam for fixture tests and a future
 * managed server lifecycle. The first-slice CLI intentionally exposes only
 * dry-run planning.
 */
export async function resetWorld(
  worldId: string,
  world: WorldLabDefinition,
  options: { mode: 'dry-run' | 'execute'; runId?: string },
  dependencies: WorldLabDependencies = {},
): Promise<ResetResult> {
  const clock = dependencies.now || (() => new Date());
  const runId = options.runId || defaultRunId(clock());
  const verification = await verifyWorld(worldId, world, dependencies);
  if (!verification.resetReady) throw new SafetyRefusal(verification.blockers, verification);
  const plan = createResetPlanFromTopology(worldId, world, runId, verification.runtime.topology);

  if (fs.existsSync(plan.stagePath)) {
    throw new SafetyRefusal(['staging_path_already_exists'], { plan });
  }
  if (fs.existsSync(plan.archivePath)) {
    throw new SafetyRefusal(['archive_path_already_exists'], { plan });
  }
  assertSameFilesystem(path.dirname(plan.runtimePath), path.dirname(plan.archivePath));

  if (options.mode === 'dry-run') return { mode: 'dry-run', plan, verification };

  const authorityKey = assertFixtureExecutionCapability(
    dependencies.fixtureExecutionCapability,
    plan,
    verification,
  );
  const control = resetControlPaths(plan);
  const operationLock = acquireOperationLock(control.lockPath, worldId, runId, clock());
  try {
    const unresolved = findUnresolvedResetJournals(plan.runtimePath, authorityKey);
    if (unresolved.length) {
      throw new SafetyRefusal(['unresolved_reset_transaction'], { plan, unresolved });
    }
    if (fs.existsSync(control.journalPath)) {
      throw new SafetyRefusal(['reset_journal_already_exists'], { plan, control });
    }
    if (fs.existsSync(plan.stagePath)) {
      throw new SafetyRefusal(['staging_path_already_exists'], { plan });
    }
    if (fs.existsSync(plan.archivePath)) {
      throw new SafetyRefusal(['archive_path_already_exists'], { plan });
    }

    const lockedVerification = await verifyWorld(worldId, world, dependencies);
    if (!lockedVerification.resetReady) {
      throw new SafetyRefusal(lockedVerification.blockers, { plan, lockedVerification });
    }
    assertTopologyIdentityUnchanged(
      verification.runtime.topology,
      lockedVerification.runtime.topology,
    );

    const mutation = {
      ...defaultMutationOperations,
      ...(dependencies.mutationOperations || {}),
    };
    fsyncTree(plan.runtimePath);
    const preResetRuntimeDigest = digestTree(plan.runtimePath).digest;
    let journal = createResetJournal(
      worldId,
      plan,
      lockedVerification.runtime.topology,
      preResetRuntimeDigest,
      clock(),
      authorityKey,
    );
    durableWriteJson(control.journalPath, journal);

    let stageDigest: string | undefined;
    try {
      mutation.makeDirectory(path.dirname(plan.archivePath));
      mutation.copyDirectory(plan.baselinePath, plan.stagePath);
      fsyncTree(plan.stagePath);

      stageDigest = digestTree(plan.stagePath).digest;
      if (stageDigest !== plan.expectedBaselineDigest) {
        throw new WorldLabError(
          `Staged baseline digest mismatch: expected ${plan.expectedBaselineDigest}, got ${stageDigest}`,
          'staged_digest_mismatch',
          { plan, stageDigest },
        );
      }
      journal = advanceResetJournal(
        control.journalPath,
        journal,
        'stage_verified',
        clock(),
        authorityKey,
      );

      // Repeat lock, port, digest, and identity evidence immediately before
      // activation while this process still holds the per-runtime fence.
      const activationGate = await verifyWorld(worldId, world, dependencies);
      if (!activationGate.resetReady) {
        throw new SafetyRefusal(activationGate.blockers, { plan, activationGate });
      }
      assertTopologyIdentityUnchanged(
        lockedVerification.runtime.topology,
        activationGate.runtime.topology,
      );
      const runtimeDigestBeforeArchive = digestTree(plan.runtimePath).digest;
      if (runtimeDigestBeforeArchive !== preResetRuntimeDigest) {
        throw new SafetyRefusal(['runtime_changed_during_reset'], {
          plan,
          preResetRuntimeDigest,
          runtimeDigestBeforeArchive,
        });
      }
      const stageDigestBeforeActivation = digestTree(plan.stagePath).digest;
      if (stageDigestBeforeActivation !== plan.expectedBaselineDigest) {
        throw new SafetyRefusal(['stage_changed_before_activation'], {
          plan,
          stageDigestBeforeActivation,
        });
      }

      durableRename(mutation, plan.runtimePath, plan.archivePath);
      journal = advanceResetJournal(
        control.journalPath,
        journal,
        'runtime_archived',
        clock(),
        authorityKey,
      );
      durableRename(mutation, plan.stagePath, plan.runtimePath);
      journal = advanceResetJournal(
        control.journalPath,
        journal,
        'activated',
        clock(),
        authorityKey,
      );

      const activatedDigest = digestTree(plan.runtimePath).digest;
      if (activatedDigest !== plan.expectedBaselineDigest) {
        throw new WorldLabError(
          `Activated baseline digest mismatch: expected ${plan.expectedBaselineDigest}, got ${activatedDigest}`,
          'activated_digest_mismatch',
          { plan, activatedDigest },
        );
      }
      journal = advanceResetJournal(
        control.journalPath,
        journal,
        'completed',
        clock(),
        authorityKey,
      );
    } catch (activationError: any) {
      const rollback = attemptResetRollback(plan, mutation, preResetRuntimeDigest);
      journal = advanceResetJournal(
        control.journalPath,
        journal,
        rollback.succeeded ? 'rolled_back' : 'recovery_required',
        clock(),
        authorityKey,
        String(activationError?.message || activationError),
      );
      throw new ResetExecutionError(
        rollback.succeeded
          ? 'Baseline activation failed; the previous run remains active'
          : 'Baseline activation failed and rollback did not restore the previous run',
        {
          plan,
          activationError: String(activationError?.message || activationError),
          rollbackAttempted: rollback.attempted,
          rollbackSucceeded: rollback.succeeded,
          rollbackError: rollback.errors.length ? rollback.errors.join('; ') : undefined,
          journalPath: control.journalPath,
        },
      );
    }

    return {
      mode: 'executed',
      plan,
      verification: lockedVerification,
      stageDigest,
      archivePath: plan.archivePath,
      journalPath: control.journalPath,
    };
  } finally {
    operationLock.release();
  }
}

export async function recoverWorldReset(
  worldId: string,
  world: WorldLabDefinition,
  runId: string,
  dependencies: WorldLabDependencies = {},
): Promise<ResetRecoveryResult> {
  assertSafeRunId(runId);
  const clock = dependencies.now || (() => new Date());
  const control = resetControlPathsForRuntime(path.resolve(world.runtime.worldPath), runId);
  const authorityKey = requireFixtureAuthorityKey(dependencies.fixtureExecutionCapability);
  const journal = readResetJournal(control.journalPath, worldId, runId, authorityKey);
  if (TERMINAL_RESET_PHASES.has(journal.phase)) {
    throw new SafetyRefusal(['reset_journal_already_terminal'], {
      journalPath: control.journalPath,
      phase: journal.phase,
    });
  }
  assertRecoveryPlanMatchesWorld(journal, world);
  assertFixtureRecoveryCapability(dependencies.fixtureExecutionCapability, journal.plan, control);
  removeDemonstrablyStaleOperationLock(control.lockPath);
  const operationLock = acquireOperationLock(control.lockPath, worldId, runId, clock());
  try {
    const mutation = {
      ...defaultMutationOperations,
      ...(dependencies.mutationOperations || {}),
    };
    const runtimeExists = fs.existsSync(journal.plan.runtimePath);
    const archiveExists = fs.existsSync(journal.plan.archivePath);

    if (!runtimeExists && archiveExists) {
      const archiveDigest = digestTree(journal.plan.archivePath).digest;
      if (archiveDigest !== journal.preResetRuntimeDigest) {
        throw new SafetyRefusal(['recovery_archive_digest_mismatch'], {
          journal,
          archiveDigest,
        });
      }
      durableRename(mutation, journal.plan.archivePath, journal.plan.runtimePath);
      const restoredDigest = digestTree(journal.plan.runtimePath).digest;
      if (restoredDigest !== journal.preResetRuntimeDigest) {
        throw new SafetyRefusal(['recovered_runtime_digest_mismatch'], {
          journal,
          restoredDigest,
        });
      }
      const recovered = advanceResetJournal(
        control.journalPath,
        journal,
        'recovered_rolled_back',
        clock(),
        authorityKey,
        'archive restored because runtime was absent',
      );
      return {
        mode: 'recovered',
        journalPath: control.journalPath,
        journal: recovered,
        action: 'rollback_restored',
      };
    }

    if (runtimeExists && archiveExists) {
      const runtimeDigest = digestTree(journal.plan.runtimePath).digest;
      const archiveDigest = digestTree(journal.plan.archivePath).digest;
      if (
        runtimeDigest !== journal.expectedBaselineDigest ||
        archiveDigest !== journal.preResetRuntimeDigest
      ) {
        throw new SafetyRefusal(['ambiguous_runtime_and_archive_state'], {
          journal,
          runtimeDigest,
          archiveDigest,
        });
      }
      const recovered = advanceResetJournal(
        control.journalPath,
        journal,
        'recovered_completed',
        clock(),
        authorityKey,
        'activated runtime matches the prepared baseline and the prior run archive exists',
      );
      return {
        mode: 'recovered',
        journalPath: control.journalPath,
        journal: recovered,
        action: 'activation_accepted',
      };
    }

    if (runtimeExists && !archiveExists) {
      const runtimeDigest = digestTree(journal.plan.runtimePath).digest;
      if (runtimeDigest !== journal.preResetRuntimeDigest) {
        throw new SafetyRefusal(['runtime_without_expected_archive_is_ambiguous'], {
          journal,
          runtimeDigest,
        });
      }
      const recovered = advanceResetJournal(
        control.journalPath,
        journal,
        'recovered_rolled_back',
        clock(),
        authorityKey,
        'pre-reset runtime was already present and no archive existed',
      );
      return {
        mode: 'recovered',
        journalPath: control.journalPath,
        journal: recovered,
        action: 'already_rolled_back',
      };
    }

    throw new SafetyRefusal(['runtime_and_archive_missing'], { journal });
  } finally {
    operationLock.release();
  }
}

function createResetJournal(
  worldId: string,
  plan: ResetPlan,
  topology: TopologyEvidence,
  preResetRuntimeDigest: string,
  at: Date,
  authorityKey: Buffer,
): ResetJournal {
  const timestamp = at.toISOString();
  return authenticateResetJournal(
    {
      protocol: 'behold-world-lab-reset.v1',
      world: worldId,
      runId: plan.runId,
      phase: 'intent_recorded',
      plan,
      createdAt: timestamp,
      updatedAt: timestamp,
      preResetRuntimeDigest,
      digestProfile: TREE_DIGEST_PROFILE,
      expectedBaselineDigest: plan.expectedBaselineDigest,
      identities: {
        source: artifactIdentity(topology.artifacts.source),
        preparedBaseline: artifactIdentity(topology.artifacts.preparedBaseline!),
        runtime: artifactIdentity(topology.artifacts.runtime),
        archiveRoot: artifactIdentity(topology.artifacts.archiveRoot),
      },
      events: [{ phase: 'intent_recorded', at: timestamp }],
    },
    authorityKey,
  );
}

function advanceResetJournal(
  journalPath: string,
  journal: ResetJournal,
  phase: ResetPhase,
  at: Date,
  authorityKey: Buffer,
  detail?: string,
) {
  const timestamp = at.toISOString();
  const { journalMac: _priorMac, ...prior } = journal;
  const next = authenticateResetJournal(
    {
      ...prior,
      phase,
      updatedAt: timestamp,
      events: [...journal.events, { phase, at: timestamp, ...(detail ? { detail } : {}) }],
    },
    authorityKey,
  );
  durableWriteJson(journalPath, next);
  return next;
}

const RESET_PHASES = new Set<ResetPhase>([
  'intent_recorded',
  'stage_verified',
  'runtime_archived',
  'activated',
  'completed',
  'rolled_back',
  'recovery_required',
  'recovered_rolled_back',
  'recovered_completed',
]);
const TERMINAL_RESET_PHASES = new Set<ResetPhase>([
  'completed',
  'rolled_back',
  'recovered_rolled_back',
  'recovered_completed',
]);

function authenticateResetJournal(
  journal: Omit<ResetJournal, 'journalMac'>,
  authorityKey: Buffer,
): ResetJournal {
  const journalMac = createHmac('sha256', authorityKey)
    .update(JSON.stringify(journal))
    .digest('hex');
  return { ...journal, journalMac };
}

function verifyResetJournalMac(parsed: Record<string, any>, authorityKey: Buffer) {
  if (typeof parsed.journalMac !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.journalMac)) {
    throw new WorldLabError(
      'Reset journal has no valid authority MAC',
      'invalid_reset_journal_authentication',
    );
  }
  const { journalMac, ...unsigned } = parsed;
  const expected = createHmac('sha256', authorityKey).update(JSON.stringify(unsigned)).digest();
  const actual = Buffer.from(journalMac, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new WorldLabError(
      'Reset journal authority MAC does not match its contents',
      'invalid_reset_journal_authentication',
    );
  }
}

function readResetJournal(
  journalPath: string,
  worldId: string | null,
  runId: string | null,
  authorityKey: Buffer,
): ResetJournal {
  let parsed: any;
  try {
    if (fs.statSync(journalPath).size > 1_048_576) {
      throw new Error('journal exceeds 1 MiB');
    }
    parsed = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  } catch (error: any) {
    throw new WorldLabError(
      `Could not read reset journal ${journalPath}: ${error?.message || String(error)}`,
      'reset_journal_unavailable',
      { journalPath },
    );
  }
  if (!isRecord(parsed)) {
    throw new WorldLabError('Reset journal must be an object', 'invalid_reset_journal', {
      journalPath,
    });
  }
  verifyResetJournalMac(parsed, authorityKey);
  validateResetJournalSchema(parsed, journalPath);
  if (
    (worldId !== null && parsed.world !== worldId) ||
    (runId !== null && parsed.runId !== runId)
  ) {
    throw new WorldLabError(
      'Reset journal identity does not match the requested recovery',
      'invalid_reset_journal',
      {
        journalPath,
        worldId,
        runId,
      },
    );
  }
  return parsed as ResetJournal;
}

function validateResetJournalSchema(parsed: Record<string, any>, journalPath: string) {
  const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const timestamp = (value: unknown) =>
    typeof value === 'string' && Number.isFinite(Date.parse(value));
  const identity = (value: unknown) =>
    isRecord(value) &&
    typeof value.canonicalPath === 'string' &&
    path.isAbsolute(value.canonicalPath) &&
    Number.isInteger(value.device) &&
    Number.isInteger(value.inode);
  const plan = parsed.plan;
  const identities = parsed.identities;
  const events = parsed.events;
  if (
    parsed.protocol !== 'behold-world-lab-reset.v1' ||
    typeof parsed.world !== 'string' ||
    typeof parsed.runId !== 'string' ||
    !RESET_PHASES.has(parsed.phase) ||
    parsed.digestProfile !== TREE_DIGEST_PROFILE ||
    !digest(parsed.preResetRuntimeDigest) ||
    !digest(parsed.expectedBaselineDigest) ||
    !timestamp(parsed.createdAt) ||
    !timestamp(parsed.updatedAt) ||
    !isRecord(plan) ||
    plan.world !== parsed.world ||
    plan.runId !== parsed.runId ||
    plan.digestProfile !== TREE_DIGEST_PROFILE ||
    !digest(plan.expectedBaselineDigest) ||
    plan.expectedBaselineDigest !== parsed.expectedBaselineDigest ||
    ![plan.baselinePath, plan.runtimePath, plan.stagePath, plan.archivePath].every(
      (candidate) => typeof candidate === 'string' && path.isAbsolute(candidate),
    ) ||
    !Array.isArray(plan.operations) ||
    !isRecord(identities) ||
    !identity(identities.source) ||
    !identity(identities.preparedBaseline) ||
    !identity(identities.runtime) ||
    !identity(identities.archiveRoot) ||
    !Array.isArray(events) ||
    events.length === 0
  ) {
    throw new WorldLabError('Reset journal schema is invalid', 'invalid_reset_journal', {
      journalPath,
    });
  }

  let previous: ResetPhase | null = null;
  for (const event of events) {
    if (
      !isRecord(event) ||
      !RESET_PHASES.has(event.phase) ||
      !timestamp(event.at) ||
      (event.detail !== undefined && typeof event.detail !== 'string') ||
      !validResetPhaseTransition(previous, event.phase)
    ) {
      throw new WorldLabError('Reset journal phase history is invalid', 'invalid_reset_journal', {
        journalPath,
        previous,
        event,
      });
    }
    previous = event.phase;
  }
  if (
    events[0].phase !== 'intent_recorded' ||
    events[0].at !== parsed.createdAt ||
    events.at(-1).phase !== parsed.phase ||
    events.at(-1).at !== parsed.updatedAt
  ) {
    throw new WorldLabError('Reset journal phase endpoints are invalid', 'invalid_reset_journal', {
      journalPath,
    });
  }
}

function validResetPhaseTransition(previous: ResetPhase | null, next: ResetPhase) {
  if (previous === null) return next === 'intent_recorded';
  const ordinary: Partial<Record<ResetPhase, ResetPhase[]>> = {
    intent_recorded: [
      'stage_verified',
      'rolled_back',
      'recovery_required',
      'recovered_rolled_back',
      'recovered_completed',
    ],
    stage_verified: [
      'runtime_archived',
      'rolled_back',
      'recovery_required',
      'recovered_rolled_back',
      'recovered_completed',
    ],
    runtime_archived: [
      'activated',
      'rolled_back',
      'recovery_required',
      'recovered_rolled_back',
      'recovered_completed',
    ],
    activated: [
      'completed',
      'rolled_back',
      'recovery_required',
      'recovered_rolled_back',
      'recovered_completed',
    ],
    recovery_required: ['recovered_rolled_back', 'recovered_completed'],
  };
  return ordinary[previous]?.includes(next) ?? false;
}

function findUnresolvedResetJournals(runtimePath: string, authorityKey: Buffer) {
  const parent = fs.realpathSync.native(path.dirname(path.resolve(runtimePath)));
  const prefix = `.${path.basename(runtimePath)}.reset-`;
  const unresolved: Array<Record<string, unknown>> = [];
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.json'))
      continue;
    const journalPath = path.join(parent, entry.name);
    try {
      const journal = readResetJournal(journalPath, null, null, authorityKey);
      if (!TERMINAL_RESET_PHASES.has(journal.phase)) {
        unresolved.push({
          journalPath,
          world: journal.world,
          runId: journal.runId,
          phase: journal.phase,
        });
      }
    } catch (error: any) {
      unresolved.push({
        journalPath,
        error: error instanceof WorldLabError ? error.code : String(error?.message || error),
      });
    }
  }
  return unresolved;
}

function assertRecoveryPlanMatchesWorld(journal: ResetJournal, world: WorldLabDefinition) {
  if (!world.preparedBaseline) {
    throw new SafetyRefusal(['reset_journal_world_mismatch'], {
      reason: 'prepared_baseline_missing',
    });
  }
  const configuredRuntimeParent = fs.realpathSync.native(
    path.dirname(path.resolve(world.runtime.worldPath)),
  );
  const configuredSource = canonicalizeDirectory('source', world.source.path);
  const configuredBaseline = canonicalizeDirectory(
    'prepared_baseline',
    world.preparedBaseline.path,
  );
  const configuredArchiveRoot = canonicalizeDirectory('archive_root', world.runtime.archiveRoot);
  const expectedRuntime = path.join(
    configuredRuntimeParent,
    path.basename(world.runtime.worldPath),
  );
  const expectedStage = path.join(
    configuredRuntimeParent,
    `.${path.basename(expectedRuntime)}.stage-${journal.runId}`,
  );
  const expectedArchive = configuredArchiveRoot.canonicalPath
    ? path.join(
        configuredArchiveRoot.canonicalPath,
        `${journal.runId}-${path.basename(expectedRuntime)}`,
      )
    : null;
  const expectedBaselineDigest = world.preparedBaseline.expectedDigest;
  const currentIdentities = {
    source: canonicalIdentityAvailable(configuredSource)
      ? artifactIdentity(configuredSource)
      : null,
    preparedBaseline: canonicalIdentityAvailable(configuredBaseline)
      ? artifactIdentity(configuredBaseline)
      : null,
    archiveRoot: canonicalIdentityAvailable(configuredArchiveRoot)
      ? artifactIdentity(configuredArchiveRoot)
      : null,
  };
  if (
    journal.plan.world !== journal.world ||
    journal.plan.runId !== journal.runId ||
    journal.plan.runtimePath !== expectedRuntime ||
    journal.plan.stagePath !== expectedStage ||
    journal.plan.archivePath !== expectedArchive ||
    journal.plan.baselinePath !== configuredBaseline.canonicalPath ||
    journal.digestProfile !== TREE_DIGEST_PROFILE ||
    journal.plan.digestProfile !== TREE_DIGEST_PROFILE ||
    world.source.digestProfile !== TREE_DIGEST_PROFILE ||
    world.preparedBaseline.digestProfile !== TREE_DIGEST_PROFILE ||
    expectedBaselineDigest !== journal.expectedBaselineDigest ||
    expectedBaselineDigest !== journal.plan.expectedBaselineDigest ||
    !sameArtifactRecord(journal.identities?.source, currentIdentities.source) ||
    !sameArtifactRecord(journal.identities?.preparedBaseline, currentIdentities.preparedBaseline) ||
    !sameArtifactRecord(journal.identities?.archiveRoot, currentIdentities.archiveRoot)
  ) {
    throw new SafetyRefusal(['reset_journal_world_mismatch'], {
      journalWorld: journal.world,
      planWorld: journal.plan.world,
      journalRunId: journal.runId,
      planRunId: journal.plan.runId,
      journalRuntime: journal.plan.runtimePath,
      expectedRuntime,
      journalStage: journal.plan.stagePath,
      expectedStage,
      journalArchive: journal.plan.archivePath,
      expectedArchive,
      journalBaseline: journal.plan.baselinePath,
      expectedBaseline: configuredBaseline.canonicalPath,
      journalBaselineDigest: journal.expectedBaselineDigest,
      expectedBaselineDigest,
      journalDigestProfile: journal.digestProfile,
      journalIdentities: journal.identities,
      currentIdentities,
    });
  }
}

function sameArtifactRecord(
  left: ArtifactIdentity | null | undefined,
  right: ArtifactIdentity | null | undefined,
) {
  return Boolean(
    left &&
      right &&
      left.canonicalPath === right.canonicalPath &&
      left.device === right.device &&
      left.inode === right.inode,
  );
}

function resetControlPaths(plan: ResetPlan) {
  return resetControlPathsForRuntime(plan.runtimePath, plan.runId);
}

function resetControlPathsForRuntime(runtimePath: string, runId: string) {
  const runtimeParent = fs.realpathSync.native(path.dirname(path.resolve(runtimePath)));
  const runtimeName = path.basename(runtimePath);
  return {
    lockPath: path.join(runtimeParent, `.${runtimeName}.reset.lock`),
    journalPath: path.join(runtimeParent, `.${runtimeName}.reset-${runId}.json`),
  };
}

function acquireOperationLock(
  lockPath: string,
  worldId: string,
  runId: string,
  at: Date,
): HeldOperationLock {
  const record: OperationLockRecord = {
    protocol: 'behold-world-lab-operation-lock.v1',
    world: worldId,
    runId,
    pid: process.pid,
    hostname: os.hostname(),
    token: randomUUID(),
    createdAt: at.toISOString(),
  };
  let descriptor: number;
  try {
    descriptor = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      throw new SafetyRefusal(['reset_operation_locked'], {
        lockPath,
        owner: readJsonIfPresent(lockPath),
      });
    }
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fsyncDirectory(path.dirname(lockPath));
  } catch (error) {
    fs.closeSync(descriptor);
    fs.rmSync(lockPath, { force: true });
    throw error;
  }

  let released = false;
  return {
    path: lockPath,
    token: record.token,
    release() {
      if (released) return;
      released = true;
      fs.closeSync(descriptor);
      const current = readJsonIfPresent(lockPath) as Partial<OperationLockRecord> | null;
      if (current?.token !== record.token) {
        throw new WorldLabError(
          'Reset operation lock ownership changed unexpectedly',
          'operation_lock_lost',
          {
            lockPath,
            expectedToken: record.token,
            current,
          },
        );
      }
      fs.unlinkSync(lockPath);
      fsyncDirectory(path.dirname(lockPath));
    },
  };
}

function removeDemonstrablyStaleOperationLock(lockPath: string) {
  if (!fs.existsSync(lockPath)) return;
  const record = readJsonIfPresent(lockPath) as Partial<OperationLockRecord> | null;
  if (
    record?.protocol !== 'behold-world-lab-operation-lock.v1' ||
    record.hostname !== os.hostname() ||
    !Number.isInteger(record.pid)
  ) {
    throw new SafetyRefusal(['reset_operation_lock_owner_unknown'], { lockPath, record });
  }
  if (processIsAlive(Number(record.pid))) {
    throw new SafetyRefusal(['reset_operation_locked'], { lockPath, owner: record });
  }
  fs.unlinkSync(lockPath);
  fsyncDirectory(path.dirname(lockPath));
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

function durableWriteJson(file: string, value: unknown) {
  const directory = path.dirname(file);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, file);
    fsyncDirectory(directory);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncTree(root: string) {
  assertPlainDirectory(root, 'fsync_root');
  const directories: string[] = [root];
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new WorldLabError(
          `Refusing to fsync symbolic link: ${full}`,
          'symbolic_link_refused',
          {
            path: full,
          },
        );
      }
      if (entry.isDirectory()) {
        directories.push(full);
        visit(full);
      } else if (entry.isFile()) {
        files.push(full);
      } else {
        throw new WorldLabError(
          `Unsupported filesystem entry during fsync: ${full}`,
          'unsupported_filesystem_entry',
          { path: full },
        );
      }
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

function durableRename(mutation: MutationOperations, from: string, to: string) {
  mutation.rename(from, to);
  const parents = [...new Set([path.dirname(from), path.dirname(to)])];
  for (const parent of parents) fsyncDirectory(parent);
}

function attemptResetRollback(
  plan: ResetPlan,
  mutation: MutationOperations,
  preResetRuntimeDigest: string,
) {
  const errors: string[] = [];
  const initiallyRuntimeExists = fs.existsSync(plan.runtimePath);
  const initiallyArchiveExists = fs.existsSync(plan.archivePath);
  const attempted = initiallyArchiveExists || !initiallyRuntimeExists;

  if (fs.existsSync(plan.archivePath) && fs.existsSync(plan.runtimePath)) {
    if (fs.existsSync(plan.stagePath)) {
      errors.push('runtime, archive, and stage all exist; activated runtime cannot be quarantined');
    } else {
      try {
        durableRename(mutation, plan.runtimePath, plan.stagePath);
      } catch (error: any) {
        errors.push(`quarantine activated runtime: ${String(error?.message || error)}`);
      }
    }
  }
  if (fs.existsSync(plan.archivePath) && !fs.existsSync(plan.runtimePath)) {
    try {
      durableRename(mutation, plan.archivePath, plan.runtimePath);
    } catch (error: any) {
      errors.push(`restore archived runtime: ${String(error?.message || error)}`);
    }
  }

  // A retry here closes the exact ambiguity where rename(2) applied but the
  // first directory fsync failed. Terminal recovery is recorded only after the
  // final namespace and both parent directories are durable.
  try {
    for (const parent of [
      ...new Set([path.dirname(plan.runtimePath), path.dirname(plan.archivePath)]),
    ]) {
      fsyncDirectory(parent);
    }
  } catch (error: any) {
    errors.push(`final rollback directory sync: ${String(error?.message || error)}`);
  }

  let runtimeDigest: string | null = null;
  try {
    if (fs.existsSync(plan.runtimePath)) runtimeDigest = digestTree(plan.runtimePath).digest;
  } catch (error: any) {
    errors.push(`verify restored runtime: ${String(error?.message || error)}`);
  }
  const succeeded =
    errors.length === 0 &&
    runtimeDigest === preResetRuntimeDigest &&
    !fs.existsSync(plan.archivePath);
  if (!succeeded && runtimeDigest !== preResetRuntimeDigest) {
    errors.push(`restored runtime digest is ${runtimeDigest || 'unavailable'}`);
  }
  if (!succeeded && fs.existsSync(plan.archivePath)) errors.push('archive remains present');
  return { attempted, succeeded, errors };
}

function readJsonIfPresent(file: string) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function artifactIdentity(artifact: CanonicalArtifactEvidence): ArtifactIdentity {
  if (!artifact.canonicalPath || artifact.device === null || artifact.inode === null) {
    throw new SafetyRefusal([`${artifact.role}_identity_unavailable`], { artifact });
  }
  return {
    canonicalPath: artifact.canonicalPath,
    device: artifact.device,
    inode: artifact.inode,
  };
}

function assertTopologyIdentityUnchanged(before: TopologyEvidence, after: TopologyEvidence) {
  const changed: string[] = [];
  for (const role of ['source', 'preparedBaseline', 'runtime', 'archiveRoot'] as const) {
    const left = before.artifacts[role];
    const right = after.artifacts[role];
    if (!left || !right) {
      if (left !== right) changed.push(role);
      continue;
    }
    if (
      left.canonicalPath !== right.canonicalPath ||
      left.device !== right.device ||
      left.inode !== right.inode
    ) {
      changed.push(role);
    }
  }
  if (changed.length) {
    throw new SafetyRefusal(
      changed.map((role) => `${role}_identity_changed_during_reset`),
      { before, after },
    );
  }
}

function assertFixtureRecoveryCapability(
  capability: FixtureExecutionCapability | undefined,
  plan: ResetPlan,
  control: { lockPath: string; journalPath: string },
) {
  requireFixtureAuthorityKey(capability);
  const authorizedCapability = capability!;
  const paths = [
    plan.baselinePath,
    plan.runtimePath,
    plan.stagePath,
    plan.archivePath,
    control.lockPath,
    control.journalPath,
  ];
  const outside = paths.filter(
    (candidate) => !isInsideOrEqual(authorizedCapability.canonicalRoot, path.resolve(candidate)),
  );
  if (outside.length) {
    throw new SafetyRefusal(['fixture_execution_scope_violation'], {
      capability: authorizedCapability,
      outside,
    });
  }
}

export async function runCli(
  argv = process.argv.slice(2),
  dependencies: WorldLabDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout || ((text: string) => process.stdout.write(text));
  const stderr = dependencies.stderr || ((text: string) => process.stderr.write(text));
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        config: { type: 'string' },
        world: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        execute: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    if (parsed.values.help) {
      stdout(`${usage()}\n`);
      return 0;
    }
    const command = parsed.positionals[0];
    if (!['status', 'verify', 'reset'].includes(command || '')) {
      throw new WorldLabError(usage(), 'invalid_command');
    }
    if (parsed.positionals.length !== 1) {
      throw new WorldLabError('Unexpected positional arguments', 'invalid_arguments');
    }
    if (!parsed.values.config || !parsed.values.world) {
      throw new WorldLabError('--config and --world are required', 'invalid_arguments');
    }

    const config = loadWorldLabConfig(parsed.values.config);
    const worldId = parsed.values.world;
    const world = config.worlds[worldId];
    if (!world) throw new WorldLabError(`Unknown world: ${worldId}`, 'unknown_world');

    if (command === 'status') {
      rejectResetFlags(parsed.values, command);
      stdout(`${JSON.stringify(await statusWorld(worldId, world, dependencies), null, 2)}\n`);
      return 0;
    }
    if (command === 'verify') {
      rejectResetFlags(parsed.values, command);
      const result = await verifyWorld(worldId, world, dependencies);
      stdout(`${JSON.stringify(result, null, 2)}\n`);
      return result.resetReady ? 0 : 2;
    }

    const dryRun = Boolean(parsed.values['dry-run']);
    if (parsed.values.execute) {
      throw new WorldLabError(
        'Real reset execution is not exposed by this first-slice CLI',
        'reset_execution_not_available',
      );
    }
    if (!dryRun) {
      throw new WorldLabError(
        'This first-slice CLI supports reset planning only; pass --dry-run',
        'invalid_reset_mode',
      );
    }
    const result = await resetWorld(worldId, world, { mode: 'dry-run' }, dependencies);
    stdout(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error: any) {
    const body = {
      ok: false,
      error: error instanceof WorldLabError ? error.code : 'unexpected_error',
      message: String(error?.message || error),
      evidence: error instanceof WorldLabError ? error.evidence : undefined,
    };
    stderr(`${JSON.stringify(body, null, 2)}\n`);
    return error instanceof SafetyRefusal ? 2 : 1;
  }
}

function validateWorldDefinition(worldId: string, value: unknown) {
  if (!isRecord(value)) invalidWorld(worldId, 'definition must be an object');
  validateHashedDirectory(worldId, 'source', value.source);
  if (value.preparedBaseline !== null) {
    validateHashedDirectory(worldId, 'preparedBaseline', value.preparedBaseline);
  }
  if (!isRecord(value.runtime)) invalidWorld(worldId, 'runtime must be an object');
  const worldPath = absolutePath(worldId, 'runtime.worldPath', value.runtime.worldPath);
  const archiveRoot = absolutePath(worldId, 'runtime.archiveRoot', value.runtime.archiveRoot);
  if (!isRecord(value.server)) invalidWorld(worldId, 'server must be an object');
  if (!['127.0.0.1', 'localhost', '::1'].includes(String(value.server.host))) {
    invalidWorld(worldId, 'server.host must be loopback');
  }
  if (
    !Number.isInteger(value.server.port) ||
    Number(value.server.port) < 1 ||
    Number(value.server.port) > 65535
  ) {
    invalidWorld(worldId, 'server.port must be an integer from 1 to 65535');
  }

  const source = value.source as unknown as HashedDirectory;
  const baseline = value.preparedBaseline as unknown as HashedDirectory | null;
  const configured = [source.path, baseline?.path, worldPath, archiveRoot]
    .filter(Boolean)
    .map((configuredPath) => path.resolve(String(configuredPath)));
  if (new Set(configured).size !== configured.length) {
    invalidWorld(worldId, 'source, baseline, runtime, and archive paths must be distinct');
  }
  if (pathsOverlap(worldPath, source.path)) {
    invalidWorld(worldId, 'source and runtime may not contain one another');
  }
  if (baseline && pathsOverlap(source.path, baseline.path)) {
    invalidWorld(worldId, 'source and prepared baseline may not contain one another');
  }
  if (baseline && pathsOverlap(worldPath, baseline.path)) {
    invalidWorld(worldId, 'prepared baseline and runtime may not contain one another');
  }
  for (const [role, artifactPath] of [
    ['source', source.path],
    ['prepared baseline', baseline?.path],
    ['runtime world', worldPath],
  ] as const) {
    if (artifactPath && pathsOverlap(archiveRoot, artifactPath)) {
      invalidWorld(worldId, `archive root may not overlap ${role}`);
    }
  }
}

function validateHashedDirectory(worldId: string, role: string, value: unknown) {
  if (!isRecord(value)) invalidWorld(worldId, `${role} must be an object`);
  absolutePath(worldId, `${role}.path`, value.path);
  if (value.digestProfile !== TREE_DIGEST_PROFILE) {
    invalidWorld(worldId, `${role}.digestProfile must be ${TREE_DIGEST_PROFILE}`);
  }
  if (typeof value.expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedDigest)) {
    invalidWorld(worldId, `${role}.expectedDigest must be a lowercase SHA-256 digest`);
  }
}

function absolutePath(worldId: string, field: string, value: unknown) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    path.resolve(value) === path.parse(value).root
  ) {
    invalidWorld(worldId, `${field} must be a non-root absolute path`);
  }
  return path.resolve(String(value));
}

function invalidWorld(worldId: string, detail: string): never {
  throw new WorldLabError(`Invalid world ${worldId}: ${detail}`, 'invalid_world_config', {
    world: worldId,
    detail,
  });
}

function verifyArtifact(
  role: ArtifactVerification['role'],
  configured: HashedDirectory,
  canonical: CanonicalArtifactEvidence,
): ArtifactVerification {
  if (!canonical.exists || !canonical.canonicalPath || canonical.error) {
    return {
      role,
      path: configured.path,
      expectedDigest: configured.expectedDigest,
      actualDigest: null,
      exists: canonical.exists,
      matches: false,
      error: canonical.error || `${role}_canonicalization_unavailable`,
    };
  }
  try {
    const actualDigest = digestTree(canonical.canonicalPath).digest;
    return {
      role,
      path: configured.path,
      expectedDigest: configured.expectedDigest,
      actualDigest,
      exists: true,
      matches: actualDigest === configured.expectedDigest,
      error: actualDigest === configured.expectedDigest ? undefined : `${role}_digest_mismatch`,
    };
  } catch (error: any) {
    return {
      role,
      path: configured.path,
      expectedDigest: configured.expectedDigest,
      actualDigest: null,
      exists: true,
      matches: false,
      error: String(error?.code || error?.message || error),
    };
  }
}

function missingPreparedBaseline(): ArtifactVerification {
  return {
    role: 'prepared_baseline',
    path: null,
    expectedDigest: null,
    actualDigest: null,
    exists: false,
    matches: false,
    error: 'prepared_baseline_missing',
  };
}

function appendArtifactBlockers(
  blockers: string[],
  artifact: ArtifactVerification,
  prefix: string,
) {
  if (!artifact.exists) blockers.push(`${prefix}_missing`);
  else if (!artifact.matches) blockers.push(`${prefix}_digest_mismatch`);
}

function appendOwnershipBlocker(
  blockers: string[],
  evidence: OwnershipEvidence,
  owned: string,
  unknown: string,
) {
  if (evidence.state === 'owned') blockers.push(owned);
  if (evidence.state === 'unknown') blockers.push(unknown);
}

function canonicalizeDirectory(
  role: CanonicalArtifactRole,
  configuredPath: string,
): CanonicalArtifactEvidence {
  const normalizedPath = path.resolve(configuredPath);
  let configuredStats: fs.Stats;
  try {
    configuredStats = fs.lstatSync(normalizedPath);
  } catch (error: any) {
    return {
      role,
      configuredPath,
      normalizedPath,
      exists: false,
      canonicalPath: null,
      device: null,
      inode: null,
      plainDirectory: false,
      symbolicLink: false,
      error: `${role}_canonicalization_unavailable`,
    };
  }

  let canonicalPath: string;
  let canonicalStats: fs.Stats;
  try {
    canonicalPath = fs.realpathSync.native(normalizedPath);
    canonicalStats = fs.statSync(canonicalPath);
  } catch (error: any) {
    return {
      role,
      configuredPath,
      normalizedPath,
      exists: true,
      canonicalPath: null,
      device: null,
      inode: null,
      plainDirectory: false,
      symbolicLink: configuredStats.isSymbolicLink(),
      error: `${role}_canonicalization_unavailable`,
    };
  }

  const symbolicLink = configuredStats.isSymbolicLink();
  const directory = canonicalStats.isDirectory();
  return {
    role,
    configuredPath,
    normalizedPath,
    exists: true,
    canonicalPath,
    device: canonicalStats.dev,
    inode: canonicalStats.ino,
    plainDirectory: directory && !symbolicLink,
    symbolicLink,
    error: symbolicLink
      ? `${role}_symbolic_link_refused`
      : directory
        ? undefined
        : `${role}_not_directory`,
  };
}

function appendArtifactRelationshipBlockers(
  blockers: string[],
  left: CanonicalArtifactEvidence,
  right: CanonicalArtifactEvidence,
  prefix: string,
) {
  if (!canonicalIdentityAvailable(left) || !canonicalIdentityAvailable(right)) return;
  if (sameArtifactIdentity(left, right)) {
    blockers.push(`${prefix}_alias`);
    return;
  }
  if (
    pathsOverlap(left.normalizedPath, right.normalizedPath) ||
    pathsOverlap(left.canonicalPath!, right.canonicalPath!)
  ) {
    blockers.push(`${prefix}_overlap`);
  }
}

function appendArchiveRelationshipBlockers(
  blockers: string[],
  archiveRoot: CanonicalArtifactEvidence,
  artifact: CanonicalArtifactEvidence,
  artifactName: string,
) {
  if (!canonicalIdentityAvailable(archiveRoot) || !canonicalIdentityAvailable(artifact)) return;
  if (sameArtifactIdentity(archiveRoot, artifact)) {
    blockers.push(`archive_root_aliases_${artifactName}`);
    return;
  }
  if (
    isInsideOrEqual(artifact.normalizedPath, archiveRoot.normalizedPath) ||
    isInsideOrEqual(artifact.canonicalPath!, archiveRoot.canonicalPath!)
  ) {
    blockers.push(`archive_root_inside_${artifactName}`);
  }
  if (
    isInsideOrEqual(archiveRoot.normalizedPath, artifact.normalizedPath) ||
    isInsideOrEqual(archiveRoot.canonicalPath!, artifact.canonicalPath!)
  ) {
    blockers.push(`${artifactName}_inside_archive_root`);
  }
}

function canonicalIdentityAvailable(artifact: CanonicalArtifactEvidence) {
  return Boolean(artifact.canonicalPath && artifact.device !== null && artifact.inode !== null);
}

function sameArtifactIdentity(left: CanonicalArtifactEvidence, right: CanonicalArtifactEvidence) {
  return (
    left.normalizedPath === right.normalizedPath ||
    left.canonicalPath === right.canonicalPath ||
    (left.device === right.device && left.inode === right.inode)
  );
}

function requireCanonical(artifact: CanonicalArtifactEvidence) {
  if (!canonicalIdentityAvailable(artifact) || artifact.error) {
    throw new SafetyRefusal([artifact.error || `${artifact.role}_canonicalization_unavailable`], {
      artifact,
    });
  }
  return artifact.canonicalPath!;
}

function assertProjectedPlanTopology(plan: ResetPlan, topology: TopologyEvidence) {
  const blockers: string[] = [];
  const artifacts = [
    ['source', topology.artifacts.source],
    ['prepared_baseline', topology.artifacts.preparedBaseline],
    ['runtime', topology.artifacts.runtime],
  ] as const;

  for (const [targetName, targetPath] of [
    ['stage_target', plan.stagePath],
    ['archive_target', plan.archivePath],
  ] as const) {
    const targetIdentity = fs.existsSync(targetPath)
      ? canonicalizeDirectory('archive_root', targetPath)
      : null;
    const projected = targetIdentity?.canonicalPath || path.resolve(targetPath);
    if (targetIdentity?.error) blockers.push(`${targetName}_canonicalization_unavailable`);

    for (const [artifactName, artifact] of artifacts) {
      if (!artifact || !canonicalIdentityAvailable(artifact)) continue;
      const aliases =
        path.resolve(targetPath) === artifact.normalizedPath ||
        projected === artifact.canonicalPath ||
        Boolean(targetIdentity && sameArtifactIdentity(targetIdentity, artifact));
      if (aliases) {
        blockers.push(`${targetName}_aliases_${artifactName}`);
        continue;
      }
      if (isInsideOrEqual(artifact.canonicalPath!, projected)) {
        blockers.push(`${targetName}_inside_${artifactName}`);
      }
      if (isInsideOrEqual(projected, artifact.canonicalPath!)) {
        blockers.push(`${artifactName}_inside_${targetName}`);
      }
    }
  }

  if (pathsOverlap(plan.stagePath, plan.archivePath)) {
    blockers.push('stage_archive_target_overlap');
  }
  const unique = [...new Set(blockers)];
  if (unique.length) throw new SafetyRefusal(unique, { plan, topology });
}

function assertFixtureExecutionCapability(
  capability: FixtureExecutionCapability | undefined,
  plan: ResetPlan,
  verification: WorldVerification,
) {
  const authorityKey = requireFixtureAuthorityKey(capability);
  const authorizedCapability = capability!;

  const scopedPaths = [
    verification.runtime.topology.artifacts.source.canonicalPath,
    verification.runtime.topology.artifacts.preparedBaseline?.canonicalPath,
    verification.runtime.topology.artifacts.runtime.canonicalPath,
    verification.runtime.topology.artifacts.archiveRoot.canonicalPath,
    plan.stagePath,
    plan.archivePath,
  ].filter(Boolean) as string[];
  const outside = scopedPaths.filter(
    (candidate) => !isInsideOrEqual(authorizedCapability.canonicalRoot, path.resolve(candidate)),
  );
  if (outside.length) {
    throw new SafetyRefusal(['fixture_execution_scope_violation'], {
      capability: authorizedCapability,
      outside,
    });
  }
  return authorityKey;
}

function assertPlainDirectory(target: string, role: string) {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(target);
  } catch (error: any) {
    throw new WorldLabError(`${role} directory is unavailable: ${target}`, `${role}_unavailable`, {
      path: target,
      error: String(error?.message || error),
    });
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new WorldLabError(
      `${role} must be a plain directory: ${target}`,
      `${role}_not_plain_directory`,
      { path: target },
    );
  }
}

function assertSameFilesystem(left: string, right: string) {
  const leftDevice = fs.statSync(left).dev;
  const rightDevice = fs.statSync(right).dev;
  if (leftDevice !== rightDevice) {
    throw new SafetyRefusal(['archive_crosses_filesystem'], {
      left,
      right,
      leftDevice,
      rightDevice,
    });
  }
}

function assertSafeRunId(runId: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runId) || runId.includes('..')) {
    throw new WorldLabError(`Unsafe run id: ${runId}`, 'invalid_run_id');
  }
}

function defaultRunId(now: Date) {
  return now.toISOString().replace(/[:.]/g, '-');
}

function resolveProbes(dependencies: WorldLabDependencies): WorldLabProbes {
  return {
    probeSessionLock: dependencies.probeSessionLock || defaultProbes.probeSessionLock,
    probeListeningPort: dependencies.probeListeningPort || defaultProbes.probeListeningPort,
  };
}

function probeWithLsof(args: string[], probe: string): OwnershipEvidence {
  const result = spawnSync('lsof', args, { encoding: 'utf8' });
  if (result.error) {
    return {
      state: 'unknown',
      probe,
      owners: [],
      detail: String(result.error.message || result.error),
    };
  }
  if (result.status === 1 && !result.stdout.trim()) {
    return { state: 'clear', probe, owners: [], detail: 'lsof found no owner' };
  }
  if (result.status !== 0) {
    return {
      state: 'unknown',
      probe,
      owners: [],
      detail: `lsof exited ${result.status}: ${result.stderr.trim()}`,
    };
  }
  const owners = parseLsofOwners(result.stdout);
  return owners.length
    ? { state: 'owned', probe, owners }
    : { state: 'unknown', probe, owners: [], detail: 'lsof succeeded without an owner record' };
}

function parseLsofOwners(output: string): ProcessOwner[] {
  const owners: ProcessOwner[] = [];
  let current: ProcessOwner | null = null;
  for (const line of output.split('\n')) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      if (current) owners.push(current);
      current = { pid: Number(value) };
    } else if (field === 'c' && current) current.command = value;
    else if (field === 'n' && current) current.name = value;
  }
  if (current) owners.push(current);
  return owners.filter((owner) => Number.isInteger(owner.pid) && owner.pid > 0);
}

function portableRelative(root: string, target: string) {
  return path.relative(root, target).split(path.sep).join('/');
}

function isInsideOrEqual(parent: string, candidate: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function pathsOverlap(left: string, right: string) {
  return isInsideOrEqual(left, right) || isInsideOrEqual(right, left);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectResetFlags(values: Record<string, unknown>, command: string) {
  if (values['dry-run'] || values.execute) {
    throw new WorldLabError(`${command} does not accept reset mode flags`, 'invalid_arguments');
  }
}

function usage() {
  return [
    'Usage:',
    '  world-lab status --config <file> --world <id>',
    '  world-lab verify --config <file> --world <id>',
    '  world-lab reset --config <file> --world <id> --dry-run',
    '',
    'The CLI only plans resets. It is fail-closed and requires an explicit prepared baseline.',
    'verify exits 0 only when artifact integrity, topology, locks, and port checks make resetReady true.',
    'A raw source world is provenance only and is never promoted implicitly.',
  ].join('\n');
}

if (require.main === module) {
  void runCli().then((code) => {
    process.exitCode = code;
  });
}
