import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { minecraftOxygenLevel } from './condition';

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

export const FIRST_PERSON_VISION = Object.freeze({
  horizontalFovDegrees: 100,
  verticalFovDegrees: 70,
  horizontalRays: 9,
  verticalRays: 5,
  terrainDistance: 24,
  entityDistance: 24,
  playerDistance: 64,
  entityLimit: 8,
  entityCandidateLimit: 64,
  blockTargetLimit: 24,
});

export type VisibleBlockTarget = {
  source: 'vision';
  name: string;
  position: { x: number; y: number; z: number };
  distance: number;
  ray: { row: number; column: number };
};

export type VisibleTerrainSummary = {
  source: 'vision';
  horizontalFovDegrees: number;
  verticalFovDegrees: number;
  maxDistance: number;
  raysCast: number;
  raysHit: number;
  failedRays: number;
  materials: NearbyBlockSummary[];
  /** Bounded unique first-hit surfaces from the same rays as visualField. */
  targets: VisibleBlockTarget[];
  visualField: FirstPersonVisualField;
};

export type FirstPersonVisualField = {
  protocol: 'behold.visual-field.v1';
  available: boolean;
  dimensions: { rows: number; columns: number };
  rowOrder: 'top_to_bottom';
  columnOrder: 'left_to_right';
  materialRows: string[];
  depthRows: string[];
  materialLegend: Array<{ symbol: string; name: string }>;
  depthLegend: Array<{ symbol: string; label: string; maxDistance: number }>;
  noHitSymbol: '.';
  unavailableSymbol: '?';
  center: { row: number; column: number; alignedWith: 'current_view' };
  note: string;
};

