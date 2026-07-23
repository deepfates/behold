import test from 'node:test';
import assert from 'node:assert/strict';
import { minecraftInhabitantActionsFor } from '../src/agent/affordances';
import {
  minecraftActionClass,
  minecraftActionsForProfile,
  minecraftActionProfile,
  minecraftSafetyProfile,
} from '../src/agent/action-profiles';
import type { InhabitantActionSpec } from '../src/entity/interface';
import { isActionSchemaNarrowing } from '../src/policy/llm';

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

test('an empty respawned body is not offered inventory, crafting, placement, or storage fiction', () => {
  const actions = [
    schemaTool('look_direction', {}),
    schemaTool('face_visible_target', {
      target: { type: 'string' },
      expectedName: { type: 'string' },
    }),
    schemaTool('drop_item', { name: { type: 'string' } }),
    schemaTool('equip_item', { name: { type: 'string' } }),
    schemaTool('consume', { name: { type: 'string' } }),
    schemaTool('craft_item', { name: { type: 'string' } }),
    schemaTool('place_block', coordinateProperties({ name: { type: 'string' } })),
    schemaTool('place_against', coordinateProperties({ name: { type: 'string' } })),
    schemaTool('inspect_container', coordinateProperties()),
    schemaTool('deposit_in_container', coordinateProperties({ name: { type: 'string' } })),
    schemaTool('withdraw_from_container', coordinateProperties({ name: { type: 'string' } })),
    schemaTool('sleep_in_bed', coordinateProperties()),
    schemaTool('wake_up', {}),
  ];
  const observation = {
    protocol: 'behold.inhabitant.v2',
    self: {
      inventory: [],
      condition: { isDay: false, sleeping: false },
    },
    scene: {
      focus: null,
      entities: [],
      terrain: {
        targets: [visibleBlock('block:overworld:0:64:4', 'oak_leaves', 0, 64, 4)],
      },
    },
  };

  const names = minecraftInhabitantActionsFor(actions, observation).map(
    (action) => action.function.name,
  );

  assert.deepEqual(names, ['look_direction', 'face_visible_target']);
});

test('current inventory uses and cursor focus produce exact native action inputs', () => {
  const actions = [
    schemaTool('drop_item', { name: { type: 'string' } }),
    schemaTool('equip_item', { name: { type: 'string' } }),
    schemaTool('consume', { name: { type: 'string' } }),
    schemaTool('dig_block', { target: { type: 'string' } }, ['target']),
    schemaTool('place_against', {
      on: {
        type: 'object',
        properties: coordinateProperties(),
        required: ['x', 'y', 'z'],
      },
      face: { type: 'string', enum: ['top', 'bottom', 'north', 'south', 'east', 'west'] },
    }),
  ];
  const observation = {
    protocol: 'behold.inhabitant.v2',
    self: {
      heldItem: 'oak_planks',
      pose: { position: { x: 0.5, y: 64, z: 0.5 } },
      condition: { food: 16 },
      inventory: [
        { name: 'apple', count: 1, uses: ['consume', 'equip', 'drop'] },
        { name: 'oak_planks', count: 3, uses: ['place', 'equip', 'drop'] },
      ],
    },
    scene: {
      focus: {
        id: 'block:overworld:3:65:-2',
        kind: 'block',
        name: 'oak_log',
        source: 'cursor',
        reachable: true,
        position: { x: 3, y: 65, z: -2 },
      },
      entities: [],
      terrain: {
        targets: [visibleBlock('block:overworld:3:65:-2', 'oak_log', 3, 65, -2)],
      },
    },
  };

  const offered = new Map(
    minecraftInhabitantActionsFor(actions, observation).map((action) => [
      action.function.name,
      action,
    ]),
  );

  assert.deepEqual(offered.get('drop_item')?.function.parameters.properties.name.enum, [
    'apple',
    'oak_planks',
  ]);
  assert.deepEqual(offered.get('consume')?.function.parameters.properties.name.enum, ['apple']);
  const against = offered.get('place_against')?.function.parameters.properties.on.properties;
  assert.deepEqual([against.x.minimum, against.x.maximum], [3, 3]);
  assert.deepEqual([against.y.minimum, against.y.maximum], [65, 65]);
  assert.deepEqual([against.z.minimum, against.z.maximum], [-2, -2]);
  const dig = offered.get('dig_block')?.function.parameters.properties;
  assert.deepEqual(Object.keys(dig), ['target']);
  assert.deepEqual(dig.target.enum, ['block:overworld:3:65:-2']);
  assert.deepEqual(offered.get('dig_block')?.function.parameters.required, ['target']);
});

