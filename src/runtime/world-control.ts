import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WORLD_OWNER_PROTOCOL = 'behold.world-owner.v1' as const;

export type WorldControlState =
  | 'stopped_verified'
  | 'resetting'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'recovery_required';

export type WorldOwnerRecord = Readonly<{
  protocol: typeof WORLD_OWNER_PROTOCOL;
  world: string;
  epoch: number;
  token: string;
  hostname: string;
  managerPid: number;
  state: WorldControlState;
  createdAt: string;
  updatedAt: string;
  runtime: Readonly<{ path: string; device: number; inode: number }>;
  server: Readonly<{ pid: number; jarSha256: string }> | null;
  controllers: ReadonlyArray<Readonly<{ entityId: string; pid: number; leasePath: string }>>;
}>;

export type WorldControlInspection =
  | { state: 'clear'; file: string }
  | { state: 'held'; file: string; record: WorldOwnerRecord }
  | { state: 'invalid'; file: string; error: string };

export type WorldLifecycleEvent = Readonly<{
  sequence: number;
  at: string;
  world: string;
  epoch: number;
  type: string;
  data: unknown;
  previousDigest: string | null;
  digest: string;
}>;

export type HeldWorldControl = Readonly<{
  file: string;
  journalFile: string;
  record(): WorldOwnerRecord;
  update(
    state: WorldControlState,
    detail?: Partial<Pick<WorldOwnerRecord, 'server' | 'controllers'>>,
  ): WorldOwnerRecord;
  append(type: string, data?: unknown): WorldLifecycleEvent;
  release(): void;
}>;

export type ManagedWorldResetScope = Readonly<{
  world: string;
  runId: string;
  worldConfigDigest: string;
  baselinePath: string;
  baselineDigest: string;
  runtimePath: string;
  archiveRoot: string;
  stagePath: string;
  archivePath: string;
  entityRoot: string;
  circleIds: readonly string[];
}>;

export type ManagedWorldResetPlanScope = Readonly<
  Pick<
    ManagedWorldResetScope,
    | 'world'
    | 'runId'
    | 'worldConfigDigest'
    | 'baselinePath'
    | 'baselineDigest'
    | 'runtimePath'
    | 'archiveRoot'
    | 'stagePath'
    | 'archivePath'
  >
>;

export type ManagedWorldResetCapability = Readonly<{
  kind: 'behold.managed-world-reset.v1';
  world: string;
  epoch: number;
  runId: string;
}>;

export type ManagedWorldResetSettlement = 'completed' | 'unchanged' | 'recovery_required';

export type ManagedControllerAdmissionProof = Readonly<{
  file: string;
  device: number;
  inode: number;
  world: string;
  epoch: number;
  token: string;
  runId: string;
}>;

type HeldWorldControlInternals = {
  assertHeld(): void;
  current(): WorldOwnerRecord;
  transition(
    state: WorldControlState,
    detail?: Partial<Pick<WorldOwnerRecord, 'server' | 'controllers'>>,
  ): WorldOwnerRecord;
  replaceRuntime(runtimePath: string): WorldOwnerRecord;
};

type IssuedManagedReset = {
  control: HeldWorldControl;
  scope: ManagedWorldResetScope;
  priorRuntime: WorldOwnerRecord['runtime'];
  key: Buffer;
  keyFile: string;
  active: boolean;
};

const heldWorldControls = new WeakMap<object, HeldWorldControlInternals>();
const issuedManagedResets = new WeakMap<object, IssuedManagedReset>();
const activeManagedResets = new WeakMap<object, ManagedWorldResetCapability>();

export function inspectWorldControl(controlRoot: string, world: string): WorldControlInspection {
  const file = ownerFile(controlRoot, world);
  if (!fs.existsSync(file)) return { state: 'clear', file };
  try {
    return { state: 'held', file, record: parseOwnerRecord(fs.readFileSync(file, 'utf8')) };
  } catch (error: any) {
    return { state: 'invalid', file, error: error?.message || String(error) };
  }
}

