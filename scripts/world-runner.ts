#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  assertFixtureExecutionScope,
  digestTree,
  loadWorldLabConfig,
  resetWorld,
  statusWorld,
  verifyWorld,
  worldLabDefinitionDigest,
  type OwnershipEvidence,
  type ResetResult,
  type RuntimeEvidence,
  type FixtureExecutionCapability,
  type WorldLabDependencies,
  type WorldLabDefinition,
} from './world-lab';
import {
  acquireWorldControl,
  inspectEntityLeaseFence,
  inspectWorldControl,
  issueManagedWorldResetCapability,
  settleManagedWorldResetCapability,
  verifyWorldLifecycleJournal,
  type HeldWorldControl,
  type ManagedWorldResetScope,
  type WorldOwnerRecord,
} from '../src/runtime/world-control';
import { DEFAULT_LLM_MODEL } from '../src/config';

export const COME_SEE_DO_REPORT_ALLOW_TOOLS = Object.freeze([
  'chat',
  'look_at',
  'look',
  'move_to',
  'approach_entity',
  'stop',
  'stop_digging',
  'dig_block',
  'place_against',
  'place_block',
  'find_blocks',
  'block_at_cursor',
  'inspect_volume',
  'inspect_reachable_space',
  'entity_at_cursor',
  'nearest_entity',
  'get_nearby',
  'survey_area',
  'status',
]);

export type ManagedControllerProfile = Readonly<{
  task?: string;
  target?: string;
  allowTools?: readonly string[];
}>;

/**
 * The normal managed experience is an untasked resident. Evaluations must opt
 * into their task contract and narrower action surface explicitly.
 */
export function managedControllerProfile(
  taskValue?: unknown,
  targetValue?: unknown,
): ManagedControllerProfile {
  const task = optionalText(taskValue);
  const target = optionalText(targetValue);
  if (!task) {
    if (target) {
      throw new WorldRunnerError(
        '--target is meaningful only with an explicit --task',
        'controller_target_without_task',
      );
    }
    return {};
  }
  if (task === 'come-see-do-report') {
    return {
      task,
      target: target || 'importdf',
      allowTools: COME_SEE_DO_REPORT_ALLOW_TOOLS,
    };
  }
  return { task, ...(target ? { target } : {}) };
}

type RuntimeInspection = RuntimeEvidence & {
  world?: string;
  baselineConfigured?: boolean;
  sourceExists?: boolean;
};

export type ManagedWorldRunOptions = Readonly<{
  worldId: string;
  world: WorldLabDefinition;
  controlRoot: string;
  serverDirectory: string;
  serverJar: string;
  expectedServerJarSha256: string;
  java: string;
  controllerEntry: string;
  controllerEntityId: string;
  controllerLeasePath: string;
  model: string;
  task?: string;
  target?: string;
  allowTools?: readonly string[];
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}>;

export type WorldRunnerDependencies = Readonly<{
  inspectRuntime?: () => Promise<RuntimeInspection>;
  verifyArtifacts?: () => Promise<{ artifactIntegrityOk: boolean; artifacts: unknown }>;
  spawnServer?: () => ChildProcessWithoutNullStreams;
  spawnController?: (context: { runId: string }) => ChildProcessWithoutNullStreams;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}>;

export type ManagedWorldRun = Readonly<{
  runId: string;
  control: HeldWorldControl;
  serverPid: number;
  controllerPid: number;
  finished: Promise<void>;
  quiesceController(reason?: string): Promise<void>;
  stop(reason?: string): Promise<void>;
}>;

export type ManagedWorldRecoveryOptions = Readonly<{
  worldId: string;
  world: WorldLabDefinition;
  controlRoot: string;
  entityRoot: string;
}>;

export type ManagedWorldRecovery = Readonly<{
  protocol: 'behold.world-recovery-result.v1';
  world: string;
  epoch: number;
  classification: 'abandoned_after_save_ack' | 'abandoned_unclean_shutdown';
  preparedEvidence: string;
  completedEvidence: string;
}>;

export class WorldRunnerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly evidence?: unknown,
  ) {
    super(message);
    this.name = 'WorldRunnerError';
  }
}

export type ManagedWorldResetOptions = Readonly<{
  worldId: string;
  world: WorldLabDefinition;
  control: HeldWorldControl;
  resetRunId: string;
  entityRoot: string;
}>;

type ManagedResetTestDependencies = Omit<
  WorldLabDependencies,
  'fixtureExecutionCapability' | 'managedResetCapability'
> & {
  fixtureExecutionCapability: FixtureExecutionCapability;
};

/**
 * Runs the canonical world-lab transaction beneath an already-held lifecycle
 * owner. This seam is programmatic until crash recovery and a named baseline
 * are proven; the standalone world-lab CLI remains dry-run only.
 */
export async function resetHeldManagedWorld(
  options: ManagedWorldResetOptions,
): Promise<ResetResult> {
  return resetHeldManagedWorldInternal(options, {});
}

/** Test-only dependency seam, structurally confined to an issued temporary fixture. */
export async function resetHeldManagedWorldFixture(
  options: ManagedWorldResetOptions,
  dependencies: ManagedResetTestDependencies,
): Promise<ResetResult> {
  assertFixtureExecutionScope(dependencies.fixtureExecutionCapability, [
    options.world.source.path,
    options.world.preparedBaseline?.path ?? options.world.source.path,
    options.world.runtime.worldPath,
    options.world.runtime.archiveRoot,
    options.entityRoot,
  ]);
  const { fixtureExecutionCapability: _fixtureExecutionCapability, ...fixtureDependencies } =
    dependencies;
  return resetHeldManagedWorldInternal(options, fixtureDependencies);
}

