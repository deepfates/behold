import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(__dirname, '../..');
const benchmarkCore = path.join(repositoryRoot, 'scripts/place-compiler/benchmark-core.mjs');
const visitCore = path.join(repositoryRoot, 'scripts/place-compiler/visit-core.mjs');
const visitVerifier = path.join(repositoryRoot, 'scripts/place-compiler/verify-visit.mjs');
const benchmarkPath = path.join(
  repositoryRoot,
  'docs/place-compiler/benchmarks/living-places-v3.json',
);
const contractPath = path.join(repositoryRoot, 'docs/place-compiler/visits/living-places-v1.json');

test('visit contract derives an accepted arrival, clean ground leg, and reveal for every place', async () => {
  const { loadBenchmark } = await import(pathToFileURL(benchmarkCore).href);
  const { derivePresentationFocus, deriveVisitPlan, loadVisitContract } = await import(
    pathToFileURL(visitCore).href
  );
  const benchmark = await loadBenchmark(benchmarkPath, repositoryRoot);
  const visit = await loadVisitContract(contractPath, repositoryRoot, benchmark);
  assert.deepEqual(Object.keys(visit.places).sort(), [
    'lower-manhattan',
    'san-francisco',
    'venice-core',
  ]);
  for (const place of Object.values(visit.places) as any[]) {
    const plan = deriveVisitPlan(place);
    assert.equal(plan.arrival.checkpointId, place.fixture.experience.arrival.checkpointId);
    assert.ok(plan.groundLeg.distanceBlocks >= 24);
    assert.ok(plan.groundLeg.waypoints.length >= 2);
    assert.ok(plan.reveal.liftBlocks >= 2);
    const focus = derivePresentationFocus(plan.reveal);
    assert.ok(
      Math.abs(
        Math.hypot(focus.x - plan.reveal.observer.x, focus.z - plan.reveal.observer.z) - 128,
      ) < 1e-9,
    );
    assert.equal(focus.y, plan.reveal.observer.y - 36);
    const proofDirection = {
      x: plan.reveal.target.x - plan.reveal.observer.x,
      z: plan.reveal.target.z - plan.reveal.observer.z,
    };
    const presentationDirection = {
      x: focus.x - plan.reveal.observer.x,
      z: focus.z - plan.reveal.observer.z,
    };
    assert.ok(
      proofDirection.x * presentationDirection.x + proofDirection.z * presentationDirection.z > 0,
    );
    const defectEdges = new Set(
      place.route.swept.defects.map((defect: any) => `${defect.fromSample}:${defect.toSample}`),
    );
    for (let index = 1; index < plan.groundLeg.waypoints.length; index += 1) {
      assert.equal(
        defectEdges.has(
          `${plan.groundLeg.waypoints[index - 1].sampleIndex}:${plan.groundLeg.waypoints[index].sampleIndex}`,
        ),
        false,
      );
    }
  }
});

test('visit contract refuses changed evidence before materializing a runtime', async (t) => {
  const { loadBenchmark } = await import(pathToFileURL(benchmarkCore).href);
  const { loadVisitContract } = await import(pathToFileURL(visitCore).href);
  const benchmark = await loadBenchmark(benchmarkPath, repositoryRoot);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-place-visit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  contract.places['venice-core'].route.sha256 = '0'.repeat(64);
  const changed = path.join(root, 'changed.json');
  fs.writeFileSync(changed, JSON.stringify(contract));
  await assert.rejects(
    () => loadVisitContract(changed, repositoryRoot, benchmark),
    /venice-core route digest mismatch/,
  );
});

test('independent visit verifier closes the canonical three-place set', async () => {
  const { verifyVisitSet } = await import(pathToFileURL(visitVerifier).href);
  const visitRoot = path.join(
    repositoryRoot,
    '.behold-artifacts/place-visits/living-places-human-visit-v1',
  );
  const verification = await verifyVisitSet({
    benchmark: benchmarkPath,
    contract: contractPath,
    requireCapture: true,
    reports: [
      path.join(visitRoot, 'living-city-v2-sf-captured-v5/visit-report.json'),
      path.join(visitRoot, 'living-city-v2-manhattan-canonical-v1/visit-report.json'),
      path.join(visitRoot, 'living-city-v2-venice-canonical-v1/visit-report.json'),
    ],
  });
  assert.equal(verification.status, 'verified');
  assert.equal(verification.visits.length, 3);
  assert.equal(verification.capturedVisits, 1);
  assert.equal(
    verification.visits.reduce((sum: number, visit: any) => sum + visit.evidenceFiles, 0),
    19,
  );
});

test('independent visit verifier refuses a drifted reveal', async (t) => {
  const { verifyVisitSet } = await import(pathToFileURL(visitVerifier).href);
  const source = path.join(
    repositoryRoot,
    '.behold-artifacts/place-visits/living-places-human-visit-v1/living-city-v2-venice-canonical-v1',
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-place-visit-proof-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(source, root, { recursive: true });
  const reportFile = path.join(root, 'visit-report.json');
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  report.stages.reveal.position.y += 20;
  fs.writeFileSync(reportFile, JSON.stringify(report));
  await assert.rejects(
    () =>
      verifyVisitSet({
        benchmark: benchmarkPath,
        contract: contractPath,
        requireCapture: false,
        reports: [reportFile],
      }),
    /reveal position drifted/,
  );
});
