#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  CACHE_PROOF_PROTOCOL,
  CACHE_TRAJECTORY_PROTOCOL,
  assessOwnedWorldCacheEvidence,
  hasResidentCacheMilestone,
  type CacheResidentEvidence,
  type CacheWorldWitness,
} from './owned-world-cache-evidence';
import { hasFirstRestartTurn, parseRunJournal } from './owned-world-model-evidence';
import {
  observeFromFreshMinecraftBody,
  observedContainerContents,
  observedDroppedItems,
  observedInventory,
  type OwnedWorldFixture,
} from './owned-world-model-harness';
import {
  compareAuthoritativePopulationTrajectories,
  fileEvidence,
  materializePopulationTrajectories,
  populationPhaseReport,
  requiredMapValue,
  runPopulationPhase,
  verifiedLifecycleFromReport,
} from './owned-world-population-harness';
import type {
  PopulationBodyWitness,
  PopulationProofBudgets,
} from './owned-world-population-evidence';
import {
  OWNED_LEVEL_SEED,
  OWNED_WORLD_ID,
  durableWriteJson,
  gitRevision,
  prepareOwnedWorld,
  readJson,
  sha256File,
  type OwnedWorldBlock,
  type OwnedWorldTarget,
} from './owned-world-fixture';
import { DEFAULT_RESIDENT_MODEL, residentModelSelection } from './resident-model-selection';
import { digestTree } from './world-lab';
import type { ManagedResidentSpec } from './world-runner';

const APPLE_KEEPER = 'AppleKeeper';
const CARROT_KEEPER = 'CarrotKeeper';
const WITNESS_ID = 'CacheWitness';
const APPLE_TARGET: OwnedWorldTarget = Object.freeze({
  x: 3,
  y: -60,
  z: 0,
  item: 'apple',
  count: 1,
});
const CARROT_TARGET: OwnedWorldTarget = Object.freeze({
  x: -3,
  y: -60,
  z: 0,
  item: 'carrot',
  count: 1,
});
const CACHE_BLOCK: OwnedWorldBlock = Object.freeze({
  x: 0,
  y: -60,
  z: 5,
  block: 'chest',
});
const CACHE_BUDGETS: PopulationProofBudgets = Object.freeze({
  maxResidents: 2,
  maxConcurrentModelCalls: 2,
  maxTotalModelCalls: 30,
  maxTotalTokens: 80_000,
  maxSingleCallLatencyMs: 60_000,
  maxTotalModelCostUsd: 0.2,
  maxJournalBytesPerResident: 3 * 1024 * 1024,
  maxLoomBytesPerResident: 3 * 1024 * 1024,
  maxProofWallMs: 15 * 60_000,
});

