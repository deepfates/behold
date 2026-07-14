#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  HANDOFF_PROOF_PROTOCOL,
  HANDOFF_TRAJECTORY_PROTOCOL,
  assessOwnedWorldHandoffEvidence,
  hasGiverHandoffMilestone,
  hasRecipientHandoffMilestone,
  type HandoffResidentEvidence,
} from './owned-world-handoff-evidence';
import {
  hasFirstRestartTurn,
  parseRunJournal,
  type IndependentWorldWitness,
} from './owned-world-model-evidence';
import {
  observeFromFreshMinecraftBody,
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
  OWNED_TARGET,
  OWNED_WORLD_ID,
  durableWriteJson,
  gitRevision,
  prepareOwnedWorld,
  readJson,
  sha256File,
} from './owned-world-fixture';
import { DEFAULT_RESIDENT_MODEL, residentModelSelection } from './resident-model-selection';
import { digestTree } from './world-lab';
import type { ManagedResidentSpec } from './world-runner';

const GIVER_ID = 'GiverResident';
const RECIPIENT_ID = 'ReceiverResident';
const WITNESS_ID = 'HandWitness';
const ITEM = 'apple';
const HANDOFF_BUDGETS: PopulationProofBudgets = Object.freeze({
  maxResidents: 2,
  maxConcurrentModelCalls: 2,
  maxTotalModelCalls: 24,
  maxTotalTokens: 60_000,
  maxSingleCallLatencyMs: 60_000,
  maxTotalModelCostUsd: 0.15,
  maxJournalBytesPerResident: 2 * 1024 * 1024,
  maxLoomBytesPerResident: 2 * 1024 * 1024,
  maxProofWallMs: 12 * 60_000,
});

