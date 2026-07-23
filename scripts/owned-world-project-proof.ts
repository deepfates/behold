#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import { eventData, parseRunJournal } from './owned-world-model-evidence';
import {
  assessProjectPlaceBinding,
  assessOwnedWorldProjectEvidence,
  hasCompletedProjectMilestone,
  hasInterruptedProjectMilestone,
  verifiedPlacementPosition,
  type BlockPosition,
  type ProjectWorldWitness,
} from './owned-world-project-evidence';
import {
  OWNED_LEVEL_SEED,
  durableWriteJson,
  gitRevision,
  listFiles,
  prepareAdmittedPlaceWorld,
  prepareOwnedWorld,
  readJson,
  sha256File,
} from './owned-world-fixture';
import {
  observeFromFreshMinecraftBody,
  observedBlocks,
  runManagedModelPhase,
} from './owned-world-model-harness';
import { DEFAULT_RESIDENT_MODEL } from './resident-model-selection';
import { digestTree } from './world-lab';

const PROTOCOL = 'behold.owned-world-project-proof.v1' as const;
const ENTITY_ID = 'ProjectResident';
const ACT_WITNESS_ID = 'ProjWitnessAct';
const RESUME_WITNESS_ID = 'ProjWitnessDone';
const PROJECT_ID = 'spawn-landmark';
const MATERIAL = 'cobblestone';
const CONTEXT_BASELINE = Object.freeze({
  runId: 'project-v2-deepseek-v4-20260713',
  promptTokens: 227_642,
  maxPromptTokens: 36_636,
  maxRequestBodyChars: 150_331,
});
const CONTEXT_BUDGET = Object.freeze({
  maxTotalPromptTokens: 113_821,
  maxPromptTokensPerCall: 18_318,
  maxRequestBodyChars: 75_165,
});
const TARGET = Object.freeze({ x: 3, y: -60, z: 0, item: MATERIAL, count: 2 });
const DEFAULT_FIRST_BLOCK = Object.freeze({ x: 2, y: -60, z: 2 });
const DEFAULT_SECOND_BLOCK = Object.freeze({ x: 3, y: -60, z: 2 });
const ALLOW_TOOLS = Object.freeze(['manage_project', 'collect_nearby_item', 'place_block']);

