import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  digestTree,
  TREE_DIGEST_PROFILE,
  worldLabDefinitionDigest,
  type WorldLabDefinition,
} from '../../scripts/world-lab';
import type { FrozenPlaceServeAuthority } from './place-serve';
import { verifyPlaceServeTranscript } from './place-serve';
import { verifyWorldLifecycleJournal } from './world-control';

export const PLACE_SERVED_WORLD_PROTOCOL = 'behold.place-served-world.v1' as const;
export const PLACE_SERVED_WORLD_HEAD_PROTOCOL = 'behold.place-served-world-head.v1' as const;

type PlaceServedWorldTerminalKind =
  | 'completed_run'
  | 'failed_start_cleanup'
  | 'recovered_after_save'
  | 'recovered_after_place_save'
  | 'recovered_abandoned_run'
  | 'place_only_cleanup';

export type PlaceServedWorldDescriptor = Readonly<{
  protocol: typeof PLACE_SERVED_WORLD_PROTOCOL;
  worldId: string;
  origin: Readonly<{
    controlProtocol: 'place-compiler-serve-control/v1';
    placeCompilerRevision: string;
    placeId: string;
    sourceRunId: string;
    profileId: string;
    minecraftVersion: string;
    sourceReleaseManifestSha256: string;
    sourceWorldTreeSha256: string;
    minecraftServerSha256: string;
    runtimeManifestSha256: string;
  }>;
  display: Readonly<{ placeName: string }>;
  adoptionBasis: Readonly<{
    relation: 'first-behold-observed-frozen-saved-state';
    digestProfile: typeof TREE_DIGEST_PROFILE;
    runtimeDigest: string;
    sourceTree: ReturnType<typeof digestTree>;
    baselineTree: ReturnType<typeof digestTree>;
  }>;
  controlEvidence: Readonly<{
    transcriptFile: string;
    readyRecordSha256: string;
    freezeTerminalSha256: string;
    saveTerminalSha256: string;
  }>;
  behold: Readonly<{
    adoptionIdentitySha256: string;
    worldDefinitionSha256: string;
  }>;
  paths: Readonly<{
    release: string;
    runtimeRoot: string;
    runtimeWorld: string;
    source: string;
    preparedBaseline: string;
    archiveRoot: string;
    worldDefinition: string;
    descriptor: string;
  }>;
}>;

export type EstablishedPlaceServedWorld = Readonly<{
  descriptor: PlaceServedWorldDescriptor;
  world: WorldLabDefinition;
}>;

export function establishPlaceServedWorldBasis(
  input: {
    sessionRoot: string;
    authority: FrozenPlaceServeAuthority;
    saveEvidence: unknown;
  },
  dependencies: Readonly<{
    assertAuthorityOwnership?: (
      authority: FrozenPlaceServeAuthority,
      runtimeWorld: string,
      phase: string,
    ) => void;
  }> = {},
): EstablishedPlaceServedWorld {
  const sessionRoot = plainDirectory(input.sessionRoot, 'live session root');
  const authority = input.authority;
  const identity = authority.placeIdentity;
  const runtimeWorld = plainDirectory(authority.runtimeWorldPath, 'Place runtime world');
  const genesis = path.join(sessionRoot, 'genesis');
  if (fs.existsSync(genesis)) {
    throw new Error(`Place served-world genesis already exists: ${genesis}`);
  }
  assertPlaceControlTerminal(authority.initialTickEvidence, identity, 'freeze', 'frozen');
  assertPlaceControlTerminal(input.saveEvidence, identity, 'save', 'frozen');
  const assertOwnership = dependencies.assertAuthorityOwnership ?? assertJavaOwnsPlaceRuntime;
  assertOwnership(authority, runtimeWorld, 'before_adoption_copy');

  const before = digestTree(runtimeWorld);
  const stage = fs.mkdtempSync(path.join(sessionRoot, '.genesis.stage-'));
  const stageSource = path.join(stage, 'source');
  const stageBaseline = path.join(stage, 'prepared');
  const archiveRoot = path.join(sessionRoot, 'archive');
  try {
    copyWorld(runtimeWorld, stageSource);
    copyWorld(runtimeWorld, stageBaseline);
    fs.mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
    const sourceTree = digestTree(stageSource);
    const baselineTree = digestTree(stageBaseline);
    const after = digestTree(runtimeWorld);
    if (
      before.digest !== after.digest ||
      sourceTree.digest !== before.digest ||
      baselineTree.digest !== before.digest
    ) {
      throw new Error('Place runtime changed while Behold captured its adoption basis');
    }
    assertOwnership(authority, runtimeWorld, 'after_adoption_copy');

    const transcript = verifyPlaceServeTranscript(authority.transcriptFile);
    const readyRecord = transcriptRecord(transcript.events, (message) => message.event === 'ready');
    const freezeRecord = transcriptRecord(
      transcript.events,
      (message) =>
        message.event === 'command_terminal' &&
        message.command === 'freeze' &&
        stableJson(message) === stableJson(authority.initialTickEvidence),
    );
    const saveRecord = transcriptRecord(
      transcript.events,
      (message) =>
        message.event === 'command_terminal' &&
        message.command === 'save' &&
        stableJson(message) === stableJson(input.saveEvidence),
    );
    if (stableJson(readyRecord.message.identity) !== stableJson(identity)) {
      throw new Error('Place ready transcript differs from the adopted identity');
    }

    const origin = Object.freeze({
      controlProtocol: 'place-compiler-serve-control/v1' as const,
      placeCompilerRevision: authority.placeCompilerRevision,
      placeId: identity.placeId,
      sourceRunId: identity.sourceRunId,
      profileId: identity.profileId,
      minecraftVersion: identity.minecraftVersion,
      sourceReleaseManifestSha256: identity.sourceReleaseManifestSha256,
      sourceWorldTreeSha256: identity.sourceWorldTreeSha256,
      minecraftServerSha256: identity.minecraftServerSha256,
      runtimeManifestSha256: identity.runtimeManifestSha256,
    });
    const adoptionIdentitySha256 = sha256(
      stableJson({
        protocol: PLACE_SERVED_WORLD_PROTOCOL,
        origin,
        adoptionBasis: {
          relation: 'first-behold-observed-frozen-saved-state',
          digestProfile: TREE_DIGEST_PROFILE,
          runtimeDigest: before.digest,
        },
      }),
    );
    const worldId = `${safeSegment(identity.placeId)}-${adoptionIdentitySha256}`;
    const finalPaths = Object.freeze({
      release: identity.releasePath,
      runtimeRoot: identity.runtimePath,
      runtimeWorld,
      source: path.join(genesis, 'source'),
      preparedBaseline: path.join(genesis, 'prepared'),
      archiveRoot,
      worldDefinition: path.join(genesis, 'world-definition.json'),
      descriptor: path.join(genesis, 'place-served-world.json'),
    });
    const world: WorldLabDefinition = {
      label: `${identity.placeName} · ${identity.profileId} · Place served world`,
      source: Object.freeze({
        path: finalPaths.source,
        digestProfile: TREE_DIGEST_PROFILE,
        expectedDigest: sourceTree.digest,
      }),
      preparedBaseline: Object.freeze({
        path: finalPaths.preparedBaseline,
        digestProfile: TREE_DIGEST_PROFILE,
        expectedDigest: baselineTree.digest,
      }),
      runtime: Object.freeze({ worldPath: finalPaths.runtimeWorld, archiveRoot }),
      server: Object.freeze({ host: identity.endpoint.host, port: identity.endpoint.port }),
      notes: [
        `Place genesis ${identity.sourceRunId}; manifest ${identity.sourceReleaseManifestSha256}.`,
        `Place source world ${identity.sourceWorldTreeSha256}; Behold adoption basis ${before.digest}.`,
        `Place serve ${authority.placeCompilerRevision}; runtime manifest ${identity.runtimeManifestSha256}.`,
      ],
    };
    const worldDefinitionSha256 = worldLabDefinitionDigest(world);
    const descriptor: PlaceServedWorldDescriptor = deepFreeze({
      protocol: PLACE_SERVED_WORLD_PROTOCOL,
      worldId,
      origin,
      display: { placeName: identity.placeName },
      adoptionBasis: {
        relation: 'first-behold-observed-frozen-saved-state',
        digestProfile: TREE_DIGEST_PROFILE,
        runtimeDigest: before.digest,
        sourceTree,
        baselineTree,
      },
      controlEvidence: {
        transcriptFile: authority.transcriptFile,
        readyRecordSha256: readyRecord.lineSha256,
        freezeTerminalSha256: freezeRecord.lineSha256,
        saveTerminalSha256: saveRecord.lineSha256,
      },
      behold: { adoptionIdentitySha256, worldDefinitionSha256 },
      paths: finalPaths,
    });
    writeJson(path.join(stage, 'world-definition.json'), {
      schemaVersion: 2,
      worlds: { [worldId]: world },
    });
    writeJson(path.join(stage, 'place-served-world.json'), descriptor);
    makeReadOnlyTree(stageSource);
    fs.renameSync(stage, genesis);
    return Object.freeze({ descriptor, world });
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    if (fs.existsSync(archiveRoot) && fs.readdirSync(archiveRoot).length === 0) {
      fs.rmdirSync(archiveRoot);
    }
    throw error;
  }
}

