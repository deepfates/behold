import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cursorTarget,
  droppedItemPickupGround,
  FIRST_PERSON_VISION,
  summarizeVisibleEntities,
  summarizeVisibleTerrain,
  summarizeInventory,
} from '../src/agent/observation';
import { sanitizeName } from '../src/observability/journal';
import { buildInterpreter, minecraftChat } from '../src/agent/interpreter';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';

test('summarizeInventory aggregates and orders stacks', () => {
  assert.deepEqual(
    summarizeInventory([
      { name: 'oak_log', count: 2 },
      { name: 'cobblestone', count: 4 },
      { name: 'oak_log', count: 3 },
    ]),
    [
      { name: 'oak_log', count: 5 },
      { name: 'cobblestone', count: 4 },
    ],
  );
});

test('nearby dropped stacks expose their item identity and count', () => {
  const bot: any = {
    entity: { id: 1, position: new Vec3(0, 64, 0), yaw: 0, pitch: 0, eyeHeight: 1.62 },
    blockAt: (position: Vec3) => ({ name: 'stone', boundingBox: 'block', position }),
    world: { raycast: () => null },
    entities: {
      1: { id: 1, position: new Vec3(0, 64, 0) },
      2: {
        id: 2,
        name: 'item',
        type: 'object',
        position: new Vec3(0, 64.125, -2),
        getDroppedItem: () => ({ name: 'birch_log', count: 3 }),
      },
    },
  };

  assert.deepEqual(summarizeVisibleEntities(bot), [
    {
      id: 2,
      name: 'birch_log',
      type: 'item',
      heldItem: null,
      count: 3,
      pickupGround: {
        status: 'supported',
        feet: { x: 0, y: 64, z: -2 },
        support: { x: 0, y: 63, z: -2, name: 'stone' },
      },
      distance: 2,
      position: { x: 0, y: 64.1, z: -2 },
    },
  ]);
});

test('dropped-item ground reports a hazardous block without claiming overall safety', () => {
  const bot: any = {
    blockAt: (position: Vec3) => ({ name: 'magma_block', boundingBox: 'block', position }),
  };

  assert.deepEqual(droppedItemPickupGround(bot, new Vec3(2.5, 64.125, -3.5)), {
    status: 'hazardous',
    feet: { x: 2, y: 64, z: -4 },
    support: { x: 2, y: 63, z: -4, name: 'magma_block' },
  });
});

test('loaded players remain observable at companion range without widening every entity', () => {
  const entities: Record<number, any> = {
    1: { id: 1, type: 'player', username: 'Scout', position: new Vec3(0, 64, 0) },
    2: { id: 2, type: 'player', username: 'importdf', position: new Vec3(48, 64, 0) },
    3: { id: 3, type: 'mob', name: 'zombie', position: new Vec3(30, 64, 0) },
  };
  for (let id = 4; id <= 12; id += 1) {
    entities[id] = {
      id,
      type: 'mob',
      name: `pig_${id}`,
      position: new Vec3(id - 3, 64, 0),
    };
  }
  const bot: any = {
    entity: { ...entities[1], yaw: -Math.PI / 2, pitch: 0, eyeHeight: 1.62 },
    entities,
    world: { raycast: () => null },
  };

  const observed = summarizeVisibleEntities(bot);

  assert.equal(observed.length, 8);
  assert.ok(observed.some((entity) => entity.name === 'importdf' && entity.distance === 48));
  assert.equal(
    observed.some((entity) => entity.name === 'zombie'),
    false,
  );
});

test('first-person entity projection excludes bodies behind the camera and behind blocks', () => {
  const front = { id: 2, type: 'mob', name: 'cow', position: new Vec3(0, 64, -5) };
  const behind = { id: 3, type: 'mob', name: 'pig', position: new Vec3(0, 64, 5) };
  const body = {
    id: 1,
    type: 'player',
    username: 'Scout',
    position: new Vec3(0, 64, 0),
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.62,
  };
  const open: any = {
    entity: body,
    entities: { 1: body, 2: front, 3: behind },
    world: { raycast: () => null },
    blockAt: () => null,
  };
  assert.deepEqual(
    summarizeVisibleEntities(open).map((entity) => entity.name),
    ['cow'],
  );

  const occluded = {
    ...open,
    world: {
      raycast: (eye: Vec3, direction: Vec3) => ({
        name: 'stone',
        position: new Vec3(0, 64, -2),
        intersect: eye.plus(direction.scaled(2)),
      }),
    },
  };
  assert.deepEqual(summarizeVisibleEntities(occluded), []);
});