export type CursorTarget =
  | { kind: 'block'; block: any; distance: number }
  | { kind: 'entity'; entity: any; distance: number };

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
  const nearbyEntities = summarizeVisibleEntities(bot);
  const visibleTerrain = summarizeVisibleTerrain(bot);
  return {
    time: Date.now(),
    username: (bot as any).username,
    position,
    health: (bot as any).health,
    food: (bot as any).food,
    oxygen: minecraftOxygenLevel((bot as any).oxygenLevel),
    heldItem: held?.name || held?.displayName || null,
    inventory,
    onlinePlayers,
    nearbyEntities,
    nearbyBlocks: visibleTerrain.materials,
    vision: visibleTerrain,
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

export function summarizeVisibleEntities(
  bot: Bot,
  radius = FIRST_PERSON_VISION.entityDistance,
  limit = FIRST_PERSON_VISION.entityLimit,
  playerRadius = FIRST_PERSON_VISION.playerDistance,
): NearbyEntitySummary[] {
  const me = (bot as any).entity?.position;
  if (!me) return [];
  const candidates = (Object.values((bot as any).entities || {}) as any[])
    .filter((entity) => entity?.position && entity?.id !== (bot as any).entity?.id)
    .map((entity) => ({ entity, distance: me.distanceTo(entity.position) }))
    .filter(({ entity, distance }) => {
      if (!Number.isFinite(distance)) return false;
      return distance <= radius || (isPlayerEntity(entity) && distance <= playerRadius);
    })
    .sort((a, b) => a.distance - b.distance)
    .filter(({ entity }) => entityIntersectsCurrentView(bot, entity))
    .slice(0, FIRST_PERSON_VISION.entityCandidateLimit)
    .filter(({ entity }) => entityIsVisible(bot, entity));
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

/**
 * Conservative semantic visibility for a first-person Minecraft body.
 *
 * Mineflayer tracks server-sent entities through walls. A resident may name an
 * entity only when at least one sampled point on its body lies inside the
 * current camera frustum and an opaque block ray does not reach that point
 * first. Missing raycast support fails closed.
 */
export function entityIsVisible(bot: Bot, entity: any) {
  const body = (bot as any).entity;
  const me = body?.position;
  if (!me || !entity?.position || entity?.id === body?.id) return false;
  const height = entityVisualHeight(entity);
  const samples = [0.2, 0.55, 0.9].map((fraction) =>
    entity.position.offset(0, Math.max(0.1, height * fraction), 0),
  );
  return samples.some(
    (sample) => pointInCurrentView(bot, sample) && pointHasUnoccludedRay(bot, sample),
  );
}

/**
 * The interaction cursor is narrower than semantic vision. It uses the
 * current eye ray, selects the nearest entity hit box only when that hit is in
 * front of the first selectable block, and treats zero yaw/pitch as valid.
 * This intentionally does not delegate to Mineflayer's blockAtEntityCursor.
 */
export function cursorTarget(
  bot: Bot,
  blockMaxDistance = 6,
  entityMaxDistance = 3.5,
): CursorTarget | null {
  const eye = eyePosition(bot);
  const body = (bot as any).entity;
  const raycast = (bot as any).world?.raycast;
  if (!eye || !body || typeof raycast !== 'function') return null;
  const direction = viewDirection(finiteNumber(body.pitch) ?? 0, finiteNumber(body.yaw) ?? 0);
  let block: any = null;
  try {
    block = raycast.call((bot as any).world, eye, direction, blockMaxDistance);
  } catch {
    return null;
  }
  const blockDistance = block ? rayHitDistance(eye, block, blockMaxDistance) : blockMaxDistance;
  const entityRange = Math.min(entityMaxDistance, blockDistance);
  let selectedEntity: any = null;
  let selectedDistance = entityRange;
  for (const entity of Object.values((bot as any).entities || {}) as any[]) {
    if (
      !entity?.position ||
      entity?.id === body.id ||
      String(entity?.type || '').toLowerCase() === 'object'
    ) {
      continue;
    }
    const hitDistance = rayEntityBoxDistance(eye, direction, entity, entityRange);
    if (hitDistance == null || hitDistance > selectedDistance) continue;
    selectedEntity = entity;
    selectedDistance = hitDistance;
  }
  if (selectedEntity) {
    return { kind: 'entity', entity: selectedEntity, distance: round(selectedDistance) };
  }
  return block ? { kind: 'block', block, distance: round(blockDistance) } : null;
}

export function blockAtViewCursor(bot: Bot, maxDistance = 6) {
  const target = cursorTarget(bot, maxDistance, 0);
  return target?.kind === 'block' ? target.block : null;
}

export function entityAtViewCursor(bot: Bot, maxDistance = 3.5) {
  const target = cursorTarget(bot, maxDistance, maxDistance);
  return target?.kind === 'entity' ? target.entity : null;
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

export function summarizeVisibleTerrain(
  bot: Bot,
  maxDistance = FIRST_PERSON_VISION.terrainDistance,
  limit = 16,
): VisibleTerrainSummary {
  const body = (bot as any).entity;
  const pos = body?.position;
  const eye = eyePosition(bot);
  const raycast = (bot as any).world?.raycast;
  const rayBudget = FIRST_PERSON_VISION.horizontalRays * FIRST_PERSON_VISION.verticalRays;
  const empty = (): VisibleTerrainSummary => ({
    source: 'vision',
    horizontalFovDegrees: FIRST_PERSON_VISION.horizontalFovDegrees,
    verticalFovDegrees: FIRST_PERSON_VISION.verticalFovDegrees,
    maxDistance,
    raysCast: 0,
    raysHit: 0,
    failedRays: rayBudget,
    materials: [],
    targets: [],
    visualField: visualField(
      Array.from({ length: FIRST_PERSON_VISION.verticalRays }, () =>
        Array.from({ length: FIRST_PERSON_VISION.horizontalRays }, () => ({
          state: 'unavailable' as const,
        })),
      ),
      maxDistance,
      false,
    ),
  });
  if (!pos || !eye || typeof raycast !== 'function') return empty();
  const counts = new Map<string, number>();
  const nearest = new Map<string, { x: number; y: number; z: number; distance: number }>();
  const targets = new Map<string, VisibleBlockTarget>();
  const seen = new Set<string>();
  const samples: VisualRaySample[][] = [];
  let raysCast = 0;
  let raysHit = 0;
  let failedRays = 0;
  const yaw = finiteNumber(body?.yaw) ?? 0;
  const pitch = finiteNumber(body?.pitch) ?? 0;
  const horizontalHalf = degreesToRadians(FIRST_PERSON_VISION.horizontalFovDegrees / 2);
  const verticalHalf = degreesToRadians(FIRST_PERSON_VISION.verticalFovDegrees / 2);

  for (let vertical = 0; vertical < FIRST_PERSON_VISION.verticalRays; vertical += 1) {
    const row: VisualRaySample[] = [];
    const verticalRatio = -sampleRatio(vertical, FIRST_PERSON_VISION.verticalRays);
    for (let horizontal = 0; horizontal < FIRST_PERSON_VISION.horizontalRays; horizontal += 1) {
      const horizontalRatio = -sampleRatio(horizontal, FIRST_PERSON_VISION.horizontalRays);
      const direction = viewDirection(
        clampPitch(pitch + verticalRatio * verticalHalf),
        normalizeAngle(yaw + horizontalRatio * horizontalHalf),
      );
      let block: any = null;
      try {
        raysCast += 1;
        block = raycast.call((bot as any).world, eye, direction, maxDistance);
      } catch {
        failedRays += 1;
        row.push({ state: 'unavailable' });
        continue;
      }
      if (!block?.position) {
        row.push({ state: 'no_hit' });
        continue;
      }
      raysHit += 1;
      const blockPosition = block.position.floored?.() ?? block.position;
      const intersection = block.intersect || blockPosition.offset?.(0.5, 0.5, 0.5);
      const distance = intersection ? eye.distanceTo(intersection) : pos.distanceTo(blockPosition);
      const name = String(block.name || 'unknown');
      row.push({ state: 'hit', name, distance });
      const key = `${blockPosition.x}:${blockPosition.y}:${blockPosition.z}`;
      const targetable =
        !!name && !['unknown', 'air', 'cave_air', 'void_air'].includes(name.toLowerCase());
      if (targetable) {
        const target: VisibleBlockTarget = {
          source: 'vision',
          name,
          position: { x: blockPosition.x, y: blockPosition.y, z: blockPosition.z },
          distance: round(distance),
          ray: { row: vertical, column: horizontal },
        };
        const priorTarget = targets.get(key);
        if (!priorTarget || target.distance < priorTarget.distance) targets.set(key, target);
      }
      if (seen.has(key)) continue;
      seen.add(key);
      if (!targetable) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
      if (!nearest.has(name) || distance < nearest.get(name)!.distance) {
        nearest.set(name, {
          x: blockPosition.x,
          y: blockPosition.y,
          z: blockPosition.z,
          distance: round(distance),
        });
      }
    }
    samples.push(row);
  }

  return {
    source: 'vision',
    horizontalFovDegrees: FIRST_PERSON_VISION.horizontalFovDegrees,
    verticalFovDegrees: FIRST_PERSON_VISION.verticalFovDegrees,
    maxDistance,
    raysCast,
    raysHit,
    failedRays,
    materials: [...counts.entries()]
      .map(([name, count]) => ({ name, count, nearest: nearest.get(name)! }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, limit),
    targets: [...targets.values()]
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          a.ray.row - b.ray.row ||
          a.ray.column - b.ray.column ||
          a.name.localeCompare(b.name),
      )
      .slice(0, FIRST_PERSON_VISION.blockTargetLimit),
    visualField: visualField(samples, maxDistance, failedRays < raysCast),
  };
}

type VisualRaySample =
  { state: 'hit'; name: string; distance: number } | { state: 'no_hit' } | { state: 'unavailable' };

const MATERIAL_SYMBOLS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function visualField(
  samples: VisualRaySample[][],
  maxDistance: number,
  available: boolean,
): FirstPersonVisualField {
  const names = [
    ...new Set(
      samples.flatMap((row) =>
        row.flatMap((sample) => (sample.state === 'hit' ? [sample.name] : [])),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const symbols = new Map(names.map((name, index) => [name, MATERIAL_SYMBOLS[index]]));
  return {
    protocol: 'behold.visual-field.v1',
    available,
    dimensions: {
      rows: FIRST_PERSON_VISION.verticalRays,
      columns: FIRST_PERSON_VISION.horizontalRays,
    },
    rowOrder: 'top_to_bottom',
    columnOrder: 'left_to_right',
    materialRows: samples.map((row) =>
      row
        .map((sample) =>
          sample.state === 'hit'
            ? symbols.get(sample.name) || '?'
            : sample.state === 'no_hit'
              ? '.'
              : '?',
        )
        .join(''),
    ),
    depthRows: samples.map((row) => row.map(depthSymbol).join('')),
    materialLegend: names.map((name) => ({ symbol: symbols.get(name)!, name })),
    depthLegend: [
      { symbol: '1', label: 'interaction', maxDistance: 4.5 },
      { symbol: '2', label: 'near', maxDistance: 8 },
      { symbol: '3', label: 'mid', maxDistance: 16 },
      { symbol: '4', label: 'far', maxDistance },
    ],
    noHitSymbol: '.',
    unavailableSymbol: '?',
    center: {
      row: Math.floor(FIRST_PERSON_VISION.verticalRays / 2),
      column: Math.floor(FIRST_PERSON_VISION.horizontalRays / 2),
      alignedWith: 'current_view',
    },
    note: 'Each cell is the first opaque/selectable surface on one current camera ray. A dot means no hit within range, not safety or empty loaded geometry.',
  };
}

function depthSymbol(sample: VisualRaySample) {
  if (sample.state === 'no_hit') return '.';
  if (sample.state === 'unavailable') return '?';
  if (sample.distance <= 4.5) return '1';
  if (sample.distance <= 8) return '2';
  if (sample.distance <= 16) return '3';
  return '4';
}

export function blockIsVisible(bot: Bot, position: any) {
  const target = integerBlockCenter(position);
  if (!target || !pointInCurrentView(bot, target)) return false;
  const hit = firstVisualHit(bot, target, 1, position);
  if (!hit?.position) return false;
  return sameBlockPosition(hit.position, position);
}

export function worldPositionIsVisible(bot: Bot, position: any) {
  const eye = eyePosition(bot);
  const raycast = (bot as any).world?.raycast;
  const target = integerBlockCenter(position);
  if (!eye || !target || typeof raycast !== 'function' || !pointInCurrentView(bot, target)) {
    return false;
  }
  const targetDistance = eye.distanceTo(target);
  const hit = firstVisualHit(bot, target, 1, position);
  if (!hit) return true;
  if (sameBlockPosition(hit.position, position)) return true;
  const intersection = hit.intersect;
  const hitDistance = intersection ? eye.distanceTo(intersection) : eye.distanceTo(hit.position);
  return hitDistance >= targetDistance - 0.05;
}

function firstVisualHit(bot: Bot, target: Vec3, extraRange: number, targetBlock?: any) {
  const eye = eyePosition(bot);
  const raycast = (bot as any).world?.raycast;
  if (!eye || typeof raycast !== 'function') return null;
  const delta = target.minus(eye);
  const distance = delta.norm();
  if (!Number.isFinite(distance) || distance <= 0) return null;
  try {
    return raycast.call(
      (bot as any).world,
      eye,
      normalized(delta),
      distance + extraRange,
      visualOcclusionMatcher(targetBlock),
    );
  } catch {
    return null;
  }
}

function integerBlockCenter(position: any) {
  if (![position?.x, position?.y, position?.z].every((value) => Number.isFinite(Number(value)))) {
    return null;
  }
  return new Vec3(
    Math.floor(Number(position.x)) + 0.5,
    Math.floor(Number(position.y)) + 0.5,
    Math.floor(Number(position.z)) + 0.5,
  );
}

function sameBlockPosition(a: any, b: any) {
  return (
    Math.floor(Number(a?.x)) === Math.floor(Number(b?.x)) &&
    Math.floor(Number(a?.y)) === Math.floor(Number(b?.y)) &&
    Math.floor(Number(a?.z)) === Math.floor(Number(b?.z))
  );
}

function pointInCurrentView(bot: Bot, target: Vec3) {
  const body = (bot as any).entity;
  const eye = eyePosition(bot);
  if (!eye) return false;
  const delta = target.minus(eye);
  const horizontalDistance = Math.hypot(delta.x, delta.z);
  const targetYaw = Math.atan2(-delta.x, -delta.z);
  const targetPitch = Math.atan2(delta.y, horizontalDistance);
  const relativeYaw = normalizeAngle(targetYaw - (finiteNumber(body?.yaw) ?? 0));
  const relativePitch = targetPitch - (finiteNumber(body?.pitch) ?? 0);
  return (
    Math.abs(relativeYaw) <= degreesToRadians(FIRST_PERSON_VISION.horizontalFovDegrees / 2) &&
    Math.abs(relativePitch) <= degreesToRadians(FIRST_PERSON_VISION.verticalFovDegrees / 2)
  );
}

function pointHasUnoccludedRay(bot: Bot, target: Vec3) {
  const eye = eyePosition(bot);
  const raycast = (bot as any).world?.raycast;
  if (!eye || typeof raycast !== 'function') return false;
  const delta = target.minus(eye);
  const distance = delta.norm();
  if (!Number.isFinite(distance) || distance <= 0.05) return true;
  try {
    return !raycast.call(
      (bot as any).world,
      eye,
      normalized(delta),
      distance - 0.05,
      visualOcclusionMatcher(),
    );
  } catch {
    return false;
  }
}

function entityIntersectsCurrentView(bot: Bot, entity: any) {
  const height = entityVisualHeight(entity);
  return [0.2, 0.55, 0.9].some((fraction) =>
    pointInCurrentView(bot, entity.position.offset(0, Math.max(0.1, height * fraction), 0)),
  );
}

function visualOcclusionMatcher(targetBlock?: any) {
  return (block: any, iterator?: any) => {
    const isTarget = targetBlock && sameBlockPosition(block?.position, targetBlock);
    if (!isTarget && block?.transparent === true) return false;
    if (!iterator?.intersect) return true;
    const intersection = iterator.intersect(block?.shapes || [], block?.position);
    if (!intersection) return false;
    block.face = intersection.face;
    block.intersect = intersection.pos;
    return true;
  };
}

function rayHitDistance(eye: Vec3, hit: any, fallback: number) {
  const point = hit?.intersect || hit?.position?.offset?.(0.5, 0.5, 0.5);
  const distance = point ? eye.distanceTo(point) : fallback;
  return Number.isFinite(distance) ? distance : fallback;
}

function rayEntityBoxDistance(eye: Vec3, direction: Vec3, entity: any, maxDistance: number) {
  const width = Math.max(0.1, finiteNumber(entity?.width) ?? 0.6);
  const height = Math.max(0.1, entityVisualHeight(entity));
  const halfWidth = width / 2;
  const min = {
    x: entity.position.x - halfWidth,
    y: entity.position.y,
    z: entity.position.z - halfWidth,
  };
  const max = {
    x: entity.position.x + halfWidth,
    y: entity.position.y + height,
    z: entity.position.z + halfWidth,
  };
  let entry = 0;
  let exit = maxDistance;
  for (const axis of ['x', 'y', 'z'] as const) {
    const origin = eye[axis];
    const component = direction[axis];
    if (Math.abs(component) < 1e-9) {
      if (origin < min[axis] || origin > max[axis]) return null;
      continue;
    }
    const first = (min[axis] - origin) / component;
    const second = (max[axis] - origin) / component;
    const near = Math.min(first, second);
    const far = Math.max(first, second);
    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    if (exit < entry) return null;
  }
  return entry >= 0 && entry <= maxDistance ? entry : null;
}

function eyePosition(bot: Bot): Vec3 | null {
  const body = (bot as any).entity;
  if (!body?.position) return null;
  const eyeHeight = finiteNumber(body.eyeHeight) ?? 1.62;
  return body.position.offset(0, eyeHeight, 0);
}

function entityVisualHeight(entity: any) {
  const explicit = finiteNumber(entity?.height);
  if (explicit != null && explicit > 0) return explicit;
  return isDroppedItemEntity(entity) ? 0.25 : 1.8;
}

function isDroppedItemEntity(entity: any) {
  return String(entity?.name || '').toLowerCase() === 'item' || !!entity?.getDroppedItem;
}

function viewDirection(pitch: number, yaw: number) {
  const cosPitch = Math.cos(pitch);
  return new Vec3(-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch);
}

function normalized(vector: Vec3) {
  const length = vector.norm();
  return length > 0 ? new Vec3(vector.x / length, vector.y / length, vector.z / length) : vector;
}

function sampleRatio(index: number, count: number) {
  return count <= 1 ? 0 : (index / (count - 1)) * 2 - 1;
}

function normalizeAngle(value: number) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function clampPitch(value: number) {
  return Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, value));
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function finiteNumber(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : n;
}