export function verifyPlaceServedWorldBasis(
  descriptorFileValue: string,
): EstablishedPlaceServedWorld {
  const descriptorFile = plainFile(descriptorFileValue, 'Place served-world descriptor');
  const descriptor = readJson(descriptorFile) as PlaceServedWorldDescriptor;
  if (
    descriptor.protocol !== PLACE_SERVED_WORLD_PROTOCOL ||
    descriptor.paths.descriptor !== descriptorFile ||
    descriptor.paths.runtimeWorld !== fs.realpathSync.native(descriptor.paths.runtimeWorld) ||
    descriptor.origin.controlProtocol !== 'place-compiler-serve-control/v1' ||
    descriptor.adoptionBasis.relation !== 'first-behold-observed-frozen-saved-state' ||
    descriptor.adoptionBasis.digestProfile !== TREE_DIGEST_PROFILE
  ) {
    throw new Error('Place served-world descriptor is malformed');
  }
  if (!isPlaceCompilerIdentity(descriptor.origin.placeCompilerRevision)) {
    throw new Error('Place Compiler identity is invalid');
  }
  for (const [label, value] of [
    ['release manifest', descriptor.origin.sourceReleaseManifestSha256],
    ['source world', descriptor.origin.sourceWorldTreeSha256],
    ['server', descriptor.origin.minecraftServerSha256],
    ['runtime manifest', descriptor.origin.runtimeManifestSha256],
    ['adoption basis', descriptor.adoptionBasis.runtimeDigest],
    ['source tree', descriptor.adoptionBasis.sourceTree.digest],
    ['baseline tree', descriptor.adoptionBasis.baselineTree.digest],
    ['adoption identity', descriptor.behold.adoptionIdentitySha256],
    ['world definition', descriptor.behold.worldDefinitionSha256],
  ] as const) {
    if (!/^[a-f0-9]{40}$/.test(value) && !/^[a-f0-9]{64}$/.test(value)) {
      throw new Error(`${label} digest is invalid`);
    }
  }
  const expectedIdentity = sha256(
    stableJson({
      protocol: PLACE_SERVED_WORLD_PROTOCOL,
      origin: descriptor.origin,
      adoptionBasis: {
        relation: descriptor.adoptionBasis.relation,
        digestProfile: descriptor.adoptionBasis.digestProfile,
        runtimeDigest: descriptor.adoptionBasis.runtimeDigest,
      },
    }),
  );
  if (
    expectedIdentity !== descriptor.behold.adoptionIdentitySha256 ||
    descriptor.worldId !== `${safeSegment(descriptor.origin.placeId)}-${expectedIdentity}` ||
    digestTree(descriptor.paths.source).digest !== descriptor.adoptionBasis.sourceTree.digest ||
    digestTree(descriptor.paths.preparedBaseline).digest !==
      descriptor.adoptionBasis.baselineTree.digest ||
    descriptor.adoptionBasis.sourceTree.digest !== descriptor.adoptionBasis.runtimeDigest ||
    descriptor.adoptionBasis.baselineTree.digest !== descriptor.adoptionBasis.runtimeDigest ||
    sha256File(path.join(descriptor.paths.release, 'release-manifest.json')) !==
      descriptor.origin.sourceReleaseManifestSha256 ||
    sha256File(path.join(descriptor.paths.runtimeRoot, 'runtime-manifest.json')) !==
      descriptor.origin.runtimeManifestSha256
  ) {
    throw new Error('Place served-world content identity no longer matches its descriptor');
  }
  const worldFile = readJson(descriptor.paths.worldDefinition);
  const world = worldFile?.schemaVersion === 2 ? worldFile.worlds?.[descriptor.worldId] : null;
  if (!world || worldLabDefinitionDigest(world) !== descriptor.behold.worldDefinitionSha256) {
    throw new Error('Place served-world definition is missing or changed');
  }
  return Object.freeze({ descriptor: deepFreeze(descriptor), world: deepFreeze(world) });
}