async function resetHeldManagedWorldInternal(
  options: ManagedWorldResetOptions,
  dependencies: WorldLabDependencies,
): Promise<ResetResult> {
  const planned = await resetWorld(
    options.worldId,
    options.world,
    { mode: 'dry-run', runId: options.resetRunId },
    dependencies,
  );
  const plan = planned.plan;
  const scope: ManagedWorldResetScope = {
    world: options.worldId,
    runId: options.resetRunId,
    worldConfigDigest: worldLabDefinitionDigest(options.world),
    baselinePath: plan.baselinePath,
    baselineDigest: plan.expectedBaselineDigest,
    runtimePath: plan.runtimePath,
    archiveRoot: path.dirname(plan.archivePath),
    stagePath: plan.stagePath,
    archivePath: plan.archivePath,
    entityRoot: path.resolve(options.entityRoot),
    circleIds: worldCircleIds(options.worldId, options.world),
  };
  const capability = issueManagedWorldResetCapability(options.control, scope);
  try {
    const result = await resetWorld(
      options.worldId,
      options.world,
      { mode: 'execute', runId: options.resetRunId },
      { ...dependencies, managedResetCapability: capability },
    );
    const stopped = await statusWorld(options.worldId, options.world, dependencies);
    assertStoppedEvidence(stopped, 'after_managed_reset');
    const activatedDigest = digestTree(options.world.runtime.worldPath).digest;
    if (activatedDigest !== plan.expectedBaselineDigest) {
      throw new WorldRunnerError(
        'Managed reset activated an unexpected runtime digest',
        'managed_reset_digest_mismatch',
        { expected: plan.expectedBaselineDigest, actual: activatedDigest },
      );
    }
    settleManagedWorldResetCapability(capability, 'completed');
    return result;
  } catch (error) {
    try {
      settleManagedWorldResetCapability(capability, 'recovery_required');
    } catch {}
    throw error;
  }
}

export async function startManagedWorld(
  options: ManagedWorldRunOptions,
  dependencies: WorldRunnerDependencies = {},
): Promise<ManagedWorldRun> {
  const inspectRuntime =
    dependencies.inspectRuntime ?? (() => statusWorld(options.worldId, options.world));
  const verifyArtifacts =
    dependencies.verifyArtifacts ?? (() => verifyWorld(options.worldId, options.world));
  const sleep =
    dependencies.sleep ?? ((milliseconds) => new Promise((r) => setTimeout(r, milliseconds)));
  const stdout = dependencies.stdout ?? ((text) => process.stdout.write(text));
  const stderr = dependencies.stderr ?? ((text) => process.stderr.write(text));
  const startupTimeoutMs = Math.max(100, options.startupTimeoutMs ?? 60_000);
  const shutdownTimeoutMs = Math.max(100, options.shutdownTimeoutMs ?? 60_000);
  const entityRoot = path.dirname(path.dirname(options.controllerLeasePath));
  const circleIds = worldCircleIds(options.worldId, options.world);

  const existingControl = inspectWorldControl(options.controlRoot, options.worldId);
  if (existingControl.state !== 'clear') {
    throw new WorldRunnerError(
      `World control is ${existingControl.state}: ${existingControl.file}`,
      'world_control_not_clear',
      existingControl,
    );
  }
  const verification = await verifyArtifacts();
  if (!verification.artifactIntegrityOk) {
    throw new WorldRunnerError(
      'World source or prepared baseline failed integrity verification',
      'world_artifact_integrity_failed',
      verification.artifacts,
    );
  }
  const before = await inspectRuntime();
  assertStoppedEvidence(before, 'before_control_acquisition');
  assertNoWorldControllerLeases(options, 'before_control_acquisition');
  const jarSha256 = sha256File(options.serverJar);
  if (jarSha256 !== options.expectedServerJarSha256.toLowerCase()) {
    throw new WorldRunnerError(
      'Minecraft server jar digest mismatch',
      'server_jar_digest_mismatch',
      {
        file: options.serverJar,
        expected: options.expectedServerJarSha256,
        actual: jarSha256,
      },
    );
  }

  const control = acquireWorldControl({
    controlRoot: options.controlRoot,
    world: options.worldId,
    runtimePath: options.world.runtime.worldPath,
    now: dependencies.now,
  });
  const managedRunId = `${options.worldId}-${control.record().epoch}`;
  let server: ChildProcessWithoutNullStreams | null = null;
  let controller: ChildProcessWithoutNullStreams | null = null;
  let serverExit: Promise<ProcessExit> | null = null;
  let controllerExit: Promise<ProcessExit> | null = null;
  let serverOutput: OutputCapture | null = null;
  let stopping = false;
  let controllerQuiescing = false;

  try {
    const fenced = await inspectRuntime();
    assertStoppedEvidence(fenced, 'after_control_acquisition');
    assertNoWorldControllerLeases(options, 'after_control_acquisition');
    const launchJarSha256 = sha256File(options.serverJar);
    if (launchJarSha256 !== jarSha256) {
      throw new WorldRunnerError(
        'Minecraft server jar changed after control acquisition',
        'server_jar_changed_before_launch',
        { before: jarSha256, after: launchJarSha256 },
      );
    }
    const sourceRevision = gitProvenance();
    control.append('run_configured', {
      runId: managedRunId,
      model: options.model,
      task: options.task ?? null,
      target: options.target ?? null,
      allowTools: options.allowTools ?? null,
      world: {
        id: options.worldId,
        sourceDigest: options.world.source.expectedDigest,
        preparedBaselineDigest: options.world.preparedBaseline?.expectedDigest ?? null,
        runtime: control.record().runtime,
      },
      serverJarSha256: jarSha256,
      sourceRevision,
      contracts: {
        observation: 'behold.inhabitant.v1',
        controller: 'behold.llm-policy.v1',
        task: options.task === 'come-see-do-report' ? 'behold.task.come-see-do-report.v1' : null,
        owner: 'behold.world-owner.v1',
      },
    });
    control.update('starting', { server: null, controllers: [] });

    server = dependencies.spawnServer?.() ?? spawnDefaultServer(options);
    if (!server.pid) throw new WorldRunnerError('Server process has no PID', 'server_pid_missing');
    serverExit = waitForExit(server, 'server');
    serverOutput = captureOutput(server, stdout, stderr);
    control.update('starting', { server: { pid: server.pid, jarSha256 }, controllers: [] });
    control.append('server_started', { pid: server.pid });

    await raceProcessExit(
      (signal) =>
        waitForCondition(
          'Minecraft server readiness',
          startupTimeoutMs,
          sleep,
          async () => {
            if (!serverOutput.lines().some(isMinecraftReadyLine)) return false;
            const evidence = await inspectRuntime();
            return (
              evidenceOwnedBy(evidence.runtimeSessionLock, server!.pid!) &&
              evidenceOwnedBy(evidence.serverPort, server!.pid!)
            );
          },
          signal,
        ),
      serverExit,
    );
    control.append('server_ready', { pid: server.pid });

    controller =
      dependencies.spawnController?.({ runId: managedRunId }) ??
      spawnDefaultController(options, managedRunId, control.file);
    if (!controller.pid) {
      throw new WorldRunnerError('Controller process has no PID', 'controller_pid_missing');
    }
    controllerExit = waitForExit(controller, 'controller');
    const controllerOutput = captureOutput(controller, stdout, stderr);
    control.update('starting', {
      controllers: [
        {
          entityId: options.controllerEntityId,
          pid: controller.pid,
          leasePath: options.controllerLeasePath,
        },
      ],
    });
    control.append('controller_started', {
      pid: controller.pid,
      entityId: options.controllerEntityId,
    });

    await raceProcessExit(
      (signal) =>
        waitForCondition(
          'controller readiness',
          startupTimeoutMs,
          sleep,
          async () =>
            controllerOutput.lines().some(isControllerReadyLine) &&
            leaseOwnedBy(
              options.controllerLeasePath,
              controller!.pid!,
              options.controllerEntityId,
              managedRunId,
            ),
          signal,
        ),
      controllerExit,
    );
    control.update('running');
    control.append('run_ready', { serverPid: server.pid, controllerPid: controller.pid });

    const finished = Promise.race([serverExit, controllerExit]).then((exit) => {
      if (!stopping && !(exit.name === 'controller' && controllerQuiescing)) {
        throw new WorldRunnerError(
          `${exit.name} exited while the managed world was running`,
          'managed_child_exited',
          exit,
        );
      }
    });

    let stopPromise: Promise<void> | null = null;
    let quiescePromise: Promise<void> | null = null;
    const quiesceController = (reason = 'witness_observation') => {
      if (quiescePromise) return quiescePromise;
      if (stopPromise || stopping) {
        return Promise.reject(
          new WorldRunnerError(
            'Controller cannot be quiesced after managed shutdown begins',
            'controller_quiesce_after_stop',
          ),
        );
      }
      controllerQuiescing = true;
      quiescePromise = quiesceManagedController({
        control,
        controller: controller!,
        controllerExit: controllerExit!,
        controllerLeasePath: options.controllerLeasePath,
        timeoutMs: shutdownTimeoutMs,
        sleep,
        reason,
      });
      return quiescePromise;
    };
    const stop = (reason = 'operator_request') => {
      if (stopPromise) return stopPromise;
      stopping = true;
      stopPromise = stopManagedWorld({
        control,
        server: server!,
        controller: controller!,
        serverExit: serverExit!,
        controllerExit: controllerExit!,
        serverOutput: serverOutput!,
        inspectRuntime,
        controllerLeasePath: options.controllerLeasePath,
        entityRoot,
        circleIds,
        timeoutMs: shutdownTimeoutMs,
        sleep,
        reason,
      });
      return stopPromise;
    };

    return Object.freeze({
      runId: managedRunId,
      control,
      serverPid: server.pid,
      controllerPid: controller.pid,
      finished,
      quiesceController,
      stop,
    });
  } catch (error: any) {
    const failure = error instanceof Error ? error : new Error(String(error));
    try {
      control.append('run_start_failed', { error: failure.message });
    } catch {}
    const cleaned = await cleanupFailedStart({
      control,
      server,
      controller,
      serverExit,
      controllerExit,
      serverOutput,
      inspectRuntime,
      controllerLeasePath: options.controllerLeasePath,
      entityRoot,
      circleIds,
      timeoutMs: shutdownTimeoutMs,
      sleep,
    });
    if (!cleaned) {
      try {
        control.update('recovery_required', {
          server: server?.pid ? { pid: server.pid, jarSha256 } : null,
          controllers:
            controller?.pid == null
              ? []
              : [
                  {
                    entityId: options.controllerEntityId,
                    pid: controller.pid,
                    leasePath: options.controllerLeasePath,
                  },
                ],
        });
      } catch {}
    }
    throw failure;
  }
}

