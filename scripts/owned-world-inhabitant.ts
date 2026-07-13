#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getConfig } from '../src/config';
import { createBot } from '../src/bot';
import { openEntityLoom, type EntityTurn } from '../src/entity/loom';
import { InhabitantExperience } from '../src/agent/experience';
import { buildInterpreter } from '../src/agent/interpreter';
import { createEngine, type EngineEvent } from '../src/loop/engine';

const PROTOCOL = 'behold.owned-world-inhabitant-proof.v1' as const;
const WITNESS_ID = 'ProofWitness';

async function main() {
  const args = parseArgs({
    args: process.argv.slice(2),
    options: {
      server: { type: 'string' },
      port: { type: 'string' },
      world: { type: 'string' },
      model: { type: 'string' },
      task: { type: 'string' },
      target: { type: 'string' },
      allowTools: { type: 'string' },
    },
    allowPositionals: true,
  });
  const entityId = args.positionals[0];
  if (!entityId) throw new Error('owned-world inhabitant requires an entity name');
  if (args.values.server) process.env.SERVER_HOST = String(args.values.server);
  if (args.values.port) process.env.SERVER_PORT = String(args.values.port);
  if (args.values.world) process.env.BEHOLD_WORLD_ID = String(args.values.world);
  process.env.MINECRAFT_USERNAME = entityId;
  process.env.MINECRAFT_AUTH = 'offline';
  process.env.VIEWER_ENABLED = '0';

  const phase = String(process.env.BEHOLD_PROOF_PHASE || 'act');
  if (phase !== 'act' && phase !== 'resume') throw new Error(`unknown proof phase: ${phase}`);
  const proofFile = path.resolve(requiredEnvironment('BEHOLD_PROOF_FILE'));
  const cfg = getConfig();
  const loom = await openEntityLoom(entityId, undefined, cfg.circle.id);
  const priorTurns = loom.turns().length;
  let bot: ReturnType<typeof createBot> | null = null;
  let experience: InhabitantExperience | null = null;
  let engine: ReturnType<typeof createEngine> | null = null;

  try {
    bot = createBot(cfg, loom.connectionCapability);
    experience = new InhabitantExperience(bot as any, {
      circleId: cfg.circle.id,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      eventHistory: 40,
    });
    const interpreter = buildInterpreter(bot as any, {
      observe: () => experience!.observe(),
      changeConfirmationTimeoutMs: 10_000,
      changeStabilityWindowMs: 150,
      worldCommandTimeoutMs: 30_000,
    });
    const events: EngineEvent[] = [];
    engine = createEngine(
      {
        authorize: async (name, _input, intent) => ({
          ok: true,
          authority: 'behold-owned-world-proof',
          evidence: { phase, entityId, intentId: intent.id, tool: name },
        }),
        run: (name, input, _intent, execution) => interpreter.run(name, input, execution),
        list: () => interpreter.list('inhabitant'),
      },
      {
        allowTools: ['collect_nearby_item', 'inspect_volume'],
        onEvent: (event) => {
          events.push(event);
          experience!.recordEngineEvent(event);
        },
      },
    );

    await waitForLocalWorld(bot, 45_000);
    if (phase === 'act') await waitForDroppedItem(bot, 'apple', 5_000);
    else await delay(500);
    const initialObservation = experience.observe();
    const initialDroppedItems = observedDroppedItems(bot);
    let collection: Awaited<ReturnType<typeof executeTurn>> | null = null;
    let resumeInspection: Awaited<ReturnType<typeof executeTurn>> | null = null;
    let independentWitness: Awaited<ReturnType<typeof observeDroppedItemsFromFreshBody>> | null =
      null;

    if (phase === 'act') {
      if (priorTurns !== 0)
        throw new Error(`act phase expected no prior turns, found ${priorTurns}`);
      if (initialDroppedItems.filter((item) => item.name === 'apple').length !== 1) {
        throw new Error(
          `act phase expected one local apple affordance: ${JSON.stringify(initialDroppedItems)}`,
        );
      }
      collection = await executeTurn({
        entityId,
        loom,
        experience,
        engine,
        events,
        name: 'collect_nearby_item',
        input: { name: 'apple', maxDistance: 8, timeoutMs: 30_000 },
      });
      if (
        !collection.result?.ok ||
        collection.result?.item !== 'apple' ||
        collection.result?.confirmation !== 'mineflayer:playerCollect'
      ) {
        throw new Error(`Minecraft did not confirm collection: ${JSON.stringify(collection)}`);
      }
      independentWitness = await observeDroppedItemsFromFreshBody(cfg);
      if (independentWitness.droppedItems.some((item) => item.name === 'apple')) {
        throw new Error(
          `fresh Minecraft connection still observed the collected item: ${JSON.stringify(independentWitness)}`,
        );
      }
    } else {
      if (priorTurns < 1)
        throw new Error(`resume phase expected prior life, found ${priorTurns} turns`);
      if (inventoryCount(initialObservation, 'apple') !== 1) {
        throw new Error(
          `resume phase did not load the persisted apple inventory: ${JSON.stringify(initialObservation.self?.inventory)}`,
        );
      }
      if (initialDroppedItems.some((item) => item.name === 'apple')) {
        throw new Error(`resume phase found the already-collected item again`);
      }
      resumeInspection = await executeTurn({
        entityId,
        loom,
        experience,
        engine,
        events,
        name: 'inspect_volume',
        input: { radius: 2, verticalRadius: 2 },
      });
      if (
        events.some(
          (event) =>
            event.type === 'action_started' &&
            String(event.data?.intent?.tool) === 'collect_nearby_item',
        )
      ) {
        throw new Error('resume phase repeated the collection action');
      }
    }

    const finalObservation = experience.observe();
    durableWriteJson(proofFile, {
      protocol: PROTOCOL,
      phase,
      entityId,
      circleId: cfg.circle.id,
      runId: process.env.BEHOLD_RUN_ID || null,
      priorTurns,
      resultingTurns: loom.turns().length,
      initialObservation,
      initialDroppedItems,
      collection,
      resumeInspection,
      independentWitness,
      finalObservation,
      engineEvents: events,
      collectionAttempts: events.filter(
        (event) =>
          event.type === 'action_started' &&
          String(event.data?.intent?.tool) === 'collect_nearby_item',
      ).length,
      completedAt: new Date().toISOString(),
    });
    process.stdout.write(`[proof] ${phase} complete: ${proofFile}\n`);

    await waitForManagerStop(bot);
    const drain = await engine.shutdown('managed_stdin_closed');
    if (!drain.drained) throw new Error('owned-world proof engine did not drain');
    experience.destroy();
    experience = null;
    await disconnect(bot);
    bot = null;
    await loom.close();
  } catch (error) {
    try {
      if (engine) await engine.shutdown('proof_failed');
    } catch {}
    experience?.destroy();
    if (bot) await disconnect(bot).catch(() => {});
    await loom.close().catch(() => {});
    throw error;
  }
}