export function assertPlaceServedAuthority(
  descriptor: PlaceServedWorldDescriptor,
  authority: FrozenPlaceServeAuthority,
) {
  const identity = authority.placeIdentity;
  const actualOrigin = {
    controlProtocol: 'place-compiler-serve-control/v1',
    placeCompilerRevision: authority.placeCompilerRevision,
    placeId: identity.placeId,
    sourceRunId: identity.sourceRunId,
    profileId: identity.profileId,
    minecraftVersion: identity.minecraftVersion,
    sourceReleaseManifestSha256: identity.sourceReleaseManifestSha256,
    sourceWorldTreeSha256: identity.sourceWorldTreeSha256,
    minecraftServerSha256: identity.minecraftServerSha256,
    runtimeManifestSha256: identity.runtimeManifestSha256,
  };
  if (
    stableJson(actualOrigin) !== stableJson(descriptor.origin) ||
    identity.placeName !== descriptor.display.placeName ||
    identity.releasePath !== descriptor.paths.release ||
    identity.runtimePath !== descriptor.paths.runtimeRoot ||
    authority.runtimeWorldPath !== descriptor.paths.runtimeWorld
  ) {
    throw new Error('Place served authority differs from the persistent Behold world');
  }
  const worldFile = readJson(descriptor.paths.worldDefinition);
  const world = worldFile?.worlds?.[descriptor.worldId];
  if (
    world?.server?.host !== identity.endpoint.host ||
    world?.server?.port !== identity.endpoint.port
  ) {
    throw new Error('Place served endpoint differs from the persistent Behold world');
  }
  return authority;
}

export function assertPlaceServedResumeContinuity(descriptorFile: string, headFileValue: string) {
  const established = verifyPlaceServedWorldBasis(descriptorFile);
  const { descriptor } = established;
  const headFile = path.resolve(headFileValue);
  let expectedDigest = descriptor.adoptionBasis.runtimeDigest;
  let head: any = null;
  if (fs.existsSync(headFile)) {
    head = readJson(headFile);
    const { digest, ...base } = head;
    if (
      head.protocol !== PLACE_SERVED_WORLD_HEAD_PROTOCOL ||
      head.worldId !== descriptor.worldId ||
      digest !== sha256(stableJson(base))
    ) {
      throw new Error('Place served-world head is malformed or unauthenticated');
    }
    const lifecycle = verifyWorldLifecycleJournal(head.lifecycle.file);
    const terminal = lifecycle.events.find(
      (event) => event.sequence === head.lifecycle.terminalSequence,
    );
    const terminalKind = placeServedWorldTerminalKind(terminal?.type);
    const recoveredLifecycle = head.terminalKind === 'recovered_after_save';
    const recoveredPlace = head.terminalKind === 'recovered_after_place_save';
    const recoveredAbandoned = head.terminalKind === 'recovered_abandoned_run';
    const placeOnlyCleanup = head.terminalKind === 'place_only_cleanup';
    const recovered =
      recoveredLifecycle || recoveredPlace || recoveredAbandoned || placeOnlyCleanup;
    const completed = recoveredLifecycle
      ? verifyRecoveredHeadEvidence(head, lifecycle, descriptor)
      : recoveredPlace
        ? verifyRecoveredPlaceSavedHeadEvidence(head, lifecycle, descriptor)
        : recoveredAbandoned
          ? verifyRecoveredAbandonedHeadEvidence(head, lifecycle, descriptor)
          : terminal
            ? placeServedWorldTerminalCompletion(
                lifecycle.events,
                terminal.sequence,
                terminalKind,
                descriptor,
              )
            : null;
    const placeOnlyEvidence = placeOnlyCleanup
      ? verifyPlaceOnlyCleanupHeadEvidence(head, lifecycle, descriptor)
      : null;
    if (
      lifecycle.world !== descriptor.worldId ||
      lifecycle.tipDigest !== head.lifecycle.tipDigest ||
      (!recovered && lifecycle.events.at(-1)?.type !== 'control_released') ||
      (!recovered && terminalKind == null) ||
      (!recovered && head.terminalKind != null && head.terminalKind !== terminalKind) ||
      (!recoveredAbandoned && terminal?.digest !== head.lifecycle.terminalDigest) ||
      (!recoveredPlace &&
        !recoveredAbandoned &&
        !placeOnlyCleanup &&
        (terminal.data as any)?.protocol !== 'behold.managed-terminal-world-state.v1') ||
      (!recoveredPlace &&
        !recoveredAbandoned &&
        !placeOnlyCleanup &&
        (terminal.data as any)?.tree?.digest !== head.runtimeDigest) ||
      (!placeOnlyCleanup && !completed) ||
      (placeOnlyCleanup && !placeOnlyEvidence)
    ) {
      throw new Error('Place served-world head does not name a clean terminal lifecycle');
    }
    expectedDigest = head.runtimeDigest;
  }
  const actual = digestTree(descriptor.paths.runtimeWorld);
  if (actual.digest !== expectedDigest) {
    throw new Error(
      `Stopped Place runtime differs from the last clean Behold history state (expected ${expectedDigest}, observed ${actual.digest})`,
    );
  }
  return Object.freeze({ ...established, head: head ? deepFreeze(head) : null, runtime: actual });
}

/**
 * Advances a clean head after Place itself was started and saved, but Behold
 * rejected the resident configuration before acquiring a world lifecycle.
 */