/** First half of controller admission, before its entity runtime lease is created. */
export function beginManagedControllerAdmission(options: {
  controlFile: string;
  world: string;
  runId: string;
}): ManagedControllerAdmissionProof {
  const { file, stats, record } = readManagedControllerOwner(options.controlFile);
  assertControllerAdmissionRecord(record, options.world, options.runId);
  return Object.freeze({
    file,
    device: stats.dev,
    inode: stats.ino,
    world: record.world,
    epoch: record.epoch,
    token: record.token,
    runId: options.runId,
  });
}

/** Second half of controller admission, after its fsynced entity lease exists. */
export function confirmManagedControllerAdmission(proof: ManagedControllerAdmissionProof) {
  const { file, stats, record } = readManagedControllerOwner(proof.file);
  assertControllerAdmissionRecord(record, proof.world, proof.runId);
  if (
    file !== proof.file ||
    stats.dev !== proof.device ||
    stats.ino !== proof.inode ||
    record.epoch !== proof.epoch ||
    record.token !== proof.token
  ) {
    throw new Error('Managed controller owner changed during admission');
  }
  return record;
}

export function verifyWorldLifecycleJournal(file: string) {
  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
  const events: WorldLifecycleEvent[] = [];
  let previousDigest: string | null = null;
  let world: string | null = null;
  let epoch: number | null = null;
  for (const [index, line] of lines.entries()) {
    const event = JSON.parse(line);
    const { digest, ...payload } = event;
    const expected = lifecycleDigest(previousDigest, payload);
    if (
      event.sequence !== index + 1 ||
      event.previousDigest !== previousDigest ||
      typeof digest !== 'string' ||
      digest !== expected ||
      (world !== null && event.world !== world) ||
      (epoch !== null && event.epoch !== epoch)
    ) {
      throw new Error(`Invalid world lifecycle journal at line ${index + 1}: ${file}`);
    }
    world = event.world;
    epoch = event.epoch;
    previousDigest = digest;
    events.push(event as WorldLifecycleEvent);
  }
  return Object.freeze({
    file,
    world,
    epoch,
    events: Object.freeze(events),
    tipDigest: previousDigest,
  });
}

