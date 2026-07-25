import {
  projectCurrentModelObservation,
  projectHistoricalModelObservation,
} from './observation-context';

export const MINECRAFT_BODY_PROFILES = [
  'minecraft-resident-v1',
  'minecraft-human-semantic-v1',
] as const;
export type MinecraftBodyProfile = (typeof MINECRAFT_BODY_PROFILES)[number];

export const HUMAN_SEMANTIC_OBSERVATION_PROTOCOL =
  'behold.minecraft-human-semantic-observation.v1' as const;

const HUMAN_SEMANTIC_PROFILE = 'minecraft-human-semantic-v1' as const;

const OMITTED_SEMANTIC_KEYS = new Set([
  'id',
  'uuid',
  'managedRunId',
  'circleId',
  'worldId',
  'startedAt',
  'completedAt',
  'decidedAt',
  'observedAt',
  'updatedAt',
  'at',
  'position',
  'coordinates',
  'x',
  'y',
  'z',
  'yaw',
  'pitch',
  'velocity',
  'distance',
  'maxDistance',
  'remainingDistance',
  'requestedDistance',
  'bodyDisplacement',
  'progressDistance',
  'requestedDestination',
  'legDestination',
  'targetFeet',
  'startFeet',
  'finalFeet',
  'suggestedFeetPositions',
  'selectedRay',
  'ray',
  'nearest',
  'pickupGround',
  'support',
  'protectedBodyCells',
  'protectedCells',
  'entrances',
  'doorways',
  'navigation',
  'path',
  'pathfinderStopAcknowledged',
  'targetAdmission',
  'targetAtStart',
  'selectedTarget',
  'pickupRecovery',
  'adjacentBlocks',
  'openedBodyPassages',
  'alternatives',
  'beforeStateId',
  'afterStateId',
  'uses',
  'task',
  'controller',
  'controllerState',
  'evaluator',
  'evaluation',
  'permissions',
  'authority',
  'admission',
  'registry',
  'recipe',
  'world',
  'circle',
  'projects',
  'places',
  'placeConflicts',
  'currentAction',
]);

export function minecraftBodyProfile(value: unknown): MinecraftBodyProfile {
  const normalized = String(value || 'minecraft-resident-v1').trim();
  if (MINECRAFT_BODY_PROFILES.includes(normalized as MinecraftBodyProfile)) {
    return normalized as MinecraftBodyProfile;
  }
  throw new Error(
    `Unsupported Minecraft body profile ${JSON.stringify(value)}; expected ${MINECRAFT_BODY_PROFILES.join(' or ')}`,
  );
}

export function usesHumanSemanticBody(profile: MinecraftBodyProfile) {
  return profile === HUMAN_SEMANTIC_PROFILE;
}

export function projectMinecraftCurrentObservation(
  frame: any,
  profile: MinecraftBodyProfile,
  eventBatchLimit?: number,
) {
  const projected = projectCurrentModelObservation(frame, eventBatchLimit);
  return usesHumanSemanticBody(profile) ? projectHumanSemanticObservation(projected) : projected;
}

export function projectMinecraftHistoricalObservation(
  frame: any,
  previousFrame: any,
  previousSource: 'previous_turn_next_observation' | 'same_turn_observation',
  profile: MinecraftBodyProfile,
  eventBatchLimit?: number,
) {
  const projected = projectHistoricalModelObservation(
    frame,
    previousFrame,
    previousSource,
    eventBatchLimit,
  );
  return usesHumanSemanticBody(profile) ? projectHumanSemanticObservation(projected) : projected;
}