/**
 * Releases only a same-host recovery-required owner whose entire recorded
 * process set is dead and whose runtime, lifecycle journal, port, session
 * lock, and controller leases still match the abandoned epoch. Immutable
 * evidence is durable before any stale ownership file is removed.
 */
export async function recoverAbandonedManagedWorld(
  options: ManagedWorldRecoveryOptions,
  dependencies: Pick<WorldRunnerDependencies, 'inspectRuntime' | 'now'> = {},
): Promise<ManagedWorldRecovery> {
  const inspectRuntime =
    dependencies.inspectRuntime ?? (() => statusWorld(options.worldId, options.world));
  const now = dependencies.now ?? (() => new Date());
  const inspection = inspectWorldControl(options.controlRoot, options.worldId);
  if (inspection.state !== 'held' || inspection.record.state !== 'recovery_required') {
    throw new WorldRunnerError(
      `World ${options.worldId} has no recovery-required owner`,
      'world_control_not_recoverable',
      inspection,
    );
  }
  const owner = inspection.record;
  const ownerFile = inspection.file;
  const ownerStats = plainFileStats(ownerFile, 'world owner');
  const ownerBytes = fs.readFileSync(ownerFile);
  const ownerSha256 = sha256Bytes(ownerBytes);
  if (owner.hostname !== os.hostname()) {
    throw new WorldRunnerError(
      `Recovery refuses owner from ${owner.hostname}; this host is ${os.hostname()}`,
      'recovery_owner_remote',
      { owner: owner.hostname, local: os.hostname() },
    );
  }
  assertRecoveryRuntimeIdentity(owner);

  const lifecycleFile = path.join(path.dirname(ownerFile), `lifecycle-${owner.epoch}.jsonl`);
  plainFileStats(lifecycleFile, 'world lifecycle journal');
  const lifecycle = verifyWorldLifecycleJournal(lifecycleFile);
  assertRecoveryLifecycle(owner, lifecycle);

  const processes = recoveryProcesses(owner);
  const alive = processes.filter((entry) => isProcessAlive(entry.pid));
  if (alive.length) {
    throw new WorldRunnerError(
      'Recovery refuses while a recorded owner process may still be alive',
      'recovery_process_alive',
      alive,
    );
  }

  const entityRoot = fs.realpathSync.native(options.entityRoot);
  const circleIds = worldCircleIds(options.worldId, options.world);
  const leases = inspectRecoveryLeases(owner, entityRoot, circleIds);
  const runtime = await inspectRuntime();
  assertStoppedEvidence(runtime, 'before_abandoned_owner_recovery');
  const saveAcknowledged = lifecycle.events.some(
    (event) => event.type === 'server_save_acknowledged',
  );
  const classification = saveAcknowledged
    ? ('abandoned_after_save_ack' as const)
    : ('abandoned_unclean_shutdown' as const);
  const evidenceStem = `recovery-${owner.epoch}-${String(lifecycle.tipDigest).slice(0, 12)}`;
  const preparedEvidence = path.join(path.dirname(ownerFile), `${evidenceStem}.prepared.json`);
  const prepared = Object.freeze({
    protocol: 'behold.world-recovery-evidence.v1',
    phase: 'prepared',
    preparedAt: now().toISOString(),
    classification,
    world: owner.world,
    epoch: owner.epoch,
    owner: { file: ownerFile, sha256: ownerSha256, record: owner },
    lifecycle: {
      file: lifecycle.file,
      tipDigest: lifecycle.tipDigest,
      eventCount: lifecycle.events.length,
      saveAcknowledged,
    },
    runtime,
    processes: processes.map((entry) => ({ ...entry, observedDead: true })),
    controllerLeases: leases.map((lease) => ({
      file: lease.file,
      present: lease.present,
      sha256: lease.sha256,
      record: lease.record,
    })),
    recoveryCode: gitProvenance(),
  });
  writeImmutableEvidence(preparedEvidence, prepared, {
    world: owner.world,
    epoch: owner.epoch,
    ownerSha256,
    lifecycleTipDigest: lifecycle.tipDigest,
  });

  assertRecoveryOwnerUnchanged(ownerFile, ownerStats, ownerSha256, owner);
  assertRecoveryLeasesUnchanged(leases);
  const finalRuntime = await inspectRuntime();
  assertStoppedEvidence(finalRuntime, 'immediately_before_abandoned_owner_release');
  for (const lease of leases) {
    if (!lease.present) continue;
    fs.unlinkSync(lease.file);
    fsyncDirectory(path.dirname(lease.file));
  }
  assertNoControllerLeasesAtRoot(entityRoot, circleIds, 'after_abandoned_lease_release');
  assertRecoveryOwnerUnchanged(ownerFile, ownerStats, ownerSha256, owner);
  fs.unlinkSync(ownerFile);
  fsyncDirectory(path.dirname(ownerFile));

  const completedEvidence = path.join(path.dirname(ownerFile), `${evidenceStem}.completed.json`);
  const preparedSha256 = sha256File(preparedEvidence);
  writeImmutableEvidence(completedEvidence, {
    protocol: 'behold.world-recovery-evidence.v1',
    phase: 'completed',
    completedAt: now().toISOString(),
    classification,
    world: owner.world,
    epoch: owner.epoch,
    preparedEvidence,
    preparedSha256,
    releasedOwnerFile: ownerFile,
    releasedControllerLeases: leases.filter((lease) => lease.present).map((lease) => lease.file),
  });
  if (inspectWorldControl(options.controlRoot, options.worldId).state !== 'clear') {
    throw new WorldRunnerError(
      'Recovered owner file did not become clear',
      'recovery_owner_release_failed',
    );
  }
  return Object.freeze({
    protocol: 'behold.world-recovery-result.v1',
    world: owner.world,
    epoch: owner.epoch,
    classification,
    preparedEvidence,
    completedEvidence,
  });
}

