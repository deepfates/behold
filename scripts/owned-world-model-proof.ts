#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_LLM_MODEL } from '../src/config';
import {
  assessOwnedWorldModelEvidence,
  hasCollectionFollowedByYield,
  hasFirstRestartTurn,
  parseRunJournal,
  type IndependentWorldWitness,
} from './owned-world-model-evidence';
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
  observedDroppedItems,
  runManagedModelPhase,
} from './owned-world-model-harness';
import { digestTree } from './world-lab';

const PROTOCOL = 'behold.owned-world-model-proof.v1' as const;
const ENTITY_ID = 'ModelResident';
const WITNESS_ID = 'ModelWitness';
const TASK =
  'Care for your immediate situation: notice and secure any safe, useful loose resource you can actually perceive. Once that has succeeded, yield and remember the result. On a later life, continue from your own history and do not repeat completed physical work.';
const ALLOW_TOOLS = Object.freeze(['collect_nearby_item', 'inspect_volume']);

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
      'Usage: owned-world-model-proof [--run <safe-id>] [--port <unused-loopback-port>] [--model <OpenRouter-slug>] [--timeout <seconds>] [--reassess <model-report.json>]\n',
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
      'OPENROUTER_API_KEY is required for the real-model proof; no world was generated and no model call was attempted',
    );
  }
  const model = String(parsed.values.model || process.env.LLM_MODEL || DEFAULT_LLM_MODEL).trim();
  if (!model) throw new Error('a non-empty model slug is required');
  const timeoutMs = Number(parsed.values.timeout || 240) * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
    throw new Error(`invalid proof timeout: ${parsed.values.timeout}`);
  }
  const requestedRunId = String(
    parsed.values.run || `model-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const port = Number(parsed.values.port || 25576);
  const fixture = await prepareOwnedWorld(requestedRunId, port, 'owned-world-model');
  const transcript: string[] = [];

  const runPhase = (phase: 'act' | 'resume') =>
    runManagedModelPhase({
      phase,
      fixture,
      entityId: ENTITY_ID,
      model,
      task: TASK,
      allowTools: ALLOW_TOOLS,
      timeoutMs,
      transcript,
      milestone: (events) =>
        phase === 'act' ? hasCollectionFollowedByYield(events) : hasFirstRestartTurn(events),
      witness:
        phase === 'act'
          ? ({ run }) =>
              observeFromFreshMinecraftBody({
                run,
                entityRoot: fixture.entityRoot,
                controlRoot: fixture.controlRoot,
                port,
                model,
                witnessId: WITNESS_ID,
                observe: (bot) => ({ droppedItems: observedDroppedItems(bot) }),
              })
          : undefined,
    });

  process.stdout.write(`[owned-world-model] first life with ${model}\n`);
  const act = await runPhase('act');
  if (!act.witness) throw new Error('act phase did not produce an independent witness');
  const afterActTree = digestTree(fixture.runtime);
  process.stdout.write('[owned-world-model] restarting the same model inhabitant\n');
  const resume = await runPhase('resume');
  const afterResumeTree = digestTree(fixture.runtime);

  const assessment = assessOwnedWorldModelEvidence(
    act.events,
    resume.events,
    act.witness as IndependentWorldWitness,
    {
      worldId: OWNED_WORLD_ID,
      entityId: ENTITY_ID,
      model,
      task: TASK,
      actRunId: act.managedRunId,
      resumeRunId: resume.managedRunId,
    },
  );
  const loomFiles = listFiles(path.join(fixture.entityRoot, ENTITY_ID, 'lync')).filter((file) =>
    file.endsWith('.lync'),
  );
  if (loomFiles.length !== 1) {
    throw new Error(
      `expected one authoritative model-resident Lync log, found ${loomFiles.length}`,
    );
  }
  const reportFile = path.join(fixture.evidenceRoot, 'model-report.json');
  durableWriteJson(reportFile, {
    protocol: PROTOCOL,
    status: assessment.failed.length === 0 ? 'passed' : 'failed',
    runId: fixture.runId,
    worldId: OWNED_WORLD_ID,
    entityId: ENTITY_ID,
    model,
    task: TASK,
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
    },
    evidence: {
      sourceTree: fixture.sourceTree,
      baselineTree: fixture.baselineTree,
      initialRuntimeTree: fixture.initialRuntimeTree,
      afterActTree,
      afterResumeTree,
      independentWitness: act.witness,
      loomFile: loomFiles[0],
      loomSha256: sha256File(loomFiles[0]),
      act: {
        managedRunId: act.managedRunId,
        journalFile: act.journalFile,
        journalSha256: act.journalSha256,
        lifecycleFile: act.lifecycleFile,
        lifecycleTipDigest: act.lifecycleTipDigest,
        lifecycleEvents: act.lifecycleEvents,
      },
      resume: {
        managedRunId: resume.managedRunId,
        journalFile: resume.journalFile,
        journalSha256: resume.journalSha256,
        lifecycleFile: resume.lifecycleFile,
        lifecycleTipDigest: resume.lifecycleTipDigest,
        lifecycleEvents: resume.lifecycleEvents,
      },
    },
    assessment,
  });
  fs.writeFileSync(
    path.join(fixture.evidenceRoot, 'managed-model-transcript.log'),
    transcript.join(''),
    'utf8',
  );
  if (assessment.failed.length > 0) {
    throw new Error(
      `model inhabitant proof failed (${assessment.failed.join(', ')}); evidence: ${reportFile}`,
    );
  }
  process.stdout.write(`[owned-world-model] PASS ${reportFile}\n`);
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
  const assessment = assessOwnedWorldModelEvidence(
    parseRunJournal(fs.readFileSync(actJournalFile, 'utf8')),
    parseRunJournal(fs.readFileSync(resumeJournalFile, 'utf8')),
    source.evidence.independentWitness,
    {
      worldId: String(source.worldId),
      entityId: String(source.entityId),
      model: String(source.model),
      task: String(source.task),
      actRunId: String(source.evidence.act.managedRunId),
      resumeRunId: String(source.evidence.resume.managedRunId),
    },
  );
  const failedIntegrity = Object.entries(integrity)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  const outputFile = path.join(path.dirname(sourceFile), 'model-report-reassessed.json');
  if (fs.existsSync(outputFile)) throw new Error(`reassessment already exists: ${outputFile}`);
  const passed = failedIntegrity.length === 0 && assessment.failed.length === 0;
  durableWriteJson(outputFile, {
    protocol: 'behold.owned-world-model-reassessment.v1',
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
      `existing model proof did not pass reassessment (${[...failedIntegrity, ...assessment.failed].join(', ')}): ${outputFile}`,
    );
  }
  process.stdout.write(`[owned-world-model] REASSESSED PASS ${outputFile}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `[owned-world-model] ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