export function projectHumanSemanticObservation(frame: any) {
  if (!frame || typeof frame !== 'object') return frame;
  const self = frame.self && typeof frame.self === 'object' ? frame.self : null;
  const scene = frame.scene && typeof frame.scene === 'object' ? frame.scene : null;
  const projected: Record<string, any> = {
    protocol: HUMAN_SEMANTIC_OBSERVATION_PROTOCOL,
    bodyContract: {
      profile: HUMAN_SEMANTIC_PROFILE,
      modality: 'semantic-first-person',
      referenceScope: 'current-observation-only',
    },
    ...(Number.isSafeInteger(Number(frame.sequence)) ? { sequence: Number(frame.sequence) } : {}),
    ...(frame.eventWindow ? { eventWindow: projectHumanSemanticValue(frame.eventWindow) } : {}),
    ...(self ? { self: projectHumanSemanticSelf(self) } : {}),
    ...(scene ? { scene: projectHumanSemanticScene(scene) } : {}),
    ...(Array.isArray(frame.events)
      ? {
          events: frame.events.map((event: any) => ({
            sequence: finiteOrNull(event?.sequence),
            type: boundedText(event?.type, 96),
            salience: boundedText(event?.salience, 32),
            source: boundedText(event?.source, 32),
            isNew: event?.isNew === true,
            data: projectHumanSemanticValue(event?.data),
          })),
        }
      : {}),
    ...(frame.historicalProjection
      ? { historicalProjection: projectHumanSemanticValue(frame.historicalProjection) }
      : {}),
  };
  return projected;
}

export function projectHumanSemanticValue(value: any, depth = 0): any {
  if (value === undefined) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return projectSemanticString(value);
  if (depth >= 10) return '[detail omitted]';
  if (Array.isArray(value)) {
    return value.slice(0, 64).map((item) => projectHumanSemanticValue(item, depth + 1));
  }
  if (typeof value !== 'object') return boundedText(value, 400);
  const projected: Record<string, any> = {};
  const distance = finiteOrNull(value.distance);
  if (distance != null && value.proximity == null) projected.proximity = proximityBand(distance);
  for (const [key, item] of Object.entries(value)) {
    if (OMITTED_SEMANTIC_KEYS.has(key)) continue;
    const next = projectHumanSemanticValue(item, depth + 1);
    if (next !== undefined) projected[key] = next;
  }
  return projected;
}

function projectHumanSemanticSelf(self: any) {
  const condition = self.condition && typeof self.condition === 'object' ? self.condition : {};
  const pose = self.pose && typeof self.pose === 'object' ? self.pose : {};
  const oxygen = finiteOrNull(condition.oxygen);
  return {
    identity: boundedText(self.identity, 120),
    ...(self.body?.username ? { bodyUsername: boundedText(self.body.username, 64) } : {}),
    pose: {
      onGround: typeof pose.onGround === 'boolean' ? pose.onGround : null,
      motion: semanticMotion(pose),
    },
    condition: {
      health: finiteOrNull(condition.health),
      food: finiteOrNull(condition.food),
      breathBubbles: oxygen == null ? null : Math.max(0, Math.min(10, Math.ceil(oxygen / 2))),
      sleeping: typeof condition.sleeping === 'boolean' ? condition.sleeping : null,
      dimension: condition.dimension == null ? null : boundedText(condition.dimension, 64),
      daylight:
        typeof condition.isDay === 'boolean' ? (condition.isDay ? 'day' : 'night') : 'unknown',
    },
    heldItem: self.heldItem == null ? null : boundedText(self.heldItem, 120),
    inventory: Array.isArray(self.inventory)
      ? self.inventory.slice(0, 64).map((item: any) => ({
          name: boundedText(item?.name, 120),
          count: Math.max(0, Number(item?.count) || 0),
        }))
      : [],
  };
}