export function recordPlaceOnlyCleanupHead(input: {
  descriptorFile: string;
  previousHeadFile: string;
  placeTranscriptFile: string;
  headFile: string;
  now?: () => Date;
}) {
  const { descriptor } = verifyPlaceServedWorldBasis(input.descriptorFile);
  const previousHeadFile = plainFile(input.previousHeadFile, 'previous served-world head');
  const previous = readJson(previousHeadFile);
  const { digest, ...previousBase } = previous;
  if (
    previous.protocol !== PLACE_SERVED_WORLD_HEAD_PROTOCOL ||
    previous.worldId !== descriptor.worldId ||
    digest !== sha256(stableJson(previousBase))
  ) {
    throw new Error('Place-only cleanup requires an authenticated prior head');
  }
  const lifecycle = verifyWorldLifecycleJournal(previous.lifecycle.file);
  const terminal = lifecycle.events.find(
    (event) => event.sequence === previous.lifecycle.terminalSequence,
  );
  const terminalKind = placeServedWorldTerminalKind(terminal?.type);
  const previousPlaceOnly = previous.terminalKind === 'place_only_cleanup';
  const priorEvidenceValid = previousPlaceOnly
    ? verifyPlaceOnlyCleanupHeadEvidence(previous, lifecycle, descriptor)
    : previous.terminalKind === terminalKind &&
      (terminal.data as any)?.tree?.digest === previous.runtimeDigest &&
      placeServedWorldTerminalCompletion(
        lifecycle.events,
        terminal.sequence,
        terminalKind,
        descriptor,
      );
  if (
    lifecycle.world !== descriptor.worldId ||
    lifecycle.tipDigest !== previous.lifecycle.tipDigest ||
    lifecycle.events.at(-1)?.type !== 'control_released' ||
    terminalKind == null ||
    terminal?.digest !== previous.lifecycle.terminalDigest ||
    !priorEvidenceValid
  ) {
    throw new Error('Place-only cleanup prior head does not name a clean terminal lifecycle');
  }
  const place = verifyStoppedPlaceTranscript(input.placeTranscriptFile, descriptor);
  const runtime = digestTree(descriptor.paths.runtimeWorld);
  const base = {
    protocol: PLACE_SERVED_WORLD_HEAD_PROTOCOL,
    worldId: descriptor.worldId,
    updatedAt: (input.now?.() ?? new Date()).toISOString(),
    runtimeDigest: runtime.digest,
    terminalKind: 'place_only_cleanup' as const,
    previousRuntimeDigest: previousPlaceOnly
      ? previous.previousRuntimeDigest
      : previous.runtimeDigest,
    previousTerminalKind: terminalKind,
    lifecycle: previous.lifecycle,
    place,
  };
  const head = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  if (!verifyPlaceOnlyCleanupHeadEvidence(head, lifecycle, descriptor)) {
    throw new Error('Place-only cleanup head failed its own verification');
  }
  atomicWriteJson(input.headFile, head);
  return head;
}

export function recordPlaceServedWorldHead(input: {
  descriptorFile: string;
  lifecycleFile: string;
  headFile: string;
  now?: () => Date;
}) {
  const { descriptor } = verifyPlaceServedWorldBasis(input.descriptorFile);
  const lifecycle = verifyWorldLifecycleJournal(input.lifecycleFile);
  const terminal = [...lifecycle.events]
    .reverse()
    .find(
      (event) =>
        event.type === 'run_terminal_world_state' ||
        event.type === 'failed_start_terminal_world_state',
    );
  const terminalKind = placeServedWorldTerminalKind(terminal?.type);
  const completed = terminal
    ? placeServedWorldTerminalCompletion(
        lifecycle.events,
        terminal.sequence,
        terminalKind,
        descriptor,
      )
    : null;
  if (
    lifecycle.world !== descriptor.worldId ||
    lifecycle.events.at(-1)?.type !== 'control_released' ||
    !terminal ||
    terminalKind == null ||
    !completed ||
    (terminal.data as any)?.protocol !== 'behold.managed-terminal-world-state.v1'
  ) {
    throw new Error('Only a clean stopped Behold lifecycle can advance the served-world head');
  }
  const runtime = digestTree(descriptor.paths.runtimeWorld);
  if (runtime.digest !== (terminal.data as any).tree?.digest) {
    throw new Error('Stopped Place runtime differs from its terminal lifecycle evidence');
  }
  const base = {
    protocol: PLACE_SERVED_WORLD_HEAD_PROTOCOL,
    worldId: descriptor.worldId,
    updatedAt: (input.now?.() ?? new Date()).toISOString(),
    runtimeDigest: runtime.digest,
    terminalKind,
    lifecycle: {
      file: lifecycle.file,
      terminalSequence: terminal.sequence,
      terminalDigest: terminal.digest,
      tipDigest: lifecycle.tipDigest,
    },
  };
  const head = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  atomicWriteJson(input.headFile, head);
  return head;
}

