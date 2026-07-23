#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  hasCollectionFollowedByYield,
  hasFirstRestartTurn,
  type IndependentWorldWitness,
} from './owned-world-model-evidence';
import {
  observeFromFreshMinecraftBody,
  observedDroppedItems,
  observedInventory,
  type OwnedWorldFixture,
} from './owned-world-model-harness';
import {
  loadPopulationReassessment,
  materializePopulationTrajectories,
  populationEvidenceReport,
  populationResidentArtifacts,
  runPopulationPhase,
  writePopulationReassessment,
} from './owned-world-population-harness';
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
} from './owned-world-fixture';
import { digestTree } from './world-lab';
import type { ManagedResidentSpec } from './world-runner';
import { DEFAULT_RESIDENT_MODEL, residentModelSelection } from './resident-model-selection';

const WITNESS_ID = 'PopWitness';
const POPULATION_TRAJECTORY_PROTOCOL = 'behold.population-resident-trajectory.v1';
const SECOND_TARGET = Object.freeze({ x: -3, y: -60, z: 0, item: 'carrot', count: 1 });
const ALLOW_TOOLS = Object.freeze(['look_direction', 'collect_nearby_item', 'inspect_volume']);
const DEFAULT_BUDGETS: PopulationProofBudgets = Object.freeze({
  maxResidents: 2,
  maxConcurrentModelCalls: 1,
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
  const model = String(parsed.values.model || DEFAULT_RESIDENT_MODEL).trim();
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
  const residentSpecs: readonly ManagedResidentSpec[] = residents.map((resident) => ({
    entityId: resident.entityId,
    model,
    mind: 'direct',
    tickMs: 1000,
    task: resident.task,
    allowTools: ALLOW_TOOLS,
  }));
  const fixture = await prepareOwnedWorld(
    requestedRunId,
    port,
    'owned-world-population',
    OWNED_TARGET,
    [SECOND_TARGET],
  );
  const transcript: string[] = [];
  const proofStartedAt = Date.now();
  const modelSelection = residentModelSelection(model);

  process.stdout.write(`[owned-world-population] first shared epoch with ${model}\n`);
  const act = await runPopulationPhase<IndependentWorldWitness, PopulationBodyWitness>({
    phase: 'act',
    runLabel: 'population',
    fixture,
    residents: residentSpecs,
    maxResidents: DEFAULT_BUDGETS.maxResidents,
    maxConcurrentModelCalls: DEFAULT_BUDGETS.maxConcurrentModelCalls,
    timeoutMs,
    transcript,
    milestoneLabel: 'act two-resident collection milestone',
    milestone: (_resident, events) => hasCollectionFollowedByYield(events),
    witnesses: ({ run }) => collectPopulationWitnesses(run, fixture, residents, model),
  });
  if (!act.independentWitness || act.bodyWitnesses.size !== residents.length) {
    throw new Error('act phase did not produce every independent Minecraft witness');
  }
  const afterActTree = digestTree(fixture.runtime);

  process.stdout.write('[owned-world-population] restarting both persistent residents\n');
  const resume = await runPopulationPhase<IndependentWorldWitness, PopulationBodyWitness>({
    phase: 'resume',
    runLabel: 'population',
    fixture,
    residents: residentSpecs,
    maxResidents: DEFAULT_BUDGETS.maxResidents,
    maxConcurrentModelCalls: DEFAULT_BUDGETS.maxConcurrentModelCalls,
    timeoutMs,
    transcript,
    milestoneLabel: 'resume two-resident milestone',
    milestone: (_resident, events) => hasFirstRestartTurn(events),
  });
  const afterResumeTree = digestTree(fixture.runtime);
  const proofWallMs = Date.now() - proofStartedAt;
  const trajectoryEvidence = await materializePopulationTrajectories({
    fixture,
    entityIds: residents.map((resident) => resident.entityId),
    protocol: POPULATION_TRAJECTORY_PROTOCOL,
    label: 'population',
  });

  const residentEvidence: PopulationResidentEvidence[] = residents.map((resident) => {
    return {
      ...populationResidentArtifacts({
        entityId: resident.entityId,
        act,
        resume,
        trajectories: trajectoryEvidence,
      }),
      model,
      task: resident.task,
      targetItem: resident.targetItem,
    };
  });
  const assessment = assessOwnedWorldPopulationEvidence({
    worldId: OWNED_WORLD_ID,
    actRunId: act.managedRunId,
    resumeRunId: resume.managedRunId,
    actLifecycle: act.lifecycleEvents,
    resumeLifecycle: resume.lifecycleEvents,
    actCognition: act.cognitionJournal?.events,
    resumeCognition: resume.cognitionJournal?.events,
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
    evidence: populationEvidenceReport({
      fixture,
      act,
      resume,
      afterActTree,
      afterResumeTree,
      residents: residentEvidence,
      trajectories: trajectoryEvidence,
    }),
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

async function collectPopulationWitnesses(
  run: Parameters<typeof observeFromFreshMinecraftBody>[0]['run'],
  fixture: OwnedWorldFixture,
  residents: readonly ResidentDefinition[],
  model: string,
) {
  const independentWitness = await observeFromFreshMinecraftBody({
    run,
    worldId: fixture.worldId,
    entityRoot: fixture.entityRoot,
    controlRoot: fixture.controlRoot,
    port: fixture.port,
    model,
    witnessId: WITNESS_ID,
    observe: (bot) => ({ droppedItems: observedDroppedItems(bot) }),
  });
  const bodyWitnesses = new Map<string, PopulationBodyWitness>();
  for (const resident of residents) {
    const witness = await observeFromFreshMinecraftBody({
      run,
      worldId: fixture.worldId,
      entityRoot: fixture.entityRoot,
      controlRoot: fixture.controlRoot,
      port: fixture.port,
      model,
      witnessId: resident.entityId,
      observe: (bot) => ({
        inventory: observedInventory(bot),
        droppedItems: observedDroppedItems(bot),
      }),
    });
    bodyWitnesses.set(resident.entityId, witness);
  }
  return { independentWitness, bodyWitnesses };
}

async function reassessExistingProof(inputFile: string) {
  const loaded = await loadPopulationReassessment<
    ResidentDefinition,
    PopulationBodyWitness,
    PopulationResidentEvidence
  >(inputFile, {
    proofProtocol: POPULATION_PROOF_PROTOCOL,
    trajectoryProtocol: POPULATION_TRAJECTORY_PROTOCOL,
    reportLabel: 'population',
    expectedResidentCount: 2,
    createResident: ({ definition, source, artifacts }) => ({
      ...artifacts,
      model: String(source.model),
      task: definition.task,
      targetItem: definition.targetItem,
    }),
  });
  const { source } = loaded;
  const assessment = assessOwnedWorldPopulationEvidence({
    worldId: String(source.worldId),
    actRunId: String(source.evidence.act.managedRunId),
    resumeRunId: String(source.evidence.resume.managedRunId),
    actLifecycle: loaded.actLifecycle.events,
    resumeLifecycle: loaded.resumeLifecycle.events,
    actCognition: loaded.actCognition?.events,
    resumeCognition: loaded.resumeCognition?.events,
    independentWitness: source.evidence.independentWitness,
    residents: loaded.residents,
    budgets: source.budgets,
    proofWallMs: Number(source.proofWallMs),
  });
  const result = writePopulationReassessment({
    loaded,
    assessment,
    protocol: 'behold.owned-world-population-reassessment.v1',
    outputName: 'population-report-reassessed.json',
  });
  if (!result.passed) {
    throw new Error(
      `existing population proof did not pass reassessment (${[...result.failedIntegrity, ...assessment.failed].join(', ')}): ${result.outputFile}`,
    );
  }
  process.stdout.write(`[owned-world-population] REASSESSED PASS ${result.outputFile}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `[owned-world-population] ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