export function acquireWorldControl(options: {
  controlRoot: string;
  world: string;
  runtimePath: string;
  now?: () => Date;
  pid?: number;
  hostname?: string;
}): HeldWorldControl {
  const now = options.now ?? (() => new Date());
  const directory = path.join(options.controlRoot, safeSegment(options.world));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fsyncDirectory(path.dirname(directory));
  fsyncDirectory(directory);
  const file = path.join(directory, 'owner.json');
  let descriptor: number;
  try {
    descriptor = fs.openSync(file, 'wx', 0o600);
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      throw new Error(`World ${options.world} is already controlled: ${file}`);
    }
    throw error;
  }

  try {
    const runtimePath = fs.realpathSync.native(options.runtimePath);
    const runtimeStats = fs.statSync(runtimePath);
    if (!runtimeStats.isDirectory()) throw new Error(`Runtime is not a directory: ${runtimePath}`);
    const epoch = advanceEpoch(directory);
    let current: WorldOwnerRecord = Object.freeze({
      protocol: WORLD_OWNER_PROTOCOL,
      world: options.world,
      epoch,
      token: randomUUID(),
      hostname: options.hostname ?? os.hostname(),
      managerPid: options.pid ?? process.pid,
      state: 'stopped_verified',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      runtime: Object.freeze({
        path: runtimePath,
        device: runtimeStats.dev,
        inode: runtimeStats.ino,
      }),
      server: null,
      controllers: Object.freeze([]),
    });
    writeHeldRecord(descriptor, current);
    fsyncDirectory(directory);

    const journalFile = path.join(directory, `lifecycle-${epoch}.jsonl`);
    const journalDescriptor = fs.openSync(journalFile, 'wx', 0o600);
    let journalSequence = 0;
    let previousJournalDigest: string | null = null;
    let released = false;

    const assertHeld = () => {
      if (released) throw new Error(`World control already released: ${file}`);
      const descriptorStats = fs.fstatSync(descriptor);
      const pathStats = fs.lstatSync(file);
      if (
        pathStats.isSymbolicLink() ||
        descriptorStats.dev !== pathStats.dev ||
        descriptorStats.ino !== pathStats.ino
      ) {
        throw new Error(`World owner record was replaced: ${file}`);
      }
      const observed = parseOwnerRecord(fs.readFileSync(file, 'utf8'));
      if (observed.token !== current.token || observed.epoch !== current.epoch) {
        throw new Error(`World owner token changed: ${file}`);
      }
    };

    const append = (type: string, data: unknown = {}): WorldLifecycleEvent => {
      assertHeld();
      const payload = {
        sequence: ++journalSequence,
        at: now().toISOString(),
        world: current.world,
        epoch: current.epoch,
        type,
        data: structuredClone(data),
        previousDigest: previousJournalDigest,
      };
      const event: WorldLifecycleEvent = Object.freeze({
        ...payload,
        digest: lifecycleDigest(previousJournalDigest, payload),
      });
      fs.writeSync(journalDescriptor, `${JSON.stringify(event)}\n`);
      fs.fsyncSync(journalDescriptor);
      previousJournalDigest = event.digest;
      return event;
    };

    append('control_acquired', { owner: current });

    const transition = (
      state: WorldControlState,
      detail: Partial<Pick<WorldOwnerRecord, 'server' | 'controllers'>> = {},
      runtime: WorldOwnerRecord['runtime'] = current.runtime,
    ) => {
      assertHeld();
      const server =
        detail.server === undefined
          ? current.server
          : detail.server === null
            ? null
            : Object.freeze(structuredClone(detail.server));
      const controllers =
        detail.controllers === undefined
          ? current.controllers
          : Object.freeze(
              detail.controllers.map((controller) => Object.freeze(structuredClone(controller))),
            );
      assertWorldControlTransition(current.state, state, server, controllers);
      current = Object.freeze({
        ...current,
        state,
        updatedAt: now().toISOString(),
        runtime,
        server,
        controllers,
      });
      writeHeldRecord(descriptor, current);
      append('control_state_changed', {
        state,
        runtime: current.runtime,
        server: current.server,
        controllers: current.controllers,
      });
      return current;
    };

    const control: HeldWorldControl = Object.freeze({
      file,
      journalFile,
      record: () => current,
      update: (state, detail) => {
        if (state === 'resetting' || current.state === 'resetting') {
          throw new Error('Reset state transitions require a managed reset capability');
        }
        return transition(state, detail);
      },
      append,
      release: () => {
        assertHeld();
        if (current.state !== 'stopped_verified' || current.server || current.controllers.length) {
          throw new Error(`World control cannot release from state ${current.state}`);
        }
        append('control_released');
        fs.closeSync(journalDescriptor);
        fs.closeSync(descriptor);
        fs.unlinkSync(file);
        fsyncDirectory(directory);
        released = true;
      },
    });
    heldWorldControls.set(control, {
      assertHeld,
      current: () => current,
      transition,
      replaceRuntime: (nextRuntimePath) => {
        assertHeld();
        if (current.state !== 'resetting' || current.server || current.controllers.length) {
          throw new Error(`World runtime cannot be replaced from state ${current.state}`);
        }
        return transition('stopped_verified', {}, canonicalRuntimeIdentity(nextRuntimePath));
      },
    });
    return control;
  } catch (error) {
    try {
      fs.closeSync(descriptor);
    } catch {}
    try {
      fs.unlinkSync(file);
      fsyncDirectory(path.dirname(file));
    } catch {}
    throw error;
  }
}

/**
 * Issues one exact reset authority from a held, stopped lifecycle epoch. The
 * capability cannot launch a server, widen its paths, or outlive settlement.
 */