export function reconcileRecoveredPlaceServedWorldHead(input: {
  descriptorFile: string;
  recoveryEvidenceFile: string;
  headFile: string;
  now?: () => Date;
}) {
  const { descriptor } = verifyPlaceServedWorldBasis(input.descriptorFile);
  const completedFile = plainFile(input.recoveryEvidenceFile, 'completed world recovery evidence');
  const completed = readJson(completedFile);
  const preparedFile = plainFile(completed.preparedEvidence, 'prepared world recovery evidence');
  const prepared = readJson(preparedFile);
  if (
    completed.protocol !== 'behold.world-recovery-evidence.v1' ||
    completed.phase !== 'completed' ||
    completed.classification !== 'abandoned_after_save_ack' ||
    completed.world !== descriptor.worldId ||
    completed.preparedSha256 !== sha256File(preparedFile) ||
    prepared.protocol !== 'behold.world-recovery-evidence.v1' ||
    prepared.phase !== 'prepared' ||
    prepared.classification !== 'abandoned_after_save_ack' ||
    prepared.world !== descriptor.worldId ||
    prepared.lifecycle?.saveAcknowledged !== true ||
    completed.epoch !== prepared.epoch ||
    completed.releasedOwnerFile !== prepared.owner?.file ||
    fs.existsSync(completed.releasedOwnerFile)
  ) {
    throw new Error('World recovery evidence cannot advance the served-world head');
  }
  const lifecycle = verifyWorldLifecycleJournal(prepared.lifecycle.file);
  const terminal = [...lifecycle.events]
    .reverse()
    .find((event) => event.type === 'run_terminal_world_state');
  const save = lifecycle.events.find(
    (event) => event.type === 'server_save_acknowledged' && event.sequence < terminal?.sequence,
  );
  const failed = lifecycle.events.find(
    (event) => event.type === 'run_stop_failed' && event.sequence > terminal?.sequence,
  );
  if (
    lifecycle.world !== descriptor.worldId ||
    lifecycle.tipDigest !== prepared.lifecycle.tipDigest ||
    lifecycle.events.length !== prepared.lifecycle.eventCount ||
    lifecycle.events.at(-1)?.type !== 'control_state_changed' ||
    (lifecycle.events.at(-1)?.data as any)?.state !== 'recovery_required' ||
    !terminal ||
    !save ||
    !failed ||
    (terminal.data as any)?.protocol !== 'behold.managed-terminal-world-state.v1'
  ) {
    throw new Error('Recovered lifecycle does not prove a saved stopped world');
  }
  const runtime = digestTree(descriptor.paths.runtimeWorld);
  if (
    runtime.digest !== (terminal.data as any)?.tree?.digest ||
    prepared.runtime?.runtimePath !== descriptor.paths.runtimeWorld ||
    prepared.runtime?.runtimeSessionLock?.state !== 'clear' ||
    prepared.runtime?.serverPort?.state !== 'clear'
  ) {
    throw new Error('Recovered Place runtime differs from its stopped recovery evidence');
  }
  const base = {
    protocol: PLACE_SERVED_WORLD_HEAD_PROTOCOL,
    worldId: descriptor.worldId,
    updatedAt: (input.now?.() ?? new Date()).toISOString(),
    runtimeDigest: runtime.digest,
    terminalKind: 'recovered_after_save' as const,
    lifecycle: {
      file: lifecycle.file,
      terminalSequence: terminal.sequence,
      terminalDigest: terminal.digest,
      tipDigest: lifecycle.tipDigest,
    },
    recovery: {
      completedEvidenceFile: completedFile,
      completedEvidenceSha256: sha256File(completedFile),
      preparedEvidenceFile: preparedFile,
      preparedEvidenceSha256: completed.preparedSha256,
    },
  };
  const head = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  verifyRecoveredHeadEvidence(head, lifecycle, descriptor);
  atomicWriteJson(input.headFile, head);
  return head;
}

/**
 * Reconciles the narrower failure where Behold rejected the run before any
 * resident was released, its early cleanup probe raced Place's owned stop,
 * and Place subsequently proved an exact clean save/exit in its immutable
 * control transcript. The recovery evidence still has to prove that every
 * recorded process is dead and the runtime is stopped and clear.
 */
export function reconcilePlaceSavedFailedStartHead(input: {
  descriptorFile: string;
  recoveryEvidenceFile: string;
  placeTranscriptFile: string;
  headFile: string;
  now?: () => Date;
}) {
  const { descriptor } = verifyPlaceServedWorldBasis(input.descriptorFile);
  const evidence = readCompletedRecovery(input.recoveryEvidenceFile, descriptor);
  if (
    evidence.completed.classification !== 'abandoned_unclean_shutdown' ||
    evidence.prepared.classification !== 'abandoned_unclean_shutdown' ||
    evidence.prepared.lifecycle?.saveAcknowledged !== false
  ) {
    throw new Error('Only an unclean failed-start recovery can use Place save reconciliation');
  }
  const lifecycle = verifyWorldLifecycleJournal(evidence.prepared.lifecycle.file);
  const failed = lifecycle.events.find((event) => event.type === 'run_start_failed');
  if (
    lifecycle.world !== descriptor.worldId ||
    lifecycle.tipDigest !== evidence.prepared.lifecycle.tipDigest ||
    lifecycle.events.length !== evidence.prepared.lifecycle.eventCount ||
    lifecycle.events.at(-1)?.type !== 'control_state_changed' ||
    (lifecycle.events.at(-1)?.data as any)?.state !== 'recovery_required' ||
    !failed ||
    lifecycle.events.some(
      (event) => event.type === 'experiment_released' || event.type === 'controller_started',
    ) ||
    evidence.prepared.runtime?.runtimePath !== descriptor.paths.runtimeWorld ||
    evidence.prepared.runtime?.runtimeSessionLock?.state !== 'clear' ||
    evidence.prepared.runtime?.serverPort?.state !== 'clear'
  ) {
    throw new Error('Recovered lifecycle is not an unreleased stopped failed start');
  }
  const place = verifyStoppedPlaceTranscript(input.placeTranscriptFile, descriptor);
  const runtime = digestTree(descriptor.paths.runtimeWorld);
  const base = {
    protocol: PLACE_SERVED_WORLD_HEAD_PROTOCOL,
    worldId: descriptor.worldId,
    updatedAt: (input.now?.() ?? new Date()).toISOString(),
    runtimeDigest: runtime.digest,
    terminalKind: 'recovered_after_place_save' as const,
    lifecycle: {
      file: lifecycle.file,
      terminalSequence: failed.sequence,
      terminalDigest: failed.digest,
      tipDigest: lifecycle.tipDigest,
    },
    recovery: recoveryHeadEvidence(evidence),
    place,
  };
  const head = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  if (!verifyRecoveredPlaceSavedHeadEvidence(head, lifecycle, descriptor)) {
    throw new Error('Place-saved failed-start head failed its own verification');
  }
  atomicWriteJson(input.headFile, head);
  return head;
}

/**
 * Advances the persistent head after the lifecycle owner and all of its
 * children died before the normal stop protocol could publish a terminal
 * world state. The recovery evidence binds the exact abandoned owner,
 * lifecycle tip, dead process set, clear lock/port fence, and unchanged
 * stopped runtime tree. It does not relabel the interrupted episode as clean.
 */