type HandoffResidentDefinition = Readonly<{
  role: 'giver' | 'recipient';
  entityId: string;
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
      'Usage: owned-world-handoff-proof [--run <safe-id>] [--port <unused-loopback-port>] [--model <OpenRouter-slug>] [--timeout <seconds>] [--reassess <handoff-report.json>]\n',
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
      'OPENROUTER_API_KEY is required for the real handoff proof; no world was generated and no model call was attempted',
    );
  }
  const model = String(parsed.values.model || DEFAULT_RESIDENT_MODEL).trim();
  if (!model) throw new Error('a non-empty model slug is required');
  const timeoutMs = Number(parsed.values.timeout || 300) * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
    throw new Error(`invalid proof timeout: ${parsed.values.timeout}`);
  }
  const requestedRunId = String(
    parsed.values.run || `handoff-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const port = Number(parsed.values.port || 25578);
  const definitions: readonly HandoffResidentDefinition[] = Object.freeze([
    Object.freeze({
      role: 'giver',
      entityId: GIVER_ID,
      task: `Get the nearby dropped ${ITEM} to ${RECIPIENT_ID}. Use only ordinary Minecraft actions available to your body. The other resident must choose their own response: do not claim receipt until you observe it. Do not pick the item back up. Once you observe ${RECIPIENT_ID} collect it, yield. On a later life, remember your own side of the completed handoff and do not repeat it.`,
      allowTools: Object.freeze(['move_to', 'drop_item', 'inspect_volume']),
    }),
    Object.freeze({
      role: 'recipient',
      entityId: RECIPIENT_ID,
      task: `Receive the ${ITEM} that ${GIVER_ID} makes available in the shared world. Do not take the original ${ITEM} before ${GIVER_ID} has handled it. Wait for their newly dropped item, then walk to it so Minecraft can pick it up for your body. Claim receipt only from your own inventory and collection event, then yield. On a later life, remember your own side and do not repeat the handoff.`,
      allowTools: Object.freeze(['move_to', 'inspect_volume']),
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
    'owned-world-handoff',
    OWNED_TARGET,
  );
  const transcript: string[] = [];
  const proofStartedAt = Date.now();

  process.stdout.write(`[owned-world-handoff] native-action shared epoch with ${model}\n`);
  const act = await runPopulationPhase<IndependentWorldWitness, PopulationBodyWitness>({
    phase: 'act',
    runLabel: 'handoff',
    fixture,
    residents: residentSpecs,
    maxResidents: HANDOFF_BUDGETS.maxResidents,
    timeoutMs,
    transcript,
    milestoneLabel: 'native two-resident handoff',
    milestone: (resident, events) =>
      resident.entityId === GIVER_ID
        ? hasGiverHandoffMilestone(events, ITEM, RECIPIENT_ID)
        : hasRecipientHandoffMilestone(events, ITEM),
    witnesses: ({ run }) => collectWitnesses(run, fixture, definitions, model),
  });
  if (!act.independentWitness || act.bodyWitnesses.size !== definitions.length) {
    throw new Error('act phase did not produce every independent Minecraft witness');
  }
  const afterActTree = digestTree(fixture.runtime);

  process.stdout.write('[owned-world-handoff] restarting both persistent residents\n');
  const resume = await runPopulationPhase<IndependentWorldWitness, PopulationBodyWitness>({
    phase: 'resume',
    runLabel: 'handoff',
    fixture,
    residents: residentSpecs,
    maxResidents: HANDOFF_BUDGETS.maxResidents,
    timeoutMs,
    transcript,
    milestoneLabel: 'handoff restart turn for both residents',
    milestone: (_resident, events) => hasFirstRestartTurn(events),
  });
  const afterResumeTree = digestTree(fixture.runtime);
  const proofWallMs = Date.now() - proofStartedAt;
  const trajectories = await materializePopulationTrajectories({
    fixture,
    entityIds: definitions.map((resident) => resident.entityId),
    protocol: HANDOFF_TRAJECTORY_PROTOCOL,
    label: 'handoff',
  });
  const residentEvidence: HandoffResidentEvidence[] = definitions.map((definition) => {
    const actJournal = requiredMapValue(act.journals, definition.entityId, 'act journal');
    const resumeJournal = requiredMapValue(resume.journals, definition.entityId, 'resume journal');
    const trajectory = requiredMapValue(trajectories, definition.entityId, 'resident trajectory');
    const bodyWitness = requiredMapValue(
      act.bodyWitnesses,
      definition.entityId,
      'resident body witness',
    );
    return {
      role: definition.role,
      entityId: definition.entityId,
      model,
      task: definition.task,
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
  const assessment = assessOwnedWorldHandoffEvidence({
    worldId: OWNED_WORLD_ID,
    item: ITEM,
    actRunId: act.managedRunId,
    resumeRunId: resume.managedRunId,
    actLifecycle: act.lifecycleEvents,
    resumeLifecycle: resume.lifecycleEvents,
    independentWitness: act.independentWitness,
    residents: residentEvidence,
    budgets: HANDOFF_BUDGETS,
    proofWallMs,
  });

  const reportFile = path.join(fixture.evidenceRoot, 'handoff-report.json');
  durableWriteJson(reportFile, {
    protocol: HANDOFF_PROOF_PROTOCOL,
    status: assessment.failed.length === 0 ? 'passed' : 'failed',
    runId: fixture.runId,
    worldId: OWNED_WORLD_ID,
    item: ITEM,
    model,
    modelSelection: residentModelSelection(model),
    startedAt: fixture.startedAt,
    completedAt: new Date().toISOString(),
    proofWallMs,
    repository: { path: fixture.repository, revision: gitRevision() },
    roots: { entity: fixture.entityRoot, control: fixture.controlRoot },
    residents: definitions,
    budgets: HANDOFF_BUDGETS,
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
    path.join(fixture.evidenceRoot, 'managed-handoff-transcript.log'),
    transcript.join(''),
    'utf8',
  );
  if (assessment.failed.length > 0) {
    throw new Error(
      `handoff proof failed (${assessment.failed.join(', ')}); evidence: ${reportFile}`,
    );
  }
  process.stdout.write(`[owned-world-handoff] PASS ${reportFile}\n`);
}

async function collectWitnesses(
  run: Parameters<typeof observeFromFreshMinecraftBody>[0]['run'],
  fixture: OwnedWorldFixture,
  definitions: readonly HandoffResidentDefinition[],
  model: string,
) {
  const independentWitness = await observeFromFreshMinecraftBody({
    run,
    entityRoot: fixture.entityRoot,
    controlRoot: fixture.controlRoot,
    port: fixture.port,
    model,
    witnessId: WITNESS_ID,
    observe: (bot) => ({ droppedItems: observedDroppedItems(bot) }),
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
  if (source?.protocol !== HANDOFF_PROOF_PROTOCOL) {
    throw new Error(
      `cannot reassess unsupported handoff proof: ${source?.protocol || 'missing protocol'}`,
    );
  }
  const definitions = source.residents as readonly HandoffResidentDefinition[];
  if (!Array.isArray(definitions) || definitions.length !== 2) {
    throw new Error('handoff report does not declare exactly two residents');
  }
  const actLifecycle = verifiedLifecycleFromReport(source.evidence.act);
  const resumeLifecycle = verifiedLifecycleFromReport(source.evidence.resume);
  const integrity: Record<string, boolean> = {
    actLifecycle:
      sha256File(actLifecycle.file) === String(source.evidence.act.lifecycleSha256 || ''),
    resumeLifecycle:
      sha256File(resumeLifecycle.file) === String(source.evidence.resume.lifecycleSha256 || ''),
  };
  const residentEvidence: HandoffResidentEvidence[] = [];
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
      trajectoryEnvelope?.protocol !== HANDOFF_TRAJECTORY_PROTOCOL ||
      trajectoryEnvelope?.entityId !== definition.entityId ||
      trajectoryEnvelope?.worldId !== source.worldId ||
      !Array.isArray(trajectoryEnvelope?.turns)
    ) {
      throw new Error(`invalid handoff trajectory evidence for ${definition.entityId}`);
    }
    residentEvidence.push({
      role: definition.role,
      entityId: definition.entityId,
      model: String(source.model),
      task: definition.task,
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
  const assessment = assessOwnedWorldHandoffEvidence({
    worldId: String(source.worldId),
    item: String(source.item),
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
  const outputFile = path.join(path.dirname(sourceFile), 'handoff-report-reassessed.json');
  if (fs.existsSync(outputFile)) throw new Error(`reassessment already exists: ${outputFile}`);
  const passed = failedIntegrity.length === 0 && assessment.failed.length === 0;
  durableWriteJson(outputFile, {
    protocol: 'behold.owned-world-handoff-reassessment.v1',
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
      `existing handoff proof did not pass reassessment (${[...failedIntegrity, ...assessment.failed].join(', ')}): ${outputFile}`,
    );
  }
  process.stdout.write(`[owned-world-handoff] REASSESSED PASS ${outputFile}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `[owned-world-handoff] ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
