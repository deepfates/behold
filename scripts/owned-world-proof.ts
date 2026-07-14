#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { digestTree } from './world-lab';
import { startManagedWorld } from './world-runner';
import {
  OWNED_LEVEL_SEED as LEVEL_SEED,
  OWNED_TARGET as TARGET,
  OWNED_WORLD_ID as WORLD_ID,
  durableWriteJson,
  gitRevision,
  listFiles,
  prepareOwnedWorld,
  readJson,
  restoreEnvironment,
  sha256File,
  waitFor,
} from './owned-world-fixture';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';

const PROTOCOL = 'behold.owned-world-proof.v1' as const;
const ENTITY_ID = 'ProofResident';
const OBSERVATION_LATENCY_BUDGET_MS = 50;
const OCCLUSION_WALL = Object.freeze(
  [-4, -3, -2, -1].flatMap((x) =>
    [-60, -59].map((y) => Object.freeze({ x, y, z: 3, block: 'stone' })),
  ),
);

async function main() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: 'string' },
      port: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help) {
    process.stdout.write(
      'Usage: owned-world-proof [--run <safe-id>] [--port <unused-loopback-port>]\n',
    );
    return;
  }
  const requestedRunId = String(
    parsed.values.run || `run-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const port = Number(parsed.values.port || 25575);
  const fixture = await prepareOwnedWorld(
    requestedRunId,
    port,
    'owned-world',
    TARGET,
    [],
    OCCLUSION_WALL,
  );
  const {
    runId,
    repository,
    root,
    serverDirectory,
    runtime,
    entityRoot,
    controlRoot,
    evidenceRoot,
    toolLock,
    serverJar,
    expectedServerJarSha256,
    actualServerJarSha256,
    java,
    startedAt,
    generation,
    sourceTree,
    baselineTree,
    initialRuntimeTree,
    world,
  } = fixture;

  const transcript: string[] = [];
  const runPhase = async (phase: 'act' | 'resume') => {
    const proofFile = path.join(evidenceRoot, `${phase}.json`);
    const previous = {
      phase: process.env.BEHOLD_PROOF_PHASE,
      file: process.env.BEHOLD_PROOF_FILE,
    };
    process.env.BEHOLD_PROOF_PHASE = phase;
    process.env.BEHOLD_PROOF_FILE = proofFile;
    let run: Awaited<ReturnType<typeof startManagedWorld>> | null = null;
    try {
      run = await startManagedWorld(
        {
          worldId: WORLD_ID,
          world,
          controlRoot,
          serverDirectory,
          serverJar,
          expectedServerJarSha256,
          java,
          controllerEntry: path.resolve('dist/scripts/owned-world-inhabitant.js'),
          entityRoot,
          runRoot: path.join(evidenceRoot, 'runs'),
          residents: [
            {
              entityId: ENTITY_ID,
              model: 'script/behold-owned-world-proof-v1',
              task: 'owned-world-continuity-proof',
              allowTools: ['move_to', 'approach_entity', 'collect_nearby_item', 'status'],
            },
          ],
          startupTimeoutMs: 90_000,
          shutdownTimeoutMs: 90_000,
        },
        {
          stdout: (text) => {
            transcript.push(text);
            process.stdout.write(text);
          },
          stderr: (text) => {
            transcript.push(text);
            process.stderr.write(text);
          },
        },
      );
      const proofWait = new AbortController();
      try {
        await Promise.race([
          waitForFile(proofFile, 90_000, proofWait.signal),
          run.finished.then(() => {
            throw new Error(`${phase} controller exited before proof completion`);
          }),
        ]);
      } finally {
        proofWait.abort();
      }
      const proof = readJson(proofFile);
      validateInhabitantProof(proof, phase, run.runId);
      await run.stop(`owned_world_${phase}_complete`);
      await run.finished;
      const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
      return {
        proofFile,
        proofSha256: sha256File(proofFile),
        proof,
        managedRunId: run.runId,
        lifecycleFile: run.control.journalFile,
        lifecycleTipDigest: lifecycle.tipDigest,
        lifecycleEvents: lifecycle.events.length,
      };
    } catch (error) {
      if (run) await run.stop(`owned_world_${phase}_failed`).catch(() => {});
      throw error;
    } finally {
      restoreEnvironment('BEHOLD_PROOF_PHASE', previous.phase);
      restoreEnvironment('BEHOLD_PROOF_FILE', previous.file);
    }
  };

  process.stdout.write('[owned-world] running first embodied life\n');
  const act = await runPhase('act');
  const afterActTree = digestTree(runtime);
  process.stdout.write('[owned-world] restarting the same inhabitant\n');
  const resume = await runPhase('resume');
  const afterResumeTree = digestTree(runtime);

  const loomFiles = listFiles(path.join(entityRoot, ENTITY_ID, 'lync')).filter((file) =>
    file.endsWith('.lync'),
  );
  if (loomFiles.length !== 1)
    throw new Error(`expected one authoritative Lync log, found ${loomFiles.length}`);
  const assertions = {
    initialAffordanceObserved:
      act.proof.initialDroppedItems?.filter((item: any) => item?.name === TARGET.item).length ===
        1 &&
      act.proof.initialObservation?.scene?.entities?.some(
        (entity: any) => entity?.kind === 'item' && entity?.name === TARGET.item,
      ),
    observationProtocolV2:
      act.proof.initialObservation?.protocol === 'behold.inhabitant.v2' &&
      resume.proof.initialObservation?.protocol === 'behold.inhabitant.v2' &&
      act.proof.initialObservation?.scene?.terrain?.source === 'vision' &&
      act.proof.initialObservation?.scene?.terrain?.raysCast === 45,
    inhabitantSurfaceHasNoLoadedWorldScans: [
      'find_blocks',
      'inspect_volume',
      'inspect_reachable_space',
      'nearest_entity',
      'get_nearby',
      'survey_area',
    ].every((tool) => !act.proof.inhabitantActions?.includes(tool)),
    locomotionBudgetOwnedByBody:
      act.proof.locomotion?.result?.ok === true &&
      act.proof.locomotion?.result?.status === 'advanced_toward' &&
      act.proof.locomotion?.result?.bodyLegLimit === 6 &&
      act.proof.locomotion?.result?.arrivedAtRequestedDestination === false &&
      Object.keys(act.proof.locomotion?.action?.input || {})
        .sort()
        .join(',') === 'x,y,z',
    exactMovingEntityApproachConfirmed:
      act.proof.approach?.turn?.result?.ok === true &&
      act.proof.approach?.turn?.result?.target === 'player:ProofWitness' &&
      act.proof.approach?.turn?.result?.confirmation === 'mineflayer:body_target_proximity' &&
      act.proof.approach?.turn?.result?.pathfinderStopAcknowledged === true &&
      positionDistance(
        act.proof.approach?.witnessStartedAt,
        act.proof.approach?.witnessFinishedAt,
      ) >= 3 &&
      act.proof.approach?.turn?.result?.finalDistance <=
        act.proof.approach?.turn?.result?.bodyStopDistance + 0.75 &&
      Object.keys(act.proof.approach?.turn?.action?.input || {}).join(',') === 'target',
    occludedEntityTrackedButNotPerceived:
      act.proof.approach?.hidden?.rawTracked === true &&
      act.proof.approach?.hidden?.observation?.scene?.social?.playersOnline?.includes(
        'ProofWitness',
      ) &&
      !act.proof.approach?.hidden?.observation?.scene?.entities?.some(
        (entity: any) => entity?.id === 'player:ProofWitness',
      ) &&
      act.proof.approach?.hidden?.eventsNamingTarget === 0,
    occludedTargetDeniedBeforeMotion:
      act.proof.approach?.hidden?.turn?.result?.ok === false &&
      act.proof.approach?.hidden?.turn?.result?.error === 'target_not_perceived' &&
      positionDistance(
        act.proof.approach?.hidden?.residentBefore,
        act.proof.approach?.hidden?.residentAfter,
      ) < 0.1,
    visibleEntityEarnedExactTarget: act.proof.approach?.visibleObservation?.scene?.entities?.some(
      (entity: any) =>
        entity?.id === 'player:ProofWitness' &&
        entity?.source === 'vision' &&
        entity?.visibility === 'visible',
    ),
    boundedObservationLatency:
      act.proof.approach?.observationPerformance?.samples === 20 &&
      act.proof.approach?.observationPerformance?.raysPerObservation === 45 &&
      act.proof.approach?.observationPerformance?.p95Ms <= OBSERVATION_LATENCY_BUDGET_MS,
    collectionConfirmedByMinecraft:
      act.proof.collection?.result?.ok === true &&
      act.proof.collection?.result?.item === TARGET.item &&
      act.proof.collection?.result?.confirmation === 'mineflayer:playerCollect' &&
      /^entity:\d+$/.test(String(act.proof.collection?.result?.target || '')) &&
      act.proof.collection?.result?.targetAtStart?.distance > 0 &&
      Object.keys(act.proof.collection?.action?.input || {}).join(',') === 'target',
    independentConsequenceObserved:
      act.proof.independentWitness?.source === 'fresh_minecraft_connection' &&
      !act.proof.independentWitness?.droppedItems?.some((item: any) => item?.name === TARGET.item),
    inhabitantBoundToManagedIdentity:
      act.proof.circleId === WORLD_ID &&
      act.proof.runId === act.managedRunId &&
      act.proof.initialObservation?.circle?.id === WORLD_ID &&
      act.proof.initialObservation?.circle?.managedRunId === act.managedRunId &&
      resume.proof.circleId === WORLD_ID &&
      resume.proof.runId === resume.managedRunId &&
      resume.proof.initialObservation?.circle?.id === WORLD_ID &&
      resume.proof.initialObservation?.circle?.managedRunId === resume.managedRunId,
    independentWitnessBoundToActEpoch:
      act.proof.independentWitness?.worldId === WORLD_ID &&
      act.proof.independentWitness?.managedRunId === act.managedRunId,
    managedEpochAdvancedOnRestart:
      act.managedRunId !== resume.managedRunId &&
      act.managedRunId.startsWith(`${WORLD_ID}-`) &&
      resume.managedRunId.startsWith(`${WORLD_ID}-`),
    firstLifePersistedFourTurns: act.proof.resultingTurns === 4,
    restartLoadedPriorLife: resume.proof.priorTurns === 4,
    consequencePersistedAcrossRestart:
      resume.proof.initialObservation?.self?.inventory?.some(
        (item: any) => item?.name === TARGET.item && item?.count === TARGET.count,
      ) && !resume.proof.initialDroppedItems?.some((item: any) => item?.name === TARGET.item),
    restartDidNotRepeatCollection: resume.proof.collectionAttempts === 0,
    restartExtendedSameLoom: resume.proof.resultingTurns === 5,
    lifecycleOwnedBothRuns: act.lifecycleEvents > 0 && resume.lifecycleEvents > 0,
  };
  const failed = Object.entries(assertions)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (failed.length) throw new Error(`owned-world assertions failed: ${failed.join(', ')}`);

  fs.writeFileSync(path.join(evidenceRoot, 'managed-transcript.log'), transcript.join(''), 'utf8');
  const reportFile = path.join(evidenceRoot, 'report.json');
  durableWriteJson(reportFile, {
    protocol: PROTOCOL,
    runId,
    worldId: WORLD_ID,
    entityId: ENTITY_ID,
    startedAt,
    completedAt: new Date().toISOString(),
    repository: {
      revision: gitRevision(),
      path: repository,
    },
    server: {
      version: String(toolLock.tools.minecraftServer.version),
      jar: serverJar,
      sha256: actualServerJarSha256,
      java,
      port,
      generation,
      seed: LEVEL_SEED,
    },
    target: TARGET,
    budgets: {
      visualTerrainRaysPerObservation: 45,
      observationP95Ms: OBSERVATION_LATENCY_BUDGET_MS,
      modelCalls: 0,
      modelCostUsd: 0,
    },
    artifacts: {
      root,
      sourceTree,
      baselineTree,
      initialRuntimeTree,
      afterActTree,
      afterResumeTree,
      loomFile: loomFiles[0],
      loomSha256: sha256File(loomFiles[0]),
      act: {
        managedRunId: act.managedRunId,
        proofFile: act.proofFile,
        proofSha256: act.proofSha256,
        lifecycleFile: act.lifecycleFile,
        lifecycleTipDigest: act.lifecycleTipDigest,
      },
      resume: {
        managedRunId: resume.managedRunId,
        proofFile: resume.proofFile,
        proofSha256: resume.proofSha256,
        lifecycleFile: resume.lifecycleFile,
        lifecycleTipDigest: resume.lifecycleTipDigest,
      },
    },
    assertions,
  });
  process.stdout.write(`[owned-world] PASS ${reportFile}\n`);
}

function validateInhabitantProof(value: any, phase: 'act' | 'resume', managedRunId: string) {
  if (
    value?.protocol !== 'behold.owned-world-inhabitant-proof.v1' ||
    value?.phase !== phase ||
    value?.entityId !== ENTITY_ID ||
    value?.circleId !== WORLD_ID ||
    value?.runId !== managedRunId ||
    value?.initialObservation?.circle?.id !== WORLD_ID ||
    value?.initialObservation?.circle?.managedRunId !== managedRunId ||
    !Array.isArray(value?.engineEvents)
  ) {
    throw new Error(`invalid ${phase} inhabitant proof`);
  }
}

function waitForFile(file: string, timeoutMs: number, signal?: AbortSignal) {
  return waitFor(() => fs.existsSync(file), timeoutMs, `proof file ${file}`, signal);
}

function positionDistance(before: any, after: any) {
  if (!before || !after) return 0;
  return Math.hypot(
    Number(after.x) - Number(before.x),
    Number(after.y) - Number(before.y),
    Number(after.z) - Number(before.z),
  );
}

void main().catch((error) => {
  process.stderr.write(`[owned-world] ${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
