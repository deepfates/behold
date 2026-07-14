#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readEntityLifeRange } from '../src/entity/loom';
import {
  assessDecisionTurn,
  assessUncoachedDecisionTurn,
  assessWorldActionTurn,
} from '../src/evaluation/causal-turn';
import { openEvaluationEpisode } from '../src/evaluation/episode';
import {
  createResidentMindRequestArtifact,
  parseResidentMindRequestArtifact,
} from '../src/mind/request-artifact';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import { parseRunJournal } from './owned-world-model-evidence';
import {
  assertCleanRepository,
  durableWriteJson,
  gitRevision,
  sha256File,
} from './owned-world-fixture';

const SOURCE_PROTOCOLS = new Set(['behold.neutral-turn-proof.v2', 'behold.neutral-turn-proof.v3']);

export async function reassessNeutralTurn(resultPath: string) {
  const resultFile = path.resolve(resultPath);
  const root = path.dirname(path.dirname(resultFile));
  const source = readJson(resultFile);
  if (!SOURCE_PROTOCOLS.has(source?.protocol)) {
    throw new Error(`unsupported neutral turn proof protocol: ${source?.protocol || 'missing'}`);
  }
  if (source?.claim !== 'decision' && source?.claim !== 'world-action') {
    throw new Error('neutral turn proof claim is invalid');
  }
  if (path.resolve(String(source?.evidence?.root || '')) !== root) {
    throw new Error('neutral turn proof root does not match its result location');
  }

  const journalFile = evidenceFile(root, source?.evidence?.journalFile, 'run journal');
  const lifecycleFile = evidenceFile(root, source?.evidence?.lifecycleFile, 'world lifecycle');
  const episodeFile = evidenceFile(root, source?.evidence?.episodeFile, 'evaluation episode');
  const requestFile = evidenceFile(root, source?.evidence?.requestFile, 'private mind request');
  if ((fs.statSync(requestFile).mode & 0o777) !== 0o600) {
    throw new Error('private mind request must have mode 0600');
  }

  const storedDecisionBinding = source?.decisionAssessment?.binding;
  const episodeDirectory = path.dirname(episodeFile);
  const entityRoot = path.join(root, 'entities');
  const episode = await openEvaluationEpisode(
    episodeDirectory,
    entityRoot,
    storedDecisionBinding?.episode?.loom,
    'behold-neutral-turn-reassessor',
  );
  try {
    if (path.resolve(episode.file) !== episodeFile) {
      throw new Error('evaluation episode file differs from its authenticated loom reference');
    }
    if (
      stableJson(episode.definitionReference) !==
      stableJson(storedDecisionBinding?.episode?.definition)
    ) {
      throw new Error('evaluation episode definition reference differs from the source binding');
    }
    const life = await readEntityLifeRange(episode.definition.life, entityRoot);
    if (life.turns.length !== 1)
      throw new Error('neutral turn proof must bind exactly one life turn');
    const lifeTurn = life.turns[0];

    const events = parseRunJournal(fs.readFileSync(journalFile, 'utf8'));
    const entityTurn = events.find(
      (event) =>
        event.type === 'entity_turn' &&
        event.data?.id === lifeTurn.id &&
        event.data?.sequence === lifeTurn.sequence,
    );
    if (!entityTurn) throw new Error('run journal does not contain the exact Lync entity turn');
    const modelTurn = events.find(
      (event) =>
        event.type === 'model_turn' &&
        event.data?.intent?.id === entityTurn.data?.action?.id &&
        event.data?.call?.request?.mindRequest != null,
    );
    if (!modelTurn) throw new Error('run journal does not contain the exact model decision');
    const runStarted = events.find((event) => event.type === 'run_started');
    if (!runStarted) throw new Error('run journal does not contain run_started');

    const lifecycle = verifyWorldLifecycleJournal(lifecycleFile);
    const configured = lifecycle.events.find((event) => event.type === 'run_configured');
    const configuredData = configured?.data as any;
    const resident = configuredData?.population?.residents?.find(
      (candidate: any) => candidate?.entityId === lifeTurn.entityId,
    );
    if (!configured || !resident) throw new Error('world lifecycle lacks the bound resident');
    const expected = {
      worldId: requiredString(lifecycle.world, 'world id'),
      managedRunId: requiredString(configuredData?.runId, 'managed run id'),
      entityId: requiredString(lifeTurn.entityId, 'entity id'),
      policyProfile: requiredString(resident.policyProfile, 'policy profile'),
      actionProfile: requiredString(resident.actionProfile, 'action profile'),
      safetyProfile: requiredString(resident.safetyProfile, 'safety profile'),
    };
    const input = {
      expected,
      runStarted,
      modelTurn,
      entityTurn,
      life: episode.definition.life,
      lifeTurn,
      episode,
      lifecycle,
      runJournalSha256: sha256File(journalFile),
      worldLifecycleSha256: sha256File(lifecycleFile),
    } as const;
    const decisionAssessment = assessDecisionTurn(input);
    const uncoachedDecisionAssessment = assessUncoachedDecisionTurn(input);
    const worldActionAssessment = assessWorldActionTurn(input);
    const storedWorldActionAssessment = source.worldActionAssessment ?? source.causalAssessment;
    assertSameAssessment(source.decisionAssessment, decisionAssessment, 'decision');
    assertSameAssessment(
      source.uncoachedDecisionAssessment,
      uncoachedDecisionAssessment,
      'uncoached decision',
    );
    assertSameAssessment(storedWorldActionAssessment, worldActionAssessment, 'world action');

    const privateRequest = parseResidentMindRequestArtifact(readJson(requestFile));
    const journalRequest = createResidentMindRequestArtifact(
      modelTurn.data.call.request.mindRequest,
    );
    if (stableJson(privateRequest) !== stableJson(journalRequest)) {
      throw new Error('private request artifact differs from the authenticated journal request');
    }
    const selectedAssessment =
      source.claim === 'decision' ? uncoachedDecisionAssessment : worldActionAssessment;
    if (selectedAssessment.status !== 'passed') {
      throw new Error(`selected ${source.claim} claim does not pass reassessment`);
    }

    return deepFreeze({
      protocol: 'behold.neutral-turn-reassessment.v1' as const,
      status: 'passed' as const,
      generatedAt: new Date().toISOString(),
      verifierRevision: gitRevision(),
      source: {
        file: resultFile,
        sha256: sha256File(resultFile),
        protocol: source.protocol,
        repositoryRevision: source.repository?.revision ?? null,
      },
      evidence: {
        journal: { file: journalFile, sha256: sha256File(journalFile) },
        lifecycle: { file: lifecycleFile, sha256: sha256File(lifecycleFile) },
        episode: { file: episodeFile, sha256: sha256File(episodeFile) },
        privateRequest: { file: requestFile, sha256: sha256File(requestFile), mode: '0600' },
      },
      claims: {
        exactDecision: decisionAssessment.status,
        uncoachedDecision: uncoachedDecisionAssessment.status,
        worldAction: worldActionAssessment.status,
        materialEffect: 'not_assessed' as const,
        worldCompetence: 'not_assessed' as const,
      },
      bindings: {
        decision: decisionAssessment.binding,
        worldAction: worldActionAssessment.binding,
      },
    });
  } finally {
    episode.close();
  }
}

async function main() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help || parsed.positionals.length !== 1) {
    process.stdout.write('Usage: reassess-neutral-turn [--out <report.json>] <turn-result.json>\n');
    if (parsed.values.help) return;
    throw new Error('provide exactly one neutral turn result');
  }
  assertCleanRepository();
  const report = await reassessNeutralTurn(parsed.positionals[0]);
  if (parsed.values.out) {
    const output = path.resolve(parsed.values.out);
    durableWriteJson(output, report);
    process.stdout.write(`[neutral-turn-reassessment] PASS ${output}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

function evidenceFile(root: string, value: unknown, label: string) {
  const file = path.resolve(requiredString(value, label));
  const relative = path.relative(root, file);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} must be a file inside the proof root`);
  }
  if (!fs.statSync(file).isFile()) throw new Error(`${label} is not a plain file`);
  return file;
}

function assertSameAssessment(stored: unknown, actual: unknown, label: string) {
  if (stableJson(stored) !== stableJson(actual)) {
    throw new Error(`${label} assessment differs from independent reassessment`);
  }
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

main().catch((error) => {
  process.stderr.write(`[neutral-turn-reassessment] ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
