#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBenchmark } from './benchmark-core.mjs';
import { sha256 } from './core.mjs';
import { evaluateQualityFixture } from './quality-loop-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [benchmarkArgument, ecologyArgument, inspectionArgument, ...remaining] =
  process.argv.slice(2);
if (!benchmarkArgument || !ecologyArgument || !inspectionArgument)
  throw new Error(
    'usage: verify-quality-loop.mjs <benchmark.json> <ecology-run-root> <inspection-run-root>',
  );
let selectedPlace = null;
if (remaining.length) {
  if (remaining.length !== 2 || remaining[0] !== '--place')
    throw new Error('optional selection must be --place PLACE_ID');
  selectedPlace = remaining[1];
}

const benchmarkPath = path.resolve(benchmarkArgument);
const ecologyRoot = path.resolve(ecologyArgument);
const inspectionRoot = path.resolve(inspectionArgument);
const loaded = await loadBenchmark(benchmarkPath, repositoryRoot);

async function loadLane(root, manifestName, expectedKind) {
  const manifestPath = path.join(root, manifestName);
  if (!existsSync(manifestPath)) throw new Error(`Quality loop: missing ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    manifest.status !== 'completed' ||
    manifest.kind !== expectedKind ||
    manifest.benchmarkId !== loaded.benchmark.id
  )
    throw new Error(`Quality loop: invalid ${expectedKind} manifest identity or status`);
  const reports = new Map();
  for (const result of manifest.results) {
    const reportPath = path.resolve(root, result.reportPath);
    if (!reportPath.startsWith(`${root}${path.sep}`))
      throw new Error(`Quality loop: report path escapes run root`);
    if ((await sha256(reportPath)) !== result.reportSha256)
      throw new Error(`Quality loop: report digest mismatch for ${result.placeId}`);
    reports.set(result.placeId, JSON.parse(readFileSync(reportPath, 'utf8')));
  }
  return { manifest, reports };
}

const ecology = await loadLane(ecologyRoot, 'ecology-manifest.json', 'living-places-ecology-soak');
const inspection = await loadLane(
  inspectionRoot,
  'inspection-manifest.json',
  'living-places-inspection',
);
const selectedFixtures = selectedPlace
  ? loaded.fixtures.filter((fixture) => fixture.placeId === selectedPlace)
  : loaded.fixtures;
if (!selectedFixtures.length)
  throw new Error(`Quality loop: unknown selected place ${selectedPlace}`);
const expectedPlaceIds = selectedFixtures.map((fixture) => fixture.placeId).sort();
for (const [lane, evidence] of [
  ['ecology', ecology],
  ['inspection', inspection],
]) {
  const actualPlaceIds = [...evidence.reports.keys()].sort();
  if (JSON.stringify(actualPlaceIds) !== JSON.stringify(expectedPlaceIds))
    throw new Error(`Quality loop: ${lane} evidence does not exactly match selected places`);
}
const places = selectedFixtures.map((fixture) => {
  const ecologyReport = ecology.reports.get(fixture.placeId);
  const inspectionReport = inspection.reports.get(fixture.placeId);
  if (!ecologyReport || !inspectionReport)
    throw new Error(`Quality loop: incomplete evidence for ${fixture.placeId}`);
  return evaluateQualityFixture(fixture, ecologyReport, inspectionReport);
});
const result = {
  schemaVersion: 1,
  benchmarkId: loaded.benchmark.id,
  status: places.every((place) => place.status === 'green') ? 'accepted-with-frontiers' : 'red',
  ecologyRunId: ecology.manifest.runId,
  inspectionRunId: inspection.manifest.runId,
  places,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.status === 'red') process.exitCode = 1;