async function main() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: 'string' },
      port: { type: 'string' },
      model: { type: 'string' },
      timeout: { type: 'string' },
      reassess: { type: 'string' },
      'place-epoch': { type: 'string' },
      arrival: { type: 'string' },
      affordance: { type: 'string' },
      'first-block': { type: 'string' },
      'second-block': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help) {
    process.stdout.write(
      'Usage:\n' +
        '  owned-world-project-proof [--run <safe-id>] [--port <unused-loopback-port>] [--model <OpenRouter-slug>] [--timeout <seconds>]\n' +
        '  owned-world-project-proof --place-epoch <admitted-dir> --arrival <x,y,z> --affordance <x,y,z> --first-block <x,y,z> --second-block <x,y,z> [--run <safe-id>] [--model <OpenRouter-slug>]\n' +
        '  owned-world-project-proof --reassess <project-report.json>\n',
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
  const model = String(
    parsed.values.model || process.env.BEHOLD_PROJECT_MODEL || DEFAULT_RESIDENT_MODEL,
  ).trim();
  if (!model) throw new Error('a non-empty model slug is required');
  const timeoutMs = Number(parsed.values.timeout || 360) * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 1_200_000) {
    throw new Error(`invalid proof timeout: ${parsed.values.timeout}`);
  }
  const requestedRunId = String(
    parsed.values.run || `project-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const admittedRoot = parsed.values['place-epoch']
    ? path.resolve(String(parsed.values['place-epoch']))
    : null;
  if (admittedRoot && parsed.values.port) {
    throw new Error('a Place epoch owns its configured port; do not pass --port');
  }
  if (
    !admittedRoot &&
    (parsed.values.arrival ||
      parsed.values.affordance ||
      parsed.values['first-block'] ||
      parsed.values['second-block'])
  ) {
    throw new Error('Place worksite coordinates require --place-epoch');
  }
  const firstBlock = admittedRoot
    ? parsePoint(requiredOption(parsed.values['first-block'], '--first-block'))
    : DEFAULT_FIRST_BLOCK;
  const secondBlock = admittedRoot
    ? parsePoint(requiredOption(parsed.values['second-block'], '--second-block'))
    : DEFAULT_SECOND_BLOCK;
  assertAdjacent(firstBlock, secondBlock);
  const target = admittedRoot
    ? {
        ...parsePoint(requiredOption(parsed.values.affordance, '--affordance')),
        item: MATERIAL,
        count: 2,
      }
    : TARGET;
  const fixture = admittedRoot
    ? await prepareAdmittedPlaceWorld(
        requestedRunId,
        admittedRoot,
        parsePoint(requiredOption(parsed.values.arrival, '--arrival')),
        target,
      )
    : await prepareOwnedWorld(
        requestedRunId,
        Number(parsed.values.port || 25587),
        'owned-world-project',
        target,
      );
  const port = fixture.port;
  const task = projectTask(firstBlock, secondBlock);
  const transcript: string[] = [];

  process.stdout.write(`[owned-world-project] first life with ${model}\n`);
  const act = await runManagedModelPhase<ProjectWorldWitness>({
    phase: 'act',
    fixture,
    entityId: ENTITY_ID,
    model,
    task,
    allowTools: ALLOW_TOOLS,
    timeoutMs,
    agentTickMs: 5000,
    transcript,
    milestone: (events) => hasInterruptedProjectMilestone(events, PROJECT_ID, MATERIAL, firstBlock),
    witness: ({ run, events }) => {
      const firstPosition = requireOnePlacement(events, 'first-life');
      return observeFromFreshMinecraftBody({
        run,
        worldId: fixture.worldId,
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
    task,
    allowTools: ALLOW_TOOLS,
    timeoutMs,
    agentTickMs: 5000,
    transcript,
    milestone: (events) =>
      hasCompletedProjectMilestone(events, PROJECT_ID, MATERIAL, firstPosition, secondBlock),
    witness: ({ run, events }) => {
      const secondPosition = requireOnePlacement(events, 'restart');
      return observeFromFreshMinecraftBody({
        run,
        worldId: fixture.worldId,
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
  const finalSourceTree = digestTree(fixture.source);
  const finalBaselineTree = digestTree(fixture.baseline);

  const expectation = {
    worldId: fixture.worldId,
    entityId: ENTITY_ID,
    model,
    task,
    projectId: PROJECT_ID,
    material: MATERIAL,
    firstBlock,
    secondBlock,
    actRunId: act.managedRunId,
    resumeRunId: resume.managedRunId,
    contextBudget: CONTEXT_BUDGET,
  };
  const assessment = assessOwnedWorldProjectEvidence(
    act.events,
    resume.events,
    act.witness,
    resume.witness,
    expectation,
  );
  const placeAssessment = fixture.placeEpoch
    ? assessProjectPlaceBinding({
        worldId: fixture.worldId,
        serverJarSha256: fixture.actualServerJarSha256,
        descriptor: fixture.placeEpoch,
        declaredDescriptorSha256: fixture.admissionDescriptorSha256,
        actualDescriptorSha256: sha256File(fixture.admissionDescriptorFile),
        sourceTree: fixture.sourceTree,
        baselineTree: fixture.baselineTree,
        admittedRuntimeTree: fixture.admittedRuntimeTree,
        initialRuntimeTree: fixture.initialRuntimeTree,
        afterActTree,
        afterResumeTree,
        finalSourceTree,
        finalBaselineTree,
      })
    : null;
  const failed = [...assessment.failed, ...(placeAssessment?.failed ?? [])];
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
    status: failed.length === 0 ? 'passed' : 'failed',
    runId: fixture.runId,
    worldId: fixture.worldId,
    entityId: ENTITY_ID,
    model,
    task,
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
      seed: fixture.placeEpoch ? null : OWNED_LEVEL_SEED,
      generation: fixture.generation,
      preparedResource: target,
    },
    placeEpoch: fixture.placeEpoch,
    admission: fixture.placeEpoch
      ? {
          root: fixture.admissionRoot,
          descriptorFile: fixture.admissionDescriptorFile,
          descriptorSha256: fixture.admissionDescriptorSha256,
        }
      : null,
    evidence: {
      sourceTree: fixture.sourceTree,
      baselineTree: fixture.baselineTree,
      admittedRuntimeTree: fixture.admittedRuntimeTree,
      initialRuntimeTree: fixture.initialRuntimeTree,
      afterActTree,
      afterResumeTree,
      finalSourceTree,
      finalBaselineTree,
      firstWitness: act.witness,
      finalWitness: resume.witness,
      loomFile: loomFiles[0],
      loomSha256: sha256File(loomFiles[0]),
      act: phaseEvidence(act),
      resume: phaseEvidence(resume),
    },
    expectation,
    contextEfficiency: {
      baseline: CONTEXT_BASELINE,
      budget: CONTEXT_BUDGET,
      measured: assessment.usage,
      promptTokenReductionFraction: reduction(
        CONTEXT_BASELINE.promptTokens,
        assessment.usage.promptTokens,
      ),
      maxPromptTokenReductionFraction: reduction(
        CONTEXT_BASELINE.maxPromptTokens,
        assessment.usage.maxPromptTokens,
      ),
      maxRequestBodyReductionFraction: reduction(
        CONTEXT_BASELINE.maxRequestBodyChars,
        assessment.usage.maxRequestBodyChars,
      ),
    },
    assessment,
    placeAssessment,
  });
  fs.writeFileSync(
    path.join(fixture.evidenceRoot, 'managed-project-transcript.log'),
    transcript.join(''),
    'utf8',
  );
  if (failed.length > 0) {
    throw new Error(
      `persistent project proof failed (${failed.join(', ')}); evidence: ${reportFile}`,
    );
  }
  process.stdout.write(`[owned-world-project] PASS ${reportFile}\n`);
}

function projectTask(firstBlock: BlockPosition, secondBlock: BlockPosition) {
  const first = formatPoint(firstBlock);
  const second = formatPoint(secondBlock);
  return [
    'Build a durable two-block cobblestone landmark beside spawn as one restart-worthy project.',
    `Use the stable project id "${PROJECT_ID}". Its doneWhen is that cobblestone blocks at ${first} and ${second} form the landmark, and its evidence channel is world_change.`,
    `Those two cells are adjacent, empty, and supported in this prepared evaluation. Use your ordinary first-person observation; no loaded-world scan is available. Never place at any other coordinate and never place at the same coordinate twice.`,
    `This proof deliberately spans two lives. In the first life, secure the nearby two-cobblestone stack before it expires, start the project before construction, place exactly one block at ${first}, and wait for Minecraft confirmation. Then update the project so nextStep explicitly says to place the remaining second block at ${second} adjacent to the first marker block, and choose wait_for_event. Do not place the second block or complete the project in the first life.`,
    `In the later life, use your active project and prior consequence. Before any physical action, use manage_project update to restate that the remaining second block must be placed at ${second} adjacent to the first marker block. Then place exactly one block at ${second}, complete the project only after Minecraft confirms it, and choose wait_for_event.`,
  ].join(' ');
}

function requiredOption(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is required with --place-epoch`);
  return value;
}

