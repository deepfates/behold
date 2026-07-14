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
import { hasFirstRestartTurn, type IndependentWorldWitness } from './owned-world-model-evidence';
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
      task: `First walk to and pick up the nearby dropped ${ITEM}; it is not yet the handoff. Then drop that owned ${ITEM} for ${RECIPIENT_ID}. Use only ordinary Minecraft actions available to your body. The other resident must choose their own response: do not claim receipt until you observe it. Do not pick the item back up. Once you observe ${RECIPIENT_ID} collect it, yield. On a later life, remember your own side of the completed handoff and do not repeat it.`,
      allowTools: Object.freeze(['move_to', 'drop_item']),
    }),
    Object.freeze({
      role: 'recipient',
      entityId: RECIPIENT_ID,
      task: `Receive the ${ITEM} that ${GIVER_ID} makes available in the shared world. Do not take the original ${ITEM} before ${GIVER_ID} has handled it. Wait for their newly dropped item, then walk to it so Minecraft can pick it up for your body. Claim receipt only from your own inventory and collection event, then yield. On a later life, remember your own side and do not repeat the handoff.`,
      allowTools: Object.freeze(['move_to']),
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
    residentStartupDelayMs: 8_000,
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
    return {
      ...populationResidentArtifacts({
        entityId: definition.entityId,
        act,
        resume,
        trajectories,
      }),
      role: definition.role,
      model,
      task: definition.task,
    };
  });
  const assessment = assessOwnedWorldHandoffEvidence({
    worldId: OWNED_WORLD_ID,
    item: ITEM,
    initialItemPosition: OWNED_TARGET,
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
    initialItemPosition: OWNED_TARGET,
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
    evidence: populationEvidenceReport({
      fixture,
      act,
      resume,
      afterActTree,
      afterResumeTree,
      residents: residentEvidence,
      trajectories,
    }),
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
  const loaded = await loadPopulationReassessment<
    HandoffResidentDefinition,
    PopulationBodyWitness,
    HandoffResidentEvidence
  >(inputFile, {
    proofProtocol: HANDOFF_PROOF_PROTOCOL,
    trajectoryProtocol: HANDOFF_TRAJECTORY_PROTOCOL,
    reportLabel: 'handoff',
    expectedResidentCount: 2,
    createResident: ({ definition, source, artifacts }) => ({
      ...artifacts,
      role: definition.role,
      model: String(source.model),
      task: definition.task,
    }),
  });
  const { source } = loaded;
  const assessment = assessOwnedWorldHandoffEvidence({
    worldId: String(source.worldId),
    item: String(source.item),
    initialItemPosition: source.initialItemPosition,
    actRunId: String(source.evidence.act.managedRunId),
    resumeRunId: String(source.evidence.resume.managedRunId),
    actLifecycle: loaded.actLifecycle.events,
    resumeLifecycle: loaded.resumeLifecycle.events,
    independentWitness: source.evidence.independentWitness,
    residents: loaded.residents,
    budgets: source.budgets,
    proofWallMs: Number(source.proofWallMs),
  });
  const result = writePopulationReassessment({
    loaded,
    assessment,
    protocol: 'behold.owned-world-handoff-reassessment.v1',
    outputName: 'handoff-report-reassessed.json',
  });
  if (!result.passed) {
    throw new Error(
      `existing handoff proof did not pass reassessment (${[...result.failedIntegrity, ...assessment.failed].join(', ')}): ${result.outputFile}`,
    );
  }
  process.stdout.write(`[owned-world-handoff] REASSESSED PASS ${result.outputFile}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `[owned-world-handoff] ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
