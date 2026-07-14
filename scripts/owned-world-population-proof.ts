#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { openEntityLoom, type EntityTurn } from '../src/entity/loom';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import {
  hasCollectionFollowedByYield,
  hasFirstRestartTurn,
  parseRunJournal,
  type IndependentWorldWitness,
  type RunJournalEvent,
} from './owned-world-model-evidence';
import {
  observeFromFreshMinecraftBody,
  observedDroppedItems,
  observedInventory,
  readRunJournal,
  waitForRunJournal,
  type OwnedWorldFixture,
} from './owned-world-model-harness';
import {
  POPULATION_PROOF_PROTOCOL,
  assessOwnedWorldPopulationEvidence,
  type PopulationBodyWitness,
  type PopulationProofBudgets,
  type PopulationResidentEvidence,
} from './owned-world-population-evidence';
import {
  OWNED_LEVEL_SEED,
  OWNED_TARGET,
  OWNED_WORLD_ID,
  durableWriteJson,
  gitRevision,
  prepareOwnedWorld,
  readJson,
  restoreEnvironment,
  sha256File,
  waitFor,
} from './owned-world-fixture';
import { digestTree } from './world-lab';
import { startManagedWorld, type ManagedResidentSpec, type ManagedWorldRun } from './world-runner';

const WITNESS_ID = 'PopWitness';
const DEFAULT_POPULATION_MODEL = 'openai/gpt-5.6-luna';
const MODEL_SELECTION = Object.freeze({
  protocol: 'behold.population-model-selection.v1',
  selected: DEFAULT_POPULATION_MODEL,
  selectedAt: '2026-07-13T19:00:00-07:00',
  catalog: 'https://openrouter.ai/api/v1/models',
  workload: 'exact CarrotResident restart request from failed population proof v2',
  trialsPerCandidate: 2,
  criteria: ['correct admitted tool', 'latency', 'provider-reported cost'],
  evidence: 'docs/RESIDENT_MODEL_SELECTION.md',
});
const SECOND_TARGET = Object.freeze({ x: -3, y: -60, z: 0, item: 'carrot', count: 1 });
const ALLOW_TOOLS = Object.freeze(['collect_nearby_item', 'inspect_volume']);
const DEFAULT_BUDGETS: PopulationProofBudgets = Object.freeze({
  maxResidents: 2,
  maxConcurrentModelCalls: 2,
  maxTotalModelCalls: 16,
  maxTotalTokens: 40_000,
  maxSingleCallLatencyMs: 60_000,
  maxTotalModelCostUsd: 0.1,
  maxJournalBytesPerResident: 2 * 1024 * 1024,
  maxLoomBytesPerResident: 2 * 1024 * 1024,
  maxProofWallMs: 12 * 60_000,
});

type ResidentDefinition = Readonly<{
  entityId: string;
  targetItem: string;
  task: string;
}>;

type PopulationPhase = Readonly<{
  managedRunId: string;
  durationMs: number;
  journals: ReadonlyMap<string, Readonly<{ file: string; events: readonly RunJournalEvent[] }>>;
  lifecycleFile: string;
  lifecycleSha256: string;
  lifecycleTipDigest: string | null;
  lifecycleEvents: ReturnType<typeof verifyWorldLifecycleJournal>['events'];
  independentWitness: IndependentWorldWitness | null;
  bodyWitnesses: ReadonlyMap<string, PopulationBodyWitness>;
}>;

