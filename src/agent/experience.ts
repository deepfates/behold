import type { Bot } from 'mineflayer';
import {
  collectObservation,
  cursorTarget,
  entityIsVisible,
  type DroppedItemPickupGround,
  type FirstPersonVisualField,
  type NearbyEntitySummary,
  worldPositionIsVisible,
} from './observation';
import type { InhabitantProject } from '../entity/projects';
import {
  bodyConditionBecameOrWorsenedCritical,
  isCriticalBodyCondition,
  minecraftOxygenLevel,
} from './condition';
import {
  findProjectPlaceConflicts,
  situatePlaces,
  type InhabitantPlace,
  type SituatedInhabitantPlace,
} from '../entity/places';
import { projectResidentVisibleValue } from '../mind/resident-visibility';

export type ObservationSource =
  'body' | 'cursor' | 'vision' | 'sound' | 'server_roster' | 'event' | 'memory' | 'privileged';

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
  protocol: 'behold.inhabitant.v2';
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
      source: 'vision';
      horizontalFovDegrees: number;
      verticalFovDegrees: number;
      maxDistance: number;
      raysCast: number;
      raysHit: number;
      failedRays: number;
      materials: Array<{
        name: string;
        count: number;
        nearest?: { x: number; y: number; z: number; distance: number };
      }>;
      visualField: FirstPersonVisualField;
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
  source: 'vision';
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
  visibility: 'visible';
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
 * It intentionally exposes embodied, visual, auditory, and remembered
 * observations separately from privileged server truth so a policy can reason
 * about what this body actually knows.
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
  private readonly visibleEntities = new Map<
    string,
    NonNullable<ReturnType<typeof nearbyEntityEvent>>
  >();
  private readonly lastSoundAt = new Map<string, number>();
  private visualSceneInitialized = false;

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
      oxygen: minecraftOxygenLevel((this.bot as any).oxygenLevel),
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
    const projects = this.options.projects?.() ?? [];
    const places = projectResidentVisibleValue(
      situatePlaces(
        this.options.places?.() ?? [],
        base.position,
        base.dimension == null ? null : String(base.dimension),
      ),
    ) as SituatedInhabitantPlace[];
    const managedRunId = stringOrNull(this.options.managedRunId);
    const sceneEntities = base.nearbyEntities.map((nearby) =>
      sceneEntity(nearby, base.position, yaw),
    );
    this.syncVisibleEntities(sceneEntities);
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

    return {
      protocol: 'behold.inhabitant.v2',
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
          oxygen: this.lastCondition.oxygen,
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
        entities: sceneEntities,
        terrain: {
          source: 'vision',
          horizontalFovDegrees: base.vision.horizontalFovDegrees,
          verticalFovDegrees: base.vision.verticalFovDegrees,
          maxDistance: base.vision.maxDistance,
          raysCast: base.vision.raysCast,
          raysHit: base.vision.raysHit,
          failedRays: base.vision.failedRays,
          materials: base.nearbyBlocks,
          visualField: base.vision.visualField,
          note: 'The material summary and compact visual field contain only first selectable surfaces from the same fixed camera-ray budget. They are semantic vision, not pixels or a loaded-volume scan.',
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
      const previous = this.lastCondition;
      const next = {
        health: finiteOrNull((this.bot as any).health),
        food: finiteOrNull((this.bot as any).food),
        oxygen: minecraftOxygenLevel((this.bot as any).oxygenLevel) ?? previous.oxygen,
      };
      this.lastCondition = next;
      if (!conditionMeaningfullyChanged(previous, next)) return;
      const worsened =
        (previous.health != null && next.health != null && next.health < previous.health) ||
        (previous.food != null && next.food != null && next.food < previous.food) ||
        (previous.oxygen != null &&
          next.oxygen != null &&
          oxygenDisplayBand(next.oxygen) < oxygenDisplayBand(previous.oxygen));
      const urgent = bodyConditionBecameOrWorsenedCritical(previous, next);
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
      if (
        !position ||
        (me && me.distanceTo(position) > 32) ||
        !worldPositionIsVisible(this.bot, position)
      ) {
        return;
      }
      const before = oldBlock?.name || null;
      const after = newBlock?.name || null;
      if (before === after) return;
      this.record(
        'visible_block_changed',
        {
          position: { x: position.x, y: position.y, z: position.z },
          before,
          after,
        },
        'normal',
        'vision',
      );
    };
    const onEntitySpawn = (entity: any) => this.captureEntityVisibility(entity);
    const onEntityMoved = (entity: any) => this.captureEntityVisibility(entity);
    const onEntityGone = (entity: any) => {
      const reference = entityReference(entity);
      const previous = this.visibleEntities.get(reference);
      if (!previous) return;
      this.visibleEntities.delete(reference);
      this.record(
        'entity_left_view',
        {
          id: previous.id,
          name: previous.name,
          kind: previous.kind,
          lastSeenDistance: previous.distance,
          reason: 'no_longer_rendered',
        },
        'ambient',
        'vision',
      );
    };
    const onEntityHurt = (entity: any) => {
      const isSelf = entity?.id === (this.bot as any).entity?.id;
      const summary = isSelf
        ? nearbyEntityEvent(this.bot, entity)
        : visibleEntityEvent(this.bot, entity);
      if (!summary) return;
      this.record(
        isSelf ? 'self_hurt' : 'visible_entity_hurt',
        summary,
        isSelf ? 'urgent' : 'high',
        isSelf ? 'body' : 'vision',
      );
    };
    const onEntityDead = (entity: any) => {
      const summary = visibleEntityEvent(this.bot, entity);
      if (!summary) return;
      this.record('visible_entity_died', summary, 'high', 'vision');
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
      const summary = visibleEntityEvent(this.bot, collector);
      if (!summary || summary.kind !== 'player') return;
      this.record(
        'visible_player_collected_item',
        { collector: summary.name, item: entityLabel(collected), distance: summary.distance },
        'high',
        'vision',
      );
    };
    const onEntityEquip = (entity: any) => {
      const summary = visibleEntityEvent(this.bot, entity);
      if (!summary || summary.kind !== 'player') return;
      this.record(
        'visible_player_equipment_changed',
        { ...summary, heldItem: itemLabel(entity?.heldItem) },
        'high',
        'vision',
      );
    };
    const onSound = (soundName: string, position: any, volume: number, pitch: number) =>
      this.captureSound(soundName, position, volume, pitch);
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
    this.bind('entityMoved', onEntityMoved);
    this.bind('entityGone', onEntityGone);
    this.bind('entityHurt', onEntityHurt);
    this.bind('entityDead', onEntityDead);
    this.bind('playerCollect', onCollect);
    this.bind('entityEquip', onEntityEquip);
    this.bind('soundEffectHeard', onSound);
    this.bind('sleep', onSleep);
    this.bind('wake', onWake);
    this.bind('rain', onRain);
  }

  private syncVisibleEntities(entities: SceneEntity[]) {
    const next = new Map<string, NonNullable<ReturnType<typeof nearbyEntityEvent>>>();
    for (const entity of entities) {
      next.set(entity.id, {
        id: entity.id,
        name: entity.name,
        kind: entity.kind,
        position: { ...entity.position },
        distance: entity.distance,
      });
    }
    const appeared = this.visualSceneInitialized
      ? [...next.entries()].filter(([reference]) => !this.visibleEntities.has(reference))
      : [];
    const disappeared = this.visualSceneInitialized
      ? [...this.visibleEntities.entries()].filter(([reference]) => !next.has(reference))
      : [];
    this.visibleEntities.clear();
    for (const [reference, entity] of next) this.visibleEntities.set(reference, entity);
    this.visualSceneInitialized = true;
    if (appeared.length || disappeared.length) {
      for (const [, entity] of appeared) {
        this.record(
          'entity_became_visible',
          {
            ...entity,
            observationPhase: this.localWorldReady ? 'live_world' : 'initial_world_sync',
          },
          entity.kind === 'player' || entity.distance <= 6 ? 'high' : 'ambient',
          'vision',
        );
      }
      for (const [, entity] of disappeared) {
        this.record(
          'entity_left_view',
          {
            id: entity.id,
            name: entity.name,
            kind: entity.kind,
            lastSeenDistance: entity.distance,
            reason: 'outside_current_view',
          },
          'ambient',
          'vision',
        );
      }
    }
  }

  private captureEntityVisibility(entity: any) {
    const reference = entityReference(entity);
    const previous = this.visibleEntities.get(reference);
    const visible = visibleEntityEvent(this.bot, entity);
    if (visible) {
      this.visibleEntities.set(reference, visible);
      if (previous) return;
      this.record(
        'entity_became_visible',
        {
          ...visible,
          observationPhase: this.localWorldReady ? 'live_world' : 'initial_world_sync',
        },
        visible.kind === 'player' || visible.distance <= 6 ? 'high' : 'ambient',
        'vision',
      );
      return;
    }
    if (!previous) return;
    this.visibleEntities.delete(reference);
    this.record(
      'entity_left_view',
      {
        id: previous.id,
        name: previous.name,
        kind: previous.kind,
        lastSeenDistance: previous.distance,
        reason: 'outside_current_view',
      },
      'ambient',
      'vision',
    );
  }

  private captureSound(soundName: string, position: any, volume: number, pitch: number) {
    const me = (this.bot as any).entity?.position;
    if (!me || !position) return;
    const distance = me.distanceTo(position);
    if (!Number.isFinite(distance) || distance > 64) return;
    const band = distance <= 4 ? 'immediate' : distance <= 12 ? 'nearby' : 'distant';
    const dx = position.x - me.x;
    const dz = position.z - me.z;
    const targetYaw = Math.atan2(-dx, -dz);
    const relative = normalizeAngle(targetYaw - (finiteOrNull((this.bot as any).entity?.yaw) ?? 0));
    const direction = directionLabel(relative);
    const sound = boundedText(soundName, 160) || 'unknown';
    const key = `${sound}:${band}:${direction}`;
    const now = this.now();
    const previous = this.lastSoundAt.get(key) ?? -Infinity;
    if (now - previous < 750) return;
    this.lastSoundAt.set(key, now);
    if (this.lastSoundAt.size > 64) {
      for (const [candidate, at] of this.lastSoundAt) {
        if (now - at > 10_000) this.lastSoundAt.delete(candidate);
      }
    }
    this.record(
      'sound_heard',
      {
        sound,
        distanceBand: band,
        relativeDirection: direction,
        volume: round(volume),
        pitch: round(pitch),
      },
      soundSalience(sound, band),
      'sound',
    );
  }

  private captureStateTransitions() {
    const inventory = inventoryState(this.bot);
    const inventoryChange = inventoryDelta(this.lastInventory, inventory);
    this.lastInventory = inventory;
    if (inventoryChange.added.length || inventoryChange.removed.length) {
      this.record('inventory_changed', inventoryChange, 'normal', 'body');
    }

    const phase = dayPhase(this.bot);
    const previousPhase = this.lastDayPhase;
    this.lastDayPhase = phase;
    if (phase && previousPhase && phase !== previousPhase) {
      this.record(
        'day_phase_changed',
        { previous: previousPhase, current: phase },
        phase === 'dusk' || phase === 'night' ? 'high' : 'normal',
        'body',
      );
    }

    const weather = booleanOrNull((this.bot as any).isRaining);
    const previousWeather = this.lastWeather;
    this.lastWeather = weather;
    if (weather != null && previousWeather != null && weather !== previousWeather) {
      this.record('weather_changed', { raining: weather }, 'normal', 'body');
    }

    const dimension = stringOrNull((this.bot as any).game?.dimension);
    const previousDimension = this.lastDimension;
    this.lastDimension = dimension;
    if (dimension && previousDimension && dimension !== previousDimension) {
      this.record(
        'dimension_changed',
        { previous: previousDimension, current: dimension },
        'urgent',
        'body',
      );
    }

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
    const target = cursorTarget(bot, 6, 3.5);
    if (target?.kind === 'entity' && target.entity?.position) {
      const entity = target.entity;
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
        distance: target.distance,
        reachable: target.distance <= 3.5,
      };
    }
    if (target?.kind === 'block' && target.block?.position) {
      const block = target.block;
      return {
        id: blockId((bot as any).game?.dimension, block.position),
        kind: 'block',
        name: String(block.name || 'block'),
        source: 'cursor',
        position: {
          x: block.position.x,
          y: block.position.y,
          z: block.position.z,
        },
        distance: target.distance,
        reachable: target.distance <= 6,
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
    source: 'vision',
    position: entity.position,
    distance: entity.distance,
    proximity: entity.distance <= 4 ? 'interaction' : entity.distance <= 12 ? 'nearby' : 'distant',
    relativeBearingRadians: round(relativeBearingRadians),
    relativeDirection: directionLabel(relativeBearingRadians),
    visibility: 'visible',
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

/**
 * Mineflayer exposes a 0–20 oxygen display level, while a Minecraft player sees
 * ten breath bubbles plus a final critical edge. Keep the exact valid level in
 * the current body observation, but admit only those player-visible transitions
 * to lived event history so a swim cannot crowd every other event out of memory.
 */
function conditionMeaningfullyChanged(
  previous: { health: number | null; food: number | null; oxygen: number | null },
  current: { health: number | null; food: number | null; oxygen: number | null },
) {
  return (
    previous.health !== current.health ||
    previous.food !== current.food ||
    oxygenDisplayBand(previous.oxygen) !== oxygenDisplayBand(current.oxygen)
  );
}

function oxygenDisplayBand(value: number | null) {
  if (value == null) return Number.POSITIVE_INFINITY;
  if (value <= 5) return 0;
  return Math.max(1, Math.min(10, Math.ceil(value / 2)));
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

function visibleEntityEvent(bot: Bot, entity: any) {
  const summary = nearbyEntityEvent(bot, entity);
  if (!summary || !entityIsVisible(bot, entity)) return null;
  const maxDistance = summary.kind === 'player' ? 64 : 24;
  return summary.distance <= maxDistance ? summary : null;
}

function entityReference(entity: any) {
  return entity?.username
    ? `player:${String(entity.username)}`
    : `entity:${String(entity?.id ?? 'unknown')}`;
}

function soundSalience(
  sound: string,
  distanceBand: 'immediate' | 'nearby' | 'distant',
): ExperienceEvent['salience'] {
  const normalized = sound.toLowerCase();
  if (
    distanceBand === 'immediate' &&
    ['explode', 'creeper', 'hurt', 'attack', 'arrow', 'fire'].some((token) =>
      normalized.includes(token),
    )
  ) {
    return 'urgent';
  }
  if (
    distanceBand !== 'distant' &&
    ['zombie', 'skeleton', 'spider', 'guardian', 'warden', 'hurt', 'death'].some((token) =>
      normalized.includes(token),
    )
  ) {
    return 'high';
  }
  return normalized.includes('step') || normalized.includes('ambient') ? 'ambient' : 'normal';
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

function boundedText(value: unknown, limit: number) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function round(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : number;
}
