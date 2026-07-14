import type { Bot } from 'mineflayer';
import {
  collectObservation,
  type DroppedItemPickupGround,
  type NearbyEntitySummary,
} from './observation';
import type { InhabitantProject } from '../entity/projects';
import {
  findProjectPlaceConflicts,
  situatePlaces,
  type InhabitantPlace,
  type SituatedInhabitantPlace,
} from '../entity/places';

export type ObservationSource =
  | 'body'
  | 'cursor'
  | 'proximity'
  | 'server_roster'
  | 'local_volume'
  | 'event'
  | 'memory'
  | 'privileged';

export type TaskBrief = {
  id: string;
  goal: string;
  successConditions: string[];
  constraints: string[];
  target?: string | null;
};

export type ActionStatus =
  'queued' | 'selected' | 'started' | 'running' | 'completed' | 'failed' | 'interrupted';

export type ActionSnapshot = {
  id: string;
  tool: string;
  status: ActionStatus;
  source?: string;
  input?: unknown;
  startedAt?: number;
  updatedAt: number;
  result?: unknown;
  error?: string;
};

export type ExperienceEvent = {
  sequence: number;
  at: number;
  type: string;
  salience: 'ambient' | 'normal' | 'high' | 'urgent';
  source: ObservationSource;
  isNew?: boolean;
  data: any;
};

export type InhabitantObservation = {
  protocol: 'behold.inhabitant.v1';
  circle: {
    id: string;
    substrate: 'minecraft';
    managedRunId?: string;
  };
  sequence: number;
  observedAt: number;
  eventWindow: {
    requestedAfterSequence: number;
    oldestAvailableSequence: number | null;
    newestAvailableSequence: number | null;
    missingBeforeOldest: number;
    complete: boolean;
  };
  task: TaskBrief | null;
  self: {
    identity: string;
    pose: {
      position: { x: number; y: number; z: number } | null;
      yaw: number | null;
      pitch: number | null;
      velocity: { x: number; y: number; z: number } | null;
      onGround: boolean | null;
    };
    condition: {
      health: number | null;
      food: number | null;
      oxygen: number | null;
      dimension: string | null;
      isDay: boolean | null;
    };
    heldItem: string | null;
    inventory: Array<{ name: string; count: number }>;
    projects: InhabitantProject[];
    places: SituatedInhabitantPlace[];
    placeConflicts: ReturnType<typeof findProjectPlaceConflicts>;
    currentAction: ActionSnapshot | null;
  };
  scene: {
    social: {
      source: 'server_roster';
      playersOnline: string[] | null;
      note: string;
    };
    focus: SceneObject | null;
    entities: SceneEntity[];
    terrain: {
      source: 'local_volume';
      radius: number;
      verticalRadius: number;
      materials: Array<{
        name: string;
        count: number;
        nearest?: { x: number; y: number; z: number; distance: number };
      }>;
      note: string;
    };
  };
  events: ExperienceEvent[];
};

export type SceneObject = {
  id: string;
  kind: 'block' | 'entity';
  name: string;
  source: ObservationSource;
  position?: { x: number; y: number; z: number };
  distance?: number;
  reachable?: boolean;
};

export type SceneEntity = {
  id: string;
  kind: string;
  name: string;
  heldItem?: string | null;
  count?: number;
  pickupGround?: DroppedItemPickupGround;
  source: 'proximity';
  position: { x: number; y: number; z: number };
  distance: number;
  proximity: 'interaction' | 'nearby' | 'distant';
  relativeBearingRadians: number;
  relativeDirection:
    | 'ahead'
    | 'ahead-right'
    | 'right'
    | 'behind-right'
    | 'behind'
    | 'behind-left'
    | 'left'
    | 'ahead-left';
  visibility: 'unknown';
};

type EngineEvent = { type: string; at: number; data: any };

export type ExperienceOptions = {
  circleId?: string;
  managedRunId?: string | null;
  task?: TaskBrief | null;
  eventHistory?: number;
  pulseIntervalMs?: number;
  now?: () => number;
  projects?: () => InhabitantProject[];
  places?: () => InhabitantPlace[];
  onEvent?: (event: Readonly<ExperienceEvent>) => unknown;
  onEventError?: (error: unknown, event: Readonly<ExperienceEvent>) => void;
};

