import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { minecraftOxygenLevel } from './condition';
import { declaredNonResidentAudience, type ActionAudience } from './action-audience';
import { goals } from 'mineflayer-pathfinder';
import mcDataLoader from 'minecraft-data';
import {
  blockAtViewCursor,
  droppedItemPickupGround,
  entityAtViewCursor,
  onlinePlayerNames,
} from './observation';
import { surveyArea } from '../skills/survey';
import {
  MANAGE_PROJECT_TOOL,
  RESIDENT_PROJECT_EVIDENCE_VALUES,
  type ProjectMemory,
} from '../entity/projects';
import type { InhabitantPlace } from '../entity/places';
import type {
  BlockPosition,
  WorldChangeEvidence,
  WorldChangeExecutor,
} from '../safety/world-change';

const CARDINAL_DIRECTIONS: Record<string, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

export type CommandSpec = {
  name: string;
  description: string;
  parameters: any; // JSON Schema
  run: (args: any, execution?: CommandExecution) => Promise<any>;
  category?: string;
  audience?: ActionAudience;
  effects?: CommandEffects;
};

export type CommandExecution = Readonly<{
  signal?: AbortSignal;
}>;

export type CommandEffects = Readonly<{
  blockMutation?: 'dig' | 'place' | 'state' | 'multiple';
}>;

type InterpreterOptions = {
  worldChangeExecutor?: WorldChangeExecutor | null;
  changeConfirmationTimeoutMs?: number;
  changeStabilityWindowMs?: number;
  worldCommandTimeoutMs?: number;
  projects?: ProjectMemory;
  places?: () => InhabitantPlace[];
  observe?: () => any;
  moveLegDistance?: number;
  moveTimeoutMs?: number;
  approachDistance?: number;
  approachPursuitDistance?: number;
  approachTimeoutMs?: number;
  pickupPursuitDistance?: number;
  pickupTimeoutMs?: number;
  fightPursuitDistance?: number;
  fightTimeoutMs?: number;
};