async function observeDroppedItemsFromFreshBody(config: ReturnType<typeof getConfig>) {
  const witnessLoom = await openEntityLoom(WITNESS_ID, undefined, config.circle.id);
  let witness: ReturnType<typeof createBot> | null = null;
  try {
    witness = createBot(
      {
        ...config,
        auth: { ...config.auth, username: WITNESS_ID, mode: 'offline' },
        viewer: { ...config.viewer, enabled: false },
      },
      witnessLoom.connectionCapability,
    );
    await waitForLocalWorld(witness, 45_000);
    await delay(500);
    return {
      entityId: WITNESS_ID,
      worldId: config.circle.id,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      source: 'fresh_minecraft_connection',
      observedAt: Date.now(),
      droppedItems: observedDroppedItems(witness),
    };
  } finally {
    if (witness) await disconnect(witness).catch(() => {});
    await witnessLoom.close().catch(() => {});
  }
}

async function waitForDroppedItem(
  bot: ReturnType<typeof createBot>,
  name: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (observedDroppedItems(bot).some((item) => item.name === name)) return;
    await delay(50);
  }
  throw new Error(`Minecraft entity stream did not expose the prepared ${name}`);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function observedDroppedItems(bot: ReturnType<typeof createBot>) {
  const me = (bot as any).entity?.position;
  return (Object.values((bot as any).entities || {}) as any[])
    .filter((entity) => entity?.name === 'item' && entity?.position)
    .map((entity) => {
      const item = entity?.getDroppedItem?.();
      return {
        id: Number(entity.id),
        name: String(item?.name || item?.displayName || 'unknown'),
        count: Math.max(0, Number(item?.count) || 0),
        position: {
          x: Number(entity.position.x),
          y: Number(entity.position.y),
          z: Number(entity.position.z),
        },
        distance: me?.distanceTo?.(entity.position) ?? null,
      };
    })
    .sort((a, b) => a.id - b.id);
}

