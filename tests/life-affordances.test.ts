import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { buildInterpreter } from '../src/agent/interpreter';
import { droppedItemPickupGround } from '../src/agent/observation';
import { minecraftActionClass, minecraftActionsForProfile } from '../src/agent/action-profiles';

function baseBot() {
  const bot: any = new EventEmitter();
  bot.version = '1.21.4';
  bot.username = 'Scout';
  bot.entity = { id: 1, position: new Vec3(0, 64, 0) };
  bot.entities = { 1: bot.entity };
  bot.inventoryItems = [] as any[];
  bot.inventory = { items: () => bot.inventoryItems };
  return bot;
}

test('the inhabitant action space excludes raw controls, duplicate probes, and privileged scans', () => {
  const interpreter = buildInterpreter(baseBot());
  const inhabitantActions = interpreter.list('inhabitant').map((spec) => spec.name);
  const allActions = interpreter.list().map((spec) => spec.name);
  const playerActions = minecraftActionsForProfile(
    interpreter.list('inhabitant').map((spec) => ({
      type: 'function' as const,
      function: {
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
      },
    })),
    'minecraft-player-v1',
  );

  assert.deepEqual(
    inhabitantActions.filter((name) => minecraftActionClass(name) === 'unclassified'),
    [],
    'every current inhabitant action must be deliberately classified before profile publication',
  );

  assert.ok(inhabitantActions.includes('move_to'));
  assert.ok(inhabitantActions.includes('move_direction'));
  assert.ok(inhabitantActions.includes('look_direction'));
  assert.ok(inhabitantActions.includes('face_visible_target'));
  assert.ok(inhabitantActions.includes('descend_step'));
  assert.ok(inhabitantActions.includes('ascend_step'));
  assert.ok(inhabitantActions.includes('cross_visible_door'));
  assert.ok(inhabitantActions.includes('craft_item'));
  assert.ok(inhabitantActions.includes('attack_entity'));
  assert.equal(
    playerActions.some((action) => action.function.name === 'craft_item'),
    false,
  );
  assert.equal(
    playerActions.some((action) => action.function.name === 'place_block'),
    false,
  );
  assert.ok(playerActions.every((action) => Boolean(action.function.description)));
  assert.doesNotMatch(
    playerActions.map((action) => action.function.description).join('\n'),
    /\bprefer\b|do not|does not replace|use move_to|approach and look before/i,
  );
  const move = interpreter.describe('move_to');
  assert.deepEqual(move?.parameters.required, ['x', 'y', 'z']);
  assert.deepEqual(Object.keys(move?.parameters.properties || {}), ['x', 'y', 'z', 'near']);
  const relativeMove = interpreter.describe('move_direction');
  assert.deepEqual(relativeMove?.parameters.required, ['direction']);
  assert.deepEqual(Object.keys(relativeMove?.parameters.properties || {}), [
    'direction',
    'distance',
  ]);
  assert.deepEqual(relativeMove?.parameters.properties.direction.enum, [
    'forward',
    'back',
    'left',
    'right',
  ]);
  const approach = interpreter.describe('approach_entity');
  assert.deepEqual(approach?.parameters.required, ['target']);
  assert.deepEqual(Object.keys(approach?.parameters.properties || {}), ['target']);
  const fight = interpreter.describe('attack_entity');
  assert.deepEqual(fight?.parameters.required, ['target']);
  assert.deepEqual(Object.keys(fight?.parameters.properties || {}), ['target']);
  const pickup = interpreter.describe('collect_nearby_item');
  assert.deepEqual(pickup?.parameters.required, ['target']);
  assert.deepEqual(Object.keys(pickup?.parameters.properties || {}), ['target']);
  assert.equal(inhabitantActions.includes('set_control'), false);
  assert.equal(inhabitantActions.includes('look_at'), false);
  assert.equal(inhabitantActions.includes('look'), false);
  assert.equal(inhabitantActions.includes('clear_controls'), false);
  assert.equal(inhabitantActions.includes('survey_area'), false);
  assert.equal(inhabitantActions.includes('find_blocks'), false);
  assert.equal(inhabitantActions.includes('inspect_volume'), false);
  assert.equal(inhabitantActions.includes('inspect_reachable_space'), false);
  assert.equal(inhabitantActions.includes('nearest_entity'), false);
  assert.equal(inhabitantActions.includes('get_nearby'), false);
  assert.equal(inhabitantActions.includes('block_at_cursor'), false);
  assert.equal(inhabitantActions.includes('entity_at_cursor'), false);
  assert.equal(inhabitantActions.includes('status'), false);
  assert.equal(inhabitantActions.includes('guide_entity_to_place'), false);
  assert.equal(inhabitantActions.includes('teach_player'), false);
  assert.equal(inhabitantActions.includes('build_home'), false);
  assert.ok(allActions.includes('set_control'));
  assert.ok(allActions.includes('look'));
  assert.ok(allActions.includes('survey_area'));
  assert.ok(allActions.includes('find_blocks'));
  assert.ok(allActions.includes('inspect_volume'));
  assert.ok(allActions.includes('inspect_reachable_space'));
  assert.ok(allActions.includes('nearest_entity'));
  assert.ok(allActions.includes('get_nearby'));
  assert.ok(allActions.includes('look_at'));
  assert.ok(allActions.includes('block_at_cursor'));
  assert.ok(allActions.includes('entity_at_cursor'));
  assert.ok(allActions.includes('status'));
});

test('look_direction exposes bounded relative player orientation without raw angles', async () => {
  const bot = baseBot();
  bot.entity.yaw = 0;
  bot.entity.pitch = 0;
  const calls: Array<{ yaw: number; pitch: number; force: boolean }> = [];
  bot.look = async (yaw: number, pitch: number, force: boolean) => {
    calls.push({ yaw, pitch, force });
    bot.entity.yaw = yaw;
    bot.entity.pitch = pitch;
  };
  const interpreter = buildInterpreter(bot);
  const spec = interpreter.describe('look_direction');

  assert.deepEqual(spec?.parameters.required, ['horizontal', 'vertical']);
  assert.deepEqual(spec?.parameters.properties.horizontal.enum, [
    'same',
    'left',
    'right',
    'around',
  ]);
  assert.deepEqual(spec?.parameters.properties.vertical.enum, ['same', 'up', 'level', 'down']);

  const leftDown = await interpreter.run('look_direction', {
    horizontal: 'left',
    vertical: 'down',
  });
  assert.equal(leftDown.ok, true);
  assert.deepEqual(leftDown.from, {
    facing: 'north',
    vertical: 'level',
  });
  assert.deepEqual(leftDown.orientation, {
    facing: 'west',
    vertical: 'down',
  });

  await interpreter.run('look_direction', { horizontal: 'around', vertical: 'same' });
  const up = await interpreter.run('look_direction', { horizontal: 'same', vertical: 'up' });
  assert.equal(up.ok, true);
  assert.equal(up.orientation.vertical, 'up');
  assert.ok(Math.abs(calls.at(-1)!.pitch - Math.PI / 6) < 0.001);
  const level = await interpreter.run('look_direction', {
    horizontal: 'same',
    vertical: 'level',
  });
  assert.equal(level.orientation.vertical, 'level');
  assert.equal(calls.at(-1)!.pitch, 0);
  bot.entity.pitch = (80 * Math.PI) / 180;
  const bounded = await interpreter.run('look_direction', {
    horizontal: 'same',
    vertical: 'up',
  });
  assert.equal(bounded.ok, true);
  assert.ok(Math.abs(calls.at(-1)!.pitch - Math.PI / 6) < 0.001);
  assert.ok(calls.every((call) => call.force === false));
});

test('look_direction fails closed when orientation is unavailable or unconfirmed', async () => {
  const unavailable = baseBot();
  unavailable.entity.yaw = null;
  unavailable.entity.pitch = 0;
  unavailable.look = async () => {};
  assert.deepEqual(
    await buildInterpreter(unavailable).run('look_direction', {
      horizontal: 'left',
      vertical: 'same',
    }),
    {
      ok: false,
      error: 'body_orientation_unavailable',
    },
  );

  const unchanged = baseBot();
  unchanged.entity.yaw = 0;
  unchanged.entity.pitch = 0;
  unchanged.look = async () => {};
  const unconfirmed = await buildInterpreter(unchanged).run('look_direction', {
    horizontal: 'right',
    vertical: 'same',
  });
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.error, 'body_orientation_unconfirmed');
  assert.deepEqual(
    await buildInterpreter(unchanged).run('look_direction', {
      horizontal: 'sideways',
      vertical: 'same',
    }),
    {
      ok: false,
      error: 'unknown_horizontal_look_direction',
      horizontal: 'sideways',
      vertical: 'same',
    },
  );
  assert.deepEqual(
    await buildInterpreter(unchanged).run('look_direction', {
      horizontal: 'same',
      vertical: 'sideways',
    }),
    {
      ok: false,
      error: 'unknown_vertical_look_direction',
      horizontal: 'same',
      vertical: 'sideways',
    },
  );
  assert.deepEqual(
    await buildInterpreter(unchanged).run('look_direction', {
      horizontal: 'same',
      vertical: 'same',
    }),
    {
      ok: false,
      error: 'look_direction_unchanged',
      horizontal: 'same',
      vertical: 'same',
    },
  );

  let called = false;
  unchanged.look = async () => {
    called = true;
  };
  const abort = new AbortController();
  abort.abort();
  const cancelled = await buildInterpreter(unchanged).run(
    'look_direction',
    { horizontal: 'left', vertical: 'down' },
    { signal: abort.signal },
  );
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.error, 'interrupted_by_human');
  assert.equal(called, false);
});

test('face_visible_target revalidates one exact first-person ray target and confirms cursor focus', async () => {
  const bot = baseBot();
  bot.game = { dimension: 'overworld' };
  bot.entity.yaw = 0;
  bot.entity.pitch = 0;
  bot.entity.eyeHeight = 1.62;
  const position = new Vec3(3, 65, -2);
  let oriented = false;
  let lookedAt: Vec3 | null = null;
  bot.lookAt = async (target: Vec3, force: boolean) => {
    lookedAt = target;
    assert.equal(force, true);
    oriented = true;
  };
  bot.world = {
    raycast: () =>
      oriented
        ? {
            name: 'oak_door',
            position,
            intersect: position.offset(0.5, 0.5, 0.5),
          }
        : null,
  };
  const observation = {
    protocol: 'behold.inhabitant.v2',
    scene: {
      terrain: {
        maxDistance: 24,
        targets: [
          {
            id: 'block:overworld:3:65:-2',
            kind: 'block',
            name: 'oak_door',
            source: 'vision',
            visibility: 'visible',
            position: { x: 3, y: 65, z: -2 },
            distance: 4,
            ray: { row: 2, column: 7 },
          },
        ],
      },
    },
  };
  const interpreter = buildInterpreter(bot, { observe: () => observation });

  const result = await interpreter.run('face_visible_target', {
    target: 'block:overworld:3:65:-2',
    expectedName: 'oak_door',
  });

  assert.equal(result.ok, true);
  assert.equal(result.confirmation, 'mineflayer:cursor_block');
  assert.equal(result.target.id, 'block:overworld:3:65:-2');
  assert.deepEqual(result.target.selectedRay, { row: 2, column: 7 });
  assert.deepEqual(lookedAt, new Vec3(3.5, 65.5, -1.5));
});