type CacheResidentDefinition = Readonly<{
  entityId: string;
  targetItem: string;
  peerId: string;
  peerItem: string;
  task: string;
  allowTools: readonly string[];
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
      'Usage: owned-world-cache-proof [--run <safe-id>] [--port <unused-loopback-port>] [--model <OpenRouter-slug>] [--timeout <seconds>] [--reassess <cache-report.json>]\n',
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
      'OPENROUTER_API_KEY is required for the real cache proof; no world was generated and no model call was attempted',
    );
  }
  const model = String(parsed.values.model || DEFAULT_RESIDENT_MODEL).trim();
  if (!model) throw new Error('a non-empty model slug is required');
  const timeoutMs = Number(parsed.values.timeout || 420) * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
    throw new Error(`invalid proof timeout: ${parsed.values.timeout}`);
  }
  const requestedRunId = String(
    parsed.values.run || `cache-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const port = Number(parsed.values.port || 25578);
  const allowTools = Object.freeze([
    'collect_nearby_item',
    'deposit_in_container',
    'inspect_container',
    'chat',
  ]);
  const definitions: readonly CacheResidentDefinition[] = Object.freeze([
    Object.freeze({
      entityId: APPLE_KEEPER,
      targetItem: 'apple',
      peerId: CARROT_KEEPER,
      peerItem: 'carrot',
      task: `You share this Minecraft world with ${CARROT_KEEPER}. Pick up only the nearby dropped apple, then put exactly one apple into the nearby chest. After Minecraft confirms it is stored, tell ${CARROT_KEEPER} in one short message. Do not take anything from the chest. Hear ${CARROT_KEEPER}'s own message and look inside the chest yourself; yield only after you have personally seen exactly one apple and one carrot stored there. On a later life, remember your finished contribution and do not deposit, withdraw, or announce it again.`,
      allowTools,
    }),
    Object.freeze({
      entityId: CARROT_KEEPER,
      targetItem: 'carrot',
      peerId: APPLE_KEEPER,
      peerItem: 'apple',
      task: `You share this Minecraft world with ${APPLE_KEEPER}. Pick up only the nearby dropped carrot, then put exactly one carrot into the nearby chest. After Minecraft confirms it is stored, tell ${APPLE_KEEPER} in one short message. Do not take anything from the chest. Hear ${APPLE_KEEPER}'s own message and look inside the chest yourself; yield only after you have personally seen exactly one apple and one carrot stored there. On a later life, remember your finished contribution and do not deposit, withdraw, or announce it again.`,
      allowTools,
    }),
  ]);
  const residentSpecs: readonly ManagedResidentSpec[] = definitions.map((definition) => ({
    entityId: definition.entityId,
    model,
    mind: 'direct',
    tickMs: 1000,
    task: definition.task,
    allowTools: definition.allowTools,
  }));
  const fixture = await prepareOwnedWorld(
    requestedRunId,
    port,
    'owned-world-cache',
    APPLE_TARGET,
    [CARROT_TARGET],
    [CACHE_BLOCK],
  );
  const transcript: string[] = [];
  const proofStartedAt = Date.now();

  process.stdout.write(`[owned-world-cache] native shared-cache epoch with ${model}\n`);
  const act = await runPopulationPhase<CacheWorldWitness, PopulationBodyWitness>({
    phase: 'act',
    runLabel: 'cache',
    fixture,
    residents: residentSpecs,
    maxResidents: CACHE_BUDGETS.maxResidents,
    timeoutMs,
    transcript,
    milestoneLabel: 'two-resident completed shared cache',
    milestone: (resident, events) => {
      const definition = definitions.find((candidate) => candidate.entityId === resident.entityId);
      if (!definition) throw new Error(`missing cache definition for ${resident.entityId}`);
      return hasResidentCacheMilestone(
        events,
        definition.targetItem,
        definition.peerItem,
        definition.peerId,
      );
    },
    witnesses: ({ run }) => collectWitnesses(run, fixture, definitions, model),
  });
  if (!act.independentWitness || act.bodyWitnesses.size !== definitions.length) {
    throw new Error('act phase did not produce every independent Minecraft witness');
  }
  const afterActTree = digestTree(fixture.runtime);

  process.stdout.write('[owned-world-cache] restarting both persistent residents\n');
  const resume = await runPopulationPhase<CacheWorldWitness, PopulationBodyWitness>({
    phase: 'resume',
    runLabel: 'cache',
    fixture,
    residents: residentSpecs,
    maxResidents: CACHE_BUDGETS.maxResidents,
    timeoutMs,
    transcript,
    milestoneLabel: 'cache restart turn for both residents',
    milestone: (_resident, events) => hasFirstRestartTurn(events),
  });
  const afterResumeTree = digestTree(fixture.runtime);
  const proofWallMs = Date.now() - proofStartedAt;
  const trajectories = await materializePopulationTrajectories({
    fixture,
    entityIds: definitions.map((resident) => resident.entityId),
    protocol: CACHE_TRAJECTORY_PROTOCOL,
    label: 'cache',
  });
  const residentEvidence: CacheResidentEvidence[] = definitions.map((definition) => {
    const actJournal = requiredMapValue(act.journals, definition.entityId, 'act journal');
    const resumeJournal = requiredMapValue(resume.journals, definition.entityId, 'resume journal');
    const trajectory = requiredMapValue(trajectories, definition.entityId, 'resident trajectory');
    const bodyWitness = requiredMapValue(
      act.bodyWitnesses,
      definition.entityId,
      'resident body witness',
    );
    return {
      entityId: definition.entityId,
      model,
      task: definition.task,
      targetItem: definition.targetItem,
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
  const assessment = assessOwnedWorldCacheEvidence({
    worldId: OWNED_WORLD_ID,
    containerPosition: CACHE_BLOCK,
    actRunId: act.managedRunId,
    resumeRunId: resume.managedRunId,
    actLifecycle: act.lifecycleEvents,
    resumeLifecycle: resume.lifecycleEvents,
    independentWitness: act.independentWitness,
    residents: residentEvidence,
    budgets: CACHE_BUDGETS,
    proofWallMs,
  });

  const reportFile = path.join(fixture.evidenceRoot, 'cache-report.json');
  durableWriteJson(reportFile, {
    protocol: CACHE_PROOF_PROTOCOL,
    status: assessment.failed.length === 0 ? 'passed' : 'failed',
    runId: fixture.runId,
    worldId: OWNED_WORLD_ID,
    containerPosition: CACHE_BLOCK,
    model,
    modelSelection: residentModelSelection(model),
    startedAt: fixture.startedAt,
    completedAt: new Date().toISOString(),
    proofWallMs,
    repository: { path: fixture.repository, revision: gitRevision() },
    roots: { entity: fixture.entityRoot, control: fixture.controlRoot },
    residents: definitions,
    budgets: CACHE_BUDGETS,
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
      act: populationPhaseReport(act),
      resume: populationPhaseReport(resume),
      residents: Object.fromEntries(
        residentEvidence.map((resident) => {
          const trajectory = requiredMapValue(
            trajectories,
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
    path.join(fixture.evidenceRoot, 'managed-cache-transcript.log'),
    transcript.join(''),
    'utf8',
  );
  if (assessment.failed.length > 0) {
    throw new Error(
      `cache proof failed (${assessment.failed.join(', ')}); evidence: ${reportFile}`,
    );
  }
  process.stdout.write(`[owned-world-cache] PASS ${reportFile}\n`);
}

async function collectWitnesses(
  run: Parameters<typeof observeFromFreshMinecraftBody>[0]['run'],
  fixture: OwnedWorldFixture,
  definitions: readonly CacheResidentDefinition[],
  model: string,
) {
  const independentWitness = await observeFromFreshMinecraftBody({
    run,
    entityRoot: fixture.entityRoot,
    controlRoot: fixture.controlRoot,
    port: fixture.port,
    model,
    witnessId: WITNESS_ID,
    observe: async (bot) => ({
      droppedItems: observedDroppedItems(bot),
      ...(await observedContainerContents(bot, CACHE_BLOCK)),
    }),
  });
  const bodyWitnesses = new Map<string, PopulationBodyWitness>();
  for (const resident of definitions) {
    const witness = await observeFromFreshMinecraftBody({
      run,
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
  const sourceFile = path.resolve(inputFile);
  const source = readJson(sourceFile);
  if (source?.protocol !== CACHE_PROOF_PROTOCOL) {
    throw new Error(`cannot reassess unsupported cache proof: ${source?.protocol || 'missing'}`);
  }
  const definitions = source.residents as readonly CacheResidentDefinition[];
  if (!Array.isArray(definitions) || definitions.length !== 2) {
    throw new Error('cache report does not declare exactly two residents');
  }
  const actLifecycle = verifiedLifecycleFromReport(source.evidence.act);
  const resumeLifecycle = verifiedLifecycleFromReport(source.evidence.resume);
  const integrity: Record<string, boolean> = {
    actLifecycle:
      sha256File(actLifecycle.file) === String(source.evidence.act.lifecycleSha256 || ''),
    resumeLifecycle:
      sha256File(resumeLifecycle.file) === String(source.evidence.resume.lifecycleSha256 || ''),
  };
  const residentEvidence: CacheResidentEvidence[] = [];
  for (const definition of definitions) {
    const files = source.evidence.residents?.[definition.entityId];
    if (!files) throw new Error(`missing evidence files for ${definition.entityId}`);
    for (const [name, evidence] of Object.entries(files) as Array<[string, any]>) {
      const file = path.resolve(String(evidence?.file || ''));
      integrity[`${definition.entityId}.${name}`] =
        sha256File(file) === String(evidence?.sha256 || '') &&
        fs.statSync(file).size === Number(evidence?.bytes);
    }
    const trajectoryEnvelope = readJson(path.resolve(String(files.trajectory.file)));
    if (
      trajectoryEnvelope?.protocol !== CACHE_TRAJECTORY_PROTOCOL ||
      trajectoryEnvelope?.entityId !== definition.entityId ||
      trajectoryEnvelope?.worldId !== source.worldId ||
      !Array.isArray(trajectoryEnvelope?.turns)
    ) {
      throw new Error(`invalid cache trajectory evidence for ${definition.entityId}`);
    }
    residentEvidence.push({
      entityId: definition.entityId,
      model: String(source.model),
      task: definition.task,
      targetItem: definition.targetItem,
      actEvents: parseRunJournal(fs.readFileSync(path.resolve(files.actJournal.file), 'utf8')),
      resumeEvents: parseRunJournal(
        fs.readFileSync(path.resolve(files.resumeJournal.file), 'utf8'),
      ),
      trajectory: trajectoryEnvelope.turns,
      bodyWitness: source.evidence.bodyWitnesses[definition.entityId],
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
    await compareAuthoritativePopulationTrajectories({
      worldId: String(source.worldId),
      entityRoot: path.resolve(String(source.roots?.entity || '')),
      controlRoot: path.resolve(String(source.roots?.control || '')),
      residents: residentEvidence.map((resident) => ({
        entityId: resident.entityId,
        trajectory: resident.trajectory,
        loomFile: resident.files.loom.file,
      })),
    }),
  );
  const assessment = assessOwnedWorldCacheEvidence({
    worldId: String(source.worldId),
    containerPosition: source.containerPosition,
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
  const outputFile = path.join(path.dirname(sourceFile), 'cache-report-reassessed.json');
  if (fs.existsSync(outputFile)) throw new Error(`reassessment already exists: ${outputFile}`);
  const passed = failedIntegrity.length === 0 && assessment.failed.length === 0;
  durableWriteJson(outputFile, {
    protocol: 'behold.owned-world-cache-reassessment.v1',
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
      `existing cache proof did not pass reassessment (${[...failedIntegrity, ...assessment.failed].join(', ')}): ${outputFile}`,
    );
  }
  process.stdout.write(`[owned-world-cache] REASSESSED PASS ${outputFile}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `[owned-world-cache] ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
