#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readEntityLifeRange, resolveEntityLifeRange } from '../src/entity/loom';
import { createMinecraftMaterialActionRecord } from '../src/evaluation/minecraft-material-action-record';
import {
  assessNativeBodyConformance,
  NATIVE_BODY_CONFORMANCE_PROTOCOL,
} from '../src/evaluation/native-body-conformance';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import { sanitizeName } from '../src/observability/journal';
import {
  assertCleanRepository,
  durableWriteJson,
  gitRevision,
  sha256File,
} from './owned-world-fixture';
import {
  assertPrivateActionRecordReferences,
  assertPrivateProofDirectory,
  assertPrivateProofFile,
  assertPrivateProofTree,
  proofEvidenceFile,
} from './private-proof-evidence';

export async function reassessNativeBodyConformance(reportPath: string) {
  const reportFile = path.resolve(reportPath);
  const root = path.dirname(path.dirname(reportFile));
  assertPrivateProofDirectory(root, 'proof root');
  assertPrivateProofFile(root, reportFile, 'private native-body report');
  const source = readJson(reportFile);
  if (source?.protocol !== NATIVE_BODY_CONFORMANCE_PROTOCOL) {
    throw new Error(`unsupported native-body protocol: ${String(source?.protocol || 'missing')}`);
  }

  const phaseFile = proofEvidenceFile(root, source.phaseFile, 'native-body phase');
  const witnessFile = proofEvidenceFile(root, source.independentWitnessFile, 'fresh-body witness');
  const lifeFile = proofEvidenceFile(root, source.loomFile, 'entity life');
  const lifecycleFile = proofEvidenceFile(root, source.lifecycle?.file, 'world lifecycle');
  for (const [file, label] of [
    [phaseFile, 'private native-body phase'],
    [witnessFile, 'private fresh-body witness'],
    [lifeFile, 'private entity life'],
    [lifecycleFile, 'private world lifecycle'],
  ] as const) {
    assertPrivateProofFile(root, file, label);
  }
  const entityRoot = path.join(root, 'entities');
  assertPrivateProofTree(root, entityRoot, 'private entity store');
  assertPrivateActionRecordReferences(root, source.actionRecordAssessment?.bundle);

  assertDigest(phaseFile, source.phaseSha256, 'native-body phase');
  assertDigest(witnessFile, source.independentWitnessSha256, 'fresh-body witness');
  assertDigest(lifeFile, source.loomSha256, 'entity life');
  assertDigest(lifecycleFile, source.lifecycle?.sha256, 'world lifecycle');
  const phase = readJson(phaseFile);
  const witness = readJson(witnessFile);
  assertSame(source.phase, phase, 'native-body phase');
  assertSame(source.independentWitness, witness, 'fresh-body witness');

  const lifecycle = verifyWorldLifecycleJournal(lifecycleFile);
  const quiescenceEvents = lifecycle.events.filter(
    (candidate) =>
      candidate.type === 'residents_quiesced' &&
      (candidate.data as any)?.reason === 'native_body_before_independent_witness',
  );
  const quiescence = quiescenceEvents[0];
  if (
    source.lifecycle?.verified !== true ||
    source.lifecycle?.tipDigest !== lifecycle.tipDigest ||
    source.lifecycle?.eventCount !== lifecycle.events.length
  ) {
    throw new Error('world lifecycle differs from the native-body report');
  }
  if (
    quiescenceEvents.length !== 1 ||
    !quiescence ||
    stableJson(source.lifecycle?.quiescence) !==
      stableJson({
        sequence: quiescence.sequence,
        at: quiescence.at,
        digest: quiescence.digest,
        reason: (quiescence.data as any).reason,
      })
  ) {
    throw new Error('pre-witness resident quiescence differs from the world lifecycle');
  }
  const configured = lifecycle.events.find((candidate) => candidate.type === 'run_configured');
  const configuredData = configured?.data as any;
  if (
    configuredData?.runId !== source.managedRunId ||
    lifecycle.world !== source.worldId ||
    !configuredData?.population?.residents?.some(
      (candidate: any) => candidate?.entityId === phase.entityId,
    )
  ) {
    throw new Error('world lifecycle is not bound to the reported resident and epoch');
  }

  const sequence = Number(phase?.turn?.turn?.sequence);
  const life = await resolveEntityLifeRange(phase.entityId, sequence, sequence, entityRoot);
  const lifeRead = await readEntityLifeRange(life, entityRoot);
  if (lifeRead.turns.length !== 1) throw new Error('native-body proof must bind one life turn');
  assertSame(lifeRead.turns[0], phase.turn.turn, 'entity life turn');
  const expectedLifeFile = path.join(
    entityRoot,
    sanitizeName(phase.entityId),
    'lync',
    `${encodeURIComponent(life.life.loomId.replace(/^lync:/, ''))}.lync`,
  );
  if (fs.realpathSync(lifeFile) !== fs.realpathSync(expectedLifeFile)) {
    throw new Error('entity life file does not match the authenticated Lync identity');
  }

  const assessment = assessNativeBodyConformance(source);
  assertSame(source.assessment, assessment, 'native-body assessment');
  if (!assessment.pass) throw new Error('native-body assessment does not pass');
  const actionRecordAssessment = createMinecraftMaterialActionRecord(source, {
    assessedAt: requiredString(source.completedAt, 'completion time'),
    checkerRevision: requiredString(source.repositoryRevision, 'source revision'),
    refs: {
      phase: { file: phaseFile, sha256: sha256File(phaseFile) },
      witness: { file: witnessFile, sha256: sha256File(witnessFile) },
      life: { file: lifeFile, sha256: sha256File(lifeFile) },
      lifecycle: { file: lifecycleFile, sha256: sha256File(lifecycleFile) },
    },
  });
  assertSame(
    source.actionRecordAssessment,
    actionRecordAssessment,
    'material action record assessment',
  );
  if (actionRecordAssessment.status !== 'passed') {
    throw new Error('material action record assessment does not pass');
  }

  return deepFreeze({
    protocol: 'behold.native-body-conformance-reassessment.v1' as const,
    status: 'passed' as const,
    generatedAt: new Date().toISOString(),
    verifierRevision: gitRevision(),
    source: {
      file: reportFile,
      sha256: sha256File(reportFile),
      protocol: source.protocol,
      repositoryRevision: source.repositoryRevision,
    },
    evidence: {
      phase: { file: phaseFile, sha256: sha256File(phaseFile) },
      witness: { file: witnessFile, sha256: sha256File(witnessFile) },
      life: { file: lifeFile, sha256: sha256File(lifeFile) },
      lifecycle: { file: lifecycleFile, sha256: sha256File(lifecycleFile) },
    },
    claims: {
      nativeBodyConformance: 'passed' as const,
      materialFact: 'passed' as const,
      structuralActionGraph: 'passed' as const,
      mindCompetence: 'not_assessed' as const,
      indefinitePersistence: 'not_assessed' as const,
      independentInfrastructureOperator: 'not_assessed' as const,
    },
    bindings: {
      actionRecord: actionRecordAssessment.binding,
      materialFact: actionRecordAssessment.materialBinding,
      life,
    },
  });
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
    process.stdout.write(
      'Usage: reassess-native-body-conformance [--out <report.json>] <native-body-conformance.json>\n',
    );
    if (parsed.values.help) return;
    throw new Error('provide exactly one native-body conformance report');
  }
  assertCleanRepository();
  const reassessment = await reassessNativeBodyConformance(parsed.positionals[0]);
  if (parsed.values.out) {
    const output = path.resolve(parsed.values.out);
    durableWriteJson(output, reassessment);
    process.stdout.write(`[native-body-reassessment] PASS ${output}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(reassessment, null, 2)}\n`);
  }
}

function assertDigest(file: string, expected: unknown, label: string) {
  if (!/^[a-f0-9]{64}$/.test(String(expected)) || sha256File(file) !== expected) {
    throw new Error(`${label} digest differs from the report`);
  }
}

function assertSame(left: unknown, right: unknown, label: string) {
  if (stableJson(left) !== stableJson(right)) throw new Error(`${label} differs from its evidence`);
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
  process.stderr.write(`[native-body-reassessment] ${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