export function issueManagedWorldResetCapability(
  control: HeldWorldControl,
  requestedScope: ManagedWorldResetScope,
): ManagedWorldResetCapability {
  const internals = heldWorldControls.get(control);
  if (!internals) throw new Error('Managed reset requires a locally held world control');
  internals.assertHeld();
  if (activeManagedResets.has(control)) {
    throw new Error('World control already has an active managed reset');
  }
  const current = internals.current();
  if (current.state !== 'stopped_verified' || current.server || current.controllers.length) {
    throw new Error(`Managed reset cannot begin from state ${current.state}`);
  }
  const scope = normalizeManagedResetScope(requestedScope);
  if (scope.world !== current.world) throw new Error('Managed reset world does not match control');
  const observedRuntime = canonicalRuntimeIdentity(scope.runtimePath);
  if (!sameRuntimeIdentity(observedRuntime, current.runtime)) {
    throw new Error('Managed reset runtime identity does not match control');
  }

  assertEntityLeaseFence(scope.entityRoot, scope.circleIds);
  const { key, keyFile } = loadOrCreateManagedResetKey(path.dirname(control.file));
  internals.transition('resetting', { server: null, controllers: [] });
  try {
    assertEntityLeaseFence(scope.entityRoot, scope.circleIds);
  } catch (error) {
    try {
      internals.transition('recovery_required', { server: null, controllers: [] });
    } catch {}
    throw error;
  }

  const capability: ManagedWorldResetCapability = Object.freeze({
    kind: 'behold.managed-world-reset.v1',
    world: current.world,
    epoch: current.epoch,
    runId: scope.runId,
  });
  issuedManagedResets.set(capability, {
    control,
    scope,
    priorRuntime: current.runtime,
    key,
    keyFile,
    active: true,
  });
  activeManagedResets.set(control, capability);
  control.append('managed_reset_authority_issued', {
    runId: scope.runId,
    baselinePath: scope.baselinePath,
    runtimePath: scope.runtimePath,
    stagePath: scope.stagePath,
    archivePath: scope.archivePath,
    worldConfigDigest: scope.worldConfigDigest,
    baselineDigest: scope.baselineDigest,
    entityRoot: scope.entityRoot,
    circleIds: scope.circleIds,
  });
  return capability;
}

/** Returns the reset-journal key only after revalidating owner, state, scope, and runtime inode. */
export function authorizeManagedWorldResetCapability(
  capability: ManagedWorldResetCapability,
  requestedScope: ManagedWorldResetPlanScope,
) {
  const { issued } = validateManagedWorldResetCapability(capability, requestedScope, true, true);
  return Buffer.from(issued.key);
}

function validateManagedWorldResetCapability(
  capability: ManagedWorldResetCapability,
  requestedScope: ManagedWorldResetPlanScope,
  requirePriorRuntime: boolean,
  requireLeaseFence: boolean,
) {
  const issued = issuedManagedResets.get(capability);
  if (!issued?.active) throw new Error('Managed reset capability is absent or settled');
  const internals = heldWorldControls.get(issued.control);
  if (!internals) throw new Error('Managed reset control is not locally held');
  internals.assertHeld();
  const current = internals.current();
  const scope = normalizeManagedResetPlanScope(requestedScope, requirePriorRuntime);
  if (
    current.state !== 'resetting' ||
    current.server !== null ||
    current.controllers.length !== 0 ||
    current.world !== capability.world ||
    current.epoch !== capability.epoch ||
    capability.runId !== issued.scope.runId ||
    !sameManagedResetPlanScope(scope, issued.scope) ||
    (requirePriorRuntime &&
      !sameRuntimeIdentity(canonicalRuntimeIdentity(scope.runtimePath), issued.priorRuntime))
  ) {
    throw new Error('Managed reset capability is no longer valid for this world state');
  }
  if (requireLeaseFence) assertEntityLeaseFence(issued.scope.entityRoot, issued.scope.circleIds);
  const observedKey = readManagedResetKey(issued.keyFile);
  if (observedKey.length !== issued.key.length || !timingSafeEqual(observedKey, issued.key)) {
    throw new Error('Managed reset authority key changed');
  }
  return { issued, current };
}