export function reconcileAbandonedPlaceServedWorldHead(input: {
  descriptorFile: string;
  recoveryEvidenceFile: string;
  headFile: string;
  now?: () => Date;
}) {
  const { descriptor } = verifyPlaceServedWorldBasis(input.descriptorFile);
  const evidence = readCompletedRecovery(input.recoveryEvidenceFile, descriptor);
  if (
    evidence.completed.classification !== 'abandoned_unclean_shutdown' ||
    evidence.prepared.classification !== 'abandoned_unclean_shutdown'
  ) {
    throw new Error('Abandoned live recovery requires an unclean-shutdown classification');
  }
  const lifecycle = verifyWorldLifecycleJournal(evidence.prepared.lifecycle?.file);
  const last = lifecycle.events.at(-1);
  const latestState = [...lifecycle.events]
    .reverse()
    .find((event) => event.type === 'control_state_changed');
  const owner = evidence.prepared.owner?.record;
  const ownerState = owner
    ? {
        state: owner.state,
        runtime: owner.runtime,
        server: owner.server,
        controllers: owner.controllers,
      }
    : null;
  const runtime = digestTree(descriptor.paths.runtimeWorld);
  if (
    lifecycle.world !== descriptor.worldId ||
    lifecycle.tipDigest !== evidence.prepared.lifecycle?.tipDigest ||
    lifecycle.events.length !== evidence.prepared.lifecycle?.eventCount ||
    !last ||
    stableJson(latestState?.data) !== stableJson(ownerState) ||
    !['starting', 'running', 'stopping', 'recovery_required', 'stopped_verified'].includes(
      owner?.state,
    ) ||
    evidence.prepared.runtime?.runtimeSessionLock?.state !== 'clear' ||
    evidence.prepared.runtime?.serverPort?.state !== 'clear' ||
    evidence.prepared.runtimeTree?.digest !== runtime.digest
  ) {
    throw new Error('Abandoned live recovery does not bind the exact stopped runtime');
  }
  const base = {
    protocol: PLACE_SERVED_WORLD_HEAD_PROTOCOL,
    worldId: descriptor.worldId,
    updatedAt: (input.now?.() ?? new Date()).toISOString(),
    runtimeDigest: runtime.digest,
    terminalKind: 'recovered_abandoned_run' as const,
    lifecycle: {
      file: lifecycle.file,
      terminalSequence: last.sequence,
      terminalDigest: last.digest,
      tipDigest: lifecycle.tipDigest,
    },
    recovery: recoveryHeadEvidence(evidence),
  };
  const head = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  if (!verifyRecoveredAbandonedHeadEvidence(head, lifecycle, descriptor)) {
    throw new Error('Abandoned live recovery head failed its own verification');
  }
  atomicWriteJson(input.headFile, head);
  return head;
}

function verifyRecoveredHeadEvidence(
  head: any,
  lifecycle: any,
  descriptor: PlaceServedWorldDescriptor,
) {
  const recovery = head.recovery;
  if (
    head.terminalKind !== 'recovered_after_save' ||
    !recovery ||
    sha256File(recovery.completedEvidenceFile) !== recovery.completedEvidenceSha256 ||
    sha256File(recovery.preparedEvidenceFile) !== recovery.preparedEvidenceSha256
  ) {
    return null;
  }
  const completed = readJson(recovery.completedEvidenceFile);
  const prepared = readJson(recovery.preparedEvidenceFile);
  const terminal = lifecycle.events.find(
    (event: any) => event.sequence === head.lifecycle.terminalSequence,
  );
  return completed.protocol === 'behold.world-recovery-evidence.v1' &&
    completed.phase === 'completed' &&
    completed.classification === 'abandoned_after_save_ack' &&
    completed.world === descriptor.worldId &&
    completed.preparedEvidence === recovery.preparedEvidenceFile &&
    completed.preparedSha256 === recovery.preparedEvidenceSha256 &&
    prepared.protocol === 'behold.world-recovery-evidence.v1' &&
    prepared.phase === 'prepared' &&
    prepared.classification === 'abandoned_after_save_ack' &&
    prepared.world === descriptor.worldId &&
    prepared.lifecycle?.file === lifecycle.file &&
    prepared.lifecycle?.tipDigest === lifecycle.tipDigest &&
    prepared.lifecycle?.saveAcknowledged === true &&
    terminal?.type === 'run_terminal_world_state' &&
    (terminal.data as any)?.tree?.digest === head.runtimeDigest
    ? completed
    : null;
}

function verifyRecoveredPlaceSavedHeadEvidence(
  head: any,
  lifecycle: any,
  descriptor: PlaceServedWorldDescriptor,
) {
  if (head.terminalKind !== 'recovered_after_place_save') return null;
  let evidence;
  let place;
  try {
    evidence = readCompletedRecovery(head.recovery?.completedEvidenceFile, descriptor);
    place = verifyStoppedPlaceTranscript(head.place?.transcriptFile, descriptor);
  } catch {
    return null;
  }
  const failed = lifecycle.events.find(
    (event: any) => event.sequence === head.lifecycle.terminalSequence,
  );
  return evidence.completed.classification === 'abandoned_unclean_shutdown' &&
    evidence.prepared.classification === 'abandoned_unclean_shutdown' &&
    evidence.prepared.lifecycle?.saveAcknowledged === false &&
    evidence.prepared.lifecycle?.file === lifecycle.file &&
    evidence.prepared.lifecycle?.tipDigest === lifecycle.tipDigest &&
    sha256File(evidence.completedFile) === head.recovery.completedEvidenceSha256 &&
    sha256File(evidence.preparedFile) === head.recovery.preparedEvidenceSha256 &&
    failed?.type === 'run_start_failed' &&
    !lifecycle.events.some(
      (event: any) => event.type === 'experiment_released' || event.type === 'controller_started',
    ) &&
    stableJson(place) === stableJson(head.place)
    ? evidence.completed
    : null;
}

function verifyRecoveredAbandonedHeadEvidence(
  head: any,
  lifecycle: any,
  descriptor: PlaceServedWorldDescriptor,
) {
  if (head.terminalKind !== 'recovered_abandoned_run') return null;
  let evidence;
  try {
    evidence = readCompletedRecovery(head.recovery?.completedEvidenceFile, descriptor);
  } catch {
    return null;
  }
  const last = lifecycle.events.at(-1);
  const latestState = [...lifecycle.events]
    .reverse()
    .find((event: any) => event.type === 'control_state_changed');
  const owner = evidence.prepared.owner?.record;
  const ownerState = owner
    ? {
        state: owner.state,
        runtime: owner.runtime,
        server: owner.server,
        controllers: owner.controllers,
      }
    : null;
  return evidence.completed.classification === 'abandoned_unclean_shutdown' &&
    evidence.prepared.classification === 'abandoned_unclean_shutdown' &&
    evidence.prepared.lifecycle?.file === lifecycle.file &&
    evidence.prepared.lifecycle?.tipDigest === lifecycle.tipDigest &&
    evidence.prepared.lifecycle?.eventCount === lifecycle.events.length &&
    last?.sequence === head.lifecycle.terminalSequence &&
    last?.digest === head.lifecycle.terminalDigest &&
    stableJson(latestState?.data) === stableJson(ownerState) &&
    evidence.prepared.runtime?.runtimeSessionLock?.state === 'clear' &&
    evidence.prepared.runtime?.serverPort?.state === 'clear' &&
    evidence.prepared.runtimeTree?.digest === head.runtimeDigest &&
    sha256File(evidence.completedFile) === head.recovery.completedEvidenceSha256 &&
    sha256File(evidence.preparedFile) === head.recovery.preparedEvidenceSha256
    ? evidence.completed
    : null;
}