function inventoryCount(observation: any, name: string) {
  return (Array.isArray(observation?.self?.inventory) ? observation.self.inventory : [])
    .filter((item: any) => String(item?.name) === name)
    .reduce((sum: number, item: any) => sum + Math.max(0, Number(item?.count) || 0), 0);
}

async function executeTurn(input: {
  entityId: string;
  loom: Awaited<ReturnType<typeof openEntityLoom>>;
  experience: InhabitantExperience;
  engine: ReturnType<typeof createEngine>;
  events: EngineEvent[];
  name: string;
  input: any;
}) {
  const sequence = input.loom.turns().length + 1;
  const parentId = input.loom.turns().at(-1)?.id ?? null;
  const observation = input.experience.observe();
  const eventStart = input.events.length;
  const startedAt = Date.now();
  const intentId = `${input.entityId}:script:${sequence}`;
  const accepted = input.engine.enqueueIntent({
    id: intentId,
    source: 'script',
    tool: input.name,
    input: input.input,
    observationSequence: observation.sequence,
    decidedAt: startedAt,
  });
  if (!accepted) throw new Error(`engine refused ${input.name}`);
  const result = await input.engine.tick();
  const actionEvents = input.events.slice(eventStart);
  const terminal = actionEvents.find(
    (event) =>
      (event.type === 'action_completed' || event.type === 'action_failed') &&
      event.data?.intent?.id === intentId,
  );
  if (!terminal) throw new Error(`${input.name} produced no authentic terminal lifecycle event`);
  const nextObservation = input.experience.observe();
  const turn: EntityTurn = {
    protocol: 'behold.entity-turn.v1',
    circleId: input.loom.circleId ?? undefined,
    id: `${input.entityId}:turn:${sequence}`,
    entityId: input.entityId,
    sequence,
    parentId,
    model: 'script/behold-owned-world-proof-v1',
    startedAt,
    completedAt: Date.now(),
    observation,
    utterance: { assistant: null },
    action: {
      id: intentId,
      name: input.name,
      input: input.input,
      source: 'script',
      kind: 'exclusive',
      toolCallId: null,
    },
    outcome: {
      ok: terminal.type === 'action_completed',
      eventType: terminal.type,
      result: terminal.data?.result ?? result,
      ...(terminal.type === 'action_failed'
        ? { error: String(terminal.data?.error || 'action_failed') }
        : {}),
    },
    nextObservation,
  };
  await input.loom.append(turn);
  return { turnId: turn.id, result: turn.outcome.result, events: actionEvents };
}

async function waitForLocalWorld(bot: ReturnType<typeof createBot>, timeoutMs: number) {
  const localWorld = (async () => {
    if (!(bot as any).entity) {
      await new Promise<void>((resolve, reject) => {
        bot.once('spawn', () => resolve());
        bot.once('error', reject);
      });
    }
    await bot.waitForChunksToLoad();
  })();
  let timer: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      localWorld,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Minecraft local-world readiness timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function waitForManagerStop(bot: ReturnType<typeof createBot>) {
  process.stdin.resume();
  return new Promise<void>((resolve, reject) => {
    process.stdin.once('end', () => resolve());
    bot.once('end', (reason) =>
      reject(new Error(`Minecraft ended before manager stop: ${reason}`)),
    );
  });
}

function disconnect(bot: ReturnType<typeof createBot>) {
  if (!(bot as any)._client) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    bot.once('end', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      (bot as any).end();
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

function requiredEnvironment(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function durableWriteJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try {
    fs.fsyncSync(directory);
  } finally {
    fs.closeSync(directory);
  }
}

void main().catch((error) => {
  process.stderr.write(
    `[owned-world-inhabitant] ${error instanceof Error ? error.stack : error}\n`,
  );
  process.exitCode = 1;
});
