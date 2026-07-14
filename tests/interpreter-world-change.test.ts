import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { buildInterpreter } from '../src/agent/interpreter';
import { createWorldChangeAuthority } from '../src/safety/world-change';
import type { InhabitantPlace } from '../src/entity/places';

type FakeBlock = {
  name: string;
  type: number;
  stateId: number;
  position: Vec3;
};

function block(name: string, stateId: number, position: Vec3): FakeBlock {
  return { name, type: stateId, stateId, position };
}

function fakeBot() {
  const bot: any = new EventEmitter();
  const blocks = new Map<string, FakeBlock>();
  const key = (position: Vec3) => `${position.x}:${position.y}:${position.z}`;
  bot.setBlock = (next: FakeBlock) => blocks.set(key(next.position), next);
  bot.blockAt = (position: Vec3) =>
    blocks.get(key(position)) ?? block('air', 0, new Vec3(position.x, position.y, position.z));
  return bot;
}

test('dig succeeds only after a matching Minecraft blockUpdate', async () => {
  const bot = fakeBot();
  const position = new Vec3(1, 64, 2);
  const stone = block('stone', 1, position);
  bot.setBlock(stone);
  bot.dig = async () => {
    const air = block('air', 0, position);
    bot.setBlock(air);
    setImmediate(() => bot.emit('blockUpdate', stone, air));
  };
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const interpreter = buildInterpreter(bot, {
    worldChangeExecutor: executor,
    changeConfirmationTimeoutMs: 25,
    changeStabilityWindowMs: 1,
  });

  const result = await interpreter.run('dig_block', { x: 1, y: 64, z: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.changes[0].verified, true);
  assert.equal(result.changes[0].confirmation.source, 'mineflayer:blockUpdate');
  assert.equal(result.changes[0].before, 'stone');
  assert.equal(result.changes[0].after, 'air');
  const safety = guard.snapshot();
  assert.equal(safety.used, 1);
  assert.equal(safety.changes[0].status, 'verified');
  assert.equal(safety.changes[0].evidence?.source, 'mineflayer:blockUpdate');
});

test('dig remains verified when Minecraft legitimately fills the removed block with water', async () => {
  const bot = fakeBot();
  const position = new Vec3(2, 63, 2);
  const dirt = block('dirt', 10, position);
  const air = block('air', 0, position);
  const water = block('water', 34, position);
  bot.setBlock(dirt);
  bot.dig = async () => {
    bot.setBlock(air);
    bot.emit('blockUpdate', dirt, air);
    bot.setBlock(water);
    bot.emit('blockUpdate', air, water);
  };
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const interpreter = buildInterpreter(bot, {
    worldChangeExecutor: executor,
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 1,
  });

  const result = await interpreter.run('dig_block', { x: 2, y: 63, z: 2 });

  assert.equal(result.ok, true);
  assert.equal(result.changes[0].before, 'dirt');
  assert.equal(result.changes[0].after, 'water');
  assert.equal(result.changes[0].verified, true);
  assert.equal(guard.snapshot().changes[0].status, 'verified');
});

test('a cache change without blockUpdate fails and conservatively exhausts the budget', async () => {
  const bot = fakeBot();
  const position = new Vec3(3, 64, 4);
  const stone = block('stone', 1, position);
  bot.setBlock(stone);
  bot.dig = async () => {
    bot.setBlock(block('air', 0, position));
  };
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const interpreter = buildInterpreter(bot, {
    worldChangeExecutor: executor,
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 1,
  });

  const result = await interpreter.run('dig_block', { x: 3, y: 64, z: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'world_change_unconfirmed');
  assert.equal(result.attemptedChanges[0].verified, false);
  assert.equal(result.attemptedChanges[0].after, 'air');
  const safety = guard.snapshot();
  assert.equal(safety.used, 1);
  assert.equal(safety.remaining, 0);
  assert.equal(safety.changes[0].status, 'uncertain');
  assert.equal(
    guard.authorize({ verb: 'dig', position: { x: 4, y: 64, z: 4 }, before: 'stone' }).ok,
    false,
  );
});

test('a blockUpdate at the wrong position cannot confirm the attempted change', async () => {
  const bot = fakeBot();
  const position = new Vec3(5, 64, 6);
  const stone = block('stone', 1, position);
  bot.setBlock(stone);
  bot.dig = async () => {
    const air = block('air', 0, position);
    bot.setBlock(air);
    const other = new Vec3(6, 64, 6);
    bot.emit('blockUpdate', block('stone', 1, other), block('air', 0, other));
  };
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const interpreter = buildInterpreter(bot, {
    worldChangeExecutor: executor,
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 1,
  });

  const result = await interpreter.run('dig_block', { x: 5, y: 64, z: 6 });
  assert.equal(result.ok, false);
  assert.equal(guard.snapshot().changes[0].status, 'uncertain');
});

test('a matching update followed by rollback cannot verify the transient state', async () => {
  const bot = fakeBot();
  const position = new Vec3(6, 64, 7);
  const stone = block('stone', 1, position);
  const air = block('air', 0, position);
  bot.setBlock(stone);
  bot.dig = async () => {
    bot.setBlock(air);
    bot.emit('blockUpdate', stone, air);
    bot.setBlock(stone);
    bot.emit('blockUpdate', air, stone);
  };
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const interpreter = buildInterpreter(bot, {
    worldChangeExecutor: executor,
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 1,
  });

  const result = await interpreter.run('dig_block', { x: 6, y: 64, z: 7 });

  assert.equal(result.ok, false);
  assert.equal(result.attemptedChanges[0].verified, false);
  assert.equal(result.attemptedChanges[0].after, 'stone');
  assert.equal(guard.snapshot().changes[0].status, 'uncertain');
  assert.equal(guard.snapshot().changes[0].after, 'stone');
  assert.equal(guard.snapshot().changes[0].error, 'world_change_reversed_before_confirmation');
});

test('a rollback during the stability window cannot remain verified', async () => {
  const bot = fakeBot();
  const position = new Vec3(6, 64, 9);
  const stone = block('stone', 1, position);
  const air = block('air', 0, position);
  bot.setBlock(stone);
  bot.dig = async () => {
    bot.setBlock(air);
    bot.emit('blockUpdate', stone, air);
    setTimeout(() => {
      bot.setBlock(stone);
      bot.emit('blockUpdate', air, stone);
    }, 10);
  };
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const interpreter = buildInterpreter(bot, {
    worldChangeExecutor: executor,
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 25,
  });

  const result = await interpreter.run('dig_block', { x: 6, y: 64, z: 9 });

  assert.equal(result.ok, false);
  assert.equal(result.attemptedChanges[0].after, 'stone');
  assert.equal(guard.snapshot().changes[0].status, 'uncertain');
});

test('a matching world change cannot be attributed to a command that errored', async () => {
  const bot = fakeBot();
  const position = new Vec3(7, 64, 8);
  const stone = block('stone', 1, position);
  bot.setBlock(stone);
  bot.dig = async () => {
    const air = block('air', 0, position);
    bot.setBlock(air);
    bot.emit('blockUpdate', stone, air);
    throw new Error('late acknowledgement failure');
  };
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const interpreter = buildInterpreter(bot, {
    worldChangeExecutor: executor,
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 1,
  });

  const result = await interpreter.run('dig_block', { x: 7, y: 64, z: 8 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'world_change_attribution_uncertain');
  assert.match(result.commandError, /late acknowledgement failure/);
  assert.equal(result.attemptedChanges[0].observed, true);
  assert.equal(result.attemptedChanges[0].verified, false);
  assert.equal(guard.snapshot().changes[0].status, 'uncertain');
});

test('placement records the supporting block needed to match the human request', async () => {
  const bot = fakeBot();
  const referencePosition = new Vec3(10, 63, 10);
  const placedPosition = new Vec3(10, 64, 10);
  const concrete = block('gray_concrete', 4, referencePosition);
  const air = block('air', 0, placedPosition);
  bot.setBlock(concrete);
  bot.setBlock(air);
  bot.placeBlock = async () => {
    const lantern = block('lantern', 9, placedPosition);
    bot.setBlock(lantern);
    bot.emit('blockUpdate', air, lantern);
  };
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const interpreter = buildInterpreter(bot, {
    worldChangeExecutor: executor,
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 1,
  });

  const result = await interpreter.run('place_against', {
    on: { x: 10, y: 63, z: 10 },
    face: 'top',
  });
  assert.equal(result.ok, true);
  assert.equal(result.changes[0].after, 'lantern');
  assert.deepEqual(result.changes[0].context.reference, {
    position: { x: 10, y: 63, z: 10 },
    name: 'gray_concrete',
  });
});

test('place_block turns an empty destination into a block using discovered support below', async () => {
  const bot = fakeBot();
  const supportPosition = new Vec3(12, 63, 10);
  const destination = new Vec3(12, 64, 10);
  const support = { ...block('dirt', 4, supportPosition), boundingBox: 'block' };
  const air = block('air', 0, destination);
  bot.setBlock(support);
  bot.setBlock(air);
  bot.heldItem = { name: 'dirt', count: 2 };
  bot.inventory = { items: () => [bot.heldItem] };
  let usedReference: any = null;
  let usedFace: any = null;
  bot.placeBlock = async (reference: any, face: Vec3) => {
    usedReference = reference;
    usedFace = face;
    const placed = block('dirt', 4, destination);
    bot.setBlock(placed);
    bot.emit('blockUpdate', air, placed);
  };
  const interpreter = buildInterpreter(bot, {
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 1,
  });

  const result = await interpreter.run('place_block', { x: 12, y: 64, z: 10 });

  assert.equal(result.ok, true);
  assert.equal(result.changes[0].after, 'dirt');
  assert.equal(usedReference.position.y, 63);
  assert.deepEqual(usedFace, new Vec3(0, 1, 0));
});

test('place_block naturally replaces short grass on buildable ground', async () => {
  const bot = fakeBot();
  const supportPosition = new Vec3(15, 63, 10);
  const destination = new Vec3(15, 64, 10);
  const support = { ...block('dirt', 4, supportPosition), boundingBox: 'block' };
  const shortGrass = { ...block('short_grass', 130, destination), boundingBox: 'empty' };
  bot.setBlock(support);
  bot.setBlock(shortGrass);
  bot.heldItem = { name: 'spruce_planks', count: 2 };
  bot.inventory = { items: () => [bot.heldItem] };
  bot.placeBlock = async () => {
    const placed = block('spruce_planks', 16, destination);
    bot.setBlock(placed);
    bot.emit('blockUpdate', shortGrass, placed);
  };
  const interpreter = buildInterpreter(bot, {
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 1,
  });

  const result = await interpreter.run('place_block', { x: 15, y: 64, z: 10 });

  assert.equal(result.ok, true);
  assert.equal(result.changes[0].before, 'short_grass');
  assert.equal(result.changes[0].after, 'spruce_planks');
});

test('placement preserves witnessed body space while allowing a real interior amenity', async () => {
  const bot = fakeBot();
  const supportPosition = new Vec3(18, 63, 10);
  const destination = new Vec3(18, 64, 10);
  const support = { ...block('dirt', 4, supportPosition), boundingBox: 'block' };
  const air = block('air', 0, destination);
  bot.setBlock(support);
  bot.setBlock(air);
  bot.game = { dimension: 'overworld' };
  bot.heldItem = { name: 'spruce_planks', count: 2 };
  bot.inventory = { items: () => [bot.heldItem] };
  let attempts = 0;
  bot.placeBlock = async () => {
    attempts += 1;
    const placed = block(String(bot.heldItem.name), attempts + 20, destination);
    bot.setBlock(placed);
    bot.emit('blockUpdate', air, placed);
  };
  const rememberedPlace: InhabitantPlace = {
    id: 'place:overworld:18:64:10',
    label: 'Shared home',
    purpose: 'A shared shelter exists',
    anchor: { dimension: 'overworld', x: 18, y: 64, z: 10 },
    affordances: ['sealed-space', 'shared-capacity'],
    protectedBodyCells: [{ x: 18, y: 64, z: 10 }],
    entrances: [],
    evidence: 'space_enclosed',
    learnedAtSequence: 2,
    lastConfirmedAtSequence: 3,
    provenance: {
      source: 'own_entity_loom',
      projectId: 'home',
      completionTurnSequence: 3,
      witnessTurnSequence: 2,
      witnessAction: 'inspect_reachable_space',
    },
  };
  const interpreter = buildInterpreter(bot, {
    places: () => [rememberedPlace],
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 1,
  });

  const structural = await interpreter.run('place_block', {
    x: 18,
    y: 64,
    z: 10,
    name: 'spruce_planks',
  });
  assert.equal(structural.error, 'placement_would_fill_remembered_body_space');
  assert.equal(structural.place.id, 'place:overworld:18:64:10');
  assert.equal(attempts, 0);

  const vanillaStructural = await buildInterpreter(bot, {
    places: () => [rememberedPlace],
    safetyProfile: 'vanilla-player-v1',
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 1,
  }).run('place_block', {
    x: 18,
    y: 64,
    z: 10,
    name: 'spruce_planks',
  });
  assert.equal(vanillaStructural.ok, true);
  assert.equal(attempts, 1);

  bot.setBlock(air);

  bot.heldItem = { name: 'chest', count: 1 };
  bot.inventory = { items: () => [bot.heldItem] };
  const amenity = await interpreter.run('place_block', {
    x: 18,
    y: 64,
    z: 10,
    name: 'chest',
  });
  assert.equal(amenity.ok, true);
  assert.equal(attempts, 2);
});

test('placement forces the final face look when Mineflayer exposes placement options', async () => {
  const bot = fakeBot();
  const supportPosition = new Vec3(13, 63, 10);
  const destination = new Vec3(13, 64, 10);
  const support = { ...block('dirt', 4, supportPosition), boundingBox: 'block' };
  const air = block('air', 0, destination);
  bot.setBlock(support);
  bot.setBlock(air);
  bot.heldItem = { name: 'dirt', count: 1 };
  bot.inventory = { items: () => [bot.heldItem] };
  let options: any = null;
  bot._placeBlockWithOptions = async (_reference: any, _face: Vec3, value: any) => {
    options = value;
    const placed = block('dirt', 4, destination);
    bot.setBlock(placed);
    bot.emit('blockUpdate', air, placed);
  };
  const interpreter = buildInterpreter(bot, {
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 1,
  });

  const result = await interpreter.run('place_block', { x: 13, y: 64, z: 10 });

  assert.equal(result.ok, true);
  assert.deepEqual(options, { swingArm: 'right', forceLook: true });
});

test('placement refuses an occupied destination before sending a Minecraft command', async () => {
  const bot = fakeBot();
  const reference = { ...block('dirt', 4, new Vec3(14, 63, 10)), boundingBox: 'block' };
  const occupied = block('crafting_table', 7, new Vec3(14, 64, 10));
  bot.setBlock(reference);
  bot.setBlock(occupied);
  bot.heldItem = { name: 'dirt', count: 1 };
  bot.inventory = { items: () => [bot.heldItem] };
  let attempted = false;
  bot.placeBlock = async () => {
    attempted = true;
  };
  const interpreter = buildInterpreter(bot);

  const direct = await interpreter.run('place_block', { x: 14, y: 64, z: 10 });
  const against = await interpreter.run('place_against', {
    on: { x: 14, y: 63, z: 10 },
    face: 'top',
  });

  assert.equal(direct.error, 'placement_target_occupied');
  assert.equal(against.error, 'placement_target_occupied');
  assert.equal(attempted, false);
});

test('placement exposes safe repositioning when the desired cell contains the bot body', async () => {
  const bot = fakeBot();
  const target = new Vec3(16, 64, 10);
  bot.setBlock({ ...block('dirt', 4, new Vec3(16, 63, 10)), boundingBox: 'block' });
  bot.setBlock(block('air', 0, target));
  bot.setBlock({ ...block('grass_block', 5, new Vec3(17, 64, 10)), boundingBox: 'block' });
  bot.setBlock(block('air', 0, new Vec3(17, 65, 10)));
  bot.setBlock(block('air', 0, new Vec3(17, 66, 10)));
  bot.setBlock({ ...block('grass_block', 5, new Vec3(15, 63, 10)), boundingBox: 'block' });
  bot.setBlock(block('air', 0, new Vec3(15, 64, 10)));
  bot.setBlock(block('air', 0, new Vec3(15, 65, 10)));
  bot.entity = { position: new Vec3(16.5, 64, 10.5), width: 0.6, height: 1.8 };
  bot.heldItem = { name: 'dirt', count: 1 };
  bot.inventory = { items: () => [bot.heldItem] };
  let attempted = false;
  bot.placeBlock = async () => {
    attempted = true;
  };
  const interpreter = buildInterpreter(bot);

  const result = await interpreter.run('place_block', { x: 16, y: 64, z: 10 });

  assert.equal(result.error, 'placement_would_intersect_body');
  assert.deepEqual(result.body, { x: 16.5, y: 64, z: 10.5 });
  assert.ok(
    result.suggestedFeetPositions.some(
      (position: any) => position.x === 17 && position.y === 65 && position.z === 10,
    ),
  );
  assert.ok(
    result.suggestedFeetPositions.some(
      (position: any) => position.x === 15 && position.y === 64 && position.z === 10,
    ),
  );
  assert.equal(attempted, false);
});

test('place_block owns a bounded step-aside and preserves the exact placement target', async () => {
  const bot = fakeBot();
  const target = new Vec3(16, 64, 10);
  const support = { ...block('dirt', 4, new Vec3(16, 63, 10)), boundingBox: 'block' };
  const safeSupport = {
    ...block('grass_block', 5, new Vec3(15, 63, 10)),
    boundingBox: 'block',
  };
  const air = block('air', 0, target);
  bot.setBlock(support);
  bot.setBlock(safeSupport);
  bot.setBlock(air);
  bot.entity = { position: new Vec3(16.5, 64, 10.5), width: 0.6, height: 1.8 };
  bot.heldItem = { name: 'dirt', count: 1 };
  bot.inventory = { items: () => [bot.heldItem] };
  const goals: any[] = [];
  bot.pathfinder = {
    goto: async (goal: any) => {
      goals.push(goal);
      bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5);
    },
    stop: () => {},
  };
  let placements = 0;
  bot.placeBlock = async () => {
    placements += 1;
    const placed = block('dirt', 4, target);
    bot.setBlock(placed);
    bot.emit('blockUpdate', air, placed);
  };
  const interpreter = buildInterpreter(bot, {
    changeConfirmationTimeoutMs: 5,
    changeStabilityWindowMs: 1,
  });

  const result = await interpreter.run('place_block', { x: 16, y: 64, z: 10 });

  assert.equal(result.ok, true);
  assert.equal(goals.length, 1);
  assert.deepEqual({ x: goals[0].x, y: goals[0].y, z: goals[0].z }, { x: 15, y: 64, z: 10 });
  assert.equal(result.navigation.target, 'placement step-aside');
  assert.deepEqual(result.navigation.final, { x: 15.5, y: 64, z: 10.5 });
  assert.deepEqual(result.changes[0].position, { x: 16, y: 64, z: 10 });
  assert.equal(result.changes[0].verified, true);
  assert.equal(placements, 1);

  bot.setBlock(air);
  bot.entity.position = new Vec3(16.5, 64, 10.5);
  bot.pathfinder.goto = async () => {
    bot.entity.position = new Vec3(15.9, 64, 10.5);
  };
  const unsafeArrival = await interpreter.run('place_block', { x: 16, y: 64, z: 10 });
  assert.equal(unsafeArrival.ok, false);
  assert.equal(unsafeArrival.error, 'placement_reposition_unconfirmed');
  assert.equal(placements, 1, 'an overlapping body must prevent the Minecraft placement command');
});