/**
 * Consumes a reset capability. Completed activation rebinds the lifecycle
 * owner to the new runtime inode; only an unchanged old inode may return to
 * stopped after an aborted or rolled-back transaction.
 */
export function settleManagedWorldResetCapability(
  capability: ManagedWorldResetCapability,
  settlement: ManagedWorldResetSettlement,
) {
  const issuedRecord = issuedManagedResets.get(capability);
  if (!issuedRecord?.active) throw new Error('Managed reset capability is absent or settled');
  const { issued } = validateManagedWorldResetCapability(
    capability,
    issuedRecord.scope,
    settlement === 'unchanged',
    settlement !== 'recovery_required',
  );
  const internals = heldWorldControls.get(issued.control)!;
  issued.control.append('managed_reset_settling', {
    runId: issued.scope.runId,
    settlement,
  });
  let next: WorldOwnerRecord;
  if (settlement === 'completed') {
    next = internals.replaceRuntime(issued.scope.runtimePath);
  } else if (settlement === 'unchanged') {
    const observed = canonicalRuntimeIdentity(issued.scope.runtimePath);
    if (!sameRuntimeIdentity(observed, issued.priorRuntime)) {
      throw new Error('An aborted managed reset did not preserve the prior runtime identity');
    }
    next = internals.transition('stopped_verified', { server: null, controllers: [] });
  } else {
    next = internals.transition('recovery_required', { server: null, controllers: [] });
  }
  issued.active = false;
  activeManagedResets.delete(issued.control);
  return next;
}

export type EntityLeaseFenceInspection = Readonly<{
  state: 'clear' | 'owned' | 'unknown';
  entityRoot: string;
  circleIds: readonly string[];
  owned: ReadonlyArray<
    Readonly<{ entityId: string; circleId: string; leasePath: string; pid: number }>
  >;
  unknown: ReadonlyArray<Readonly<{ entry: string; reason: string }>>;
}>;