test('face_visible_target fails before turning when its observed identity is stale', async () => {
  const bot = baseBot();
  let turned = false;
  bot.lookAt = async () => {
    turned = true;
  };
  const interpreter = buildInterpreter(bot, {
    observe: () => ({
      protocol: 'behold.inhabitant.v2',
      scene: {
        terrain: {
          targets: [
            {
              id: 'block:overworld:3:65:-2',
              kind: 'block',
              name: 'stone',
              source: 'vision',
              visibility: 'visible',
              position: { x: 3, y: 65, z: -2 },
            },
          ],
        },
      },
    }),
  });

  const result = await interpreter.run('face_visible_target', {
    target: 'block:overworld:3:65:-2',
    expectedName: 'oak_door',
  });

  assert.deepEqual(result, {
    ok: false,
    error: 'visible_target_identity_changed',
    target: 'block:overworld:3:65:-2',
    expectedName: 'oak_door',
    observedName: 'stone',
  });
  assert.equal(turned, false);
});

test('find_blocks returns actionable local positions without claiming visibility', async () => {
  const bot = baseBot();
  bot.findBlocks = () => [new Vec3(2, 64, 1), new Vec3(4, 64, 0)];
  bot.blockAt = (position: Vec3) => ({
    name: position.y === 63 ? 'grass_block' : 'oak_log',
    position,
  });
  const interpreter = buildInterpreter(bot);

  const result = await interpreter.run('find_blocks', {
    name: 'oak log',
    maxDistance: 8,
    count: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.visibility, 'unknown');
  assert.deepEqual(result.blocks[0], {
    name: 'oak_log',
    position: { x: 2, y: 64, z: 1 },
    distance: 2.2,
    withinImmediateDigReach: true,
    supportBelow: 'grass_block',
    likelyGrounded: true,
  });
  assert.equal(result.coordinateMeaning, 'solid_block_target_not_feet_position');
  assert.equal(
    result.nextAffordance,
    'Approach and look until a chosen lead becomes a current scene.terrain target, then mine that exact visible target.',
  );
});

test('find_blocks scans past unsafe nearest matches to expose a useful target', async () => {
  const bot = baseBot();
  let scanned = 0;
  bot.findBlocks = ({ count }: any) => {
    scanned = count;
    return [new Vec3(0, 63, 0), new Vec3(5, 64, 0)];
  };
  bot.blockAt = (position: Vec3) => ({
    name: position.y === 63 ? 'grass_block' : 'oak_log',
    position,
  });
  const interpreter = buildInterpreter(bot);

  const result = await interpreter.run('find_blocks', {
    name: 'oak log',
    maxDistance: 16,
    count: 1,
  });

  assert.ok(scanned > 1);
  assert.equal(result.omittedUnsafeTargets, 1);
  assert.deepEqual(
    result.blocks.map((block: any) => block.position),
    [{ x: 5, y: 64, z: 0 }],
  );
});

test('inspect_volume returns compact coordinate-aligned local geometry', async () => {
  const bot = baseBot();
  bot.blockAt = (position: Vec3) => {
    const name =
      position.y === 63
        ? 'grass_block'
        : position.x === 1 && position.y === 64 && position.z === 0
          ? 'spruce_planks'
          : 'air';
    return {
      name,
      type: name === 'air' ? 0 : 1,
      stateId: name === 'air' ? 0 : 1,
      boundingBox: name === 'air' ? 'empty' : 'block',
      position,
    };
  };

  const result = await buildInterpreter(bot).run('inspect_volume', {
    radius: 1,
    verticalRadius: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'loaded_local_terrain');
  assert.equal(result.visibility, 'unknown');
  assert.deepEqual(result.bounds, {
    x: { min: -1, max: 1 },
    y: { min: 63, max: 65 },
    z: { min: -1, max: 1 },
  });
  assert.deepEqual(result.palette, {
    '.': 'air',
    '?': 'unloaded',
    '0': 'grass_block',
    '1': 'spruce_planks',
  });
  assert.deepEqual(
    result.layers.map((layer: any) => ({
      y: layer.y,
      rows: layer.rows.map((row: any) => row.cells),
    })),
    [
      { y: 65, rows: ['...', '...', '...'] },
      { y: 64, rows: ['...', '..1', '...'] },
      { y: 63, rows: ['000', '000', '000'] },
    ],
  );
  assert.deepEqual(result.bodyFeet, { x: 0, y: 64, z: 0 });
});

test('inspect_reachable_space proves a sealed covered space with room for two bodies', async () => {
  const bot = baseBot();
  bot.blockAt = (position: Vec3) => {
    const interior =
      (position.x === 0 || position.x === 1) &&
      position.z === 0 &&
      (position.y === 64 || position.y === 65);
    const door = position.x === 2 && position.z === 0 && (position.y === 64 || position.y === 65);
    const outside =
      position.x === 3 && position.z === 0 && (position.y === 64 || position.y === 65);
    const name = interior || outside ? 'air' : door ? 'oak_door' : 'stone';
    return {
      name,
      boundingBox: name === 'air' ? 'empty' : 'block',
      position,
      getProperties: door ? () => ({ open: false }) : undefined,
    };
  };

  const result = await buildInterpreter(bot).run('inspect_reachable_space', {
    feet: { x: 0, y: 64, z: 0 },
    radius: 2,
    verticalRadius: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reachableCellCount, 2);
  assert.equal(result.coveredCellCount, 2);
  assert.equal(result.sealed, true);
  assert.equal(result.fullyCovered, true);
  assert.equal(result.sharedCapacity, true);
  assert.equal(result.closableEntranceCount, 1);
  assert.deepEqual(result.closableEntrances[0], {
    name: 'oak_door',
    lower: { x: 2, y: 64, z: 0 },
    upper: { x: 2, y: 65, z: 0 },
    state: 'closed',
    fromProtectedFeet: { x: 1, y: 64, z: 0 },
    outsideFeet: { x: 3, y: 64, z: 0 },
    outsideSupport: 'stone',
  });
  assert.deepEqual(
    result.protectedCells.map((cell: any) => cell.feet),
    [
      { x: 0, y: 64, z: 0 },
      { x: 1, y: 64, z: 0 },
    ],
  );
});

test('inspect_reachable_space does not call a sealed box an enterable shelter', async () => {
  const bot = baseBot();
  bot.blockAt = (position: Vec3) => {
    const interior =
      (position.x === 0 || position.x === 1) &&
      position.z === 0 &&
      (position.y === 64 || position.y === 65);
    const name = interior ? 'air' : 'stone';
    return {
      name,
      boundingBox: name === 'air' ? 'empty' : 'block',
      position,
    };
  };

  const result = await buildInterpreter(bot).run('inspect_reachable_space', {
    feet: { x: 0, y: 64, z: 0 },
    radius: 2,
    verticalRadius: 1,
  });

  assert.equal(result.sealed, true);
  assert.equal(result.sharedCapacity, true);
  assert.equal(result.closableEntranceCount, 0);
  assert.match(result.nextAffordance, /no usable entrance/i);
});

test('inspect_reachable_space exposes an exact opening from roofed space to outside', async () => {
  const bot = baseBot();
  bot.blockAt = (position: Vec3) => {
    const bodySpace =
      position.z === 0 &&
      position.x >= -2 &&
      position.x <= 1 &&
      (position.y === 64 || position.y === 65);
    const outsideSky = position.z === 0 && position.x < 0 && position.y >= 66;
    const name = bodySpace || outsideSky ? 'air' : 'stone';
    return {
      name,
      boundingBox: name === 'air' ? 'empty' : 'block',
      position,
    };
  };

  const result = await buildInterpreter(bot).run('inspect_reachable_space', {
    feet: { x: 0, y: 64, z: 0 },
    radius: 2,
    verticalRadius: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.sealed, false);
  assert.equal(result.fullyCovered, false);
  assert.equal(result.sharedCapacity, false);
  assert.deepEqual(result.scanEdgeCells, [{ x: -2, y: 64, z: 0 }]);
  assert.deepEqual(result.openingsFromProtectedSpace[0], {
    direction: 'west',
    fromProtectedFeet: { x: 0, y: 64, z: 0 },
    towardUncoveredFeet: { x: -1, y: 64, z: 0 },
    candidateClosureCells: [
      { x: -1, y: 64, z: 0 },
      { x: -1, y: 65, z: 0 },
    ],
  });
});

test('inspect_volume refuses exact geometry sensing outside the local worksite', async () => {
  const result = await buildInterpreter(baseBot()).run('inspect_volume', {
    center: { x: 20, y: 64, z: 0 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'volume_center_not_local');
});

test('the body bounds one move_to leg without asking the resident for a travel budget', async () => {
  const bot = baseBot();
  bot.pathfinder = {
    goto: async (goal: any) => {
      bot.entity.position = new Vec3(goal.x, goal.y, goal.z);
    },
    stop: () => {},
  };

  const result = await buildInterpreter(bot, { moveLegDistance: 6 }).run('move_to', {
    x: 20,
    y: 64,
    z: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'advanced_toward');
  assert.deepEqual(result.requestedDestination, { x: 20, y: 64, z: 0 });
  assert.equal(result.bodyLegLimit, 6);
  assert.deepEqual(result.legDestination, { x: 6, y: 64, z: 0 });
  assert.equal(result.remainingDistance, 14);
  assert.equal(result.arrivedAtRequestedDestination, false);
});

test('move_to reports when its requested range caused no bodily movement', async () => {
  const bot = baseBot();
  bot.entity.position = new Vec3(49.5028, 65, 92.685);
  bot.pathfinder = {
    goto: async () => {},
    stop: () => {},
  };

  const result = await buildInterpreter(bot).run('move_to', {
    x: 49.5,
    y: 65,
    z: 91.5,
    near: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'already_within_requested_range');
  assert.equal(result.bodyMoved, false);
  assert.equal(result.bodyDisplacement, 0);
  assert.equal(result.progressDistance, 0);
  assert.equal(result.arrivedAtRequestedDestination, true);
  assert.equal(result.bodyStartedWithinLegGoal, true);

  bot.entity.position = new Vec3(54.4999, 65, 93.3523);
  const outsideGoalNoOp = await buildInterpreter(bot).run('move_to', {
    x: 53,
    y: 65,
    z: 93,
    near: 0.8,
  });
  assert.equal(outsideGoalNoOp.ok, false);
  assert.equal(outsideGoalNoOp.status, 'no_body_movement');
  assert.equal(outsideGoalNoOp.error, 'body_not_moved');
  assert.equal(outsideGoalNoOp.bodyStartedWithinLegGoal, false);
  assert.equal(outsideGoalNoOp.bodyMoved, false);
  assert.equal(outsideGoalNoOp.arrivedAtRequestedDestination, false);
});

test('move_direction derives all local destinations from the body view without coordinates', async () => {
  const bot = baseBot();
  bot.entity.yaw = 0;
  bot.entity.pitch = 0;
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  bot.pathfinder = {
    goto: async (goal: any) => {
      bot.entity.position = new Vec3(goal.x + 0.5, 64, goal.z + 0.5);
    },
    stop: () => {},
  };
  bot.blockAt = (position: Vec3) => ({
    name: position.y === 63 ? 'stone' : 'air',
    boundingBox: position.y === 63 ? 'block' : 'empty',
    position,
  });
  const interpreter = buildInterpreter(bot);

  const forward = await interpreter.run('move_direction', { direction: 'forward' });
  assert.equal(forward.ok, true);
  assert.equal(forward.distanceBlocks, 4);
  assert.deepEqual(forward.intendedFeet, { x: 0, y: 64, z: -4 });
  assert.deepEqual(forward.finalFeet, { x: 0, y: 64, z: -4 });
  assert.equal(forward.orientationAtStart.facing, 'north');
  assert.ok(forward.displacement.forward > 3);

  bot.entity.position = new Vec3(0.5, 64, 0.5);
  const back = await interpreter.run('move_direction', { direction: 'back', distance: 2 });
  assert.deepEqual(back.intendedFeet, { x: 0, y: 64, z: 2 });
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  const left = await interpreter.run('move_direction', { direction: 'left', distance: 2 });
  assert.deepEqual(left.intendedFeet, { x: -2, y: 64, z: 0 });
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  const right = await interpreter.run('move_direction', { direction: 'right', distance: 99 });
  assert.equal(right.distanceBlocks, 8);
  assert.deepEqual(right.intendedFeet, { x: 8, y: 64, z: 0 });
});

test('move_direction treats water as traversable locomotion without requiring dry support', async () => {
  const bot = baseBot();
  bot.entity.yaw = 0;
  bot.entity.pitch = 0;
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  let pathfinderCalls = 0;
  bot.pathfinder = {
    goto: async (goal: any) => {
      pathfinderCalls += 1;
      bot.entity.position = new Vec3(goal.x + 0.5, 64, goal.z + 0.5);
    },
    stop: () => {},
  };
  bot.blockAt = (position: Vec3) => ({
    name: position.y === 64 || position.y === 65 ? 'water' : 'air',
    boundingBox: 'empty',
    position,
  });

  const result = await buildInterpreter(bot).run('move_direction', {
    direction: 'forward',
    distance: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.bodyMoved, true);
  assert.equal(pathfinderCalls, 1);
  assert.deepEqual(result.intendedFeet, { x: 0, y: 64, z: -3 });
});

test('move_direction fails closed and explains only adjacent player-scale obstruction', async () => {
  const unavailable = baseBot();
  unavailable.entity.yaw = null;
  unavailable.entity.pitch = 0;
  unavailable.pathfinder = { goto: async () => {}, stop: () => {} };
  assert.deepEqual(
    await buildInterpreter(unavailable).run('move_direction', { direction: 'forward' }),
    { ok: false, error: 'body_orientation_unavailable' },
  );

  const noPathfinder = baseBot();
  noPathfinder.entity.yaw = 0;
  noPathfinder.entity.pitch = 0;
  assert.deepEqual(
    await buildInterpreter(noPathfinder).run('move_direction', { direction: 'forward' }),
    { ok: false, error: 'pathfinder_unavailable' },
  );

  const bot = baseBot();
  bot.entity.yaw = 0;
  bot.entity.pitch = 0;
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  let pathfinderCalls = 0;
  bot.pathfinder = {
    goto: async () => {
      pathfinderCalls += 1;
      throw new Error('No path to goal');
    },
    stop: () => {},
  };
  bot.blockAt = (position: Vec3) => {
    const blocked = position.x === 0 && position.y === 64 && position.z === -1;
    const support = position.x === 0 && position.y === 63 && position.z === -1;
    return {
      name: blocked ? 'stone_bricks' : support ? 'stone' : 'air',
      boundingBox: blocked || support ? 'block' : 'empty',
      position,
    };
  };
  const interpreter = buildInterpreter(bot);
  assert.deepEqual(await interpreter.run('move_direction', { direction: 'sideways' }), {
    ok: false,
    error: 'unknown_move_direction',
    direction: 'sideways',
  });
  const result = await interpreter.run('move_direction', { direction: 'forward', distance: 3 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'immediate_direction_unavailable');
  assert.equal(pathfinderCalls, 0);
  assert.deepEqual(result.obstruction, {
    scope: 'adjacent_body_space',
    issue: 'feet_blocked',
    feet: {
      position: { x: 0, y: 64, z: -1 },
      block: 'stone_bricks',
      passable: false,
    },
    head: { position: { x: 0, y: 65, z: -1 }, block: 'air', passable: true },
    support: { position: { x: 0, y: 63, z: -1 }, block: 'stone', safe: true },
  });
  assert.equal(Object.hasOwn(result.obstruction, 'alternatives'), false);

  bot.blockAt = (position: Vec3) => ({
    name: position.y === 63 ? 'stone' : 'air',
    boundingBox: position.y === 63 ? 'block' : 'empty',
    position,
  });
  bot.pathfinder.goto = async () => {
    pathfinderCalls += 1;
    throw new Error('No path to goal');
  };
  const noPath = await interpreter.run('move_direction', {
    direction: 'forward',
    distance: 3,
  });
  assert.equal(noPath.ok, false);
  assert.equal(noPath.error, 'no_path');
  assert.equal(pathfinderCalls, 1);

  bot.pathfinder.goto = async () => {};
  const unconfirmed = await interpreter.run('move_direction', {
    direction: 'back',
    distance: 3,
  });
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.error, 'arrival_unconfirmed');

  const oneBlockNoOp = await interpreter.run('move_direction', {
    direction: 'back',
    distance: 1,
  });
  assert.equal(oneBlockNoOp.ok, false);
  assert.equal(oneBlockNoOp.status, 'no_body_movement');
  assert.equal(oneBlockNoOp.error, 'body_not_moved');
  assert.equal(oneBlockNoOp.bodyMoved, false);
  assert.equal(oneBlockNoOp.bodyDisplacement, 0);
});

test('move_direction stops pathfinding at a strict player-scale movement envelope', async () => {
  const bot = baseBot();
  bot.entity.yaw = 0;
  bot.entity.pitch = 0;
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  bot.blockAt = (position: Vec3) => ({
    name: position.y === 63 ? 'stone' : 'air',
    boundingBox: position.y === 63 ? 'block' : 'empty',
    position,
  });
  let rejectPath!: (error: Error) => void;
  let stopCalls = 0;
  bot.pathfinder = {
    goto: () => new Promise<void>((_resolve, reject) => (rejectPath = reject)),
    stop: () => {
      stopCalls += 1;
      rejectPath(new Error('Path was stopped before it could be completed'));
    },
  };

  const pending = buildInterpreter(bot).run('move_direction', {
    direction: 'forward',
    distance: 4,
  });
  await Promise.resolve();
  bot.entity.position = new Vec3(0.5, 68, -6.5);
  bot.emit('move');
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.error, 'movement_envelope_exceeded');
  assert.equal(stopCalls, 1);
  assert.deepEqual(result.movementLimit, {
    horizontalFromStart: 7,
    verticalFromStart: 4,
    maxHorizontalFromStart: 6,
    maxVerticalFromStart: 3,
  });
});

test('move_direction keeps an exceeded movement envelope terminal when stop resolves navigation', async () => {
  const bot = baseBot();
  bot.entity.yaw = 0;
  bot.entity.pitch = 0;
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  bot.blockAt = (position: Vec3) => ({
    name: position.y === 63 ? 'stone' : 'air',
    boundingBox: position.y === 63 ? 'block' : 'empty',
    position,
  });
  let resolvePath!: () => void;
  bot.pathfinder = {
    goto: () => new Promise<void>((resolve) => (resolvePath = resolve)),
    stop: () => resolvePath(),
  };

  const pending = buildInterpreter(bot).run('move_direction', {
    direction: 'forward',
    distance: 4,
  });
  await Promise.resolve();
  bot.entity.position = new Vec3(0.5, 68, -6.5);
  bot.emit('move');
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.error, 'movement_envelope_exceeded');
});

test('move_direction preserves acknowledged pathfinder cancellation', async () => {
  const bot = baseBot();
  bot.entity.yaw = 0;
  bot.entity.pitch = 0;
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  bot.blockAt = (position: Vec3) => ({
    name: position.y === 63 ? 'stone' : 'air',
    boundingBox: position.y === 63 ? 'block' : 'empty',
    position,
  });
  let rejectPath!: (error: Error) => void;
  bot.pathfinder = {
    goto: () => new Promise<void>((_resolve, reject) => (rejectPath = reject)),
    stop: () => {
      const error = new Error('Path was stopped before it could be completed');
      error.name = 'PathStopped';
      rejectPath(error);
    },
  };
  const controller = new AbortController();
  const pending = buildInterpreter(bot).run(
    'move_direction',
    { direction: 'forward' },
    { signal: controller.signal },
  );
  controller.abort('human_stop');
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.error, 'interrupted_by_human');
  assert.deepEqual(result.cancellation, {
    acknowledged: true,
    adapter: 'mineflayer-pathfinder',
  });
});

test('move_to reports cancellation only after Mineflayer pathfinding acknowledges stop', async () => {
  const bot = baseBot();
  let rejectPath!: (error: Error) => void;
  let stopCalls = 0;
  bot.pathfinder = {
    goto: () => new Promise<void>((_resolve, reject) => (rejectPath = reject)),
    stop: () => {
      stopCalls += 1;
      const error = new Error('Path was stopped before it could be completed');
      error.name = 'PathStopped';
      rejectPath(error);
    },
  };
  const controller = new AbortController();

  const pending = buildInterpreter(bot).run(
    'move_to',
    { x: 8, y: 64, z: 0 },
    { signal: controller.signal },
  );
  controller.abort('human_stop');
  const result = await pending;

  assert.equal(stopCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'interrupted_by_human');
  assert.deepEqual(result.cancellation, {
    acknowledged: true,
    adapter: 'mineflayer-pathfinder',
  });
  assert.deepEqual(result.start, { x: 0, y: 64, z: 0 });
  assert.deepEqual(result.final, { x: 0, y: 64, z: 0 });
  assert.equal(result.remainingDistance, 8);
});

test('approach_entity updates a last-seen goal while the exact entity remains perceived', async () => {
  const bot = baseBot();
  const decoy = {
    id: 2,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(2, 64, 0),
  };
  const target = {
    id: 3,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(8, 64, 0),
  };
  bot.entities[2] = decoy;
  bot.entities[3] = target;
  bot.lookAt = async () => {};
  const goals: Array<{ x: number; y: number; z: number }> = [];
  let movementScheduled = false;
  bot.pathfinder = {
    setGoal: (goal: any) => {
      if (!goal) return;
      goals.push({ x: goal.x, y: goal.y, z: goal.z });
      if (movementScheduled) return;
      movementScheduled = true;
      setTimeout(() => {
        target.position = new Vec3(10, 64, 0);
        bot.entity.position = new Vec3(8, 64, 0);
      }, 5);
    },
    stop: () => bot.emit('path_stop'),
  };

  const result = await buildInterpreter(bot, { approachTimeoutMs: 1000 }).run('approach_entity', {
    target: 'entity:3',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'arrived');
  assert.equal(result.target, 'entity:3');
  assert.equal(result.targetEntityId, 3);
  assert.equal(result.finalDistance, 2);
  assert.equal(result.confirmation, 'mineflayer:body_target_proximity');
  assert.equal(result.pathfinderStopAcknowledged, true);
  assert.deepEqual(goals, [
    { x: 8, y: 64, z: 0 },
    { x: 10, y: 64, z: 0 },
  ]);
});

test('approach_entity never follows a hidden live coordinate beyond the last-seen position', async () => {
  const bot = baseBot();
  const target = {
    id: 3,
    name: 'villager',
    type: 'mob',
    position: new Vec3(8, 64, 0),
  };
  bot.entities[3] = target;
  bot.lookAt = async () => {};
  let perceived = true;
  const goals: number[] = [];
  bot.pathfinder = {
    setGoal: (goal: any) => {
      if (!goal) return;
      goals.push(goal.x);
      if (goals.length !== 1) return;
      setTimeout(() => {
        perceived = false;
        target.position = new Vec3(20, 64, 0);
        bot.entity.position = new Vec3(6, 64, 0);
      }, 5);
    },
    stop: () => bot.emit('path_stop'),
  };
  const interpreter = buildInterpreter(bot, {
    approachTimeoutMs: 1000,
    observe: () => ({
      protocol: 'behold.inhabitant.v2',
      scene: {
        entities: perceived
          ? [{ id: 'entity:3', kind: 'mob', source: 'vision', visibility: 'visible' }]
          : [],
      },
    }),
  });

  const result = await interpreter.run('approach_entity', { target: 'entity:3' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'target_lost_at_last_seen');
  assert.deepEqual(result.lastSeenPosition, { x: 8, y: 64, z: 0 });
  assert.equal(result.finalDistance, null);
  assert.equal(result.targetPerceivedAtTerminal, false);
  assert.deepEqual(goals, [8]);
});

test('approach_entity rechecks proximity after Mineflayer acknowledges the stop', async () => {
  const bot = baseBot();
  const target = {
    id: 3,
    name: 'villager',
    type: 'mob',
    position: new Vec3(8, 64, 0),
  };
  bot.entities[3] = target;
  bot.pathfinder = {
    setGoal: () => {
      setTimeout(() => {
        bot.entity.position = new Vec3(6, 64, 0);
      }, 5);
    },
    stop: () => {
      target.position = new Vec3(12, 64, 0);
      bot.emit('path_stop');
    },
  };

  const result = await buildInterpreter(bot, { approachTimeoutMs: 1000 }).run('approach_entity', {
    target: 'entity:3',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'arrival_unconfirmed');
  assert.equal(result.finalDistance, 6);
  assert.equal(result.confirmation, null);
  assert.equal(result.pathfinderStopAcknowledged, true);
  assert.equal(result.claimedTerminal.status, 'arrived');
});

test('approach_entity fails closed for stale and wrong-kind exact targets', async () => {
  const bot = baseBot();
  bot.pathfinder = { setGoal: () => {}, stop: () => bot.emit('path_stop') };
  const item = {
    id: 4,
    name: 'item',
    type: 'object',
    objectType: 'Item',
    position: new Vec3(2, 64.125, 0),
    getDroppedItem: () => ({ name: 'apple', count: 1 }),
  };
  bot.entities[4] = item;
  const interpreter = buildInterpreter(bot);

  assert.deepEqual(await interpreter.run('approach_entity', { target: 'entity:404' }), {
    ok: false,
    error: 'target_not_perceived',
    target: 'entity:404',
  });
  const wrongKind = await interpreter.run('approach_entity', { target: 'entity:4' });
  assert.equal(wrongKind.ok, false);
  assert.equal(wrongKind.error, 'target_is_dropped_item');
  assert.equal(wrongKind.target, 'entity:4');
});

test('exact body targets are revalidated against a fresh visual observation', async () => {
  const bot = baseBot();
  const target = {
    id: 2,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(2, 64, 0),
  };
  const item = {
    id: 3,
    name: 'item',
    type: 'object',
    position: new Vec3(1, 64.125, 0),
    getDroppedItem: () => ({ name: 'apple', count: 1 }),
  };
  bot.entities[2] = target;
  bot.entities[3] = item;
  bot.pathfinder = {
    setGoal: () => assert.fail('hidden target started navigation'),
    stop: () => {},
  };
  let entities: any[] = [];
  const interpreter = buildInterpreter(bot, {
    observe: () => ({ protocol: 'behold.inhabitant.v2', scene: { entities } }),
  });

  for (const [tool, reference] of [
    ['approach_entity', 'entity:2'],
    ['attack_entity', 'entity:2'],
    ['collect_nearby_item', 'entity:3'],
  ] as const) {
    assert.deepEqual(await interpreter.run(tool, { target: reference }), {
      ok: false,
      error: 'target_not_perceived',
      target: reference,
    });
  }

  entities = [
    {
      id: 'entity:2',
      kind: 'mob',
      source: 'vision',
      visibility: 'visible',
    },
  ];
  bot.lookAt = async () => {};
  const visible = await interpreter.run('approach_entity', { target: 'entity:2' });
  assert.equal(visible.ok, true);
  assert.equal(visible.status, 'arrived');
});

test('item collection preserves the exact visual admission across the decision-to-action gap', async () => {
  const bot = baseBot();
  const item = {
    id: 3,
    name: 'item',
    type: 'object',
    objectType: 'Item',
    position: new Vec3(2, 63.125, 0),
    getDroppedItem: () => ({ name: 'apple', count: 1 }),
  };
  bot.entities[3] = item;
  bot.blockAt = (position: Vec3) => ({ name: 'stone', boundingBox: 'block', position });
  let navigationCalls = 0;
  bot.pathfinder = {
    goto: async () => {
      navigationCalls += 1;
      bot.emit('playerCollect', bot.entity, item);
    },
    stop: () => {},
  };
  const admittedObservation = {
    protocol: 'behold.inhabitant.v2',
    sequence: 12,
    observedAt: 1_000,
    scene: {
      entities: [
        {
          id: 'entity:3',
          kind: 'item',
          name: 'apple',
          source: 'vision',
          visibility: 'visible',
          position: { x: 2, y: 66.125, z: 0 },
        },
      ],
    },
  };
  const interpreter = buildInterpreter(bot, {
    observe: () => ({
      protocol: 'behold.inhabitant.v2',
      sequence: 13,
      scene: { entities: [] },
    }),
  });

  const result = await interpreter.run(
    'collect_nearby_item',
    { target: 'entity:3' },
    { signal: new AbortController().signal, observation: admittedObservation },
  );

  assert.equal(result.ok, true);
  assert.equal(navigationCalls, 1);
  assert.equal(result.confirmation, 'mineflayer:playerCollect');
  assert.deepEqual(result.targetAdmission, {
    observationSequence: 12,
    observedAt: 1_000,
    position: { x: 2, y: 66.1, z: 0 },
  });
  assert.deepEqual(result.targetAtStart.position, { x: 2, y: 63.125, z: 0 });

  item.getDroppedItem = () => ({ name: 'oak_log', count: 1 });
  const replaced = await interpreter.run(
    'collect_nearby_item',
    { target: 'entity:3' },
    { signal: new AbortController().signal, observation: admittedObservation },
  );
  assert.equal(replaced.ok, false);
  assert.equal(replaced.error, 'target_identity_changed');
  assert.equal(replaced.admittedItem, 'apple');
  assert.equal(replaced.currentItem, 'oak_log');
  assert.equal(navigationCalls, 1);
});

test('approach_entity reports interruption only after dynamic pathfinding acknowledges stop', async () => {
  const bot = baseBot();
  const target = {
    id: 2,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(8, 64, 0),
  };
  bot.entities[2] = target;
  let goalStarted!: () => void;
  const started = new Promise<void>((resolve) => (goalStarted = resolve));
  let stops = 0;
  bot.pathfinder = {
    setGoal: (goal: any) => {
      if (goal) goalStarted();
    },
    stop: () => {
      stops += 1;
      bot.emit('path_stop');
    },
  };
  const controller = new AbortController();
  const pending = buildInterpreter(bot, { approachTimeoutMs: 5000 }).run(
    'approach_entity',
    { target: 'entity:2' },
    { signal: controller.signal },
  );
  await started;
  controller.abort('human_stop');
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.error, 'interrupted_by_human');
  assert.deepEqual(result.cancellation, {
    acknowledged: true,
    adapter: 'mineflayer-pathfinder',
  });
  assert.equal(result.pathfinderStopAcknowledged, true);
  assert.equal(stops, 1);
});

test('digging a distant loaded block approaches into reach before the confirmed mutation', async () => {
  const bot = baseBot();
  let block: any = {
    name: 'oak_log',
    type: 17,
    stateId: 170,
    position: new Vec3(8, 64, 0),
  };
  bot.world = {};
  bot.pathfinder = {
    goto: async () => {
      bot.entity.position = new Vec3(5, 64, 0);
    },
    stop: () => {},
  };
  bot.blockAt = () => block;
  bot.dig = async () => {
    const previous = block;
    block = { name: 'air', type: 0, stateId: 0, position: previous.position };
    bot.emit('blockUpdate', previous, block);
  };

  const result = await buildInterpreter(bot, { changeStabilityWindowMs: 1 }).run('dig_block', {
    x: 8,
    y: 64,
    z: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.navigation.ok, true);
  assert.equal(result.navigation.target, 'oak_log');
  assert.equal(result.changes[0].verified, true);
});

test('digging one peripheral first-person target owns orientation and confirmed mining', async () => {
  const bot = baseBot();
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  const position = new Vec3(1, 64, 0);
  let block: any = {
    name: 'oak_leaves',
    type: 18,
    stateId: 18,
    boundingBox: 'block',
    position,
  };
  let lookedAt: Vec3 | null = null;
  bot.blockAt = () => block;
  bot.canSeeBlock = () => true;
  bot.lookAt = async (target: Vec3) => {
    lookedAt = target;
  };
  bot.dig = async () => {
    const previous = block;
    block = {
      name: 'air',
      type: 0,
      stateId: 0,
      boundingBox: 'empty',
      position,
    };
    bot.emit('blockUpdate', previous, block);
  };
  const observation = {
    protocol: 'behold.inhabitant.v2',
    scene: {
      terrain: {
        targets: [
          {
            id: 'block:overworld:1:64:0',
            kind: 'block',
            name: 'oak_leaves',
            source: 'vision',
            visibility: 'visible',
            position: { x: 1, y: 64, z: 0 },
            ray: { row: 2, column: 7 },
          },
        ],
      },
    },
  };

  const result = await buildInterpreter(bot, {
    observe: () => observation,
    changeStabilityWindowMs: 1,
  }).run('dig_block', { target: 'block:overworld:1:64:0' });

  assert.equal(result.ok, true);
  assert.deepEqual(lookedAt, new Vec3(1.5, 64.5, 0.5));
  assert.deepEqual(result.selectedTarget, {
    id: 'block:overworld:1:64:0',
    name: 'oak_leaves',
    position: { x: 1, y: 64, z: 0 },
    source: 'vision',
    selectedRay: { row: 2, column: 7 },
  });
  assert.equal(result.changes[0].verified, true);
});

test('visual mining fails before mutation when the selected surface identity changed', async () => {
  const bot = baseBot();
  const position = new Vec3(1, 64, 0);
  bot.blockAt = () => ({
    name: 'stone',
    type: 1,
    stateId: 1,
    boundingBox: 'block',
    position,
  });
  let digCalls = 0;
  bot.dig = async () => {
    digCalls += 1;
  };
  const result = await buildInterpreter(bot, {
    observe: () => ({
      protocol: 'behold.inhabitant.v2',
      scene: {
        terrain: {
          targets: [
            {
              id: 'block:overworld:1:64:0',
              kind: 'block',
              name: 'oak_leaves',
              source: 'vision',
              visibility: 'visible',
              position: { x: 1, y: 64, z: 0 },
            },
          ],
        },
      },
    }),
  }).run('dig_block', { target: 'block:overworld:1:64:0' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'visible_target_identity_changed');
  assert.equal(result.expectedName, 'oak_leaves');
  assert.equal(result.observedName, 'stone');
  assert.equal(digCalls, 0);
});

test('digging reports only a body passage causally opened by that exact block change', async () => {
  const bot = baseBot();
  bot.entity.position = new Vec3(0.5, 64, 0.5);
  bot.entity.yaw = 0;
  const cells = new Map<string, any>();
  const key = (position: Vec3 | { x: number; y: number; z: number }) =>
    `${position.x},${position.y},${position.z}`;
  const put = (name: string, x: number, y: number, z: number, stateId: number) => {
    const position = new Vec3(x, y, z);
    cells.set(key(position), {
      name,
      type: stateId,
      stateId,
      boundingBox: name === 'air' ? 'empty' : 'block',
      position,
    });
  };
  for (const [x, z] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    put('stone', x, 63, z, 1);
    put('air', x, 65, z, 0);
  }
  put('oak_leaves', 0, 64, -1, 18);
  put('stone', 0, 64, 1, 1);
  put('stone', -1, 64, 0, 1);
  put('stone', 1, 64, 0, 1);
  bot.blockAt = (position: Vec3) =>
    cells.get(key(position)) || {
      name: 'air',
      type: 0,
      stateId: 0,
      boundingBox: 'empty',
      position,
    };
  bot.canSeeBlock = () => true;
  bot.dig = async (block: any) => {
    const previous = block;
    const air = {
      name: 'air',
      type: 0,
      stateId: 0,
      boundingBox: 'empty',
      position: previous.position,
    };
    cells.set(key(previous.position), air);
    bot.emit('blockUpdate', previous, air);
  };

  const result = await buildInterpreter(bot, { changeStabilityWindowMs: 1 }).run('dig_block', {
    x: 0,
    y: 64,
    z: -1,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.openedBodyPassages.map((passage: any) => passage.direction),
    ['forward'],
  );
  assert.equal(result.openedBodyPassages[0].enterable, true);
  assert.deepEqual(result.openedBodyPassages[0].feet.position, { x: 0, y: 64, z: -1 });
  assert.match(result.nextAffordance, /enter it with move_direction before mining farther/);
});

test('dig_block reports cancellation only after Mineflayer acknowledges diggingAborted', async () => {
  const bot = baseBot();
  const block: any = {
    name: 'oak_log',
    type: 17,
    stateId: 170,
    position: new Vec3(1, 64, 0),
  };
  bot.blockAt = () => block;
  bot.canSeeBlock = () => true;
  let digStarted!: () => void;
  const started = new Promise<void>((resolve) => (digStarted = resolve));
  let rejectDig!: (error: Error) => void;
  bot.dig = () => {
    bot.targetDigBlock = block;
    digStarted();
    return new Promise<void>((_resolve, reject) => (rejectDig = reject));
  };
  bot.stopDigging = () => {
    const active = bot.targetDigBlock;
    bot.targetDigBlock = null;
    bot.emit('diggingAborted', active);
    rejectDig(new Error('Digging aborted'));
  };
  const controller = new AbortController();

  const pending = buildInterpreter(bot, {
    changeConfirmationTimeoutMs: 1,
    changeStabilityWindowMs: 1,
  }).run('dig_block', { x: 1, y: 64, z: 0 }, { signal: controller.signal });
  await started;
  controller.abort('human_stop');
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.error, 'interrupted_by_human');
  assert.deepEqual(result.cancellation, {
    acknowledged: true,
    adapter: 'mineflayer-digging',
  });
  assert.equal(result.sideEffectObserved, false);
  assert.equal(result.attemptedChanges[0].verified, false);
});

test('digging refuses air, body support, and an unsafe downward shaft', async () => {
  const bot = baseBot();
  bot.entity.position = new Vec3(4.3, 64, 7.8);
  let digCalls = 0;
  bot.dig = async () => {
    digCalls += 1;
  };
  bot.blockAt = (position: Vec3) =>
    position.y === 64
      ? { name: 'air', type: 0, stateId: 0, position }
      : { name: 'stone', type: 1, stateId: 1, position };
  const interpreter = buildInterpreter(bot);

  const air = await interpreter.run('dig_block', { x: 4, y: 64, z: 7 });
  const support = await interpreter.run('dig_block', { x: 4, y: 63, z: 7 });
  const downward = await interpreter.run('dig_block', { x: 5, y: 62, z: 7 });

  assert.equal(air.error, 'no_solid_block');
  assert.equal(support.error, 'refusing_to_dig_supporting_block');
  assert.equal(downward.error, 'refusing_unsafe_downward_dig');
  assert.equal(digCalls, 0);
});

test('vanilla player safety permits a chosen supporting block and reports Minecraft consequence', async () => {
  const bot = baseBot();
  bot.entity.position = new Vec3(4.3, 64, 7.8);
  let removed = false;
  const position = new Vec3(4, 63, 7);
  const stone = {
    name: 'stone',
    type: 1,
    stateId: 1,
    boundingBox: 'block',
    position,
  };
  const air = {
    name: 'air',
    type: 0,
    stateId: 0,
    boundingBox: 'empty',
    position,
  };
  bot.blockAt = (requested: Vec3) =>
    requested.x === position.x && requested.y === position.y && requested.z === position.z
      ? removed
        ? air
        : stone
      : { ...stone, position: requested };
  bot.canSeeBlock = () => true;
  bot.dig = async (block: any) => {
    removed = true;
    bot.emit('blockUpdate', block, air);
  };

  const result = await buildInterpreter(bot, {
    safetyProfile: 'vanilla-player-v1',
    changeStabilityWindowMs: 1,
  }).run('dig_block', { x: 4, y: 63, z: 7 });

  assert.equal(result.ok, true);
  assert.equal(result.changes[0].confirmation.source, 'mineflayer:blockUpdate');
  assert.equal(removed, true);
});

test('digging treats every block under the body footprint as support', async () => {
  const bot = baseBot();
  bot.entity.position = new Vec3(0.82, 64, 0.5);
  bot.entity.width = 0.6;
  let digCalls = 0;
  bot.blockAt = (position: Vec3) => ({
    name: 'spruce_log',
    type: 17,
    stateId: 17,
    boundingBox: 'block',
    position,
  });
  bot.dig = async () => {
    digCalls += 1;
  };

  const result = await buildInterpreter(bot).run('dig_block', { x: 1, y: 63, z: 0 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'refusing_to_dig_supporting_block');
  assert.equal(digCalls, 0);
});

test('a block change during a hung command remains attribution-uncertain', async () => {
  const bot = baseBot();
  const position = new Vec3(1, 64, 0);
  let block: any = {
    name: 'spruce_log',
    type: 17,
    stateId: 17,
    boundingBox: 'block',
    position,
  };
  let stopped = 0;
  bot.world = {};
  bot.blockAt = () => block;
  bot.stopDigging = () => {
    stopped += 1;
  };
  bot.dig = async () => {
    const before = block;
    block = {
      name: 'air',
      type: 0,
      stateId: 0,
      boundingBox: 'empty',
      position,
    };
    bot.emit('blockUpdate', before, block);
    await new Promise(() => {});
  };

  const result = await buildInterpreter(bot, {
    worldCommandTimeoutMs: 5,
    changeConfirmationTimeoutMs: 10,
    changeStabilityWindowMs: 1,
  }).run('dig_block', { x: 1, y: 64, z: 0 });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'world_change_attribution_uncertain');
  assert.equal(result.attemptedChanges[0].observed, true);
  assert.equal(result.attemptedChanges[0].verified, false);
  assert.match(result.commandError, /world_change_command_timeout/);
  assert.equal(stopped, 1);
});

test('descend_step clears and enters one supported cardinal staircase step', async () => {
  const bot = baseBot();
  const cells = new Map<string, any>();
  const key = (position: Vec3 | { x: number; y: number; z: number }) =>
    `${position.x},${position.y},${position.z}`;
  const put = (name: string, x: number, y: number, z: number, stateId: number) => {
    const position = new Vec3(x, y, z);
    cells.set(key(position), {
      name,
      type: stateId,
      stateId,
      boundingBox: name === 'air' ? 'empty' : 'block',
      position,
    });
  };
  put('gray_concrete', 0, 64, -1, 10);
  put('dirt', 0, 63, -1, 11);
  put('stone', 0, 62, -1, 12);
  bot.world = {};
  bot.blockAt = (position: Vec3) =>
    cells.get(key(position)) || {
      name: 'air',
      type: 0,
      stateId: 0,
      boundingBox: 'empty',
      position,
    };
  bot.dig = async (block: any) => {
    const air = {
      name: 'air',
      type: 0,
      stateId: 0,
      boundingBox: 'empty',
      position: block.position,
    };
    cells.set(key(block.position), air);
    bot.emit('blockUpdate', block, air);
  };
  bot.pathfinder = {
    goto: async () => {
      bot.entity.position = new Vec3(0, 63, -1);
    },
    stop: () => {},
  };

  const result = await buildInterpreter(bot, { changeStabilityWindowMs: 1 }).run('descend_step', {
    direction: 'north',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'descended_one_step');
  assert.deepEqual(result.targetFeet, { x: 0, y: 63, z: -1 });
  assert.equal(result.changes.length, 2);
  assert.ok(result.changes.every((change: any) => change.verified));
  assert.deepEqual(bot.entity.position, new Vec3(0, 63, -1));
});

test('descend_step refuses an unsupported destination before changing the world', async () => {
  const bot = baseBot();
  let digCalls = 0;
  bot.blockAt = (position: Vec3) => ({
    name: position.y === 62 ? 'air' : 'stone',
    type: position.y === 62 ? 0 : 1,
    stateId: position.y === 62 ? 0 : 1,
    boundingBox: position.y === 62 ? 'empty' : 'block',
    position,
  });
  bot.dig = async () => {
    digCalls += 1;
  };

  const result = await buildInterpreter(bot).run('descend_step', { direction: 'north' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'stair_step_unsupported');
  assert.equal(digCalls, 0);
});

test('descend_step reports a flooded destination and dry alternatives without hanging or digging', async () => {
  const bot = baseBot();
  let digCalls = 0;
  bot.blockAt = (position: Vec3) => {
    const floodedFeet = position.x === 0 && position.y === 63 && position.z === -1;
    return {
      name: floodedFeet ? 'water' : 'stone',
      type: floodedFeet ? 9 : 1,
      stateId: floodedFeet ? 9 : 1,
      boundingBox: floodedFeet ? 'empty' : 'block',
      diggable: !floodedFeet,
      position,
    };
  };
  bot.dig = async () => {
    digCalls += 1;
    await new Promise(() => {});
  };

  const result = await buildInterpreter(bot).run('descend_step', { direction: 'north' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'stair_step_flooded');
  assert.equal(result.obstruction.role, 'feet');
  assert.equal(result.obstruction.block.name, 'water');
  assert.equal(digCalls, 0);
  assert.deepEqual(
    result.alternatives
      .filter((option: any) => option.viable)
      .map((option: any) => option.direction),
    ['south', 'east', 'west'],
  );
});

test('ascend_step reaches the exact supported upper cell without changing blocks', async () => {
  const bot = baseBot();
  bot.entity.position = new Vec3(0, 63, 0);
  bot.blockAt = (position: Vec3) => ({
    name: position.y === 63 && position.z === -1 ? 'stone' : 'air',
    type: position.y === 63 && position.z === -1 ? 1 : 0,
    stateId: position.y === 63 && position.z === -1 ? 1 : 0,
    boundingBox: position.y === 63 && position.z === -1 ? 'block' : 'empty',
    position,
  });
  bot.pathfinder = {
    goto: async () => {
      bot.entity.position = new Vec3(0, 64, -1);
    },
    stop: () => {},
  };

  const result = await buildInterpreter(bot).run('ascend_step', { direction: 'north' });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'ascended_one_step');
  assert.deepEqual(result.targetFeet, { x: 0, y: 64, z: -1 });
  assert.deepEqual(result.finalFeet, result.targetFeet);
});

test('ascend_step refuses a blocked upper cell before pathfinding', async () => {
  const bot = baseBot();
  let navigationCalls = 0;
  bot.blockAt = (position: Vec3) => {
    const solid = position.z === -1 && (position.y === 64 || position.y === 66);
    return {
      name: solid ? 'stone' : 'air',
      type: solid ? 1 : 0,
      stateId: solid ? 1 : 0,
      boundingBox: solid ? 'block' : 'empty',
      position,
    };
  };
  bot.pathfinder = {
    goto: async () => {
      navigationCalls += 1;
    },
    stop: () => {},
  };

  const result = await buildInterpreter(bot).run('ascend_step', { direction: 'north' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'ascent_step_blocked');
  assert.equal(result.obstruction.role, 'head');
  assert.equal(navigationCalls, 0);
});

test('craft_item reports the inventory consequence Minecraft produced', async () => {
  const bot = baseBot();
  bot.inventoryItems = [{ name: 'oak_log', count: 1 }];
  bot.findBlock = () => null;
  bot.recipesFor = () => [{ result: { count: 4 } }];
  bot.craft = async (_recipe: any, batches: number) => {
    bot.inventoryItems = [
      { name: 'oak_log', count: 1 - batches },
      { name: 'oak_planks', count: 4 * batches },
    ].filter((item) => item.count > 0);
  };
  const interpreter = buildInterpreter(bot);

  const result = await interpreter.run('craft_item', { name: 'oak planks', count: 4 });

  assert.equal(result.ok, true);
  assert.equal(result.item, 'oak_planks');
  assert.equal(result.produced, 4);
  assert.equal(result.countAfter, 4);
});

test('toggle_block confirms a persistent Minecraft door-state transition', async () => {
  const bot = baseBot();
  let interaction: any = null;
  let door: any = {
    name: 'oak_door',
    type: 7,
    stateId: 70,
    position: new Vec3(1, 64, 0),
    getProperties: () => ({ open: false, half: 'lower' }),
  };
  bot.blockAt = () => door;
  bot.activateBlock = async (_block: any, face: Vec3, cursor: Vec3) => {
    interaction = { face, cursor };
    const previous = door;
    door = {
      ...door,
      stateId: 71,
      getProperties: () => ({ open: true, half: 'lower' }),
    };
    bot.emit('blockUpdate', previous, door);
  };
  const interpreter = buildInterpreter(bot, { changeStabilityWindowMs: 1 });

  const result = await interpreter.run('toggle_block', { x: 1, y: 64, z: 0 });

  assert.equal(result.ok, true);
  assert.deepEqual(result.changed, {
    property: 'open',
    before: false,
    after: true,
    beforeStateId: 70,
    afterStateId: 71,
  });
  assert.equal(result.confirmation.source, 'mineflayer:blockUpdate');
  assert.deepEqual(interaction, {
    face: new Vec3(-1, 0, 0),
    cursor: new Vec3(0.5, 0.5, 0.5),
  });
});

test('toggle_block does not credit an observed transition to a failed activation', async () => {
  const bot = baseBot();
  let door: any = {
    name: 'oak_door',
    type: 7,
    stateId: 70,
    position: new Vec3(1, 64, 0),
    getProperties: () => ({ open: false, half: 'lower' }),
  };
  bot.blockAt = () => door;
  bot.activateBlock = async () => {
    const previous = door;
    door = {
      ...door,
      stateId: 71,
      getProperties: () => ({ open: true, half: 'lower' }),
    };
    bot.emit('blockUpdate', previous, door);
    throw new Error('activation rejected');
  };

  const result = await buildInterpreter(bot, { changeStabilityWindowMs: 1 }).run('toggle_block', {
    x: 1,
    y: 64,
    z: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(result.verified, false);
  assert.equal(result.observed, true);
  assert.equal(result.error, 'block_activation_attribution_uncertain');
  assert.equal(result.confirmation.source, 'mineflayer:blockUpdate');
});

test('cross_visible_door owns one exact first-person doorway crossing without inferring a room', async () => {
  const bot = baseBot();
  bot.game = { dimension: 'overworld' };
  bot.entity.position = new Vec3(0.5, 64, 1.5);
  bot.entity.yaw = 0;
  bot.entity.pitch = -0.7;
  let open = false;
  let stateId = 70;
  const doorBlock = (y = 64) => ({
    name: 'oak_door',
    type: 7,
    stateId,
    position: new Vec3(0, y, 0),
    getProperties: () => ({
      open,
      half: y === 64 ? 'lower' : 'upper',
      facing: 'north',
      hinge: 'left',
    }),
  });
  bot.blockAt = (position: Vec3) => {
    if (position.x === 0 && position.z === 0 && [64, 65].includes(position.y)) {
      return doorBlock(position.y);
    }
    if (position.y === 63) {
      return {
        name: 'stone',
        type: 1,
        stateId: 1,
        boundingBox: 'block',
        position,
      };
    }
    return { name: 'air', type: 0, stateId: 0, boundingBox: 'empty', position };
  };
  const cursorHit = {
    ...doorBlock(),
    face: 3,
    intersect: new Vec3(0.5, 64.4, 0.1875),
  };
  bot.world = { raycast: () => cursorHit };
  const interactions: Array<{ block: any; face: Vec3; cursor: Vec3 }> = [];
  bot.activateBlock = async (block: any, face: Vec3, cursor: Vec3) => {
    interactions.push({ block, face, cursor });
    const previous = doorBlock();
    open = !open;
    stateId += 1;
    bot.emit('blockUpdate', previous, doorBlock());
  };
  let lookTarget = new Vec3(0, 64, 0);
  bot.lookAt = async (target: Vec3) => {
    lookTarget = target;
    const delta = target.minus(bot.entity.position.offset(0, 1.62, 0));
    bot.entity.yaw = Math.atan2(-delta.x, -delta.z);
    bot.entity.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
  };
  const controls: boolean[] = [];
  bot.setControlState = (control: string, active: boolean) => {
    if (control !== 'forward') return;
    controls.push(active);
    if (active) bot.entity.position = new Vec3(lookTarget.x, 64, lookTarget.z);
  };
  const observation = {
    sequence: 12,
    circle: { id: 'minecraft:test', managedRunId: 'run-7' },
    self: { condition: { dimension: 'overworld' } },
    scene: {
      focus: {
        id: 'block:overworld:0:64:0',
        kind: 'block',
        name: 'oak_door',
        source: 'cursor',
        position: { x: 0, y: 64, z: 0 },
        reachable: true,
      },
    },
  };
  const interpreter = buildInterpreter(bot, {
    observe: () => observation,
    changeConfirmationTimeoutMs: 10,
    changeStabilityWindowMs: 1,
  });

  const result = await interpreter.run('cross_visible_door', {
    focus: observation.scene.focus.id,
    closeAfter: true,
    rememberAs: { label: 'Garden gate', purpose: 'The route toward the garden' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.protocol, 'behold.visible-door-crossing.v1');
  assert.equal(result.crossed, true);
  assert.deepEqual(result.fromFeet, { x: 0, y: 64, z: 1 });
  assert.deepEqual(result.toFeet, { x: 0, y: 64, z: -1 });
  assert.equal(result.crossing.doorCellOccupied, true);
  assert.equal(result.crossing.confirmation, 'mineflayer:body_crossed_selected_door_cell');
  assert.equal(result.doorOpened.changed.after, true);
  assert.equal(result.doorClosed.changed.after, false);
  assert.deepEqual(result.rememberAs, {
    label: 'Garden gate',
    purpose: 'The route toward the garden',
  });
  assert.deepEqual(result.world, {
    circleId: 'minecraft:test',
    dimension: 'overworld',
    managedRunId: 'run-7',
    observationSequence: 12,
  });
  assert.equal('inside' in result, false);
  assert.equal('protectedBodyCells' in result, false);
  assert.equal(JSON.stringify(result).includes('standable'), false);
  assert.deepEqual(controls, [true, false, true, false]);
  assert.deepEqual(interactions[0].face, new Vec3(0, 0, 1));
  assert.equal(interactions[0].cursor.x, 0.5);
  assert.ok(Math.abs(interactions[0].cursor.y - 0.4) < 1e-9);
  assert.equal(interactions[0].cursor.z, 0.1875);
  assert.equal(open, false);

  const place = {
    id: 'doorway:minecraft-test:overworld:0:64:0',
    label: 'Garden gate',
    purpose: 'The route toward the garden',
    circleId: 'minecraft:test',
    anchor: { dimension: 'overworld', x: 0, y: 64, z: -1 },
    affordances: ['witnessed-doorway-crossing'],
    protectedBodyCells: [],
    entrances: [],
    doorways: [
      {
        name: 'oak_door',
        focusId: 'block:overworld:0:64:0',
        lower: { x: 0, y: 64, z: 0 },
        upper: { x: 0, y: 65, z: 0 },
        sideAFeet: { x: 0, y: 64, z: -1 },
        sideBFeet: { x: 0, y: 64, z: 1 },
        rememberedState: 'closed',
      },
    ],
    evidence: 'doorway_crossed' as const,
    learnedAtSequence: 12,
    lastConfirmedAtSequence: 12,
    provenance: {
      source: 'own_entity_loom' as const,
      kind: 'embodied_doorway' as const,
      actionId: 'cross-door-12',
      actionTurnSequence: 12,
      witnessTurnSequence: 12,
      witnessAction: 'cross_visible_door',
    },
  };
  const upperCursorHit = {
    ...doorBlock(65),
    face: 2,
    intersect: new Vec3(0.5, 65.4, 0.8125),
  };
  bot.world.raycast = () => upperCursorHit;
  const upperObservation = {
    ...observation,
    scene: {
      ...observation.scene,
      focus: {
        ...observation.scene.focus,
        id: 'block:overworld:0:65:0',
        position: { x: 0, y: 65, z: 0 },
      },
    },
  };
  const reuse = await buildInterpreter(bot, {
    observe: () => upperObservation,
    places: () => [place],
    changeConfirmationTimeoutMs: 10,
    changeStabilityWindowMs: 1,
  }).run('cross_place_door', { id: place.id, closeAfter: true });

  assert.equal(reuse.ok, true);
  assert.deepEqual(reuse.fromFeet, { x: 0, y: 64, z: -1 });
  assert.deepEqual(reuse.toFeet, { x: 0, y: 64, z: 1 });
  assert.deepEqual(reuse.rememberedPlace, { id: place.id, label: place.label });
  assert.equal(interactions[2].block.position.y, 65);
  assert.equal(open, false);

  bot.world.raycast = () => cursorHit;
  bot.entity.yaw = 0;
  bot.entity.pitch = -0.7;
  const abort = new AbortController();
  const controlsBeforeInterrupt = controls.length;
  bot.setControlState = (control: string, active: boolean) => {
    if (control !== 'forward') return;
    controls.push(active);
    if (active) abort.abort();
  };
  const interrupted = await buildInterpreter(bot, {
    observe: () => observation,
    changeConfirmationTimeoutMs: 10,
    changeStabilityWindowMs: 1,
  }).run(
    'cross_visible_door',
    { focus: observation.scene.focus.id, closeAfter: true },
    { signal: abort.signal },
  );

  assert.equal(interrupted.ok, false);
  assert.equal(interrupted.error, 'interrupted_by_human');
  assert.deepEqual(controls.slice(controlsBeforeInterrupt), [true, false]);
  assert.equal(open, false, 'interruption recovers the door after clearing forward control');
});

test('cross_visible_door fails before mutation when the selected cursor focus is stale', async () => {
  const bot = baseBot();
  bot.game = { dimension: 'overworld' };
  bot.entity.position = new Vec3(0.5, 64, 1.5);
  bot.entity.yaw = 0;
  bot.entity.pitch = -0.7;
  let activations = 0;
  const door = {
    name: 'oak_door',
    type: 7,
    stateId: 70,
    position: new Vec3(0, 64, 0),
    getProperties: () => ({ open: false, half: 'lower', facing: 'north' }),
  };
  bot.world = { raycast: () => door };
  bot.blockAt = () => door;
  bot.activateBlock = async () => {
    activations += 1;
  };
  const result = await buildInterpreter(bot, {
    observe: () => ({
      self: { condition: { dimension: 'overworld' } },
      scene: {
        focus: {
          id: 'block:overworld:4:64:0',
          kind: 'block',
          name: 'oak_door',
          source: 'cursor',
          position: { x: 4, y: 64, z: 0 },
          reachable: true,
        },
      },
    }),
  }).run('cross_visible_door', { focus: 'block:overworld:4:64:0' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'selected_door_focus_changed_before_action');
  assert.equal(activations, 0);
});

test('legacy evaluator-derived place routes are not resident affordances', () => {
  const names = buildInterpreter(baseBot(), { places: () => [] })
    .list('inhabitant')
    .map((spec) => spec.name);

  assert.ok(names.includes('cross_place_door'));
  assert.ok(!names.includes('enter_place'));
  assert.ok(!names.includes('leave_place'));
});

test('consume succeeds only after an observed body or inventory consequence', async () => {
  const bot = baseBot();
  bot.food = 10;
  bot.health = 18;
  bot.inventoryItems = [{ type: 5, metadata: 0, name: 'apple', count: 2 }];
  bot.equip = async (item: any) => {
    bot.heldItem = item;
  };
  bot.consume = async () => {
    bot.inventoryItems[0].count -= 1;
    bot.food = 14;
  };
  const interpreter = buildInterpreter(bot);

  const result = await interpreter.run('consume', { name: 'apple' });

  assert.equal(result.ok, true);
  assert.equal(result.item, 'apple');
  assert.equal(result.inventoryRemoved, 1);
  assert.equal(result.foodBefore, 10);
  assert.equal(result.foodAfter, 14);
  assert.equal(result.confirmation, 'mineflayer:body_or_inventory_delta');
});

test('sleep and a chosen fight return observed body/world consequences', async () => {
  const bot = baseBot();
  const bed = { name: 'red_bed', position: new Vec3(1, 64, 0) };
  const zombie = {
    id: 2,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(2, 64, 0),
  };
  bot.entities[2] = zombie;
  bot.findBlock = ({ matching }: any) => (typeof matching === 'function' ? bed : null);
  bot.isABed = (block: any) => block?.name?.endsWith('_bed');
  bot.sleep = async () => {
    bot.isSleeping = true;
  };
  bot.attack = () =>
    setImmediate(() => {
      bot.emit('entityHurt', zombie, bot.entity);
      bot.emit('entityDead', zombie);
    });
  const interpreter = buildInterpreter(bot);

  const slept = await interpreter.run('sleep_in_bed', {});
  assert.equal(slept.ok, true);
  assert.equal(slept.bed.name, 'red_bed');

  const attacked = await interpreter.run('attack_entity', { target: 'entity:2' });
  assert.equal(attacked.ok, true);
  assert.equal(attacked.status, 'target_defeated');
  assert.equal(attacked.attacksAttempted, 1);
  assert.equal(attacked.attributedHits, 1);
  assert.equal(attacked.confirmation, 'mineflayer:entityDead');
});

test('one chosen fight sustains legal-paced attacks until the exact target dies', async () => {
  const bot = baseBot();
  const zombie = {
    id: 2,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(2, 64, 0),
  };
  bot.entities[2] = zombie;
  let attacks = 0;
  bot.attack = () => {
    attacks += 1;
    setImmediate(() => {
      bot.emit('entityHurt', zombie, bot.entity);
      if (attacks === 3) bot.emit('entityDead', zombie);
    });
  };

  const result = await buildInterpreter(bot, { fightTimeoutMs: 3000 }).run('attack_entity', {
    target: 'entity:2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'target_defeated');
  assert.equal(result.targetEntityId, 2);
  assert.equal(result.attacksAttempted, 3);
  assert.equal(result.targetHurtEvents, 3);
  assert.equal(result.attributedHits, 3);
  assert.equal(result.confirmation, 'mineflayer:entityDead');
});

test('hurt events without exact target death do not claim victory', async () => {
  const bot = baseBot();
  const zombie = {
    id: 2,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(2, 64, 0),
  };
  bot.entities[2] = zombie;
  bot.attack = () => setImmediate(() => bot.emit('entityHurt', zombie, bot.entity));

  const result = await buildInterpreter(bot, { fightTimeoutMs: 100 }).run('attack_entity', {
    target: 'entity:2',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'attack_timeout');
  assert.equal(result.attacksAttempted, 1);
  assert.equal(result.attributedHits, 1);
  assert.equal(result.confirmation, null);
});

test('another entity dying and the target disappearing cannot confirm a fight', async () => {
  const bot = baseBot();
  const zombie = {
    id: 2,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(2, 64, 0),
  };
  const skeleton = {
    id: 3,
    name: 'skeleton',
    type: 'mob',
    position: new Vec3(3, 64, 0),
  };
  bot.entities[2] = zombie;
  bot.entities[3] = skeleton;
  bot.attack = () =>
    setImmediate(() => {
      bot.emit('entityDead', skeleton);
      delete bot.entities[2];
    });

  const result = await buildInterpreter(bot, { fightTimeoutMs: 1000 }).run('attack_entity', {
    target: 'entity:2',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'target_lost');
  assert.equal(result.targetEntityId, 2);
  assert.equal(result.confirmation, null);
});

test('a selected target escaping the pursuit boundary ends the fight', async () => {
  const bot = baseBot();
  const zombie = {
    id: 2,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(2, 64, 0),
  };
  bot.entities[2] = zombie;
  bot.attack = () => {
    zombie.position = new Vec3(20, 64, 0);
  };

  const result = await buildInterpreter(bot, {
    fightPursuitDistance: 4,
    fightTimeoutMs: 1500,
  }).run('attack_entity', { target: 'entity:2' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'target_escaped');
  assert.equal(result.attacksAttempted, 1);
  assert.equal(result.finalDistance, 20);
  assert.equal(result.confirmation, null);
});

test('body death is a world-confirmed terminal fight outcome', async () => {
  const bot = baseBot();
  const zombie = {
    id: 2,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(2, 64, 0),
  };
  bot.entities[2] = zombie;
  bot.attack = () => setImmediate(() => bot.emit('death'));

  const result = await buildInterpreter(bot, { fightTimeoutMs: 1000 }).run('attack_entity', {
    target: 'entity:2',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'self_defeated');
  assert.equal(result.confirmation, 'mineflayer:death');
});

test('a simultaneous kill and body death is not reported as clean victory', async () => {
  const bot = baseBot();
  const zombie = {
    id: 2,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(2, 64, 0),
  };
  bot.entities[2] = zombie;
  bot.attack = () =>
    setImmediate(() => {
      bot.emit('entityDead', zombie);
      bot.emit('death');
    });

  const result = await buildInterpreter(bot).run('attack_entity', { target: 'entity:2' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'mutual_defeat');
  assert.equal(result.targetDefeated, true);
  assert.equal(result.bodyDefeated, true);
  assert.deepEqual(result.confirmations, ['mineflayer:entityDead', 'mineflayer:death']);
});

test('human interruption stops active combat pursuit before it is acknowledged', async () => {
  const bot = baseBot();
  const zombie = {
    id: 2,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(5, 64, 0),
  };
  bot.entities[2] = zombie;
  let pursuitStarted!: () => void;
  const pursuing = new Promise<void>((resolve) => (pursuitStarted = resolve));
  let stopCalls = 0;
  bot.pathfinder = {
    setGoal: () => pursuitStarted(),
    stop: () => {
      stopCalls += 1;
    },
  };
  bot.attack = () => assert.fail('an out-of-reach body must not swing before approaching');
  const controller = new AbortController();
  const pending = buildInterpreter(bot).run(
    'attack_entity',
    { target: 'entity:2' },
    { signal: controller.signal },
  );

  await pursuing;
  controller.abort('human_stop');
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.error, 'interrupted_by_human');
  assert.equal(result.pathfinderStopAcknowledged, true);
  assert.equal(stopCalls, 1);
  assert.deepEqual(result.cancellation, {
    acknowledged: true,
    adapter: 'mineflayer-combat',
  });
});

test('combat does not fabricate cancellation acknowledgement when pursuit cannot stop', async () => {
  const bot = baseBot();
  const zombie = {
    id: 2,
    name: 'zombie',
    type: 'mob',
    position: new Vec3(5, 64, 0),
  };
  bot.entities[2] = zombie;
  let pursuitStarted!: () => void;
  const pursuing = new Promise<void>((resolve) => (pursuitStarted = resolve));
  let stopCalls = 0;
  bot.pathfinder = {
    setGoal: () => pursuitStarted(),
    stop: () => {
      stopCalls += 1;
      throw new Error('pathfinder stop failed');
    },
  };
  const controller = new AbortController();
  const pending = buildInterpreter(bot).run(
    'attack_entity',
    { target: 'entity:2' },
    { signal: controller.signal },
  );

  await pursuing;
  controller.abort('human_stop');
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.error, 'interruption_unconfirmed');
  assert.equal(result.pathfinderStopAcknowledged, false);
  assert.ok(stopCalls >= 2);
  assert.deepEqual(result.cancellation, {
    acknowledged: false,
    adapter: 'mineflayer-combat',
  });
});

test('movement and item collection require consequences beyond pathfinder acknowledgement', async () => {
  const bot = baseBot();
  bot.pathfinder = {
    goto: async () => {},
    stop: () => {},
  };
  const item = {
    id: 3,
    name: 'item',
    type: 'object',
    objectType: 'Item',
    position: new Vec3(2, 64.125, 0),
    getDroppedItem: () => ({ name: 'dirt', count: 1 }),
  };
  bot.entities[3] = item;
  bot.blockAt = (position: Vec3) => ({ name: 'stone', boundingBox: 'block', position });
  const interpreter = buildInterpreter(bot);

  const falseArrival = await interpreter.run('move_to', { x: 8, y: 64, z: 0 });
  assert.equal(falseArrival.ok, false);
  assert.equal(falseArrival.error, 'arrival_unconfirmed');

  bot.pathfinder.goto = async () => {
    bot.entity.position = new Vec3(2, 64, 0);
    bot.emit('playerCollect', bot.entity, item);
  };
  const collected = await interpreter.run('collect_nearby_item', { target: 'entity:3' });
  assert.equal(collected.ok, true);
  assert.equal(collected.item, 'dirt');
  assert.equal(collected.confirmation, 'mineflayer:playerCollect');
});

test('item collection binds one exact perceived stack even when another stack has the same name', async () => {
  const bot = baseBot();
  const decoy = {
    id: 3,
    name: 'item',
    type: 'object',
    objectType: 'Item',
    position: new Vec3(1, 64.125, 0),
    getDroppedItem: () => ({ name: 'apple', count: 1 }),
  };
  const target = {
    id: 4,
    name: 'item',
    type: 'object',
    objectType: 'Item',
    position: new Vec3(3, 64.125, 0),
    getDroppedItem: () => ({ name: 'apple', count: 1 }),
  };
  bot.entities[3] = decoy;
  bot.entities[4] = target;
  bot.blockAt = (position: Vec3) => ({ name: 'stone', boundingBox: 'block', position });
  bot.pathfinder = {
    goto: async () => {
      bot.entity.position = new Vec3(3, 64, 0);
      bot.emit('playerCollect', bot.entity, target);
    },
    stop: () => {},
  };

  const result = await buildInterpreter(bot).run('collect_nearby_item', {
    target: 'entity:4',
  });

  assert.equal(result.ok, true);
  assert.equal(result.target, 'entity:4');
  assert.equal(result.targetEntityId, 4);
  assert.deepEqual(result.targetAtStart.position, { x: 3, y: 64.125, z: 0 });
  assert.ok(result.targetAtStart.distance > 3 && result.targetAtStart.distance < 3.1);
  assert.equal(result.item, 'apple');
  assert.equal(result.confirmation, 'mineflayer:playerCollect');
});

test('item collection fails closed for stale, wrong-kind, and body-out-of-range targets', async () => {
  const bot = baseBot();
  bot.pathfinder = { goto: async () => {}, stop: () => {} };
  const player = {
    id: 2,
    username: 'Wren',
    name: 'player',
    type: 'player',
    position: new Vec3(2, 64, 0),
  };
  const distantItem = {
    id: 3,
    name: 'item',
    type: 'object',
    objectType: 'Item',
    position: new Vec3(20, 64.125, 0),
    getDroppedItem: () => ({ name: 'apple', count: 1 }),
  };
  bot.entities[2] = player;
  bot.entities[3] = distantItem;
  const interpreter = buildInterpreter(bot, { pickupPursuitDistance: 8 });

  assert.deepEqual(await interpreter.run('collect_nearby_item', { target: 'entity:404' }), {
    ok: false,
    error: 'target_not_perceived',
    target: 'entity:404',
  });
  const wrongKind = await interpreter.run('collect_nearby_item', { target: 'player:Wren' });
  assert.equal(wrongKind.ok, false);
  assert.equal(wrongKind.error, 'target_not_dropped_item');
  const outOfRange = await interpreter.run('collect_nearby_item', { target: 'entity:3' });
  assert.equal(outOfRange.ok, false);
  assert.equal(outOfRange.error, 'target_not_in_reach');
  assert.equal(outOfRange.pursuitLimit, 8);
  assert.equal(outOfRange.distance, 20);
});

test('item collection does not confuse an adjacent floored block with pickup reach', async () => {
  const bot = baseBot();
  bot.entity.position = new Vec3(3.62, 64, 0.44);
  const item = {
    id: 4,
    name: 'item',
    type: 'object',
    objectType: 'Item',
    position: new Vec3(2.125, 64.125, 0.125),
    getDroppedItem: () => ({ name: 'spruce_log', count: 1 }),
  };
  bot.entities[4] = item;
  bot.blockAt = (position: Vec3) => ({ name: 'stone', boundingBox: 'block', position });
  bot.pathfinder = {
    goto: async (goal: any) => {
      const feet = bot.entity.position.floored();
      if (!goal.isEnd({ x: feet.x, y: feet.y, z: feet.z })) {
        bot.entity.position = new Vec3(2.5, 64, 0.5);
        bot.emit('playerCollect', bot.entity, item);
      }
    },
    stop: () => {},
  };

  const result = await buildInterpreter(bot).run('collect_nearby_item', {
    target: 'entity:4',
  });

  assert.equal(result.ok, true);
  assert.equal(result.item, 'spruce_log');
  assert.equal(result.navigation.near, 0);
  assert.ok(result.navigation.finalDistance < 1.25);
});

test('item collection uses a bounded direct nudge when local pathfinding cannot close pickup range', async () => {
  const bot = baseBot();
  const item = {
    id: 5,
    name: 'item',
    type: 'object',
    objectType: 'Item',
    position: new Vec3(1.5, 64.125, 0),
    getDroppedItem: () => ({ name: 'spruce_log', count: 1 }),
  };
  bot.entities[5] = item;
  bot.blockAt = (position: Vec3) => ({ name: 'stone', boundingBox: 'block', position });
  bot.pathfinder = { goto: async () => {}, stop: () => {} };
  bot.lookAt = async () => {};
  const controls: boolean[] = [];
  bot.setControlState = (control: string, active: boolean) => {
    if (control !== 'forward') return;
    controls.push(active);
    if (active) {
      bot.entity.position = new Vec3(1, 64, 0);
      bot.emit('playerCollect', bot.entity, item);
    }
  };

  const result = await buildInterpreter(bot).run('collect_nearby_item', {
    target: 'entity:5',
  });

  assert.equal(result.ok, true);
  assert.equal(result.navigation.ok, false);
  assert.equal(result.pickupRecovery.method, 'bounded_direct_nudge');
  assert.equal(result.pickupRecovery.collected, true);
  assert.deepEqual(controls, [true, false]);
});

test('item collection makes unsupported-ground refusal an explicit safety profile choice', async () => {
  const bot = baseBot();
  const item = {
    id: 6,
    name: 'item',
    type: 'object',
    objectType: 'Item',
    position: new Vec3(1.5, 63.125, 0),
    getDroppedItem: () => ({ name: 'dirt', count: 1 }),
  };
  bot.entities[6] = item;
  bot.blockAt = (position: Vec3) => ({ name: 'air', boundingBox: 'empty', position });
  let navigationCalls = 0;
  bot.pathfinder = {
    goto: async () => {
      navigationCalls += 1;
    },
    stop: () => {},
  };
  let nudgeCalls = 0;
  bot.setControlState = () => {
    nudgeCalls += 1;
  };

  const interpreter = buildInterpreter(bot);
  const approach = await interpreter.run('approach_entity', { target: 'entity:6' });
  const result = await interpreter.run('collect_nearby_item', { target: 'entity:6' });

  assert.equal(approach.error, 'target_is_dropped_item');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unapproachable_item_ground');
  assert.equal(result.pickupGround.status, 'unsupported');
  assert.equal(navigationCalls, 0);
  assert.equal(nudgeCalls, 0);

  bot.pathfinder.goto = async () => {
    navigationCalls += 1;
    bot.emit('playerCollect', bot.entity, item);
  };
  const vanilla = await buildInterpreter(bot, {
    safetyProfile: 'vanilla-player-v1',
  }).run('collect_nearby_item', { target: 'entity:6' });
  assert.equal(vanilla.ok, true);
  assert.equal(navigationCalls, 1);
});

test('dropped-item pickup ground describes a real entity position below zero', () => {
  const bot = baseBot();
  bot.blockAt = (position: Vec3) => ({
    name: position.y === -61 ? 'grass_block' : 'air',
    boundingBox: position.y === -61 ? 'block' : 'empty',
    position,
  });

  const ground = droppedItemPickupGround(bot, new Vec3(3, -59.875, 0));

  assert.deepEqual(ground, {
    status: 'supported',
    feet: { x: 3, y: -60, z: 0 },
    support: { x: 3, y: -61, z: 0, name: 'grass_block' },
  });
});

test('dropping an item claims only the dropping body inventory consequence', async () => {
  const bot = baseBot();
  bot.inventoryItems = [{ type: 100, metadata: 0, name: 'apple', count: 3 }];
  bot.toss = async (_type: number, _metadata: number | null, count: number) => {
    bot.inventoryItems[0].count -= count;
  };
  const interpreter = buildInterpreter(bot);

  const dropped = await interpreter.run('drop_item', { name: 'apple', count: 2 });

  assert.deepEqual(dropped, {
    ok: true,
    item: 'apple',
    count: 2,
    inventoryRemoved: 2,
    confirmation: 'mineflayer:inventory_delta',
  });
});

test('dropping an item fails when Minecraft produces no inventory change', async () => {
  const bot = baseBot();
  bot.inventoryItems = [{ type: 100, metadata: 0, name: 'apple', count: 1 }];
  bot.toss = async () => {};

  const dropped = await buildInterpreter(bot).run('drop_item', { name: 'apple' });

  assert.equal(dropped.ok, false);
  assert.equal(dropped.error, 'drop_unconfirmed');
  assert.equal(dropped.inventoryRemoved, 0);
  assert.equal(dropped.confirmation, null);
});

test('shared storage reports and verifies deposit and withdrawal consequences', async () => {
  const bot = baseBot();
  const chest = { name: 'chest', position: new Vec3(2, 64, 0) };
  const stored: any[] = [];
  let closed = 0;
  bot.inventoryItems = [{ type: 1, metadata: 0, name: 'oak_planks', count: 6 }];
  bot.blockAt = () => chest;
  bot.openContainer = async () => ({
    containerItems: () => stored,
    deposit: async (type: number, metadata: number | null, count: number) => {
      const body = bot.inventoryItems.find((item: any) => item.type === type);
      body.count -= count;
      if (body.count === 0)
        bot.inventoryItems = bot.inventoryItems.filter((item: any) => item !== body);
      const existing = stored.find((item) => item.type === type);
      if (existing) existing.count += count;
      else stored.push({ type, metadata, name: 'oak_planks', count });
    },
    withdraw: async (type: number, _metadata: number | null, count: number) => {
      const source = stored.find((item) => item.type === type);
      source.count -= count;
      if (source.count === 0) stored.splice(stored.indexOf(source), 1);
      const existing = bot.inventoryItems.find((item: any) => item.type === type);
      if (existing) existing.count += count;
      else bot.inventoryItems.push({ type, metadata: 0, name: 'oak_planks', count });
    },
    close: () => {
      closed += 1;
    },
  });
  const interpreter = buildInterpreter(bot);

  const deposited = await interpreter.run('deposit_in_container', {
    name: 'oak planks',
    count: 4,
    x: 2,
    y: 64,
    z: 0,
  });
  assert.equal(deposited.ok, true);
  assert.equal(deposited.bodyRemoved, 4);
  assert.equal(deposited.containerAdded, 4);
  assert.equal(deposited.confirmation, 'mineflayer:container_inventory_delta');

  const inspected = await interpreter.run('inspect_container', { x: 2, y: 64, z: 0 });
  assert.deepEqual(inspected.contents, [{ name: 'oak_planks', count: 4 }]);

  const withdrawn = await interpreter.run('withdraw_from_container', {
    name: 'oak planks',
    count: 1,
    x: 2,
    y: 64,
    z: 0,
  });
  assert.equal(withdrawn.ok, true);
  assert.equal(withdrawn.bodyAdded, 1);
  assert.equal(withdrawn.containerRemoved, 1);
  assert.equal(closed, 3);
});

test('shared storage rejects a command that produces no inventory transaction', async () => {
  const bot = baseBot();
  const chest = { name: 'chest', position: new Vec3(1, 64, 0) };
  bot.inventoryItems = [{ type: 1, metadata: 0, name: 'dirt', count: 2 }];
  bot.blockAt = () => chest;
  bot.openContainer = async () => ({
    containerItems: () => [],
    deposit: async () => {},
    close: () => {},
  });
  const interpreter = buildInterpreter(bot);

  const result = await interpreter.run('deposit_in_container', {
    name: 'dirt',
    count: 1,
    x: 1,
    y: 64,
    z: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'deposit_unconfirmed');
  assert.equal(result.bodyRemoved, 0);
  assert.equal(result.containerAdded, 0);
});

test('shared storage waits for the body inventory update that can lag the container update', async () => {
  const bot = baseBot();
  const chest = { name: 'chest', position: new Vec3(1, 64, 0) };
  const stored: any[] = [];
  bot.inventoryItems = [{ type: 1, metadata: 0, name: 'dirt', count: 2 }];
  bot.blockAt = () => chest;
  bot.openContainer = async () => ({
    containerItems: () => stored,
    deposit: async (_type: number, _metadata: number | null, count: number) => {
      stored.push({ type: 1, metadata: 0, name: 'dirt', count });
      setTimeout(() => {
        bot.inventoryItems[0].count -= count;
      }, 40);
    },
    close: () => {},
  });
  const interpreter = buildInterpreter(bot, { changeConfirmationTimeoutMs: 250 });

  const result = await interpreter.run('deposit_in_container', {
    name: 'dirt',
    count: 1,
    x: 1,
    y: 64,
    z: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.bodyRemoved, 1);
  assert.equal(result.containerAdded, 1);
});