export function buildInterpreter(bot: Bot, opts: InterpreterOptions = {}) {
  const specs: CommandSpec[] = [];
  const add = (s: CommandSpec) => {
    const declared = declaredNonResidentAudience(s.name);
    if ((s.audience ?? null) !== declared) {
      throw new Error(`action audience registry disagrees for ${s.name}`);
    }
    specs.push(s);
  };

  if (opts.projects) {
    add({
      name: MANAGE_PROJECT_TOOL,
      description:
        "Start, update, complete, or abandon one sparse, restart-worthy project. Do not wrap one-step actions such as local walking, inspection, one-stack storage, equipping, or cleanup in a project; act directly instead. A project normally needs several meaningful actions and names a durable capability or commitment such as a crafted tool, shelter, stocked survival kit, distant journey, or shared build. Resolve legacy overlap before updating. A new or repaired project must name both a future doneWhen condition and one player-observable Minecraft evidence channel. Completion records the inhabitant's grounded conclusion after a matching post-start witness; it does not certify arbitrary world truth, which external evaluation may judge separately.",
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['start', 'update', 'complete', 'abandon'] },
          id: { type: 'string', description: 'Stable short project identifier' },
          title: { type: 'string', description: 'Required when starting; optional when updating' },
          nextStep: {
            type: 'string',
            description: 'Required when starting or updating; one concrete next world step',
          },
          doneWhen: {
            type: 'string',
            description:
              'Required when starting and when repairing an older undefined project; a concrete future condition that is not already true',
          },
          evidence: {
            type: 'string',
            enum: RESIDENT_PROJECT_EVIDENCE_VALUES,
            description:
              'Required when starting and when repairing an older undefined project; the future player-observable Minecraft consequence grounding the inhabitant conclusion. Use world_change for construction. time_elapsed requires a named future boundary such as dawn, nightfall, or a duration; social_event must advance an existing relationship, not wait for an assignment.',
          },
        },
        required: ['operation', 'id'],
      },
      run: async (input) => opts.projects!.propose(input, opts.observe?.()),
      category: 'self',
    });
  }

  // chat/say
  add({
    name: 'chat',
    description:
      'Send one short public chat message when communication advances an active interaction; speaking does not replace acting in the world.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: async ({ text }) => {
      const playersOnline = onlinePlayerNames(bot);
      if (playersOnline && playersOnline.length === 0) {
        return { ok: false, error: 'no_other_players_online', playersOnline };
      }
      const message = minecraftChat(text);
      if (!message) return { ok: false, error: 'empty_message' };
      (bot as any).chat(message);
      return { ok: true, message };
    },
    category: 'chat',
  });

  add({
    name: 'whisper',
    description: 'Whisper a player using /tell',
    parameters: {
      type: 'object',
      properties: { username: { type: 'string' }, text: { type: 'string' } },
      required: ['username', 'text'],
    },
    run: async ({ username, text }) => {
      const playersOnline = onlinePlayerNames(bot);
      if (
        playersOnline &&
        !playersOnline.some((player) => player.toLowerCase() === String(username).toLowerCase())
      ) {
        return {
          ok: false,
          error: 'player_not_online',
          username: String(username),
          playersOnline,
        };
      }
      const message = minecraftChat(text);
      if (!message) return { ok: false, error: 'empty_message' };
      (bot as any).whisper(String(username), message);
      return { ok: true, message };
    },
    category: 'chat',
  });

  // look
  add({
    name: 'look_at',
    description: 'Rotate to face a world position',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        force: { type: 'boolean' },
      },
      required: ['x', 'y', 'z'],
    },
    run: async ({ x, y, z, force = false }) => {
      await (bot as any).lookAt(new Vec3(x, y, z), !!force);
      return { ok: true };
    },
    category: 'view',
  });

  add({
    name: 'look_direction',
    description:
      'Turn your first-person view in one ordinary glance. Choose a horizontal turn relative to where you face and a vertical band at the same time. This changes only your view, never your position or the world.',
    parameters: {
      type: 'object',
      properties: {
        horizontal: {
          type: 'string',
          enum: ['same', 'left', 'right', 'around'],
          description: 'Keep facing the same way or turn left, right, or around.',
        },
        vertical: {
          type: 'string',
          enum: ['same', 'up', 'level', 'down'],
          description: 'Keep the current tilt or look in the up, level, or down band.',
        },
      },
      required: ['horizontal', 'vertical'],
    },
    run: async ({ horizontal, vertical }) => {
      const body = (bot as any).entity;
      const yaw = body?.yaw == null ? null : finiteNumber(body.yaw);
      const pitch = body?.pitch == null ? null : finiteNumber(body.pitch);
      if (yaw == null || pitch == null || typeof (bot as any).look !== 'function') {
        return { ok: false, error: 'body_orientation_unavailable' };
      }
      const requested = {
        horizontal: String(horizontal || ''),
        vertical: String(vertical || ''),
      };
      if (!['same', 'left', 'right', 'around'].includes(requested.horizontal)) {
        return { ok: false, error: 'unknown_horizontal_look_direction', ...requested };
      }
      if (!['same', 'up', 'level', 'down'].includes(requested.vertical)) {
        return { ok: false, error: 'unknown_vertical_look_direction', ...requested };
      }
      if (requested.horizontal === 'same' && requested.vertical === 'same') {
        return { ok: false, error: 'look_direction_unchanged', ...requested };
      }
      const horizontalTurns: Record<string, number> = {
        left: Math.PI / 2,
        right: -Math.PI / 2,
        around: Math.PI,
      };
      const verticalBands: Record<string, number> = {
        up: Math.PI / 6,
        level: 0,
        down: -Math.PI / 6,
      };
      const targetYaw = normalizeYaw(yaw + (horizontalTurns[requested.horizontal] ?? 0));
      const targetPitch = clamp(
        verticalBands[requested.vertical] ?? pitch,
        -Math.PI / 2 + 0.001,
        Math.PI / 2 - 0.001,
      );
      await (bot as any).look(targetYaw, targetPitch, false);
      const finalYaw = finiteNumber(body?.yaw);
      const finalPitch = finiteNumber(body?.pitch);
      if (
        finalYaw == null ||
        finalPitch == null ||
        Math.abs(normalizeYaw(finalYaw - targetYaw)) > 0.02 ||
        Math.abs(finalPitch - targetPitch) > 0.02
      ) {
        return {
          ok: false,
          error: 'body_orientation_unconfirmed',
          ...requested,
          requested: orientationRecord(targetYaw, targetPitch),
          observed:
            finalYaw == null || finalPitch == null ? null : orientationRecord(finalYaw, finalPitch),
        };
      }
      return {
        ok: true,
        ...requested,
        from: orientationRecord(yaw, pitch),
        orientation: orientationRecord(finalYaw, finalPitch),
        confirmation: 'mineflayer:body_orientation',
      };
    },
    category: 'view',
  });

  add({
    name: 'face_visible_target',
    description:
      'Turn your current first-person view toward one exact block surface already present in scene.terrain.targets. This only orients the body; it does not search loaded terrain, approach, use, break, place, or infer what the target affords.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Exact current vision target id from scene.terrain.targets',
        },
        expectedName: {
          type: 'string',
          description: 'Current visible block name paired with the selected target',
        },
      },
      required: ['target', 'expectedName'],
    },
    run: async ({ target, expectedName }, execution) => {
      if (execution?.signal?.aborted) return cancelledAction('visible-target-orientation');
      const observation = opts.observe?.();
      if (!observation) return { ok: false, error: 'current_observation_unavailable' };
      const selected = currentVisibleBlockTarget(observation, String(target || ''));
      if (!selected) {
        return {
          ok: false,
          error: 'visible_target_not_current',
          target: String(target || ''),
        };
      }
      if (selected.name !== String(expectedName || '')) {
        return {
          ok: false,
          error: 'visible_target_identity_changed',
          target: selected.id,
          expectedName: String(expectedName || ''),
          observedName: selected.name,
        };
      }
      if (typeof (bot as any).lookAt !== 'function') {
        return { ok: false, error: 'body_orientation_unavailable', target: selected.id };
      }
      const position = selected.position;
      await (bot as any).lookAt(
        new Vec3(Number(position.x) + 0.5, Number(position.y) + 0.5, Number(position.z) + 0.5),
        true,
      );
      if (execution?.signal?.aborted) return cancelledAction('visible-target-orientation');
      const maximumDistance = Math.max(
        6,
        Math.min(24, Number(observation?.scene?.terrain?.maxDistance) || 24),
      );
      const focused = blockAtViewCursor(bot, maximumDistance);
      if (
        !focused?.position ||
        !sameBlockPosition(focused.position, position) ||
        String(focused.name || '') !== selected.name
      ) {
        return {
          ok: false,
          error: 'visible_target_not_focused_after_turn',
          target: selected.id,
          expectedName: selected.name,
          observed: focused?.position
            ? {
                name: String(focused.name || 'unknown'),
                position: {
                  x: focused.position.x,
                  y: focused.position.y,
                  z: focused.position.z,
                },
              }
            : null,
        };
      }
      return {
        ok: true,
        target: {
          id: selected.id,
          name: selected.name,
          position: { ...position },
          source: 'vision',
          selectedRay: selected.ray,
        },
        confirmation: 'mineflayer:cursor_block',
      };
    },
    category: 'view',
  });

  add({
    name: 'look',
    description: 'Set yaw/pitch directly (radians)',
    parameters: {
      type: 'object',
      properties: {
        yaw: { type: 'number' },
        pitch: { type: 'number' },
        force: { type: 'boolean' },
      },
      required: ['yaw', 'pitch'],
    },
    run: async ({ yaw, pitch, force = false }) => {
      await (bot as any).look(Number(yaw), Number(pitch), !!force);
      return { ok: true };
    },
    category: 'view',
    audience: 'operator',
  });

  // movement
  add({
    name: 'set_control',
    description: 'Set a control state (forward, back, left, right, jump, sprint, sneak)',
    parameters: {
      type: 'object',
      properties: { control: { type: 'string' }, state: { type: 'boolean' } },
      required: ['control', 'state'],
    },
    run: async ({ control, state }) => {
      (bot as any).setControlState(String(control), !!state);
      return { ok: true };
    },
    category: 'move',
    audience: 'operator',
  });

  add({
    name: 'clear_controls',
    description: 'Clear all movement control states',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      (bot as any).clearControlStates?.();
      return { ok: true };
    },
    category: 'move',
    audience: 'operator',
  });

  add({
    name: 'move_to',
    description:
      'Walk to a feet position and return only after an observed body result. This is one bounded walking leg, not teleportation. If the body already satisfies the requested range, the result says no movement occurred instead of claiming progress. A block coordinate is a solid interaction target, not a feet destination; use dig_block for a block you want to mine.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        near: { type: 'number' },
      },
      required: ['x', 'y', 'z'],
    },
    run: async ({ x, y, z, near = 0 }, execution) => {
      const pathfinder = (bot as any).pathfinder;
      if (!pathfinder) return { ok: false, error: 'pathfinder_unavailable' };
      const requestedDestination = { x: Number(x), y: Number(y), z: Number(z) };
      const requestedNear = Math.max(0, Number(near) || 0);
      const start = positionOf(bot);
      const travelLimit = clamp(Number(opts.moveLegDistance ?? 12), 2, 16);
      const requestedDistance = start ? distance(start, requestedDestination) : null;
      const shouldAdvance =
        requestedDistance != null && requestedDistance > requestedNear + travelLimit;
      const ratio =
        shouldAdvance && requestedDistance != null ? travelLimit / requestedDistance : 1;
      const destination =
        shouldAdvance && start
          ? {
              x: start.x + (requestedDestination.x - start.x) * ratio,
              y: start.y + (requestedDestination.y - start.y) * ratio,
              z: start.z + (requestedDestination.z - start.z) * ratio,
            }
          : requestedDestination;
      const effectiveNear = shouldAdvance ? 1 : requestedNear;
      const goal =
        effectiveNear > 0
          ? new (goals as any).GoalNear(destination.x, destination.y, destination.z, effectiveNear)
          : new (goals as any).GoalBlock(destination.x, destination.y, destination.z);
      const bodyStartedWithinLegGoal =
        start != null &&
        Boolean(
          goal.isEnd?.({
            x: Math.floor(start.x),
            y: Math.floor(start.y),
            z: Math.floor(start.z),
          }),
        );
      const result = await runPathfinderGoal(bot, goal, {
        destination,
        near: effectiveNear,
        timeoutMs: clamp(Number(opts.moveTimeoutMs ?? 45_000), 1000, 120_000),
        signal: execution?.signal,
      });
      const final = positionOf(bot);
      const remainingDistance = final ? distance(final, requestedDestination) : null;
      const bodyDisplacement = start && final ? distance(start, final) : null;
      const bodyMoved = bodyDisplacement != null && bodyDisplacement >= 0.1;
      const unfulfilledNoMotion = result.ok && !bodyMoved && !bodyStartedWithinLegGoal;
      const progressDistance =
        requestedDistance != null && remainingDistance != null
          ? Math.max(0, requestedDistance - remainingDistance)
          : null;
      const arrivedAtRequestedDestination =
        result.ok &&
        !unfulfilledNoMotion &&
        remainingDistance != null &&
        remainingDistance <= requestedNear + 0.75;
      return {
        ...result,
        ...(unfulfilledNoMotion
          ? {
              ok: false,
              status: 'no_body_movement',
              error: 'body_not_moved',
            }
          : result.ok
            ? {
                status: !bodyMoved
                  ? 'already_within_requested_range'
                  : arrivedAtRequestedDestination
                    ? 'arrived'
                    : 'advanced_toward',
              }
            : {}),
        requestedDestination,
        requestedNear,
        bodyLegLimit: travelLimit,
        legDestination: destination,
        bodyStartedWithinLegGoal,
        remainingDistance,
        bodyMoved,
        bodyDisplacement,
        progressDistance,
        arrivedAtRequestedDestination,
      };
    },
    category: 'move',
  });

  add({
    name: 'move_direction',
    description:
      'Walk a short distance relative to your current first-person view. Choose forward, back, left, or right and optionally a distance from 1 to 8 blocks. Use this for local exploration; use move_to for a known world position or remembered place. The body may perform ordinary path corrections but never digs or places, and returns only after confirmed arrival or a legible failure.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['forward', 'back', 'left', 'right'],
        },
        distance: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: 'Short walking distance in Minecraft blocks; defaults to 4.',
        },
      },
      required: ['direction'],
    },
    run: async ({ direction, distance: requestedDistance = 4 }, execution) => {
      const body = (bot as any).entity;
      const yaw = body?.yaw == null ? null : finiteNumber(body.yaw);
      const pitch = body?.pitch == null ? 0 : finiteNumber(body.pitch);
      const start = positionOf(bot);
      if (yaw == null || pitch == null || !start) {
        return { ok: false, error: 'body_orientation_unavailable' };
      }
      const requested = String(direction || '');
      const vector = relativeHorizontalDirection(yaw, requested);
      if (!vector) {
        return { ok: false, error: 'unknown_move_direction', direction: requested };
      }
      const pathfinder = (bot as any).pathfinder;
      if (!pathfinder) return { ok: false, error: 'pathfinder_unavailable' };
      const distanceValue = finiteNumber(requestedDistance);
      const distanceBlocks = clamp(Math.round(distanceValue ?? 4), 1, 8);
      const intendedPosition = {
        x: start.x + vector.x * distanceBlocks,
        y: start.y,
        z: start.z + vector.z * distanceBlocks,
      };
      const intendedFeet = {
        x: Math.floor(intendedPosition.x),
        y: Math.floor(start.y),
        z: Math.floor(intendedPosition.z),
      };
      const immediatePath = relativeMovementEvidence(bot, start, vector);
      if (immediatePath.issue !== 'immediate_path_clear') {
        return {
          ok: false,
          error: 'immediate_direction_unavailable',
          direction: requested,
          distanceBlocks,
          orientationAtStart: orientationRecord(yaw, pitch),
          intendedFeet,
          obstruction: immediatePath,
        };
      }
      const configuredTimeout = clamp(Number(opts.moveTimeoutMs ?? 45_000), 1000, 120_000);
      const bodyTimeLimitMs = Math.min(configuredTimeout, 2_500 + distanceBlocks * 1_000);
      const navigation = await runPathfinderGoal(
        bot,
        new (goals as any).GoalNear(intendedFeet.x, intendedFeet.y, intendedFeet.z, 0),
        {
          destination: intendedPosition,
          near: 0,
          timeoutMs: bodyTimeLimitMs,
          target: `${requested} relative walk`,
          signal: execution?.signal,
          movementEnvelope: {
            maxHorizontalFromStart: distanceBlocks + 2,
            maxVerticalFromStart: 3,
          },
        },
      );
      const final = positionOf(bot);
      const finalFeet = (bot as any).entity?.position?.floored?.();
      const bodyDisplacement = final ? distance(start, final) : null;
      const bodyMoved = bodyDisplacement != null && bodyDisplacement >= 0.1;
      const displacement = final
        ? {
            forward: round((final.x - start.x) * vector.x + (final.z - start.z) * vector.z),
            lateral: round((final.x - start.x) * -vector.z + (final.z - start.z) * vector.x),
            vertical: round(final.y - start.y),
          }
        : null;
      return {
        ...navigation,
        ...(navigation.ok && !bodyMoved
          ? {
              ok: false,
              status: 'no_body_movement',
              error: 'body_not_moved',
            }
          : {}),
        direction: requested,
        distanceBlocks,
        bodyTimeLimitMs,
        orientationAtStart: orientationRecord(yaw, pitch),
        intendedFeet,
        finalFeet: finalFeet ? { x: finalFeet.x, y: finalFeet.y, z: finalFeet.z } : null,
        bodyMoved,
        bodyDisplacement,
        displacement,
        ...(navigation.ok && bodyMoved ? {} : { obstruction: immediatePath }),
      };
    },
    category: 'move',
  });

  add({
    name: 'approach_entity',
    description:
      'Approach one particular nearby entity or player from scene.entities. Choose its exact observed id; this body owns pursuit, conversational distance, timing, and arrival evidence.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Exact id from scene.entities, such as player:importdf or entity:71',
        },
      },
      required: ['target'],
    },
    run: async ({ target: requestedTarget }, execution) => {
      const pathfinder = (bot as any).pathfinder;
      if (!pathfinder) return { ok: false, error: 'pathfinder_unavailable' };
      const targetReference = String(requestedTarget || '');
      const target = observedSceneEntity(bot, targetReference);
      if (!target?.position) {
        return { ok: false, error: 'target_not_perceived', target: targetReference };
      }
      if (isDroppedItem(target)) {
        return {
          ok: false,
          error: 'target_is_dropped_item',
          target: targetReference,
          reason:
            'Dropped items must be approached through collect_nearby_item so destination support and collection evidence are checked.',
        };
      }
      return runBoundedApproach(bot, target, {
        targetReference,
        targetAtStart: summarizeEntity(target),
        isTargetPerceived: () => sceneCurrentlyPerceives(targetReference),
        stopDistance: clamp(Number(opts.approachDistance ?? 2.5), 1, 12),
        maxDistance: clamp(Number(opts.approachPursuitDistance ?? 16), 1, 32),
        timeoutMs: clamp(Number(opts.approachTimeoutMs ?? 45_000), 1000, 120_000),
        signal: execution?.signal,
      });
    },
    category: 'move',
  });

  add({
    name: 'attack_entity',
    description:
      'Fight one particular nearby creature from scene.entities. Choose its exact observed id; this body owns bounded pursuit, facing, legal attack timing, and the terminal result.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Exact id from scene.entities, such as entity:71',
        },
      },
      required: ['target'],
    },
    run: async ({ target: requestedTarget }, execution) => {
      const targetReference = String(requestedTarget || '');
      const me = (bot as any).entity?.position;
      const pursuitLimit = clamp(Number(opts.fightPursuitDistance ?? 16), 1, 16);
      const selectedTarget = observedSceneEntity(bot, targetReference);
      if (!selectedTarget) {
        return { ok: false, error: 'target_not_perceived', target: targetReference };
      }
      const startedDistance = me?.distanceTo(selectedTarget.position) ?? Infinity;
      if (startedDistance > pursuitLimit) {
        return {
          ok: false,
          error: 'target_not_in_reach',
          target: targetReference,
          distance: round(startedDistance),
          pursuitLimit,
        };
      }

      return runBoundedFight(bot, selectedTarget, {
        targetReference,
        targetAtStart: summarizeEntity(selectedTarget),
        isTargetPerceived: () => sceneCurrentlyPerceives(targetReference),
        startedDistance,
        maxDistance: pursuitLimit,
        timeoutMs: clamp(Number(opts.fightTimeoutMs ?? 15_000), 100, 30_000),
        signal: execution?.signal,
      });
    },
    category: 'combat',
  });

  add({
    name: 'collect_nearby_item',
    description:
      'Pick up one particular nearby dropped item stack from scene.entities. Choose its exact observed id; this body owns pursuit and timing. Succeed only when Minecraft attributes that exact pickup to this body.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Exact dropped-item id from scene.entities, such as entity:84',
        },
      },
      required: ['target'],
    },
    run: async ({ target: requestedTarget }, execution) => {
      const pathfinder = (bot as any).pathfinder;
      if (!pathfinder) return { ok: false, error: 'pathfinder_unavailable' };
      const targetReference = String(requestedTarget || '');
      const entity = observedSceneEntity(bot, targetReference);
      if (!entity?.position) {
        return { ok: false, error: 'target_not_perceived', target: targetReference };
      }
      if (!isDroppedItem(entity)) {
        return { ok: false, error: 'target_not_dropped_item', target: targetReference };
      }
      const me = (bot as any).entity?.position;
      const target = {
        entity,
        item: droppedItemName(entity),
        distance: me?.distanceTo(entity.position) ?? Infinity,
      };
      const targetAtStart = summarizeEntity(entity);
      const pursuitLimit = clamp(Number(opts.pickupPursuitDistance ?? 16), 1, 32);
      if (target.distance > pursuitLimit) {
        return {
          ok: false,
          error: 'target_not_in_reach',
          target: targetReference,
          distance: round(target.distance),
          pursuitLimit,
        };
      }

      const pickupGround = droppedItemPickupGround(bot, target.entity.position);
      if (pickupGround.status !== 'supported') {
        return {
          ok: false,
          error: 'unapproachable_item_ground',
          target: targetReference,
          item: target.item,
          distance: round(target.distance),
          pickupGround,
          reason:
            'The dropped stack is over unsupported or hazardous ground. Do not pathfind or nudge into it.',
        };
      }

      const watcher = observeCollection(bot, target.entity.id);
      const destination = {
        x: target.entity.position.x,
        y: Math.floor(target.entity.position.y) + 1,
        z: target.entity.position.z,
      };
      const navigation = await runPathfinderGoal(
        bot,
        // GoalNear floors coordinates before applying its integer radius. At
        // an adjacent block it can report arrival while the item's true
        // position is still outside Minecraft's pickup reach. Occupy the
        // item stack's feet block instead.
        new (goals as any).GoalBlock(destination.x, destination.y, destination.z),
        {
          destination,
          near: 0,
          timeoutMs: clamp(Number(opts.pickupTimeoutMs ?? 45_000), 1000, 120_000),
          target: target.item,
          signal: execution?.signal,
        },
      );
      let collected = await watcher.wait(navigation.ok ? 400 : 100);
      let pickupRecovery: any = null;
      if (!collected) {
        pickupRecovery = sceneCurrentlyPerceives(targetReference)
          ? await boundedPickupNudge(bot, target.entity, watcher, 2000)
          : {
              attempted: false,
              collected: false,
              reason: 'target_not_perceived_at_recovery',
            };
        collected = pickupRecovery.collected;
      }
      watcher.close();
      return {
        ok: collected,
        ...(collected ? {} : { error: 'collection_unconfirmed' }),
        target: targetReference,
        targetEntityId: target.entity.id,
        targetAtStart,
        item: target.item,
        navigation,
        pickupRecovery,
        confirmation: collected ? 'mineflayer:playerCollect' : null,
      };
    },
    category: 'inventory',
  });

  add({
    name: 'drop_item',
    description:
      "Drop an owned inventory item into the Minecraft world. This confirms only the dropping body's inventory change; another being must independently choose and confirm any pickup.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number', minimum: 1, maximum: 64 },
      },
      required: ['name'],
    },
    run: async ({ name, count = 1 }) => {
      const query = normalizeRegistryName(String(name));
      const item = ((bot as any).inventory?.items?.() || []).find((candidate: any) =>
        normalizeRegistryName(String(candidate?.name || '')).includes(query),
      );
      if (!item) {
        return {
          ok: false,
          error: 'item_not_in_inventory',
          requested: String(name),
          inventory: inventorySnapshot(bot),
        };
      }
      const dropCount = Math.min(
        Math.max(1, Math.floor(Number(count) || 1)),
        Math.max(1, Number(item.count) || 1),
      );
      const before = inventoryCount(bot, String(item.name));
      await (bot as any).toss(item.type, item.metadata ?? null, dropCount);
      const after = inventoryCount(bot, String(item.name));
      const inventoryRemoved = Math.max(0, before - after);
      const confirmed = inventoryRemoved === dropCount;
      return {
        ok: confirmed,
        ...(confirmed ? {} : { error: 'drop_unconfirmed' }),
        item: String(item.name),
        count: dropCount,
        inventoryRemoved,
        confirmation: confirmed ? 'mineflayer:inventory_delta' : null,
      };
    },
    category: 'inventory',
  });

  add({
    name: 'stop',
    description: 'Stop pathfinding, digging, and manual movement',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      (bot as any).pathfinder?.stop?.();
      (bot as any).stopDigging?.();
      (bot as any).clearControlStates?.();
      return { ok: true };
    },
    category: 'move',
  });

  // dig/place
  add({
    name: 'dig_block',
    description:
      'Break or mine one solid block. The body first walks within survival reach and faces it, then succeeds only after Minecraft confirms the block changed.',
    parameters: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
      required: ['x', 'y', 'z'],
    },
    run: async ({ x, y, z }, execution) => {
      let b = (bot as any).blockAt(new Vec3(x, y, z));
      if (!b) return { ok: false, error: 'no_block' };
      const position = { x: b.position.x, y: b.position.y, z: b.position.z };
      if (isAirBlock(b)) {
        return { ok: false, error: 'no_solid_block', block: summarizeBlock(b), position };
      }
      const me = (bot as any).entity?.position;
      const unsafeDig = digPositionIssue(bot, position);
      if (unsafeDig === 'supporting_body') {
        return {
          ok: false,
          error: 'refusing_to_dig_supporting_block',
          position,
          reason:
            'Dig from the side or make a staircase; do not mine the block directly under your body.',
        };
      }
      if (unsafeDig === 'below_support_plane') {
        return {
          ok: false,
          error: 'refusing_unsafe_downward_dig',
          position,
          reason:
            'This target is below the current support plane. Mine from an exposed side at your level; a safe descent needs an explicit staircase affordance.',
        };
      }
      const distanceBefore = me?.distanceTo?.(b.position) ?? null;
      if (distanceBefore != null && distanceBefore > 16) {
        return {
          ok: false,
          error: 'dig_target_not_local',
          block: summarizeBlock(b),
          distance: round(distanceBefore),
          reason: 'Move into the area intentionally, observe it again, then choose a local block.',
        };
      }
      const visible =
        typeof (bot as any).canSeeBlock === 'function' ? !!(bot as any).canSeeBlock(b) : null;
      let navigation: any = null;
      if ((distanceBefore != null && distanceBefore > 4.5) || visible === false) {
        if (!(bot as any).pathfinder || !(bot as any).world) {
          return {
            ok: false,
            error: 'dig_target_out_of_reach',
            block: summarizeBlock(b),
            distance: distanceBefore == null ? null : round(distanceBefore),
          };
        }
        navigation = await runPathfinderGoal(
          bot,
          new (goals as any).GoalLookAtBlock(b.position, (bot as any).world, { reach: 4.5 }),
          {
            destination: position,
            near: 4.5,
            timeoutMs: 45_000,
            target: String(b.name || 'block'),
            signal: execution?.signal,
          },
        );
        if (!navigation.ok) {
          if (navigation.error === 'interrupted_by_human') {
            return { ...navigation, position, phase: 'placement_reposition' };
          }
          return {
            ok: false,
            error: 'dig_target_unreachable',
            block: summarizeBlock(b),
            navigation,
          };
        }
        b = (bot as any).blockAt(new Vec3(position.x, position.y, position.z));
        if (!b || String(b.name || '').endsWith('air')) {
          return {
            ok: false,
            error: 'dig_target_changed_before_action',
            position,
            navigation,
          };
        }
      }
      const result = await executeConfirmedWorldChange({
        bot,
        guard: opts.worldChangeExecutor,
        verb: 'dig',
        position,
        beforeBlock: b,
        timeoutMs: opts.changeConfirmationTimeoutMs,
        stabilityWindowMs: opts.changeStabilityWindowMs,
        commandTimeoutMs: opts.worldCommandTimeoutMs,
        perform: () => (bot as any).dig(b),
        signal: execution?.signal,
      });
      const adjacentBlocks = result.ok ? adjacentSolidBlocks(bot, position) : [];
      return {
        ...result,
        navigation,
        ...(result.ok
          ? {
              adjacentBlocks,
              nextAffordance:
                adjacentBlocks.length > 0
                  ? 'Choose an adjacent exposed block to inspect or mine next.'
                  : 'The removed block exposed no adjacent solid continuation.',
            }
          : {}),
      };
    },
    category: 'world',
    effects: { blockMutation: 'dig' },
  });

  add({
    name: 'stop_digging',
    description: 'Abort current digging',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      (bot as any).stopDigging?.();
      return { ok: true };
    },
    category: 'world',
    audience: 'operator',
  });

  add({
    name: 'descend_step',
    description:
      'Excavate and enter one safe descending staircase step in a cardinal direction. This verifies solid support below the destination, clears only the adjacent feet/head cells through confirmed Minecraft digs, then confirms arrival one level lower. Repeat deliberately for a staircase; never dig straight below your body.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 120000 },
      },
      required: ['direction'],
    },
    run: async ({ direction, timeoutMs = 30_000 }) => {
      const vector = CARDINAL_DIRECTIONS[String(direction).toLowerCase()];
      if (!vector) return { ok: false, error: 'invalid_stair_direction' };
      const start = (bot as any).entity?.position?.floored?.();
      if (!start) return { ok: false, error: 'bot_not_spawned' };
      const targetFeet = {
        x: start.x + vector.x,
        y: start.y - 1,
        z: start.z + vector.z,
      };
      const targetHead = { ...targetFeet, y: targetFeet.y + 1 };
      const supportPosition = { ...targetFeet, y: targetFeet.y - 1 };
      const support = (bot as any).blockAt?.(
        new Vec3(supportPosition.x, supportPosition.y, supportPosition.z),
      );
      if (!safeStairSupport(support)) {
        return {
          ok: false,
          error: 'stair_step_unsupported',
          direction: String(direction),
          targetFeet,
          support: summarizeBlock(support),
          reason: 'A descending step needs a solid non-hazardous block beneath the destination.',
          alternatives: describeDescentOptions(bot, start),
        };
      }

      const clearance = [
        {
          role: 'head',
          position: targetHead,
          block: (bot as any).blockAt?.(new Vec3(targetHead.x, targetHead.y, targetHead.z)),
        },
        {
          role: 'feet',
          position: targetFeet,
          block: (bot as any).blockAt?.(new Vec3(targetFeet.x, targetFeet.y, targetFeet.z)),
        },
      ];
      const unsafeClearance = clearance
        .map((cell) => ({ ...cell, issue: stairClearanceIssue(cell.block) }))
        .find((cell) => cell.issue != null);
      if (unsafeClearance) {
        return {
          ok: false,
          error: unsafeClearance.issue === 'fluid' ? 'stair_step_flooded' : 'stair_step_obstructed',
          direction: String(direction),
          targetFeet,
          obstruction: {
            role: unsafeClearance.role,
            issue: unsafeClearance.issue,
            block: summarizeBlock(unsafeClearance.block),
          },
          reason:
            unsafeClearance.issue === 'fluid'
              ? 'The proposed stair opens into water or lava; choose a dry direction or relocate before excavating.'
              : 'The proposed stair contains an unloaded, hazardous, or unbreakable cell.',
          alternatives: describeDescentOptions(bot, start),
        };
      }

      const changes: any[] = [];
      for (const { position } of clearance) {
        const block = (bot as any).blockAt?.(new Vec3(position.x, position.y, position.z));
        if (!block || isAirBlock(block)) continue;
        const changedIssue = stairClearanceIssue(block);
        if (changedIssue) {
          return {
            ok: false,
            error: changedIssue === 'fluid' ? 'stair_step_flooded' : 'stair_step_obstructed',
            direction: String(direction),
            targetFeet,
            obstruction: { issue: changedIssue, block: summarizeBlock(block) },
            changes,
            reason:
              'The stair cell changed after preflight; stop and choose again from fresh terrain.',
            alternatives: describeDescentOptions(bot, start),
          };
        }
        const result = await executeConfirmedWorldChange({
          bot,
          guard: opts.worldChangeExecutor,
          verb: 'dig',
          position,
          beforeBlock: block,
          context: { purpose: 'safe_descending_stair_step', direction: String(direction) },
          timeoutMs: opts.changeConfirmationTimeoutMs,
          stabilityWindowMs: opts.changeStabilityWindowMs,
          commandTimeoutMs: opts.worldCommandTimeoutMs,
          perform: () => (bot as any).dig(block),
        });
        const resultChanges =
          'changes' in result
            ? result.changes
            : 'attemptedChanges' in result
              ? result.attemptedChanges
              : [];
        changes.push(...resultChanges);
        if (!result.ok) {
          return {
            ok: false,
            error: 'stair_step_clear_failed',
            direction: String(direction),
            targetFeet,
            failedCell: position,
            changes,
            cause: result,
          };
        }
      }

      const remaining = [targetFeet, targetHead]
        .map((position) => ({
          position,
          block: (bot as any).blockAt?.(new Vec3(position.x, position.y, position.z)),
        }))
        .find(({ block }) => !isAirBlock(block));
      if (remaining) {
        return {
          ok: false,
          error: 'stair_step_clearance_unconfirmed',
          direction: String(direction),
          targetFeet,
          obstruction: summarizeBlock(remaining.block),
          changes,
        };
      }
      if (!(bot as any).pathfinder) {
        return {
          ok: false,
          error: 'stair_step_navigation_unavailable',
          direction: String(direction),
          targetFeet,
          changes,
        };
      }
      const navigation = await runPathfinderGoal(
        bot,
        new (goals as any).GoalBlock(targetFeet.x, targetFeet.y, targetFeet.z),
        {
          destination: targetFeet,
          near: 0,
          timeoutMs: clamp(Number(timeoutMs), 1000, 120_000),
          target: 'descending staircase step',
        },
      );
      return {
        ok: navigation.ok,
        ...(navigation.ok ? {} : { error: 'stair_step_arrival_unconfirmed' }),
        status: navigation.ok ? 'descended_one_step' : 'cleared_but_not_entered',
        direction: String(direction),
        startFeet: { x: start.x, y: start.y, z: start.z },
        targetFeet,
        support: summarizeBlock(support),
        changes,
        navigation,
        ...(navigation.ok
          ? {
              retreat: {
                tool: 'ascend_step',
                input: { direction: oppositeCardinal(String(direction)) },
                purpose: 'Return through this staircase step without changing more blocks.',
              },
            }
          : {}),
      };
    },
    category: 'world',
    effects: { blockMutation: 'multiple' },
  });

  add({
    name: 'ascend_step',
    description:
      'Climb exactly one cardinal staircase step to an adjacent feet cell one level higher without changing blocks. This verifies open feet/head cells, safe support, and arrival in the exact upper cell. Use the opposite direction of a prior descend_step to retreat through that step.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 120000 },
      },
      required: ['direction'],
    },
    run: async ({ direction, timeoutMs = 30_000 }) => {
      const vector = CARDINAL_DIRECTIONS[String(direction).toLowerCase()];
      if (!vector) return { ok: false, error: 'invalid_stair_direction' };
      const start = (bot as any).entity?.position?.floored?.();
      if (!start) return { ok: false, error: 'bot_not_spawned' };
      const targetFeet = {
        x: start.x + vector.x,
        y: start.y + 1,
        z: start.z + vector.z,
      };
      const targetHead = { ...targetFeet, y: targetFeet.y + 1 };
      const supportPosition = { ...targetFeet, y: targetFeet.y - 1 };
      const feet = (bot as any).blockAt?.(new Vec3(targetFeet.x, targetFeet.y, targetFeet.z));
      const head = (bot as any).blockAt?.(new Vec3(targetHead.x, targetHead.y, targetHead.z));
      const support = (bot as any).blockAt?.(
        new Vec3(supportPosition.x, supportPosition.y, supportPosition.z),
      );
      const feetIssue = ascentClearanceIssue(feet);
      const headIssue = ascentClearanceIssue(head);
      if (!safeStairSupport(support) || feetIssue || headIssue) {
        return {
          ok: false,
          error: !safeStairSupport(support) ? 'ascent_step_unsupported' : 'ascent_step_blocked',
          direction: String(direction),
          targetFeet,
          support: summarizeBlock(support),
          obstruction: feetIssue
            ? { role: 'feet', issue: feetIssue, block: summarizeBlock(feet) }
            : headIssue
              ? { role: 'head', issue: headIssue, block: summarizeBlock(head) }
              : null,
          alternatives: describeAscentOptions(bot, start),
        };
      }
      if (!(bot as any).pathfinder) {
        return { ok: false, error: 'ascent_step_navigation_unavailable', targetFeet };
      }
      const navigation = await runPathfinderGoal(
        bot,
        new (goals as any).GoalBlock(targetFeet.x, targetFeet.y, targetFeet.z),
        {
          destination: targetFeet,
          near: 0,
          timeoutMs: clamp(Number(timeoutMs), 1000, 120_000),
          target: 'ascending staircase step',
        },
      );
      const finalFeet = (bot as any).entity?.position?.floored?.();
      const arrivedExactCell = samePosition(finalFeet, targetFeet);
      const roseOneLevel = finalFeet != null && finalFeet.y === start.y + 1;
      return {
        ok: navigation.ok && arrivedExactCell && roseOneLevel,
        ...(navigation.ok && arrivedExactCell && roseOneLevel
          ? {}
          : { error: 'ascent_step_arrival_unconfirmed' }),
        status:
          navigation.ok && arrivedExactCell && roseOneLevel
            ? 'ascended_one_step'
            : 'upper_step_not_reached',
        direction: String(direction),
        startFeet: { x: start.x, y: start.y, z: start.z },
        targetFeet,
        finalFeet: finalFeet ? { x: finalFeet.x, y: finalFeet.y, z: finalFeet.z } : null,
        support: summarizeBlock(support),
        navigation,
      };
    },
    category: 'move',
  });

  add({
    name: 'place_against',
    description:
      'Place the held block against an explicitly chosen solid reference face. Prefer place_block when you know the desired empty destination cell and do not care which neighboring block supplies support.',
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
    run: async ({ on, face = 'top' }) => {
      const ref = (bot as any).blockAt(new Vec3(on.x, on.y, on.z));
      if (!ref || isAirBlock(ref)) return { ok: false, error: 'no_solid_reference_block' };
      const faces: Record<string, Vec3> = {
        top: new Vec3(0, 1, 0),
        bottom: new Vec3(0, -1, 0),
        north: new Vec3(0, 0, -1),
        south: new Vec3(0, 0, 1),
        east: new Vec3(1, 0, 0),
        west: new Vec3(-1, 0, 0),
      };
      const faceVector = faces[face] || faces.top;
      const placedAt = ref.position.plus(faceVector);
      const beforeBlock = (bot as any).blockAt(placedAt);
      const position = { x: placedAt.x, y: placedAt.y, z: placedAt.z };
      if (!isReplaceablePlacementTarget(beforeBlock)) {
        return {
          ok: false,
          error: 'placement_target_occupied',
          target: summarizeBlock(beforeBlock),
          reason: 'Choose a face whose adjacent destination cell is air or replaceable vegetation.',
        };
      }
      if (placementIntersectsBody(bot, position)) {
        return placementBodyConflict(bot, position);
      }
      const protectedConflict = protectedBodySpaceConflict(
        opts.places?.() ?? [],
        position,
        String((bot as any).heldItem?.name || ''),
        String((bot as any).game?.dimension || ''),
      );
      if (protectedConflict) return protectedConflict;
      return executeConfirmedWorldChange({
        bot,
        guard: opts.worldChangeExecutor,
        verb: 'place',
        position,
        beforeBlock,
        context: {
          reference: {
            position: { x: ref.position.x, y: ref.position.y, z: ref.position.z },
            name: ref.name == null ? null : String(ref.name),
          },
          face,
        },
        timeoutMs: opts.changeConfirmationTimeoutMs,
        stabilityWindowMs: opts.changeStabilityWindowMs,
        commandTimeoutMs: opts.worldCommandTimeoutMs,
        perform: () => performPlacement(bot, ref, faceVector),
      });
    },
    category: 'world',
    effects: { blockMutation: 'place' },
  });

  add({
    name: 'place_block',
    description:
      'Place a block into a named air or replaceable-vegetation world cell. This discovers a solid neighboring support face, equips the requested inventory block when supplied, approaches if needed, and succeeds only after Minecraft confirms the placed block.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        name: {
          type: 'string',
          description: 'Optional inventory block name; otherwise use the currently held block',
        },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 120000 },
      },
      required: ['x', 'y', 'z'],
    },
    run: async ({ x, y, z, name, timeoutMs = 45_000 }, execution) => {
      const position = {
        x: Math.floor(Number(x)),
        y: Math.floor(Number(y)),
        z: Math.floor(Number(z)),
      };
      if (!Object.values(position).every(Number.isFinite)) {
        return { ok: false, error: 'invalid_placement_position' };
      }
      let destination = (bot as any).blockAt?.(new Vec3(position.x, position.y, position.z));
      if (!isReplaceablePlacementTarget(destination)) {
        return {
          ok: false,
          error: 'placement_target_occupied',
          target: summarizeBlock(destination),
          reason: 'place_block requires air or replaceable vegetation at the destination cell.',
        };
      }

      const selected = await selectPlacementItem(bot, name);
      if (!selected.ok) return selected;
      const protectedConflict = protectedBodySpaceConflict(
        opts.places?.() ?? [],
        position,
        selected.item,
        String((bot as any).game?.dimension || ''),
      );
      if (protectedConflict) return protectedConflict;

      let references = placementReferences(bot, position);
      if (!references.length) {
        return {
          ok: false,
          error: 'placement_support_not_found',
          position,
          reason: 'The destination needs one adjacent solid block to support Minecraft placement.',
        };
      }

      let navigation: any = null;
      if (placementIntersectsBody(bot, position)) {
        const conflict = placementBodyConflict(bot, position);
        const stand = conflict.suggestedFeetPositions[0];
        const pathfinder = (bot as any).pathfinder;
        if (!stand || !pathfinder) return conflict;
        navigation = await runPathfinderGoal(
          bot,
          new (goals as any).GoalBlock(stand.x, stand.y, stand.z),
          {
            destination: stand,
            near: 0,
            timeoutMs: Math.min(clamp(Number(timeoutMs), 1000, 120_000), 6_500),
            target: 'placement step-aside',
            signal: execution?.signal,
            movementEnvelope: {
              maxHorizontalFromStart: 3,
              maxVerticalFromStart: 2,
            },
          },
        );
        if (!navigation.ok) {
          return {
            ...conflict,
            error: 'placement_reposition_failed',
            navigation,
          };
        }
        destination = (bot as any).blockAt?.(new Vec3(position.x, position.y, position.z));
        if (!isReplaceablePlacementTarget(destination)) {
          return {
            ok: false,
            error: 'placement_target_changed_during_reposition',
            position,
            target: summarizeBlock(destination),
            navigation,
          };
        }
        if (placementIntersectsBody(bot, position)) {
          return {
            ...placementBodyConflict(bot, position),
            error: 'placement_reposition_unconfirmed',
            navigation,
          };
        }
        references = placementReferences(bot, position);
      }

      const me = (bot as any).entity?.position;
      const targetDistance =
        me?.distanceTo?.(new Vec3(position.x + 0.5, position.y, position.z + 0.5)) ?? 0;
      if (targetDistance > 4.5) {
        const pathfinder = (bot as any).pathfinder;
        if (!pathfinder) {
          return { ok: false, error: 'placement_target_out_of_reach', position, targetDistance };
        }
        navigation = await runPathfinderGoal(
          bot,
          new (goals as any).GoalNear(position.x, position.y, position.z, 3),
          {
            destination: position,
            near: 3,
            timeoutMs: clamp(Number(timeoutMs), 1000, 120_000),
            target: 'placement cell',
            signal: execution?.signal,
          },
        );
        if (!navigation.ok) {
          return { ok: false, error: 'placement_target_unreachable', position, navigation };
        }
        destination = (bot as any).blockAt?.(new Vec3(position.x, position.y, position.z));
        if (!isReplaceablePlacementTarget(destination)) {
          return {
            ok: false,
            error: 'placement_target_changed_before_action',
            target: summarizeBlock(destination),
            navigation,
          };
        }
        references = placementReferences(bot, position);
      }

      const reference = references[0];
      if (!reference) {
        return {
          ok: false,
          error: 'placement_support_not_found_after_approach',
          position,
          navigation,
        };
      }
      const result = await executeConfirmedWorldChange({
        bot,
        guard: opts.worldChangeExecutor,
        verb: 'place',
        position,
        beforeBlock: destination,
        context: {
          item: selected.item,
          reference: summarizeBlock(reference.block),
          face: reference.face,
        },
        timeoutMs: opts.changeConfirmationTimeoutMs,
        stabilityWindowMs: opts.changeStabilityWindowMs,
        commandTimeoutMs: opts.worldCommandTimeoutMs,
        perform: () => performPlacement(bot, reference.block, reference.vector),
        signal: execution?.signal,
      });
      return { ...result, navigation, item: selected.item };
    },
    category: 'world',
    effects: { blockMutation: 'place' },
  });

  add({
    name: 'cross_visible_door',
    description:
      'Use and cross the exact wooden door currently under your first-person cursor. This owns opening, crossing the selected aperture, confirming body arrival on the opposite side, and optionally closing the door. It proves only a witnessed route between two sides, never that either side is inside, safe, sealed, or owned.',
    parameters: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description: 'Exact scene.focus.id for the reachable door currently under the cursor',
        },
        closeAfter: {
          type: 'boolean',
          description: 'Close the door after crossing; default true',
        },
        rememberAs: {
          type: 'object',
          description:
            'Optional player-scale name for remembering this witnessed route after the next observation confirms arrival',
          properties: {
            label: { type: 'string' },
            purpose: { type: 'string' },
          },
          required: ['label'],
        },
        timeoutMs: { type: 'number', minimum: 500, maximum: 10000 },
      },
      required: ['focus'],
    },
    run: async ({ focus, closeAfter = true, rememberAs = null, timeoutMs = 5000 }, execution) =>
      crossSelectedVisibleDoor(
        bot,
        {
          focus: String(focus || ''),
          closeAfter: Boolean(closeAfter),
          rememberAs,
          timeoutMs: clamp(Number(timeoutMs), 500, 10_000),
        },
        opts,
        execution?.signal,
      ),
    category: 'move',
    effects: { blockMutation: 'state' },
  });

  add({
    name: 'toggle_block',
    description:
      'Use a nearby door, trapdoor, fence gate, or lever and succeed only when Minecraft confirms its state changed.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        maxDistance: { type: 'number', minimum: 1, maximum: 6 },
      },
      required: ['x', 'y', 'z'],
    },
    run: async ({ x, y, z, maxDistance = 5 }, execution) =>
      activateToggleBlock(
        bot,
        { x: Number(x), y: Number(y), z: Number(z) },
        clamp(Number(maxDistance), 1, 6),
        opts,
        execution?.signal,
      ),
    category: 'world',
    effects: { blockMutation: 'state' },
  });

  if (opts.places) {
    add({
      name: 'cross_place_door',
      description:
        'Re-use a door route learned by your own earlier crossing. You must already stand on one remembered side in the same exact world and dimension; the body turns back to the remembered door, re-acquires it under the current cursor, and then performs the same visible-door crossing. Either side may be the destination.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact doorway place id from self.places' },
          closeAfter: {
            type: 'boolean',
            description: 'Close the door after crossing; default true',
          },
          timeoutMs: { type: 'number', minimum: 500, maximum: 10000 },
        },
        required: ['id'],
      },
      run: async ({ id, closeAfter = true, timeoutMs = 5000 }, execution) => {
        if (execution?.signal?.aborted) return cancelledAction('remembered-door-crossing');
        const place = opts.places!().find((candidate) => candidate.id === String(id));
        if (!place) return { ok: false, error: 'remembered_place_not_found', id: String(id) };
        const doorway = place.doorways?.find((candidate) => {
          const body = (bot as any).entity?.position;
          return (
            !!body &&
            (bodyOccupiesCell(body, candidate.sideAFeet) ||
              bodyOccupiesCell(body, candidate.sideBFeet))
          );
        });
        if (place.evidence !== 'doorway_crossed' || !doorway) {
          return {
            ok: false,
            error:
              place.evidence === 'doorway_crossed'
                ? 'body_not_at_remembered_doorway_side'
                : 'remembered_place_is_not_a_witnessed_doorway',
            place: { id: place.id, label: place.label },
          };
        }
        const observation = opts.observe?.();
        const circleId = boundedString(observation?.circle?.id, 160);
        const dimension = boundedString(
          observation?.self?.condition?.dimension ?? (bot as any).game?.dimension,
          96,
        );
        if (!place.circleId || !circleId || place.circleId !== circleId) {
          return {
            ok: false,
            error: 'remembered_doorway_belongs_to_another_world',
            placeCircleId: place.circleId ?? null,
            currentCircleId: circleId || null,
          };
        }
        if (!place.anchor.dimension || !dimension || place.anchor.dimension !== dimension) {
          return {
            ok: false,
            error: 'remembered_doorway_belongs_to_another_dimension',
            placeDimension: place.anchor.dimension,
            currentDimension: dimension || null,
          };
        }
        if (typeof (bot as any).lookAt !== 'function') {
          return { ok: false, error: 'body_look_control_unavailable' };
        }
        await (bot as any).lookAt(
          new Vec3(doorway.lower.x + 0.5, doorway.lower.y + 0.7, doorway.lower.z + 0.5),
          false,
        );
        const reacquired = opts.observe?.()?.scene?.focus;
        const reacquiredPosition = integerBlockPosition(reacquired?.position);
        if (
          !reacquired ||
          reacquired.kind !== 'block' ||
          reacquired.source !== 'cursor' ||
          reacquired.reachable !== true ||
          normalizeRegistryName(String(reacquired.name || '')) !== doorway.name ||
          !reacquiredPosition ||
          (!samePosition(reacquiredPosition, doorway.lower) &&
            !samePosition(reacquiredPosition, doorway.upper))
        ) {
          return {
            ok: false,
            error: 'remembered_doorway_not_reacquired_under_cursor',
            rememberedDoor: {
              name: doorway.name,
              lower: doorway.lower,
              upper: doorway.upper,
            },
            currentFocus: residentFocusSummary(reacquired),
          };
        }
        const result = await crossSelectedVisibleDoor(
          bot,
          {
            focus: reacquired.id,
            closeAfter: Boolean(closeAfter),
            rememberAs: null,
            timeoutMs: clamp(Number(timeoutMs), 500, 10_000),
          },
          opts,
          execution?.signal,
        );
        return {
          ...result,
          rememberedPlace: { id: place.id, label: place.label },
        };
      },
      category: 'move',
      effects: { blockMutation: 'state' },
    });
  }

  // inventory/crafting/consume
  add({
    name: 'craft_item',
    description:
      'Craft an item from current inventory, using a nearby crafting table when one is available. Count is desired output items.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number', minimum: 1, maximum: 64 },
      },
      required: ['name'],
    },
    run: async ({ name, count = 1 }) => {
      const mcData: any = (mcDataLoader as any)((bot as any).version);
      const item = namedRegistryEntry(mcData?.itemsByName, String(name));
      if (!item) {
        return {
          ok: false,
          error: 'unknown_item',
          requested: String(name),
          suggestions: registrySuggestions(mcData?.itemsByName, String(name)),
        };
      }

      const desired = clamp(Math.floor(Number(count) || 1), 1, 64);
      const tableType = mcData?.blocksByName?.crafting_table?.id;
      const table =
        tableType == null
          ? null
          : ((bot as any).findBlock?.({ matching: tableType, maxDistance: 6 }) ?? null);
      const recipes = (bot as any).recipesFor?.(item.id, null, 1, table) || [];
      const recipe = recipes[0];
      if (!recipe) {
        return {
          ok: false,
          error: 'no_available_recipe',
          item: item.name,
          nearbyCraftingTable: !!table,
          inventory: inventorySnapshot(bot),
        };
      }

      const outputPerBatch = Math.max(1, Number(recipe?.result?.count) || 1);
      const batches = Math.ceil(desired / outputPerBatch);
      const before = inventoryCount(bot, item.name);
      await (bot as any).craft(recipe, batches, table);
      const after = inventoryCount(bot, item.name);
      const produced = Math.max(0, after - before);
      return {
        ok: produced > 0,
        ...(produced > 0 ? {} : { error: 'craft_unconfirmed' }),
        item: item.name,
        requested: desired,
        produced,
        countBefore: before,
        countAfter: after,
        usedCraftingTable: !!table,
      };
    },
    category: 'craft',
  });

  add({
    name: 'equip_item',
    description: 'Hold an inventory item in a hand, or wear it in an armor slot.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        destination: {
          type: 'string',
          enum: ['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'],
        },
      },
      required: ['name'],
    },
    run: async ({ name, destination = 'hand' }) => {
      const item = (bot as any).inventory
        ?.items?.()
        .find(
          (i: any) =>
            i?.name?.toLowerCase()?.includes(String(name).toLowerCase()) ||
            i?.displayName?.toLowerCase()?.includes(String(name).toLowerCase()),
        );
      if (!item) return { ok: false, error: 'item_not_found' };
      await (bot as any).equip(item, destination);
      return { ok: true };
    },
    category: 'inventory',
  });

  add({
    name: 'inspect_container',
    description:
      'Look inside the nearby chest or other storage block: open it, observe its contents, then close it.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        maxDistance: { type: 'number', minimum: 1, maximum: 6 },
      },
    },
    run: async ({ x, y, z, maxDistance = 6 }) => {
      const resolved = resolveContainerBlock(bot, { x, y, z, maxDistance });
      if (!resolved.ok) return resolved;
      const container = await (bot as any).openContainer(resolved.block);
      try {
        return {
          ok: true,
          container: summarizeContainerBlock(resolved.block),
          contents: itemSnapshot(container.containerItems?.() || []),
          confirmation: 'mineflayer:openContainer',
        };
      } finally {
        container.close?.();
      }
    },
    category: 'inventory',
  });

  add({
    name: 'deposit_in_container',
    description:
      'Put an owned inventory item into the nearby chest or other storage block, then verify that it left this body and appeared inside.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number', minimum: 1, maximum: 64 },
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        maxDistance: { type: 'number', minimum: 1, maximum: 6 },
      },
      required: ['name'],
    },
    run: async ({ name, count = 1, x, y, z, maxDistance = 6 }) => {
      const resolved = resolveContainerBlock(bot, { x, y, z, maxDistance });
      if (!resolved.ok) return resolved;
      const query = normalizeRegistryName(String(name));
      const item = ((bot as any).inventory?.items?.() || []).find((candidate: any) =>
        normalizeRegistryName(String(candidate?.name || '')).includes(query),
      );
      if (!item) {
        return {
          ok: false,
          error: 'item_not_in_inventory',
          requested: String(name),
          inventory: inventorySnapshot(bot),
        };
      }

      const moved = Math.min(
        clamp(Math.floor(Number(count) || 1), 1, 64),
        Math.max(0, Number(item.count) || 0),
      );
      const container = await (bot as any).openContainer(resolved.block);
      try {
        const bodyBefore = openContainerBodyCount(container, bot, String(item.name));
        const containerBefore = countItems(container.containerItems?.() || [], String(item.name));
        await container.deposit(item.type, item.metadata ?? null, moved, item.nbt ?? null);
        const transaction = await waitForInventoryTransaction(
          () => ({
            body: Math.max(
              0,
              bodyBefore - openContainerBodyCount(container, bot, String(item.name)),
            ),
            container: Math.max(
              0,
              countItems(container.containerItems?.() || [], String(item.name)) - containerBefore,
            ),
          }),
          moved,
          Number(opts.changeConfirmationTimeoutMs ?? 1000),
        );
        const bodyRemoved = transaction.body;
        const containerAdded = transaction.container;
        const verified = moved > 0 && bodyRemoved === moved && containerAdded === moved;
        return {
          ok: verified,
          ...(verified ? {} : { error: 'deposit_unconfirmed' }),
          container: summarizeContainerBlock(resolved.block),
          item: String(item.name),
          requested: moved,
          bodyRemoved,
          containerAdded,
          confirmation: verified ? 'mineflayer:container_inventory_delta' : null,
        };
      } finally {
        container.close?.();
      }
    },
    category: 'inventory',
  });

  add({
    name: 'withdraw_from_container',
    description:
      'Take an item from the nearby chest or other storage block, then verify that it left the container and entered this body.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number', minimum: 1, maximum: 64 },
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        maxDistance: { type: 'number', minimum: 1, maximum: 6 },
      },
      required: ['name'],
    },
    run: async ({ name, count = 1, x, y, z, maxDistance = 6 }) => {
      const resolved = resolveContainerBlock(bot, { x, y, z, maxDistance });
      if (!resolved.ok) return resolved;
      const query = normalizeRegistryName(String(name));
      const container = await (bot as any).openContainer(resolved.block);
      try {
        const item = (container.containerItems?.() || []).find((candidate: any) =>
          normalizeRegistryName(String(candidate?.name || '')).includes(query),
        );
        if (!item) {
          return {
            ok: false,
            error: 'item_not_in_container',
            requested: String(name),
            container: summarizeContainerBlock(resolved.block),
            contents: itemSnapshot(container.containerItems?.() || []),
          };
        }

        const moved = Math.min(
          clamp(Math.floor(Number(count) || 1), 1, 64),
          Math.max(0, Number(item.count) || 0),
        );
        const bodyBefore = openContainerBodyCount(container, bot, String(item.name));
        const containerBefore = countItems(container.containerItems?.() || [], String(item.name));
        await container.withdraw(item.type, item.metadata ?? null, moved, item.nbt ?? null);
        const transaction = await waitForInventoryTransaction(
          () => ({
            body: Math.max(
              0,
              openContainerBodyCount(container, bot, String(item.name)) - bodyBefore,
            ),
            container: Math.max(
              0,
              containerBefore - countItems(container.containerItems?.() || [], String(item.name)),
            ),
          }),
          moved,
          Number(opts.changeConfirmationTimeoutMs ?? 1000),
        );
        const bodyAdded = transaction.body;
        const containerRemoved = transaction.container;
        const verified = moved > 0 && bodyAdded === moved && containerRemoved === moved;
        return {
          ok: verified,
          ...(verified ? {} : { error: 'withdrawal_unconfirmed' }),
          container: summarizeContainerBlock(resolved.block),
          item: String(item.name),
          requested: moved,
          bodyAdded,
          containerRemoved,
          confirmation: verified ? 'mineflayer:container_inventory_delta' : null,
        };
      } finally {
        container.close?.();
      }
    },
    category: 'inventory',
  });

  add({
    name: 'sleep_in_bed',
    description: 'Sleep in a specified or nearby bed when Minecraft permits it',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        maxDistance: { type: 'number', minimum: 1, maximum: 16 },
      },
    },
    run: async ({ x, y, z, maxDistance = 6 }) => {
      const explicit = [x, y, z].every((value) => Number.isFinite(Number(value)));
      const bed = explicit
        ? (bot as any).blockAt?.(new Vec3(Number(x), Number(y), Number(z)))
        : (bot as any).findBlock?.({
            matching: (block: any) => !!(bot as any).isABed?.(block),
            maxDistance: clamp(Number(maxDistance), 1, 16),
          });
      if (!bed || !(bot as any).isABed?.(bed)) {
        return { ok: false, error: 'bed_not_found' };
      }
      await (bot as any).sleep(bed);
      return {
        ok: !!(bot as any).isSleeping,
        ...(!!(bot as any).isSleeping ? {} : { error: 'sleep_unconfirmed' }),
        bed: summarizeBlock(bed),
      };
    },
    category: 'self-care',
    effects: { blockMutation: 'state' },
  });

  add({
    name: 'wake_up',
    description: 'Leave the bed when currently sleeping',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      if (!(bot as any).isSleeping) return { ok: true, status: 'already_awake' };
      await (bot as any).wake();
      return { ok: !(bot as any).isSleeping };
    },
    category: 'self-care',
    effects: { blockMutation: 'state' },
  });

  add({
    name: 'consume',
    description:
      'Consume the held item, or equip an inventory item by name, and verify a bodily or inventory consequence.',
    parameters: { type: 'object', properties: { name: { type: 'string' } } },
    run: async ({ name }) => {
      let selected = (bot as any).heldItem;
      if (name) {
        const match = (bot as any).inventory
          ?.items?.()
          .find(
            (item: any) =>
              item?.name?.toLowerCase()?.includes(String(name).toLowerCase()) ||
              item?.displayName?.toLowerCase()?.includes(String(name).toLowerCase()),
          );
        if (!match) return { ok: false, error: 'item_not_found' };
        await (bot as any).equip(match, 'hand');
        selected = match;
      }
      const itemName = String(selected?.name || (bot as any).heldItem?.name || 'held_item');
      const countBefore = inventoryCount(bot, itemName);
      const foodBefore = finiteNumber((bot as any).food);
      const healthBefore = finiteNumber((bot as any).health);
      await (bot as any).consume();
      const countAfter = inventoryCount(bot, itemName);
      const foodAfter = finiteNumber((bot as any).food);
      const healthAfter = finiteNumber((bot as any).health);
      const inventoryRemoved = Math.max(0, countBefore - countAfter);
      const foodGained =
        foodBefore != null && foodAfter != null ? Math.max(0, foodAfter - foodBefore) : 0;
      const healthGained =
        healthBefore != null && healthAfter != null ? Math.max(0, healthAfter - healthBefore) : 0;
      const verified = inventoryRemoved > 0 || foodGained > 0 || healthGained > 0;
      return {
        ok: verified,
        ...(verified ? {} : { error: 'consumption_unconfirmed' }),
        item: itemName,
        inventoryRemoved,
        foodBefore,
        foodAfter,
        healthBefore,
        healthAfter,
        confirmation: verified ? 'mineflayer:body_or_inventory_delta' : null,
      };
    },
    category: 'inventory',
  });

  // sensing
  add({
    name: 'find_blocks',
    description:
      'Locate nearby solid blocks by exact or broad registry name in loaded terrain. Broad names such as "log" search across wood species; log results prioritize likely grounded trunk bases over closer floating canopy pieces. Returned coordinates are interaction targets, not feet positions: pass one to dig_block to approach and mine it.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        maxDistance: { type: 'number', minimum: 1, maximum: 32 },
        count: { type: 'number', minimum: 1, maximum: 16 },
      },
      required: ['name'],
    },
    run: async ({ name, maxDistance = 16, count = 8 }) => {
      const mcData: any = (mcDataLoader as any)((bot as any).version);
      const query = normalizeRegistryName(String(name));
      const matching = Object.values(mcData?.blocksByName || {})
        .filter((entry: any) => normalizeRegistryName(entry?.name || '').includes(query))
        .sort((a: any, b: any) => {
          const aExact = normalizeRegistryName(a?.name || '') === query ? 0 : 1;
          const bExact = normalizeRegistryName(b?.name || '') === query ? 0 : 1;
          return aExact - bExact || String(a?.name).localeCompare(String(b?.name));
        })
        .slice(0, 16) as any[];
      if (!matching.length) {
        return {
          ok: false,
          error: 'unknown_block',
          requested: String(name),
          suggestions: registrySuggestions(mcData?.blocksByName, String(name)),
        };
      }
      const requestedCount = clamp(Math.floor(Number(count) || 8), 1, 16);
      const positions: Vec3[] =
        (bot as any).findBlocks?.({
          matching: matching.map((block) => block.id),
          maxDistance: clamp(Number(maxDistance), 1, 32),
          // Nearest matches may all be unsafe or elevated. Scan beyond the
          // requested result count before filtering and ranking them.
          count: Math.min(128, Math.max(32, requestedCount * 8)),
        }) || [];
      const me = (bot as any).entity?.position;
      const feet = me?.floored?.();
      const woodSearch = query.includes('log') || query.includes('stem');
      const safePositions = positions.filter(
        (position) =>
          digPositionIssue(bot, { x: position.x, y: position.y, z: position.z }) == null &&
          (!woodSearch || !feet || position.y >= feet.y),
      );
      const candidates = safePositions.map((position) => {
        const block = (bot as any).blockAt?.(position);
        const below = (bot as any).blockAt?.(position.offset(0, -1, 0));
        const blockDistance = me ? me.distanceTo(position) : null;
        return {
          name: String(block?.name || 'unknown'),
          position: { x: position.x, y: position.y, z: position.z },
          distance: blockDistance == null ? null : round(blockDistance),
          withinImmediateDigReach: blockDistance == null ? null : blockDistance <= 4.5,
          supportBelow: String(below?.name || 'unknown'),
          likelyGrounded: likelyGroundSupport(below),
        };
      });
      if (woodSearch) {
        candidates.sort(
          (a, b) =>
            Number(b.likelyGrounded) - Number(a.likelyGrounded) ||
            Number(a.distance ?? Infinity) - Number(b.distance ?? Infinity),
        );
      }
      return {
        ok: true,
        source: 'loaded_local_terrain',
        visibility: 'unknown',
        coordinateMeaning: 'solid_block_target_not_feet_position',
        nextAffordance: 'use dig_block on a chosen returned position',
        omittedUnsafeTargets: positions.length - safePositions.length,
        searchedCandidates: positions.length,
        blocks: candidates.slice(0, requestedCount),
      };
    },
    category: 'sense',
    audience: 'privileged',
  });

  add({
    name: 'block_at_cursor',
    description: 'Get block currently under crosshair within maxDistance',
    parameters: { type: 'object', properties: { maxDistance: { type: 'number' } } },
    run: async ({ maxDistance = 6 }) => {
      const b = blockAtViewCursor(bot, Number(maxDistance));
      if (!b) return { ok: true, block: null };
      return { ok: true, block: summarizeBlock(b) };
    },
    category: 'sense',
  });

  add({
    name: 'inspect_volume',
    description:
      'Inspect the exact loaded block geometry in one small local volume. Returns coordinate-aligned horizontal layers with a compact palette. This is a symbolic server-side terrain sense, not visual line of sight. Use it to choose empty building cells, maintain a coherent wall/door/roof shape, and inspect what your construction actually became.',
    parameters: {
      type: 'object',
      properties: {
        center: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
          description: 'Optional integer block center; defaults to your current feet cell.',
        },
        radius: { type: 'number', minimum: 1, maximum: 4 },
        verticalRadius: { type: 'number', minimum: 1, maximum: 3 },
      },
    },
    run: async ({ center, radius = 3, verticalRadius = 2 }) => {
      const body = (bot as any).entity?.position;
      const bodyFeet = body?.floored?.();
      if (!body || !bodyFeet) return { ok: false, error: 'bot_not_spawned' };
      const requestedCenter = center
        ? {
            x: Math.floor(Number(center.x)),
            y: Math.floor(Number(center.y)),
            z: Math.floor(Number(center.z)),
          }
        : { x: bodyFeet.x, y: bodyFeet.y, z: bodyFeet.z };
      if (![requestedCenter.x, requestedCenter.y, requestedCenter.z].every(Number.isFinite)) {
        return { ok: false, error: 'invalid_volume_center' };
      }
      const centerDistance = body.distanceTo?.(
        new Vec3(requestedCenter.x + 0.5, requestedCenter.y, requestedCenter.z + 0.5),
      );
      if (centerDistance == null || centerDistance > 8.5) {
        return {
          ok: false,
          error: 'volume_center_not_local',
          center: requestedCenter,
          distance: centerDistance == null ? null : round(centerDistance),
          maxDistance: 8,
          reason: 'Move into the worksite before inspecting its exact geometry.',
        };
      }
      const horizontal = clamp(Math.floor(Number(radius) || 3), 1, 4);
      const vertical = clamp(Math.floor(Number(verticalRadius) || 2), 1, 3);
      return inspectBlockVolume(bot, requestedCenter, horizontal, vertical, {
        x: bodyFeet.x,
        y: bodyFeet.y,
        z: bodyFeet.z,
      });
    },
    category: 'sense',
    audience: 'privileged',
  });

  add({
    name: 'inspect_reachable_space',
    description:
      'Inspect the connected two-block-tall body space reachable from one exact supported feet cell. This derives body-scale affordances from loaded local blocks: which cells remain navigable, whether that space escapes the scan, whether every reachable cell is covered, whether at least two bodies fit, and whether a closed usable wooden door connects the protected space to safe body space outside. It is symbolic server-side geometry, not visual line of sight. Use it before declaring a room, cave refuge, or shelter usable; never fill returned protectedCells with walls or roof.',
    parameters: {
      type: 'object',
      properties: {
        feet: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
          description: 'Optional candidate interior feet cell; defaults to your current feet cell.',
        },
        radius: { type: 'number', minimum: 2, maximum: 6 },
        verticalRadius: { type: 'number', minimum: 1, maximum: 3 },
      },
    },
    run: async ({ feet, radius = 4, verticalRadius = 2 }) => {
      const body = (bot as any).entity?.position;
      const bodyFeet = body?.floored?.();
      if (!body || !bodyFeet) return { ok: false, error: 'bot_not_spawned' };
      const seed = feet
        ? {
            x: Math.floor(Number(feet.x)),
            y: Math.floor(Number(feet.y)),
            z: Math.floor(Number(feet.z)),
          }
        : { x: bodyFeet.x, y: bodyFeet.y, z: bodyFeet.z };
      if (![seed.x, seed.y, seed.z].every(Number.isFinite)) {
        return { ok: false, error: 'invalid_space_feet' };
      }
      const distance = body.distanceTo?.(new Vec3(seed.x + 0.5, seed.y, seed.z + 0.5));
      if (distance == null || distance > 8.5) {
        return {
          ok: false,
          error: 'space_feet_not_local',
          feet: seed,
          distance: distance == null ? null : round(distance),
          maxDistance: 8,
          reason: 'Move into the space before inspecting its body-scale affordances.',
        };
      }
      return inspectReachableSpace(
        bot,
        seed,
        clamp(Math.floor(Number(radius) || 4), 2, 6),
        clamp(Math.floor(Number(verticalRadius) || 2), 1, 3),
      );
    },
    category: 'sense',
    audience: 'privileged',
  });

  add({
    name: 'entity_at_cursor',
    description: 'Get entity under crosshair within maxDistance',
    parameters: { type: 'object', properties: { maxDistance: { type: 'number' } } },
    run: async ({ maxDistance = 3.5 }) => {
      const e = entityAtViewCursor(bot, Number(maxDistance));
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
        return (
          ent?.name?.toLowerCase?.()?.includes(n) || ent?.username?.toLowerCase?.()?.includes(n)
        );
      };
      const e = (bot as any).nearestEntity(match);
      return { ok: true, entity: e ? summarizeEntity(e) : null };
    },
    category: 'sense',
    audience: 'privileged',
  });

  add({
    name: 'get_nearby',
    description: 'List nearby entities by distance',
    parameters: {
      type: 'object',
      properties: {
        radius: { type: 'number' },
        limit: { type: 'number' },
      },
    },
    run: async ({ radius = 16, limit = 8 }) => {
      const me = (bot as any).entity?.position;
      if (!me) return { ok: false, error: 'bot_not_spawned' };
      const entities = (Object.values((bot as any).entities || {}) as any[])
        .filter((entity) => entity?.position && entity?.id !== (bot as any).entity?.id)
        .map((entity) => ({ entity, distance: me.distanceTo(entity.position) }))
        .filter(({ distance }) => distance <= Number(radius))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, Number(limit))
        .map(({ entity }) => summarizeEntity(entity));
      return { ok: true, entities };
    },
    category: 'sense',
    audience: 'privileged',
  });

  add({
    name: 'survey_area',
    description: 'Survey nearby terrain into a compact material and elevation map',
    parameters: {
      type: 'object',
      properties: {
        radius: { type: 'number', minimum: 4, maximum: 48 },
        step: { type: 'number', minimum: 1, maximum: 8 },
        verticalRange: { type: 'number', minimum: 8, maximum: 96 },
      },
    },
    run: async (args) => surveyArea(bot, args),
    category: 'sense',
    audience: 'privileged',
  });

  // status
  add({
    name: 'status',
    description: 'Get brief status and position',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const p = (bot as any).entity?.position;
      const position = p ? { x: p.x, y: p.y, z: p.z } : null;
      return {
        ok: true,
        position,
        health: (bot as any).health,
        food: (bot as any).food,
        dimension: (bot as any).game?.dimension,
        time: (bot as any).time?.time,
      };
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
    const dist =
      me && pos
        ? Math.sqrt(
            Math.pow(pos.x - me.x, 2) + Math.pow(pos.y - me.y, 2) + Math.pow(pos.z - me.z, 2),
          )
        : null;
    return {
      id: e?.id,
      username: e?.username,
      name: e?.name,
      type: e?.type,
      position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
      distance: dist,
    };
  }

  function sceneEntityReference(entity: any) {
    return entity?.username
      ? `player:${String(entity.username)}`
      : `entity:${String(entity?.id ?? '')}`;
  }

  function observedSceneEntity(subject: Bot, reference: string) {
    if (!sceneCurrentlyPerceives(reference)) return undefined;
    return (Object.values((subject as any).entities || {}) as any[]).find(
      (entity) =>
        entity?.position &&
        entity?.id !== (subject as any).entity?.id &&
        sceneEntityReference(entity) === reference,
    );
  }

  function sceneCurrentlyPerceives(reference: string) {
    if (!opts.observe) return true;
    const observation = opts.observe();
    return (
      observation?.protocol === 'behold.inhabitant.v2' &&
      Array.isArray(observation?.scene?.entities) &&
      observation.scene.entities.some(
        (entity: any) =>
          entity?.id === reference &&
          entity?.source === 'vision' &&
          entity?.visibility === 'visible',
      )
    );
  }

  return {
    list(audience?: CommandSpec['audience']) {
      const visible = audience
        ? specs.filter((spec) => (spec.audience ?? 'inhabitant') === audience)
        : specs;
      return visible.map(
        ({ name, description, parameters, category, audience: commandAudience, effects }) => ({
          name,
          description,
          parameters,
          category,
          audience: commandAudience ?? 'inhabitant',
          effects: effects ?? {},
        }),
      );
    },
    describe(name: string) {
      const c = specs.find((s) => s.name === name);
      if (!c) return null;
      const { description, parameters, category, audience, effects } = c;
      return {
        name,
        description,
        parameters,
        category,
        audience: audience ?? 'inhabitant',
        effects: effects ?? {},
      };
    },
    async run(name: string, args: any, execution?: CommandExecution) {
      const c = specs.find((s) => s.name === name);
      if (!c) return { ok: false, error: 'unknown_command' };
      if (execution?.signal?.aborted) {
        return cancelledAction('behold-command-dispatch');
      }
      try {
        return await c.run(args ?? {}, execution);
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
      }
    },
    specs,
  };
}

