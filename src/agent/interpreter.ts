import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import mcDataLoader from 'minecraft-data';
import { droppedItemPickupSafety, onlinePlayerNames } from './observation';
import { surveyArea } from '../skills/survey';
import {
  MANAGE_PROJECT_TOOL,
  PROJECT_EVIDENCE_VALUES,
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
  audience?: 'inhabitant' | 'operator' | 'privileged';
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
};

export function buildInterpreter(bot: Bot, opts: InterpreterOptions = {}) {
  const specs: CommandSpec[] = [];
  const add = (s: CommandSpec) => specs.push(s);

  if (opts.projects) {
    add({
      name: MANAGE_PROJECT_TOOL,
      description:
        'Start, update, complete, or abandon one sparse, restart-worthy project. Do not wrap one-step actions such as local walking, inspection, one-stack storage, equipping, or cleanup in a project; act directly instead. A project normally needs several meaningful actions and names a durable capability or commitment such as a crafted tool, shelter, stocked survival kit, distant journey, or shared build. Resolve legacy overlap before updating. A new or repaired project must name both a future doneWhen condition and the Minecraft evidence channel that can prove it. Completion is accepted only when your observation/action history contains a matching Minecraft witness after the project began.',
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
            enum: PROJECT_EVIDENCE_VALUES,
            description:
              'Required when starting and when repairing an older undefined project; the future Minecraft observation that can establish doneWhen. time_elapsed requires a named future boundary such as dawn, nightfall, or a duration; social_event must advance an existing relationship, not wait for an assignment.',
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
      'Walk to a feet position and return only after arrival or failure. This is one bounded walking leg, not teleportation. A block coordinate is a solid interaction target, not a feet destination; use dig_block for a block you want to mine.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        near: { type: 'number' },
        maxTravel: {
          type: 'number',
          minimum: 2,
          maximum: 16,
          description:
            'Optional short-horizon leg. When the requested destination is farther away, choose an intermediate feet destination at most this straight-line distance from the current body, then return a fresh observation before continuing.',
        },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 120000 },
      },
      required: ['x', 'y', 'z'],
    },
    run: async ({ x, y, z, near = 0, maxTravel, timeoutMs = 45_000 }, execution) => {
      const pathfinder = (bot as any).pathfinder;
      if (!pathfinder) return { ok: false, error: 'pathfinder_unavailable' };
      const requestedDestination = { x: Number(x), y: Number(y), z: Number(z) };
      const requestedNear = Math.max(0, Number(near) || 0);
      const start = positionOf(bot);
      const travelLimit = Number.isFinite(Number(maxTravel))
        ? clamp(Number(maxTravel), 2, 16)
        : null;
      const requestedDistance = start ? distance(start, requestedDestination) : null;
      const shouldAdvance =
        travelLimit != null &&
        requestedDistance != null &&
        requestedDistance > requestedNear + travelLimit;
      const ratio =
        shouldAdvance && requestedDistance != null && travelLimit != null
          ? travelLimit / requestedDistance
          : 1;
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
      const result = await runPathfinderGoal(bot, goal, {
        destination,
        near: effectiveNear,
        timeoutMs: clamp(Number(timeoutMs), 1000, 120_000),
        signal: execution?.signal,
      });
      const final = positionOf(bot);
      const remainingDistance = final ? distance(final, requestedDestination) : null;
      const arrivedAtRequestedDestination =
        result.ok && remainingDistance != null && remainingDistance <= requestedNear + 0.75;
      return {
        ...result,
        ...(result.ok
          ? { status: arrivedAtRequestedDestination ? 'arrived' : 'advanced_toward' }
          : {}),
        requestedDestination,
        requestedNear,
        ...(travelLimit == null ? {} : { maxTravel: travelLimit }),
        legDestination: destination,
        remainingDistance,
        arrivedAtRequestedDestination,
      };
    },
    category: 'move',
  });

  add({
    name: 'approach_entity',
    description:
      'Approach a nearby entity or player by stable name and stop at conversational distance',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        distance: { type: 'number', minimum: 1, maximum: 12 },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 120000 },
      },
      required: ['name'],
    },
    run: async ({ name, distance = 2.5, timeoutMs = 45_000 }, execution) => {
      const pathfinder = (bot as any).pathfinder;
      if (!pathfinder) return { ok: false, error: 'pathfinder_unavailable' };
      const targetName = String(name).toLowerCase();
      const target = (Object.values((bot as any).entities || {}) as any[]).find((entity) => {
        const candidate = String(entity?.username || entity?.name || '').toLowerCase();
        return entity?.position && (candidate === targetName || candidate.includes(targetName));
      });
      if (!target?.position)
        return { ok: false, error: 'entity_not_observed', target: String(name) };
      if (isDroppedItem(target)) {
        return {
          ok: false,
          error: 'use_safe_item_collection',
          reason:
            'Dropped items must be approached through collect_nearby_item so destination support and collection evidence are checked.',
        };
      }
      const stopDistance = clamp(Number(distance), 1, 12);
      const destination = {
        x: target.position.x,
        y: target.position.y,
        z: target.position.z,
      };
      const goal = new (goals as any).GoalNear(
        destination.x,
        destination.y,
        destination.z,
        stopDistance,
      );
      const result = await runPathfinderGoal(bot, goal, {
        destination,
        near: stopDistance,
        timeoutMs: clamp(Number(timeoutMs), 1000, 120_000),
        target: String(target.username || target.name || name),
        signal: execution?.signal,
      });
      if (result.ok && target?.position) {
        try {
          await (bot as any).lookAt(
            target.position.offset(0, Number(target.height || 1.6) * 0.8, 0),
          );
        } catch {}
      }
      return result;
    },
    category: 'move',
  });

  add({
    name: 'attack_entity',
    description:
      'Fight one observed nearby entity. This body follows, faces, and attacks that exact entity until Minecraft confirms its death, it escapes, this bounded attempt expires, this body dies, or a human interrupts.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        maxDistance: {
          type: 'number',
          minimum: 1,
          maximum: 16,
          description: 'Stop rather than pursuing the selected entity beyond this distance.',
        },
        timeoutMs: {
          type: 'number',
          minimum: 1000,
          maximum: 30000,
          description: 'Maximum duration of this one chosen fight.',
        },
      },
      required: ['name'],
    },
    run: async ({ name, maxDistance = 8, timeoutMs = 15_000 }, execution) => {
      const targetName = String(name).toLowerCase();
      const me = (bot as any).entity?.position;
      const pursuitLimit = clamp(Number(maxDistance), 1, 16);
      const target = (Object.values((bot as any).entities || {}) as any[])
        .filter((entity) => entity?.position && entity?.id !== (bot as any).entity?.id)
        .map((entity) => ({ entity, distance: me?.distanceTo(entity.position) ?? Infinity }))
        .filter(({ entity, distance }) => {
          const candidate = String(
            entity?.username || entity?.displayName || entity?.name || entity?.type || '',
          ).toLowerCase();
          return candidate.includes(targetName) && distance <= pursuitLimit;
        })
        .sort((a, b) => a.distance - b.distance)[0];
      if (!target) {
        return { ok: false, error: 'entity_not_in_reach', target: String(name) };
      }

      return runBoundedFight(bot, target.entity, {
        targetAtStart: summarizeEntity(target.entity),
        startedDistance: target.distance,
        maxDistance: pursuitLimit,
        timeoutMs: clamp(Number(timeoutMs), 100, 30_000),
        signal: execution?.signal,
      });
    },
    category: 'combat',
  });

  add({
    name: 'collect_nearby_item',
    description:
      'Pick up one nearby dropped item stack by walking this body over to it. Succeed only when Minecraft attributes the pickup to this body. If several dropped stacks remain, pick them up with additional actions before they expire.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        maxDistance: { type: 'number', minimum: 1, maximum: 32 },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 120000 },
      },
    },
    run: async ({ name, maxDistance = 16, timeoutMs = 45_000 }, execution) => {
      const pathfinder = (bot as any).pathfinder;
      if (!pathfinder) return { ok: false, error: 'pathfinder_unavailable' };
      const requested = name ? normalizeRegistryName(String(name)) : null;
      const query =
        requested && !['item', 'dropped_item', 'any'].includes(requested) ? requested : null;
      const me = (bot as any).entity?.position;
      const target = (Object.values((bot as any).entities || {}) as any[])
        .filter((entity) => isDroppedItem(entity) && entity?.position)
        .map((entity) => ({
          entity,
          item: droppedItemName(entity),
          distance: me?.distanceTo(entity.position) ?? Infinity,
        }))
        .filter(
          ({ item, distance }) =>
            distance <= Number(maxDistance) &&
            (!query || normalizeRegistryName(item).includes(query)),
        )
        .sort((a, b) => a.distance - b.distance)[0];
      if (!target) {
        return { ok: false, error: 'dropped_item_not_observed', requested: name || null };
      }

      const pickupSafety = droppedItemPickupSafety(bot, target.entity.position);
      if (!pickupSafety.ok) {
        return {
          ok: false,
          error: 'unsafe_item_destination',
          item: target.item,
          distance: round(target.distance),
          pickupSafety,
          reason:
            'The dropped stack is over an unsupported or hazardous destination. Do not pathfind or nudge into it.',
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
          timeoutMs: clamp(Number(timeoutMs), 1000, 120_000),
          target: target.item,
          signal: execution?.signal,
        },
      );
      let collected = await watcher.wait(navigation.ok ? 400 : 100);
      let pickupRecovery: any = null;
      if (!collected) {
        pickupRecovery = await boundedPickupNudge(bot, target.entity, watcher, 2000);
        collected = pickupRecovery.collected;
      }
      watcher.close();
      return {
        ok: collected,
        ...(collected ? {} : { error: 'collection_unconfirmed' }),
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
      if (placementIntersectsBody(bot, position)) {
        return placementBodyConflict(bot, position);
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

      const me = (bot as any).entity?.position;
      const targetDistance =
        me?.distanceTo?.(new Vec3(position.x + 0.5, position.y, position.z + 0.5)) ?? 0;
      let navigation: any = null;
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
    run: async ({ x, y, z, maxDistance = 5 }) =>
      activateToggleBlock(
        bot,
        { x: Number(x), y: Number(y), z: Number(z) },
        clamp(Number(maxDistance), 1, 6),
        opts,
      ),
    category: 'world',
    effects: { blockMutation: 'state' },
  });

  if (opts.places) {
    add({
      name: 'enter_place',
      description:
        'Enter one of self.places through its witnessed door. This approaches the outside feet cell, observes the current door state, opens only when closed, crosses to protected body space, optionally closes behind, and succeeds only after body arrival is confirmed.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact place id from self.places' },
          closeAfter: {
            type: 'boolean',
            description: 'Close the door after entering; default true',
          },
          timeoutMs: { type: 'number', minimum: 1000, maximum: 120000 },
        },
        required: ['id'],
      },
      run: async ({ id, closeAfter = true, timeoutMs = 45_000 }) => {
        const place = opts.places!().find((candidate) => candidate.id === String(id));
        if (!place) return { ok: false, error: 'remembered_place_not_found', id: String(id) };
        const dimension = String((bot as any).game?.dimension || '');
        if (place.anchor.dimension && dimension && place.anchor.dimension !== dimension) {
          return {
            ok: false,
            error: 'remembered_place_in_another_dimension',
            place: { id: place.id, dimension: place.anchor.dimension },
            currentDimension: dimension,
          };
        }
        const body = (bot as any).entity?.position;
        if (body && place.protectedBodyCells.some((cell) => bodyOccupiesCell(body, cell))) {
          return {
            ok: true,
            status: 'already_inside',
            place: { id: place.id, label: place.label },
            final: positionOf(bot),
          };
        }
        const entrance = nearestEntrance(place, body);
        if (!entrance?.insideFeet || !entrance.outsideFeet) {
          return {
            ok: false,
            error: 'remembered_place_has_no_traversable_entrance',
            place: { id: place.id, label: place.label },
          };
        }
        const budget = clamp(Number(timeoutMs), 1000, 120_000);
        const outsideNavigation = bodyOccupiesCell(body, entrance.outsideFeet)
          ? { ok: true, status: 'already_at_outside', final: positionOf(bot) }
          : await runPathfinderGoal(
              bot,
              new (goals as any).GoalBlock(
                entrance.outsideFeet.x,
                entrance.outsideFeet.y,
                entrance.outsideFeet.z,
              ),
              {
                destination: entrance.outsideFeet,
                near: 0,
                timeoutMs: budget,
                target: `${place.label} outside entrance`,
              },
            );
        if (!outsideNavigation.ok) {
          return {
            ok: false,
            error: 'place_entrance_outside_unreachable',
            place: { id: place.id, label: place.label },
            entrance,
            outsideNavigation,
          };
        }
        const outsideBody = (bot as any).entity?.position;
        if (!outsideBody || !bodyOccupiesCell(outsideBody, entrance.outsideFeet)) {
          return {
            ok: false,
            error: 'place_entrance_outside_arrival_unconfirmed',
            place: { id: place.id, label: place.label },
            entrance,
            outsideNavigation,
            final: positionOf(bot),
          };
        }

        const opened = await ensureDoorOpen(bot, entrance.lower, opts);
        if (!opened.ok) {
          return {
            ok: false,
            error: 'place_entrance_could_not_open',
            place: { id: place.id, label: place.label },
            entrance,
            outsideNavigation,
            door: opened,
          };
        }
        const insideNavigation = await crossOpenRememberedEntrance(bot, entrance, 'enter', budget);
        const finalBody = (bot as any).entity?.position;
        const arrivedInside =
          insideNavigation.ok &&
          !!finalBody &&
          place.protectedBodyCells.some((cell) => bodyOccupiesCell(finalBody, cell));
        if (!arrivedInside) {
          const doorRecovery =
            opened.changed?.property === 'open' && opened.changed?.before === false
              ? await ensureDoorClosed(bot, entrance.lower, opts)
              : null;
          return {
            ok: false,
            error: 'place_entry_arrival_unconfirmed',
            place: { id: place.id, label: place.label },
            entrance,
            outsideNavigation,
            door: opened,
            insideNavigation,
            doorRecovery,
            final: positionOf(bot),
          };
        }
        const closed = closeAfter ? await ensureDoorClosed(bot, entrance.lower, opts) : null;
        return {
          ok: closed == null || closed.ok,
          ...(closed && !closed.ok ? { error: 'entered_place_but_door_not_closed' } : {}),
          status: closed && closed.ok ? 'entered_and_closed_door' : 'entered',
          place: { id: place.id, label: place.label, anchor: place.anchor },
          entrance,
          outsideNavigation,
          doorOpened: opened,
          insideNavigation,
          doorClosed: closed,
          final: positionOf(bot),
          arrivedInside,
        };
      },
      category: 'move',
      effects: { blockMutation: 'state' },
    });

    add({
      name: 'leave_place',
      description:
        'Leave one of self.places through its witnessed door. This reaches the remembered inside feet cell, observes and opens the door only when necessary, crosses outside despite the physical door leaf, optionally closes behind, and succeeds only after outside body arrival is confirmed.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact place id from self.places' },
          closeAfter: {
            type: 'boolean',
            description: 'Close the door after leaving; default true',
          },
          timeoutMs: { type: 'number', minimum: 1000, maximum: 120000 },
        },
        required: ['id'],
      },
      run: async ({ id, closeAfter = true, timeoutMs = 45_000 }) => {
        const place = opts.places!().find((candidate) => candidate.id === String(id));
        if (!place) return { ok: false, error: 'remembered_place_not_found', id: String(id) };
        const dimension = String((bot as any).game?.dimension || '');
        if (place.anchor.dimension && dimension && place.anchor.dimension !== dimension) {
          return {
            ok: false,
            error: 'remembered_place_in_another_dimension',
            place: { id: place.id, dimension: place.anchor.dimension },
            currentDimension: dimension,
          };
        }
        const body = (bot as any).entity?.position;
        if (!body || !place.protectedBodyCells.some((cell) => bodyOccupiesCell(body, cell))) {
          return {
            ok: true,
            status: 'already_outside',
            place: { id: place.id, label: place.label },
            final: positionOf(bot),
          };
        }
        const entrance = nearestEntrance(place, body, 'inside');
        if (!entrance?.insideFeet || !entrance.outsideFeet) {
          return {
            ok: false,
            error: 'remembered_place_has_no_traversable_entrance',
            place: { id: place.id, label: place.label },
          };
        }
        const budget = clamp(Number(timeoutMs), 1000, 120_000);
        const insideApproach = bodyOccupiesCell(body, entrance.insideFeet)
          ? { ok: true, status: 'already_at_inside', final: positionOf(bot) }
          : await runPathfinderGoal(
              bot,
              new (goals as any).GoalBlock(
                entrance.insideFeet.x,
                entrance.insideFeet.y,
                entrance.insideFeet.z,
              ),
              {
                destination: entrance.insideFeet,
                near: 0,
                timeoutMs: budget,
                target: `${place.label} inside entrance`,
              },
            );
        const insideBody = (bot as any).entity?.position;
        if (
          !insideApproach.ok ||
          !insideBody ||
          !bodyOccupiesCell(insideBody, entrance.insideFeet)
        ) {
          return {
            ok: false,
            error: 'place_entrance_inside_arrival_unconfirmed',
            place: { id: place.id, label: place.label },
            entrance,
            insideApproach,
            final: positionOf(bot),
          };
        }
        const opened = await ensureDoorOpen(bot, entrance.lower, opts);
        if (!opened.ok) {
          return {
            ok: false,
            error: 'place_entrance_could_not_open',
            place: { id: place.id, label: place.label },
            entrance,
            insideApproach,
            door: opened,
          };
        }
        const outsideNavigation = await crossOpenRememberedEntrance(bot, entrance, 'leave', budget);
        const finalBody = (bot as any).entity?.position;
        const arrivedOutside =
          outsideNavigation.ok && !!finalBody && bodyOccupiesCell(finalBody, entrance.outsideFeet);
        if (!arrivedOutside) {
          const doorRecovery =
            opened.changed?.property === 'open' && opened.changed?.before === false
              ? await ensureDoorClosed(bot, entrance.lower, opts)
              : null;
          return {
            ok: false,
            error: 'place_exit_arrival_unconfirmed',
            place: { id: place.id, label: place.label },
            entrance,
            insideApproach,
            door: opened,
            outsideNavigation,
            doorRecovery,
            final: positionOf(bot),
          };
        }
        const closed = closeAfter ? await ensureDoorClosed(bot, entrance.lower, opts) : null;
        return {
          ok: closed == null || closed.ok,
          ...(closed && !closed.ok ? { error: 'left_place_but_door_not_closed' } : {}),
          status: closed && closed.ok ? 'left_and_closed_door' : 'left',
          place: { id: place.id, label: place.label, anchor: place.anchor },
          entrance,
          insideApproach,
          doorOpened: opened,
          outsideNavigation,
          doorClosed: closed,
          final: positionOf(bot),
          arrivedOutside,
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
  });

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
        return (
          ent?.name?.toLowerCase?.()?.includes(n) || ent?.username?.toLowerCase?.()?.includes(n)
        );
      };
      const e = (bot as any).nearestEntity(match);
      return { ok: true, entity: e ? summarizeEntity(e) : null };
    },
    category: 'sense',
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

