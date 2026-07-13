#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { eventData, parseRunJournal } from './owned-world-model-evidence';
import {
  assessOwnedWorldProjectEvidence,
  hasCompletedProjectMilestone,
  hasInterruptedProjectMilestone,
  verifiedPlacementPosition,
  type BlockPosition,
  type ProjectWorldWitness,
} from './owned-world-project-evidence';
import {
  OWNED_LEVEL_SEED,
  OWNED_WORLD_ID,
  durableWriteJson,
  gitRevision,
  listFiles,
  prepareOwnedWorld,
  readJson,
  sha256File,
} from './owned-world-fixture';
import {
  observeFromFreshMinecraftBody,
  observedBlocks,
  runManagedModelPhase,
} from './owned-world-model-harness';
import { digestTree } from './world-lab';

const PROTOCOL = 'behold.owned-world-project-proof.v1' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';
const ENTITY_ID = 'ProjectResident';
const ACT_WITNESS_ID = 'ProjectWitnessAct';
const RESUME_WITNESS_ID = 'ProjectWitnessResume';
const PROJECT_ID = 'spawn-landmark';
const MATERIAL = 'cobblestone';
const WORKSITE_Y = -60;
const MAX_HORIZONTAL_COORDINATE = 8;
const TARGET = Object.freeze({ x: 3, y: -60, z: 0, item: MATERIAL, count: 2 });
const TASK = [
  'Build a durable two-block cobblestone landmark beside spawn as one restart-worthy project.',
  `Use the stable project id "${PROJECT_ID}". Its doneWhen is that two adjacent cobblestone blocks at feet level form the landmark, and its evidence channel is world_change.`,
  `Keep both blocks at y=${WORKSITE_Y} and within x/z -${MAX_HORIZONTAL_COORDINATE}..${MAX_HORIZONTAL_COORDINATE}. Inspect the local volume before choosing empty cells. Never place at the same coordinate twice.`,
  'This proof deliberately spans two lives. In the first life, start the project, collect the nearby two-cobblestone stack, place exactly one block, and wait for Minecraft confirmation. Then update the project so nextStep explicitly says to place the remaining second block adjacent to the first marker block, and choose wait_for_event. Do not place the second block or complete the project in the first life.',
  'In the later life, use your active project and prior consequence. Before any physical action, use manage_project update to restate that the remaining second block must be placed adjacent to the first marker block. Then place exactly one distinct adjacent block, complete the project only after Minecraft confirms it, and choose wait_for_event.',
].join(' ');
const ALLOW_TOOLS = Object.freeze([
  'manage_project',
  'collect_nearby_item',
  'inspect_volume',
  'place_block',
]);

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
      'Usage: owned-world-project-proof [--run <safe-id>] [--port <unused-loopback-port>] [--model <OpenRouter-slug>] [--timeout <seconds>] [--reassess <project-report.json>]\n',
    );
    return;
  }
  if (parsed.values.reassess) {
    reassessExistingProof(String(parsed.values.reassess));
    return;
  }

  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey || apiKey.length < 12) {
    throw new Error(
      'OPENROUTER_API_KEY is required for the real project proof; no world was generated and no model call was attempted',
    );
  }
  const model = String(parsed.values.model || process.env.LLM_MODEL || DEFAULT_MODEL).trim();
  if (!model) throw new Error('a non-empty model slug is required');
  const timeoutMs = Number(parsed.values.timeout || 360) * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 1_200_000) {
    throw new Error(`invalid proof timeout: ${parsed.values.timeout}`);
  }
  const requestedRunId = String(
    parsed.values.run || `project-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const port = Number(parsed.values.port || 25587);
  const fixture = await prepareOwnedWorld(requestedRunId, port, 'owned-world-project', TARGET);
  const transcript: string[] = [];

  process.stdout.write(`[owned-world-project] first life with ${model}\n`);
  const act = await runManagedModelPhase<ProjectWorldWitness>({
    phase: 'act',
    fixture,
    entityId: ENTITY_ID,
    model,
    task: TASK,
    allowTools: ALLOW_TOOLS,
    timeoutMs,
    agentTickMs: 5000,
    transcript,
    milestone: (events) => hasInterruptedProjectMilestone(events, PROJECT_ID, MATERIAL),
    witness: ({ run, events }) => {
      const firstPosition = requireOnePlacement(events, 'first-life');
      return observeFromFreshMinecraftBody({
        run,
        entityRoot: fixture.entityRoot,
        controlRoot: fixture.controlRoot,
        port,
        model,
        witnessId: ACT_WITNESS_ID,
        settleMs: 100,
        observe: (bot) => ({ blocks: observedBlocks(bot, [firstPosition]) }),
      });
    },
    logPrefix: 'owned-world-project',
  });
  if (!act.witness) throw new Error('act phase did not produce an independent witness');
  const firstPosition = requireOnePlacement(act.events, 'first-life');
  const afterActTree = digestTree(fixture.runtime);

  process.stdout.write('[owned-world-project] restarting the same persistent inhabitant\n');
  const resume = await runManagedModelPhase<ProjectWorldWitness>({
    phase: 'resume',
    fixture,
    entityId: ENTITY_ID,
    model,
    task: TASK,
    allowTools: ALLOW_TOOLS,
    timeoutMs,
    agentTickMs: 5000,
    transcript,
    milestone: (events) =>
      hasCompletedProjectMilestone(events, PROJECT_ID, MATERIAL, firstPosition),
    witness: ({ run, events }) => {
      const secondPosition = requireOnePlacement(events, 'restart');
      return observeFromFreshMinecraftBody({
        run,
        entityRoot: fixture.entityRoot,
        controlRoot: fixture.controlRoot,
        port,
        model,
        witnessId: RESUME_WITNESS_ID,
        settleMs: 100,
        observe: (bot) => ({
          blocks: observedBlocks(bot, [firstPosition, secondPosition]),
        }),
      });
    },
    logPrefix: 'owned-world-project',
  });
  if (!resume.witness) throw new Error('resume phase did not produce an independent witness');
  const afterResumeTree = digestTree(fixture.runtime);

  const expectation = {
    worldId: OWNED_WORLD_ID,
    entityId: ENTITY_ID,
    model,
    task: TASK,
    projectId: PROJECT_ID,
    material: MATERIAL,
    worksiteY: WORKSITE_Y,
    maxHorizontalCoordinate: MAX_HORIZONTAL_COORDINATE,
    actRunId: act.managedRunId,
    resumeRunId: resume.managedRunId,
  };
  const assessment = assessOwnedWorldProjectEvidence(
    act.events,
    resume.events,
    act.witness,
    resume.witness,
    expectation,
  );
  const loomFiles = listFiles(path.join(fixture.entityRoot, ENTITY_ID, 'lync')).filter((file) =>
    file.endsWith('.lync'),
  );
  if (loomFiles.length !== 1) {
    throw new Error(
      `expected one authoritative project-resident Lync log, found ${loomFiles.length}`,
    );
  }
  const reportFile = path.join(fixture.evidenceRoot, 'project-report.json');
  durableWriteJson(reportFile, {
    protocol: PROTOCOL,
    status: assessment.failed.length === 0 ? 'passed' : 'failed',
    runId: fixture.runId,
    worldId: OWNED_WORLD_ID,
    entityId: ENTITY_ID,
    model,
    task: TASK,
    projectId: PROJECT_ID,
    startedAt: fixture.startedAt,
    completedAt: new Date().toISOString(),
    repository: { path: fixture.repository, revision: gitRevision() },
    server: {
      version: String(fixture.toolLock.tools.minecraftServer.version),
      jar: fixture.serverJar,
      sha256: fixture.actualServerJarSha256,
      java: fixture.java,
      port,
      seed: OWNED_LEVEL_SEED,
      generation: fixture.generation,
      preparedResource: TARGET,
    },
    evidence: {
      sourceTree: fixture.sourceTree,
      baselineTree: fixture.baselineTree,
      initialRuntimeTree: fixture.initialRuntimeTree,
      afterActTree,
      afterResumeTree,
      firstWitness: act.witness,
      finalWitness: resume.witness,
      loomFile: loomFiles[0],
      loomSha256: sha256File(loomFiles[0]),
      act: phaseEvidence(act),
      resume: phaseEvidence(resume),
    },
    expectation,
    assessment,
  });
  fs.writeFileSync(
    path.join(fixture.evidenceRoot, 'managed-project-transcript.log'),
    transcript.join(''),
    'utf8',
  );
  if (assessment.failed.length > 0) {
    throw new Error(
      `persistent project proof failed (${assessment.failed.join(', ')}); evidence: ${reportFile}`,
    );
  }
  process.stdout.write(`[owned-world-project] PASS ${reportFile}\n`);
}

function phaseEvidence(phase: {
  managedRunId: string;
  journalFile: string;
  journalSha256: string;
  lifecycleFile: string;
  lifecycleTipDigest: string | null;
  lifecycleEvents: number;
}) {
  return {
    managedRunId: phase.managedRunId,
    journalFile: phase.journalFile,
    journalSha256: phase.journalSha256,
    lifecycleFile: phase.lifecycleFile,
    lifecycleTipDigest: phase.lifecycleTipDigest,
    lifecycleEvents: phase.lifecycleEvents,
  };
}

function requireOnePlacement(events: readonly any[], phase: string): BlockPosition {
  const positions = eventData(events, 'entity_turn')
    .map(verifiedPlacementPosition)
    .filter((position): position is BlockPosition => position != null);
  if (positions.length !== 1) {
    throw new Error(`${phase} expected exactly one verified placement, found ${positions.length}`);
  }
  return positions[0];
}

function reassessExistingProof(inputFile: string) {
  const sourceFile = path.resolve(inputFile);
  const source = readJson(sourceFile);
  if (source?.protocol !== PROTOCOL) {
    throw new Error(`cannot reassess unsupported proof: ${source?.protocol || 'missing protocol'}`);
  }
  const actJournalFile = path.resolve(String(source?.evidence?.act?.journalFile || ''));
  const resumeJournalFile = path.resolve(String(source?.evidence?.resume?.journalFile || ''));
  const loomFile = path.resolve(String(source?.evidence?.loomFile || ''));
  const integrity = {
    actJournal: sha256File(actJournalFile) === String(source?.evidence?.act?.journalSha256 || ''),
    resumeJournal:
      sha256File(resumeJournalFile) === String(source?.evidence?.resume?.journalSha256 || ''),
    loom: sha256File(loomFile) === String(source?.evidence?.loomSha256 || ''),
  };
  const assessment = assessOwnedWorldProjectEvidence(
    parseRunJournal(fs.readFileSync(actJournalFile, 'utf8')),
    parseRunJournal(fs.readFileSync(resumeJournalFile, 'utf8')),
    source.evidence.firstWitness,
    source.evidence.finalWitness,
    source.expectation,
  );
  const failedIntegrity = Object.entries(integrity)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  const outputFile = path.join(path.dirname(sourceFile), 'project-report-reassessed.json');
  if (fs.existsSync(outputFile)) throw new Error(`reassessment already exists: ${outputFile}`);
  const passed = failedIntegrity.length === 0 && assessment.failed.length === 0;
  durableWriteJson(outputFile, {
    protocol: 'behold.owned-world-project-reassessment.v1',
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
      `existing project proof did not pass reassessment (${[
        ...failedIntegrity,
        ...assessment.failed,
      ].join(', ')}): ${outputFile}`,
    );
  }
  process.stdout.write(`[owned-world-project] REASSESSED PASS ${outputFile}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `[owned-world-project] ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