test('visual mining selects exact bounded first-hit surfaces without requiring cursor focus', () => {
  const action = schemaTool('dig_block', { target: { type: 'string' } }, ['target']);
  const observation = {
    protocol: 'behold.inhabitant.v2',
    self: {
      inventory: [],
      condition: {},
      pose: { position: { x: 0.5, y: 64, z: 0.5 } },
    },
    scene: {
      focus: null,
      entities: [],
      terrain: {
        targets: [
          { ...visibleBlock('block:overworld:1:64:0', 'oak_leaves', 1, 64, 0), distance: 2 },
          { ...visibleBlock('block:overworld:20:64:0', 'stone', 20, 64, 0), distance: 20 },
          { ...visibleBlock('block:overworld:2:62:0', 'stone', 2, 62, 0), distance: 3 },
          { ...visibleBlock('block:overworld:0:63:0', 'grass_block', 0, 63, 0), distance: 1 },
        ],
      },
    },
  };

  const [dig] = minecraftInhabitantActionsFor([action], observation);

  assert.deepEqual(Object.keys(dig.function.parameters.properties), ['target']);
  assert.deepEqual(dig.function.parameters.properties.target.enum, ['block:overworld:1:64:0']);
  assert.deepEqual(dig.function.parameters.required, ['target']);
  assert.equal(isActionSchemaNarrowing(action.function.parameters, dig.function.parameters), true);
});

test('the named player profile removes memory utilities and disclosed composite skills only', () => {
  const actions = [
    tool('look_direction'),
    tool('move_direction'),
    tool('dig_block'),
    tool('place_block'),
    tool('craft_item'),
    tool('manage_project'),
    tool('cross_place_door'),
    tool('cross_visible_door'),
    tool('descend_step'),
    tool('ascend_step'),
    tool('future_controller_magic'),
  ];

  assert.deepEqual(
    minecraftActionsForProfile(actions, 'minecraft-player-v1').map(
      (action) => action.function.name,
    ),
    ['look_direction', 'move_direction', 'dig_block'],
  );
  assert.equal(minecraftActionClass('manage_project'), 'resident-memory-utility');
  assert.equal(minecraftActionClass('cross_visible_door'), 'disclosed-composite-skill');
  assert.equal(minecraftActionClass('place_block'), 'disclosed-composite-skill');
  assert.equal(minecraftActionClass('craft_item'), 'disclosed-composite-skill');
  assert.equal(minecraftActionClass('dig_block'), 'player-intention');
  assert.equal(minecraftActionClass('future_controller_magic'), 'unclassified');
  assert.equal(minecraftActionProfile('minecraft-player-v1'), 'minecraft-player-v1');
  assert.equal(minecraftSafetyProfile('vanilla-player-v1'), 'vanilla-player-v1');
  assert.throws(() => minecraftActionProfile('helpful-agent-v9'), /Unsupported Minecraft action/);
  assert.throws(() => minecraftSafetyProfile('hidden-safety'), /Unsupported Minecraft safety/);
});

test('vanilla player risk exposes visible support and lower blocks without recommending them', () => {
  const action = schemaTool('dig_block', { target: { type: 'string' } }, ['target']);
  const observation = {
    protocol: 'behold.inhabitant.v2',
    self: { pose: { position: { x: 0.5, y: 64, z: 0.5 } } },
    scene: {
      entities: [],
      terrain: {
        targets: [
          { ...visibleBlock('block:overworld:0:63:0', 'grass_block', 0, 63, 0), distance: 1 },
          { ...visibleBlock('block:overworld:1:62:0', 'stone', 1, 62, 0), distance: 3 },
        ],
      },
    },
  };

  assert.deepEqual(minecraftInhabitantActionsFor([action], observation), []);
  const [dig] = minecraftInhabitantActionsFor([action], observation, {
    safetyProfile: 'vanilla-player-v1',
  });
  assert.deepEqual(dig.function.parameters.properties.target.enum, [
    'block:overworld:0:63:0',
    'block:overworld:1:62:0',
  ]);
});

test('consumption follows Mineflayer hunger and always-consumable semantics', () => {
  const actions = [schemaTool('consume', { name: { type: 'string' } })];
  const observation = {
    protocol: 'behold.inhabitant.v2',
    self: {
      condition: { food: 20 },
      inventory: [
        { name: 'apple', count: 1, uses: ['consume', 'equip', 'drop'] },
        { name: 'potion', count: 1, uses: ['consume', 'equip', 'drop'] },
        { name: 'milk_bucket', count: 1, uses: ['consume', 'equip', 'drop'] },
      ],
    },
    scene: { focus: null, entities: [], terrain: { targets: [] } },
  };

  const [consume] = minecraftInhabitantActionsFor(actions, observation);
  assert.deepEqual(consume.function.parameters.properties.name.enum, ['potion', 'milk_bucket']);
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

function schemaTool(
  name: string,
  properties: Record<string, unknown>,
  required?: string[],
): InhabitantActionSpec {
  return {
    type: 'function',
    function: {
      name,
      parameters: { type: 'object', properties, ...(required ? { required } : {}) },
    },
  };
}

function coordinateProperties(extra: Record<string, unknown> = {}) {
  return {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
    ...extra,
  };
}

function visibleBlock(id: string, name: string, x: number, y: number, z: number) {
  return {
    id,
    kind: 'block',
    name,
    source: 'vision',
    visibility: 'visible',
    position: { x, y, z },
    distance: 4,
    ray: { row: 2, column: 4 },
  };
}