test('visual entity occlusion distinguishes transparent surfaces from opaque blocks', () => {
  const body = {
    id: 1,
    type: 'player',
    position: new Vec3(0, 64, 0),
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.62,
  };
  const cow = {
    id: 2,
    type: 'mob',
    name: 'cow',
    position: new Vec3(0, 64, -5),
    width: 0.9,
    height: 1.4,
  };
  const withSurface = (transparent: boolean) => ({
    entity: body,
    entities: { 1: body, 2: cow },
    world: {
      raycast: (eye: Vec3, direction: Vec3, _range: number, matcher?: any) => {
        const surface = {
          name: transparent ? 'glass' : 'stone',
          transparent,
          shapes: [[0, 0, 0, 1, 1, 1]],
          position: new Vec3(0, 64, -2),
          intersect: eye.plus(direction.scaled(2)),
        };
        return !matcher || matcher(surface) ? surface : null;
      },
    },
  });

  assert.deepEqual(
    summarizeVisibleEntities(withSurface(true) as any).map((entity) => entity.name),
    ['cow'],
  );
  assert.deepEqual(summarizeVisibleEntities(withSurface(false) as any), []);
});

test('cursor targeting treats zero yaw and pitch as valid and chooses a nearer entity', () => {
  const body = {
    id: 1,
    type: 'player',
    position: new Vec3(0, 64, 0),
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.62,
  };
  const cow = {
    id: 2,
    type: 'mob',
    name: 'villager',
    position: new Vec3(0, 64, -2),
    width: 0.6,
    height: 1.95,
  };
  const bot: any = {
    entity: body,
    entities: { 1: body, 2: cow },
    world: {
      raycast: (eye: Vec3, direction: Vec3) => ({
        name: 'stone',
        position: new Vec3(0, 64, -4),
        intersect: eye.plus(direction.scaled(4)),
      }),
    },
  };

  const target = cursorTarget(bot, 6, 3.5);
  assert.equal(target?.kind, 'entity');
  assert.equal(target?.kind === 'entity' ? target.entity.id : null, 2);
  assert.ok(target!.distance < 2);
});

test('terrain observation spends a fixed ray budget and reports only first-hit surfaces', () => {
  let raycasts = 0;
  const body = {
    id: 1,
    position: new Vec3(0, 64, 0),
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.62,
  };
  const bot: any = {
    entity: body,
    world: {
      raycast: (eye: Vec3, direction: Vec3) => {
        raycasts += 1;
        return {
          name: 'stone',
          position: new Vec3(0, 64, -2),
          intersect: eye.plus(direction.scaled(2)),
        };
      },
    },
  };

  const terrain = summarizeVisibleTerrain(bot);
  assert.equal(terrain.source, 'vision');
  assert.equal(terrain.raysCast, 45);
  assert.equal(
    terrain.raysCast,
    FIRST_PERSON_VISION.horizontalRays * FIRST_PERSON_VISION.verticalRays,
  );
  assert.equal(raycasts, terrain.raysCast);
  assert.equal(terrain.raysHit, terrain.raysCast);
  assert.equal(terrain.failedRays, 0);
  assert.deepEqual(terrain.materials, [
    { name: 'stone', count: 1, nearest: { x: 0, y: 64, z: -2, distance: 2 } },
  ]);
  assert.equal(terrain.visualField.protocol, 'behold.visual-field.v1');
  assert.equal(terrain.visualField.available, true);
  assert.deepEqual(terrain.visualField.dimensions, { rows: 5, columns: 9 });
  assert.deepEqual(terrain.visualField.materialLegend, [{ symbol: 'a', name: 'stone' }]);
  assert.deepEqual(terrain.visualField.materialRows, Array(5).fill('aaaaaaaaa'));
  assert.deepEqual(terrain.visualField.depthRows, Array(5).fill('111111111'));
  assert.equal(
    terrain.materials.some((block) => block.name === 'diamond_ore'),
    false,
  );
});