type ContainerResolution =
  | { ok: true; block: any }
  | {
      ok: false;
      error:
        | 'incomplete_container_coordinates'
        | 'container_not_found'
        | 'block_is_not_container'
        | 'container_out_of_reach';
      [key: string]: unknown;
    };

function resolveContainerBlock(
  bot: Bot,
  args: { x?: unknown; y?: unknown; z?: unknown; maxDistance?: unknown },
): ContainerResolution {
  const provided = [args.x, args.y, args.z].filter((value) => value != null).length;
  if (provided > 0 && provided < 3) {
    return { ok: false, error: 'incomplete_container_coordinates' };
  }

  const maxDistance = clamp(Number(args.maxDistance ?? 6), 1, 6);
  const explicit = provided === 3;
  const block = explicit
    ? (bot as any).blockAt?.(new Vec3(Number(args.x), Number(args.y), Number(args.z)))
    : (bot as any).findBlock?.({
        matching: (candidate: any) => isStorageBlock(candidate),
        maxDistance,
      });
  if (!block) return { ok: false, error: 'container_not_found' };
  if (!isStorageBlock(block)) {
    return {
      ok: false,
      error: 'block_is_not_container',
      block: summarizeContainerBlock(block),
    };
  }

  const me = (bot as any).entity?.position;
  const distance = me?.distanceTo?.(block.position) ?? Infinity;
  if (distance > maxDistance + 0.75) {
    return {
      ok: false,
      error: 'container_out_of_reach',
      container: summarizeContainerBlock(block),
      distance: round(distance),
      maxDistance,
    };
  }
  return { ok: true, block };
}