function verifyPlaceOnlyCleanupHeadEvidence(
  head: any,
  lifecycle: any,
  descriptor: PlaceServedWorldDescriptor,
) {
  if (head.terminalKind !== 'place_only_cleanup') return null;
  let place;
  try {
    place = verifyStoppedPlaceTranscript(head.place?.transcriptFile, descriptor);
  } catch {
    return null;
  }
  const terminal = lifecycle.events.find(
    (event: any) => event.sequence === head.lifecycle.terminalSequence,
  );
  const terminalKind = placeServedWorldTerminalKind(terminal?.type);
  return terminalKind != null &&
    head.previousTerminalKind === terminalKind &&
    terminal?.digest === head.lifecycle.terminalDigest &&
    (terminal.data as any)?.tree?.digest === head.previousRuntimeDigest &&
    lifecycle.events.at(-1)?.type === 'control_released' &&
    placeServedWorldTerminalCompletion(
      lifecycle.events,
      terminal.sequence,
      terminalKind,
      descriptor,
    ) &&
    stableJson(place) === stableJson(head.place)
    ? place
    : null;
}

function readCompletedRecovery(
  recoveryEvidenceFile: string,
  descriptor: PlaceServedWorldDescriptor,
) {
  const completedFile = plainFile(recoveryEvidenceFile, 'completed world recovery evidence');
  const completed = readJson(completedFile);
  const preparedFile = plainFile(completed.preparedEvidence, 'prepared world recovery evidence');
  const prepared = readJson(preparedFile);
  if (
    completed.protocol !== 'behold.world-recovery-evidence.v1' ||
    completed.phase !== 'completed' ||
    completed.world !== descriptor.worldId ||
    completed.preparedSha256 !== sha256File(preparedFile) ||
    prepared.protocol !== 'behold.world-recovery-evidence.v1' ||
    prepared.phase !== 'prepared' ||
    prepared.world !== descriptor.worldId ||
    completed.classification !== prepared.classification ||
    completed.epoch !== prepared.epoch ||
    completed.releasedOwnerFile !== prepared.owner?.file ||
    fs.existsSync(completed.releasedOwnerFile)
  ) {
    throw new Error('World recovery evidence is not complete or authentic');
  }
  return { completedFile, completed, preparedFile, prepared };
}

function recoveryHeadEvidence(evidence: ReturnType<typeof readCompletedRecovery>) {
  return {
    completedEvidenceFile: evidence.completedFile,
    completedEvidenceSha256: sha256File(evidence.completedFile),
    preparedEvidenceFile: evidence.preparedFile,
    preparedEvidenceSha256: sha256File(evidence.preparedFile),
  };
}

function verifyStoppedPlaceTranscript(
  transcriptFileValue: string,
  descriptor: PlaceServedWorldDescriptor,
) {
  const transcript = verifyPlaceServeTranscript(transcriptFileValue);
  const parsed = transcript.events.map((event: any) => ({
    event,
    message: JSON.parse(event.line),
  }));
  const ready = parsed.find(({ message }: any) => message.event === 'ready');
  const stopTerminal = parsed.find(
    ({ message }: any) =>
      message.event === 'command_terminal' &&
      message.command === 'stop' &&
      message.ok === true &&
      message.state?.lifecycle === 'stopped' &&
      typeof message.acknowledgement === 'string',
  );
  const stopped = parsed.find(
    ({ event, message }: any) =>
      event.sequence > (stopTerminal?.event.sequence ?? Number.MAX_SAFE_INTEGER) &&
      message.event === 'stopped' &&
      message.state?.lifecycle === 'stopped' &&
      message.java?.cleanExit === true &&
      message.java?.exitCode === 0,
  );
  if (
    !ready ||
    !stopTerminal ||
    !stopped ||
    !placeMessageIdentityMatches(ready.message.identity, descriptor) ||
    !placeMessageIdentityMatches(stopTerminal.message.identity, descriptor) ||
    !placeMessageIdentityMatches(stopped.message.identity, descriptor) ||
    ready.message.identity?.processes?.javaPid !== stopped.message.java?.pid
  ) {
    throw new Error('Place transcript does not prove an exact clean saved stop');
  }
  return {
    transcriptFile: transcript.file,
    transcriptSha256: sha256File(transcript.file),
    transcriptTipDigest: transcript.tipDigest,
    stopTerminalSequence: stopTerminal.event.sequence,
    stopTerminalLineSha256: stopTerminal.event.lineSha256,
    stoppedSequence: stopped.event.sequence,
    stoppedLineSha256: stopped.event.lineSha256,
  };
}

function placeMessageIdentityMatches(identity: any, descriptor: PlaceServedWorldDescriptor) {
  return (
    identity?.placeId === descriptor.origin.placeId &&
    identity?.placeName === descriptor.display.placeName &&
    identity?.sourceRunId === descriptor.origin.sourceRunId &&
    identity?.profileId === descriptor.origin.profileId &&
    identity?.minecraftVersion === descriptor.origin.minecraftVersion &&
    identity?.sourceReleaseManifestSha256 === descriptor.origin.sourceReleaseManifestSha256 &&
    identity?.sourceWorldTreeSha256 === descriptor.origin.sourceWorldTreeSha256 &&
    identity?.minecraftServerSha256 === descriptor.origin.minecraftServerSha256 &&
    identity?.runtimeManifestSha256 === descriptor.origin.runtimeManifestSha256 &&
    identity?.releasePath === descriptor.paths.release &&
    identity?.runtimePath === descriptor.paths.runtimeRoot
  );
}

function placeServedWorldTerminalKind(type: unknown): PlaceServedWorldTerminalKind | null {
  if (type === 'run_terminal_world_state') return 'completed_run';
  if (type === 'failed_start_terminal_world_state') return 'failed_start_cleanup';
  return null;
}

