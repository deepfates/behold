import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const corePath = path.resolve(__dirname, '../../scripts/place-compiler/semantic-place-core.mjs');

test('semantic selection accepts only exact grounded candidate ids', async () => {
  const { validateSemanticSelection } = await import(pathToFileURL(corePath).href);
  const landmarks = Array.from({ length: 8 }, (_, index) => ({ id: `landmark-${index}` }));
  const arrivals = [{ id: 'arrival-1' }];
  const valid = {
    selectedIds: landmarks.map((item) => item.id),
    arrivalCandidateIds: ['arrival-1'],
    placeCharacter: 'A sufficiently substantive grounded description.',
    rationale: 'A sufficiently substantive grounded selection rationale.',
  };
  assert.equal(validateSemanticSelection(valid, landmarks, arrivals), valid);
  assert.throws(
    () =>
      validateSemanticSelection(
        { ...valid, selectedIds: [...valid.selectedIds.slice(0, 7), 'invented'] },
        landmarks,
        arrivals,
      ),
    /invented a landmark id/,
  );
  assert.throws(
    () =>
      validateSemanticSelection(
        { ...valid, arrivalCandidateIds: ['invented'] },
        landmarks,
        arrivals,
      ),
    /invented an arrival candidate id/,
  );
});

test('semantic representation gate rejects fluent category collapse', async () => {
  const { evaluateSemanticRepresentation } = await import(pathToFileURL(corePath).href);
  const selected = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `culture-${index}`, family: 'culture' })),
    ...Array.from({ length: 2 }, (_, index) => ({ id: `civic-${index}`, family: 'civic' })),
    { id: 'park', family: 'landscape' },
  ];
  const result = evaluateSemanticRepresentation({ selected, arrivals: [{ id: 'park' }] });
  assert.equal(result.status, 'rejected');
  assert.equal(
    result.checks.find((check: { id: string }) => check.id === 'category-concentration').status,
    'red',
  );
});
