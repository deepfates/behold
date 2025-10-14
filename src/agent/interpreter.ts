import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';

export type CommandSpec = {
  name: string;
  description: string;
  parameters: any; // JSON Schema
  run: (args: any) => Promise<any>;
  category?: string;
};

export function buildInterpreter(bot: Bot) {
  const specs: CommandSpec[] = [];
  const add = (s: CommandSpec) => specs.push(s);

  // chat/say
  add({
    name: 'chat',
    description: 'Send a public chat message',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: async ({ text }) => { (bot as any).chat(String(text)); return { ok: true }; },
    category: 'chat',
  });

  add({
    name: 'whisper',
    description: 'Whisper a player using /tell',
    parameters: { type: 'object', properties: { username: { type: 'string' }, text: { type: 'string' } }, required: ['username','text'] },
    run: async ({ username, text }) => { (bot as any).whisper(String(username), String(text)); return { ok: true }; },
    category: 'chat',
  });

  // look
  add({
    name: 'look_at',
    description: 'Rotate to face a world position',
    parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, force: { type: 'boolean' } }, required: ['x','y','z'] },
    run: async ({ x, y, z, force = false }) => { await (bot as any).lookAt(new Vec3(x, y, z), !!force); return { ok: true }; },
    category: 'view',
  });

  add({
    name: 'look',
    description: 'Set yaw/pitch directly (radians)',
    parameters: { type: 'object', properties: { yaw: { type: 'number' }, pitch: { type: 'number' }, force: { type: 'boolean' } }, required: ['yaw','pitch'] },
    run: async ({ yaw, pitch, force = false }) => { await (bot as any).look(Number(yaw), Number(pitch), !!force); return { ok: true }; },
    category: 'view',
  });

  // movement
  add({
    name: 'set_control',
    description: 'Set a control state (forward, back, left, right, jump, sprint, sneak)',
    parameters: { type: 'object', properties: { control: { type: 'string' }, state: { type: 'boolean' } }, required: ['control','state'] },
    run: async ({ control, state }) => { (bot as any).setControlState(String(control), !!state); return { ok: true }; },
    category: 'move',
  });

  add({
    name: 'clear_controls',
    description: 'Clear all movement control states',
    parameters: { type: 'object', properties: {} },
    run: async () => { (bot as any).clearControlStates?.(); return { ok: true }; },
    category: 'move',
  });

  // dig/place
  add({
    name: 'dig_block',
    description: 'Start digging the block at x,y,z',
    parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['x','y','z'] },
    run: async ({ x, y, z }) => {
      const b = (bot as any).blockAt(new Vec3(x, y, z));
      if (!b) return { ok: false, error: 'no_block' };
      await (bot as any).dig(b);
      return { ok: true };
    },
    category: 'world',
  });

  add({
    name: 'stop_digging',
    description: 'Abort current digging',
    parameters: { type: 'object', properties: {} },
    run: async () => { (bot as any).stopDigging?.(); return { ok: true }; },
    category: 'world',
  });

  add({
    name: 'place_against',
    description: 'Place held block against a reference block face',
    parameters: {
      type: 'object',
      properties: {
        on: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['x','y','z'] },
        face: { type: 'string', enum: ['top','bottom','north','south','east','west'] }
      }, required: ['on']
    },
    run: async ({ on, face = 'top' }) => {
      const ref = (bot as any).blockAt(new Vec3(on.x, on.y, on.z));
      if (!ref) return { ok: false, error: 'no_ref_block' };
      const faces: Record<string, Vec3> = { top: new Vec3(0,1,0), bottom: new Vec3(0,-1,0), north: new Vec3(0,0,-1), south: new Vec3(0,0,1), east: new Vec3(1,0,0), west: new Vec3(-1,0,0) };
      await (bot as any).placeBlock(ref, faces[face] || faces.top);
      return { ok: true };
    },
    category: 'world',
  });

  // inventory/consume
  add({
    name: 'equip_item',
    description: 'Equip an inventory item by name substring',
    parameters: { type: 'object', properties: { name: { type: 'string' }, destination: { type: 'string', enum: ['hand','off-hand','head','torso','legs','feet'] } }, required: ['name'] },
    run: async ({ name, destination = 'hand' }) => {
      const item = (bot as any).inventory?.items?.().find((i: any) => i?.name?.toLowerCase()?.includes(String(name).toLowerCase()) || i?.displayName?.toLowerCase()?.includes(String(name).toLowerCase()));
      if (!item) return { ok: false, error: 'item_not_found' };
      await (bot as any).equip(item, destination);
      return { ok: true };
    },
    category: 'inventory',
  });

  add({
    name: 'consume',
    description: 'Consume the currently held item (eat/drink/use)',
    parameters: { type: 'object', properties: {} },
    run: async () => { await (bot as any).consume(); return { ok: true }; },
    category: 'inventory',
  });

  // sensing
  add({
    name: 'block_at_cursor',
    description: 'Get block currently under crosshair within maxDistance',
    parameters: { type: 'object', properties: { maxDistance: { type: 'number' } } },
    run: async ({ maxDistance = 6 }) => {
      const b = (bot as any).blockAtCursor?.(Number(maxDistance));
      if (!b) return { ok: true, block: null };
      return { ok: true, block: summarizeBlock(b) };
    },
    category: 'sense',
  });

  add({
    name: 'entity_at_cursor',
    description: 'Get entity under crosshair within maxDistance',
    parameters: { type: 'object', properties: { maxDistance: { type: 'number' } } },
    run: async ({ maxDistance = 3.5 }) => {
      const e = (bot as any).entityAtCursor?.(Number(maxDistance));
      if (!e) return { ok: true, entity: null };
      return { ok: true, entity: summarizeEntity(e) };
    },
    category: 'sense',
  });

  add({
    name: 'nearest_entity',
    description: 'Get nearest entity (optionally by lowercase name)',
    parameters: { type: 'object', properties: { name: { type: 'string' } } },
    run: async ({ name }) => {
      const match = (ent: any) => {
        if (!name) return true;
        const n = String(name).toLowerCase();
        return (ent?.name?.toLowerCase?.()?.includes(n)) || (ent?.username?.toLowerCase?.()?.includes(n));
      };
      const e = (bot as any).nearestEntity(match);
      return { ok: true, entity: e ? summarizeEntity(e) : null };
    },
    category: 'sense',
  });

  // status
  add({
    name: 'status',
    description: 'Get brief status and position',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const p = (bot as any).entity?.position;
      const position = p ? { x: p.x, y: p.y, z: p.z } : null;
      return { ok: true, position, health: (bot as any).health, food: (bot as any).food, dimension: (bot as any).game?.dimension, time: (bot as any).time?.time };
    },
    category: 'sense',
  });

  function summarizeBlock(b: any) {
    return {
      name: b?.name,
      type: b?.type,
      hardness: b?.hardness,
      position: b?.position ? { x: b.position.x, y: b.position.y, z: b.position.z } : null,
    };
  }

  function summarizeEntity(e: any) {
    const me = (bot as any).entity?.position;
    const pos = e?.position;
    const dist = me && pos ? Math.sqrt(Math.pow(pos.x - me.x, 2) + Math.pow(pos.y - me.y, 2) + Math.pow(pos.z - me.z, 2)) : null;
    return {
      id: e?.id,
      username: e?.username,
      name: e?.name,
      type: e?.type,
      position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
      distance: dist,
    };
  }

  return {
    list() {
      return specs.map(({ name, description, parameters, category }) => ({ name, description, parameters, category }));
    },
    describe(name: string) {
      const c = specs.find((s) => s.name === name);
      if (!c) return null;
      const { description, parameters, category } = c;
      return { name, description, parameters, category };
    },
    async run(name: string, args: any) {
      const c = specs.find((s) => s.name === name);
      if (!c) return { ok: false, error: 'unknown_command' };
      try { return await c.run(args ?? {}); } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
    },
    specs,
  };
}