async function quiesceManagedController(input: {
  control: HeldWorldControl;
  controller: ChildProcessWithoutNullStreams;
  controllerExit: Promise<ProcessExit>;
  controllerLeasePath: string;
  timeoutMs: number;
  sleep: (milliseconds: number) => Promise<void>;
  reason: string;
}) {
  input.control.append('controller_quiescing', { reason: input.reason });
  if (!processExited(input.controller)) input.controller.stdin.end();
  const exit = await withTimeout(input.controllerExit, input.timeoutMs, 'controller quiescence');
  if (!cleanExit(exit)) {
    throw new WorldRunnerError(
      'Controller exited abnormally while entering witness quiescence',
      'controller_quiesce_exit_abnormal',
      exit,
    );
  }
  await waitForCondition(
    'controller lease release before witness',
    input.timeoutMs,
    input.sleep,
    async () => !fs.existsSync(input.controllerLeasePath),
  );
  input.control.update('running', { controllers: [] });
  input.control.append('controller_quiesced', { reason: input.reason, exit });
}

async function cleanupFailedStart(input: {
  control: HeldWorldControl;
  server: ChildProcessWithoutNullStreams | null;
  controller: ChildProcessWithoutNullStreams | null;
  serverExit: Promise<ProcessExit> | null;
  controllerExit: Promise<ProcessExit> | null;
  serverOutput: OutputCapture | null;
  inspectRuntime: () => Promise<RuntimeInspection>;
  controllerLeasePath: string;
  entityRoot: string;
  circleIds: readonly string[];
  timeoutMs: number;
  sleep: (milliseconds: number) => Promise<void>;
}) {
  try {
    input.control.update('stopping');
    input.control.append('failed_start_cleanup_started');
    if (input.controller && input.controllerExit) {
      if (!processExited(input.controller)) input.controller.stdin.end();
      await withTimeout(input.controllerExit, input.timeoutMs, 'failed controller cleanup');
      await waitForCondition(
        'failed controller lease cleanup',
        input.timeoutMs,
        input.sleep,
        async () => !fs.existsSync(input.controllerLeasePath),
      );
      input.control.update('stopping', { controllers: [] });
    }
    if (input.server && input.serverExit) {
      if (!processExited(input.server) && input.serverOutput?.lines().some(isMinecraftReadyLine)) {
        const marker = input.serverOutput.mark();
        input.server.stdin.write('save-all flush\n');
        await waitForCondition(
          'failed-start save acknowledgement',
          input.timeoutMs,
          input.sleep,
          async () => input.serverOutput!.linesAfter(marker).some(isMinecraftSaveAcknowledgement),
        );
      }
      if (!processExited(input.server)) {
        input.server.stdin.write('stop\n');
        input.server.stdin.end();
      }
      await withTimeout(input.serverExit, input.timeoutMs, 'failed server cleanup');
    }
    const stopped = await input.inspectRuntime();
    assertStoppedEvidence(stopped, 'after_failed_start_cleanup');
    assertNoControllerLeasesAtRoot(input.entityRoot, input.circleIds, 'after_failed_start_cleanup');
    input.control.update('stopped_verified', { server: null, controllers: [] });
    input.control.append('failed_start_cleanup_completed');
    input.control.release();
    return true;
  } catch (cleanupError: any) {
    try {
      input.control.append('failed_start_cleanup_failed', {
        error: cleanupError?.message || String(cleanupError),
      });
    } catch {}
    return false;
  }
}

