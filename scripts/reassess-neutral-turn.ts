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
import { createWorldActionRecord } from '../src/evaluation/behold-action-record';
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

const SOURCE_PROTOCOLS = new Set(['behold.neutral-turn-proof.v4']);

export async function reassessNeutralTurn(resultPath: string) {
  const resultFile = path.resolve(resultPath);
  const root = path.dirname(path.dirname(resultFile));
  assertPrivateDirectory(root, 'proof root');
  assertPrivateFile(root, resultFile, 'private turn result');
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
  for (const [file, label] of [
    [journalFile, 'private run journal'],
    [lifecycleFile, 'private world lifecycle'],
    [episodeFile, 'private evaluation episode'],
    [requestFile, 'private mind request'],
  ] as const) {
    assertPrivateFile(root, file, label);
  }
  if (source.claim === 'world-action') {
    assertPrivateRecordReferences(root, source?.actionRecordAssessment?.bundle);
  }

  const storedDecisionBinding = source?.decisionAssessment?.binding;
  const episodeDirectory = path.dirname(episodeFile);
  const entityRoot = path.join(root, 'entities');
  assertPrivateTree(root, entityRoot, 'private entity life store');
  assertPrivateTree(root, episodeDirectory, 'private evaluation episode store');
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
    const actionRecordAssessment = createWorldActionRecord(input, {
      assessedAt: requiredString(source.generatedAt, 'source generation time'),
      checkerRevision: requiredString(
        source.repository?.revision ?? 'legacy-source-revision',
        'source repository revision',
      ),
      refs: {
        runJournal: journalFile,
        worldLifecycle: lifecycleFile,
        mindRequest: requestFile,
        lifeTurn: `lync://${episode.definition.life.life.loomId}/turn/${episode.definition.life.end.turnId}`,
      },
    });
    const storedWorldActionAssessment = source.worldActionAssessment;
    assertSameAssessment(source.decisionAssessment, decisionAssessment, 'decision');
    assertSameAssessment(
      source.uncoachedDecisionAssessment,
      uncoachedDecisionAssessment,
      'uncoached decision',
    );
    assertSameAssessment(storedWorldActionAssessment, worldActionAssessment, 'world action');
    assertSameAssessment(source.actionRecordAssessment, actionRecordAssessment, 'action record');

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
        actionRecord: actionRecordAssessment.status,
        materialEffect: 'not_assessed' as const,
        worldCompetence: 'not_assessed' as const,
      },
      bindings: {
        decision: decisionAssessment.binding,
        worldAction: worldActionAssessment.binding,
        actionRecord: actionRecordAssessment.binding,
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
  const status = fs.lstatSync(file);
  if (!status.isFile()) throw new Error(`${label} is not a plain file`);
  assertInsideRealRoot(root, file, label);
  return file;
}

function assertPrivateRecordReferences(root: string, bundle: any) {
  if (!bundle || !Array.isArray(bundle.records)) {
    throw new Error('action record bundle is unavailable for private-reference verification');
  }
  const references: Array<{ ref: string; label: string }> = [];
  for (const record of bundle.records) {
    if (record?.access?.visibility !== 'private') continue;
    if (typeof record?.payload?.dataRef === 'string') {
      references.push({ ref: record.payload.dataRef, label: `${record.stage} data reference` });
    }
    if (record?.stage === 'check' && Array.isArray(record?.payload?.evidence)) {
      for (const evidence of record.payload.evidence) {
        if (evidence?.access?.visibility === 'private' && typeof evidence?.ref === 'string') {
          references.push({ ref: evidence.ref, label: `${evidence.kind} evidence reference` });
        }
      }
    }
  }
  if (references.length === 0) {
    throw new Error('private action record has no verifiable private references');
  }
  for (const reference of references) {
    if (reference.ref.startsWith('lync://')) continue;
    const withoutFragment = reference.ref.split('#', 1)[0];
    if (!path.isAbsolute(withoutFragment)) {
      throw new Error(`${reference.label} must be an absolute proof path or Lync reference`);
    }
    const file = evidenceFile(root, withoutFragment, reference.label);
    assertPrivateFile(root, file, reference.label);
  }
}

function assertPrivateTree(root: string, directory: string, label: string) {
  assertPrivateDirectory(directory, label);
  assertInsideRealRoot(root, directory, label);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${child}`);
    if (entry.isDirectory()) assertPrivateTree(root, child, label);
    else if (entry.isFile()) assertPrivateFile(root, child, label);
    else throw new Error(`${label} contains a non-file entry: ${child}`);
  }
}

function assertPrivateFile(root: string, file: string, label: string) {
  const status = fs.lstatSync(file);
  if (!status.isFile()) throw new Error(`${label} is not a regular no-follow file`);
  if ((status.mode & 0o777) !== 0o600) throw new Error(`${label} must have mode 0600`);
  assertInsideRealRoot(root, file, label);
  let directory = path.dirname(file);
  const resolvedRoot = path.resolve(root);
  while (true) {
    assertPrivateDirectory(directory, `${label} parent`);
    if (path.resolve(directory) === resolvedRoot) break;
    const parent = path.dirname(directory);
    if (parent === directory || path.relative(resolvedRoot, parent).startsWith('..')) {
      throw new Error(`${label} parent escaped the proof root`);
    }
    directory = parent;
  }
}

function assertPrivateDirectory(directory: string, label: string) {
  const status = fs.lstatSync(directory);
  if (!status.isDirectory()) throw new Error(`${label} is not a regular directory`);
  if ((status.mode & 0o777) !== 0o700) throw new Error(`${label} must have mode 0700`);
}

function assertInsideRealRoot(root: string, candidate: string, label: string) {
  const canonicalRoot = fs.realpathSync(root);
  const canonicalCandidate = fs.realpathSync(candidate);
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} resolves outside the proof root`);
  }
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