/**
 * Maintains the agent's continuity across otherwise stateless model turns.
 * It intentionally exposes embodied/proximity observations separately from
 * privileged server truth so a policy can reason about what it actually knows.
 */
export class InhabitantExperience {
  private readonly events: ExperienceEvent[] = [];
  private readonly cleanup: Array<() => void> = [];
  private readonly eventHistory: number;
  private readonly pulseIntervalMs: number;
  private readonly now: () => number;
  private sequence = 0;
  private currentAction: ActionSnapshot | null = null;
  private task: TaskBrief | null;
  private lastCondition: { health: number | null; food: number | null; oxygen: number | null };
  private lastInventory: Map<string, number>;
  private lastDayPhase: string | null;
  private lastWeather: boolean | null;
  private lastDimension: string | null;
  private lastPulseAt: number;
  private localWorldReady = false;

  constructor(
    private readonly bot: Bot,
    private readonly options: ExperienceOptions = {},
  ) {
    const opts = this.options;
    this.task = opts.task ?? null;
    this.eventHistory = Math.max(8, Math.min(200, Number(opts.eventHistory ?? 40)));
    this.pulseIntervalMs = Math.max(10_000, Number(opts.pulseIntervalMs ?? 30_000));
    this.now = opts.now ?? (() => Date.now());
    this.lastCondition = {
      health: finiteOrNull((this.bot as any).health),
      food: finiteOrNull((this.bot as any).food),
      oxygen: finiteOrNull((this.bot as any).oxygenLevel),
    };
    this.lastInventory = inventoryState(this.bot);
    this.lastDayPhase = dayPhase(this.bot);
    this.lastWeather = booleanOrNull((this.bot as any).isRaining);
    this.lastDimension = stringOrNull((this.bot as any).game?.dimension);
    this.lastPulseAt = this.now();
    this.bindWorldEvents();
  }

  setTask(task: TaskBrief | null) {
    this.task = task;
    this.record('task_updated', { task }, 'high', 'event');
  }

  markLocalWorldReady(settleMs = 0) {
    if (this.localWorldReady) return;
    this.localWorldReady = true;
    this.record(
      'local_world_ready',
      { initialSceneSynchronized: true, settleMs: Math.max(0, Number(settleMs) || 0) },
      'high',
      'body',
    );
  }

  record(
    type: string,
    data: any,
    salience: ExperienceEvent['salience'] = 'normal',
    source: ObservationSource = 'event',
  ) {
    const event: ExperienceEvent = {
      sequence: ++this.sequence,
      at: this.now(),
      type,
      salience,
      source,
      data,
    };
    this.events.push(event);
    if (this.events.length > this.eventHistory)
      this.events.splice(0, this.events.length - this.eventHistory);
    this.deliverEvent(event);
    return event;
  }

  private deliverEvent(event: ExperienceEvent) {
    if (!this.options.onEvent) return;
    const delivered = structuredClone(event);
    const report = (error: unknown) => this.options.onEventError?.(error, structuredClone(event));
    try {
      const result = this.options.onEvent(delivered);
      if (
        result &&
        (typeof result === 'object' || typeof result === 'function') &&
        typeof (result as PromiseLike<unknown>).then === 'function'
      ) {
        void Promise.resolve(result).catch(report);
      }
    } catch (error) {
      report(error);
    }
  }

