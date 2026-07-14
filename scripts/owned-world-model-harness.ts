import fs from 'node:fs';
import path from 'node:path';
import { Vec3 } from 'vec3';
import { createBot } from '../src/bot';
import type { Config } from '../src/config';
import { openEntityLoom } from '../src/entity/loom';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import { parseRunJournal, type RunJournalEvent } from './owned-world-model-evidence';
import {
  OWNED_WORLD_ID,
  listFiles,
  restoreEnvironment,
  sha256File,
  waitFor,
  type prepareOwnedWorld,
} from './owned-world-fixture';
import { startManagedWorld, type ManagedWorldRun } from './world-runner';

export type OwnedWorldFixture = Awaited<ReturnType<typeof prepareOwnedWorld>>;

export type ManagedModelPhaseResult<Witness> = Readonly<{
  managedRunId: string;
  journalFile: string;
  journalSha256: string;
  events: RunJournalEvent[];
  witness: Witness;
  lifecycleFile: string;
  lifecycleTipDigest: string | null;
  lifecycleEvents: number;
}>;

export async function runManagedModelPhase<Witness = null>(input: {
  phase: string;
  fixture: OwnedWorldFixture;
  entityId: string;
  model: string;
  task: string;
  allowTools: readonly string[];
  timeoutMs: number;
  agentTickMs?: number;
  transcript: string[];
  milestone: (events: readonly RunJournalEvent[]) => boolean;
  witness?: (context: {
    run: ManagedWorldRun;
    events: readonly RunJournalEvent[];
    journalFile: string;
  }) => Promise<Witness>;
  logPrefix?: string;
}): Promise<ManagedModelPhaseResult<Witness | null>> {
  const prefix = input.logPrefix || 'owned-world-model';
  const journalDirectory = path.join(input.fixture.evidenceRoot, `${input.phase}-run`);
  fs.mkdirSync(journalDirectory, { recursive: true });
  const priorEnvironment = {
    runDirectory: process.env.BEHOLD_RUN_DIR,
    recordModelIo: process.env.BEHOLD_RECORD_MODEL_IO,
    tick: process.env.AGENT_TICK_MS,
  };
  process.env.BEHOLD_RUN_DIR = journalDirectory;
  process.env.BEHOLD_RECORD_MODEL_IO = '1';
  process.env.AGENT_TICK_MS = String(Math.max(250, input.agentTickMs ?? 1000));
  let run: ManagedWorldRun | null = null;
  try {
    run = await startManagedWorld(
      {
        worldId: OWNED_WORLD_ID,
        world: input.fixture.world,
        controlRoot: input.fixture.controlRoot,
        serverDirectory: input.fixture.serverDirectory,
        serverJar: input.fixture.serverJar,
        expectedServerJarSha256: input.fixture.expectedServerJarSha256,
        java: input.fixture.java,
        controllerEntry: path.resolve('dist/src/cli/behold.js'),
        entityRoot: input.fixture.entityRoot,
        runRoot: journalDirectory,
        residents: [
          {
            entityId: input.entityId,
            model: input.model,
            tickMs: Math.max(500, input.agentTickMs ?? 1000),
            task: input.task,
            allowTools: input.allowTools,
          },
        ],
        startupTimeoutMs: 90_000,
        shutdownTimeoutMs: 90_000,
      },
      {
        stdout: (text) => {
          input.transcript.push(text);
          process.stdout.write(text);
        },
        stderr: (text) => {
          input.transcript.push(text);
          process.stderr.write(text);
        },
      },
    );
    const journalFile = await waitForRunJournal(run.residents[0].journalDirectory, 30_000);
    const wait = new AbortController();
    let events: RunJournalEvent[] = [];
    try {
      await Promise.race([
        waitFor(
          () => {
            events = readRunJournal(journalFile);
            const failure = events.find((event) => event.type === 'model_call_failed');
            if (failure) {
              throw new Error(
                `${input.phase} model call failed: ${String(failure.data?.error || 'unknown error')}`,
              );
            }
            return input.milestone(events);
          },
          input.timeoutMs,
          `${input.phase} model inhabitant milestone`,
          wait.signal,
        ),
        run.finished.then(() => {
          throw new Error(`${input.phase} managed world ended before the model milestone`);
        }),
      ]);
    } finally {
      wait.abort();
    }

    let witness: Witness | null = null;
    if (input.witness) {
      await run.quiesceResidents(`${prefix}_${input.phase}_before_witness`);
      witness = await input.witness({ run, events, journalFile });
    }
    await run.stop(`${prefix}_${input.phase}_complete`);
    await run.finished;
    events = readRunJournal(journalFile);
    const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
    return {
      managedRunId: run.runId,
      journalFile,
      journalSha256: sha256File(journalFile),
      events,
      witness,
      lifecycleFile: run.control.journalFile,
      lifecycleTipDigest: lifecycle.tipDigest,
      lifecycleEvents: lifecycle.events.length,
    };
  } catch (error) {
    if (run) await run.stop(`${prefix}_${input.phase}_failed`).catch(() => {});
    throw error;
  } finally {
    restoreEnvironment('BEHOLD_RUN_DIR', priorEnvironment.runDirectory);
    restoreEnvironment('BEHOLD_RECORD_MODEL_IO', priorEnvironment.recordModelIo);
    restoreEnvironment('AGENT_TICK_MS', priorEnvironment.tick);
  }
}