async function stopManagedWorld(input: {
  control: HeldWorldControl;
  server: ChildProcessWithoutNullStreams;
  controller: ChildProcessWithoutNullStreams;
  serverExit: Promise<ProcessExit>;
  controllerExit: Promise<ProcessExit>;
  serverOutput: OutputCapture;
  inspectRuntime: () => Promise<RuntimeInspection>;
  controllerLeasePath: string;
  entityRoot: string;
  circleIds: readonly string[];
  timeoutMs: number;
  sleep: (milliseconds: number) => Promise<void>;
  reason: string;
}) {
  const { control, server, controller } = input;
  control.update('stopping');
  control.append('run_stopping', { reason: input.reason });
  try {
    const abnormalExits: ProcessExit[] = [];
    if (!processExited(controller)) controller.stdin.end();
    const controllerExit = await withTimeout(
      input.controllerExit,
      input.timeoutMs,
      'controller graceful shutdown',
    );
    if (!cleanExit(controllerExit)) abnormalExits.push(controllerExit);
    await waitForCondition(
      'controller lease release',
      input.timeoutMs,
      input.sleep,
      async () => !fs.existsSync(input.controllerLeasePath),
    );
    control.update('stopping', { controllers: [] });
    control.append('controller_stopped', controllerExit);

    if (!processExited(server)) {
      const outputMarker = input.serverOutput.mark();
      server.stdin.write('save-all flush\n');
      await waitForCondition(
        'Minecraft save acknowledgement',
        input.timeoutMs,
        input.sleep,
        async () =>
          input.serverOutput.linesAfter(outputMarker).some(isMinecraftSaveAcknowledgement),
      );
      control.append('server_save_acknowledged');
      server.stdin.write('stop\n');
      server.stdin.end();
    }
    const serverExit = await withTimeout(
      input.serverExit,
      input.timeoutMs,
      'server graceful shutdown',
    );
    if (!cleanExit(serverExit)) abnormalExits.push(serverExit);
    control.append('server_stopped', serverExit);

    const stopped = await input.inspectRuntime();
    assertStoppedEvidence(stopped, 'after_managed_shutdown');
    assertNoControllerLeasesAtRoot(input.entityRoot, input.circleIds, 'after_managed_shutdown');
    if (abnormalExits.length) {
      control.update('stopping', { server: null, controllers: [] });
      throw new WorldRunnerError(
        'One or more managed children exited abnormally',
        'managed_child_exit_abnormal',
        abnormalExits,
      );
    }
    control.update('stopped_verified', { server: null, controllers: [] });
    control.append('run_stopped', { reason: input.reason });
    control.release();
  } catch (error: any) {
    const failure = error instanceof Error ? error : new Error(String(error));
    try {
      control.append('run_stop_failed', { reason: input.reason, error: failure.message });
      control.update('recovery_required');
    } catch {}
    throw failure;
  }
}

function spawnDefaultServer(options: ManagedWorldRunOptions) {
  return spawn(
    options.java,
    ['-Xms1G', '-Xmx2G', '-jar', fs.realpathSync.native(options.serverJar), 'nogui'],
    {
      cwd: options.serverDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
}

function spawnDefaultController(
  options: ManagedWorldRunOptions,
  runId: string,
  controlFile: string,
) {
  const args = [
    options.controllerEntry,
    options.controllerEntityId,
    '--server',
    options.world.server.host,
    '--port',
    String(options.world.server.port),
    '--world',
    options.worldId,
    '--model',
    options.model,
  ];
  if (options.task) args.push('--task', options.task);
  if (options.target) args.push('--target', options.target);
  if (options.allowTools?.length) args.push('--allowTools', options.allowTools.join(','));
  return spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VIEWER_ENABLED: '0',
      BEHOLD_RUN_ID: runId,
      BEHOLD_WORLD_ID: options.worldId,
      BEHOLD_WORLD_CONTROL_FILE: controlFile,
      BEHOLD_WORLD_CONTROL_ROOT: path.dirname(path.dirname(controlFile)),
      BEHOLD_ENTITY_DIR: path.dirname(path.dirname(options.controllerLeasePath)),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

type ProcessExit = Readonly<{ name: string; code: number | null; signal: NodeJS.Signals | null }>;

function waitForExit(child: ChildProcessWithoutNullStreams, name: string): Promise<ProcessExit> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ name, code, signal }));
  });
}

function processExited(child: ChildProcessWithoutNullStreams) {
  return child.exitCode !== null || child.signalCode !== null;
}

function cleanExit(exit: ProcessExit) {
  return exit.code === 0 && exit.signal === null;
}

type OutputCapture = Readonly<{
  lines(): readonly string[];
  mark(): number;
  linesAfter(sequence: number): readonly string[];
}>;