  recordEngineEvent(event: EngineEvent) {
    const intent = event.data?.intent;
    const id = String(intent?.id || event.data?.action?.id || 'unknown');
    const tool = String(intent?.tool || event.data?.action?.tool || 'unknown');
    const updatedAt = Number(event.at || this.now());

    switch (event.type) {
      case 'intent_enqueued':
        this.currentAction = {
          id,
          tool,
          source: intent?.source,
          input: intent?.input,
          status: 'queued',
          updatedAt,
        };
        break;
      case 'intent_selected':
        this.currentAction = {
          id,
          tool,
          source: intent?.source,
          input: intent?.input,
          status: 'selected',
          updatedAt,
        };
        break;
      case 'action_started':
        this.currentAction = {
          id,
          tool,
          source: intent?.source,
          input: intent?.input,
          status: 'started',
          startedAt: updatedAt,
          updatedAt,
        };
        break;
      case 'tool_result':
        this.currentAction = {
          ...(this.currentAction?.id === id ? this.currentAction : { id, tool }),
          status: 'running',
          result: event.data?.result,
          updatedAt,
        } as ActionSnapshot;
        break;
      case 'action_completed':
        this.currentAction = {
          ...(this.currentAction?.id === id ? this.currentAction : { id, tool }),
          status: 'completed',
          result: event.data?.result,
          updatedAt,
        } as ActionSnapshot;
        break;
      case 'action_failed':
      case 'tool_error':
      case 'intent_blocked':
        this.currentAction = {
          ...(this.currentAction?.id === id ? this.currentAction : { id, tool }),
          status: 'failed',
          result: event.data?.result,
          error: String(event.data?.error || event.data?.reason || 'action_failed'),
          updatedAt,
        } as ActionSnapshot;
        break;
    }

    const salience =
      event.type === 'action_failed' || event.type === 'tool_error' ? 'high' : 'normal';
    this.record(event.type, event.data, salience, 'event');
  }

  observe(sinceSequence = 0): InhabitantObservation {
    this.captureStateTransitions();
    const base = collectObservation(this.bot, null);
    const entity: any = (this.bot as any).entity;
    const velocity = entity?.velocity;
    const focus = focusObject(this.bot);
    const yaw = finiteOrNull(entity?.yaw);
    const events = this.events.map((event) => ({
      ...event,
      isNew: event.sequence > sinceSequence,
    }));
    const oldestAvailableSequence = events[0]?.sequence ?? null;
    const newestAvailableSequence = events.at(-1)?.sequence ?? null;
    const missingBeforeOldest =
      oldestAvailableSequence == null
        ? 0
        : Math.max(0, oldestAvailableSequence - (Math.max(0, sinceSequence) + 1));
    const projects = this.options.projects?.() ?? [];
    const places = situatePlaces(
      this.options.places?.() ?? [],
      base.position,
      base.dimension == null ? null : String(base.dimension),
    );
    const managedRunId = stringOrNull(this.options.managedRunId);

    return {
      protocol: 'behold.inhabitant.v1',
      circle: {
        id: this.options.circleId || 'minecraft:unknown',
        substrate: 'minecraft',
        ...(managedRunId ? { managedRunId } : {}),
      },
      sequence: this.sequence,
      observedAt: this.now(),
      eventWindow: {
        requestedAfterSequence: Math.max(0, sinceSequence),
        oldestAvailableSequence,
        newestAvailableSequence,
        missingBeforeOldest,
        complete: missingBeforeOldest === 0,
      },
      task: this.task,
      self: {
        identity: String((this.bot as any).username || 'agent'),
        pose: {
          position: base.position,
          yaw,
          pitch: finiteOrNull(entity?.pitch),
          velocity: velocity
            ? { x: round(velocity.x), y: round(velocity.y), z: round(velocity.z) }
            : null,
          onGround: typeof entity?.onGround === 'boolean' ? entity.onGround : null,
        },
        condition: {
          health: finiteOrNull(base.health),
          food: finiteOrNull(base.food),
          oxygen: finiteOrNull(base.oxygen),
          dimension: base.dimension == null ? null : String(base.dimension),
          isDay: typeof base.isDay === 'boolean' ? base.isDay : null,
        },
        heldItem: base.heldItem,
        inventory: base.inventory,
        projects,
        places,
        placeConflicts: findProjectPlaceConflicts(projects, places),
        currentAction: this.currentAction,
      },
      scene: {
        social: {
          source: 'server_roster',
          playersOnline: base.onlinePlayers,
          note: 'Server presence only; it does not imply proximity, visibility, attention, or willingness to interact.',
        },
        focus,
        entities: base.nearbyEntities.map((nearby) => sceneEntity(nearby, base.position, yaw)),
        terrain: {
          source: 'local_volume',
          radius: 5,
          verticalRadius: 4,
          materials: base.nearbyBlocks,
          note: 'Material counts and nearest samples from a local volume; they are not a rendered view or proof of line of sight.',
        },
      },
      events,
    };
  }

  destroy() {
    for (const dispose of this.cleanup.splice(0)) dispose();
  }