/** Finds controller leases bound to any of the supplied world-circle identities. */
export function inspectEntityLeaseFence(
  entityRoot: string,
  requestedCircleIds: readonly string[],
): EntityLeaseFenceInspection {
  const circleIds = Object.freeze(
    [...new Set(requestedCircleIds.map((value) => String(value).trim()).filter(Boolean))].sort(),
  );
  const owned: Array<{ entityId: string; circleId: string; leasePath: string; pid: number }> = [];
  const unknown: Array<{ entry: string; reason: string }> = [];
  let canonicalRoot = path.resolve(entityRoot);
  let entries: fs.Dirent[];
  try {
    canonicalRoot = fs.realpathSync.native(entityRoot);
    const stats = fs.lstatSync(canonicalRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('not a plain directory');
    entries = fs.readdirSync(canonicalRoot, { withFileTypes: true });
  } catch (error: any) {
    return Object.freeze({
      state: 'unknown',
      entityRoot: canonicalRoot,
      circleIds,
      owned: Object.freeze([]),
      unknown: Object.freeze([
        Object.freeze({ entry: canonicalRoot, reason: error?.message || String(error) }),
      ]),
    });
  }

  for (const entry of entries) {
    const directory = path.join(canonicalRoot, entry.name);
    if (entry.isSymbolicLink()) {
      unknown.push({ entry: directory, reason: 'symbolic entity directory' });
      continue;
    }
    if (!entry.isDirectory()) continue;
    const bindingPath = path.join(directory, 'circle.json');
    const leasePath = path.join(directory, 'runtime.lock');
    if (!fs.existsSync(leasePath)) continue;
    let binding: any;
    try {
      const stats = fs.lstatSync(bindingPath);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('binding is not a plain file');
      binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
      if (
        binding?.protocol !== 'behold.entity-circle-binding.v1' ||
        binding?.entityId !== entry.name ||
        typeof binding?.circleId !== 'string' ||
        !binding.circleId.trim()
      ) {
        throw new Error('binding schema is invalid');
      }
    } catch (error: any) {
      unknown.push({
        entry: leasePath,
        reason: `lease has no trustworthy circle binding: ${error?.message || String(error)}`,
      });
      continue;
    }
    if (!circleIds.includes(binding.circleId)) continue;
    try {
      const stats = fs.lstatSync(leasePath);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('lease is not a plain file');
      const lease = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
      if (
        lease?.protocol !== 'behold.entity-runtime-lease.v1' ||
        lease?.entityId !== entry.name ||
        !Number.isSafeInteger(lease?.pid) ||
        lease.pid < 1
      ) {
        throw new Error('lease schema is invalid');
      }
      owned.push({
        entityId: entry.name,
        circleId: binding.circleId,
        leasePath,
        pid: lease.pid,
      });
    } catch (error: any) {
      unknown.push({ entry: leasePath, reason: error?.message || String(error) });
    }
  }

  return Object.freeze({
    state: unknown.length ? 'unknown' : owned.length ? 'owned' : 'clear',
    entityRoot: canonicalRoot,
    circleIds,
    owned: Object.freeze(owned.map((value) => Object.freeze(value))),
    unknown: Object.freeze(unknown.map((value) => Object.freeze(value))),
  });
}

function assertEntityLeaseFence(entityRoot: string, circleIds: readonly string[]) {
  const inspection = inspectEntityLeaseFence(entityRoot, circleIds);
  if (inspection.state !== 'clear') {
    throw new Error(`Managed reset entity lease fence is ${inspection.state}`);
  }
  return inspection;
}

function normalizeManagedResetScope(scope: ManagedWorldResetScope): ManagedWorldResetScope {
  safeSegment(scope.world);
  safeSegment(scope.runId);
  assertSha256(scope.worldConfigDigest, 'world config');
  assertSha256(scope.baselineDigest, 'baseline');
  const normalized = Object.freeze({
    world: scope.world,
    runId: scope.runId,
    worldConfigDigest: scope.worldConfigDigest.toLowerCase(),
    baselinePath: canonicalPlainDirectory(scope.baselinePath, 'baseline'),
    baselineDigest: scope.baselineDigest.toLowerCase(),
    runtimePath: canonicalPlainDirectory(scope.runtimePath, 'runtime'),
    archiveRoot: canonicalPlainDirectory(scope.archiveRoot, 'archive root'),
    stagePath: canonicalFuturePath(scope.stagePath, 'stage'),
    archivePath: canonicalFuturePath(scope.archivePath, 'archive'),
    entityRoot: canonicalPlainDirectory(scope.entityRoot, 'entity root'),
    circleIds: Object.freeze(
      [...new Set(scope.circleIds.map((value) => String(value).trim()).filter(Boolean))].sort(),
    ),
  });
  if (!normalized.circleIds.length) throw new Error('Managed reset requires a world circle ID');
  if (path.dirname(normalized.archivePath) !== normalized.archiveRoot) {
    throw new Error('Managed reset archive path must be directly beneath its archive root');
  }
  return normalized;
}

function normalizeManagedResetPlanScope(
  scope: ManagedWorldResetPlanScope,
  requireRuntime: boolean,
): ManagedWorldResetPlanScope {
  safeSegment(scope.world);
  safeSegment(scope.runId);
  assertSha256(scope.worldConfigDigest, 'world config');
  assertSha256(scope.baselineDigest, 'baseline');
  return Object.freeze({
    world: scope.world,
    runId: scope.runId,
    worldConfigDigest: scope.worldConfigDigest.toLowerCase(),
    baselinePath: canonicalPlainDirectory(scope.baselinePath, 'baseline'),
    baselineDigest: scope.baselineDigest.toLowerCase(),
    runtimePath: requireRuntime
      ? canonicalPlainDirectory(scope.runtimePath, 'runtime')
      : requireAbsoluteNormalizedPath(scope.runtimePath, 'runtime'),
    archiveRoot: canonicalPlainDirectory(scope.archiveRoot, 'archive root'),
    stagePath: canonicalFuturePath(scope.stagePath, 'stage'),
    archivePath: canonicalFuturePath(scope.archivePath, 'archive'),
  });
}

function sameManagedResetPlanScope(
  left: ManagedWorldResetPlanScope,
  right: ManagedWorldResetPlanScope,
) {
  return (
    left.world === right.world &&
    left.runId === right.runId &&
    left.worldConfigDigest === right.worldConfigDigest &&
    left.baselinePath === right.baselinePath &&
    left.baselineDigest === right.baselineDigest &&
    left.runtimePath === right.runtimePath &&
    left.archiveRoot === right.archiveRoot &&
    left.stagePath === right.stagePath &&
    left.archivePath === right.archivePath
  );
}

function loadOrCreateManagedResetKey(directory: string) {
  const keyFile = path.join(directory, 'reset-journal.key');
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(keyFile, 'wx', 0o600);
    const key = randomBytes(32);
    fs.writeSync(descriptor, key);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fsyncDirectory(directory);
  } catch (error: any) {
    if (descriptor !== null) fs.closeSync(descriptor);
    if (error?.code !== 'EEXIST') throw error;
  }
  return { keyFile, key: readManagedResetKey(keyFile) };
}

