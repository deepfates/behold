#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCapacityCase, summarizeCapacity, validateCapacityPlan } from './capacity-core.mjs';
import { loadBenchmark } from './benchmark-core.mjs';
import { sha256 } from './core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestArguments = process.argv.slice(2);
if (!manifestArguments.length)
  throw new Error('usage: verify-capacity.mjs <capacity-manifest> [...]');

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const verified = [];
for (const argument of manifestArguments) {
  const manifestPath = path.resolve(argument);
  const root = path.dirname(manifestPath);
  if (!existsSync(manifestPath)) throw new Error(`Capacity verification: missing ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.kind !== 'place-capacity-frontier' || manifest.status !== 'completed')
    throw new Error('Capacity verification: invalid manifest kind or status');
  const benchmarkPath = path.join(
    repositoryRoot,
    'docs/place-compiler/benchmarks',
    `${manifest.benchmarkId}.json`,
  );
  const loaded = await loadBenchmark(benchmarkPath, repositoryRoot);
  if ((await sha256(benchmarkPath)) !== manifest.benchmarkSha256)
    throw new Error(`Capacity verification: benchmark digest mismatch for ${manifest.runId}`);
  const fixture = loaded.fixtures.find((item) => item.placeId === manifest.placeId);
  if (!fixture || fixture.worldTreeSha256 !== manifest.worldTreeSha256)
    throw new Error(`Capacity verification: place fixture mismatch for ${manifest.runId}`);
  const planPath = path.resolve(repositoryRoot, manifest.plan.path);
  if (
    !planPath.startsWith(`${repositoryRoot}${path.sep}`) ||
    (await sha256(planPath)) !== manifest.plan.sha256
  )
    throw new Error(`Capacity verification: plan path or digest mismatch for ${manifest.runId}`);
  const plan = validateCapacityPlan(JSON.parse(readFileSync(planPath, 'utf8')), fixture);
  const expectedCaseIds =
    manifest.selection.requestedCase === 'all'
      ? plan.cases.map((item) => item.id)
      : [manifest.selection.requestedCase];
  if (
    !equal(
      manifest.cases.map((item) => item.caseId),
      expectedCaseIds,
    )
  )
    throw new Error(`Capacity verification: case closure mismatch for ${manifest.runId}`);
  const progressPath = path.resolve(root, manifest.progress.path);
  if (
    !progressPath.startsWith(`${root}${path.sep}`) ||
    (await sha256(progressPath)) !== manifest.progress.sha256
  )
    throw new Error(`Capacity verification: progress digest mismatch for ${manifest.runId}`);
  const reports = [];
  for (const item of manifest.cases) {
    const reportPath = path.resolve(root, item.reportPath);
    if (
      !reportPath.startsWith(`${root}${path.sep}`) ||
      (await sha256(reportPath)) !== item.reportSha256
    )
      throw new Error(`Capacity verification: case digest mismatch for ${item.caseId}`);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    if (
      report.caseId !== item.caseId ||
      report.placeId !== fixture.placeId ||
      report.worldTreeSha256 !== fixture.worldTreeSha256
    )
      throw new Error(`Capacity verification: case identity mismatch for ${item.caseId}`);
    if (
      report.experimentalControls.inferenceWorkload !== 0 ||
      report.experimentalControls.beholdInhabitants !== 0
    )
      throw new Error(
        `Capacity verification: substrate case overclaims inhabitants ${item.caseId}`,
      );
    const classification = classifyCapacityCase(report);
    if (!equal(classification, report.classification))
      throw new Error(`Capacity verification: stale classification for ${item.caseId}`);
    reports.push(report);
  }
  const summary = summarizeCapacity(reports);
  if (!equal(summary, manifest.summary))
    throw new Error(`Capacity verification: stale summary for ${manifest.runId}`);
  verified.push({
    runId: manifest.runId,
    plan: manifest.plan.path,
    caseCount: reports.length,
    summary,
  });
}
process.stdout.write(
  `${JSON.stringify({ schemaVersion: 1, status: 'verified', runs: verified }, null, 2)}\n`,
);
