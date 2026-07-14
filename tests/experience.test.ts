import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { InhabitantExperience } from '../src/agent/experience';

function fakeBot() {
  const bot: any = new EventEmitter();
  bot.username = 'Scout';
  bot.health = 20;
  bot.food = 20;
  bot.oxygenLevel = 20;
  bot.game = { dimension: 'overworld' };
  bot.time = { time: 6000, isDay: true };
  bot.heldItem = null;
  bot.inventory = { items: () => [] };
  bot.entity = {
    id: 1,
    position: new Vec3(0, 64, 0),
    velocity: new Vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    onGround: true,
  };
  bot.entities = {
    1: bot.entity,
    2: {
      id: 2,
      username: 'importdf',
      name: 'player',
      type: 'player',
      heldItem: { name: 'wooden_pickaxe' },
      position: new Vec3(0, 64, -5),
    },
  };
  bot.players = { Scout: { username: 'Scout' }, importdf: { username: 'importdf' } };
  bot.blockAt = () => ({ name: 'grass_block' });
  bot.blockAtCursor = () => ({ name: 'stone', position: new Vec3(0, 63, -1) });
  bot.entityAtCursor = () => null;
  return bot;
}

test('experience records before downstream delivery and contains observer failure', () => {
  const bot = fakeBot();
  let experience!: InhabitantExperience;
  let recordedAtDelivery = false;
  const failures: Array<{ error: unknown; event: any }> = [];
  experience = new InhabitantExperience(bot, {
    onEvent: (event) => {
      recordedAtDelivery = experience
        .observe()
        .events.some((candidate) => candidate.sequence === event.sequence);
      (event.data as any).observerMutation = true;
      throw new Error('attention observer failed');
    },
    onEventError: (error, event) => failures.push({ error, event }),
  });

  bot.emit('entityHurt', bot.entity);

  const recorded = experience.observe().events.find((event) => event.type === 'self_hurt');
  assert.equal(recordedAtDelivery, true);
  assert.equal(recorded?.data.observerMutation, undefined);
  assert.equal(failures.length, 1);
  assert.match(String(failures[0].error), /attention observer failed/);
  assert.equal(failures[0].event.type, 'self_hurt');
  assert.equal(failures[0].event.data.observerMutation, undefined);
  experience.destroy();
});