function readManagedResetKey(keyFile: string) {
  const stats = fs.lstatSync(keyFile);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size !== 32 ||
    (stats.mode & 0o077) !== 0
  ) {
    throw new Error('Managed reset journal key must be a private 32-byte regular file');
  }
  return fs.readFileSync(keyFile);
}

function canonicalRuntimeIdentity(runtimePath: string): WorldOwnerRecord['runtime'] {
  const canonicalPath = canonicalPlainDirectory(runtimePath, 'runtime');
  const stats = fs.statSync(canonicalPath);
  return Object.freeze({ path: canonicalPath, device: stats.dev, inode: stats.ino });
}

function sameRuntimeIdentity(
  left: WorldOwnerRecord['runtime'],
  right: WorldOwnerRecord['runtime'],
) {
  return left.path === right.path && left.device === right.device && left.inode === right.inode;
}

function canonicalPlainDirectory(candidate: string, label: string) {
  if (!path.isAbsolute(candidate)) throw new Error(`Managed reset ${label} path must be absolute`);
  const canonical = fs.realpathSync.native(candidate);
  const stats = fs.lstatSync(canonical);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Managed reset ${label} must be a plain directory`);
  }
  return canonical;
}

function requireAbsoluteNormalizedPath(candidate: string, label: string) {
  if (!path.isAbsolute(candidate)) throw new Error(`Managed reset ${label} path must be absolute`);
  return path.resolve(candidate);
}

function canonicalFuturePath(candidate: string, label: string) {
  const normalized = requireAbsoluteNormalizedPath(candidate, label);
  const parent = fs.realpathSync.native(path.dirname(normalized));
  return path.join(parent, path.basename(normalized));
}

function assertSha256(value: string, label: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`Managed reset ${label} digest is invalid`);
}

function assertWorldControlTransition(
  from: WorldControlState,
  to: WorldControlState,
  server: WorldOwnerRecord['server'],
  controllers: WorldOwnerRecord['controllers'],
) {
  const allowed: Record<WorldControlState, readonly WorldControlState[]> = {
    stopped_verified: [
      'stopped_verified',
      'resetting',
      'starting',
      'stopping',
      'recovery_required',
    ],
    resetting: ['resetting', 'stopped_verified', 'recovery_required'],
    starting: ['starting', 'running', 'stopping', 'recovery_required'],
    running: ['running', 'stopping', 'recovery_required'],
    stopping: ['stopping', 'stopped_verified', 'recovery_required'],
    recovery_required: ['recovery_required'],
  };
  if (!allowed[from].includes(to))
    throw new Error(`Invalid world control transition ${from} -> ${to}`);
  if ((to === 'stopped_verified' || to === 'resetting') && (server || controllers.length)) {
    throw new Error(`World control state ${to} cannot retain server or controller ownership`);
  }
  if (to === 'running' && !server) throw new Error('Running world control requires a server');
}

function parseOwnerRecord(raw: string): WorldOwnerRecord {
  const value = JSON.parse(raw);
  if (
    value?.protocol !== WORLD_OWNER_PROTOCOL ||
    typeof value.world !== 'string' ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 1 ||
    typeof value.token !== 'string' ||
    typeof value.hostname !== 'string' ||
    !Number.isSafeInteger(value.managerPid) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    ![
      'stopped_verified',
      'resetting',
      'starting',
      'running',
      'stopping',
      'recovery_required',
    ].includes(value.state) ||
    typeof value.runtime?.path !== 'string' ||
    !Number.isSafeInteger(value.runtime?.device) ||
    !Number.isSafeInteger(value.runtime?.inode) ||
    (value.server !== null &&
      (!Number.isSafeInteger(value.server?.pid) || typeof value.server?.jarSha256 !== 'string')) ||
    !Array.isArray(value.controllers) ||
    value.controllers.some(
      (controller: any) =>
        typeof controller?.entityId !== 'string' ||
        !Number.isSafeInteger(controller?.pid) ||
        typeof controller?.leasePath !== 'string',
    )
  ) {
    throw new Error('invalid behold.world-owner.v1 record');
  }
  return value as WorldOwnerRecord;
}

function readManagedControllerOwner(controlFile: string) {
  const file = path.resolve(controlFile);
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Managed controller owner must be a plain file');
  }
  return { file, stats, record: parseOwnerRecord(fs.readFileSync(file, 'utf8')) };
}

function assertControllerAdmissionRecord(record: WorldOwnerRecord, world: string, runId: string) {
  if (record.world !== world) throw new Error('Managed controller world does not match owner');
  if (runId !== `${record.world}-${record.epoch}`) {
    throw new Error('Managed controller run does not match owner epoch');
  }
  if (record.state !== 'starting' && record.state !== 'running') {
    throw new Error(`Managed controller admission is blocked while world is ${record.state}`);
  }
  if (!record.server) throw new Error('Managed controller admission requires an owned server');
}

function writeHeldRecord(descriptor: number, record: WorldOwnerRecord) {
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  fs.ftruncateSync(descriptor, 0);
  fs.writeSync(descriptor, bytes, 0, bytes.length, 0);
  fs.fsyncSync(descriptor);
}

function lifecycleDigest(previousDigest: string | null, payload: unknown) {
  return createHash('sha256')
    .update(previousDigest ?? '')
    .update('\n')
    .update(JSON.stringify(payload))
    .digest('hex');
}

function advanceEpoch(directory: string) {
  const file = path.join(directory, 'epoch');
  let previous = 0;
  try {
    previous = Number(fs.readFileSync(file, 'utf8').trim());
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const next = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${next}\n`, { encoding: 'utf8', mode: 0o600 });
  const descriptor = fs.openSync(temporary, 'r');
  fs.fsyncSync(descriptor);
  fs.closeSync(descriptor);
  fs.renameSync(temporary, file);
  fsyncDirectory(directory);
  return next;
}

function ownerFile(controlRoot: string, world: string) {
  return path.join(controlRoot, safeSegment(world), 'owner.json');
}

function safeSegment(value: string) {
  const safe = String(value).replace(/[^a-zA-Z0-9._-]+/g, '-');
  if (!safe || safe === '.' || safe === '..' || safe !== value) {
    throw new Error(`Invalid world identifier: ${value}`);
  }
  return safe;
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