export async function observeFromFreshMinecraftBody<T extends Record<string, unknown>>(input: {
  run: ManagedWorldRun;
  entityRoot: string;
  controlRoot: string;
  port: number;
  model: string;
  witnessId: string;
  settleMs?: number;
  observe: (bot: ReturnType<typeof createBot>) => T | Promise<T>;
}) {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(input.witnessId)) {
    throw new Error(
      `fresh offline Minecraft witness identity must be 1-16 letters, digits, or underscores: ${input.witnessId}`,
    );
  }
  return withEnvironment(
    {
      SERVER_HOST: '127.0.0.1',
      SERVER_PORT: String(input.port),
      MINECRAFT_USERNAME: input.witnessId,
      MINECRAFT_AUTH: 'offline',
      VIEWER_ENABLED: '0',
      BEHOLD_RUN_ID: input.run.runId,
      BEHOLD_WORLD_ID: OWNED_WORLD_ID,
      BEHOLD_WORLD_CONTROL_FILE: input.run.control.file,
      BEHOLD_WORLD_CONTROL_ROOT: input.controlRoot,
      BEHOLD_ENTITY_DIR: input.entityRoot,
    },
    async () => {
      const config: Config = {
        server: { host: '127.0.0.1', port: input.port },
        circle: { id: OWNED_WORLD_ID, source: 'explicit' },
        auth: { username: input.witnessId, mode: 'offline' },
        agent: { tickMs: 1000 },
        viewer: { enabled: false, port: 3007, firstPerson: true, viewDistance: 4 },
        input: { mode: 'hold' },
        llm: { model: input.model },
      };
      const loom = await openEntityLoom(input.witnessId, input.entityRoot, OWNED_WORLD_ID);
      let bot: ReturnType<typeof createBot> | null = null;
      try {
        bot = createBot(config, loom.connectionCapability);
        await waitForLocalWorld(bot, 45_000);
        await delay(Math.max(0, input.settleMs ?? 500));
        const observed = await input.observe(bot);
        return {
          ...observed,
          entityId: input.witnessId,
          worldId: OWNED_WORLD_ID,
          managedRunId: input.run.runId,
          source: 'fresh_minecraft_connection' as const,
          observedAt: Date.now(),
        };
      } finally {
        if (bot) await disconnect(bot).catch(() => {});
        await loom.close().catch(() => {});
      }
    },
  );
}

export function observedDroppedItems(bot: ReturnType<typeof createBot>) {
  const me = (bot as any).entity?.position;
  return (Object.values((bot as any).entities || {}) as any[])
    .filter((entity) => entity?.name === 'item' && entity?.position)
    .map((entity) => {
      const item = entity?.getDroppedItem?.();
      return {
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
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function observedInventory(bot: ReturnType<typeof createBot>) {
  const counts = new Map<string, number>();
  for (const item of (bot as any).inventory?.items?.() || []) {
    const name = String(item?.name || item?.displayName || 'unknown');
    counts.set(name, (counts.get(name) || 0) + Math.max(0, Number(item?.count) || 0));
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function observedBlocks(
  bot: ReturnType<typeof createBot>,
  positions: readonly Readonly<{ x: number; y: number; z: number }>[],
) {
  return positions.map((position) => {
    const block = (bot as any).blockAt?.(new Vec3(position.x, position.y, position.z));
    return {
      position: { ...position },
      name: block?.name == null ? null : String(block.name),
      stateId: Number.isFinite(Number(block?.stateId)) ? Number(block.stateId) : null,
    };
  });
}

export function readRunJournal(file: string) {
  const text = fs.readFileSync(file, 'utf8');
  if (text && !text.endsWith('\n')) return [];
  return parseRunJournal(text);
}

export async function waitForRunJournal(directory: string, timeoutMs: number) {
  let journal = '';
  await waitFor(
    () => {
      const files = listFiles(directory).filter((file) => file.endsWith('.jsonl'));
      if (files.length > 1) throw new Error(`expected one run journal, found ${files.length}`);
      journal = files[0] || '';
      return !!journal;
    },
    timeoutMs,
    `run journal in ${directory}`,
  );
  return journal;
}

async function withEnvironment<T>(
  values: Readonly<Record<string, string>>,
  action: () => Promise<T>,
) {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  ) as Record<string, string | undefined>;
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
  try {
    return await action();
  } finally {
    for (const [name, value] of Object.entries(previous)) restoreEnvironment(name, value);
  }
}

async function waitForLocalWorld(bot: ReturnType<typeof createBot>, timeoutMs: number) {
  const localWorld = new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      bot.removeListener('spawn', onSpawn);
      bot.removeListener('error', onError);
      bot.removeListener('kicked', onKicked);
      bot.removeListener('end', onEnd);
    };
    const pass = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onError = (error: unknown) => fail(error);
    const onKicked = (reason: unknown) =>
      fail(new Error(`fresh Minecraft witness was kicked: ${JSON.stringify(reason)}`));
    const onEnd = (reason: unknown) =>
      fail(new Error(`fresh Minecraft witness disconnected before readiness: ${String(reason)}`));
    const onSpawn = () => {
      void bot.waitForChunksToLoad().then(pass, fail);
    };
    bot.once('spawn', onSpawn);
    bot.once('error', onError);
    bot.once('kicked', onKicked);
    bot.once('end', onEnd);
    if ((bot as any).entity) onSpawn();
  });
  let timer: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      localWorld,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('fresh Minecraft witness readiness timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
