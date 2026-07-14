import fs from 'node:fs';
import path from 'node:path';
import { openEntityLoom, type EntityTurn } from '../src/entity/loom';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import type { RunJournalEvent } from './owned-world-model-evidence';
import {
  readRunJournal,
  waitForRunJournal,
  type OwnedWorldFixture,
} from './owned-world-model-harness';
import {
  OWNED_WORLD_ID,
  durableWriteJson,
  restoreEnvironment,
  sha256File,
  waitFor,
} from './owned-world-fixture';
import { startManagedWorld, type ManagedResidentSpec, type ManagedWorldRun } from './world-runner';

export type PopulationPhase<IndependentWitness = unknown, BodyWitness = unknown> = Readonly<{
  managedRunId: string;
  durationMs: number;
  journals: ReadonlyMap<string, Readonly<{ file: string; events: readonly RunJournalEvent[] }>>;
  lifecycleFile: string;
  lifecycleSha256: string;
  lifecycleTipDigest: string | null;
  lifecycleEvents: ReturnType<typeof verifyWorldLifecycleJournal>['events'];
  independentWitness: IndependentWitness | null;
  bodyWitnesses: ReadonlyMap<string, BodyWitness>;
}>;

export type PopulationTrajectory = Readonly<{
  turns: readonly EntityTurn[];
  loomFile: string;
  trajectoryFile: string;
}>;

export async function runPopulationPhase<
  IndependentWitness = unknown,
  BodyWitness = unknown,
>(input: {
  phase: string;
  runLabel: string;
  fixture: OwnedWorldFixture;
  residents: readonly ManagedResidentSpec[];
  maxResidents: number;
  timeoutMs: number;
  transcript: string[];
  milestoneLabel: string;
  milestone: (resident: ManagedResidentSpec, events: readonly RunJournalEvent[]) => boolean;
  witnesses?: (context: { run: ManagedWorldRun }) => Promise<
    Readonly<{
      independentWitness?: IndependentWitness | null;
      bodyWitnesses?: ReadonlyMap<string, BodyWitness>;
    }>
  >;
}): Promise<PopulationPhase<IndependentWitness, BodyWitness>> {
  const startedAt = Date.now();
  const safePhase = input.phase.replace(/[^A-Za-z0-9_-]+/g, '-');
  const safeLabel = input.runLabel.replace(/[^A-Za-z0-9_-]+/g, '-');
  const runRoot = path.join(input.fixture.evidenceRoot, `${safePhase}-${safeLabel}`);
  fs.mkdirSync(runRoot, { recursive: true });
  const previousRecordModelIo = process.env.BEHOLD_RECORD_MODEL_IO;
  process.env.BEHOLD_RECORD_MODEL_IO = '1';
  let run: ManagedWorldRun | null = null;
  try {
    run = await startManagedWorld(
      {
        worldId: OWNED_WORLD_ID,
        world: input.fixture.world,
        controlRoot: input.fixture.controlRoot,
        serverDirectory: input.fixture.serverDirectory,
        serverJar: input.fixture.serverJar,
        expectedServerJarSha256: input.fixture.expectedServerJarSha256,
        java: input.fixture.java,
        controllerEntry: path.resolve('dist/src/cli/behold.js'),
        entityRoot: input.fixture.entityRoot,
        runRoot,
        residents: input.residents,
        maxResidents: input.maxResidents,
        startupTimeoutMs: 90_000,
        shutdownTimeoutMs: 90_000,
      },
      {
        stdout: (text) => {
          input.transcript.push(text);
          process.stdout.write(text);
        },
        stderr: (text) => {
          input.transcript.push(text);
          process.stderr.write(text);
        },
      },
    );
    const journalFiles = new Map<string, string>();
    for (const resident of run.residents) {
      journalFiles.set(
        resident.entityId,
        await waitForRunJournal(resident.journalDirectory, 30_000),
      );
    }
    const wait = new AbortController();
    try {
      await Promise.race([
        waitFor(
          () =>
            input.residents.every((resident) => {
              const events = readRunJournal(
                requiredMapValue(journalFiles, resident.entityId, 'run journal'),
              );
              const failure = events.find(
                (event) =>
                  event.type === 'model_call_failed' ||
                  event.type === 'model_auxiliary_call_failed',
              );
              if (failure) {
                throw new Error(
                  `${input.phase} ${resident.entityId} model call failed: ${String(failure.data?.error || 'unknown error')}`,
                );
              }
              return input.milestone(resident, events);
            }),
          input.timeoutMs,
          input.milestoneLabel,
          wait.signal,
        ),
        run.finished.then(() => {
          throw new Error(`${input.phase} managed population ended before its milestone`);
        }),
      ]);
    } finally {
      wait.abort();
    }

    await run.quiesceResidents(`${safeLabel}_${safePhase}_before_witness`);
    const witnessed = input.witnesses
      ? await input.witnesses({ run })
      : { independentWitness: null, bodyWitnesses: new Map<string, BodyWitness>() };
    await run.stop(`${safeLabel}_${safePhase}_complete`);
    await run.finished;
    const journals = new Map<
      string,
      Readonly<{ file: string; events: readonly RunJournalEvent[] }>
    >();
    for (const resident of input.residents) {
      const file = requiredMapValue(journalFiles, resident.entityId, 'run journal');
      journals.set(resident.entityId, { file, events: readRunJournal(file) });
    }
    const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
    return {
      managedRunId: run.runId,
      durationMs: Date.now() - startedAt,
      journals,
      lifecycleFile: lifecycle.file,
      lifecycleSha256: sha256File(lifecycle.file),
      lifecycleTipDigest: lifecycle.tipDigest,
      lifecycleEvents: lifecycle.events,
      independentWitness: witnessed.independentWitness ?? null,
      bodyWitnesses: witnessed.bodyWitnesses ?? new Map<string, BodyWitness>(),
    };
  } catch (error) {
    if (run) await run.stop(`${safeLabel}_${safePhase}_failed`).catch(() => {});
    throw error;
  } finally {
    restoreEnvironment('BEHOLD_RECORD_MODEL_IO', previousRecordModelIo);
  }
}

