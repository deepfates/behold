import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const findingsPath = path.resolve(
  __dirname,
  '../../docs/place-compiler/benchmarks/living-places-v1-findings.json',
);

test('Living Places findings preserve the telos vector and evidence discipline', () => {
  const findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  assert.equal(findings.benchmarkId, 'living-places-v1');
  assert.deepEqual(
    findings.dimensionStatus.map((item: { placeId: string }) => item.placeId).sort(),
    ['lower-manhattan', 'san-francisco'],
  );
  for (const item of findings.dimensionStatus)
    for (const dimension of [
      'correspondence',
      'legibility',
      'habitability',
      'ecology',
      'experience',
      'capacity',
    ])
      assert.ok(item[dimension], `${item.placeId} lacks ${dimension}`);
  for (const defect of findings.defects) {
    assert.ok(defect.evidence.length);
    assert.ok(defect.expectedBenefit);
    assert.ok(defect.validation);
    assert.ok(defect.scope);
  }
  for (const decision of findings.defaults) {
    assert.ok(decision.evidence.length);
    assert.ok(decision.expectedBenefit);
    assert.ok(decision.validation);
    assert.ok(decision.scope);
  }
  assert.ok(findings.nonClaims.some((item: string) => item.includes('hundreds or thousands')));
});