function isStorageBlock(block: any) {
  const name = normalizeRegistryName(String(block?.name || ''));
  return (
    name === 'chest' ||
    name === 'trapped_chest' ||
    name === 'barrel' ||
    name === 'dispenser' ||
    name === 'dropper' ||
    name === 'hopper' ||
    name === 'ender_chest' ||
    name === 'shulker_box' ||
    name.endsWith('_shulker_box')
  );
}

function summarizeContainerBlock(block: any) {
  return {
    name: block?.name == null ? null : String(block.name),
    position: block?.position
      ? { x: block.position.x, y: block.position.y, z: block.position.z }
      : null,
  };
}

type BlockState = {
  name: string | null;
  type: number | null;
  stateId: number | null;
};

type ObservedBlockTransition = {
  before: BlockState;
  after: BlockState;
  evidence: WorldChangeEvidence;
};

async function executeConfirmedWorldChange(options: {
  bot: Bot;
  guard?: WorldChangeExecutor | null;
  verb: 'dig' | 'place';
  position: BlockPosition;
  beforeBlock: any;
  context?: Record<string, unknown>;
  timeoutMs?: number;
  stabilityWindowMs?: number;
  commandTimeoutMs?: number;
  perform: () => Promise<unknown>;
  signal?: AbortSignal;
}) {
  if (options.signal?.aborted) return cancelledAction('behold-command-dispatch');
  const before = blockState(options.beforeBlock);
  const request = {
    verb: options.verb,
    position: options.position,
    before: before.name,
  } as const;
  const reservation = options.guard?.reserve(request);
  if (reservation && !reservation.ok) return reservation;

  const observer = observeBlockTransition(options.bot, options.position, before);
  let commandError: string | null = null;
  let cancellationAcknowledged = false;
  const onDiggingAborted = (block: any) => {
    if (
      options.signal?.aborted &&
      block?.position &&
      samePosition(block.position, options.position)
    ) {
      cancellationAcknowledged = true;
    }
  };
  const requestDigCancellation = () => {
    if (options.verb !== 'dig') return;
    const active = (options.bot as any).targetDigBlock;
    if (!active?.position || !samePosition(active.position, options.position)) return;
    (options.bot as any).stopDigging?.();
  };
  if (options.verb === 'dig') {
    (options.bot as any).on?.('diggingAborted', onDiggingAborted);
    options.signal?.addEventListener('abort', requestDigCancellation, { once: true });
  }
  try {
    await boundedWorldCommand(
      options.perform(),
      clamp(Number(options.commandTimeoutMs ?? 15_000), 1, 120_000),
    );
  } catch (error: any) {
    commandError = String(error?.message || error || 'world_change_command_failed');
    if (options.verb === 'dig' && commandError.startsWith('world_change_command_timeout')) {
      (options.bot as any).stopDigging?.();
    }
  }

  const transition = await observer.wait(Math.max(1, Number(options.timeoutMs ?? 2500)));
  if (transition) {
    await observer.stabilize(Math.max(1, Number(options.stabilityWindowMs ?? 250)));
  }

  const current = blockState(
    (options.bot as any).blockAt?.(
      new Vec3(options.position.x, options.position.y, options.position.z),
    ),
  );
  const latestStateMatches = transition != null && observer.matchesLatest(current);
  const expectedChangePersists =
    options.verb === 'dig'
      ? !sameBlockState(current, before)
      : transition != null && sameBlockState(current, transition.after);
  observer.close();
  if (options.verb === 'dig') {
    (options.bot as any).removeListener?.('diggingAborted', onDiggingAborted);
    options.signal?.removeEventListener('abort', requestDigCancellation);
  }
  const after = current;
  const transitionVerified = transition != null && latestStateMatches && expectedChangePersists;
  // A matching world transition proves that the cell changed during the
  // observation window. If the command itself errored, Minecraft gives us no
  // actor/command correlation strong enough to attribute that change to this
  // action rather than another inhabitant. Consume the reservation, preserve
  // the observation, and fail with explicit uncertainty.
  const verified = transitionVerified && commandError == null;
  const error = cancellationAcknowledged
    ? 'interrupted_by_human'
    : transitionVerified && commandError
      ? 'world_change_attribution_uncertain'
      : verified
        ? undefined
        : transition && !expectedChangePersists
          ? 'world_change_reversed_before_confirmation'
          : commandError
            ? `world_change_unconfirmed: ${commandError}`
            : 'world_change_unconfirmed';

  if (reservation?.ok) {
    options.guard!.settle(reservation.reservationId, {
      after: after.name,
      verified,
      evidence: transition?.evidence,
      error,
    });
  }

  const change = {
    verb: options.verb,
    position: options.position,
    before: before.name,
    after: after.name,
    verified,
    observed: transitionVerified,
    confirmation: transition?.evidence ?? null,
    ...(options.context ? { context: options.context } : {}),
  };

  if (cancellationAcknowledged) {
    return {
      ...cancelledAction('mineflayer-digging'),
      commandError,
      attemptedChanges: [change],
      sideEffectObserved: transitionVerified,
    };
  }

  if (!verified) {
    return {
      ok: false,
      error: transitionVerified ? 'world_change_attribution_uncertain' : 'world_change_unconfirmed',
      commandError,
      attemptedChanges: [change],
      reason: transitionVerified
        ? 'The block changed during the action window, but the command errored and Minecraft supplied no actor/command correlation. The change is observed but cannot be credited to this action.'
        : 'The command may have reached the server, but no matching blockUpdate confirmed the transition.',
    };
  }

  return {
    ok: true,
    changes: [change],
  };
}

