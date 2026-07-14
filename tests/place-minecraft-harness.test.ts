import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = path.resolve(__dirname, '..', '..');
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('runtime launch vector is the single JVM policy authority', async () => {
  const { formatProgressEvent, resolveRuntimeLaunch } = await import(
    pathToFileURL(path.join(root, 'scripts/place-compiler/minecraft-harness.mjs')).href
  );
  const launch = resolveRuntimeLaunch(
    { launch: ['java', '-Xms2G', '-Xmx8G', '-jar', 'vendor/server.jar', 'nogui'] },
    root,
  );
  assert.equal(launch.command, 'java');
  assert.deepEqual(launch.args.slice(0, 3), ['-Xms2G', '-Xmx8G', '-jar']);
  assert.equal(launch.args[3], path.join(root, 'vendor/server.jar'));
  assert.equal(launch.args[4], 'nogui');
  assert.throws(() => resolveRuntimeLaunch({ launch: ['java', '-Xmx1G'] }, root), /no server jar/);
  assert.equal(
    formatProgressEvent({
      lane: 'ecology',
      stage: 'tick-sprint',
      status: 'completed',
      requestedTicks: 24000,
      effectiveTps: 399,
    }),
    '[place:ecology] tick-sprint completed · 399 TPS',
  );
});

test('observation sites choose local median height deterministically', async () => {
  const { chooseMedianSurface } = await import(
    pathToFileURL(path.join(root, 'scripts/place-compiler/observation-site.mjs')).href
  );
  const checkpoint = { x: 0, z: 0 };
  const candidates = [
    { x: 8, y: 70, z: 0 },
    { x: 4, y: 64, z: 0 },
    { x: 1, y: 70, z: 0 },
    { x: 0, y: 90, z: 0 },
  ];
  assert.deepEqual(chooseMedianSurface(candidates, checkpoint), candidates[2]);
  assert.equal(chooseMedianSurface([], checkpoint), null);
});

test('evidence plans scale from places, profiles, and repetitions', async () => {
  const { deriveEvidencePlan, laneExpectation } = await import(
    pathToFileURL(path.join(root, 'scripts/place-compiler/evidence-contract.mjs')).href
  );
  const plan = deriveEvidencePlan({
    benchmark: {
      id: 'foundry-v2-test',
      performanceSweep: { profiles: ['living', 'cinematic'], repetitions: 2 },
    },
    fixtures: [{ placeId: 'one' }, { placeId: 'two' }, { placeId: 'three' }],
  });
  assert.equal(plan.lanes.inspection.length, 3);
  assert.equal(plan.lanes.ecology.length, 3);
  assert.equal(plan.lanes.performance.length, 12);
  assert.equal(plan.expectedCaseCount, 18);
  assert.deepEqual(laneExpectation(plan, 'inspection'), {
    lane: 'inspection',
    expectedCaseIds: ['one:inspection', 'two:inspection', 'three:inspection'],
    expectedCaseCount: 3,
  });
  const focused = deriveEvidencePlan({
    benchmark: {
      id: 'foundry-v2-test',
      performanceSweep: { profiles: ['living'], repetitions: 2 },
    },
    fixtures: [{ placeId: 'one' }],
    repetitions: 1,
  });
  assert.deepEqual(focused.lanes.performance, ['one:living:performance:r1']);
});

test('evidence lane verification derives closure and refuses report tampering', async (t) => {
  const { verifyEvidenceLane } = await import(
    pathToFileURL(path.join(root, 'scripts/place-compiler/evidence-set-core.mjs')).href
  );
  const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), 'foundry-evidence-'));
  t.after(() => rmSync(evidenceRoot, { recursive: true, force: true }));
  const casesRoot = path.join(evidenceRoot, 'cases');
  mkdirSync(casesRoot);
  const benchmark = {
    id: 'foundry-v2-test',
    performanceSweep: { profiles: ['living'], repetitions: 1 },
  };
  const fixtures = [{ placeId: 'one' }, { placeId: 'two' }, { placeId: 'three' }];
  const cases = [];
  for (const fixture of fixtures) {
    const reportPath = path.join(casesRoot, `${fixture.placeId}.json`);
    writeFileSync(
      reportPath,
      `${JSON.stringify({
        benchmarkId: benchmark.id,
        placeId: fixture.placeId,
        profileId: 'living',
        repetition: 1,
      })}\n`,
    );
    cases.push({
      caseId: `${fixture.placeId}-living-r1`,
      reportPath: path.relative(evidenceRoot, reportPath),
      reportSha256: digest(reportPath),
    });
  }
  const progressPath = path.join(evidenceRoot, 'progress.jsonl');
  writeFileSync(progressPath, '{}\n');
  writeFileSync(
    path.join(evidenceRoot, 'performance-manifest.json'),
    `${JSON.stringify({
      status: 'completed',
      benchmarkId: benchmark.id,
      expectation: {
        lane: 'performance',
        expectedCaseIds: fixtures.map((fixture) => `${fixture.placeId}:living:performance:r1`),
        expectedCaseCount: 3,
      },
      progress: { path: 'progress.jsonl', sha256: digest(progressPath) },
      cases,
    })}\n`,
  );
  const verified = await verifyEvidenceLane({
    lane: 'performance',
    root: evidenceRoot,
    benchmark,
    fixtures,
  });
  assert.equal(verified.expectation.expectedCaseCount, 3);
  assert.equal(verified.referencedFiles.length, 5);
  writeFileSync(path.join(casesRoot, 'two.json'), '{"tampered":true}\n');
  await assert.rejects(
    verifyEvidenceLane({ lane: 'performance', root: evidenceRoot, benchmark, fixtures }),
    /report digest mismatch/,
  );
});
