#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

export const CONFIG_SCHEMA_VERSION = 1;
export const SESSION_LOCK = 'session.lock';

export interface HashedDirectory {
  path: string;
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
  schemaVersion: 1;
  worlds: Record<string, WorldLabDefinition>;
}

export interface TreeDigest {
  algorithm: 'sha256';
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
}

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
  };

  constructor(message: string, evidence: ResetExecutionError['evidence']) {
    super(message, 'reset_activation_failed', evidence);
    this.name = 'ResetExecutionError';
    this.evidence = evidence;
  }
}

const issuedFixtureCapabilities = new WeakSet<object>();

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
  issuedFixtureCapabilities.add(capability);
  return capability;
}

const defaultMutationOperations: MutationOperations = {
  copyDirectory(from, to) {
    fs.cpSync(from, to, {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
      dereference: false,
      filter: (entry) => path.basename(entry) !== SESSION_LOCK,
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
 * Hashes file content and relative paths, not mtimes, ownership, absolute paths,
 * or empty directories. Minecraft's ephemeral session.lock is not included.
 */
export function digestTree(rootPath: string): TreeDigest {
  const root = path.resolve(rootPath);
  assertPlainDirectory(root, 'digest_root');

  const entries: Array<{ type: 'directory' | 'file'; relative: string; full: string }> = [];
  const excluded: string[] = [];

  function walk(directory: string) {
    const children = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const child of children) {
      const full = path.join(directory, child.name);
      const relative = portableRelative(root, full);
      if (child.name === SESSION_LOCK) {
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
      if (child.isDirectory()) {
        entries.push({ type: 'directory', relative, full });
        walk(full);
      } else if (child.isFile()) {
        entries.push({ type: 'file', relative, full });
      } else {
        throw new WorldLabError(
          `Unsupported filesystem entry: ${full}`,
          'unsupported_filesystem_entry',
          { path: full },
        );
      }
    }
  }

  walk(root);
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.relative), Buffer.from(b.relative)));
  excluded.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

  const tree = createHash('sha256');
  let files = 0;
  let directories = 0;
  let bytes = 0;

  for (const entry of entries) {
    if (entry.type === 'directory') {
      directories += 1;
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
    const contents = fs.readFileSync(entry.full);
    const after = fs.statSync(entry.full);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino
    ) {
      throw new WorldLabError(
        `File changed while it was being hashed: ${entry.full}`,
        'tree_changed_during_digest',
        { path: entry.full },
      );
    }

    const fileDigest = createHash('sha256').update(contents).digest('hex');
    files += 1;
    bytes += contents.byteLength;
    tree.update(fileDigest);
    tree.update(`  ./${entry.relative}\n`);
  }

  return {
    algorithm: 'sha256',
    digest: tree.digest('hex'),
    files,
    directories,
    bytes,
    excluded,
  };
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
  const runId = options.runId || defaultRunId((dependencies.now || (() => new Date()))());
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

  assertFixtureExecutionCapability(dependencies.fixtureExecutionCapability, plan, verification);

  const mutation = {
    ...defaultMutationOperations,
    ...(dependencies.mutationOperations || {}),
  };
  mutation.makeDirectory(path.dirname(plan.archivePath));
  mutation.copyDirectory(plan.baselinePath, plan.stagePath);

  const stageDigest = digestTree(plan.stagePath).digest;
  if (stageDigest !== plan.expectedBaselineDigest) {
    throw new WorldLabError(
      `Staged baseline digest mismatch: expected ${plan.expectedBaselineDigest}, got ${stageDigest}`,
      'staged_digest_mismatch',
      { plan, stageDigest },
    );
  }

  // Repeat the evidence probes after copying. This is defense in depth for the
  // temporary-fixture seam, not a claim of lifecycle-safe real execution.
  const secondGate = await statusWorld(worldId, world, dependencies);
  if (!secondGate.safe) throw new SafetyRefusal(secondGate.blockers, { plan, secondGate });

  let archived = false;
  try {
    mutation.rename(plan.runtimePath, plan.archivePath);
    archived = true;
    mutation.rename(plan.stagePath, plan.runtimePath);
  } catch (activationError: any) {
    let rollbackAttempted = false;
    let rollbackSucceeded = false;
    let rollbackError: string | undefined;
    if (archived) {
      rollbackAttempted = true;
      try {
        mutation.rename(plan.archivePath, plan.runtimePath);
        rollbackSucceeded = true;
      } catch (error: any) {
        rollbackError = String(error?.message || error);
      }
    }
    throw new ResetExecutionError(
      rollbackSucceeded
        ? 'Baseline activation failed; the previous run was restored'
        : 'Baseline activation failed and rollback did not restore the previous run',
      {
        plan,
        activationError: String(activationError?.message || activationError),
        rollbackAttempted,
        rollbackSucceeded,
        rollbackError,
      },
    );
  }

  return {
    mode: 'executed',
    plan,
    verification,
    stageDigest,
    archivePath: plan.archivePath,
  };
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
  if (!capability || !issuedFixtureCapabilities.has(capability)) {
    throw new SafetyRefusal(['fixture_execution_capability_required'], { plan });
  }
  const currentRoot = canonicalizeDirectory('runtime_world', capability.root);
  if (
    currentRoot.error ||
    currentRoot.canonicalPath !== capability.canonicalRoot ||
    currentRoot.device !== capability.device ||
    currentRoot.inode !== capability.inode
  ) {
    throw new SafetyRefusal(['fixture_execution_capability_invalid'], {
      capability,
      currentRoot,
    });
  }

  const scopedPaths = [
    verification.runtime.topology.artifacts.source.canonicalPath,
    verification.runtime.topology.artifacts.preparedBaseline?.canonicalPath,
    verification.runtime.topology.artifacts.runtime.canonicalPath,
    verification.runtime.topology.artifacts.archiveRoot.canonicalPath,
    plan.stagePath,
    plan.archivePath,
  ].filter(Boolean) as string[];
  const outside = scopedPaths.filter(
    (candidate) => !isInsideOrEqual(capability.canonicalRoot, path.resolve(candidate)),
  );
  if (outside.length) {
    throw new SafetyRefusal(['fixture_execution_scope_violation'], {
      capability,
      outside,
    });
  }
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
