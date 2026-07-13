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
import { findConfirmedWorldChange } from './owned-world-proof-support';

const PROTOCOL = 'behold.owned-world-inhabitant-proof.v1' as const;

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
    experience = new InhabitantExperience(bot as any, { eventHistory: 40 });
    const interpreter = buildInterpreter(bot as any, {
      observe: () => experience!.observe(),
      changeConfirmationTimeoutMs: 10_000,
      changeStabilityWindowMs: 150,
      worldCommandTimeoutMs: 20_000,
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
        allowTools: ['find_blocks', 'dig_block'],
        onEvent: (event) => {
          events.push(event);
          experience!.recordEngineEvent(event);
        },
      },
    );

    await waitForLocalWorld(bot, 45_000);
    const initialObservation = experience.observe();
    const search = await executeTurn({
      entityId,
      loom,
      experience,
      engine,
      events,
      name: 'find_blocks',
      input: { name: 'gold_block', maxDistance: 8, count: 4 },
    });
    const blocks = Array.isArray(search.result?.blocks) ? search.result.blocks : [];
    let mutation: Awaited<ReturnType<typeof executeTurn>> | null = null;

    if (phase === 'act') {
      if (priorTurns !== 0)
        throw new Error(`act phase expected no prior turns, found ${priorTurns}`);
      if (blocks.length !== 1) {
        throw new Error(`act phase expected one local gold affordance, found ${blocks.length}`);
      }
      const target = blocks[0]?.position;
      if (!samePosition(target, { x: 2, y: -60, z: 0 })) {
        throw new Error(`unexpected gold affordance: ${JSON.stringify(target)}`);
      }
      mutation = await executeTurn({
        entityId,
        loom,
        experience,
        engine,
        events,
        name: 'dig_block',
        input: target,
      });
      if (
        !findConfirmedWorldChange(mutation.result, {
          verb: 'dig',
          position: { x: 2, y: -60, z: 0 },
          before: 'gold_block',
          after: 'air',
          confirmationSource: 'mineflayer:blockUpdate',
        })
      ) {
        throw new Error(
          `world mutation was not independently confirmed: ${JSON.stringify(mutation)}`,
        );
      }
    } else {
      if (priorTurns < 2)
        throw new Error(`resume phase expected prior life, found ${priorTurns} turns`);
      if (blocks.length !== 0) {
        throw new Error(
          `resume phase found the already-consumed affordance again: ${blocks.length}`,
        );
      }
      if (
        events.some(
          (event) =>
            event.type === 'action_started' && String(event.data?.intent?.tool) === 'dig_block',
        )
      ) {
        throw new Error('resume phase duplicated the physical action');
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
      search,
      mutation,
      finalObservation,
      engineEvents: events,
      physicalMutationAttempts: events.filter(
        (event) =>
          event.type === 'action_started' && String(event.data?.intent?.tool) === 'dig_block',
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

function samePosition(value: any, expected: { x: number; y: number; z: number }) {
  return (
    Number(value?.x) === expected.x &&
    Number(value?.y) === expected.y &&
    Number(value?.z) === expected.z
  );
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
