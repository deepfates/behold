import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import type { Bot } from 'mineflayer';

export function buildTools(bot: Bot) {
  const fns: Record<string, (input: any) => Promise<any>> = {};
  const specs: any[] = [];

  fns.say = async (input: any) => {
    const text = typeof input === 'string' ? input : input?.text ?? String(input);
    if (!text) return { ok: false, error: 'Missing text' };
    bot.chat(text);
    return { ok: true };
  };
  specs.push({
    type: 'function',
    function: {
      name: 'say',
      description: 'Send a chat message to the server',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'What to say in chat' } },
        required: ['text'],
      },
    },
  });

  fns.move_to = async ({ x, y, z, near = 0 }: any) => {
    if (!bot.pathfinder) return { ok: false, error: 'Pathfinder not available' };
    if ([x, y, z].some((v: any) => typeof v !== 'number')) return { ok: false, error: 'x,y,z required' };
    const goal = near > 0 ? new (goals as any).GoalNear(x, y, z, near) : new (goals as any).GoalBlock(x, y, z);
    bot.pathfinder.setGoal(goal);
    return { ok: true };
  };
  specs.push({
    type: 'function',
    function: {
      name: 'move_to',
      description: 'Pathfind to a world position',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
          near: { type: 'number', description: 'Accept within this radius (blocks)' },
        },
        required: ['x', 'y', 'z'],
      },
    },
  });

  fns.stop = async () => {
    try { bot.stopDigging?.(); } catch {}
    if (bot.pathfinder) bot.pathfinder.stop();
    return { ok: true };
  };
  specs.push({
    type: 'function',
    function: { name: 'stop', description: 'Stop current action/path', parameters: { type: 'object', properties: {} } },
  });

  fns.look_at = async ({ x, y, z, force = false }: any) => {
    if ([x, y, z].some((v: any) => typeof v !== 'number')) return { ok: false, error: 'x,y,z required' };
    await bot.lookAt(new Vec3(x, y, z), force);
    return { ok: true };
  };
  specs.push({
    type: 'function',
    function: {
      name: 'look_at',
      description: 'Rotate view to look at a position',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
          force: { type: 'boolean' },
        },
        required: ['x', 'y', 'z'],
      },
    },
  });

  fns.get_status = async () => {
    const p = bot.entity?.position;
    const position = p ? { x: p.x, y: p.y, z: p.z } : null;
    return {
      ok: true,
      position,
      health: bot.health,
      food: bot.food,
      time: bot.time?.time,
      dimension: bot.game?.dimension,
      username: bot.username,
    };
  };
  specs.push({
    type: 'function',
    function: { name: 'get_status', description: 'Get basic status (pos, health, food)', parameters: { type: 'object', properties: {} } },
  });

  fns.get_nearby = async ({ radius = 10, limit = 10 }: any = {}) => {
    const me = bot.entity?.position;
    const ents = Object.values(bot.entities || {})
      .filter((e: any) => (e as any).type && (e as any).position && (!me || (e as any).position.distanceTo(me) <= radius))
      .sort((a: any, b: any) => (me ? (a as any).position.distanceTo(me) - (b as any).position.distanceTo(me) : 0))
      .slice(0, limit)
      .map((e: any) => ({
        id: (e as any).id,
        username: (e as any).username,
        name: (e as any).name,
        type: (e as any).type,
        position: (e as any).position ? { x: (e as any).position.x, y: (e as any).position.y, z: (e as any).position.z } : null,
      }));
    return { ok: true, entities: ents };
  };
  specs.push({
    type: 'function',
    function: {
      name: 'get_nearby',
      description: 'List nearby entities within radius',
      parameters: {
        type: 'object',
        properties: { radius: { type: 'number' }, limit: { type: 'number' } },
      },
    },
  });

  fns.dig_block = async ({ x, y, z }: any) => {
    if ([x, y, z].some((v: any) => typeof v !== 'number')) return { ok: false, error: 'x,y,z required' };
    const pos = new Vec3(x, y, z);
    const block = bot.blockAt(pos);
    if (!block) return { ok: false, error: 'No block at position' };
    await bot.dig(block);
    return { ok: true };
  };
  specs.push({
    type: 'function',
    function: {
      name: 'dig_block',
      description: 'Mine the block at a given position',
      parameters: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
        required: ['x', 'y', 'z'],
      },
    },
  });

  const faces: Record<string, Vec3> = { top: new Vec3(0, 1, 0), bottom: new Vec3(0, -1, 0), north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0) };
  fns.place_against = async ({ on, face = 'top' }: any) => {
    if (!on || [on.x, on.y, on.z].some((v: any) => typeof v !== 'number')) return { ok: false, error: 'on{x,y,z} required' };
    const ref = bot.blockAt(new Vec3(on.x, on.y, on.z));
    if (!ref) return { ok: false, error: 'Reference block not found' };
    const dir = faces[face] || faces.top;
    await bot.placeBlock(ref, dir);
    return { ok: true };
  };
  specs.push({
    type: 'function',
    function: {
      name: 'place_against',
      description: 'Place the held block against a reference block face',
      parameters: {
        type: 'object',
        properties: {
          on: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
            required: ['x', 'y', 'z'],
          },
          face: { type: 'string', enum: ['top', 'bottom', 'north', 'south', 'east', 'west'] },
        },
        required: ['on'],
      },
    },
  });

  fns.equip_item = async ({ name, destination = 'hand' }: any) => {
    if (!name) return { ok: false, error: 'name required' };
    const item = bot.inventory.items().find((i: any) =>
      i?.name?.toLowerCase()?.includes(String(name).toLowerCase()) ||
      i?.displayName?.toLowerCase()?.includes(String(name).toLowerCase())
    );
    if (!item) return { ok: false, error: 'Item not found in inventory' };
    await bot.equip(item, destination);
    return { ok: true };
  };
  specs.push({
    type: 'function',
    function: {
      name: 'equip_item',
      description: 'Equip an item from inventory',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Partial item name (e.g., "pickaxe")' },
          destination: { type: 'string', enum: ['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'] },
        },
        required: ['name'],
      },
    },
  });

  fns.eat_food = async ({ name }: any = {}) => {
    let item: any;
    if (name) {
      item = bot.inventory.items().find((i: any) =>
        i?.name?.toLowerCase()?.includes(String(name).toLowerCase()) ||
        i?.displayName?.toLowerCase()?.includes(String(name).toLowerCase())
      );
    } else {
      const edible = ['bread', 'apple', 'beef', 'pork', 'mutton', 'chicken', 'carrot', 'potato', 'steak', 'melon', 'pumpkin', 'cookie'];
      item = bot.inventory.items().find((i: any) => edible.some((k) => i?.name?.includes(k)));
    }
    if (!item) return { ok: false, error: 'No suitable food item found' };
    await bot.equip(item, 'hand');
    await bot.consume();
    return { ok: true };
  };
  specs.push({
    type: 'function',
    function: {
      name: 'eat_food',
      description: 'Consume a food item to restore hunger',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Food name if you want a specific one' } },
      },
    },
  });

  return { fns, specs };
}
