import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  bundledJava,
  loadManagedResidentSet,
  managedSessionDurationMs,
  recoverAbandonedManagedWorld,
  resolveManagedDataRoot,
  startManagedWorld,
  type ManagedWorldRun,
} from '../../scripts/world-runner';
import { RESIDENT_VIEWER_PROTOCOL } from '../observability/resident-viewer';
import { sanitizeName } from '../observability/journal';
import {
  startResidentLensServer,
  type ResidentLensServerHandle,
} from '../observability/resident-lens-server';
import {
  assertPlaceServedAuthority,
  assertPlaceServedResumeContinuity,
  establishPlaceServedWorldBasis,
  reconcileAbandonedPlaceServedWorldHead,
  reconcileRecoveredPlaceServedWorldHead,
  recordPlaceServedWorldHead,
  recordPlaceOnlyCleanupHead,
  verifyPlaceServedWorldBasis,
} from '../runtime/place-served-world';
import {
  preflightFrozenPlaceServeAuthority,
  startFrozenPlaceServeAuthority,
  verifyPlaceServeTranscript,
  type FrozenPlaceServeAuthority,
} from '../runtime/place-serve';
import { stagePlaceHistorySeed } from '../runtime/place-history-seed';
import {
  captureLiveLyncCheckpoint,
  LIVE_EPISODE_RECORD_V2_PROTOCOL,
  publishLiveCheckpointJson,
} from '../runtime/live-lync-checkpoint';

const PLACE_SERVE_REVISION = 'b872237cbef4fed4e4a0dfdf5d472b24ab50a1d0' as const;
const LIVE_SESSION_PROTOCOL = 'behold.live-session.v1' as const;
const LIVE_RESIDENT_REVISION_PROTOCOL = 'behold.live-resident-revision.v1' as const;
const LIVE_ECOLOGY_LOG_PROTOCOL = 'behold.live-ecology-log.v1' as const;
const LIVE_LYNC_SNAPSHOT_PROTOCOL = 'behold.live-lync-snapshot.v1' as const;
const LIVE_TEXTILE_IMPORT_PROTOCOL = 'behold.live-textile-import.v1' as const;
const LIVE_NATIVE_HUMAN_PROTOCOL = 'behold.live-native-human.v2' as const;