function parsePoint(value: string): BlockPosition {
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 3 || !parts.every(Number.isSafeInteger)) {
    throw new Error(`expected integer x,y,z point, received ${value}`);
  }
  return { x: parts[0], y: parts[1], z: parts[2] };
}

function assertAdjacent(first: BlockPosition, second: BlockPosition) {
  if (
    Math.abs(first.x - second.x) + Math.abs(first.y - second.y) + Math.abs(first.z - second.z) !==
    1
  ) {
    throw new Error(
      `project blocks must be distinct face-adjacent cells: ${formatPoint(first)} and ${formatPoint(second)}`,
    );
  }
}

function formatPoint(point: BlockPosition) {
  return `${point.x},${point.y},${point.z}`;
}

function reduction(baseline: number, measured: number) {
  return Math.round((1 - measured / baseline) * 1_000_000) / 1_000_000;
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
  const actLifecycleFile = path.resolve(String(source?.evidence?.act?.lifecycleFile || ''));
  const resumeLifecycleFile = path.resolve(String(source?.evidence?.resume?.lifecycleFile || ''));
  const actEvents = parseRunJournal(fs.readFileSync(actJournalFile, 'utf8'));
  const resumeEvents = parseRunJournal(fs.readFileSync(resumeJournalFile, 'utf8'));
  const actLifecycle = verifyWorldLifecycleJournal(actLifecycleFile);
  const resumeLifecycle = verifyWorldLifecycleJournal(resumeLifecycleFile);
  const placeAssessment = source.placeEpoch
    ? assessProjectPlaceBinding({
        worldId: source.worldId,
        serverJarSha256: source.server.sha256,
        descriptor: source.placeEpoch,
        declaredDescriptorSha256: source.admission.descriptorSha256,
        actualDescriptorSha256: sha256File(path.resolve(source.admission.descriptorFile)),
        sourceTree: source.evidence.sourceTree,
        baselineTree: source.evidence.baselineTree,
        admittedRuntimeTree: source.evidence.admittedRuntimeTree,
        initialRuntimeTree: source.evidence.initialRuntimeTree,
        afterActTree: source.evidence.afterActTree,
        afterResumeTree: source.evidence.afterResumeTree,
        finalSourceTree: digestTree(path.resolve(source.placeEpoch.paths.source)),
        finalBaselineTree: digestTree(path.resolve(source.placeEpoch.paths.baseline)),
      })
    : null;
  const integrity = {
    sourceReportPassed: source.status === 'passed',
    actJournal: sha256File(actJournalFile) === String(source?.evidence?.act?.journalSha256 || ''),
    resumeJournal:
      sha256File(resumeJournalFile) === String(source?.evidence?.resume?.journalSha256 || ''),
    loom: sha256File(loomFile) === String(source?.evidence?.loomSha256 || ''),
    lyncTrajectory: verifyProjectLyncTrajectory(loomFile, source, actEvents, resumeEvents),
    actLifecycle:
      actLifecycle.tipDigest === source?.evidence?.act?.lifecycleTipDigest &&
      actLifecycle.events.length === source?.evidence?.act?.lifecycleEvents,
    resumeLifecycle:
      resumeLifecycle.tipDigest === source?.evidence?.resume?.lifecycleTipDigest &&
      resumeLifecycle.events.length === source?.evidence?.resume?.lifecycleEvents,
    lifecycleSeparation:
      actLifecycleFile !== resumeLifecycleFile &&
      source?.evidence?.act?.managedRunId !== source?.evidence?.resume?.managedRunId,
    placeBinding: placeAssessment == null || placeAssessment.failed.length === 0,
  };
  const assessment = assessOwnedWorldProjectEvidence(
    actEvents,
    resumeEvents,
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
    placeAssessment,
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

function verifyProjectLyncTrajectory(
  file: string,
  report: any,
  actEvents: readonly any[],
  resumeEvents: readonly any[],
) {
  try {
    const records = fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    const roots = records.filter((record) => record?.kind === 'lync/loom');
    const links = records.filter((record) => record?.kind === 'lync/turn');
    const turns = [
      ...eventData(actEvents, 'entity_turn'),
      ...eventData(resumeEvents, 'entity_turn'),
    ];
    if (
      records.length !== roots.length + links.length ||
      roots.length !== 1 ||
      links.length !== turns.length ||
      roots[0]?.payload?.meta?.protocol !== 'behold.entity-loom.v1' ||
      roots[0]?.payload?.meta?.entityId !== report.entityId ||
      roots[0]?.payload?.meta?.circleId !== report.worldId
    ) {
      return false;
    }
    return links.every((link, index) => {
      const sequence = index + 1;
      const turn = link?.payload?.payload;
      const meta = link?.payload?.meta;
      return (
        meta?.protocol === 'behold.entity-turn-link.v1' &&
        meta?.entityId === report.entityId &&
        meta?.sequence === sequence &&
        meta?.legacyId === `${report.entityId}:turn:${sequence}` &&
        turn?.protocol === 'behold.entity-turn.v1' &&
        turn?.circleId === report.worldId &&
        turn?.entityId === report.entityId &&
        turn?.sequence === sequence &&
        turn?.parentId === (sequence === 1 ? null : `${report.entityId}:turn:${sequence - 1}`) &&
        isDeepStrictEqual(turn, turns[index])
      );
    });
  } catch {
    return false;
  }
}

void main().catch((error) => {
  process.stderr.write(
    `[owned-world-project] ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