  private bindWorldEvents() {
    const onChat = (username: string, message: string) => {
      if (username === (this.bot as any).username) return;
      const lower = String(message).toLowerCase();
      const name = String((this.bot as any).username || '').toLowerCase();
      const addressed = !!name && lower.includes(name);
      this.record(
        'chat_received',
        { from: username, text: message, addressed },
        addressed ? 'urgent' : 'high',
        'event',
      );
    };
    const onSpawn = () => this.record('spawned', {}, 'high', 'body');
    const onDeath = () => this.record('died', {}, 'urgent', 'body');
    const onHealth = () => {
      const next = {
        health: finiteOrNull((this.bot as any).health),
        food: finiteOrNull((this.bot as any).food),
        oxygen: finiteOrNull((this.bot as any).oxygenLevel),
      };
      const previous = this.lastCondition;
      if (
        next.health === previous.health &&
        next.food === previous.food &&
        next.oxygen === previous.oxygen
      ) {
        return;
      }
      this.lastCondition = next;
      const worsened =
        (previous.health != null && next.health != null && next.health < previous.health) ||
        (previous.food != null && next.food != null && next.food < previous.food) ||
        (previous.oxygen != null && next.oxygen != null && next.oxygen < previous.oxygen);
      const urgent =
        (next.health != null && next.health <= 6) || (next.oxygen != null && next.oxygen <= 5);
      this.record(
        'condition_changed',
        { previous, current: next },
        urgent ? 'urgent' : worsened ? 'high' : 'normal',
        'body',
      );
    };
    const onBlockUpdate = (oldBlock: any, newBlock: any) => {
      const position = newBlock?.position || oldBlock?.position;
      const me = (this.bot as any).entity?.position;
      if (!position || (me && me.distanceTo(position) > 32)) return;
      const before = oldBlock?.name || null;
      const after = newBlock?.name || null;
      if (before === after) return;
      this.record(
        'block_changed_nearby',
        {
          position: { x: position.x, y: position.y, z: position.z },
          before,
          after,
        },
        'normal',
        'proximity',
      );
    };
    const onEntitySpawn = (entity: any) => {
      const summary = nearbyEntityEvent(this.bot, entity);
      if (!summary || summary.distance > 16) return;
      this.record(
        'entity_appeared_nearby',
        {
          ...summary,
          observationPhase: this.localWorldReady ? 'live_world' : 'initial_world_sync',
        },
        summary.kind === 'player' || summary.distance <= 6 ? 'high' : 'ambient',
        'proximity',
      );
    };
    const onEntityGone = (entity: any) => {
      const summary = nearbyEntityEvent(this.bot, entity);
      if (!summary || summary.distance > 16) return;
      this.record('entity_left_nearby', summary, 'ambient', 'proximity');
    };
    const onEntityHurt = (entity: any) => {
      const summary = nearbyEntityEvent(this.bot, entity);
      if (!summary) return;
      const isSelf = entity?.id === (this.bot as any).entity?.id;
      if (!isSelf && summary.distance > 16) return;
      this.record(
        isSelf ? 'self_hurt' : 'entity_hurt_nearby',
        summary,
        isSelf ? 'urgent' : 'high',
        'body',
      );
    };
    const onEntityDead = (entity: any) => {
      const summary = nearbyEntityEvent(this.bot, entity);
      if (!summary || summary.distance > 16) return;
      this.record('entity_died_nearby', summary, 'high', 'proximity');
    };
    const onCollect = (collector: any, collected: any) => {
      if (collector?.id === (this.bot as any).entity?.id) {
        this.record(
          'item_collected',
          {
            collector: String((this.bot as any).username || 'agent'),
            item: entityLabel(collected),
          },
          'normal',
          'body',
        );
        return;
      }
      const summary = nearbyEntityEvent(this.bot, collector);
      if (!summary || summary.kind !== 'player' || summary.distance > 16) return;
      this.record(
        'nearby_player_collected_item',
        { collector: summary.name, item: entityLabel(collected), distance: summary.distance },
        'high',
        'proximity',
      );
    };
    const onEntityEquip = (entity: any) => {
      const summary = nearbyEntityEvent(this.bot, entity);
      if (!summary || summary.kind !== 'player' || summary.distance > 16) return;
      this.record(
        'nearby_player_equipment_changed',
        { ...summary, heldItem: itemLabel(entity?.heldItem) },
        'high',
        'proximity',
      );
    };
    const onSleep = () => this.record('fell_asleep', {}, 'high', 'body');
    const onWake = () => this.record('woke_up', {}, 'high', 'body');
    const onRain = () => this.captureStateTransitions();

    this.bind('chat', onChat);
    this.bind('spawn', onSpawn);
    this.bind('death', onDeath);
    this.bind('health', onHealth);
    this.bind('breath', onHealth);
    this.bind('blockUpdate', onBlockUpdate);
    this.bind('entitySpawn', onEntitySpawn);
    this.bind('entityGone', onEntityGone);
    this.bind('entityHurt', onEntityHurt);
    this.bind('entityDead', onEntityDead);
    this.bind('playerCollect', onCollect);
    this.bind('entityEquip', onEntityEquip);
    this.bind('sleep', onSleep);
    this.bind('wake', onWake);
    this.bind('rain', onRain);
  }

