import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

export type ChatLine = { username: string; message: string; at: number } | null;

export type InventorySummary = { name: string; count: number };
export type NearbyEntitySummary = {
  id?: number;
  name: string;
  type?: string;
  heldItem: string | null;
  count?: number;
  pickupGround?: DroppedItemPickupGround;
  distance: number;
  position: { x: number; y: number; z: number };
};
export type NearbyBlockSummary = {
  name: string;
  count: number;
  nearest?: { x: number; y: number; z: number; distance: number };
};

export type DroppedItemPickupGround = {
  status: 'supported' | 'unsupported' | 'hazardous' | 'unknown';
  feet?: { x: number; y: number; z: number };
  support?: { x: number; y: number; z: number; name: string | null };
};

export function collectObservation(bot: Bot, lastChat: ChatLine) {
  const pos = (bot as any).entity?.position;
  const position = pos ? { x: round(pos.x), y: round(pos.y), z: round(pos.z) } : null;
  const mcTime = (bot as any).time?.time;
  const dimension = (bot as any).game?.dimension;
  const held = (bot as any).heldItem;
  const inventory = summarizeInventory((bot as any).inventory?.items?.() || []);
  const onlinePlayers = onlinePlayerNames(bot);
  const nearbyEntities = summarizeNearbyEntities(bot);
  const nearbyBlocks = summarizeNearbyBlocks(bot);
  return {
    time: Date.now(),
    username: (bot as any).username,
    position,
    health: (bot as any).health,
    food: (bot as any).food,
    oxygen: (bot as any).oxygenLevel,
    heldItem: held?.name || held?.displayName || null,
    inventory,
    onlinePlayers,
    nearbyEntities,
    nearbyBlocks,
    mcTime,
    isDay: (bot as any).time?.isDay ?? null,
    dimension,
    lastChat,
  };
}

export function onlinePlayerNames(bot: Bot): string[] | null {
  const players = (bot as any).players;
  if (!players || typeof players !== 'object') return null;
  const self = String((bot as any).username || '').toLowerCase();
  return Object.keys(players)
    .filter((name) => name.toLowerCase() !== self)
    .sort((a, b) => a.localeCompare(b));
}

export function summarizeInventory(items: any[], limit = 16): InventorySummary[] {
  const counts = new Map<string, number>();
  for (const item of items || []) {
    const name = String(item?.name || item?.displayName || 'unknown');
    counts.set(name, (counts.get(name) || 0) + Math.max(0, Number(item?.count) || 0));
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function summarizeNearbyEntities(
  bot: Bot,
  radius = 24,
  limit = 8,
  playerRadius = 64,
): NearbyEntitySummary[] {
  const me = (bot as any).entity?.position;
  if (!me) return [];
  const candidates = (Object.values((bot as any).entities || {}) as any[])
    .filter((entity) => entity?.position && entity?.id !== (bot as any).entity?.id)
    .map((entity) => ({ entity, distance: me.distanceTo(entity.position) }))
    .filter(({ entity, distance }) => {
      if (!Number.isFinite(distance)) return false;
      return distance <= radius || (isPlayerEntity(entity) && distance <= playerRadius);
    });
  const players = candidates
    .filter(({ entity }) => isPlayerEntity(entity))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.min(4, limit));
  const selectedPlayerIds = new Set(players.map(({ entity }) => entity.id));
  const others = candidates
    .filter(({ entity, distance }) => !selectedPlayerIds.has(entity.id) && distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(0, limit - players.length));
  return [...players, ...others]
    .sort((a, b) => a.distance - b.distance)
    .map(({ entity, distance }) => {
      const dropped = droppedItem(entity);
      return {
        id: entity.id,
        name: dropped?.name || String(entity.username || entity.name || entity.type || 'entity'),
        type: dropped ? 'item' : entity.type,
        heldItem: itemName(entity.heldItem),
        ...(dropped?.count != null ? { count: dropped.count } : {}),
        ...(dropped ? { pickupGround: droppedItemPickupGround(bot, entity.position) } : {}),
        distance: round(distance),
        position: {
          x: round(entity.position.x),
          y: round(entity.position.y),
          z: round(entity.position.z),
        },
      };
    });
}

function isPlayerEntity(entity: any) {
  return String(entity?.type || '').toLowerCase() === 'player' || !!entity?.username;
}

export function droppedItemPickupGround(bot: Bot, target: any): DroppedItemPickupGround {
  if (!target) return { status: 'unknown' };
  const feet = {
    x: Math.floor(Number(target.x)),
    y: Math.floor(Number(target.y)),
    z: Math.floor(Number(target.z)),
  };
  const supportPosition = { x: feet.x, y: feet.y - 1, z: feet.z };
  const support = (bot as any).blockAt?.(
    new Vec3(supportPosition.x, supportPosition.y, supportPosition.z),
  );
  const name = String(support?.name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const hazardous = new Set([
    'water',
    'lava',
    'fire',
    'soul_fire',
    'powder_snow',
    'cactus',
    'magma_block',
  ]);
  const air = ['air', 'cave_air', 'void_air'].includes(name);
  if (!support || air || support?.boundingBox === 'empty' || hazardous.has(name)) {
    return {
      status: hazardous.has(name) ? 'hazardous' : 'unsupported',
      feet,
      support: { ...supportPosition, name: name || null },
    };
  }
  return {
    status: 'supported',
    feet,
    support: { ...supportPosition, name },
  };
}

function droppedItem(entity: any) {
  if (String(entity?.name || '').toLowerCase() !== 'item' && !entity?.getDroppedItem) {
    return null;
  }
  try {
    const item = entity?.getDroppedItem?.();
    if (!item) return null;
    return {
      name: String(item.name || item.displayName || 'item'),
      count: Number.isFinite(Number(item.count)) ? Number(item.count) : undefined,
    };
  } catch {
    return null;
  }
}

function itemName(item: any) {
  return item?.name || item?.displayName ? String(item.name || item.displayName) : null;
}

export function summarizeNearbyBlocks(
  bot: Bot,
  radius = 5,
  verticalRadius = 4,
  limit = 16,
): NearbyBlockSummary[] {
  const pos = (bot as any).entity?.position;
  if (!pos) return [];
  const counts = new Map<string, number>();
  const nearest = new Map<string, { x: number; y: number; z: number; distance: number }>();
  const x0 = Math.floor(pos.x);
  const y0 = Math.floor(pos.y);
  const z0 = Math.floor(pos.z);
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = -verticalRadius; dy <= verticalRadius; dy++) {
        const block = (bot as any).blockAt?.(new Vec3(x0 + dx, y0 + dy, z0 + dz));
        const name = String(block?.name || '');
        if (!name || name === 'air' || name === 'cave_air' || name === 'void_air') continue;
        counts.set(name, (counts.get(name) || 0) + 1);
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (!nearest.has(name) || distance < nearest.get(name)!.distance) {
          nearest.set(name, {
            x: x0 + dx,
            y: y0 + dy,
            z: z0 + dz,
            distance: round(distance),
          });
        }
      }
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, nearest: nearest.get(name)! }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function round(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : n;
}