test('inhabitant observation preserves embodied state, provenance, and new events', () => {
  let now = 1000;
  const bot = fakeBot();
  const experience = new InhabitantExperience(bot, {
    now: () => now,
    circleId: 'minecraft:test-world',
    managedRunId: 'minecraft:test-world-7',
    task: {
      id: 'come-see-do-report',
      goal: 'Find importdf',
      successConditions: ['arrive'],
      constraints: ['do not dig'],
      target: 'importdf',
    },
    projects: () => [
      {
        id: 'shared-home',
        title: 'Build a shared home',
        nextStep: 'Gather eight logs',
        doneWhen: 'A lit enclosed home has a door, bed, and chest',
        evidence: 'space_enclosed',
        needsDefinition: false,
        startedAtSequence: 4,
        updatedAtSequence: 5,
      },
    ],
    places: () => [
      {
        id: 'place:overworld:3:64:4',
        label: 'Build a shared home',
        purpose: 'A shared shelter exists',
        anchor: { dimension: 'overworld', x: 3, y: 64, z: 4 },
        affordances: ['sealed-space', 'closable-entrance'],
        protectedBodyCells: [{ x: 3, y: 64, z: 4 }],
        entrances: [],
        evidence: 'space_enclosed',
        learnedAtSequence: 8,
        lastConfirmedAtSequence: 9,
        provenance: {
          source: 'own_entity_loom',
          projectId: 'shared-home',
          completionTurnSequence: 9,
          witnessTurnSequence: 8,
          witnessAction: 'inspect_reachable_space',
        },
      },
    ],
  });

  const initial = experience.observe();
  assert.equal(initial.protocol, 'behold.inhabitant.v1');
  assert.deepEqual(initial.circle, {
    id: 'minecraft:test-world',
    substrate: 'minecraft',
    managedRunId: 'minecraft:test-world-7',
  });
  assert.equal(initial.self.identity, 'Scout');
  assert.equal(initial.self.pose.yaw, 0);
  assert.equal(initial.self.condition.oxygen, 20);
  assert.equal(initial.self.projects[0]?.id, 'shared-home');
  assert.equal(initial.self.places[0]?.id, 'place:overworld:3:64:4');
  assert.equal(initial.self.places[0]?.source, 'memory');
  assert.equal(initial.self.places[0]?.sameDimension, true);
  assert.equal(initial.self.places[0]?.distance, 5);
  assert.match(initial.self.places[0]?.note || '', /current conditions require observation/);
  assert.deepEqual(initial.self.placeConflicts, []);
  assert.equal(initial.scene.focus?.source, 'cursor');
  assert.deepEqual(initial.scene.social.playersOnline, ['importdf']);
  assert.equal(initial.scene.social.source, 'server_roster');
  assert.equal(initial.scene.entities[0].id, 'player:importdf');
  assert.equal(initial.scene.entities[0].relativeDirection, 'ahead');
  assert.equal(initial.scene.entities[0].proximity, 'nearby');
  assert.equal(initial.scene.entities[0].visibility, 'unknown');
  assert.equal(initial.scene.entities[0].heldItem, 'wooden_pickaxe');

  now = 1200;
  bot.emit('chat', 'importdf', 'Scout, come here');
  const afterChat = experience.observe(initial.sequence);
  const chat = afterChat.events.find((event) => event.type === 'chat_received');
  assert.equal(chat?.isNew, true);
  assert.equal(chat?.salience, 'urgent');
  assert.deepEqual(chat?.data, {
    from: 'importdf',
    text: 'Scout, come here',
    addressed: true,
  });

  const seenAgain = experience.observe(afterChat.sequence);
  assert.equal(seenAgain.events.find((event) => event.type === 'chat_received')?.isNew, false);

  bot.emit('health');
  assert.equal(
    experience
      .observe(seenAgain.sequence)
      .events.some((event) => event.type === 'condition_changed'),
    false,
  );
  bot.health = 17;
  bot.emit('health');
  const condition = experience
    .observe(seenAgain.sequence)
    .events.find((event) => event.type === 'condition_changed');
  assert.equal(condition?.salience, 'high');
  assert.deepEqual(condition?.data.current, { health: 17, food: 20, oxygen: 20 });

  bot.oxygenLevel = 4;
  bot.emit('breath');
  const lowOxygen = experience
    .observe(condition!.sequence)
    .events.find((event) => event.type === 'condition_changed' && event.data.current.oxygen === 4);
  assert.equal(lowOxygen?.salience, 'urgent');
  experience.destroy();
});

test('entity proximity is a bounded relation to this body, not server presence', () => {
  const bot = fakeBot();
  const experience = new InhabitantExperience(bot);

  bot.entities[2].position = new Vec3(0, 64, -3);
  assert.equal(experience.observe().scene.entities[0].proximity, 'interaction');
  bot.entities[2].position = new Vec3(0, 64, -9);
  assert.equal(experience.observe().scene.entities[0].proximity, 'nearby');
  bot.entities[2].position = new Vec3(0, 64, -27);
  const distant = experience.observe();
  assert.equal(distant.scene.entities[0].proximity, 'distant');
  assert.equal(distant.scene.social.playersOnline[0], 'importdf');

  experience.destroy();
});

test('entity appearances distinguish initial world synchronization from live events', () => {
  const bot = fakeBot();
  const experience = new InhabitantExperience(bot);

  bot.emit('entitySpawn', bot.entities[2]);
  const initialAppearance = experience
    .observe()
    .events.find((event) => event.type === 'entity_appeared_nearby');
  assert.equal(initialAppearance?.data.observationPhase, 'initial_world_sync');

  experience.markLocalWorldReady(4000);
  const liveEntity = {
    id: 3,
    name: 'item',
    type: 'object',
    position: new Vec3(2, 64, 0),
  };
  bot.entities[3] = liveEntity;
  bot.emit('entitySpawn', liveEntity);
  const observation = experience.observe();
  const ready = observation.events.find((event) => event.type === 'local_world_ready');
  const liveAppearance = observation.events
    .filter((event) => event.type === 'entity_appeared_nearby')
    .at(-1);
  assert.equal(ready?.data.initialSceneSynchronized, true);
  assert.equal(ready?.data.settleMs, 4000);
  assert.equal(liveAppearance?.data.observationPhase, 'live_world');

  experience.destroy();
});