function placeServedWorldTerminalCompletion(
  events: readonly any[],
  terminalSequence: number,
  kind: PlaceServedWorldTerminalKind | null,
  descriptor: PlaceServedWorldDescriptor,
) {
  if (kind === 'completed_run') {
    return events.find(
      (event) => event.sequence > terminalSequence && event.type === 'run_stopped',
    );
  }
  if (kind === 'failed_start_cleanup') {
    const configured = events.find((event) => event.type === 'run_configured');
    const failed = events.find(
      (event) => event.sequence < terminalSequence && event.type === 'run_start_failed',
    );
    const released = events.find((event) => event.type === 'experiment_released');
    const brokerReady = events.find((event) => event.type === 'cognition_broker_ready');
    const cognition = [...events]
      .reverse()
      .find((event) => event.type === 'cognition_broker_drained');
    const completed = events.find(
      (event) =>
        event.sequence > terminalSequence && event.type === 'failed_start_cleanup_completed',
    );
    if (
      !placeServedRunConfigurationMatches(configured?.data, descriptor) ||
      !failed ||
      released ||
      (brokerReady &&
        (!cognition ||
          (cognition.data as any)?.snapshot?.accepted !== 0 ||
          (cognition.data as any)?.snapshot?.admitted !== 0)) ||
      (!brokerReady && events.some((event) => event.type === 'controller_started'))
    ) {
      return null;
    }
    return completed ?? null;
  }
  return null;
}

function placeServedRunConfigurationMatches(data: any, descriptor: PlaceServedWorldDescriptor) {
  const identity = data?.serverAuthority?.identity;
  if (
    data?.world?.id !== descriptor.worldId ||
    data?.serverAuthority?.kind !== 'place-release-serve' ||
    !identity
  ) {
    return false;
  }
  const origin = {
    controlProtocol: identity.protocol,
    placeCompilerRevision: identity.placeCompilerRevision,
    placeId: identity.placeId,
    sourceRunId: identity.sourceRunId,
    profileId: identity.profileId,
    minecraftVersion: identity.minecraftVersion,
    sourceReleaseManifestSha256: identity.sourceReleaseManifestSha256,
    sourceWorldTreeSha256: identity.sourceWorldTreeSha256,
    minecraftServerSha256: identity.minecraftServerSha256,
    runtimeManifestSha256: identity.runtimeManifestSha256,
  };
  return (
    stableJson(origin) === stableJson(descriptor.origin) &&
    identity.releasePath === descriptor.paths.release &&
    identity.runtimePath === descriptor.paths.runtimeRoot
  );
}

function assertPlaceControlTerminal(
  value: any,
  identity: FrozenPlaceServeAuthority['placeIdentity'],
  command: 'freeze' | 'save',
  ticks: 'frozen',
) {
  if (
    value?.protocol !== 'place-compiler-serve-control/v1' ||
    value?.event !== 'command_terminal' ||
    value?.command !== command ||
    value?.ok !== true ||
    value?.state?.ticks !== ticks ||
    typeof value?.acknowledgement !== 'string' ||
    stableJson(value.identity) !== stableJson(identity)
  ) {
    throw new Error(`Place ${command} acknowledgement is not exact`);
  }
}

function assertJavaOwnsPlaceRuntime(
  authority: FrozenPlaceServeAuthority,
  runtimeWorld: string,
  phase: string,
) {
  const lockOwners = lsofPids(['-F', 'p', '--', path.join(runtimeWorld, 'session.lock')]);
  const portOwners = lsofPids(['-nP', `-iTCP:${authority.port}`, '-sTCP:LISTEN', '-F', 'p']);
  if (!lockOwners.includes(authority.serverPid) || !portOwners.includes(authority.serverPid)) {
    throw new Error(`Place Java ownership is not exact during ${phase}`);
  }
}

function lsofPids(args: string[]) {
  const result = spawnSync('lsof', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (![0, 1].includes(result.status ?? -1)) throw new Error('lsof ownership probe failed');
  return result.stdout
    .split('\n')
    .filter((line) => /^p[0-9]+$/.test(line))
    .map((line) => Number(line.slice(1)));
}

function transcriptRecord(events: readonly any[], matches: (message: any) => boolean) {
  const found = events
    .filter((event) => event.direction === 'received')
    .map((event) => ({ event, message: JSON.parse(event.line) }))
    .find(({ message }) => matches(message));
  if (!found) throw new Error('Place control transcript lacks required adoption evidence');
  return Object.freeze({ message: found.message, lineSha256: found.event.lineSha256 });
}

function copyWorld(source: string, destination: string) {
  fs.cpSync(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    dereference: false,
    mode: fs.constants.COPYFILE_FICLONE,
    filter: (candidate) => path.relative(source, candidate) !== 'session.lock',
  });
}

function makeReadOnlyTree(root: string) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) makeReadOnlyTree(child);
    else if (entry.isFile()) fs.chmodSync(child, 0o444);
    else throw new Error(`Adoption snapshot contains unsupported entry: ${child}`);
  }
  fs.chmodSync(root, 0o555);
}

function atomicWriteJson(fileValue: string, value: unknown) {
  const file = path.resolve(fileValue);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function readJson(fileValue: string) {
  return JSON.parse(fs.readFileSync(plainFile(fileValue, 'JSON file'), 'utf8'));
}

function plainDirectory(value: string, label: string) {
  const resolved = path.resolve(value);
  const stats = fs.lstatSync(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error(`${label} must be a plain directory`);
  return fs.realpathSync.native(resolved);
}

function plainFile(value: string, label: string) {
  const resolved = path.resolve(value);
  const stats = fs.lstatSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a plain file`);
  return fs.realpathSync.native(resolved);
}

function sha256File(file: string) {
  return createHash('sha256')
    .update(fs.readFileSync(plainFile(file, 'digest input')))
    .digest('hex');
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isPlaceCompilerIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (/^[a-f0-9]{40}$/.test(value) || /^npm:place-compiler@[^#\s]{1,128}#[a-f0-9]{64}$/.test(value))
  );
}

function safeSegment(value: string) {
  const segment = String(value).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment)) {
    throw new Error(`Unsafe Place identity segment: ${value}`);
  }
  return segment;
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