export async function runLiveCli(argv: string[]) {
  const parsed = parseArgs({
    args: argv,
    options: {
      residents: { type: 'string' },
      'accept-eula': { type: 'boolean', default: false },
      session: { type: 'string' },
      state: { type: 'string' },
      duration: { type: 'string' },
      port: { type: 'string' },
      'viewer-base-port': { type: 'string' },
      'viewer-distance': { type: 'string' },
      'place-compiler': { type: 'string' },
      'place-compiler-bin': { type: 'string' },
      'place-compiler-version': { type: 'string' },
      'place-compiler-distribution-sha256': { type: 'string' },
      'server-jar': { type: 'string' },
      'max-model-concurrency': { type: 'string' },
      'lmstudio-models-root': { type: 'string' },
      'native-player': { type: 'string' },
      'world-history-receipt': { type: 'string' },
      history: { type: 'string' },
      'change-minds': { type: 'boolean', default: false },
      recover: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  if (parsed.values.help) {
    process.stdout.write(`${liveUsage()}\n`);
    return 0;
  }
  if (parsed.positionals.length !== 1) {
    throw new Error('live requires one RELEASE');
  }
  if (parsed.values['accept-eula'] !== true) {
    throw new Error('live requires explicit --accept-eula');
  }
  const repositoryRoot = findRepositoryRoot();
  assertCleanCheckout(repositoryRoot, 'Behold');
  const serverJar = plainFile(
    String(
      parsed.values['server-jar'] ??
        process.env.BEHOLD_SERVER_JAR ??
        path.join(repositoryRoot, '.behold-runtime', 'server', 'server.jar'),
    ),
    'Minecraft server JAR',
  );
  const releaseRoot = plainDirectory(parsed.positionals[0], 'Place release');
  const releaseManifestFile = path.join(releaseRoot, 'release-manifest.json');
  const releaseManifest = readJson(releaseManifestFile);
  const placeId = safeSegment(releaseManifest?.placeId, 'Place id');
  const releaseManifestSha256 = sha256File(releaseManifestFile);
  const sessionId = safeSegment(
    parsed.values.session ?? `${placeId}-${releaseManifestSha256.slice(0, 12)}-living`,
    'session id',
  );
  const stateRoot = path.resolve(
    String(parsed.values.state ?? path.join(repositoryRoot, 'data', 'live')),
  );
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const sessionRoot = path.join(resolveManagedDataRoot(stateRoot, 'live state root'), sessionId);
  fs.mkdirSync(sessionRoot, { recursive: true, mode: 0o700 });
  const paths = liveSessionPaths(sessionRoot);
  for (const directory of [paths.episodes, paths.control, paths.entities, paths.runs]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const existingPlan = fs.existsSync(paths.plan) ? readLivePlan(paths.plan) : null;
  if (existingPlan) {
    if (
      existingPlan.sessionId !== sessionId ||
      existingPlan.releaseManifestSha256 !== releaseManifestSha256
    ) {
      throw new Error('live session identity differs from its persistent release');
    }
  }
  const sessionEntry = classifyLiveSessionEntry({
    planExists: existingPlan != null,
    descriptorExists: fs.existsSync(paths.descriptor),
    headExists: fs.existsSync(paths.head),
    managedLifecycleCount: existingPlan
      ? liveLifecycleFiles(paths.control, existingPlan.worldId).length
      : 0,
  });
  const historySeed = selectLiveHistorySeed({
    receipt: parsed.values['world-history-receipt'],
    history: parsed.values.history,
    sessionEntry,
  });
  const requestedResidentFile = parsed.values.residents
    ? plainFile(String(parsed.values.residents), 'resident set')
    : null;
  const requestedResidents = requestedResidentFile
    ? loadManagedResidentSet(requestedResidentFile)
    : null;
  const currentResidents = existingPlan
    ? latestLiveResidentRevision(paths.residentRevisions, existingPlan)
    : null;
  const residentSelection = selectLiveResidentConfiguration({
    requestedResidents,
    current: currentResidents,
    changeMinds: parsed.values['change-minds'] === true,
    recover: parsed.values.recover === true,
  });
  const residents = residentSelection.residents;
  let residentRevision = residentSelection.residentRevision;
  const residentSetSha256 = sha256(stableJson(residents));
  if (residents.some((resident) => resident.providerQuotas == null || resident.paused === true)) {
    throw new Error('live requires an armed per-resident provider-attempt ceiling for every life');
  }
  const nativePlayer = parsed.values['native-player']
    ? minecraftUsername(parsed.values['native-player'], '--native-player')
    : null;
  if (
    nativePlayer &&
    residents.some((resident) => resident.bodyUsername.toLowerCase() === nativePlayer.toLowerCase())
  ) {
    throw new Error('--native-player must be distinct from every managed resident body');
  }
  if (sessionEntry === 'first_start_retry' && parsed.values.recover === true) {
    throw new Error(
      'live session has no managed epoch to recover; retry normally without --recover',
    );
  }
  if (sessionEntry === 'recovery_required' && parsed.values.recover !== true) {
    throw new Error(
      'live session has managed lifecycle evidence but no persistent head; retry with --recover',
    );
  }
  if (sessionEntry === 'resume' && parsed.values.recover !== true) {
    assertPlaceServedResumeContinuity(paths.descriptor, paths.head);
  }

  if (parsed.values.recover === true) {
    if (!existingPlan) throw new Error('live --recover requires an existing persistent session');
    if (parsed.values['change-minds'] === true) {
      throw new Error('live --recover cannot revise resident minds');
    }
    const established = verifyPlaceServedWorldBasis(paths.descriptor);
    if (established.descriptor.worldId !== existingPlan.worldId) {
      throw new Error('live recovery world differs from its persistent session');
    }
    let recovered;
    try {
      recovered = await recoverAbandonedManagedWorld({
        worldId: existingPlan.worldId,
        world: established.world,
        controlRoot: paths.control,
        entityRoot: paths.entities,
      });
    } catch (error: any) {
      if (error?.code !== 'world_control_not_recoverable' || error?.evidence?.state !== 'clear') {
        throw error;
      }
      recovered = selectPendingLiveRecoveryEvidence({
        controlRoot: paths.control,
        worldId: existingPlan.worldId,
        headFile: paths.head,
      });
    }
    const reconcile =
      recovered.classification === 'abandoned_after_save_ack'
        ? reconcileRecoveredPlaceServedWorldHead
        : reconcileAbandonedPlaceServedWorldHead;
    const head = reconcile({
      descriptorFile: paths.descriptor,
      recoveryEvidenceFile: recovered.completedEvidence,
      headFile: paths.head,
    });
    process.stdout.write(
      `[behold live] recovered abandoned epoch ${recovered.epoch}; persistent head ${head.runtimeDigest}\n`,
    );
    return 0;
  }

  if (
    !process.env.OPENROUTER_API_KEY &&
    residents.some((resident) => resident.ollamaLocal == null && resident.lmStudioLocal == null)
  ) {
    throw new Error(
      'live requires OPENROUTER_API_KEY before starting Place for provider residents',
    );
  }

  const placeCompilerBinaryValue =
    parsed.values['place-compiler-bin'] ?? process.env.BEHOLD_PLACE_COMPILER_BIN;
  const explicitPlaceCompilerRoot =
    parsed.values['place-compiler'] ?? process.env.BEHOLD_PLACE_COMPILER_ROOT;
  if (placeCompilerBinaryValue && explicitPlaceCompilerRoot) {
    throw new Error('--place-compiler and --place-compiler-bin are mutually exclusive');
  }
  const installedVersion = placeCompilerBinaryValue
    ? requiredCliText(
        parsed.values['place-compiler-version'] ?? process.env.BEHOLD_PLACE_COMPILER_VERSION,
        '--place-compiler-version',
      )
    : null;
  const installedDistributionSha256 = placeCompilerBinaryValue
    ? exactSha256(
        parsed.values['place-compiler-distribution-sha256'] ??
          process.env.BEHOLD_PLACE_COMPILER_DISTRIBUTION_SHA256,
        '--place-compiler-distribution-sha256',
      )
    : null;
  const resumePlaceCompiler = placeCompilerBinaryValue
    ? {
        kind: 'binary' as const,
        binary: executableFile(String(placeCompilerBinaryValue), 'Place Compiler binary'),
        version: installedVersion!,
        distributionSha256: installedDistributionSha256!,
      }
    : {
        kind: 'checkout' as const,
        root: plainDirectory(
          String(explicitPlaceCompilerRoot ?? path.join(repositoryRoot, '..', 'place-compiler')),
          'Place Compiler root',
        ),
      };
  const placeCompilerInput =
    resumePlaceCompiler.kind === 'binary'
      ? {
          placeCompilerBinary: resumePlaceCompiler.binary,
          expectedPlaceCompilerPackage: {
            name: 'place-compiler',
            version: resumePlaceCompiler.version,
            distributionSha256: resumePlaceCompiler.distributionSha256,
          },
        }
      : {
          placeCompilerRoot: resumePlaceCompiler.root,
          expectedPlaceCompilerRevision:
            existingPlan?.placeCompilerRevision ?? PLACE_SERVE_REVISION,
        };
  const requestedPlaceCompilerIdentity = placeCompilerBinaryValue
    ? `npm:place-compiler@${installedVersion}#${installedDistributionSha256}`
    : (existingPlan?.placeCompilerRevision ?? PLACE_SERVE_REVISION);
  if (existingPlan && existingPlan.placeCompilerRevision !== requestedPlaceCompilerIdentity) {
    throw new Error('live session Place Compiler identity differs from the requested compiler');
  }
  const durationMs = managedSessionDurationMs(parsed.values.duration ?? '300')!;
  const requestedPort = optionalInteger(parsed.values.port, '--port', 1024, 65535);
  const viewerBasePort = optionalInteger(
    parsed.values['viewer-base-port'] ?? '3007',
    '--viewer-base-port',
    1024,
    65535,
  )!;
  const viewerDistance = optionalInteger(
    parsed.values['viewer-distance'] ?? '6',
    '--viewer-distance',
    2,
    16,
  )!;
  const maxConcurrentModelCalls = optionalInteger(
    parsed.values['max-model-concurrency'] ?? String(Math.min(2, residents.length)),
    '--max-model-concurrency',
    1,
    Math.max(1, residents.length),
  )!;
  const admittedPort = existingPlan?.endpoint.port ?? requestedPort ?? 25565;
  if (requestedPort != null && requestedPort !== admittedPort) {
    throw new Error(`live session uses port ${admittedPort}; requested ${requestedPort}`);
  }
  const placePreflight = (runtimeRoot: string) =>
    preflightFrozenPlaceServeAuthority({
      ...placeCompilerInput,
      releaseRoot,
      runtimeRoot,
      profileId: 'living',
      acceptEula: true,
      port: admittedPort,
      serverJar,
    });
  if (historySeed) {
    await stagePlaceHistorySeed(
      {
        receiptFile: historySeed.receipt,
        historyId: historySeed.history,
        releaseRoot,
        serverJar,
        destinationRuntimeRoot: paths.placeRuntime,
      },
      { validateStagedRuntime: placePreflight },
    );
  }
  preflightFrozenPlaceServeAuthority({
    ...placeCompilerInput,
    releaseRoot,
    runtimeRoot: paths.placeRuntime,
    profileId: 'living',
    acceptEula: true,
    port: admittedPort,
    serverJar,
  });
  const episodeId = nextEpisodeId(paths.episodes);
  const episodeRoot = path.join(paths.episodes, episodeId);
  fs.mkdirSync(episodeRoot, { mode: 0o700 });
  let authority: FrozenPlaceServeAuthority | null = null;
  let run: ManagedWorldRun | null = null;
  let residentLens: ResidentLensServerHandle | null = null;
  let cleanStop = false;
  let managedLifecycleObserved = false;
  let boundary: ReturnType<typeof createLiveBoundary> | null = null;
  const startedAt = new Date().toISOString();
  const placeServerLogsBefore = new Set(listPlaceServerLogs(paths.placeRuntime));
  try {
    authority = await startFrozenPlaceServeAuthority({
      ...placeCompilerInput,
      releaseRoot,
      runtimeRoot: paths.placeRuntime,
      profileId: 'living',
      transcriptFile: path.join(episodeRoot, 'place-control.jsonl'),
      acceptEula: true,
      port: admittedPort,
      serverJar,
    });

    let established;
    let plan = existingPlan;
    if (!plan) {
      const adoptionSave = await authority.save('behold_live_adoption_basis');
      established = establishPlaceServedWorldBasis({
        sessionRoot,
        authority,
        saveEvidence: adoptionSave,
      });
      plan = writeLivePlan(paths.plan, {
        sessionId,
        worldId: established.descriptor.worldId,
        placeCompilerRevision: authority.placeCompilerRevision,
        releaseManifestSha256,
        residentSetSha256,
        residents,
        accountingScopeId: `${sessionId}:living`,
        endpoint: authority.placeIdentity.endpoint,
        createdAt: new Date().toISOString(),
      });
    } else {
      established = verifyPlaceServedWorldBasis(paths.descriptor);
      if (established.descriptor.worldId !== plan.worldId) {
        throw new Error('live session world differs from its served-world genesis');
      }
      assertPlaceServedAuthority(established.descriptor, authority);
    }
    if (residentSelection.writeRevision) {
      residentRevision = writeLiveResidentRevision({
        directory: paths.residentRevisions,
        sessionId,
        previousDigest: currentResidents!.digest,
        residents,
      });
    }
    const accountingScopeId = liveEpisodeAccountingScope(plan.accountingScopeId, episodeId);

    const lifecycleFilesBefore = new Set(liveLifecycleFiles(paths.control, plan.worldId));
    try {
      run = await startManagedWorld(
        {
          worldId: established.descriptor.worldId,
          world: established.world,
          controlRoot: paths.control,
          serverDirectory: authority.placeIdentity.runtimePath,
          serverJar: authority.minecraftServerJar,
          expectedServerJarSha256: authority.minecraftServerSha256,
          java: bundledJava(),
          controllerEntry: path.join(repositoryRoot, 'dist', 'src', 'cli', 'behold.js'),
          entityRoot: paths.entities,
          runRoot: paths.runs,
          residents,
          residentViewers: {
            protocol: RESIDENT_VIEWER_PROTOCOL,
            basePort: viewerBasePort,
            viewDistance: viewerDistance,
          },
          maxResidents: residents.length,
          maxConcurrentModelCalls,
          retainCognitionBodies: process.env.BEHOLD_RECORD_MODEL_IO === '1',
          accountingScopeId,
          ...(residents.some((resident) => resident.ollamaLocal != null)
            ? {
                ollamaServerConfigFile:
                  process.env.BEHOLD_OLLAMA_SERVER_CONFIG ??
                  path.join(os.homedir(), '.ollama', 'server.json'),
              }
            : {}),
          ...(residents.some((resident) => resident.lmStudioLocal != null)
            ? {
                lmStudioModelsRoot: path.resolve(
                  String(
                    parsed.values['lmstudio-models-root'] ??
                      path.join(os.homedir(), '.lmstudio', 'models'),
                  ),
                ),
              }
            : {}),
        },
        { externalServerAuthority: authority },
      );
    } catch (error) {
      const addedLifecycleFiles = liveLifecycleFiles(paths.control, plan.worldId).filter(
        (file) => !lifecycleFilesBefore.has(file),
      );
      managedLifecycleObserved = addedLifecycleFiles.length > 0;
      if (addedLifecycleFiles.length === 1) {
        try {
          const failedHead = recordPlaceServedWorldHead({
            descriptorFile: paths.descriptor,
            lifecycleFile: addedLifecycleFiles[0],
            headFile: paths.head,
          });
          process.stderr.write(
            `[behold live] failed start stopped cleanly; preserved world head ${failedHead.runtimeDigest}\n`,
          );
        } catch (headError: any) {
          process.stderr.write(
            `[behold live] failed start requires canonical recovery: ${headError?.message || String(headError)}\n`,
          );
        }
      }
      throw error;
    }
    run.control.append('live_session_duration_armed', {
      durationMs,
      beginsAt: 'run_ready',
      terminalReason: 'duration_elapsed',
    });
    boundary = createLiveBoundary(run, durationMs);
    residentLens = await startResidentLensServer({
      residents: run.residents.map((resident) => ({
        entityId: resident.entityId,
        bodyUsername: resident.bodyUsername,
        journalDirectory: resident.journalDirectory,
        viewerEndpoint: resident.viewer?.endpoint ?? null,
        admittedFrameEndpoint:
          resident.perceptionProfile === 'semantic-plus-camera-v1'
            ? (resident.viewer?.admittedFrameEndpoint ?? null)
            : null,
        staleAfterMs: Math.max(60_000, resident.tickMs * 5),
      })),
      lifecycleFile: run.control.journalFile,
      control: {
        pause: () => run!.pauseResidents('resident_lens'),
        resume: () => run!.resumeResidents('resident_lens'),
        stop: () => {
          boundary!.request('resident_lens_stop');
          return run!.stop('resident_lens_stop');
        },
      },
    });
    printLiveReady(
      sessionId,
      authority,
      run,
      durationMs,
      episodeRoot,
      nativePlayer,
      residentLens.endpoint,
    );
    const reason = await boundary.wait;
    await run.stop(reason);
    await run.finished;
    cleanStop = true;

    const head = recordPlaceServedWorldHead({
      descriptorFile: paths.descriptor,
      lifecycleFile: run.control.journalFile,
      headFile: paths.head,
    });
    const ecologyLog = preservePlaceServerLog({
      runtimeRoot: authority.placeIdentity.runtimePath,
      filesBefore: placeServerLogsBefore,
      destination: path.join(episodeRoot, 'minecraft-server.log'),
    });
    const transcript = verifyPlaceServeTranscript(authority.transcriptFile);
    const nativeHuman = nativePlayer
      ? assessNativeHumanEntry({
          declaredPlayer: nativePlayer,
          endpoint: authority.placeIdentity.endpoint,
          ecologyLogFile: ecologyLog.file,
          residents: run.residents,
        })
      : null;
    const episodeRecord = writeEpisodeRecord({
      file: path.join(episodeRoot, 'episode-record.json'),
      sessionId,
      episodeId,
      startedAt,
      completedAt: new Date().toISOString(),
      run,
      authority,
      head,
      transcriptTipDigest: transcript.tipDigest,
      entityRoot: paths.entities,
      ecologyLog,
      accountingScopeId,
      nativeHuman,
      residentRevision,
    });
    process.stdout.write(`\n[behold live] stopped cleanly\n`);
    process.stdout.write(`[behold live] episode record: ${episodeRecord.file}\n`);
    for (const life of episodeRecord.record.lives) {
      process.stdout.write(`[behold live] ${life.entityId} life: ${life.lyncDirectory}\n`);
    }
    if (nativeHuman) {
      process.stdout.write(
        `[behold live] native human ${nativeHuman.declaredPlayer}: ${nativeHuman.assessment.passed ? 'witnessed' : 'not witnessed'}\n`,
      );
    }
    process.stdout.write(
      `[behold live] resume: ${liveResumeInstruction({
        releaseRoot,
        sessionId,
        nativePlayer,
        placeCompiler: resumePlaceCompiler,
      })}\n`,
    );
    if (nativeHuman && !nativeHuman.assessment.passed) {
      throw new Error(
        `native-human treatment did not produce a server join witnessed by every resident; preserved ${episodeRecord.file}`,
      );
    }
    return 0;
  } catch (error) {
    if (run && !cleanStop) {
      await run.stop('live_failure').catch(() => {});
      await run.finished.catch(() => {});
    } else if (
      shouldRecordPlaceOnlyCleanup({
        cleanStop,
        hasAuthority: authority != null,
        hadExistingPlan: existingPlan != null,
        managedLifecycleObserved,
        headExists: fs.existsSync(paths.head),
      })
    ) {
      try {
        await authority!.stop('live_preflight_failure');
        recordPlaceOnlyCleanupHead({
          descriptorFile: paths.descriptor,
          previousHeadFile: paths.head,
          placeTranscriptFile: authority!.transcriptFile,
          headFile: paths.head,
        });
        authority = null;
      } catch (cleanupError: any) {
        process.stderr.write(
          `[behold live] failed to authenticate preflight cleanup: ${cleanupError?.message || String(cleanupError)}\n`,
        );
      }
    }
    throw error;
  } finally {
    await residentLens?.close().catch(() => {});
    if (authority)
      await authority.stop(cleanStop ? 'live_final_settlement' : 'live_failure').catch(() => {});
    boundary?.dispose();
  }
}

export function classifyLiveSessionEntry(input: {
  planExists: boolean;
  descriptorExists: boolean;
  headExists: boolean;
  managedLifecycleCount: number;
}): 'new' | 'first_start_retry' | 'resume' | 'recovery_required' {
  if (!Number.isSafeInteger(input.managedLifecycleCount) || input.managedLifecycleCount < 0) {
    throw new Error('live session managed lifecycle count is invalid');
  }
  if (!input.planExists) {
    if (input.descriptorExists) {
      throw new Error('served-world genesis exists without its live session plan');
    }
    if (input.headExists) {
      throw new Error('persistent live head exists without its live session plan');
    }
    return 'new';
  }
  if (!input.descriptorExists) {
    throw new Error('live session plan exists without its served-world genesis');
  }
  if (input.headExists) return 'resume';
  if (input.managedLifecycleCount > 0) return 'recovery_required';
  return 'first_start_retry';
}

export function selectPendingLiveRecoveryEvidence(input: {
  controlRoot: string;
  worldId: string;
  headFile: string;
}) {
  const head = readJson(input.headFile);
  const headEpochMatch = path
    .basename(String(head.lifecycle?.file ?? ''))
    .match(/^lifecycle-(\d+)\.jsonl$/);
  if (head.worldId !== input.worldId || !headEpochMatch) {
    throw new Error('live recovery cannot identify the current persistent head epoch');
  }
  const headEpoch = Number(headEpochMatch[1]);
  const directory = path.join(input.controlRoot, input.worldId);
  const candidates = fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const match = entry.name.match(/^recovery-(\d+)-[0-9a-f]{12}\.completed\.json$/);
      if (!entry.isFile() || !match) return [];
      const file = path.join(directory, entry.name);
      const evidence = readJson(file);
      const epoch = Number(match[1]);
      if (
        evidence.protocol !== 'behold.world-recovery-evidence.v1' ||
        evidence.phase !== 'completed' ||
        evidence.world !== input.worldId ||
        evidence.epoch !== epoch ||
        !['abandoned_after_save_ack', 'abandoned_unclean_shutdown'].includes(
          evidence.classification,
        )
      ) {
        throw new Error(`live recovery evidence is malformed: ${file}`);
      }
      return epoch > headEpoch
        ? [
            {
              epoch,
              classification: evidence.classification as
                'abandoned_after_save_ack' | 'abandoned_unclean_shutdown',
              completedEvidence: file,
            },
          ]
        : [];
    })
    .sort((left, right) => right.epoch - left.epoch);
  if (candidates.length === 0) {
    throw new Error('live session has no completed recovery newer than its persistent head');
  }
  if (candidates[1]?.epoch === candidates[0].epoch) {
    throw new Error(
      `live session has ambiguous completed recovery evidence for epoch ${candidates[0].epoch}`,
    );
  }
  return Object.freeze(candidates[0]);
}

function printLiveReady(
  sessionId: string,
  authority: FrozenPlaceServeAuthority,
  run: ManagedWorldRun,
  durationMs: number,
  episodeRoot: string,
  nativePlayer: string | null,
  residentLensEndpoint: string,
) {
  process.stdout.write(`\n[behold live] ${sessionId} is alive for ${durationMs / 1000}s\n`);
  process.stdout.write(
    `[behold live] native Minecraft: ${authority.host}:${authority.port} (${authority.placeIdentity.minecraftVersion})\n`,
  );
  for (const resident of run.residents) {
    process.stdout.write(
      `[behold live] ${resident.entityId} POV: ${resident.viewer?.endpoint ?? 'unavailable'}\n`,
    );
  }
  process.stdout.write(`[behold live] resident lens: ${residentLensEndpoint}\n`);
  process.stdout.write(`[behold live] episode evidence: ${episodeRoot}\n`);
  if (nativePlayer) {
    process.stdout.write(
      nativeHumanJoinInstruction(
        authority.host,
        authority.port,
        authority.placeIdentity.minecraftVersion,
        nativePlayer,
      ),
    );
  }
  process.stdout.write('[behold live] Ctrl-C saves the world and ends this episode.\n\n');
}

export function nativeHumanJoinInstruction(
  host: string,
  port: number,
  minecraftVersion: string,
  username: string,
) {
  return `[behold live] native human ${username}: in Minecraft Java ${minecraftVersion}, open Multiplayer > Direct Connection and join ${host}:${port}\n`;
}

export function liveResumeInstruction(input: {
  releaseRoot: string;
  sessionId: string;
  nativePlayer: string | null;
  placeCompiler:
    | Readonly<{ kind: 'checkout'; root: string }>
    | Readonly<{
        kind: 'binary';
        binary: string;
        version: string;
        distributionSha256: string;
      }>;
}): string {
  const args = ['behold', 'live', input.releaseRoot, '--accept-eula', '--session', input.sessionId];
  if (input.placeCompiler.kind === 'checkout') {
    args.push('--place-compiler', input.placeCompiler.root);
  } else {
    args.push(
      '--place-compiler-bin',
      input.placeCompiler.binary,
      '--place-compiler-version',
      input.placeCompiler.version,
      '--place-compiler-distribution-sha256',
      input.placeCompiler.distributionSha256,
    );
  }
  if (input.nativePlayer) args.push('--native-player', input.nativePlayer);
  return args.map(shellArgument).join(' ');
}

function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function shouldRecordPlaceOnlyCleanup(input: {
  cleanStop: boolean;
  hasAuthority: boolean;
  hadExistingPlan: boolean;
  managedLifecycleObserved: boolean;
  headExists: boolean;
}) {
  return (
    !input.cleanStop &&
    input.hasAuthority &&
    input.hadExistingPlan &&
    !input.managedLifecycleObserved &&
    input.headExists
  );
}

export function createLiveBoundary(
  run: Pick<ManagedWorldRun, 'finished' | 'stopRequested'>,
  durationMs: number,
  signalSource: Pick<NodeJS.Process, 'on' | 'removeListener'> = process,
) {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  let requestStop!: (reason: string) => void;
  const requested = new Promise<string>((resolve) => {
    requestStop = resolve;
  });
  const handlers = new Map<(typeof signals)[number], () => void>();
  for (const signal of signals) {
    const handler = () => requestStop(signal);
    handlers.set(signal, handler);
    signalSource.on(signal, handler);
  }
  const timer = setTimeout(() => requestStop('duration_elapsed'), durationMs);
  const wait = Promise.race([
    requested,
    run.stopRequested,
    run.finished.then(() => {
      throw new Error('a managed resident or server exited before the live boundary');
    }),
  ]).finally(() => clearTimeout(timer));
  return Object.freeze({
    wait,
    request(reason = 'operator_request') {
      requestStop(reason);
    },
    dispose() {
      clearTimeout(timer);
      for (const [signal, handler] of handlers) signalSource.removeListener(signal, handler);
    },
  });
}

function liveSessionPaths(sessionRoot: string) {
  return Object.freeze({
    plan: path.join(sessionRoot, 'session.json'),
    head: path.join(sessionRoot, 'head.json'),
    descriptor: path.join(sessionRoot, 'genesis', 'place-served-world.json'),
    placeRuntime: path.join(sessionRoot, 'place-runtime'),
    episodes: path.join(sessionRoot, 'episodes'),
    control: path.join(sessionRoot, 'control'),
    entities: path.join(sessionRoot, 'entities'),
    runs: path.join(sessionRoot, 'runs'),
    residentRevisions: path.join(sessionRoot, 'resident-revisions'),
  });
}

function liveLifecycleFiles(controlRoot: string, worldId: string) {
  const directory = path.join(controlRoot, sanitizeName(worldId));
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^lifecycle-[0-9]+\.jsonl$/.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function writeLivePlan(
  file: string,
  value: Omit<ReturnType<typeof readLivePlan>, 'protocol' | 'digest'>,
) {
  const base = { protocol: LIVE_SESSION_PROTOCOL, ...value };
  const record = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  writeJsonExclusive(file, record);
  return record;
}

function readLivePlan(file: string) {
  const value = readJson(file);
  const { digest, ...base } = value;
  if (
    value.protocol !== LIVE_SESSION_PROTOCOL ||
    typeof value.sessionId !== 'string' ||
    typeof value.worldId !== 'string' ||
    typeof value.placeCompilerRevision !== 'string' ||
    typeof value.releaseManifestSha256 !== 'string' ||
    typeof value.residentSetSha256 !== 'string' ||
    !Array.isArray(value.residents) ||
    typeof value.accountingScopeId !== 'string' ||
    !value.endpoint ||
    digest !== sha256(stableJson(base))
  ) {
    throw new Error('live session plan is malformed or unauthenticated');
  }
  return deepFreeze(value) as Readonly<{
    protocol: typeof LIVE_SESSION_PROTOCOL;
    sessionId: string;
    worldId: string;
    placeCompilerRevision: string;
    releaseManifestSha256: string;
    residentSetSha256: string;
    residents: ReturnType<typeof loadManagedResidentSet>;
    accountingScopeId: string;
    endpoint: Readonly<{ host: '127.0.0.1' | '::1'; port: number }>;
    createdAt: string;
    digest: string;
  }>;
}

function writeEpisodeRecord(input: {
  file: string;
  sessionId: string;
  episodeId: string;
  startedAt: string;
  completedAt: string;
  run: ManagedWorldRun;
  authority: FrozenPlaceServeAuthority;
  head: any;
  transcriptTipDigest: string | null;
  entityRoot: string;
  ecologyLog: ReturnType<typeof preservePlaceServerLog>;
  accountingScopeId: string;
  nativeHuman: ReturnType<typeof assessNativeHumanEntry> | null;
  residentRevision: ReturnType<typeof readLiveResidentRevision> | null;
}) {
  const episodeRoot = path.dirname(path.resolve(input.file));
  const checkpoint = captureLiveLyncCheckpoint({
    episodeRoot,
    residents: input.run.residents.map((resident) => ({
      entityId: resident.entityId,
      directory: path.join(input.entityRoot, sanitizeName(resident.entityId), 'lync'),
    })),
  });
  const lives = input.run.residents.map((resident, index) => {
    const directory = path.join(input.entityRoot, sanitizeName(resident.entityId), 'lync');
    const captured = checkpoint.lives[index];
    if (captured?.entityId !== resident.entityId) {
      throw new Error('live Lync checkpoint resident order changed');
    }
    return {
      entityId: resident.entityId,
      bodyUsername: resident.bodyUsername,
      profile: captured.profile,
      lyncDirectory: captured.lyncDirectory,
      manifestFile: path.join(directory, 'manifest.json'),
      sourceFiles: captured.sourceFiles,
      runJournalDirectory: resident.journalDirectory,
      runJournalFiles: listFiles(resident.journalDirectory, '.jsonl'),
    };
  });
  const presenterProfiles = [...new Set(lives.map((life) => life.profile))];
  const base = {
    protocol: LIVE_EPISODE_RECORD_V2_PROTOCOL,
    sessionId: input.sessionId,
    episodeId: input.episodeId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    worldId: input.head.worldId,
    terminalWorldDigest: input.head.runtimeDigest,
    accountingScopeId: input.accountingScopeId,
    residentRevision: input.residentRevision,
    experimentRelease: input.run.experimentRelease,
    lifecycle: {
      file: input.run.control.journalFile,
      tipDigest: input.head.lifecycle.tipDigest,
    },
    place: {
      transcriptFile: input.authority.transcriptFile,
      transcriptTipDigest: input.transcriptTipDigest,
      identity: input.authority.identity,
    },
    ecology: {
      authority: 'minecraft_server',
      relation: 'authoritative world event log; resident turns remain separate causal records',
      log: input.ecologyLog,
    },
    cognition: input.run.cognition
      ? {
          journalFile: input.run.cognition.journalFile,
          transportCaptureDirectory: input.run.cognition.transportCaptureDirectory,
          bodyRetention: input.run.cognition.bodyRetention,
          accounting: input.run.cognition.accountingSnapshot(),
        }
      : null,
    viewers: input.run.residents.map((resident) => ({
      entityId: resident.entityId,
      endpoint: resident.viewer?.endpoint ?? null,
      state: 'closed',
      authority: 'operator_only',
    })),
    nativeHuman: input.nativeHuman,
    lives,
    textile: {
      presenterProfile: presenterProfiles.length === 1 ? presenterProfiles[0] : null,
      presenterProfiles,
      import:
        'ordered immutable prefixes of canonical Lync sources; external readers may materialize them without Behold rewriting history',
      artifact: checkpoint.artifact,
    },
  };
  const record = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  publishLiveCheckpointJson(input.file, record);
  return Object.freeze({ file: input.file, record });
}

export function assessNativeHumanEntry(input: {
  declaredPlayer: string;
  endpoint: Readonly<{ host: string; port: number }>;
  ecologyLogFile: string;
  residents: ReadonlyArray<
    Readonly<{ entityId: string; bodyUsername: string; journalDirectory: string }>
  >;
}) {
  const declaredPlayer = minecraftUsername(input.declaredPlayer, 'declared native player');
  if (
    input.residents.some(
      (resident) => resident.bodyUsername.toLowerCase() === declaredPlayer.toLowerCase(),
    )
  ) {
    throw new Error('declared native player collides with a managed resident body');
  }
  const serverJoins = fs
    .readFileSync(plainFile(input.ecologyLogFile, 'native-human ecology log'), 'utf8')
    .split(/\r?\n/)
    .flatMap((text, index) => {
      const match = text.match(
        /^\[([^\]]+)\] \[Server thread\/INFO\]: ([A-Za-z0-9_]{1,16}) joined the game$/,
      );
      return match?.[2]?.toLowerCase() === declaredPlayer.toLowerCase()
        ? [{ line: index + 1, serverTime: match[1] }]
        : [];
    });
  const residentWitnesses = input.residents.map((resident) => {
    const events = listFiles(resident.journalDirectory, '.jsonl').flatMap((source) =>
      fs
        .readFileSync(plainFile(source.file, `${resident.entityId} run journal`), 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter(
          (event) =>
            event?.type === 'external_player_intervention' &&
            event?.data?.protocol === 'behold.external-player-intervention.v1' &&
            event?.data?.kind === 'joined' &&
            event?.data?.classification === 'native_human_or_unmanaged_player' &&
            typeof event?.data?.username === 'string' &&
            event.data.username.toLowerCase() === declaredPlayer.toLowerCase(),
        )
        .map((event) => ({
          file: source.file,
          sequence: event.sequence,
          at: event.at,
          classification: event.data.classification,
        })),
    );
    return Object.freeze({
      entityId: resident.entityId,
      bodyUsername: resident.bodyUsername,
      observed: events.length > 0,
      events,
    });
  });
  const assertions = {
    authoritativeServerJoin: serverJoins.length > 0,
    witnessedByEveryResident: residentWitnesses.every((resident) => resident.observed),
  };
  return deepFreeze({
    protocol: LIVE_NATIVE_HUMAN_PROTOCOL,
    declaredPlayer,
    classification: 'operator_declared_native_human',
    endpoint: { host: input.endpoint.host, port: input.endpoint.port },
    entry: {
      client: 'minecraft_java',
      method: 'multiplayer_direct_connection',
      address: `${input.endpoint.host}:${input.endpoint.port}`,
    },
    evidence: {
      ecologyLogFile: path.resolve(input.ecologyLogFile),
      serverJoins,
      residentWitnesses,
    },
    assessment: {
      assertions,
      passed: Object.values(assertions).every(Boolean),
    },
  });
}

export function preserveResidentLyncFiles(input: {
  entityId: string;
  directory: string;
  destinationRoot: string;
}) {
  const sources = listLyncFiles(input.directory);
  if (sources.length === 0) {
    throw new Error(`live episode record requires a Lync source for ${input.entityId}`);
  }
  const residentRoot = path.join(path.resolve(input.destinationRoot), sanitizeName(input.entityId));
  fs.mkdirSync(residentRoot, { recursive: true, mode: 0o700 });
  return Object.freeze(
    sources.map((source) => {
      const sourceFile = plainFile(source.file, `${input.entityId} Lync source`);
      const file = path.join(residentRoot, path.basename(sourceFile));
      fs.copyFileSync(sourceFile, file, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(file, 0o600);
      syncFile(file);
      const preservedSha256 = sha256File(file);
      if (preservedSha256 !== source.sha256 || fs.statSync(file).size !== source.sizeBytes) {
        throw new Error(`preserved Lync source differs for ${input.entityId}`);
      }
      return Object.freeze({
        protocol: LIVE_LYNC_SNAPSHOT_PROTOCOL,
        sourceFile,
        file,
        sha256: preservedSha256,
        sizeBytes: source.sizeBytes,
        presentationProfile: readResidentLyncPresentationProfile(sourceFile, input.entityId),
        preservation: 'byte_identical_episode_snapshot' as const,
      });
    }),
  );
}

export function readResidentLyncPresentationProfile(file: string, entityId: string) {
  const root = JSON.parse(fs.readFileSync(file, 'utf8').split('\n').find(Boolean) || 'null');
  const meta = root?.kind === 'lync/loom' ? root?.payload?.meta : null;
  if (
    meta?.protocol !== 'behold.entity-loom.v1' ||
    meta?.entityId !== entityId ||
    !['org.behold.inhabitant.v1', 'org.behold.inhabitant.v2'].includes(meta?.profile)
  ) {
    throw new Error(`Lync source does not declare a supported resident presentation profile`);
  }
  return meta.profile as 'org.behold.inhabitant.v1' | 'org.behold.inhabitant.v2';
}

export function preserveTextileImport(input: {
  sourceFiles: ReadonlyArray<Readonly<{ file: string; sha256: string; sizeBytes: number }>>;
  destination: string;
}) {
  if (input.sourceFiles.length === 0) {
    throw new Error('Textile import requires at least one preserved Lync source');
  }
  const file = path.resolve(input.destination);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    for (const source of input.sourceFiles) {
      const sourceFile = plainFile(source.file, 'preserved Textile Lync source');
      if (
        sha256File(sourceFile) !== source.sha256 ||
        fs.statSync(sourceFile).size !== source.sizeBytes
      ) {
        throw new Error('preserved Textile Lync source changed before union');
      }
      appendFileToDescriptor(sourceFile, descriptor);
    }
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  const expectedSize = input.sourceFiles.reduce((sum, source) => sum + source.sizeBytes, 0);
  const sizeBytes = fs.statSync(file).size;
  if (sizeBytes !== expectedSize) throw new Error('Textile Lync union has the wrong byte count');
  return deepFreeze({
    protocol: LIVE_TEXTILE_IMPORT_PROTOCOL,
    file,
    sha256: sha256File(file),
    sizeBytes,
    sourceCount: input.sourceFiles.length,
    sourceSha256: input.sourceFiles.map((source) => source.sha256),
    construction: 'ordered_byte_concatenation',
  });
}

function appendFileToDescriptor(sourceFile: string, destination: number) {
  const source = fs.openSync(sourceFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(source, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      let offset = 0;
      while (offset < bytesRead) {
        offset += fs.writeSync(destination, buffer, offset, bytesRead - offset);
      }
    }
  } finally {
    fs.closeSync(source);
  }
}

function listLyncFiles(directory: string) {
  return listFiles(directory, '.lync');
}

function listFiles(directory: string, suffix: string) {
  if (!fs.existsSync(directory)) return Object.freeze([]);
  return Object.freeze(
    fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => {
        const file = path.join(directory, entry.name);
        return Object.freeze({ file, sha256: sha256File(file), sizeBytes: fs.statSync(file).size });
      })
      .sort((left, right) => left.file.localeCompare(right.file)),
  );
}

export function listPlaceServerLogs(runtimeRootValue: string) {
  const logRoot = path.join(path.resolve(runtimeRootValue), 'logs');
  if (!fs.existsSync(logRoot)) return Object.freeze([] as string[]);
  const stats = fs.lstatSync(logRoot);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Place server log root must be a plain directory');
  }
  return Object.freeze(
    fs
      .readdirSync(logRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^server-[0-9]{8}T[0-9]{6}Z\.log$/.test(entry.name))
      .map((entry) => path.join(logRoot, entry.name))
      .sort(),
  );
}

export function preservePlaceServerLog(input: {
  runtimeRoot: string;
  filesBefore: ReadonlySet<string>;
  destination: string;
}) {
  const added = listPlaceServerLogs(input.runtimeRoot).filter(
    (file) => !input.filesBefore.has(file),
  );
  if (added.length !== 1) {
    throw new Error(
      `live episode requires exactly one new Place server log; found ${added.length}`,
    );
  }
  const sourceFile = plainFile(added[0], 'Place server log');
  const file = path.resolve(input.destination);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.copyFileSync(sourceFile, file, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(file, 0o600);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  const sourceSha256 = sha256File(sourceFile);
  const preservedSha256 = sha256File(file);
  if (sourceSha256 !== preservedSha256) {
    throw new Error('preserved Place server log differs from its authoritative source');
  }
  return deepFreeze({
    protocol: LIVE_ECOLOGY_LOG_PROTOCOL,
    sourceFile,
    file,
    sha256: preservedSha256,
    sizeBytes: fs.statSync(file).size,
    preservation: 'byte_identical_episode_snapshot',
  });
}

function nextEpisodeId(episodesRoot: string) {
  const ordinal =
    Math.max(
      0,
      ...fs
        .readdirSync(episodesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^[0-9]{6}$/.test(entry.name))
        .map((entry) => Number(entry.name)),
    ) + 1;
  return String(ordinal).padStart(6, '0');
}

export function liveEpisodeAccountingScope(sessionScopeId: string, episodeId: string) {
  const scope = typeof sessionScopeId === 'string' ? sessionScopeId.trim() : '';
  if (!scope || scope.length > 512 || /[\r\n\0]/.test(scope)) {
    throw new Error('live session accounting namespace is invalid');
  }
  if (!/^[0-9]{6}$/.test(episodeId)) {
    throw new Error('live episode accounting scope requires a six-digit episode id');
  }
  return `${scope}:episode:${episodeId}`;
}

export function selectLiveResidentConfiguration(input: {
  requestedResidents: ReturnType<typeof loadManagedResidentSet> | null;
  current: ReturnType<typeof latestLiveResidentRevision> | null;
  changeMinds: boolean;
  recover: boolean;
}) {
  if (!input.current) {
    if (!input.requestedResidents) {
      throw new Error('a new live session requires --residents FILE');
    }
    if (input.changeMinds) {
      throw new Error('live --change-minds requires an existing persistent session');
    }
    return Object.freeze({
      residents: input.requestedResidents,
      residentRevision: null,
      writeRevision: false,
    });
  }
  if (!input.requestedResidents) {
    if (input.changeMinds) {
      throw new Error('live --change-minds requires --residents FILE');
    }
    return Object.freeze({
      residents: input.current.residents,
      residentRevision: input.current.revision,
      writeRevision: false,
    });
  }
  if (stableJson(input.current.residents) === stableJson(input.requestedResidents)) {
    return Object.freeze({
      residents: input.current.residents,
      residentRevision: input.current.revision,
      writeRevision: false,
    });
  }
  if (input.recover) {
    throw new Error("live --recover requires the session's current resident configuration");
  }
  if (!input.changeMinds) {
    throw new Error(
      'live resident minds differ from the persistent session; repeat with --change-minds for an explicit mind-only revision',
    );
  }
  assertLiveMindRevisionCompatible(input.current.residents, input.requestedResidents);
  return Object.freeze({
    residents: input.requestedResidents,
    residentRevision: null,
    writeRevision: true,
  });
}

export function assertLiveMindRevisionCompatible(
  previous: readonly Record<string, any>[],
  next: readonly Record<string, any>[],
) {
  if (
    stableJson(previous.map(liveResidentContinuityIdentity)) !==
    stableJson(next.map(liveResidentContinuityIdentity))
  ) {
    throw new Error(
      'live --change-minds may change only model, mind transport, urgent model, urgent decision timeout, and provider quotas; resident identity, body, charter, cadence, and steering must remain unchanged',
    );
  }
}

function liveResidentContinuityIdentity(resident: Record<string, any>) {
  const {
    model: _model,
    urgentModel: _urgentModel,
    urgentDecisionTimeoutMs: _urgentDecisionTimeoutMs,
    mind: _mind,
    providerQuotas: _providerQuotas,
    providerRoute: _providerRoute,
    ollamaLocal: _ollamaLocal,
    lmStudioLocal: _lmStudioLocal,
    ...continuity
  } = resident;
  return continuity;
}

function latestLiveResidentRevision(directory: string, plan: ReturnType<typeof readLivePlan>) {
  const files = fs.existsSync(directory)
    ? fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^[0-9]{6}\.json$/.test(entry.name))
        .map((entry) => path.join(directory, entry.name))
        .sort()
    : [];
  let residents: ReturnType<typeof loadManagedResidentSet> = plan.residents;
  let digest = plan.residentSetSha256;
  let revision: ReturnType<typeof readLiveResidentRevision> | null = null;
  for (const file of files) {
    const next = readLiveResidentRevision(file);
    if (next.sessionId !== plan.sessionId || next.previousDigest !== digest) {
      throw new Error('live resident revision chain is not continuous with this session');
    }
    assertLiveMindRevisionCompatible(residents, next.residents);
    residents = next.residents;
    digest = next.digest;
    revision = next;
  }
  return {
    residents,
    digest,
    revision,
  };
}

function writeLiveResidentRevision(input: {
  directory: string;
  sessionId: string;
  previousDigest: string;
  residents: ReturnType<typeof loadManagedResidentSet>;
}) {
  fs.mkdirSync(input.directory, { recursive: true, mode: 0o700 });
  const ordinal =
    Math.max(
      0,
      ...fs
        .readdirSync(input.directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^[0-9]{6}\.json$/.test(entry.name))
        .map((entry) => Number(entry.name.slice(0, 6))),
    ) + 1;
  const sequence = String(ordinal).padStart(6, '0');
  const residentSetSha256 = sha256(stableJson(input.residents));
  const base = {
    protocol: LIVE_RESIDENT_REVISION_PROTOCOL,
    sequence,
    sessionId: input.sessionId,
    changedAt: new Date().toISOString(),
    previousDigest: input.previousDigest,
    residentSetSha256,
    residents: input.residents,
  };
  const revision = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  writeJsonExclusive(path.join(input.directory, `${sequence}.json`), revision);
  return revision;
}

function readLiveResidentRevision(file: string) {
  const value = readJson(file);
  const { digest, ...base } = value;
  if (
    value.protocol !== LIVE_RESIDENT_REVISION_PROTOCOL ||
    !/^[0-9]{6}$/.test(value.sequence) ||
    typeof value.sessionId !== 'string' ||
    typeof value.changedAt !== 'string' ||
    typeof value.previousDigest !== 'string' ||
    typeof value.residentSetSha256 !== 'string' ||
    !Array.isArray(value.residents) ||
    value.residentSetSha256 !== sha256(stableJson(value.residents)) ||
    digest !== sha256(stableJson(base))
  ) {
    throw new Error('live resident revision is malformed or unauthenticated');
  }
  return deepFreeze(value) as Readonly<{
    protocol: typeof LIVE_RESIDENT_REVISION_PROTOCOL;
    sequence: string;
    sessionId: string;
    changedAt: string;
    previousDigest: string;
    residentSetSha256: string;
    residents: ReturnType<typeof loadManagedResidentSet>;
    digest: string;
  }>;
}

function findRepositoryRoot() {
  const candidates = [process.cwd(), path.resolve(__dirname, '..', '..', '..')];
  for (const candidate of candidates) {
    try {
      const manifest = readJson(path.join(candidate, 'package.json'));
      if (manifest.name === 'behold') return fs.realpathSync.native(candidate);
    } catch {}
  }
  throw new Error('behold live must run from a built Behold checkout');
}

function assertCleanCheckout(root: string, label: string) {
  const revision = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const status = spawnSync(
    'git',
    ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all'],
    { encoding: 'utf8' },
  );
  if (revision.status !== 0 || status.status !== 0 || status.stdout.length > 0) {
    throw new Error(`${label} live entry requires a clean recorded checkout`);
  }
  return revision.stdout.trim();
}

function optionalInteger(value: unknown, option: string, minimum: number, maximum: number) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${option} must be an integer from ${minimum} through ${maximum}`);
  }
  return number;
}

function safeSegment(value: unknown, label: string) {
  const segment = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(segment)) {
    throw new Error(`${label} must be a safe bounded identifier`);
  }
  return segment;
}

function minecraftUsername(value: unknown, label: string) {
  const username = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
    throw new Error(`${label} must be a valid offline Minecraft username`);
  }
  return username;
}

function requiredCliText(value: unknown, option: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${option} is required with --place-compiler-bin`);
  return text;
}