function projectHumanSemanticScene(scene: any) {
  const entities = Array.isArray(scene.entities) ? scene.entities : [];
  const terrain = scene.terrain && typeof scene.terrain === 'object' ? scene.terrain : {};
  const roster = Array.isArray(scene?.social?.playersOnline)
    ? scene.social.playersOnline.map((name: any) => boundedText(name, 64))
    : scene?.social?.playersOnline == null
      ? null
      : [];
  return {
    social: {
      playersOnline: roster,
      source: 'player-list-ui',
    },
    focus: projectHumanSemanticFocus(scene.focus),
    entities: entities.slice(0, 16).map((entity: any, index: number) => ({
      reference: `visible-entity-${index + 1}`,
      kind: boundedText(entity?.kind ?? entity?.type, 80),
      name: boundedText(entity?.name, 120),
      ...(entity?.heldItem == null ? {} : { heldItem: boundedText(entity.heldItem, 120) }),
      ...(entity?.count == null ? {} : { count: Math.max(0, Number(entity.count) || 0) }),
      proximity: semanticProximity(entity),
      relativeDirection: boundedText(entity?.relativeDirection, 40),
      visibility: 'visible',
    })),
    terrain: {
      source: 'semantic-first-person-rays',
      visualField: projectHumanSemanticVisualField(terrain.visualField),
      note: 'Egocentric semantic first-hit surfaces only; no coordinates, loaded geometry, support conclusion, or route information.',
    },
  };
}

function projectHumanSemanticFocus(focus: any) {
  if (!focus || typeof focus !== 'object') return null;
  return {
    reference: 'focus',
    kind: boundedText(focus.kind, 80),
    name: boundedText(focus.name, 120),
    source: 'crosshair',
    proximity: semanticProximity(focus),
    ...(focus.face == null ? {} : { face: boundedText(focus.face, 16) }),
  };
}

function projectHumanSemanticVisualField(field: any) {
  if (!field || typeof field !== 'object') return null;
  return {
    protocol: field.protocol,
    available: field.available === true,
    dimensions: projectHumanSemanticValue(field.dimensions),
    rowOrder: boundedText(field.rowOrder, 32),
    columnOrder: boundedText(field.columnOrder, 32),
    materialRows: boundedRows(field.materialRows),
    depthRows: boundedRows(field.depthRows),
    materialLegend: Array.isArray(field.materialLegend)
      ? field.materialLegend.slice(0, 64).map((entry: any) => ({
          symbol: boundedText(entry?.symbol, 4),
          name: boundedText(entry?.name, 120),
        }))
      : [],
    depthLegend: Array.isArray(field.depthLegend)
      ? field.depthLegend.slice(0, 16).map((entry: any) => ({
          symbol: boundedText(entry?.symbol, 4),
          label: boundedText(entry?.label, 80),
        }))
      : [],
    noHitSymbol: boundedText(field.noHitSymbol, 4),
    unavailableSymbol: boundedText(field.unavailableSymbol, 4),
    center: projectHumanSemanticValue(field.center),
  };
}

function semanticMotion(pose: any) {
  const velocity = pose?.velocity;
  const x = Number(velocity?.x);
  const y = Number(velocity?.y);
  const z = Number(velocity?.z);
  if (![x, y, z].every(Number.isFinite)) return 'unknown';
  if (y < -0.08) return 'falling';
  if (y > 0.08) return 'rising';
  return Math.hypot(x, z) >= 0.03 ? 'moving' : 'still';
}

function semanticProximity(value: any) {
  if (['interaction', 'nearby', 'distant'].includes(String(value?.proximity || ''))) {
    return String(value.proximity);
  }
  const distance = finiteOrNull(value?.distance);
  return distance == null ? 'unknown' : proximityBand(distance);
}

function proximityBand(distance: number) {
  if (distance <= 4) return 'interaction';
  if (distance <= 12) return 'nearby';
  return 'distant';
}

function projectSemanticString(value: string) {
  const text = boundedText(value, 2_000);
  if (/^block:[^:]+:-?\d+:-?\d+:-?\d+$/.test(text)) return 'focused-block';
  if (/^entity:\d+$/.test(text)) return 'visible-entity';
  if (/^minecraft:[^:]+:-?\d+:-?\d+:-?\d+$/.test(text)) return 'focused-block';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    return 'private-body-identifier-omitted';
  }
  return text;
}

function boundedRows(value: any) {
  return Array.isArray(value) ? value.slice(0, 16).map((row) => boundedText(row, 64)) : [];
}

function boundedText(value: any, limit: number) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function finiteOrNull(value: any) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