async function main() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: 'string' },
      port: { type: 'string' },
      model: { type: 'string' },
      timeout: { type: 'string' },
      reassess: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help) {
    process.stdout.write(
      'Usage: owned-world-population-proof [--run <safe-id>] [--port <unused-loopback-port>] [--model <OpenRouter-slug>] [--timeout <seconds>] [--reassess <population-report.json>]\n',
    );
    return;
  }
  if (parsed.values.reassess) {
    await reassessExistingProof(String(parsed.values.reassess));
    return;
  }

  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey || apiKey.length < 12) {
    throw new Error(
      'OPENROUTER_API_KEY is required for the real population proof; no world was generated and no model call was attempted',
    );
  }
  const model = String(parsed.values.model || DEFAULT_POPULATION_MODEL).trim();
  if (!model) throw new Error('a non-empty model slug is required');
  const timeoutMs = Number(parsed.values.timeout || 300) * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
    throw new Error(`invalid proof timeout: ${parsed.values.timeout}`);
  }
  const requestedRunId = String(
    parsed.values.run || `population-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const port = Number(parsed.values.port || 25577);
  const residents: readonly ResidentDefinition[] = Object.freeze([
    Object.freeze({
      entityId: 'AppleResident',
      targetItem: 'apple',
      task: 'Secure exactly the nearby dropped apple for your own body. Do not collect the carrot assigned to the other resident. After Minecraft confirms the apple collection, yield. On a later life, use your own remembered consequence and do not repeat completed physical work.',
    }),
    Object.freeze({
      entityId: 'CarrotResident',
      targetItem: 'carrot',
      task: 'Secure exactly the nearby dropped carrot for your own body. Do not collect the apple assigned to the other resident. After Minecraft confirms the carrot collection, yield. On a later life, use your own remembered consequence and do not repeat completed physical work.',
    }),
  ]);
  const fixture = await prepareOwnedWorld(
    requestedRunId,
    port,
    'owned-world-population',
    OWNED_TARGET,
    [SECOND_TARGET],
  );
  const transcript: string[] = [];
  const proofStartedAt = Date.now();
  const modelSelection =
    model === DEFAULT_POPULATION_MODEL
      ? MODEL_SELECTION
      : {
          protocol: 'behold.population-model-selection.v1',
          selected: model,
          selectedAt: new Date().toISOString(),
          mode: 'explicit_operator_override',
        };

  process.stdout.write(`[owned-world-population] first shared epoch with ${model}\n`);
  const act = await runPopulationPhase({
    phase: 'act',
    fixture,
    residents,
    model,
    timeoutMs,
    transcript,
    collectWitnesses: true,
  });
  if (!act.independentWitness || act.bodyWitnesses.size !== residents.length) {
    throw new Error('act phase did not produce every independent Minecraft witness');
  }
  const afterActTree = digestTree(fixture.runtime);

  process.stdout.write('[owned-world-population] restarting both persistent residents\n');
  const resume = await runPopulationPhase({
    phase: 'resume',
    fixture,
    residents,
    model,
    timeoutMs,
    transcript,
    collectWitnesses: false,
  });
  const afterResumeTree = digestTree(fixture.runtime);
  const proofWallMs = Date.now() - proofStartedAt;
  const trajectoryEvidence = await materializeTrajectories(fixture, residents);

  const residentEvidence: PopulationResidentEvidence[] = residents.map((resident) => {
    const actJournal = requiredMapValue(act.journals, resident.entityId, 'act journal');
    const resumeJournal = requiredMapValue(resume.journals, resident.entityId, 'resume journal');
    const trajectory = requiredMapValue(
      trajectoryEvidence,
      resident.entityId,
      'resident trajectory',
    );
    const bodyWitness = requiredMapValue(
      act.bodyWitnesses,
      resident.entityId,
      'resident body witness',
    );
    return {
      entityId: resident.entityId,
      model,
      task: resident.task,
      targetItem: resident.targetItem,
      actEvents: actJournal.events,
      resumeEvents: resumeJournal.events,
      trajectory: trajectory.turns,
      bodyWitness,
      files: {
        actJournal: { file: actJournal.file, bytes: fs.statSync(actJournal.file).size },
        resumeJournal: { file: resumeJournal.file, bytes: fs.statSync(resumeJournal.file).size },
        loom: { file: trajectory.loomFile, bytes: fs.statSync(trajectory.loomFile).size },
      },
    };
  });
  const assessment = assessOwnedWorldPopulationEvidence({
    worldId: OWNED_WORLD_ID,
    actRunId: act.managedRunId,
    resumeRunId: resume.managedRunId,
    actLifecycle: act.lifecycleEvents,
    resumeLifecycle: resume.lifecycleEvents,
    independentWitness: act.independentWitness,
    residents: residentEvidence,
    budgets: DEFAULT_BUDGETS,
    proofWallMs,
  });

  const reportFile = path.join(fixture.evidenceRoot, 'population-report.json');
  durableWriteJson(reportFile, {
    protocol: POPULATION_PROOF_PROTOCOL,
    status: assessment.failed.length === 0 ? 'passed' : 'failed',
    runId: fixture.runId,
    worldId: OWNED_WORLD_ID,
    model,
    modelSelection,
    startedAt: fixture.startedAt,
    completedAt: new Date().toISOString(),
    proofWallMs,
    repository: { path: fixture.repository, revision: gitRevision() },
    roots: {
      entity: fixture.entityRoot,
      control: fixture.controlRoot,
    },
    residents,
    budgets: DEFAULT_BUDGETS,
    server: {
      version: String(fixture.toolLock.tools.minecraftServer.version),
      jar: fixture.serverJar,
      sha256: fixture.actualServerJarSha256,
      java: fixture.java,
      port,
      seed: OWNED_LEVEL_SEED,
      generation: fixture.generation,
    },
    evidence: {
      sourceTree: fixture.sourceTree,
      baselineTree: fixture.baselineTree,
      initialRuntimeTree: fixture.initialRuntimeTree,
      afterActTree,
      afterResumeTree,
      independentWitness: act.independentWitness,
      bodyWitnesses: Object.fromEntries(act.bodyWitnesses),
      act: phaseReport(act),
      resume: phaseReport(resume),
      residents: Object.fromEntries(
        residentEvidence.map((resident) => {
          const trajectory = requiredMapValue(
            trajectoryEvidence,
            resident.entityId,
            'resident trajectory',
          );
          return [
            resident.entityId,
            {
              actJournal: fileEvidence(resident.files.actJournal.file),
              resumeJournal: fileEvidence(resident.files.resumeJournal.file),
              loom: fileEvidence(resident.files.loom.file),
              trajectory: fileEvidence(trajectory.trajectoryFile),
            },
          ];
        }),
      ),
    },
    assessment,
  });
  fs.writeFileSync(
    path.join(fixture.evidenceRoot, 'managed-population-transcript.log'),
    transcript.join(''),
    'utf8',
  );
  if (assessment.failed.length > 0) {
    throw new Error(
      `population proof failed (${assessment.failed.join(', ')}); evidence: ${reportFile}`,
    );
  }
  process.stdout.write(`[owned-world-population] PASS ${reportFile}\n`);
}

async function runPopulationPhase(input: {
  phase: 'act' | 'resume';
  fixture: OwnedWorldFixture;
  residents: readonly ResidentDefinition[];
  model: string;
  timeoutMs: number;
  transcript: string[];
  collectWitnesses: boolean;
}): Promise<PopulationPhase> {
  const startedAt = Date.now();
  const runRoot = path.join(input.fixture.evidenceRoot, `${input.phase}-population`);
  fs.mkdirSync(runRoot, { recursive: true });
  const previousRecordModelIo = process.env.BEHOLD_RECORD_MODEL_IO;
  process.env.BEHOLD_RECORD_MODEL_IO = '1';
  let run: ManagedWorldRun | null = null;
  try {
    const specs: ManagedResidentSpec[] = input.residents.map((resident) => ({
      entityId: resident.entityId,
      model: input.model,
      mind: 'direct',
      tickMs: 1000,
      task: resident.task,
      allowTools: ALLOW_TOOLS,
    }));
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
        residents: specs,
        maxResidents: DEFAULT_BUDGETS.maxResidents,
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
              const failure = events.find((event) => event.type === 'model_call_failed');
              if (failure) {
                throw new Error(
                  `${input.phase} ${resident.entityId} model call failed: ${String(failure.data?.error || 'unknown error')}`,
                );
              }
              return input.phase === 'act'
                ? hasCollectionFollowedByYield(events)
                : hasFirstRestartTurn(events);
            }),
          input.timeoutMs,
          `${input.phase} two-resident milestone`,
          wait.signal,
        ),
        run.finished.then(() => {
          throw new Error(`${input.phase} managed population ended before its milestone`);
        }),
      ]);
    } finally {
      wait.abort();
    }

    await run.quiesceResidents(`population_${input.phase}_before_witness`);
    let independentWitness: IndependentWorldWitness | null = null;
    const bodyWitnesses = new Map<string, PopulationBodyWitness>();
    if (input.collectWitnesses) {
      independentWitness = await observeFromFreshMinecraftBody({
        run,
        entityRoot: input.fixture.entityRoot,
        controlRoot: input.fixture.controlRoot,
        port: input.fixture.port,
        model: input.model,
        witnessId: WITNESS_ID,
        observe: (bot) => ({ droppedItems: observedDroppedItems(bot) }),
      });
      for (const resident of input.residents) {
        const witness = await observeFromFreshMinecraftBody({
          run,
          entityRoot: input.fixture.entityRoot,
          controlRoot: input.fixture.controlRoot,
          port: input.fixture.port,
          model: input.model,
          witnessId: resident.entityId,
          observe: (bot) => ({
            inventory: observedInventory(bot),
            droppedItems: observedDroppedItems(bot),
          }),
        });
        bodyWitnesses.set(resident.entityId, witness);
      }
    }
    await run.stop(`population_${input.phase}_complete`);
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
      independentWitness,
      bodyWitnesses,
    };
  } catch (error) {
    if (run) await run.stop(`population_${input.phase}_failed`).catch(() => {});
    throw error;
  } finally {
    restoreEnvironment('BEHOLD_RECORD_MODEL_IO', previousRecordModelIo);
  }
}

async function materializeTrajectories(
  fixture: OwnedWorldFixture,
  residents: readonly ResidentDefinition[],
) {
  const previous = {
    controlRoot: process.env.BEHOLD_WORLD_CONTROL_ROOT,
    controlFile: process.env.BEHOLD_WORLD_CONTROL_FILE,
    worldId: process.env.BEHOLD_WORLD_ID,
    runId: process.env.BEHOLD_RUN_ID,
  };
  process.env.BEHOLD_WORLD_CONTROL_ROOT = fixture.controlRoot;
  delete process.env.BEHOLD_WORLD_CONTROL_FILE;
  delete process.env.BEHOLD_WORLD_ID;
  delete process.env.BEHOLD_RUN_ID;
  try {
    const result = new Map<
      string,
      Readonly<{
        turns: readonly EntityTurn[];
        loomFile: string;
        trajectoryFile: string;
      }>
    >();
    for (const resident of residents) {
      const loom = await openEntityLoom(resident.entityId, fixture.entityRoot, OWNED_WORLD_ID);
      try {
        const turns = structuredClone(loom.turns());
        const trajectoryFile = path.join(
          fixture.evidenceRoot,
          `${resident.entityId}-trajectory.json`,
        );
        durableWriteJson(trajectoryFile, {
          protocol: 'behold.population-resident-trajectory.v1',
          worldId: OWNED_WORLD_ID,
          entityId: resident.entityId,
          turns,
        });
        result.set(resident.entityId, {
          turns,
          loomFile: loom.file,
          trajectoryFile,
        });
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

async function reassessExistingProof(inputFile: string) {
  const sourceFile = path.resolve(inputFile);
  const source = readJson(sourceFile);
  if (source?.protocol !== POPULATION_PROOF_PROTOCOL) {
    throw new Error(
      `cannot reassess unsupported population proof: ${source?.protocol || 'missing protocol'}`,
    );
  }
  const residentDefinitions = source.residents as readonly ResidentDefinition[];
  if (!Array.isArray(residentDefinitions) || residentDefinitions.length !== 2) {
    throw new Error('population report does not declare exactly two residents');
  }
  const actLifecycle = verifiedLifecycleFromReport(source.evidence.act);
  const resumeLifecycle = verifiedLifecycleFromReport(source.evidence.resume);
  const residentEvidence: PopulationResidentEvidence[] = [];
  const integrity: Record<string, boolean> = {
    actLifecycle:
      sha256File(actLifecycle.file) === String(source.evidence.act.lifecycleSha256 || ''),
    resumeLifecycle:
      sha256File(resumeLifecycle.file) === String(source.evidence.resume.lifecycleSha256 || ''),
  };
  for (const resident of residentDefinitions) {
    const files = source.evidence.residents?.[resident.entityId];
    if (!files) throw new Error(`missing evidence files for ${resident.entityId}`);
    for (const [name, evidence] of Object.entries(files) as Array<[string, any]>) {
      const file = path.resolve(String(evidence?.file || ''));
      integrity[`${resident.entityId}.${name}`] =
        sha256File(file) === String(evidence?.sha256 || '') &&
        fs.statSync(file).size === Number(evidence?.bytes);
    }
    const trajectoryEnvelope = readJson(path.resolve(String(files.trajectory.file)));
    if (
      trajectoryEnvelope?.protocol !== 'behold.population-resident-trajectory.v1' ||
      trajectoryEnvelope?.entityId !== resident.entityId ||
      trajectoryEnvelope?.worldId !== source.worldId ||
      !Array.isArray(trajectoryEnvelope?.turns)
    ) {
      throw new Error(`invalid trajectory evidence for ${resident.entityId}`);
    }
    residentEvidence.push({
      entityId: resident.entityId,
      model: String(source.model),
      task: resident.task,
      targetItem: resident.targetItem,
      actEvents: parseRunJournal(fs.readFileSync(path.resolve(files.actJournal.file), 'utf8')),
      resumeEvents: parseRunJournal(
        fs.readFileSync(path.resolve(files.resumeJournal.file), 'utf8'),
      ),
      trajectory: trajectoryEnvelope.turns,
      bodyWitness: source.evidence.bodyWitnesses[resident.entityId],
      files: {
        actJournal: {
          file: path.resolve(files.actJournal.file),
          bytes: fs.statSync(path.resolve(files.actJournal.file)).size,
        },
        resumeJournal: {
          file: path.resolve(files.resumeJournal.file),
          bytes: fs.statSync(path.resolve(files.resumeJournal.file)).size,
        },
        loom: {
          file: path.resolve(files.loom.file),
          bytes: fs.statSync(path.resolve(files.loom.file)).size,
        },
      },
    });
  }
  Object.assign(
    integrity,
    await compareAuthoritativeTrajectories(
      String(source.worldId),
      path.resolve(String(source.roots?.entity || '')),
      path.resolve(String(source.roots?.control || '')),
      residentEvidence,
    ),
  );
  const assessment = assessOwnedWorldPopulationEvidence({
    worldId: String(source.worldId),
    actRunId: String(source.evidence.act.managedRunId),
    resumeRunId: String(source.evidence.resume.managedRunId),
    actLifecycle: actLifecycle.events,
    resumeLifecycle: resumeLifecycle.events,
    independentWitness: source.evidence.independentWitness,
    residents: residentEvidence,
    budgets: source.budgets,
    proofWallMs: Number(source.proofWallMs),
  });
  const failedIntegrity = Object.entries(integrity)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const outputFile = path.join(path.dirname(sourceFile), 'population-report-reassessed.json');
  if (fs.existsSync(outputFile)) throw new Error(`reassessment already exists: ${outputFile}`);
  const passed = failedIntegrity.length === 0 && assessment.failed.length === 0;
  durableWriteJson(outputFile, {
    protocol: 'behold.owned-world-population-reassessment.v1',
    status: passed ? 'passed' : 'failed',
    reassessedAt: new Date().toISOString(),
    verifierRevision: gitRevision(),
    source: {
      file: sourceFile,
      sha256: sha256File(sourceFile),
      protocol: source.protocol,
      status: source.status,
    },
    integrity,
    failedIntegrity,
    assessment,
  });
  if (!passed) {
    throw new Error(
      `existing population proof did not pass reassessment (${[...failedIntegrity, ...assessment.failed].join(', ')}): ${outputFile}`,
    );
  }
  process.stdout.write(`[owned-world-population] REASSESSED PASS ${outputFile}\n`);
}

async function compareAuthoritativeTrajectories(
  worldId: string,
  entityRoot: string,
  controlRoot: string,
  residents: readonly PopulationResidentEvidence[],
) {
  const previous = {
    controlRoot: process.env.BEHOLD_WORLD_CONTROL_ROOT,
    controlFile: process.env.BEHOLD_WORLD_CONTROL_FILE,
    worldId: process.env.BEHOLD_WORLD_ID,
    runId: process.env.BEHOLD_RUN_ID,
  };
  process.env.BEHOLD_WORLD_CONTROL_ROOT = controlRoot;
  delete process.env.BEHOLD_WORLD_CONTROL_FILE;
  delete process.env.BEHOLD_WORLD_ID;
  delete process.env.BEHOLD_RUN_ID;
  try {
    const integrity: Record<string, boolean> = {};
    for (const resident of residents) {
      const expectedDigest = sha256File(resident.files.loom.file);
      const loom = await openEntityLoom(resident.entityId, entityRoot, worldId);
      try {
        integrity[`${resident.entityId}.trajectoryMatchesLync`] =
          path.resolve(loom.file) === path.resolve(resident.files.loom.file) &&
          JSON.stringify(loom.turns()) === JSON.stringify(resident.trajectory);
      } finally {
        await loom.close();
      }
      integrity[`${resident.entityId}.lyncStableAfterRead`] =
        sha256File(resident.files.loom.file) === expectedDigest;
    }
    return integrity;
  } finally {
    restoreEnvironment('BEHOLD_WORLD_CONTROL_ROOT', previous.controlRoot);
    restoreEnvironment('BEHOLD_WORLD_CONTROL_FILE', previous.controlFile);
    restoreEnvironment('BEHOLD_WORLD_ID', previous.worldId);
    restoreEnvironment('BEHOLD_RUN_ID', previous.runId);
  }
}

function phaseReport(phase: PopulationPhase) {
  return {
    managedRunId: phase.managedRunId,
    durationMs: phase.durationMs,
    lifecycleFile: phase.lifecycleFile,
    lifecycleSha256: phase.lifecycleSha256,
    lifecycleTipDigest: phase.lifecycleTipDigest,
    lifecycleEvents: phase.lifecycleEvents.length,
  };
}

function verifiedLifecycleFromReport(phase: any) {
  const lifecycle = verifyWorldLifecycleJournal(path.resolve(String(phase?.lifecycleFile || '')));
  if (lifecycle.tipDigest !== String(phase?.lifecycleTipDigest || '')) {
    throw new Error(`lifecycle tip digest mismatch: ${lifecycle.file}`);
  }
  return lifecycle;
}

function fileEvidence(file: string) {
  const resolved = path.resolve(file);
  return { file: resolved, sha256: sha256File(resolved), bytes: fs.statSync(resolved).size };
}

function requiredMapValue<K, V>(map: ReadonlyMap<K, V>, key: K, label: string) {
  const value = map.get(key);
  if (value === undefined) throw new Error(`missing ${label}: ${String(key)}`);
  return value;
}

void main().catch((error) => {
  process.stderr.write(
    `[owned-world-population] ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
