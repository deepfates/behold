import test from 'node:test';
import assert from 'node:assert/strict';
import { minecraftInhabitantActionsFor } from '../src/agent/affordances';
import type { InhabitantActionSpec } from '../src/entity/interface';

test('a peripheral visible door offers exact orientation before cursor-gated crossing', () => {
  const actions = [tool('face_visible_target'), tool('cross_visible_door')];
  const observation = {
    protocol: 'behold.inhabitant.v2',
    scene: {
      focus: {
        id: 'block:overworld:2:65:-1',
        kind: 'block',
        name: 'oak_log',
        source: 'cursor',
        reachable: true,
      },
      entities: [],
      terrain: {
        targets: [
          {
            id: 'block:overworld:3:65:-2',
            kind: 'block',
            name: 'oak_door',
            source: 'vision',
            visibility: 'visible',
            position: { x: 3, y: 65, z: -2 },
            distance: 2.4,
            ray: { row: 2, column: 7 },
          },
        ],
      },
    },
  };

  const offered = minecraftInhabitantActionsFor(actions, observation);

  assert.deepEqual(
    offered.map((action) => action.function.name),
    ['face_visible_target'],
  );
  assert.deepEqual(offered[0].function.parameters.properties.target.enum, [
    'block:overworld:3:65:-2',
  ]);
  assert.deepEqual(offered[0].function.parameters.properties.expectedName.enum, ['oak_door']);
  assert.equal(
    (actions[0].function.parameters.properties.target as any).enum,
    undefined,
    'one observation must not mutate the capability catalog or a later inhabitant request',
  );
});

test('the same door crossing appears only after the current cursor confirms it', () => {
  const observation = {
    protocol: 'behold.inhabitant.v2',
    scene: {
      focus: {
        id: 'block:overworld:3:65:-2',
        kind: 'block',
        name: 'oak_door',
        source: 'cursor',
        reachable: true,
      },
      entities: [],
      terrain: { targets: [] },
    },
  };

  const offered = minecraftInhabitantActionsFor([tool('cross_visible_door')], observation);

  assert.equal(offered.length, 1);
  assert.deepEqual(offered[0].function.parameters.properties.focus.enum, [
    'block:overworld:3:65:-2',
  ]);
});

test('non-visual block references never become orientation offers', () => {
  const observation = {
    protocol: 'behold.inhabitant.v2',
    scene: {
      entities: [],
      terrain: {
        targets: [
          {
            id: 'block:overworld:30:65:-20',
            kind: 'block',
            name: 'diamond_ore',
            source: 'memory',
            visibility: 'unknown',
          },
        ],
      },
    },
  };

  assert.deepEqual(minecraftInhabitantActionsFor([tool('face_visible_target')], observation), []);
});

function tool(name: string): InhabitantActionSpec {
  const property =
    name === 'face_visible_target'
      ? {
          target: { type: 'string' },
          expectedName: { type: 'string' },
        }
      : name === 'cross_visible_door'
        ? { focus: { type: 'string' } }
        : {};
  return {
    type: 'function',
    function: {
      name,
      parameters: { type: 'object', properties: property },
    },
  };
}
