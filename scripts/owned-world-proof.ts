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
  const fixture = await prepareOwnedWorld(requestedRunId, port);
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
          controllerEntityId: ENTITY_ID,
          controllerLeasePath: path.join(entityRoot, ENTITY_ID, 'runtime.lock'),
          model: 'script/behold-owned-world-proof-v1',
          task: 'owned-world-continuity-proof',
          allowTools: ['collect_nearby_item', 'inspect_volume'],
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
      act.proof.initialDroppedItems?.filter((item: any) => item?.name === TARGET.item).length === 1,
    collectionConfirmedByMinecraft:
      act.proof.collection?.result?.ok === true &&
      act.proof.collection?.result?.item === TARGET.item &&
      act.proof.collection?.result?.confirmation === 'mineflayer:playerCollect',
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
    firstLifePersistedOneTurn: act.proof.resultingTurns === 1,
    restartLoadedPriorLife: resume.proof.priorTurns === 1,
    consequencePersistedAcrossRestart:
      resume.proof.initialObservation?.self?.inventory?.some(
        (item: any) => item?.name === TARGET.item && item?.count === TARGET.count,
      ) && !resume.proof.initialDroppedItems?.some((item: any) => item?.name === TARGET.item),
    restartDidNotRepeatCollection: resume.proof.collectionAttempts === 0,
    restartExtendedSameLoom: resume.proof.resultingTurns === 2,
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

void main().catch((error) => {
  process.stderr.write(`[owned-world] ${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
