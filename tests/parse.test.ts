import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../src/tui/parse';

test('parseLine exposes terrain survey options', () => {
  assert.deepEqual(parseLine('survey radius=24 step=3 verticalRange=64'), {
    tool: 'survey_area',
    args: { radius: 24, step: 3, verticalRange: 64 },
    preempt: false,
  });
});

test('parseLine maps movement to the interpreter move command', () => {
  assert.deepEqual(parseLine('move to 12 -60 42 near=2'), {
    tool: 'move_to',
    args: { x: 12, y: -60, z: 42, near: 2 },
    preempt: false,
  });
});

test('parseLine can name a placement destination instead of a protocol face', () => {
  assert.deepEqual(parseLine('place at 12 64 -3 name=dirt'), {
    tool: 'place_block',
    args: { x: 12, y: 64, z: -3, name: 'dirt' },
    preempt: false,
  });
});