function captureOutput(
  child: ChildProcessWithoutNullStreams,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): OutputCapture {
  let sequence = 0;
  const lines: Array<{ sequence: number; text: string }> = [];
  const remainders = new Map<'stdout' | 'stderr', string>([
    ['stdout', ''],
    ['stderr', ''],
  ]);
  const append = (
    stream: 'stdout' | 'stderr',
    chunk: Buffer | string,
    sink: (value: string) => void,
  ) => {
    const value = String(chunk);
    sink(value);
    const fragments = `${remainders.get(stream) || ''}${value}`.split(/\r?\n/);
    remainders.set(stream, fragments.pop() || '');
    for (const line of fragments) lines.push({ sequence: ++sequence, text: line });
    if (lines.length > 10_000) lines.splice(0, lines.length - 10_000);
  };
  child.stdout.on('data', (chunk) => append('stdout', chunk, stdout));
  child.stderr.on('data', (chunk) => append('stderr', chunk, stderr));
  return Object.freeze({
    lines: () => lines.map((line) => line.text),
    mark: () => sequence,
    linesAfter: (marker: number) =>
      lines.filter((line) => line.sequence > marker).map((line) => line.text),
  });
}

export function isMinecraftReadyLine(line: string) {
  return /^(?:\[[^\]\r\n]+\] )?\[Server thread\/INFO\]: Done \([^)]+\)! For help, type "help"$/.test(
    line.trim(),
  );
}

export function isControllerReadyLine(line: string) {
  return line.trim() === '[bot] Local world loaded.';
}

export function isMinecraftSaveAcknowledgement(line: string) {
  return /^(?:\[[^\]\r\n]+\] )?\[Server thread\/INFO\]: Saved the game$/.test(line.trim());
}

async function raceProcessExit<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  exit: Promise<ProcessExit>,
) {
  const cancellation = new AbortController();
  try {
    return await Promise.race([
      operation(cancellation.signal),
      exit.then((e) => {
        throw new WorldRunnerError(
          `${e.name} exited before readiness`,
          'child_exited_before_ready',
          e,
        );
      }),
    ]);
  } finally {
    cancellation.abort();
  }
}

async function waitForCondition(
  label: string,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>,
  condition: () => Promise<boolean>,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (await condition()) return;
    await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  throw new WorldRunnerError(`${label} timed out after ${timeoutMs}ms`, 'runner_timeout', {
    label,
    timeoutMs,
  });
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new WorldRunnerError(`${label} timed out`, 'runner_timeout', { label, timeoutMs }),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assertStoppedEvidence(evidence: RuntimeInspection, phase: string) {
  const blockers: string[] = [];
  if (!evidence.runtimeExists) blockers.push('runtime_world_missing');
  if (!evidence.topology.safe) blockers.push(...evidence.topology.blockers);
  if (evidence.runtimeSessionLock.state !== 'clear') {
    blockers.push(`runtime_session_lock_${evidence.runtimeSessionLock.state}`);
  }
  if (evidence.serverPort.state !== 'clear') {
    blockers.push(`server_port_${evidence.serverPort.state}`);
  }
  if (evidence.preparedBaselineSessionLock?.state === 'owned') {
    blockers.push('prepared_baseline_session_lock_owned');
  }
  if (evidence.preparedBaselineSessionLock?.state === 'unknown') {
    blockers.push('prepared_baseline_session_lock_unknown');
  }
  if (blockers.length) {
    throw new WorldRunnerError(
      `World is not stopped and clear during ${phase}: ${[...new Set(blockers)].join(', ')}`,
      'world_not_stopped',
      { phase, blockers: [...new Set(blockers)], evidence },
    );
  }
}

function worldCircleIds(worldId: string, world: WorldLabDefinition) {
  const hosts =
    world.server.host === '127.0.0.1' ||
    world.server.host === 'localhost' ||
    world.server.host === '::1'
      ? ['127.0.0.1', 'localhost', '[::1]']
      : [world.server.host];
  return Object.freeze([
    worldId,
    ...hosts.map((host) => `minecraft://${host}:${world.server.port}`),
  ]);
}

function assertNoWorldControllerLeases(options: ManagedWorldRunOptions, phase: string) {
  if (fs.existsSync(options.controllerLeasePath)) {
    throw new WorldRunnerError(
      `Configured controller lease already exists during ${phase}`,
      'configured_controller_lease_present',
      { phase, leasePath: options.controllerLeasePath },
    );
  }
  return assertNoControllerLeasesAtRoot(
    path.dirname(path.dirname(options.controllerLeasePath)),
    worldCircleIds(options.worldId, options.world),
    phase,
  );
}

function assertNoControllerLeasesAtRoot(
  entityRoot: string,
  circleIds: readonly string[],
  phase: string,
) {
  const inspection = inspectEntityLeaseFence(entityRoot, circleIds);
  if (inspection.state !== 'clear') {
    throw new WorldRunnerError(
      `World controller lease fence is ${inspection.state} during ${phase}`,
      'world_controller_lease_not_clear',
      { phase, inspection },
    );
  }
  return inspection;
}

function evidenceOwnedBy(evidence: OwnershipEvidence, pid: number) {
  return (
    evidence.state === 'owned' && evidence.owners.length === 1 && evidence.owners[0].pid === pid
  );
}

function leaseOwnedBy(file: string, pid: number, entityId: string, managedRunId: string) {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (
      record?.protocol === 'behold.entity-runtime-lease.v1' &&
      record?.entityId === entityId &&
      record?.managedRunId === managedRunId &&
      record?.hostname === os.hostname() &&
      Number(record?.pid) === pid
    );
  } catch {
    return false;
  }
}

type RecoveryLease = Readonly<{
  file: string;
  present: boolean;
  stats: Readonly<{ device: number; inode: number }> | null;
  sha256: string | null;
  record: unknown;
}>;

function assertRecoveryRuntimeIdentity(owner: WorldOwnerRecord) {
  const canonical = fs.realpathSync.native(owner.runtime.path);
  const stats = fs.statSync(canonical);
  if (
    canonical !== owner.runtime.path ||
    !stats.isDirectory() ||
    stats.dev !== owner.runtime.device ||
    stats.ino !== owner.runtime.inode
  ) {
    throw new WorldRunnerError(
      'Recovery runtime identity no longer matches the abandoned owner',
      'recovery_runtime_changed',
      { expected: owner.runtime, actual: { path: canonical, device: stats.dev, inode: stats.ino } },
    );
  }
}