test('visual terrain keeps player-relative layout that an aggregate material list loses', () => {
  const body = {
    id: 1,
    position: new Vec3(0, 64, 0),
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.62,
  };
  const observe = (mirror: boolean) => {
    let call = 0;
    return summarizeVisibleTerrain({
      entity: body,
      world: {
        raycast: (eye: Vec3, direction: Vec3) => {
          const index = call++;
          const left = mirror ? 'oak_leaves' : 'oak_planks';
          const right = mirror ? 'oak_planks' : 'oak_leaves';
          const name =
            direction.y > 0.2
              ? 'glass'
              : direction.x < -0.2
                ? left
                : direction.x > 0.2
                  ? right
                  : 'stone';
          return {
            name,
            position: new Vec3(index % 9, 64 + Math.floor(index / 9), -4),
            intersect: eye.plus(direction.scaled(6)),
          };
        },
      },
    } as any);
  };

  const terrain = observe(false);
  const mirrored = observe(true);
  const symbol = Object.fromEntries(
    terrain.visualField.materialLegend.map(({ symbol, name }) => [name, symbol]),
  );
  const middle = terrain.visualField.materialRows[2];

  assert.equal(terrain.visualField.rowOrder, 'top_to_bottom');
  assert.equal(terrain.visualField.columnOrder, 'left_to_right');
  assert.equal(terrain.visualField.materialRows[0], symbol.glass.repeat(9));
  assert.equal(middle[0], symbol.oak_planks);
  assert.equal(middle[4], symbol.stone);
  assert.equal(middle[8], symbol.oak_leaves);
  assert.deepEqual(
    terrain.materials.map(({ name, count }) => ({ name, count })),
    [
      { name: 'glass', count: 18 },
      { name: 'oak_leaves', count: 11 },
      { name: 'oak_planks', count: 11 },
      { name: 'stone', count: 5 },
    ],
  );
  assert.deepEqual(
    mirrored.materials.map(({ name, count }) => ({ name, count })),
    terrain.materials.map(({ name, count }) => ({ name, count })),
  );
  assert.notDeepEqual(mirrored.visualField.materialRows, terrain.visualField.materialRows);
});

test('visual terrain exposes a failed sensor instead of depicting an open world', () => {
  const terrain = summarizeVisibleTerrain({
    entity: {
      id: 1,
      position: new Vec3(0, 64, 0),
      yaw: 0,
      pitch: 0,
      eyeHeight: 1.62,
    },
    world: {
      raycast: () => {
        throw new Error('chunk view unavailable');
      },
    },
  } as any);

  assert.equal(terrain.raysCast, 45);
  assert.equal(terrain.raysHit, 0);
  assert.equal(terrain.failedRays, 45);
  assert.equal(terrain.visualField.available, false);
  assert.deepEqual(terrain.visualField.materialRows, Array(5).fill('?????????'));
  assert.deepEqual(terrain.visualField.depthRows, Array(5).fill('?????????'));
});

test('sanitizeName produces filesystem-safe agent names', () => {
  assert.equal(sanitizeName('Scout / West'), 'Scout-West');
});

test('minecraftChat produces one bounded server-safe message', () => {
  const message = minecraftChat('Materials:\n- grass\n- gray concrete\t nearby', 40);
  assert.equal(message, 'Materials: - grass - gray concrete');
  assert.equal(message.includes('\n'), false);
  assert.ok(message.length <= 40);
});

test('chat is an unavailable action when the server roster has no recipient', async () => {
  const bot: any = new EventEmitter();
  bot.username = 'Scout';
  bot.players = { Scout: { username: 'Scout' } };
  const sent: string[] = [];
  bot.chat = (message: string) => sent.push(message);
  const interpreter = buildInterpreter(bot);

  const alone = await interpreter.run('chat', { text: 'Hello?' });
  assert.equal(alone.ok, false);
  assert.equal(alone.error, 'no_other_players_online');
  assert.deepEqual(sent, []);

  bot.players.importdf = { username: 'importdf' };
  const together = await interpreter.run('chat', { text: 'Hello!' });
  assert.equal(together.ok, true);
  assert.deepEqual(sent, ['Hello!']);
});
