import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInventory, summarizeNearbyEntities } from '../src/agent/observation';
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
    entity: { id: 1, position: new Vec3(0, 64, 0) },
    blockAt: (position: Vec3) => ({ name: 'stone', boundingBox: 'block', position }),
    entities: {
      1: { id: 1, position: new Vec3(0, 64, 0) },
      2: {
        id: 2,
        name: 'item',
        type: 'object',
        position: new Vec3(2, 63.5, 0),
        getDroppedItem: () => ({ name: 'birch_log', count: 3 }),
      },
    },
  };

  assert.deepEqual(summarizeNearbyEntities(bot), [
    {
      id: 2,
      name: 'birch_log',
      type: 'item',
      heldItem: null,
      count: 3,
      pickupSafety: {
        ok: true,
        feet: { x: 2, y: 64, z: 0 },
        support: { x: 2, y: 63, z: 0, name: 'stone' },
      },
      distance: 2.1,
      position: { x: 2, y: 63.5, z: 0 },
    },
  ]);
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
    entity: entities[1],
    entities,
  };

  const observed = summarizeNearbyEntities(bot);

  assert.equal(observed.length, 8);
  assert.ok(observed.some((entity) => entity.name === 'importdf' && entity.distance === 48));
  assert.equal(
    observed.some((entity) => entity.name === 'zombie'),
    false,
  );
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
