import assert from 'node:assert/strict';
import test from 'node:test';
import { validateResidentActionInput } from '../src/mind/schema';

const schema = {
  type: 'object',
  properties: {
    target: { type: 'string', enum: ['entity:7', 'entity:9'] },
    on: {
      type: 'object',
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

test('resident action input validation reports every unsafe mismatch before admission', () => {
  const result = validateResidentActionInput(
    { target: 'entity:hidden', on: { x: '1', y: 400.5 }, events: [7] },
    schema,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.errors, [
    '$.target: value is outside enum',
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