async function activateToggleBlock(
  bot: Bot,
  position: BlockPosition,
  maxDistance: number,
  opts: InterpreterOptions,
): Promise<any> {
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
    await (bot as any).activateBlock(block);
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

async function ensureDoorOpen(bot: Bot, position: BlockPosition, opts: InterpreterOptions) {
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
  const toggled = await activateToggleBlock(bot, position, 4.5, opts);
  return {
    ...toggled,
    ok: toggled.ok && toggled.changed?.property === 'open' && toggled.changed?.after === true,
    ...(!toggled.ok || toggled.changed?.after !== true
      ? { error: toggled.error || 'door_did_not_open' }
      : {}),
  };
}

async function ensureDoorClosed(bot: Bot, position: BlockPosition, opts: InterpreterOptions) {
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
  const toggled = await activateToggleBlock(bot, position, 4.5, opts);
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

function nearestEntrance(
  place: InhabitantPlace,
  body: any,
  side: 'inside' | 'outside' = 'outside',
) {
  return [...place.entrances].sort((a, b) => {
    const leftFeet = side === 'inside' ? a.insideFeet : a.outsideFeet;
    const rightFeet = side === 'inside' ? b.insideFeet : b.outsideFeet;
    const left =
      body && leftFeet ? body.distanceTo?.(new Vec3(leftFeet.x, leftFeet.y, leftFeet.z)) : Infinity;
    const right =
      body && rightFeet
        ? body.distanceTo?.(new Vec3(rightFeet.x, rightFeet.y, rightFeet.z))
        : Infinity;
    return Number(left) - Number(right);
  })[0];
}

function bodyOccupiesCell(body: any, cell: { x: number; y: number; z: number }) {
  if (![body?.x, body?.y, body?.z].every((value) => Number.isFinite(Number(value)))) return false;
  return (
    Math.floor(Number(body.x)) === cell.x &&
    Math.abs(Number(body.y) - cell.y) <= 0.65 &&
    Math.floor(Number(body.z)) === cell.z
  );
}

async function crossOpenRememberedEntrance(
  bot: Bot,
  entrance: InhabitantPlace['entrances'][number],
  direction: 'enter' | 'leave',
  timeoutMs: number,
) {
  const origin = direction === 'enter' ? entrance.outsideFeet : entrance.insideFeet;
  const destinationFeet = direction === 'enter' ? entrance.insideFeet : entrance.outsideFeet;
  const lower = entrance.lower;
  const geometryValid =
    origin.y === destinationFeet.y &&
    lower.y === origin.y &&
    Math.abs(origin.x - destinationFeet.x) + Math.abs(origin.z - destinationFeet.z) === 2 &&
    lower.x * 2 === origin.x + destinationFeet.x &&
    lower.z * 2 === origin.z + destinationFeet.z;
  if (!geometryValid) {
    return {
      ok: false,
      error: 'remembered_entrance_geometry_invalid',
      direction,
      origin,
      destination: destinationFeet,
      lower,
    };
  }

  const door = (bot as any).blockAt?.(new Vec3(lower.x, lower.y, lower.z));
  const corridor = bodySpaceAt(bot, lower);
  const destinationSpace = bodySpaceAt(bot, destinationFeet);
  if (blockProperties(door).open !== true || !corridor.standable || !destinationSpace.standable) {
    return {
      ok: false,
      error: 'remembered_entrance_crossing_not_standable',
      door: summarizeObservedBlock(door),
      observedOpen: blockProperties(door).open ?? null,
      corridor,
      destination: destinationSpace,
    };
  }

  if (typeof (bot as any).setControlState !== 'function') {
    return runPathfinderGoal(
      bot,
      new (goals as any).GoalBlock(destinationFeet.x, destinationFeet.y, destinationFeet.z),
      {
        destination: destinationFeet,
        near: 0,
        timeoutMs,
        target: 'remembered place protected interior',
      },
    );
  }

  const startedAt = Date.now();
  const start = positionOf(bot);
  const attempts: any[] = [];
  const centerline = await boundedDirectBodyMove(bot, destinationFeet, {
    timeoutMs: Math.min(clamp(Number(timeoutMs), 250, 3500), 700),
    arrival: 'cell',
    route: 'doorway_centerline',
  });
  attempts.push(centerline);

  if (!centerline.ok) {
    const dx = Math.sign(destinationFeet.x - origin.x);
    const dz = Math.sign(destinationFeet.z - origin.z);
    const perpendiculars = [
      { x: dz, z: -dx },
      { x: -dz, z: dx },
    ];
    for (const perpendicular of perpendiculars) {
      const originSide = {
        x: origin.x + perpendicular.x,
        y: origin.y,
        z: origin.z + perpendicular.z,
      };
      const doorSide = {
        x: lower.x + perpendicular.x,
        y: lower.y,
        z: lower.z + perpendicular.z,
      };
      const originSideSpace = bodySpaceAt(bot, originSide);
      const doorSideSpace = bodySpaceAt(bot, doorSide);
      const routeCandidates = [
        {
          name: 'origin_side_around_open_leaf',
          waypoints: [originSide, doorSide, destinationFeet],
          spaces: [originSideSpace, doorSideSpace, destinationSpace],
        },
        {
          name: 'door_cell_around_open_leaf',
          waypoints: [lower, doorSide, destinationFeet],
          spaces: [corridor, doorSideSpace, destinationSpace],
        },
      ];
      for (const candidate of routeCandidates) {
        if (candidate.spaces.some((space) => !space.standable)) {
          attempts.push({
            ok: false,
            route: candidate.name,
            side: perpendicular,
            error: 'door_leaf_bypass_not_standable',
            spaces: candidate.spaces,
          });
          continue;
        }
        const routeAttempts = [];
        for (let index = 0; index < candidate.waypoints.length; index += 1) {
          routeAttempts.push(
            await boundedDirectBodyMove(bot, candidate.waypoints[index], {
              timeoutMs: index === candidate.waypoints.length - 1 ? 1600 : 1200,
              arrival: index === candidate.waypoints.length - 1 ? 'cell' : 'center',
              route: `${candidate.name}:${index + 1}`,
            }),
          );
          if (!routeAttempts.at(-1)?.ok) break;
        }
        attempts.push({
          ok:
            routeAttempts.length === candidate.waypoints.length &&
            routeAttempts.every((attempt) => attempt.ok),
          route: candidate.name,
          side: perpendicular,
          waypoints: candidate.waypoints,
          attempts: routeAttempts,
        });
        if (bodyOccupiesCell((bot as any).entity?.position, destinationFeet)) break;
      }
      if (bodyOccupiesCell((bot as any).entity?.position, destinationFeet)) break;
    }
  }

  const final = positionOf(bot);
  const arrived = bodyOccupiesCell((bot as any).entity?.position, destinationFeet);
  return {
    ok: arrived,
    ...(arrived ? {} : { error: 'bounded_doorway_crossing_unconfirmed' }),
    status: arrived ? 'arrived' : 'stopped_without_arrival',
    method: 'bounded_direct_doorway_crossing',
    direction,
    destination: destinationFeet,
    start,
    final,
    durationMs: Date.now() - startedAt,
    attempts,
    confirmation: arrived
      ? direction === 'enter'
        ? 'mineflayer:body_entered_remembered_protected_cell'
        : 'mineflayer:body_arrived_at_remembered_outside_cell'
      : null,
  };
}

async function boundedDirectBodyMove(
  bot: Bot,
  target: BlockPosition,
  options: { timeoutMs: number; arrival: 'cell' | 'center'; route: string },
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
  try {
    try {
      await (bot as any).lookAt(new Vec3(targetCenter.x, target.y + 1.2, targetCenter.z), true);
    } catch {}
    (bot as any).setControlState('forward', true);
    const deadline = startedAt + clamp(Number(options.timeoutMs), 100, 2000);
    while (!arrived() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    (bot as any).setControlState('forward', false);
  }
  const final = positionOf(bot);
  const ok = arrived();
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
  const pickupSafety = target ? droppedItemPickupSafety(bot, target) : null;
  if (
    !me ||
    !target ||
    !pickupSafety?.ok ||
    initialDistance > 2.75 ||
    typeof (bot as any).setControlState !== 'function'
  ) {
    return {
      attempted: false,
      collected: false,
      reason:
        pickupSafety && !pickupSafety.ok
          ? 'unsafe_item_destination'
          : initialDistance > 2.75
            ? 'item_not_within_nudge_range'
            : 'direct_movement_unavailable',
      initialDistance: round(initialDistance),
      pickupSafety,
    };
  }
  const oxygen = Number((bot as any).oxygenLevel ?? (bot as any).oxygen);
  if (Number.isFinite(oxygen) && oxygen <= 5) {
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

async function runBoundedFight(
  bot: Bot,
  selectedTarget: any,
  options: {
    targetAtStart: any;
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

  const currentTarget = () => (bot as any).entities?.[targetId] ?? null;
  const currentDistance = () => {
    const me = (bot as any).entity?.position;
    const target = currentTarget();
    return me && target?.position ? me.distanceTo(target.position) : null;
  };
  const finish = (terminal: Record<string, unknown>) => {
    const finalDistance = currentDistance();
    return {
      ...terminal,
      target: targetAtStart,
      targetEntityId: targetId,
      startedDistance: round(options.startedDistance),
      finalDistance: finalDistance == null ? null : round(finalDistance),
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
            pathfinder.setGoal(new (goals as any).GoalFollow(target, 2.25), true);
            pursuing = true;
            pathfinderEngaged = true;
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
  },
) {
  const pathfinder = (bot as any).pathfinder;
  const startedAt = Date.now();
  const start = positionOf(bot);
  let timer: NodeJS.Timeout | null = null;
  let stopIssued = false;
  const requestStop = () => {
    try {
      pathfinder.stop();
      stopIssued = true;
    } catch {}
  };
  if (options.signal?.aborted) return cancelledAction('mineflayer-pathfinder');
  options.signal?.addEventListener('abort', requestStop, { once: true });
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
    const final = positionOf(bot);
    const finalDistance = final ? distance(final, options.destination) : null;
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
      finalDistance: final ? distance(final, options.destination) : null,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', requestStop);
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

function positionOf(bot: Bot) {
  const position = (bot as any).entity?.position;
  return position ? { x: position.x, y: position.y, z: position.z } : null;
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function navigationError(error: any) {
  const value = String(error?.message || error?.name || error || 'navigation_failed').toLowerCase();
  if (value.includes('no path')) return 'no_path';
  if (value.includes('stopped')) return 'interrupted';
  if (value.includes('changed')) return 'goal_changed';
  if (value.includes('timeout') || value.includes('too long')) return 'navigation_timeout';
  return String(error?.message || error || 'navigation_failed');
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
