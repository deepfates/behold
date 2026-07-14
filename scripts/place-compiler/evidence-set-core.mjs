import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from './core.mjs';
import { deriveEvidencePlan, laneExpectation } from './evidence-contract.mjs';

const LANES = {
  inspection: { filename: 'inspection-manifest.json', collection: 'results' },
  ecology: { filename: 'ecology-manifest.json', collection: 'results' },
  performance: { filename: 'performance-manifest.json', collection: 'cases' },
};

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function resolveContained(root, value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value))
    throw new Error(`${label} must be a relative path`);
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
    throw new Error(`${label} escapes its evidence root`);
  return resolved;
}

async function verifyReference(root, reference, label) {
  const file = resolveContained(root, reference.path, `${label}.path`);
  if (!existsSync(file) || (await sha256(file)) !== reference.sha256)
    throw new Error(`${label} digest mismatch`);
  return file;
}

export async function verifyEvidenceLane({ lane, root, benchmark, fixtures, profiles = null }) {
  const config = LANES[lane];
  if (!config) throw new Error(`unknown evidence lane: ${lane}`);
  const manifestPath = path.join(root, config.filename);
  if (!existsSync(manifestPath)) throw new Error(`${lane} manifest is missing`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const plan = deriveEvidencePlan({
    benchmark,
    fixtures,
    performanceProfiles: profiles,
  });
  const expectation = laneExpectation(plan, lane);
  if (manifest.status !== 'completed' || manifest.benchmarkId !== benchmark.id)
    throw new Error(`${lane} manifest identity or status mismatch`);
  if (!equal(manifest.expectation, expectation))
    throw new Error(`${lane} manifest does not satisfy the selected evidence plan`);
  const records = manifest[config.collection];
  if (!Array.isArray(records) || records.length !== expectation.expectedCaseCount)
    throw new Error(`${lane} evidence cardinality mismatch`);

  const actualCaseIds = [];
  const referencedFiles = [manifestPath];
  for (const [index, record] of records.entries()) {
    const reportPath = resolveContained(root, record.reportPath, `${lane}[${index}].reportPath`);
    if (!existsSync(reportPath) || (await sha256(reportPath)) !== record.reportSha256)
      throw new Error(`${lane}[${index}] report digest mismatch`);
    referencedFiles.push(reportPath);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    if (report.benchmarkId !== benchmark.id)
      throw new Error(`${lane}[${index}] benchmark mismatch`);
    if (lane === 'performance') {
      actualCaseIds.push(`${report.placeId}:${report.profileId}:performance:r${report.repetition}`);
    } else {
      actualCaseIds.push(`${report.placeId}:${lane}`);
    }
    if (lane === 'inspection') {
      for (const [name, digestName] of [
        ['checkpointMapPath', 'checkpointMapSha256'],
        ['checkpointOverlayPath', 'checkpointOverlaySha256'],
      ]) {
        const visualPath = resolveContained(
          path.dirname(reportPath),
          report.visualEvidence[name],
          `inspection[${index}].visualEvidence.${name}`,
        );
        if ((await sha256(visualPath)) !== report.visualEvidence[digestName])
          throw new Error(`inspection[${index}] visual digest mismatch`);
        referencedFiles.push(visualPath);
      }
    }
  }
  if (!equal([...actualCaseIds].sort(), [...expectation.expectedCaseIds].sort()))
    throw new Error(`${lane} evidence case identities do not match the plan`);
  const progressPath = await verifyReference(root, manifest.progress, `${lane}.progress`);
  referencedFiles.push(progressPath);
  return {
    lane,
    root,
    manifestPath,
    manifestSha256: await sha256(manifestPath),
    expectation,
    referencedFiles: [...new Set(referencedFiles)].sort(),
  };
}

export async function verifyEvidenceSelection({ benchmark, fixtures, laneRoots }) {
  const results = {};
  for (const lane of Object.keys(LANES)) {
    if (!laneRoots[lane]) throw new Error(`missing ${lane} evidence root`);
    results[lane] = await verifyEvidenceLane({
      lane,
      root: path.resolve(laneRoots[lane]),
      benchmark,
      fixtures,
    });
  }
  return results;
}