test('engine lifecycle becomes part of the inhabitant body state', () => {
  const bot = fakeBot();
  const experience = new InhabitantExperience(bot);
  const intent = {
    id: 'a1',
    source: 'llm',
    tool: 'move_to',
    input: { x: 4, y: 64, z: 0 },
  };

  experience.recordEngineEvent({ type: 'intent_enqueued', at: 10, data: { intent } });
  assert.equal(experience.observe().self.currentAction?.status, 'queued');

  experience.recordEngineEvent({ type: 'action_started', at: 20, data: { intent } });
  assert.equal(experience.observe().self.currentAction?.status, 'started');

  experience.recordEngineEvent({
    type: 'tool_result',
    at: 25,
    data: { intent, result: { ok: true, status: 'dispatched' } },
  });
  assert.equal(experience.observe().self.currentAction?.status, 'running');

  experience.recordEngineEvent({
    type: 'action_completed',
    at: 30,
    data: { intent, result: { ok: true, status: 'arrived' } },
  });
  const completed = experience.observe().self.currentAction;
  assert.equal(completed?.status, 'completed');
  assert.deepEqual(completed?.result, { ok: true, status: 'arrived' });
  experience.destroy();
});

test('a slow controller is told when bounded event history has a gap', () => {
  const bot = fakeBot();
  const experience = new InhabitantExperience(bot, { eventHistory: 8 });
  for (let index = 1; index <= 12; index += 1) {
    experience.record('fixture_event', { index });
  }

  const stale = experience.observe(0);
  assert.equal(stale.events[0]?.sequence, 5);
  assert.deepEqual(stale.eventWindow, {
    requestedAfterSequence: 0,
    oldestAvailableSequence: 5,
    newestAvailableSequence: 12,
    missingBeforeOldest: 4,
    complete: false,
  });

  const current = experience.observe(8);
  assert.equal(current.eventWindow.missingBeforeOldest, 0);
  assert.equal(current.eventWindow.complete, true);
  experience.destroy();
});

test('ordinary world changes become attention events and instances stay isolated', () => {
  const first = fakeBot();
  const second = fakeBot();
  second.username = 'Builder';
  let firstItems: any[] = [];
  first.inventory = { items: () => firstItems };
  first.isRaining = false;
  const firstExperience = new InhabitantExperience(first);
  const secondExperience = new InhabitantExperience(second);
  const initial = firstExperience.observe();

  firstItems = [{ name: 'oak_log', count: 2 }];
  first.time.time = 12500;
  first.isRaining = true;
  first.emit('chat', 'importdf', 'Scout, the weather changed');
  first.entities[2].heldItem = { name: 'wooden_axe' };
  first.emit('entityEquip', first.entities[2]);
  first.emit('playerCollect', first.entities[2], {
    name: 'item',
    getDroppedItem: () => ({ name: 'oak_log' }),
  });
  const changed = firstExperience.observe(initial.sequence);

  assert.ok(changed.events.some((event) => event.type === 'inventory_changed' && event.isNew));
  assert.ok(changed.events.some((event) => event.type === 'day_phase_changed' && event.isNew));
  assert.ok(changed.events.some((event) => event.type === 'weather_changed' && event.isNew));
  assert.ok(changed.events.some((event) => event.type === 'chat_received' && event.isNew));
  assert.ok(
    changed.events.some(
      (event) =>
        event.type === 'nearby_player_equipment_changed' &&
        event.data.heldItem === 'wooden_axe' &&
        event.isNew,
    ),
  );
  assert.ok(
    changed.events.some(
      (event) =>
        event.type === 'nearby_player_collected_item' &&
        event.data.item === 'oak_log' &&
        event.isNew,
    ),
  );
  assert.equal(
    secondExperience.observe().events.some((event) => event.type === 'chat_received'),
    false,
  );

  firstExperience.destroy();
  secondExperience.destroy();
});

test('an untasked life receives a bounded pulse when the world has otherwise been quiet', () => {
  let now = 1000;
  const bot = fakeBot();
  const experience = new InhabitantExperience(bot, {
    now: () => now,
    pulseIntervalMs: 10_000,
  });
  const initial = experience.observe();
  now += 10_000;

  const later = experience.observe(initial.sequence);
  const pulse = later.events.find((event) => event.type === 'time_passed');
  assert.equal(pulse?.isNew, true);
  assert.deepEqual(pulse?.data, { elapsedMs: 10_000 });
  experience.destroy();
});