function exactSha256(value: unknown, option: string) {
  const digest = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${option} must be an exact SHA-256`);
  }
  return digest;
}

function executableFile(value: string, label: string) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stats = fs.statSync(resolved);
  if (!stats.isFile()) throw new Error(`${label} must resolve to a regular file`);
  fs.accessSync(resolved, fs.constants.R_OK | fs.constants.X_OK);
  return resolved;
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

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(plainFile(file, 'JSON file'), 'utf8'));
}

function writeJsonExclusive(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function syncFile(file: string) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function sha256File(file: string) {
  return createHash('sha256')
    .update(fs.readFileSync(plainFile(file, 'digest input')))
    .digest('hex');
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

export function liveUsage() {
  return [
    'Usage:',
    '  behold live RELEASE --accept-eula [--residents FILE] [options]',
    '',
    'Runs or resumes one persistent Place world with independently configured residents.',
    '',
    'Options:',
    '  --residents FILE               Required for a new session or --change-minds',
    '  --duration SECONDS              Live time after all residents are ready (default 300)',
    '  --session ID                   Stable session name; the exact repeat resumes it',
    '  --state DIRECTORY              Parent for persistent world/lives/history',
    '  --port PORT                    Loopback Minecraft port (default 25565)',
    '  --viewer-base-port PORT        First resident POV (default 3007)',
    '  --viewer-distance CHUNKS       POV view distance, 2-16 (default 6)',
    '  --place-compiler DIRECTORY     Exact Place Compiler checkout',
    '  --place-compiler-bin FILE      Installed Place Compiler executable',
    '  --place-compiler-version VER   Exact installed package version',
    '  --place-compiler-distribution-sha256 SHA256',
    '                                 Exact installed distribution identity',
    '  --server-jar FILE              Pinned server JAR (default Behold managed artifact)',
    '  --max-model-concurrency N      Concurrent local cognition (default min(2, residents))',
    '  --lmstudio-models-root DIR     Exact local LM Studio artifact root',
    '  --native-player USERNAME       Check one username in post-episode join observations',
    '  --world-history-receipt FILE    Verified stopped-world fork for a fresh session',
    '  --history ID                    One unused child in that receipt for a fresh session',
    '  --change-minds                 Explicitly revise only model/mind transport for the same lives',
    '  --recover                      Release an exact abandoned stopped epoch without starting Place',
    '',
    'Residents keep their declared human-semantic body, charter, model transport, and durable',
    'attempt ceilings. The ceiling is safety/resource governance, not a fairness claim.',
  ].join('\n');
}

export function selectLiveHistorySeed(input: {
  receipt: unknown;
  history: unknown;
  sessionEntry: ReturnType<typeof classifyLiveSessionEntry>;
}) {
  const receipt = typeof input.receipt === 'string' && input.receipt.trim() ? input.receipt : null;
  const history = typeof input.history === 'string' && input.history.trim() ? input.history : null;
  if ((receipt == null) !== (history == null)) {
    throw new Error('--world-history-receipt and --history must be supplied together');
  }
  if (!receipt) return null;
  if (input.sessionEntry !== 'new') {
    throw new Error('world-history selection is allowed only for a fresh live session');
  }
  return Object.freeze({ receipt: path.resolve(receipt), history });
}
