import assert from 'node:assert/strict';
import test from 'node:test';
import { validateResidentActionInput } from '../src/mind/schema';

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', enum: ['entity:7', 'entity:9'], minLength: 8, maxLength: 8 },
    on: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'number' },
        y: { type: 'integer', minimum: -64, maximum: 320 },
      },
      required: ['x', 'y'],
    },
    events: { type: 'array', items: { type: 'string' } },
  },
  required: ['target', 'on'],
};

test('resident action inputs validate against nested, bounded, enum, and array schemas', () => {
  assert.deepEqual(
    validateResidentActionInput(
      { target: 'entity:7', on: { x: 1.5, y: 64 }, events: ['self_hurt'] },
      schema,
    ),
    { ok: true },
  );
});

test('resident string bounds reject amputated or oversized action text before world intent', () => {
  const bounded = { type: 'string', minLength: 1, maxLength: 4 };
  assert.deepEqual(validateResidentActionInput('okay', bounded), { ok: true });
  assert.deepEqual(validateResidentActionInput('', bounded), {
    ok: false,
    errors: ['$: string is shorter than minLength 1'],
  });
  assert.deepEqual(validateResidentActionInput('hello', bounded), {
    ok: false,
    errors: ['$: string is longer than maxLength 4'],
  });
  assert.deepEqual(validateResidentActionInput(4, bounded), {
    ok: false,
    errors: ['$: expected string'],
  });
  assert.deepEqual(validateResidentActionInput('x', { ...bounded, minLength: 5 }), {
    ok: false,
    errors: ['$: schema minLength exceeds maxLength'],
  });
});

test('resident action input validation reports every unsafe mismatch before admission', () => {
  const result = validateResidentActionInput(
    {
      target: 'entity:hidden',
      on: { x: '1', y: 400.5, hiddenCoordinate: 12 },
      events: [7],
      extraControl: true,
    },
    schema,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.errors, [
    '$.extraControl: field is not declared',
    '$.target: value is outside enum',
    '$.target: string is longer than maxLength 8',
    '$.on.hiddenCoordinate: field is not declared',
    '$.on.x: expected finite number',
    '$.on.y: expected integer',
    '$.on.y: value is above maximum 320',
    '$.events[0]: expected string',
  ]);
});

test('resident action input validation fails visibly on missing fields and unknown schema vocabulary', () => {
  const missing = validateResidentActionInput({}, schema);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.deepEqual(missing.errors, [
      '$.target: required field is missing',
      '$.on: required field is missing',
    ]);
  }
  const unsupported = validateResidentActionInput(
    {},
    {
      type: 'object',
      properties: {},
      oneOf: [],
    },
  );
  assert.deepEqual(unsupported, { ok: false, errors: ['$: schema uses unsupported keys oneOf'] });
});