function assertRecoveryLifecycle(
  owner: WorldOwnerRecord,
  lifecycle: ReturnType<typeof verifyWorldLifecycleJournal>,
) {
  const first: any = lifecycle.events[0];
  const last: any = lifecycle.events.at(-1);
  const initialOwner = first?.data?.owner;
  const expectedState = {
    state: owner.state,
    runtime: owner.runtime,
    server: owner.server,
    controllers: owner.controllers,
  };
  if (
    lifecycle.world !== owner.world ||
    lifecycle.epoch !== owner.epoch ||
    first?.type !== 'control_acquired' ||
    initialOwner?.world !== owner.world ||
    initialOwner?.epoch !== owner.epoch ||
    initialOwner?.token !== owner.token ||
    initialOwner?.hostname !== owner.hostname ||
    initialOwner?.managerPid !== owner.managerPid ||
    last?.type !== 'control_state_changed' ||
    JSON.stringify(last?.data) !== JSON.stringify(expectedState)
  ) {
    throw new WorldRunnerError(
      'Recovery lifecycle does not terminate at the exact abandoned owner state',
      'recovery_lifecycle_mismatch',
      { first, last, owner },
    );
  }
}

function recoveryProcesses(owner: WorldOwnerRecord) {
  return [
    { role: 'manager', pid: owner.managerPid },
    ...(owner.server ? [{ role: 'server', pid: owner.server.pid }] : []),
    ...owner.controllers.map((controller) => ({
      role: `controller:${controller.entityId}`,
      pid: controller.pid,
    })),
  ];
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code !== 'ESRCH';
  }
}

function inspectRecoveryLeases(
  owner: WorldOwnerRecord,
  entityRoot: string,
  circleIds: readonly string[],
): RecoveryLease[] {
  const expected = new Set<string>();
  const runId = `${owner.world}-${owner.epoch}`;
  const leases = owner.controllers.map((controller) => {
    const requestedFile = path.resolve(controller.leasePath);
    const file = fs.existsSync(requestedFile)
      ? fs.realpathSync.native(requestedFile)
      : path.join(
          fs.realpathSync.native(path.dirname(requestedFile)),
          path.basename(requestedFile),
        );
    const required = path.join(entityRoot, controller.entityId, 'runtime.lock');
    if (file !== required || expected.has(file)) {
      throw new WorldRunnerError(
        'Recovery controller lease path is outside its exact entity slot or duplicated',
        'recovery_lease_path_invalid',
        { file, required },
      );
    }
    expected.add(file);
    if (!fs.existsSync(file)) {
      return Object.freeze({ file, present: false, stats: null, sha256: null, record: null });
    }
    const stats = plainFileStats(file, 'controller lease');
    const bytes = fs.readFileSync(file);
    const record = JSON.parse(bytes.toString('utf8'));
    if (
      record?.protocol !== 'behold.entity-runtime-lease.v1' ||
      record?.entityId !== controller.entityId ||
      record?.pid !== controller.pid ||
      record?.hostname !== owner.hostname ||
      record?.managedRunId !== runId
    ) {
      throw new WorldRunnerError(
        'Recovery controller lease does not belong to the abandoned owner epoch',
        'recovery_lease_mismatch',
        { file, record, controller, runId },
      );
    }
    return Object.freeze({
      file,
      present: true,
      stats: Object.freeze({ device: stats.dev, inode: stats.ino }),
      sha256: sha256Bytes(bytes),
      record,
    });
  });
  const fence = inspectEntityLeaseFence(entityRoot, circleIds);
  const observed = new Set(fence.owned.map((lease) => path.resolve(lease.leasePath)));
  const present = new Set(leases.filter((lease) => lease.present).map((lease) => lease.file));
  if (
    fence.state === 'unknown' ||
    observed.size !== present.size ||
    [...observed].some((file) => !present.has(file))
  ) {
    throw new WorldRunnerError(
      'Recovery found controller ownership beyond the exact abandoned epoch',
      'recovery_lease_fence_mismatch',
      { fence, expected: [...present] },
    );
  }
  return leases;
}

function assertRecoveryOwnerUnchanged(
  file: string,
  expectedStats: fs.Stats,
  expectedSha256: string,
  owner: WorldOwnerRecord,
) {
  const stats = plainFileStats(file, 'world owner');
  const bytes = fs.readFileSync(file);
  const observed = JSON.parse(bytes.toString('utf8'));
  if (
    stats.dev !== expectedStats.dev ||
    stats.ino !== expectedStats.ino ||
    sha256Bytes(bytes) !== expectedSha256 ||
    observed?.token !== owner.token ||
    observed?.epoch !== owner.epoch
  ) {
    throw new WorldRunnerError('Recovery owner changed after inspection', 'recovery_owner_changed');
  }
}

function assertRecoveryLeasesUnchanged(leases: readonly RecoveryLease[]) {
  for (const lease of leases) {
    if (!lease.present) {
      if (fs.existsSync(lease.file)) {
        throw new WorldRunnerError(
          'A controller lease appeared during recovery',
          'recovery_lease_changed',
          { file: lease.file },
        );
      }
      continue;
    }
    const stats = plainFileStats(lease.file, 'controller lease');
    const bytes = fs.readFileSync(lease.file);
    if (
      stats.dev !== lease.stats?.device ||
      stats.ino !== lease.stats?.inode ||
      sha256Bytes(bytes) !== lease.sha256
    ) {
      throw new WorldRunnerError(
        'A controller lease changed during recovery',
        'recovery_lease_changed',
        { file: lease.file },
      );
    }
  }
}

function plainFileStats(file: string, label: string) {
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new WorldRunnerError(
      `Recovery ${label} is not a plain file: ${file}`,
      'recovery_file_invalid',
    );
  }
  return stats;
}