  private captureStateTransitions() {
    const inventory = inventoryState(this.bot);
    const inventoryChange = inventoryDelta(this.lastInventory, inventory);
    if (inventoryChange.added.length || inventoryChange.removed.length) {
      this.record('inventory_changed', inventoryChange, 'normal', 'body');
      this.lastInventory = inventory;
    }

    const phase = dayPhase(this.bot);
    if (phase && this.lastDayPhase && phase !== this.lastDayPhase) {
      this.record(
        'day_phase_changed',
        { previous: this.lastDayPhase, current: phase },
        phase === 'dusk' || phase === 'night' ? 'high' : 'normal',
        'body',
      );
    }
    this.lastDayPhase = phase;

    const weather = booleanOrNull((this.bot as any).isRaining);
    if (weather != null && this.lastWeather != null && weather !== this.lastWeather) {
      this.record('weather_changed', { raining: weather }, 'normal', 'body');
    }
    this.lastWeather = weather;

    const dimension = stringOrNull((this.bot as any).game?.dimension);
    if (dimension && this.lastDimension && dimension !== this.lastDimension) {
      this.record(
        'dimension_changed',
        { previous: this.lastDimension, current: dimension },
        'urgent',
        'body',
      );
    }
    this.lastDimension = dimension;

    const now = this.now();
    if (this.task == null && now - this.lastPulseAt >= this.pulseIntervalMs) {
      const elapsedMs = now - this.lastPulseAt;
      this.lastPulseAt = now;
      this.record('time_passed', { elapsedMs }, 'normal', 'body');
    }
  }

  private bind(event: string, listener: (...args: any[]) => void) {
    (this.bot as any).on?.(event, listener);
    this.cleanup.push(() => (this.bot as any).removeListener?.(event, listener));
  }
}

function focusObject(bot: Bot): SceneObject | null {
  try {
    const block: any = (bot as any).blockAtCursor?.(6);
    if (block?.position) {
      const me = (bot as any).entity?.position;
      const distance = me ? round(me.distanceTo(block.position)) : undefined;
      return {
        id: blockId((bot as any).game?.dimension, block.position),
        kind: 'block',
        name: String(block.name || 'block'),
        source: 'cursor',
        position: { x: block.position.x, y: block.position.y, z: block.position.z },
        distance,
        reachable: distance == null ? undefined : distance <= 6,
      };
    }
    const entity: any = (bot as any).entityAtCursor?.(3.5);
    if (entity?.position) {
      const me = (bot as any).entity?.position;
      const distance = me ? round(me.distanceTo(entity.position)) : undefined;
      return {
        id: entityId(entity),
        kind: 'entity',
        name: String(entity.username || entity.name || entity.type || 'entity'),
        source: 'cursor',
        position: {
          x: round(entity.position.x),
          y: round(entity.position.y),
          z: round(entity.position.z),
        },
        distance,
        reachable: distance == null ? undefined : distance <= 3.5,
      };
    }
  } catch {}
  return null;
}