async function boundedWorldCommand(command: Promise<unknown>, timeoutMs: number) {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      command,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`world_change_command_timeout_after_${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function observeBlockTransition(bot: Bot, position: BlockPosition, expectedBefore: BlockState) {
  let transition: ObservedBlockTransition | null = null;
  let latestObservedState: BlockState = expectedBefore;
  let resolvePending: ((value: ObservedBlockTransition) => void) | null = null;
  const pending = new Promise<ObservedBlockTransition>((resolve) => {
    resolvePending = resolve;
  });

  const onBlockUpdate = (oldBlock: any, newBlock: any) => {
    const eventPosition = newBlock?.position || oldBlock?.position;
    if (!samePosition(eventPosition, position)) return;
    const eventBefore = blockState(oldBlock);
    const eventAfter = blockState(newBlock);
    latestObservedState = eventAfter;
    if (!transition) {
      if (!sameBlockState(eventBefore, expectedBefore)) return;
      if (sameBlockState(eventAfter, expectedBefore)) return;
      transition = {
        before: eventBefore,
        after: eventAfter,
        evidence: {
          source: 'mineflayer:blockUpdate',
          observedAt: Date.now(),
          beforeStateId: eventBefore.stateId,
          afterStateId: eventAfter.stateId,
        },
      };
      resolvePending?.(transition);
    }
  };

  (bot as any).on?.('blockUpdate', onBlockUpdate);
  return {
    async wait(timeoutMs: number): Promise<ObservedBlockTransition | null> {
      if (transition) return transition;
      let timer: NodeJS.Timeout | null = null;
      try {
        return await Promise.race([
          pending,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async stabilize(windowMs: number) {
      await new Promise((resolve) => setTimeout(resolve, windowMs));
    },
    matchesLatest(expected: BlockState) {
      return sameBlockState(latestObservedState, expected);
    },
    close() {
      (bot as any).removeListener?.('blockUpdate', onBlockUpdate);
    },
  };
}

function blockState(block: any): BlockState {
  return {
    name: block?.name == null ? null : String(block.name),
    type: finiteNumber(block?.type),
    stateId: finiteNumber(block?.stateId),
  };
}

function blockProperties(block: any): Record<string, string | number | boolean> {
  try {
    const properties = block?.getProperties?.();
    return properties && typeof properties === 'object' ? { ...properties } : {};
  } catch {
    return {};
  }
}

function toggleProperty(block: any): 'open' | 'powered' | null {
  const name = normalizeRegistryName(String(block?.name || ''));
  const properties = blockProperties(block);
  if (
    typeof properties.open === 'boolean' &&
    (name.endsWith('_door') || name.endsWith('_trapdoor') || name.endsWith('_fence_gate')) &&
    !name.startsWith('iron_')
  ) {
    return 'open';
  }
  if (typeof properties.powered === 'boolean' && name === 'lever') return 'powered';
  return null;
}

type SelectedDoorCrossingInput = {
  focus: string;
  closeAfter: boolean;
  rememberAs: any;
  timeoutMs: number;
};

async function crossSelectedVisibleDoor(
  bot: Bot,
  input: SelectedDoorCrossingInput,
  opts: InterpreterOptions,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return cancelledAction('visible-door-crossing');
  const observation = opts.observe?.();
  const focus = observation?.scene?.focus;
  if (!focus) return { ok: false, error: 'current_cursor_focus_unavailable' };
  if (
    focus.id !== input.focus ||
    focus.kind !== 'block' ||
    focus.source !== 'cursor' ||
    focus.reachable !== true ||
    !isPosition(focus.position)
  ) {
    return {
      ok: false,
      error: 'selected_door_is_not_current_reachable_cursor_focus',
      requestedFocus: input.focus,
      currentFocus: residentFocusSummary(focus),
    };
  }

  const cursorBlock = blockAtViewCursor(bot, 6);
  const cursorPosition = integerBlockPosition(cursorBlock?.position);
  const focusPosition = integerBlockPosition(focus.position);
  const dimension = boundedString(
    observation?.self?.condition?.dimension ?? (bot as any).game?.dimension,
    96,
  );
  const expectedFocusId = cursorPosition
    ? observedBlockId(dimension || 'unknown', cursorPosition)
    : null;
  if (
    !cursorBlock ||
    !cursorPosition ||
    !focusPosition ||
    !samePosition(cursorPosition, focusPosition) ||
    expectedFocusId !== input.focus
  ) {
    return {
      ok: false,
      error: 'selected_door_focus_changed_before_action',
      requestedFocus: input.focus,
      currentCursor: cursorBlock ? summarizeObservedBlock(cursorBlock) : null,
    };
  }

  const resolved = resolveSelectedWoodenDoor(bot, cursorBlock);
  if (!resolved.ok) return resolved;
  if (normalizeRegistryName(String(focus.name || '')) !== resolved.name) {
    return {
      ok: false,
      error: 'selected_door_focus_changed_before_action',
      requestedFocus: input.focus,
      currentCursor: summarizeObservedBlock(cursorBlock),
    };
  }
  const body = integerFeetPosition((bot as any).entity?.position);
  if (!body) return { ok: false, error: 'body_position_unavailable' };
  const direction = CARDINAL_DIRECTIONS[resolved.facing];
  const firstSide = {
    x: resolved.lower.x + direction.x,
    y: resolved.lower.y,
    z: resolved.lower.z + direction.z,
  };
  const secondSide = {
    x: resolved.lower.x - direction.x,
    y: resolved.lower.y,
    z: resolved.lower.z - direction.z,
  };
  const fromFeet = samePosition(body, firstSide)
    ? firstSide
    : samePosition(body, secondSide)
      ? secondSide
      : null;
  const toFeet = fromFeet === firstSide ? secondSide : firstSide;
  if (!fromFeet) {
    return {
      ok: false,
      error: 'body_not_at_selected_door_side',
      focus: residentFocusSummary(focus),
      bodyFeet: body,
      requiredSides: [firstSide, secondSide],
    };
  }

  const rememberAs = normalizeDoorwayMemory(input.rememberAs);
  const circleId = boundedString(observation?.circle?.id, 160);
  if (input.rememberAs != null && !rememberAs) {
    return { ok: false, error: 'invalid_doorway_memory_name' };
  }
  if (rememberAs && (!circleId || !dimension)) {
    return {
      ok: false,
      error: 'doorway_memory_requires_exact_world_identity',
      circleId: circleId || null,
      dimension: dimension || null,
    };
  }
  if (!bodySpaceAt(bot, toFeet).standable) {
    return {
      ok: false,
      error: 'selected_door_destination_not_standable',
      focus: residentFocusSummary(focus),
      toFeet,
    };
  }

  const opened = await ensureDoorOpen(bot, resolved.lower, opts, signal, cursorBlock);
  if (!opened.ok) return { ...opened, error: opened.error || 'selected_door_could_not_open' };
  if (signal?.aborted) {
    const doorRecovery =
      opened.changed?.before === false ? await ensureDoorClosed(bot, resolved.lower, opts) : null;
    return { ...cancelledAction('visible-door-crossing'), doorRecovery };
  }
  const crossing = await crossSelectedDoorAperture(
    bot,
    resolved.lower,
    fromFeet,
    toFeet,
    input.timeoutMs,
    signal,
  );
  if (!crossing.ok) {
    const doorRecovery =
      opened.changed?.before === false ? await ensureDoorClosed(bot, resolved.lower, opts) : null;
    return {
      ok: false,
      error: crossing.error || 'selected_door_crossing_unconfirmed',
      focus: residentFocusSummary(focus),
      fromFeet,
      toFeet,
      crossing,
      doorRecovery: publicDoorTransition(doorRecovery),
    };
  }

  const closed = input.closeAfter
    ? await ensureDoorClosed(bot, resolved.lower, opts, signal)
    : null;
  if (closed && !closed.ok) {
    return {
      ok: false,
      error: closed.error || 'crossed_selected_door_but_close_unconfirmed',
      crossed: true,
      focus: residentFocusSummary(focus),
      fromFeet,
      toFeet,
      crossing,
      doorOpened: publicDoorTransition(opened),
      doorClosed: publicDoorTransition(closed),
    };
  }

  return {
    ok: true,
    protocol: 'behold.visible-door-crossing.v1',
    crossed: true,
    focus: residentFocusSummary(focus),
    door: {
      lower: resolved.lower,
      upper: resolved.upper,
    },
    fromFeet,
    toFeet,
    doorOpened: publicDoorTransition(opened),
    doorClosed: publicDoorTransition(closed),
    crossing,
    world: {
      circleId: circleId || null,
      dimension: dimension || null,
      managedRunId: boundedString(observation?.circle?.managedRunId, 160) || null,
      observationSequence: finiteIntegerOrNull(observation?.sequence),
    },
    ...(rememberAs ? { rememberAs } : {}),
  };
}

function resolveSelectedWoodenDoor(
  bot: Bot,
  focusedBlock: any,
):
  | { ok: true; name: string; facing: string; lower: BlockPosition; upper: BlockPosition }
  | { ok: false; error: string; [key: string]: unknown } {
  const focusedPosition = integerBlockPosition(focusedBlock?.position);
  const focusedProperties = blockProperties(focusedBlock);
  const focusedName = normalizeRegistryName(String(focusedBlock?.name || ''));
  if (
    !focusedPosition ||
    !focusedName.endsWith('_door') ||
    focusedName.startsWith('iron_') ||
    !['lower', 'upper'].includes(String(focusedProperties.half || ''))
  ) {
    return {
      ok: false,
      error: 'current_cursor_focus_is_not_a_wooden_door',
      block: summarizeObservedBlock(focusedBlock),
    };
  }
  const lower = {
    ...focusedPosition,
    y: focusedProperties.half === 'upper' ? focusedPosition.y - 1 : focusedPosition.y,
  };
  const upper = { ...lower, y: lower.y + 1 };
  const lowerBlock = (bot as any).blockAt?.(new Vec3(lower.x, lower.y, lower.z));
  const upperBlock = (bot as any).blockAt?.(new Vec3(upper.x, upper.y, upper.z));
  const lowerProperties = blockProperties(lowerBlock);
  const upperProperties = blockProperties(upperBlock);
  const name = normalizeRegistryName(String(lowerBlock?.name || ''));
  const facing = String(lowerProperties.facing || '');
  if (
    name !== focusedName ||
    normalizeRegistryName(String(upperBlock?.name || '')) !== name ||
    lowerProperties.half !== 'lower' ||
    upperProperties.half !== 'upper' ||
    !CARDINAL_DIRECTIONS[facing]
  ) {
    return {
      ok: false,
      error: 'selected_door_pair_changed_or_incomplete',
      lower: summarizeObservedBlock(lowerBlock),
      upper: summarizeObservedBlock(upperBlock),
    };
  }
  return { ok: true, name, facing, lower, upper };
}

async function crossSelectedDoorAperture(
  bot: Bot,
  lower: BlockPosition,
  fromFeet: BlockPosition,
  toFeet: BlockPosition,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  if (!bodyOccupiesCell((bot as any).entity?.position, fromFeet)) {
    return { ok: false, error: 'selected_door_origin_unconfirmed' };
  }
  const door = (bot as any).blockAt?.(new Vec3(lower.x, lower.y, lower.z));
  if (
    blockProperties(door).open !== true ||
    !bodySpaceAt(bot, lower).standable ||
    !bodySpaceAt(bot, toFeet).standable
  ) {
    return { ok: false, error: 'selected_door_aperture_not_passable' };
  }
  if (typeof (bot as any).setControlState !== 'function') {
    return { ok: false, error: 'bounded_body_control_unavailable' };
  }
  const startedAt = Date.now();
  const aperture = await boundedDirectBodyMove(bot, lower, {
    timeoutMs: Math.min(timeoutMs, 1800),
    arrival: 'cell',
    route: 'selected_door_aperture',
    signal,
  });
  if (!aperture.ok) {
    return {
      ok: false,
      error: aperture.error || 'selected_door_aperture_entry_unconfirmed',
      doorCellOccupied: false,
      durationMs: Date.now() - startedAt,
    };
  }
  const destination = await boundedDirectBodyMove(bot, toFeet, {
    timeoutMs: Math.min(timeoutMs, 2200),
    arrival: 'cell',
    route: 'selected_door_opposite_side',
    signal,
  });
  const arrived = destination.ok && bodyOccupiesCell((bot as any).entity?.position, toFeet);
  return {
    ok: arrived,
    ...(arrived ? {} : { error: destination.error || 'selected_door_destination_unconfirmed' }),
    method: 'bounded_direct_selected_aperture',
    doorCellOccupied: true,
    final: positionOf(bot),
    durationMs: Date.now() - startedAt,
    confirmation: arrived ? 'mineflayer:body_crossed_selected_door_cell' : null,
  };
}

function publicDoorTransition(value: any) {
  if (!value) return null;
  return {
    ok: value.ok === true,
    status: boundedString(value.status, 64) || null,
    changed: value.changed
      ? {
          property: value.changed.property,
          before: value.changed.before,
          after: value.changed.after,
        }
      : null,
    confirmation: value.confirmation
      ? { source: boundedString(value.confirmation.source, 96) || null }
      : value.observed
        ? { source: boundedString(value.observed.source, 96) || null }
        : null,
  };
}

function residentFocusSummary(focus: any) {
  if (!focus) return null;
  return {
    id: boundedString(focus.id, 160),
    kind: boundedString(focus.kind, 32),
    name: boundedString(focus.name, 64),
    source: boundedString(focus.source, 32),
    position: integerBlockPosition(focus.position),
  };
}

function normalizeDoorwayMemory(value: any) {
  if (value == null) return null;
  const label = boundedString(value?.label, 120);
  if (!label) return null;
  return {
    label,
    purpose: boundedString(value?.purpose, 240) || null,
  };
}

function observedBlockId(dimension: string, position: BlockPosition) {
  return `block:${dimension}:${position.x}:${position.y}:${position.z}`;
}

function isPosition(value: any) {
  return [value?.x, value?.y, value?.z].every((part) => Number.isFinite(Number(part)));
}

function integerBlockPosition(value: any): BlockPosition | null {
  if (!isPosition(value)) return null;
  return {
    x: Math.floor(Number(value.x)),
    y: Math.floor(Number(value.y)),
    z: Math.floor(Number(value.z)),
  };
}

function integerFeetPosition(value: any): BlockPosition | null {
  return integerBlockPosition(value);
}

function boundedString(value: any, limit: number) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function finiteIntegerOrNull(value: any) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

async function activateToggleBlock(
  bot: Bot,
  position: BlockPosition,
  maxDistance: number,
  opts: InterpreterOptions,
  signal?: AbortSignal,
  interactionBlock?: any,
): Promise<any> {
  if (signal?.aborted) return cancelledAction('minecraft-block-activation');
  const block = (bot as any).blockAt?.(new Vec3(position.x, position.y, position.z));
  if (!block) return { ok: false, error: 'no_block' };
  const me = (bot as any).entity?.position;
  const blockDistance = me?.distanceTo?.(block.position) ?? Infinity;
  if (blockDistance > clamp(Number(maxDistance), 1, 6)) {
    return {
      ok: false,
      error: 'block_out_of_reach',
      block: summarizeObservedBlock(block),
      distance: round(blockDistance),
    };
  }
  const property = toggleProperty(block);
  if (!property) {
    return {
      ok: false,
      error: 'block_not_toggleable',
      block: summarizeObservedBlock(block),
    };
  }

  const beforeState = blockState(block);
  const beforeProperties = blockProperties(block);
  const observer = observeBlockTransition(bot, position, beforeState);
  let commandError: string | null = null;
  try {
    const target = toggleInteractionTarget(block, interactionBlock, position, property);
    const targetPosition = integerBlockPosition(target.position) ?? position;
    const interaction = blockInteraction(target, me, targetPosition);
    await (bot as any).activateBlock(target, interaction.face, interaction.cursor);
  } catch (error: any) {
    commandError = String(error?.message || error || 'block_activation_failed');
  }
  const transition = await observer.wait(
    Math.max(1, Number(opts.changeConfirmationTimeoutMs ?? 2500)),
  );
  if (transition) {
    await observer.stabilize(Math.max(1, Number(opts.changeStabilityWindowMs ?? 250)));
  }
  const current = (bot as any).blockAt?.(new Vec3(position.x, position.y, position.z));
  const afterState = blockState(current);
  const afterProperties = blockProperties(current);
  const observed =
    transition != null &&
    observer.matchesLatest(afterState) &&
    beforeProperties[property] !== afterProperties[property];
  // A blockUpdate proves a transition happened during this window. If the
  // activation command failed, Minecraft has not correlated that transition
  // to this action, so another inhabitant may have caused it.
  const verified = observed && commandError == null;
  observer.close();

  if (signal?.aborted) {
    return {
      ...cancelledAction('minecraft-block-activation'),
      observed,
      changed: {
        property,
        before: beforeProperties[property] ?? null,
        after: afterProperties[property] ?? null,
      },
      confirmation: transition?.evidence ?? null,
    };
  }

  return {
    ok: verified,
    verified,
    observed,
    ...(verified
      ? {}
      : {
          error: observed
            ? 'block_activation_attribution_uncertain'
            : 'block_activation_unconfirmed',
          commandError,
        }),
    block: {
      name: String(current?.name || block.name || 'block'),
      position,
    },
    changed: {
      property,
      before: beforeProperties[property] ?? null,
      after: afterProperties[property] ?? null,
      beforeStateId: beforeState.stateId,
      afterStateId: afterState.stateId,
    },
    confirmation: transition?.evidence ?? null,
  };
}

function toggleInteractionTarget(
  watchedBlock: any,
  interactionBlock: any,
  watchedPosition: BlockPosition,
  property: 'open' | 'powered',
) {
  const candidatePosition = integerBlockPosition(interactionBlock?.position);
  if (
    candidatePosition &&
    normalizeRegistryName(String(interactionBlock?.name || '')) ===
      normalizeRegistryName(String(watchedBlock?.name || '')) &&
    toggleProperty(interactionBlock) === property &&
    candidatePosition.x === watchedPosition.x &&
    candidatePosition.z === watchedPosition.z &&
    Math.abs(candidatePosition.y - watchedPosition.y) <= 1
  ) {
    return interactionBlock;
  }
  return watchedBlock;
}

function blockInteraction(block: any, body: any, position: BlockPosition) {
  const hit = block?.intersect;
  const face = blockFaceVector(block?.face);
  if (
    face &&
    hit &&
    samePosition(integerBlockPosition(block?.position), position) &&
    [hit.x, hit.y, hit.z].every((part) => Number.isFinite(Number(part)))
  ) {
    return {
      face,
      cursor: new Vec3(
        clamp(Number(hit.x) - position.x, 0, 1),
        clamp(Number(hit.y) - position.y, 0, 1),
        clamp(Number(hit.z) - position.z, 0, 1),
      ),
    };
  }
  return {
    face: interactionFaceFromBody(body, position),
    cursor: new Vec3(0.5, 0.5, 0.5),
  };
}

function blockFaceVector(face: any) {
  switch (Number(face)) {
    case 0:
      return new Vec3(0, -1, 0);
    case 1:
      return new Vec3(0, 1, 0);
    case 2:
      return new Vec3(0, 0, -1);
    case 3:
      return new Vec3(0, 0, 1);
    case 4:
      return new Vec3(-1, 0, 0);
    case 5:
      return new Vec3(1, 0, 0);
    default:
      return null;
  }
}

function interactionFaceFromBody(body: any, position: BlockPosition) {
  const dx = Number(body?.x) - (position.x + 0.5);
  const dz = Number(body?.z) - (position.z + 0.5);
  if (Math.abs(dx) > Math.abs(dz)) return new Vec3(Math.sign(dx) || 1, 0, 0);
  return new Vec3(0, 0, Math.sign(dz) || 1);
}

async function ensureDoorOpen(
  bot: Bot,
  position: BlockPosition,
  opts: InterpreterOptions,
  signal?: AbortSignal,
  interactionBlock?: any,
) {
  if (signal?.aborted) return cancelledAction('minecraft-door-open');
  const block = (bot as any).blockAt?.(new Vec3(position.x, position.y, position.z));
  const current = blockProperties(block).open;
  if (current === true) {
    return {
      ok: true,
      status: 'already_open',
      block: summarizeObservedBlock(block),
      observed: { source: 'loaded_local_terrain', open: true },
    };
  }
  if (current !== false) {
    return {
      ok: false,
      error: 'remembered_entrance_not_observed_as_door',
      block: summarizeObservedBlock(block),
    };
  }
  const toggled = await activateToggleBlock(bot, position, 4.5, opts, signal, interactionBlock);
  return {
    ...toggled,
    ok: toggled.ok && toggled.changed?.property === 'open' && toggled.changed?.after === true,
    ...(!toggled.ok || toggled.changed?.after !== true
      ? { error: toggled.error || 'door_did_not_open' }
      : {}),
  };
}

async function ensureDoorClosed(
  bot: Bot,
  position: BlockPosition,
  opts: InterpreterOptions,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return cancelledAction('minecraft-door-close');
  const block = (bot as any).blockAt?.(new Vec3(position.x, position.y, position.z));
  const current = blockProperties(block).open;
  if (current === false) {
    return {
      ok: true,
      status: 'already_closed',
      block: summarizeObservedBlock(block),
      observed: { source: 'loaded_local_terrain', open: false },
    };
  }
  if (current !== true) {
    return {
      ok: false,
      error: 'remembered_entrance_not_observed_as_door',
      block: summarizeObservedBlock(block),
    };
  }
  const toggled = await activateToggleBlock(bot, position, 4.5, opts, signal);
  return {
    ...toggled,
    ok: toggled.ok && toggled.changed?.property === 'open' && toggled.changed?.after === false,
    ...(!toggled.ok || toggled.changed?.after !== false
      ? { error: toggled.error || 'door_did_not_close' }
      : {}),
  };
}

function summarizeObservedBlock(block: any) {
  return {
    name: block?.name,
    type: block?.type,
    hardness: block?.hardness,
    position: block?.position
      ? { x: block.position.x, y: block.position.y, z: block.position.z }
      : null,
  };
}

function bodyOccupiesCell(body: any, cell: { x: number; y: number; z: number }) {
  if (![body?.x, body?.y, body?.z].every((value) => Number.isFinite(Number(value)))) return false;
  return (
    Math.floor(Number(body.x)) === cell.x &&
    Math.abs(Number(body.y) - cell.y) <= 0.65 &&
    Math.floor(Number(body.z)) === cell.z
  );
}

async function boundedDirectBodyMove(
  bot: Bot,
  target: BlockPosition,
  options: {
    timeoutMs: number;
    arrival: 'cell' | 'center';
    route: string;
    signal?: AbortSignal;
  },
) {
  const startedAt = Date.now();
  const start = positionOf(bot);
  const targetCenter = new Vec3(target.x + 0.5, target.y, target.z + 0.5);
  const arrived = () => {
    const body = (bot as any).entity?.position;
    if (!body) return false;
    if (options.arrival === 'cell') return bodyOccupiesCell(body, target);
    const horizontal = Math.hypot(Number(body.x) - targetCenter.x, Number(body.z) - targetCenter.z);
    return horizontal <= 0.28 && Math.abs(Number(body.y) - target.y) <= 0.65;
  };
  if (options.signal?.aborted) {
    return {
      ...cancelledAction('bounded-direct-body-move'),
      route: options.route,
      target,
      start,
      final: positionOf(bot),
      durationMs: Date.now() - startedAt,
    };
  }
  try {
    try {
      await (bot as any).lookAt(new Vec3(targetCenter.x, target.y + 1.2, targetCenter.z), true);
    } catch {}
    (bot as any).setControlState('forward', true);
    const deadline = startedAt + clamp(Number(options.timeoutMs), 100, 2000);
    while (!arrived() && Date.now() < deadline && !options.signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    (bot as any).setControlState('forward', false);
  }
  const final = positionOf(bot);
  const ok = arrived();
  if (options.signal?.aborted) {
    return {
      ...cancelledAction('bounded-direct-body-move'),
      route: options.route,
      target,
      start,
      final,
      durationMs: Date.now() - startedAt,
    };
  }
  return {
    ok,
    ...(ok ? {} : { error: 'bounded_direct_move_unconfirmed' }),
    route: options.route,
    target,
    start,
    final,
    durationMs: Date.now() - startedAt,
  };
}

function sameBlockState(a: BlockState, b: BlockState) {
  if (a.stateId != null && b.stateId != null) return a.stateId === b.stateId;
  if (a.type != null && b.type != null) return a.type === b.type && a.name === b.name;
  return a.name === b.name;
}

function isAirBlock(block: any) {
  const name = normalizeRegistryName(String(block?.name || ''));
  return name === 'air' || name === 'cave_air' || name === 'void_air';
}

function isReplaceablePlacementTarget(block: any) {
  if (isAirBlock(block)) return true;
  const name = normalizeRegistryName(String(block?.name || ''));
  if (
    [
      'short_grass',
      'tall_grass',
      'fern',
      'large_fern',
      'dead_bush',
      'poppy',
      'dandelion',
      'blue_orchid',
      'allium',
      'azure_bluet',
      'oxeye_daisy',
      'cornflower',
      'lily_of_the_valley',
      'wither_rose',
      'torchflower',
      'pink_petals',
      'wildflowers',
    ].includes(name)
  ) {
    return true;
  }
  return name.endsWith('_tulip') || name.endsWith('_sapling');
}

async function selectPlacementItem(
  bot: Bot,
  requested: unknown,
): Promise<
  | { ok: true; item: string }
  | {
      ok: false;
      error: string;
      requested?: string;
      inventory: Array<{ name: string; count: number }>;
    }
> {
  const query = normalizeRegistryName(String(requested ?? ''));
  if (query) {
    const candidate = ((bot as any).inventory?.items?.() || []).find(
      (item: any) => normalizeRegistryName(String(item?.name || '')) === query,
    );
    if (!candidate) {
      return {
        ok: false,
        error: 'placement_item_not_in_inventory',
        requested: query,
        inventory: inventorySnapshot(bot),
      };
    }
    if ((bot as any).heldItem !== candidate) await (bot as any).equip(candidate, 'hand');
  }
  const held = (bot as any).heldItem;
  if (!held?.name) {
    return {
      ok: false,
      error: 'no_placement_item_held',
      inventory: inventorySnapshot(bot),
    };
  }
  return { ok: true, item: String(held.name) };
}

function placementReferences(bot: Bot, position: BlockPosition) {
  const candidates = [
    { offset: new Vec3(0, -1, 0), vector: new Vec3(0, 1, 0), face: 'top' },
    { offset: new Vec3(-1, 0, 0), vector: new Vec3(1, 0, 0), face: 'east' },
    { offset: new Vec3(1, 0, 0), vector: new Vec3(-1, 0, 0), face: 'west' },
    { offset: new Vec3(0, 0, -1), vector: new Vec3(0, 0, 1), face: 'south' },
    { offset: new Vec3(0, 0, 1), vector: new Vec3(0, 0, -1), face: 'north' },
    { offset: new Vec3(0, 1, 0), vector: new Vec3(0, -1, 0), face: 'bottom' },
  ];
  return candidates
    .map((candidate) => {
      const block = (bot as any).blockAt?.(
        new Vec3(
          position.x + candidate.offset.x,
          position.y + candidate.offset.y,
          position.z + candidate.offset.z,
        ),
      );
      return block && isPlacementSupport(block) ? { ...candidate, block } : null;
    })
    .filter(Boolean) as Array<{
    block: any;
    vector: Vec3;
    face: string;
    offset: Vec3;
  }>;
}

function isPlacementSupport(block: any) {
  if (!block || isAirBlock(block)) return false;
  const name = normalizeRegistryName(String(block.name || ''));
  if (name === 'water' || name === 'lava' || name.endsWith('_sign')) return false;
  return block.boundingBox == null || block.boundingBox !== 'empty';
}

function performPlacement(bot: Bot, reference: any, faceVector: Vec3) {
  const placeWithOptions = (bot as any)._placeBlockWithOptions;
  if (typeof placeWithOptions === 'function') {
    return placeWithOptions.call(bot, reference, faceVector, {
      swingArm: 'right',
      forceLook: true,
    });
  }
  return (bot as any).placeBlock(reference, faceVector);
}

function placementIntersectsBody(bot: Bot, position: BlockPosition) {
  const entity = (bot as any).entity;
  const body = entity?.position;
  if (![body?.x, body?.y, body?.z].every((value) => Number.isFinite(Number(value)))) return false;
  const halfWidth = Math.max(0.1, Number(entity?.width) || 0.6) / 2;
  const height = Math.max(0.1, Number(entity?.height) || 1.8);
  return (
    rangesOverlap(position.x, position.x + 1, body.x - halfWidth, body.x + halfWidth) &&
    rangesOverlap(position.y, position.y + 1, body.y, body.y + height) &&
    rangesOverlap(position.z, position.z + 1, body.z - halfWidth, body.z + halfWidth)
  );
}

function placementBodyConflict(bot: Bot, position: BlockPosition) {
  const body = (bot as any).entity?.position;
  return {
    ok: false,
    error: 'placement_would_intersect_body',
    position,
    body: body ? { x: body.x, y: body.y, z: body.z } : null,
    suggestedFeetPositions: safePlacementStandPositions(bot, position),
    reason:
      'Minecraft cannot place a block inside this body. Move to one suggested supported feet position, then retry the same placement cell.',
  };
}

function protectedBodySpaceConflict(
  places: InhabitantPlace[],
  position: BlockPosition,
  item: string,
  dimension: string,
) {
  if (isInteriorAmenity(item)) return null;
  const place = places.find(
    (candidate) =>
      (candidate.anchor.dimension == null ||
        !dimension ||
        candidate.anchor.dimension === dimension) &&
      candidate.protectedBodyCells.some(
        (cell) => cell.x === position.x && cell.y === position.y && cell.z === position.z,
      ),
  );
  if (!place) return null;
  return {
    ok: false,
    error: 'placement_would_fill_remembered_body_space',
    position,
    item,
    place: { id: place.id, label: place.label, anchor: place.anchor },
    protectedBodyCells: place.protectedBodyCells,
    reason:
      'This cell was witnessed as usable body space in a durable place. An ordinary structural block would destroy that affordance.',
    nextAffordance:
      'Choose a wall, roof, or exterior cell. A real interior amenity such as a chest, barrel, crafting table, furnace, bed, light, sign, or carpet may still be placed here.',
  };
}

function isInteriorAmenity(value: string) {
  const name = normalizeRegistryName(value);
  if (
    [
      'chest',
      'trapped_chest',
      'ender_chest',
      'barrel',
      'crafting_table',
      'furnace',
      'blast_furnace',
      'smoker',
      'stonecutter',
      'cartography_table',
      'fletching_table',
      'smithing_table',
      'loom',
      'anvil',
      'chipped_anvil',
      'damaged_anvil',
      'enchanting_table',
      'brewing_stand',
      'cauldron',
      'lectern',
    ].includes(name)
  ) {
    return true;
  }
  return (
    name.endsWith('_bed') ||
    name.endsWith('_torch') ||
    name.endsWith('_lantern') ||
    name.endsWith('_sign') ||
    name.endsWith('_hanging_sign') ||
    name.endsWith('_banner') ||
    name.endsWith('_carpet') ||
    name === 'torch' ||
    name === 'lantern'
  );
}

function safePlacementStandPositions(bot: Bot, target: BlockPosition) {
  const body = (bot as any).entity?.position;
  const candidates: Array<{ x: number; y: number; z: number; distance: number }> = [];
  for (const y of [target.y - 1, target.y, target.y + 1, target.y + 2]) {
    for (let radius = 1; radius <= 2; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const x = target.x + dx;
          const z = target.z + dz;
          const feet = (bot as any).blockAt?.(new Vec3(x, y, z));
          const head = (bot as any).blockAt?.(new Vec3(x, y + 1, z));
          const support = (bot as any).blockAt?.(new Vec3(x, y - 1, z));
          if (!bodyPassable(feet) || !bodyPassable(head) || !safeStairSupport(support)) continue;
          const standingBody = { x: x + 0.5, y, z: z + 0.5 };
          if (
            rangesOverlap(target.x, target.x + 1, standingBody.x - 0.3, standingBody.x + 0.3) &&
            rangesOverlap(target.y, target.y + 1, standingBody.y, standingBody.y + 1.8) &&
            rangesOverlap(target.z, target.z + 1, standingBody.z - 0.3, standingBody.z + 0.3)
          ) {
            continue;
          }
          const distance = body?.distanceTo?.(new Vec3(standingBody.x, y, standingBody.z)) ?? 0;
          candidates.push({ x, y, z, distance });
        }
      }
    }
  }
  return candidates
    .sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x || a.z - b.z)
    .slice(0, 6)
    .map(({ x, y, z }) => ({ x, y, z }));
}

function rangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number) {
  return aMin < bMax - 1e-6 && aMax > bMin + 1e-6;
}

function digPositionIssue(bot: Bot, position: BlockPosition) {
  const entity = (bot as any).entity;
  const body = entity?.position;
  if (![body?.x, body?.y, body?.z].every((value) => Number.isFinite(Number(value)))) return null;
  const feetY = Math.floor(body.y);
  if (position.y === feetY - 1) {
    const halfWidth = Math.max(0.1, Number(entity?.width) || 0.6) / 2;
    if (
      rangesOverlap(position.x, position.x + 1, body.x - halfWidth, body.x + halfWidth) &&
      rangesOverlap(position.z, position.z + 1, body.z - halfWidth, body.z + halfWidth)
    ) {
      return 'supporting_body';
    }
  }
  if (position.y < feetY - 1) return 'below_support_plane';
  return null;
}

function likelyGroundSupport(block: any) {
  if (!block || isAirBlock(block)) return false;
  const name = String(block.name || '').toLowerCase();
  return !(
    name === 'water' ||
    name === 'lava' ||
    name.endsWith('_leaves') ||
    name.endsWith('_log') ||
    name.endsWith('_stem')
  );
}

function safeStairSupport(block: any) {
  if (!isPlacementSupport(block)) return false;
  const name = normalizeRegistryName(String(block?.name || ''));
  return ![
    'campfire',
    'soul_campfire',
    'fire',
    'soul_fire',
    'magma_block',
    'cactus',
    'sweet_berry_bush',
    'powder_snow',
    'pointed_dripstone',
  ].includes(name);
}

function stairClearanceIssue(block: any): 'unloaded' | 'fluid' | 'hazard' | 'unbreakable' | null {
  if (!block) return 'unloaded';
  if (isAirBlock(block)) return null;
  const name = normalizeRegistryName(String(block.name || ''));
  if (name === 'water' || name === 'lava') return 'fluid';
  if (
    [
      'fire',
      'soul_fire',
      'cactus',
      'sweet_berry_bush',
      'powder_snow',
      'pointed_dripstone',
    ].includes(name)
  ) {
    return 'hazard';
  }
  if (
    block.diggable === false ||
    [
      'bedrock',
      'barrier',
      'command_block',
      'chain_command_block',
      'repeating_command_block',
    ].includes(name)
  ) {
    return 'unbreakable';
  }
  return null;
}

function ascentClearanceIssue(block: any): 'unloaded' | 'fluid' | 'hazard' | 'solid' | null {
  if (!block) return 'unloaded';
  if (isAirBlock(block)) return null;
  const name = normalizeRegistryName(String(block.name || ''));
  if (name === 'water' || name === 'lava') return 'fluid';
  if (
    [
      'fire',
      'soul_fire',
      'cactus',
      'sweet_berry_bush',
      'powder_snow',
      'pointed_dripstone',
    ].includes(name)
  ) {
    return 'hazard';
  }
  return block.boundingBox === 'empty' ? null : 'solid';
}

function oppositeCardinal(direction: string) {
  return ({ north: 'south', south: 'north', east: 'west', west: 'east' } as Record<string, string>)[
    direction.toLowerCase()
  ];
}

function describeDescentOptions(bot: Bot, start: { x: number; y: number; z: number }) {
  return Object.entries(CARDINAL_DIRECTIONS).map(([direction, vector]) => {
    const targetFeet = {
      x: start.x + vector.x,
      y: start.y - 1,
      z: start.z + vector.z,
    };
    const targetHead = { ...targetFeet, y: targetFeet.y + 1 };
    const supportPosition = { ...targetFeet, y: targetFeet.y - 1 };
    const head = (bot as any).blockAt?.(new Vec3(targetHead.x, targetHead.y, targetHead.z));
    const feet = (bot as any).blockAt?.(new Vec3(targetFeet.x, targetFeet.y, targetFeet.z));
    const support = (bot as any).blockAt?.(
      new Vec3(supportPosition.x, supportPosition.y, supportPosition.z),
    );
    const headIssue = stairClearanceIssue(head);
    const feetIssue = stairClearanceIssue(feet);
    const supportSafe = safeStairSupport(support);
    return {
      direction,
      targetFeet,
      head: String(head?.name || 'unloaded'),
      feet: String(feet?.name || 'unloaded'),
      support: String(support?.name || 'unloaded'),
      viable: supportSafe && headIssue == null && feetIssue == null,
      ...(!supportSafe
        ? { issue: 'unsafe_support' }
        : headIssue
          ? { issue: `${headIssue}_at_head` }
          : feetIssue
            ? { issue: `${feetIssue}_at_feet` }
            : {}),
    };
  });
}

function describeAscentOptions(bot: Bot, start: { x: number; y: number; z: number }) {
  return Object.entries(CARDINAL_DIRECTIONS).map(([direction, vector]) => {
    const targetFeet = {
      x: start.x + vector.x,
      y: start.y + 1,
      z: start.z + vector.z,
    };
    const targetHead = { ...targetFeet, y: targetFeet.y + 1 };
    const supportPosition = { ...targetFeet, y: targetFeet.y - 1 };
    const feet = (bot as any).blockAt?.(new Vec3(targetFeet.x, targetFeet.y, targetFeet.z));
    const head = (bot as any).blockAt?.(new Vec3(targetHead.x, targetHead.y, targetHead.z));
    const support = (bot as any).blockAt?.(
      new Vec3(supportPosition.x, supportPosition.y, supportPosition.z),
    );
    const feetIssue = ascentClearanceIssue(feet);
    const headIssue = ascentClearanceIssue(head);
    const supportSafe = safeStairSupport(support);
    return {
      direction,
      targetFeet,
      feet: String(feet?.name || 'unloaded'),
      head: String(head?.name || 'unloaded'),
      support: String(support?.name || 'unloaded'),
      viable: supportSafe && feetIssue == null && headIssue == null,
      ...(!supportSafe
        ? { issue: 'unsafe_support' }
        : feetIssue
          ? { issue: `${feetIssue}_at_feet` }
          : headIssue
            ? { issue: `${headIssue}_at_head` }
            : {}),
    };
  });
}

function inspectBlockVolume(
  bot: Bot,
  center: BlockPosition,
  radius: number,
  verticalRadius: number,
  bodyFeet: BlockPosition,
) {
  const bounds = {
    x: { min: center.x - radius, max: center.x + radius },
    y: { min: center.y - verticalRadius, max: center.y + verticalRadius },
    z: { min: center.z - radius, max: center.z + radius },
  };
  const names = new Map<string, number>();
  const cells = new Map<string, string>();
  let unloadedCells = 0;
  for (let y = bounds.y.min; y <= bounds.y.max; y += 1) {
    for (let z = bounds.z.min; z <= bounds.z.max; z += 1) {
      for (let x = bounds.x.min; x <= bounds.x.max; x += 1) {
        const block = (bot as any).blockAt?.(new Vec3(x, y, z));
        const rawName = block?.name == null ? null : normalizeRegistryName(String(block.name));
        const name = rawName == null ? 'unloaded' : isAirBlock(block) ? 'air' : rawName;
        cells.set(`${x},${y},${z}`, name);
        if (name === 'unloaded') unloadedCells += 1;
        else names.set(name, (names.get(name) || 0) + 1);
      }
    }
  }

  const symbols = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const materialNames = [...names.keys()]
    .filter((name) => name !== 'air')
    .sort((a, b) => a.localeCompare(b));
  const symbolFor = new Map<string, string>([
    ['air', '.'],
    ['unloaded', '?'],
  ]);
  materialNames.forEach((name, index) => symbolFor.set(name, symbols[index] || '*'));
  const palette: Record<string, string> = { '.': 'air', '?': 'unloaded' };
  for (const name of materialNames) palette[symbolFor.get(name)!] = name;
  if (materialNames.length > symbols.length) palette['*'] = 'other_material';

  const layers = [];
  for (let y = bounds.y.max; y >= bounds.y.min; y -= 1) {
    const rows = [];
    for (let z = bounds.z.min; z <= bounds.z.max; z += 1) {
      let cellsInRow = '';
      for (let x = bounds.x.min; x <= bounds.x.max; x += 1) {
        cellsInRow += symbolFor.get(cells.get(`${x},${y},${z}`) || 'unloaded') || '*';
      }
      rows.push({ z, cells: cellsInRow });
    }
    layers.push({ y, rows });
  }

  return {
    ok: true,
    source: 'loaded_local_terrain',
    visibility: 'unknown',
    center,
    bodyFeet,
    bounds,
    axes: {
      layers: 'y from max down to min',
      rows: 'z from min to max',
      cells: 'x from min to max',
    },
    palette,
    layers,
    materialCounts: [...names.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    unloadedCells,
    coordinateMeaning:
      'Each character denotes the block occupying that exact x,y,z cell; choose air or replaceable vegetation for place_block.',
    nextAffordance:
      'Place or remove one chosen block, then inspect again after several changes or whenever geometry becomes uncertain.',
  };
}

type ReachableBodyCell = BlockPosition & {
  support: string;
  ceiling: { x: number; y: number; z: number; name: string } | null;
};

function inspectReachableSpace(
  bot: Bot,
  seed: BlockPosition,
  radius: number,
  verticalRadius: number,
) {
  const seedSpace = bodySpaceAt(bot, seed);
  if (!seedSpace.standable) {
    return {
      ok: false,
      error: 'space_seed_not_standable',
      source: 'loaded_local_terrain',
      visibility: 'unknown',
      seedFeet: seed,
      seed: seedSpace,
      nearbyStandableFeet: nearbyStandableFeet(bot, seed, 2),
      reason:
        'A reachable-space seed needs passable feet and head cells plus safe solid support below.',
    };
  }

  const bounds = {
    x: { min: seed.x - radius, max: seed.x + radius },
    y: { min: seed.y - verticalRadius, max: seed.y + verticalRadius },
    z: { min: seed.z - radius, max: seed.z + radius },
  };
  const key = (position: BlockPosition) => `${position.x},${position.y},${position.z}`;
  const visited = new Map<string, ReachableBodyCell>();
  const queue: BlockPosition[] = [seed];

  while (queue.length > 0 && visited.size < 768) {
    const position = queue.shift()!;
    const positionKey = key(position);
    if (visited.has(positionKey)) continue;
    if (
      position.x < bounds.x.min ||
      position.x > bounds.x.max ||
      position.y < bounds.y.min ||
      position.y > bounds.y.max ||
      position.z < bounds.z.min ||
      position.z > bounds.z.max
    ) {
      continue;
    }
    const space = bodySpaceAt(bot, position);
    if (!space.standable) continue;
    visited.set(positionKey, {
      ...position,
      support: space.support,
      ceiling: ceilingAbove(bot, position, 4),
    });

    for (const direction of Object.values(CARDINAL_DIRECTIONS)) {
      for (const dy of [0, 1, -1]) {
        const next = {
          x: position.x + direction.x,
          y: position.y + dy,
          z: position.z + direction.z,
        };
        if (!visited.has(key(next)) && bodySpaceAt(bot, next).standable) queue.push(next);
      }
    }
  }

  const cells = [...visited.values()].sort(
    (a, b) => manhattan(seed, a) - manhattan(seed, b) || a.y - b.y || a.z - b.z || a.x - b.x,
  );
  const scanEdgeCells = cells.filter(
    (cell) =>
      cell.x === bounds.x.min ||
      cell.x === bounds.x.max ||
      cell.y === bounds.y.min ||
      cell.y === bounds.y.max ||
      cell.z === bounds.z.min ||
      cell.z === bounds.z.max,
  );
  const coveredCells = cells.filter((cell) => cell.ceiling != null);
  const allCoveredKeys = new Set(coveredCells.map(key));
  const protectedKeys = new Set<string>();
  const protectedQueue: BlockPosition[] = allCoveredKeys.has(key(seed)) ? [seed] : [];
  while (protectedQueue.length > 0) {
    const position = protectedQueue.shift()!;
    const positionKey = key(position);
    if (protectedKeys.has(positionKey) || !allCoveredKeys.has(positionKey)) continue;
    protectedKeys.add(positionKey);
    for (const candidate of coveredCells) {
      if (
        Math.abs(candidate.y - position.y) <= 1 &&
        Math.abs(candidate.x - position.x) + Math.abs(candidate.z - position.z) === 1
      ) {
        protectedQueue.push(candidate);
      }
    }
  }
  const protectedCells = coveredCells.filter((cell) => protectedKeys.has(key(cell)));
  const coveredKeys = new Set(protectedCells.map(key));
  const openings = new Map<string, any>();
  for (const inside of protectedCells) {
    for (const [directionName, direction] of Object.entries(CARDINAL_DIRECTIONS)) {
      const outside = cells.find(
        (candidate) =>
          candidate.x === inside.x + direction.x &&
          candidate.z === inside.z + direction.z &&
          Math.abs(candidate.y - inside.y) <= 1 &&
          !coveredKeys.has(key(candidate)),
      );
      if (!outside) continue;
      const openingKey = `${key(inside)}:${key(outside)}`;
      openings.set(openingKey, {
        direction: directionName,
        fromProtectedFeet: { x: inside.x, y: inside.y, z: inside.z },
        towardUncoveredFeet: { x: outside.x, y: outside.y, z: outside.z },
        candidateClosureCells: [
          { x: outside.x, y: outside.y, z: outside.z },
          { x: outside.x, y: outside.y + 1, z: outside.z },
        ],
      });
    }
  }

  const sealed = scanEdgeCells.length === 0;
  const fullyCovered = cells.length > 0 && coveredCells.length === cells.length;
  const sharedCapacity = sealed && fullyCovered && cells.length >= 2;
  const closableEntrances = findClosableEntrances(bot, protectedCells);
  const closableEntranceCount = closableEntrances.length;
  const problems = [
    ...(sealed ? [] : ['reachable body space escapes to the scan edge']),
    ...(fullyCovered
      ? []
      : [`${cells.length - coveredCells.length} reachable cells lack a nearby ceiling`]),
    ...(cells.length >= 2 ? [] : ['fewer than two reachable body cells fit']),
    ...(closableEntranceCount > 0
      ? []
      : ['no closed usable wooden door connects protected space to safe body space outside']),
  ];
  return {
    ok: true,
    source: 'loaded_local_terrain',
    visibility: 'unknown',
    seedFeet: seed,
    bounds,
    bodyModel:
      'one supported feet cell plus one passable head cell; cardinal steps may change y by one',
    reachableCellCount: cells.length,
    coveredCellCount: coveredCells.length,
    protectedRegionCellCount: protectedCells.length,
    sealed,
    fullyCovered,
    sharedCapacity,
    closableEntranceCount,
    closableEntrances,
    protectedCells: protectedCells.slice(0, 32).map(({ x, y, z, support, ceiling }) => ({
      feet: { x, y, z },
      support,
      ceiling,
    })),
    scanEdgeCells: scanEdgeCells.slice(0, 12).map(({ x, y, z }) => ({ x, y, z })),
    openingsFromProtectedSpace: [...openings.values()].slice(0, 12),
    problems,
    nextAffordance:
      sharedCapacity && closableEntranceCount > 0
        ? 'The scanned body space is sealed, covered, large enough for two, and has a usable closed entrance; preserve protectedCells as interior.'
        : sharedCapacity
          ? 'The sealed shared space has no usable entrance. Inspect its boundary, remove a two-block-high wall opening, then place a wooden door in that opening and inspect again from inside.'
          : openings.size > 0
            ? 'Close or door the reported candidateClosureCells without filling protectedCells, then inspect again from inside.'
            : 'Inspect a larger radius or choose a different supported interior feet cell before changing blocks.',
  };
}

function findClosableEntrances(bot: Bot, protectedCells: ReachableBodyCell[]) {
  const entrances = new Map<
    string,
    {
      name: string;
      lower: BlockPosition;
      upper: BlockPosition;
      state: 'closed';
      fromProtectedFeet: BlockPosition;
      outsideFeet: BlockPosition;
      outsideSupport: string;
    }
  >();

  for (const inside of protectedCells) {
    for (const direction of Object.values(CARDINAL_DIRECTIONS)) {
      const lower = {
        x: inside.x + direction.x,
        y: inside.y,
        z: inside.z + direction.z,
      };
      const upper = { ...lower, y: lower.y + 1 };
      const lowerBlock = (bot as any).blockAt?.(new Vec3(lower.x, lower.y, lower.z));
      const upperBlock = (bot as any).blockAt?.(new Vec3(upper.x, upper.y, upper.z));
      const name = normalizeRegistryName(String(lowerBlock?.name || ''));
      if (
        !name.endsWith('_door') ||
        name.startsWith('iron_') ||
        normalizeRegistryName(String(upperBlock?.name || '')) !== name ||
        blockProperties(lowerBlock).open !== false
      ) {
        continue;
      }

      const outsideFeet = {
        x: lower.x + direction.x,
        y: inside.y,
        z: lower.z + direction.z,
      };
      const outside = bodySpaceAt(bot, outsideFeet);
      if (!outside.standable) continue;
      const entranceKey = `${lower.x},${lower.y},${lower.z}`;
      entrances.set(entranceKey, {
        name,
        lower,
        upper,
        state: 'closed',
        fromProtectedFeet: { x: inside.x, y: inside.y, z: inside.z },
        outsideFeet,
        outsideSupport: outside.support,
      });
    }
  }

  return [...entrances.values()];
}

function bodySpaceAt(bot: Bot, feet: BlockPosition) {
  const feetBlock = (bot as any).blockAt?.(new Vec3(feet.x, feet.y, feet.z));
  const headBlock = (bot as any).blockAt?.(new Vec3(feet.x, feet.y + 1, feet.z));
  const supportBlock = (bot as any).blockAt?.(new Vec3(feet.x, feet.y - 1, feet.z));
  const feetPassable = bodyPassable(feetBlock);
  const headPassable = bodyPassable(headBlock);
  const supportSafe = safeStairSupport(supportBlock);
  return {
    standable: feetPassable && headPassable && supportSafe,
    feet: String(feetBlock?.name || 'unloaded'),
    head: String(headBlock?.name || 'unloaded'),
    support: String(supportBlock?.name || 'unloaded'),
    feetPassable,
    headPassable,
    supportSafe,
  };
}

function nearbyStandableFeet(bot: Bot, center: BlockPosition, radius: number) {
  const result: Array<{
    feet: BlockPosition;
    support: string;
    ceiling: { x: number; y: number; z: number; name: string } | null;
    distance: number;
  }> = [];
  for (let y = center.y - 1; y <= center.y + 1; y += 1) {
    for (let z = center.z - radius; z <= center.z + radius; z += 1) {
      for (let x = center.x - radius; x <= center.x + radius; x += 1) {
        const feet = { x, y, z };
        const space = bodySpaceAt(bot, feet);
        if (!space.standable) continue;
        result.push({
          feet,
          support: space.support,
          ceiling: ceilingAbove(bot, feet, 4),
          distance: manhattan(center, feet),
        });
      }
    }
  }
  return result
    .sort(
      (a, b) =>
        Number(b.ceiling != null) - Number(a.ceiling != null) ||
        a.distance - b.distance ||
        a.feet.y - b.feet.y ||
        a.feet.z - b.feet.z ||
        a.feet.x - b.feet.x,
    )
    .slice(0, 8)
    .map(({ distance: _distance, ...candidate }) => candidate);
}

function bodyPassable(block: any) {
  if (!block) return false;
  const name = normalizeRegistryName(String(block.name || ''));
  if (name === 'water' || name === 'lava' || name === 'powder_snow') return false;
  const properties = typeof block.getProperties === 'function' ? block.getProperties() : {};
  if (
    properties?.open === true &&
    (name.endsWith('_door') || name.endsWith('_trapdoor') || name.endsWith('_fence_gate'))
  ) {
    return true;
  }
  return isAirBlock(block) || block.boundingBox === 'empty';
}

function ceilingAbove(bot: Bot, feet: BlockPosition, maxClearance: number) {
  for (let y = feet.y + 2; y <= feet.y + maxClearance; y += 1) {
    const block = (bot as any).blockAt?.(new Vec3(feet.x, y, feet.z));
    if (!block) return null;
    if (!bodyPassable(block)) {
      return { x: feet.x, y, z: feet.z, name: String(block.name || 'unknown') };
    }
  }
  return null;
}

function manhattan(a: BlockPosition, b: BlockPosition) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

function adjacentSolidBlocks(bot: Bot, position: BlockPosition) {
  const offsets = [
    [0, 1, 0],
    [0, -1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  return offsets
    .map(([dx, dy, dz]) => {
      const block = (bot as any).blockAt?.(
        new Vec3(position.x + dx, position.y + dy, position.z + dz),
      );
      if (!block || isAirBlock(block)) return null;
      const candidate = { x: position.x + dx, y: position.y + dy, z: position.z + dz };
      if (digPositionIssue(bot, candidate)) return null;
      return {
        name: String(block.name || 'block'),
        position: candidate,
      };
    })
    .filter(Boolean);
}

function samePosition(value: any, expected: BlockPosition) {
  return (
    value != null &&
    Number(value.x) === expected.x &&
    Number(value.y) === expected.y &&
    Number(value.z) === expected.z
  );
}

function finiteNumber(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function waitForEntityEvent(bot: Bot, event: string, entityId: any, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      (bot as any).removeListener?.(event, listener);
      resolve(value);
    };
    const listener = (entity: any) => {
      if (String(entity?.id) === String(entityId)) finish(true);
    };
    const timer = setTimeout(() => finish(false), Math.max(1, timeoutMs));
    (bot as any).on?.(event, listener);
  });
}

function isDroppedItem(entity: any) {
  if (String(entity?.name || '').toLowerCase() === 'item') return true;
  try {
    return !!entity?.getDroppedItem?.();
  } catch {
    return false;
  }
}

function droppedItemName(entity: any) {
  try {
    const item = entity?.getDroppedItem?.();
    return String(item?.name || item?.displayName || 'item');
  } catch {
    return 'item';
  }
}

function observeCollection(bot: Bot, entityId: any) {
  let collected = false;
  let resolvePending: ((value: boolean) => void) | null = null;
  const pending = new Promise<boolean>((resolve) => {
    resolvePending = resolve;
  });
  const listener = (collector: any, item: any) => {
    if (collector?.id !== (bot as any).entity?.id) return;
    if (String(item?.id) !== String(entityId)) return;
    collected = true;
    resolvePending?.(true);
  };
  (bot as any).on?.('playerCollect', listener);
  return {
    async wait(timeoutMs: number) {
      if (collected) return true;
      let timer: NodeJS.Timeout | null = null;
      try {
        return await Promise.race([
          pending,
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), Math.max(1, timeoutMs));
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    close() {
      (bot as any).removeListener?.('playerCollect', listener);
    },
  };
}

async function boundedPickupNudge(
  bot: Bot,
  entity: any,
  watcher: { wait: (timeoutMs: number) => Promise<boolean> },
  timeoutMs: number,
) {
  const me = (bot as any).entity?.position;
  const target = entity?.position;
  const initialDistance = me && target ? me.distanceTo(target) : Infinity;
  const pickupGround = target ? droppedItemPickupGround(bot, target) : null;
  if (
    !me ||
    !target ||
    pickupGround?.status !== 'supported' ||
    initialDistance > 2.75 ||
    typeof (bot as any).setControlState !== 'function'
  ) {
    return {
      attempted: false,
      collected: false,
      reason:
        pickupGround && pickupGround.status !== 'supported'
          ? 'unapproachable_item_ground'
          : initialDistance > 2.75
            ? 'item_not_within_nudge_range'
            : 'direct_movement_unavailable',
      initialDistance: round(initialDistance),
      pickupGround,
    };
  }
  const oxygen = minecraftOxygenLevel((bot as any).oxygenLevel ?? (bot as any).oxygen);
  if (oxygen != null && oxygen <= 5) {
    return {
      attempted: false,
      collected: false,
      reason: 'oxygen_too_low_for_pickup_nudge',
      initialDistance: round(initialDistance),
      oxygen,
    };
  }

  const startedAt = Date.now();
  try {
    try {
      await (bot as any).lookAt(target.offset?.(0, 0.2, 0) ?? target, true);
    } catch {}
    (bot as any).setControlState('forward', true);
    const collected = await watcher.wait(clamp(Number(timeoutMs), 100, 2000));
    const final = positionOf(bot);
    const latestTarget = entity?.position;
    return {
      attempted: true,
      method: 'bounded_direct_nudge',
      collected,
      initialDistance: round(initialDistance),
      finalDistance: final && latestTarget ? round(distance(final, latestTarget)) : null,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    (bot as any).setControlState('forward', false);
  }
}

function normalizeRegistryName(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function namedRegistryEntry(registry: Record<string, any> | null | undefined, requested: string) {
  const query = normalizeRegistryName(requested);
  if (!query || !registry) return null;
  if (registry[query]) return registry[query];
  return (
    Object.values(registry)
      .filter((entry: any) => normalizeRegistryName(entry?.name || '').includes(query))
      .sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')))[0] ||
    null
  );
}

function registrySuggestions(
  registry: Record<string, any> | null | undefined,
  requested: string,
  limit = 8,
) {
  if (!registry) return [];
  const tokens = normalizeRegistryName(requested).split('_').filter(Boolean);
  return Object.values(registry)
    .map((entry: any) => String(entry?.name || ''))
    .filter((name) => name && tokens.some((token) => name.includes(token)))
    .sort()
    .slice(0, limit);
}

function inventorySnapshot(bot: Bot) {
  return itemSnapshot((bot as any).inventory?.items?.() || []);
}

function itemSnapshot(items: any[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = String(item?.name || 'unknown');
    counts.set(name, (counts.get(name) || 0) + Math.max(0, Number(item?.count) || 0));
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function countItems(items: any[], name: string) {
  const expected = normalizeRegistryName(name);
  return items
    .filter((item) => normalizeRegistryName(String(item?.name || '')) === expected)
    .reduce((total, item) => total + Math.max(0, Number(item?.count) || 0), 0);
}

function inventoryCount(bot: Bot, name: string) {
  return inventorySnapshot(bot)
    .filter((item) => item.name === name)
    .reduce((total, item) => total + item.count, 0);
}

function openContainerBodyCount(container: any, bot: Bot, name: string) {
  const items = typeof container?.items === 'function' ? container.items() : null;
  return items ? countItems(items, name) : inventoryCount(bot, name);
}

async function waitForInventoryTransaction(
  read: () => { body: number; container: number },
  expected: number,
  timeoutMs: number,
) {
  const deadline = Date.now() + clamp(timeoutMs, 1, 5000);
  let latest = read();
  while ((latest.body !== expected || latest.container !== expected) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    latest = read();
  }
  return latest;
}

function round(value: number) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : value;
}

async function runBoundedApproach(
  bot: Bot,
  selectedTarget: any,
  options: {
    targetReference: string;
    targetAtStart: any;
    isTargetPerceived: () => boolean;
    stopDistance: number;
    maxDistance: number;
    timeoutMs: number;
    signal?: AbortSignal;
  },
) {
  const startedAt = Date.now();
  const targetId = selectedTarget.id;
  const pathfinder = (bot as any).pathfinder;
  const startedDistance =
    (bot as any).entity?.position?.distanceTo(selectedTarget.position) ?? null;
  let lastSeenPosition = selectedTarget.position.clone();
  let lastGoalPosition = lastSeenPosition.clone();
  let lastPerceivedAt = startedAt;
  let lastPerceivedDistance = startedDistance;
  let currentlyPerceived = true;
  let pathfinderEngaged = false;
  let finalized = false;
  let pathFailure: string | null = null;
  const pathUpdates: string[] = [];
  const pathResets: string[] = [];

  const currentTarget = () => (bot as any).entities?.[targetId] ?? null;
  const refreshPerception = () => {
    const me = (bot as any).entity?.position;
    const target = currentTarget();
    if (!me || !target?.position || !options.isTargetPerceived()) {
      currentlyPerceived = false;
      return null;
    }
    currentlyPerceived = true;
    lastSeenPosition = target.position.clone();
    lastPerceivedAt = Date.now();
    lastPerceivedDistance = me.distanceTo(target.position);
    return target;
  };
  const evidence = () => {
    return {
      target: options.targetReference,
      targetEntityId: targetId,
      targetName: String(
        options.targetAtStart?.username || options.targetAtStart?.name || 'entity',
      ),
      targetAtStart: options.targetAtStart,
      startedDistance: startedDistance == null ? null : round(startedDistance),
      finalDistance:
        currentlyPerceived && lastPerceivedDistance != null ? round(lastPerceivedDistance) : null,
      lastSeenPosition: positionRecord(lastSeenPosition),
      lastPerceivedAt,
      targetPerceivedAtTerminal: currentlyPerceived,
      bodyStopDistance: options.stopDistance,
      bodyPursuitLimit: options.maxDistance,
      pathUpdates,
      pathResets,
      durationMs: Date.now() - startedAt,
    };
  };
  const finish = async (requestedTerminal: Record<string, any>): Promise<Record<string, any>> => {
    finalized = true;
    const pathfinderStopAcknowledged = pathfinderEngaged
      ? await stopDynamicPathfinder(bot, pathfinder)
      : true;
    if (!pathfinderStopAcknowledged) {
      if (options.signal?.aborted) {
        return {
          ...evidence(),
          ok: false,
          error: 'interruption_unconfirmed',
          confirmation: null,
          cancellation: { acknowledged: false, adapter: 'mineflayer-pathfinder' },
          pathfinderStopAcknowledged: false,
        };
      }
      return {
        ...evidence(),
        ok: false,
        error: 'pathfinder_stop_unconfirmed',
        confirmation: null,
        pathfinderStopAcknowledged: false,
      };
    }
    refreshPerception();
    const finalDistance = currentlyPerceived ? lastPerceivedDistance : null;
    const terminal =
      requestedTerminal.ok === true &&
      (finalDistance == null || finalDistance > options.stopDistance + 0.75)
        ? {
            ok: false,
            error: 'arrival_unconfirmed',
            confirmation: null,
            reason:
              finalDistance == null
                ? 'The selected entity was not in the current visual scene at arrival.'
                : 'The selected entity was still outside the body stop distance at arrival.',
            claimedTerminal: requestedTerminal,
          }
        : requestedTerminal;
    return {
      ...evidence(),
      ...terminal,
      pathfinderStopAcknowledged,
    };
  };
  const fail = (error: string, extra: Record<string, unknown> = {}) =>
    finish({ ok: false, error, confirmation: null, ...extra });
  const onPathUpdate = (result: any) => {
    if (result?.status) pathUpdates.push(String(result.status));
    if (result?.status === 'noPath') pathFailure = 'no_path';
    if (result?.status === 'timeout') pathFailure = 'navigation_timeout';
  };
  const onPathReset = (reason: any) => {
    pathResets.push(String(reason || 'unknown'));
  };

  if (startedDistance == null) return fail('body_or_target_position_unavailable');
  if (startedDistance > options.maxDistance) {
    return fail('target_not_in_reach', { distance: round(startedDistance) });
  }
  if (startedDistance <= options.stopDistance + 0.75) {
    try {
      await (bot as any).lookAt(
        selectedTarget.position.offset(
          0,
          Math.max(0.5, Number(selectedTarget.height || 1.6) * 0.8),
          0,
        ),
      );
    } catch {}
    return finish({
      ok: true,
      status: 'arrived',
      confirmation: 'mineflayer:body_target_proximity',
    });
  }
  if (!pathfinder?.setGoal || !pathfinder?.stop) return fail('pathfinder_unavailable');

  (bot as any).on?.('path_update', onPathUpdate);
  (bot as any).on?.('path_reset', onPathReset);
  try {
    pathfinder.setGoal(
      new (goals as any).GoalNear(
        lastSeenPosition.x,
        lastSeenPosition.y,
        lastSeenPosition.z,
        options.stopDistance,
      ),
    );
    pathfinderEngaged = true;
    while (true) {
      if (options.signal?.aborted) {
        return finish({
          ...cancelledAction('mineflayer-pathfinder'),
          confirmation: null,
        });
      }
      if (pathFailure) return fail(pathFailure);
      if (Date.now() - startedAt >= options.timeoutMs) return fail('approach_timeout');
      const target = refreshPerception();
      if (target && lastPerceivedDistance != null) {
        if (lastPerceivedDistance > options.maxDistance) {
          return fail('target_escaped', { distance: round(lastPerceivedDistance) });
        }
        if (lastSeenPosition.distanceTo(lastGoalPosition) > 0.75) {
          lastGoalPosition = lastSeenPosition.clone();
          pathfinder.setGoal(
            new (goals as any).GoalNear(
              lastGoalPosition.x,
              lastGoalPosition.y,
              lastGoalPosition.z,
              options.stopDistance,
            ),
          );
        }
      }
      if (target && lastPerceivedDistance! <= options.stopDistance + 0.75) {
        const result = await finish({
          ok: true,
          status: 'arrived',
          confirmation: 'mineflayer:body_target_proximity',
        });
        if (result.ok && currentTarget()?.position) {
          try {
            await (bot as any).lookAt(
              currentTarget().position.offset(
                0,
                Math.max(0.5, Number(currentTarget().height || 1.6) * 0.8),
                0,
              ),
            );
          } catch {}
        }
        return result;
      }
      const me = (bot as any).entity?.position;
      if (!me) return fail('body_or_target_position_unavailable');
      if (!target && me.distanceTo(lastSeenPosition) <= options.stopDistance + 0.75) {
        try {
          await (bot as any).lookAt(
            lastSeenPosition.offset(
              0,
              Math.max(0.5, Number(selectedTarget.height || 1.6) * 0.8),
              0,
            ),
          );
        } catch {}
        await waitForFightTick(50, options.signal);
        const reacquired = refreshPerception();
        if (!reacquired) {
          return fail('target_lost_at_last_seen', {
            lastSeenPosition: positionRecord(lastSeenPosition),
          });
        }
        if (lastPerceivedDistance! <= options.stopDistance + 0.75) {
          return finish({
            ok: true,
            status: 'arrived',
            confirmation: 'mineflayer:body_target_proximity',
          });
        }
        lastGoalPosition = lastSeenPosition.clone();
        pathfinder.setGoal(
          new (goals as any).GoalNear(
            lastGoalPosition.x,
            lastGoalPosition.y,
            lastGoalPosition.z,
            options.stopDistance,
          ),
        );
      }
      await waitForFightTick(100, options.signal);
    }
  } catch (error: any) {
    return fail(navigationError(error));
  } finally {
    (bot as any).removeListener?.('path_update', onPathUpdate);
    (bot as any).removeListener?.('path_reset', onPathReset);
    if (pathfinderEngaged && !finalized) {
      try {
        pathfinder.stop();
      } catch {}
    }
  }
}

function stopDynamicPathfinder(bot: Bot, pathfinder: any, timeoutMs = 500) {
  if (!pathfinder?.stop) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let fallback: NodeJS.Timeout | null = null;
    let timeout: NodeJS.Timeout | null = null;
    const finish = (acknowledged: boolean) => {
      if (settled) return;
      settled = true;
      if (fallback) clearTimeout(fallback);
      if (timeout) clearTimeout(timeout);
      (bot as any).removeListener?.('path_stop', onPathStop);
      resolve(acknowledged);
    };
    const onPathStop = () => finish(true);
    (bot as any).on?.('path_stop', onPathStop);
    try {
      pathfinder.stop();
    } catch {
      finish(false);
      return;
    }
    if (settled) return;
    fallback = setTimeout(
      () => {
        if (settled || typeof pathfinder.setGoal !== 'function') return;
        try {
          pathfinder.setGoal(null);
        } catch {}
      },
      Math.min(100, Math.max(1, timeoutMs - 1)),
    );
    timeout = setTimeout(() => finish(false), Math.max(1, timeoutMs));
  });
}

async function runBoundedFight(
  bot: Bot,
  selectedTarget: any,
  options: {
    targetReference: string;
    targetAtStart: any;
    isTargetPerceived: () => boolean;
    startedDistance: number;
    maxDistance: number;
    timeoutMs: number;
    signal?: AbortSignal;
  },
) {
  const startedAt = Date.now();
  const targetId = selectedTarget.id;
  const targetAtStart = options.targetAtStart;
  const pathfinder = (bot as any).pathfinder;
  const attackReach = 3;
  const attackIntervalMs = 650;
  let attacksAttempted = 0;
  let targetHurtEvents = 0;
  let attributedHits = 0;
  let targetDead = false;
  let selfDead = false;
  let pursuing = false;
  let pathfinderEngaged = false;
  let stopIssued = false;
  let currentlyPerceived = true;
  let lastSeenPosition = selectedTarget.position.clone();
  let pursuitGoalPosition: Vec3 | null = null;

  const currentTarget = () => (bot as any).entities?.[targetId] ?? null;
  const currentDistance = () => {
    if (!currentlyPerceived) return null;
    const me = (bot as any).entity?.position;
    const target = currentTarget();
    return me && target?.position ? me.distanceTo(target.position) : null;
  };
  const finish = (terminal: Record<string, unknown>) => {
    const finalDistance = currentDistance();
    return {
      ...terminal,
      target: targetAtStart,
      targetReference: options.targetReference,
      targetEntityId: targetId,
      startedDistance: round(options.startedDistance),
      finalDistance: finalDistance == null ? null : round(finalDistance),
      lastSeenPosition: positionRecord(lastSeenPosition),
      targetPerceivedAtTerminal: currentlyPerceived,
      attacksAttempted,
      targetHurtEvents,
      attributedHits,
      durationMs: Date.now() - startedAt,
    };
  };
  const fail = (error: string, extra: Record<string, unknown> = {}) =>
    finish({ ok: false, error, confirmation: null, ...extra });
  const requestStop = () => {
    if (!pursuing || !pathfinder?.stop) return !pursuing;
    try {
      pathfinder.stop();
      stopIssued = true;
      pursuing = false;
      return true;
    } catch {
      return false;
    }
  };
  const onTargetHurt = (entity: any, source: any) => {
    if (entity?.id !== targetId) return;
    targetHurtEvents += 1;
    if (source?.id === (bot as any).entity?.id) attributedHits += 1;
  };
  const onEntityDead = (entity: any) => {
    if (entity?.id === targetId) targetDead = true;
    if (entity?.id === (bot as any).entity?.id) selfDead = true;
  };
  const onSelfDeath = () => {
    selfDead = true;
  };
  const onAbort = () => requestStop();

  (bot as any).on('entityHurt', onTargetHurt);
  (bot as any).on('entityDead', onEntityDead);
  (bot as any).on('death', onSelfDeath);
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      if (options.signal?.aborted) {
        const stopAcknowledged = !pathfinderEngaged || stopIssued || requestStop();
        if (!stopAcknowledged) {
          return fail('interruption_unconfirmed', {
            cancellation: {
              acknowledged: false,
              adapter: 'mineflayer-combat',
            },
            pathfinderStopAcknowledged: false,
          });
        }
        return finish({
          ...cancelledAction('mineflayer-combat'),
          pathfinderStopAcknowledged: true,
          confirmation: null,
        });
      }
      if (targetDead && selfDead) {
        return fail('mutual_defeat', {
          targetDefeated: true,
          bodyDefeated: true,
          confirmations: ['mineflayer:entityDead', 'mineflayer:death'],
        });
      }
      if (targetDead) {
        return finish({
          ok: true,
          status: 'target_defeated',
          confirmation: 'mineflayer:entityDead',
        });
      }
      if (selfDead) {
        return fail('self_defeated', {
          confirmation: 'mineflayer:death',
        });
      }
      if (Date.now() - startedAt >= options.timeoutMs) {
        return fail('attack_timeout');
      }

      const target = currentTarget();
      if (!target?.position) {
        return fail('target_lost');
      }
      currentlyPerceived = options.isTargetPerceived();
      if (!currentlyPerceived) {
        requestStop();
        return fail('target_lost_from_view', {
          lastSeenPosition: positionRecord(lastSeenPosition),
        });
      }
      lastSeenPosition = target.position.clone();
      const me = (bot as any).entity?.position;
      const distanceToTarget = me?.distanceTo(target.position) ?? Infinity;
      if (distanceToTarget > options.maxDistance) {
        return fail('target_escaped', {
          maxDistance: options.maxDistance,
        });
      }

      if (distanceToTarget > attackReach) {
        if (!pathfinder?.setGoal) {
          return fail('pathfinder_unavailable');
        }
        if (!pursuing) {
          try {
            pursuitGoalPosition = lastSeenPosition.clone();
            pathfinder.setGoal(
              new (goals as any).GoalNear(
                pursuitGoalPosition.x,
                pursuitGoalPosition.y,
                pursuitGoalPosition.z,
                2.25,
              ),
            );
            pursuing = true;
            pathfinderEngaged = true;
          } catch (error: any) {
            return fail(navigationError(error));
          }
        } else if (pursuitGoalPosition && lastSeenPosition.distanceTo(pursuitGoalPosition) > 0.75) {
          try {
            pursuitGoalPosition = lastSeenPosition.clone();
            pathfinder.setGoal(
              new (goals as any).GoalNear(
                pursuitGoalPosition.x,
                pursuitGoalPosition.y,
                pursuitGoalPosition.z,
                2.25,
              ),
            );
          } catch (error: any) {
            return fail(navigationError(error));
          }
        }
        await waitForFightTick(
          Math.min(100, Math.max(0, options.timeoutMs - (Date.now() - startedAt))),
          options.signal,
        );
        continue;
      }

      requestStop();
      try {
        await (bot as any).lookAt(
          target.position.offset(0, Math.max(0.5, Number(target.height || 1.6) * 0.8), 0),
          true,
        );
      } catch {}
      if (options.signal?.aborted || targetDead || selfDead) continue;
      currentlyPerceived = options.isTargetPerceived();
      if (!currentlyPerceived) continue;
      try {
        (bot as any).attack(target);
        attacksAttempted += 1;
      } catch (error: any) {
        return fail('attack_failed', {
          detail: String(error?.message || error),
        });
      }
      await waitForFightTick(
        Math.min(attackIntervalMs, Math.max(0, options.timeoutMs - (Date.now() - startedAt))),
        options.signal,
      );
    }
  } finally {
    requestStop();
    (bot as any).removeListener('entityHurt', onTargetHurt);
    (bot as any).removeListener('entityDead', onEntityDead);
    (bot as any).removeListener('death', onSelfDeath);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function waitForFightTick(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

async function runPathfinderGoal(
  bot: Bot,
  goal: any,
  options: {
    destination: { x: number; y: number; z: number };
    near: number;
    timeoutMs: number;
    target?: string;
    signal?: AbortSignal;
    horizontalOnly?: boolean;
    movementEnvelope?: {
      maxHorizontalFromStart: number;
      maxVerticalFromStart: number;
    };
  },
) {
  const pathfinder = (bot as any).pathfinder;
  const startedAt = Date.now();
  const start = positionOf(bot);
  let timer: NodeJS.Timeout | null = null;
  let stopIssued = false;
  let movementLimit: {
    horizontalFromStart: number;
    verticalFromStart: number;
    maxHorizontalFromStart: number;
    maxVerticalFromStart: number;
  } | null = null;
  const requestStop = () => {
    try {
      pathfinder.stop();
      stopIssued = true;
    } catch {}
  };
  const enforceMovementEnvelope = () => {
    if (!start || !options.movementEnvelope || movementLimit) return;
    const current = positionOf(bot);
    if (!current) return;
    const horizontalFromStart = horizontalDistance(current, start);
    const verticalFromStart = Math.abs(current.y - start.y);
    if (
      horizontalFromStart <= options.movementEnvelope.maxHorizontalFromStart + 0.25 &&
      verticalFromStart <= options.movementEnvelope.maxVerticalFromStart + 0.25
    ) {
      return;
    }
    movementLimit = {
      horizontalFromStart: round(horizontalFromStart),
      verticalFromStart: round(verticalFromStart),
      ...options.movementEnvelope,
    };
    requestStop();
  };
  if (options.signal?.aborted) return cancelledAction('mineflayer-pathfinder');
  options.signal?.addEventListener('abort', requestStop, { once: true });
  if (options.movementEnvelope) (bot as any).on?.('move', enforceMovementEnvelope);
  try {
    await Promise.race([
      pathfinder.goto(goal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('navigation_timeout'));
          try {
            pathfinder.stop();
          } catch {}
        }, options.timeoutMs);
      }),
    ]);
    if (movementLimit) {
      return {
        ok: false,
        error: 'movement_envelope_exceeded',
        target: options.target,
        destination: options.destination,
        near: options.near,
        start,
        final: positionOf(bot),
        movementLimit,
        durationMs: Date.now() - startedAt,
      };
    }
    const final = positionOf(bot);
    const finalDistance = final
      ? options.horizontalOnly
        ? horizontalDistance(final, options.destination)
        : distance(final, options.destination)
      : null;
    const arrivalTolerance = options.near > 0 ? options.near + 0.75 : 1.25;
    if (finalDistance == null || finalDistance > arrivalTolerance) {
      return {
        ok: false,
        error: 'arrival_unconfirmed',
        target: options.target,
        destination: options.destination,
        near: options.near,
        start,
        final,
        finalDistance,
        arrivalTolerance,
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      ok: true,
      status: 'arrived',
      target: options.target,
      destination: options.destination,
      near: options.near,
      start,
      final,
      finalDistance,
      durationMs: Date.now() - startedAt,
    };
  } catch (error: any) {
    if (movementLimit) {
      return {
        ok: false,
        error: 'movement_envelope_exceeded',
        target: options.target,
        destination: options.destination,
        near: options.near,
        start,
        final: positionOf(bot),
        movementLimit,
        durationMs: Date.now() - startedAt,
      };
    }
    if (options.signal?.aborted && stopIssued && navigationError(error) === 'interrupted') {
      return {
        ...cancelledAction('mineflayer-pathfinder'),
        target: options.target,
        destination: options.destination,
        near: options.near,
        start,
        final: positionOf(bot),
        durationMs: Date.now() - startedAt,
      };
    }
    const final = positionOf(bot);
    return {
      ok: false,
      error: navigationError(error),
      target: options.target,
      destination: options.destination,
      near: options.near,
      start,
      final,
      finalDistance: final
        ? options.horizontalOnly
          ? horizontalDistance(final, options.destination)
          : distance(final, options.destination)
        : null,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', requestStop);
    if (options.movementEnvelope) (bot as any).removeListener?.('move', enforceMovementEnvelope);
  }
}

function cancelledAction(adapter: string) {
  return {
    ok: false,
    error: 'interrupted_by_human',
    cancellation: {
      acknowledged: true,
      adapter,
    },
  };
}

function currentVisibleBlockTarget(observation: any, reference: string) {
  if (
    observation?.protocol !== 'behold.inhabitant.v2' ||
    !Array.isArray(observation?.scene?.terrain?.targets)
  ) {
    return null;
  }
  const target = observation.scene.terrain.targets.find(
    (candidate: any) =>
      candidate?.id === reference &&
      candidate?.kind === 'block' &&
      candidate?.source === 'vision' &&
      candidate?.visibility === 'visible' &&
      typeof candidate?.name === 'string' &&
      [candidate?.position?.x, candidate?.position?.y, candidate?.position?.z].every((value) =>
        Number.isFinite(Number(value)),
      ),
  );
  return target || null;
}

function sameBlockPosition(first: any, second: any) {
  return (
    [first?.x, first?.y, first?.z, second?.x, second?.y, second?.z].every((value) =>
      Number.isFinite(Number(value)),
    ) &&
    Math.floor(Number(first.x)) === Math.floor(Number(second.x)) &&
    Math.floor(Number(first.y)) === Math.floor(Number(second.y)) &&
    Math.floor(Number(first.z)) === Math.floor(Number(second.z))
  );
}

function positionOf(bot: Bot) {
  const position = (bot as any).entity?.position;
  return position ? { x: position.x, y: position.y, z: position.z } : null;
}

function positionRecord(position: { x: number; y: number; z: number }) {
  return { x: round(position.x), y: round(position.y), z: round(position.z) };
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function horizontalDistance(a: { x: number; z: number }, b: { x: number; z: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

function navigationError(error: any) {
  const value = String(error?.message || error?.name || error || 'navigation_failed').toLowerCase();
  if (value.includes('no path')) return 'no_path';
  if (value.includes('stopped')) return 'interrupted';
  if (value.includes('changed')) return 'goal_changed';
  if (value.includes('timeout') || value.includes('too long')) return 'navigation_timeout';
  return String(error?.message || error || 'navigation_failed');
}

function normalizeYaw(value: number) {
  let angle = value;
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

function relativeHorizontalDirection(yaw: number, direction: string) {
  const vectors: Record<string, { x: number; z: number }> = {
    forward: { x: -Math.sin(yaw), z: -Math.cos(yaw) },
    back: { x: Math.sin(yaw), z: Math.cos(yaw) },
    left: { x: -Math.cos(yaw), z: Math.sin(yaw) },
    right: { x: Math.cos(yaw), z: -Math.sin(yaw) },
  };
  return vectors[direction] ?? null;
}

function relativeMovementEvidence(
  bot: Bot,
  start: { x: number; y: number; z: number },
  vector: { x: number; z: number },
) {
  const threshold = Math.sin(Math.PI / 8);
  let dx = Math.abs(vector.x) < threshold ? 0 : Math.sign(vector.x);
  let dz = Math.abs(vector.z) < threshold ? 0 : Math.sign(vector.z);
  if (dx === 0 && dz === 0) {
    if (Math.abs(vector.x) >= Math.abs(vector.z)) dx = Math.sign(vector.x);
    else dz = Math.sign(vector.z);
  }
  const feet = {
    x: Math.floor(start.x) + dx,
    y: Math.floor(start.y),
    z: Math.floor(start.z) + dz,
  };
  const space = bodySpaceAt(bot, feet);
  const issue = !space.feetPassable
    ? 'feet_blocked'
    : !space.headPassable
      ? 'head_blocked'
      : !space.supportSafe
        ? 'unsafe_support'
        : 'immediate_path_clear';
  return {
    scope: 'adjacent_body_space',
    issue,
    feet: { position: feet, block: space.feet, passable: space.feetPassable },
    head: {
      position: { ...feet, y: feet.y + 1 },
      block: space.head,
      passable: space.headPassable,
    },
    support: {
      position: { ...feet, y: feet.y - 1 },
      block: space.support,
      safe: space.supportSafe,
    },
  };
}

function orientationRecord(yaw: number, pitch: number) {
  const x = -Math.sin(yaw) * Math.cos(pitch);
  const z = -Math.cos(yaw) * Math.cos(pitch);
  const facing = Math.abs(x) > Math.abs(z) ? (x > 0 ? 'east' : 'west') : z > 0 ? 'south' : 'north';
  const vertical = pitch > Math.PI / 12 ? 'up' : pitch < -Math.PI / 12 ? 'down' : 'level';
  return {
    facing,
    vertical,
  };
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function minecraftChat(value: unknown, limit = 120) {
  const normalized = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const max = Math.max(1, limit);
  if (normalized.length <= max) return normalized;
  const clipped = normalized.slice(0, max);
  const boundary = clipped.lastIndexOf(' ');
  return boundary >= Math.floor(max * 0.6) ? clipped.slice(0, boundary) : clipped;
}