export async function materializePopulationTrajectories(input: {
  fixture: OwnedWorldFixture;
  entityIds: readonly string[];
  protocol: string;
  label: string;
}) {
  const previous = {
    controlRoot: process.env.BEHOLD_WORLD_CONTROL_ROOT,
    controlFile: process.env.BEHOLD_WORLD_CONTROL_FILE,
    worldId: process.env.BEHOLD_WORLD_ID,
    runId: process.env.BEHOLD_RUN_ID,
  };
  process.env.BEHOLD_WORLD_CONTROL_ROOT = input.fixture.controlRoot;
  delete process.env.BEHOLD_WORLD_CONTROL_FILE;
  delete process.env.BEHOLD_WORLD_ID;
  delete process.env.BEHOLD_RUN_ID;
  try {
    const result = new Map<string, PopulationTrajectory>();
    for (const entityId of input.entityIds) {
      const loom = await openEntityLoom(entityId, input.fixture.entityRoot, OWNED_WORLD_ID);
      try {
        const turns = structuredClone(loom.turns());
        const trajectoryFile = path.join(
          input.fixture.evidenceRoot,
          `${entityId}-${input.label}-trajectory.json`,
        );
        durableWriteJson(trajectoryFile, {
          protocol: input.protocol,
          worldId: OWNED_WORLD_ID,
          entityId,
          turns,
        });
        result.set(entityId, { turns, loomFile: loom.file, trajectoryFile });
      } finally {
        await loom.close();
      }
    }
    return result;
  } finally {
    restoreEnvironment('BEHOLD_WORLD_CONTROL_ROOT', previous.controlRoot);
    restoreEnvironment('BEHOLD_WORLD_CONTROL_FILE', previous.controlFile);
    restoreEnvironment('BEHOLD_WORLD_ID', previous.worldId);
    restoreEnvironment('BEHOLD_RUN_ID', previous.runId);
  }
}

export async function compareAuthoritativePopulationTrajectories(input: {
  worldId: string;
  entityRoot: string;
  controlRoot: string;
  residents: readonly Readonly<{
    entityId: string;
    trajectory: readonly EntityTurn[];
    loomFile: string;
  }>[];
}) {
  const previous = {
    controlRoot: process.env.BEHOLD_WORLD_CONTROL_ROOT,
    controlFile: process.env.BEHOLD_WORLD_CONTROL_FILE,
    worldId: process.env.BEHOLD_WORLD_ID,
    runId: process.env.BEHOLD_RUN_ID,
  };
  process.env.BEHOLD_WORLD_CONTROL_ROOT = input.controlRoot;
  delete process.env.BEHOLD_WORLD_CONTROL_FILE;
  delete process.env.BEHOLD_WORLD_ID;
  delete process.env.BEHOLD_RUN_ID;
  try {
    const integrity: Record<string, boolean> = {};
    for (const resident of input.residents) {
      const expectedDigest = sha256File(resident.loomFile);
      const loom = await openEntityLoom(resident.entityId, input.entityRoot, input.worldId);
      try {
        integrity[`${resident.entityId}.trajectoryMatchesLync`] =
          path.resolve(loom.file) === path.resolve(resident.loomFile) &&
          JSON.stringify(loom.turns()) === JSON.stringify(resident.trajectory);
      } finally {
        await loom.close();
      }
      integrity[`${resident.entityId}.lyncStableAfterRead`] =
        sha256File(resident.loomFile) === expectedDigest;
    }
    return integrity;
  } finally {
    restoreEnvironment('BEHOLD_WORLD_CONTROL_ROOT', previous.controlRoot);
    restoreEnvironment('BEHOLD_WORLD_CONTROL_FILE', previous.controlFile);
    restoreEnvironment('BEHOLD_WORLD_ID', previous.worldId);
    restoreEnvironment('BEHOLD_RUN_ID', previous.runId);
  }
}

export function populationPhaseReport(phase: PopulationPhase) {
  return {
    managedRunId: phase.managedRunId,
    durationMs: phase.durationMs,
    lifecycleFile: phase.lifecycleFile,
    lifecycleSha256: phase.lifecycleSha256,
    lifecycleTipDigest: phase.lifecycleTipDigest,
    lifecycleEvents: phase.lifecycleEvents.length,
  };
}

export function verifiedLifecycleFromReport(phase: any) {
  const lifecycle = verifyWorldLifecycleJournal(path.resolve(String(phase?.lifecycleFile || '')));
  if (lifecycle.tipDigest !== String(phase?.lifecycleTipDigest || '')) {
    throw new Error(`lifecycle tip digest mismatch: ${lifecycle.file}`);
  }
  return lifecycle;
}

export function fileEvidence(file: string) {
  const resolved = path.resolve(file);
  return { file: resolved, sha256: sha256File(resolved), bytes: fs.statSync(resolved).size };
}

export function requiredMapValue<K, V>(map: ReadonlyMap<K, V>, key: K, label: string) {
  const value = map.get(key);
  if (value === undefined) throw new Error(`missing ${label}: ${String(key)}`);
  return value;
}