function sceneEntity(
  entity: NearbyEntitySummary,
  selfPosition: { x: number; y: number; z: number } | null,
  selfYaw: number | null,
): SceneEntity {
  const dx = selfPosition ? entity.position.x - selfPosition.x : 0;
  const dz = selfPosition ? entity.position.z - selfPosition.z : 0;
  const targetYaw = Math.atan2(-dx, -dz);
  const relativeBearingRadians = normalizeAngle(targetYaw - (selfYaw ?? 0));
  return {
    id:
      entity.name === 'player' || entity.type === 'player'
        ? `player:${entity.name}`
        : `entity:${entity.id ?? entity.name}`,
    kind: String(entity.type || 'entity'),
    name: entity.name,
    heldItem: entity.heldItem,
    ...(entity.count != null ? { count: entity.count } : {}),
    ...(entity.pickupGround ? { pickupGround: entity.pickupGround } : {}),
    source: 'proximity',
    position: entity.position,
    distance: entity.distance,
    proximity: entity.distance <= 4 ? 'interaction' : entity.distance <= 12 ? 'nearby' : 'distant',
    relativeBearingRadians: round(relativeBearingRadians),
    relativeDirection: directionLabel(relativeBearingRadians),
    visibility: 'unknown',
  };
}

function entityId(entity: any) {
  return entity?.username
    ? `player:${entity.username}`
    : `entity:${entity?.id ?? entity?.name ?? 'unknown'}`;
}

function blockId(dimension: any, position: { x: number; y: number; z: number }) {
  return `block:${String(dimension || 'unknown')}:${position.x}:${position.y}:${position.z}`;
}

function directionLabel(angle: number): SceneEntity['relativeDirection'] {
  const index = Math.round(normalizeAngle(angle) / (Math.PI / 4));
  const labels: SceneEntity['relativeDirection'][] = [
    'ahead',
    'ahead-left',
    'left',
    'behind-left',
    'behind',
    'behind-right',
    'right',
    'ahead-right',
  ];
  return labels[(index + 8) % 8];
}

function normalizeAngle(angle: number) {
  let value = angle;
  while (value <= -Math.PI) value += Math.PI * 2;
  while (value > Math.PI) value -= Math.PI * 2;
  return value;
}

function finiteOrNull(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value: any) {
  return typeof value === 'boolean' ? value : null;
}

function stringOrNull(value: any) {
  return value == null ? null : String(value);
}

function inventoryState(bot: Bot) {
  const state = new Map<string, number>();
  for (const item of (bot as any).inventory?.items?.() || []) {
    const name = String(item?.name || item?.displayName || 'unknown');
    state.set(name, (state.get(name) || 0) + Math.max(0, Number(item?.count) || 0));
  }
  return state;
}

function inventoryDelta(before: Map<string, number>, after: Map<string, number>) {
  const names = new Set([...before.keys(), ...after.keys()]);
  const added: Array<{ name: string; count: number }> = [];
  const removed: Array<{ name: string; count: number }> = [];
  for (const name of [...names].sort()) {
    const change = (after.get(name) || 0) - (before.get(name) || 0);
    if (change > 0) added.push({ name, count: change });
    if (change < 0) removed.push({ name, count: -change });
  }
  return { added, removed };
}

function dayPhase(bot: Bot) {
  const raw = Number((bot as any).time?.timeOfDay ?? (bot as any).time?.time);
  if (!Number.isFinite(raw)) return null;
  const tick = ((raw % 24000) + 24000) % 24000;
  if (tick >= 23000 || tick < 1000) return 'dawn';
  if (tick < 11500) return 'day';
  if (tick < 13000) return 'dusk';
  return 'night';
}

function nearbyEntityEvent(bot: Bot, entity: any) {
  const me = (bot as any).entity?.position;
  const position = entity?.position;
  if (!position || !me) return null;
  return {
    id: entity?.username ? `player:${entity.username}` : `entity:${entity?.id ?? 'unknown'}`,
    name: entityLabel(entity),
    kind: String(entity?.type || entity?.name || 'entity'),
    position: { x: round(position.x), y: round(position.y), z: round(position.z) },
    distance: round(me.distanceTo(position)),
  };
}

function entityLabel(entity: any) {
  try {
    const dropped = entity?.getDroppedItem?.();
    if (dropped?.name) return String(dropped.name);
    if (dropped?.displayName) return String(dropped.displayName);
  } catch {}
  return String(
    entity?.username || entity?.displayName || entity?.name || entity?.type || 'entity',
  );
}

function itemLabel(item: any) {
  return item?.name || item?.displayName ? String(item.name || item.displayName) : null;
}

function round(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : number;
}