function writeImmutableEvidence(
  file: string,
  value: unknown,
  expected?: Readonly<{
    world: string;
    epoch: number;
    ownerSha256: string;
    lifecycleTipDigest: string | null;
  }>,
) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  try {
    const descriptor = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fsyncDirectory(path.dirname(file));
    return;
  } catch (error: any) {
    if (error?.code !== 'EEXIST' || !expected) throw error;
  }
  const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    existing?.protocol !== 'behold.world-recovery-evidence.v1' ||
    existing?.phase !== 'prepared' ||
    existing?.world !== expected.world ||
    existing?.epoch !== expected.epoch ||
    existing?.owner?.sha256 !== expected.ownerSha256 ||
    existing?.lifecycle?.tipDigest !== expected.lifecycleTipDigest
  ) {
    throw new WorldRunnerError(
      'Existing recovery evidence does not match this abandoned epoch',
      'recovery_evidence_conflict',
      { file },
    );
  }
}

function sha256Bytes(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function sha256File(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function gitProvenance() {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const changes = status.status === 0 ? String(status.stdout) : '';
  return {
    revision: revision.status === 0 ? String(revision.stdout).trim() : null,
    dirty: status.status !== 0 || changes.length > 0,
    statusSha256: createHash('sha256').update(changes).digest('hex'),
  };
}

function bundledJava() {
  const candidate = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'minecraft',
    'runtime',
    'java-runtime-delta',
    'mac-os-arm64',
    'java-runtime-delta',
    'jre.bundle',
    'Contents',
    'Home',
    'bin',
    'java',
  );
  return process.env.SERVER_JAVA || (fs.existsSync(candidate) ? candidate : 'java');
}

export async function runCli(argv = process.argv.slice(2)) {
  const command = argv[0];
  const parsed = parseArgs({
    args: argv.slice(1),
    options: {
      config: { type: 'string' },
      world: { type: 'string' },
      model: { type: 'string' },
      controller: { type: 'string' },
      task: { type: 'string' },
      target: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help || !command) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const configPath = path.resolve(String(parsed.values.config || '.behold-worlds.example.json'));
  const worldId = String(parsed.values.world || 'sf-csdr');
  const config = loadWorldLabConfig(configPath);
  const world = config.worlds[worldId];
  if (!world) throw new WorldRunnerError(`Unknown world: ${worldId}`, 'unknown_world');
  const controlRoot = path.resolve('.behold-runtime/world-control');
  if (command === 'status') {
    const result = {
      control: inspectWorldControl(controlRoot, worldId),
      runtime: await statusWorld(worldId, world),
      controllerLeases: inspectEntityLeaseFence(
        path.resolve('.behold-entities'),
        worldCircleIds(worldId, world),
      ),
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.control.state === 'clear' &&
      result.runtime.safe &&
      result.controllerLeases.state === 'clear'
      ? 0
      : 1;
  }
  if (command === 'recover') {
    const result = await recoverAbandonedManagedWorld({
      worldId,
      world,
      controlRoot,
      entityRoot: path.resolve('.behold-entities'),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (command !== 'start')
    throw new WorldRunnerError(`Unknown command: ${command}`, 'unknown_command');

  if (!process.env.OPENROUTER_API_KEY) {
    throw new WorldRunnerError(
      'OPENROUTER_API_KEY is required for a managed LLM run',
      'controller_credentials_missing',
    );
  }
  const sourceRevision = gitProvenance();
  if (sourceRevision.dirty) {
    throw new WorldRunnerError(
      'Managed runs require a clean Git worktree so their code is reproducible',
      'source_worktree_dirty',
      sourceRevision,
    );
  }

  const toolLock = JSON.parse(
    fs.readFileSync(path.resolve('docs/sf-world/tool-lock.json'), 'utf8'),
  );
  const serverDirectory = path.dirname(world.runtime.worldPath);
  const serverJar = path.resolve(String(toolLock.tools.minecraftServer.path));
  const controllerEntityId = String(parsed.values.controller || 'ScoutLife');
  const controllerProfile = managedControllerProfile(parsed.values.task, parsed.values.target);
  const run = await startManagedWorld({
    worldId,
    world,
    controlRoot,
    serverDirectory,
    serverJar,
    expectedServerJarSha256: String(toolLock.tools.minecraftServer.sha256),
    java: bundledJava(),
    controllerEntry: path.resolve('dist/src/cli/behold.js'),
    controllerEntityId,
    controllerLeasePath: path.resolve('.behold-entities', controllerEntityId, 'runtime.lock'),
    model: String(parsed.values.model || process.env.LLM_MODEL || DEFAULT_LLM_MODEL),
    ...controllerProfile,
  });
  process.stdout.write(
    `[world-runner] ready: ${worldId}, server ${run.serverPid}, controller ${run.controllerPid}\n`,
  );
  let requestStop!: (reason: string) => void;
  const stopRequested = new Promise<string>((resolve) => {
    requestStop = resolve;
  });
  process.once('SIGINT', () => requestStop('SIGINT'));
  process.once('SIGTERM', () => requestStop('SIGTERM'));
  try {
    const outcome = await Promise.race([
      run.finished.then(() => ({ kind: 'children' as const })),
      stopRequested.then((reason) => ({ kind: 'stop' as const, reason })),
    ]);
    if (outcome.kind === 'stop') {
      await run.stop(outcome.reason);
      await run.finished;
    }
  } catch (error) {
    await run.stop('managed_child_exit').catch(() => {});
    throw error;
  }
  return 0;
}

function usage() {
  return [
    'Usage:',
    '  world-runner status --config <file> --world <id>',
    '  world-runner recover --config <file> --world <id>',
    '  world-runner start --config <file> --world <id> [--model <slug>] [--task <name>] [--target <player>]',
    '',
    'Without --task, the foreground runner starts an untasked resident with the full safe inhabitant action surface.',
    'Come-See-Do-Report remains available explicitly with --task come-see-do-report.',
    'Recovery releases only an exact same-host abandoned epoch after durable evidence and stopped-world verification.',
    'The foreground runner refuses foreign-owned ports, session locks, and owner records.',
  ].join('\n');
}

function optionalText(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

if (require.main === module) {
  void runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: any) => {
      process.stderr.write(`[world-runner] ${error?.message || String(error)}\n`);
      process.exitCode = 1;
    });
}
