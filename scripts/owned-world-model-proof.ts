#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createBot } from '../src/bot';
import { DEFAULT_LLM_MODEL, type Config } from '../src/config';
import { openEntityLoom } from '../src/entity/loom';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import {
  assessOwnedWorldModelEvidence,
  hasCollectionFollowedByYield,
  hasFirstRestartTurn,
  parseRunJournal,
  type IndependentWorldWitness,
  type RunJournalEvent,
} from './owned-world-model-evidence';
import {
  OWNED_LEVEL_SEED,
  OWNED_WORLD_ID,
  durableWriteJson,
  gitRevision,
  listFiles,
  prepareOwnedWorld,
  readJson,
  restoreEnvironment,
  sha256File,
  waitFor,
} from './owned-world-fixture';
import { digestTree } from './world-lab';
import { startManagedWorld, type ManagedWorldRun } from './world-runner';

const PROTOCOL = 'behold.owned-world-model-proof.v1' as const;
const ENTITY_ID = 'ModelResident';
const WITNESS_ID = 'ModelWitness';
const TASK =
  'Care for your immediate situation: notice and secure any safe, useful loose resource you can actually perceive. Once that has succeeded, yield and remember the result. On a later life, continue from your own history and do not repeat completed physical work.';
const ALLOW_TOOLS = Object.freeze(['collect_nearby_item', 'inspect_volume']);

async function main() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: 'string' },
      port: { type: 'string' },
      model: { type: 'string' },
      timeout: { type: 'string' },
      reassess: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help) {
    process.stdout.write(
      'Usage: owned-world-model-proof [--run <safe-id>] [--port <unused-loopback-port>] [--model <OpenRouter-slug>] [--timeout <seconds>] [--reassess <model-report.json>]\n',
    );
    return;
  }
  if (parsed.values.reassess) {
    reassessExistingProof(String(parsed.values.reassess));
    return;
  }

  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey || apiKey.length < 12) {
    throw new Error(
      'OPENROUTER_API_KEY is required for the real-model proof; no world was generated and no model call was attempted',
    );
  }
  const model = String(parsed.values.model || process.env.LLM_MODEL || DEFAULT_LLM_MODEL).trim();
  if (!model) throw new Error('a non-empty model slug is required');
  const timeoutMs = Number(parsed.values.timeout || 240) * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
    throw new Error(`invalid proof timeout: ${parsed.values.timeout}`);
  }
  const requestedRunId = String(
    parsed.values.run || `model-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const port = Number(parsed.values.port || 25576);
  const fixture = await prepareOwnedWorld(requestedRunId, port, 'owned-world-model');
  const transcript: string[] = [];

  const runPhase = async (phase: 'act' | 'resume') => {
    const journalDirectory = path.join(fixture.evidenceRoot, `${phase}-run`);
    fs.mkdirSync(journalDirectory, { recursive: true });
    const priorEnvironment = {
      runDirectory: process.env.BEHOLD_RUN_DIR,
      recordModelIo: process.env.BEHOLD_RECORD_MODEL_IO,
      tick: process.env.AGENT_TICK_MS,
    };
    process.env.BEHOLD_RUN_DIR = journalDirectory;
    process.env.BEHOLD_RECORD_MODEL_IO = '1';
    process.env.AGENT_TICK_MS = '1000';
    let run: ManagedWorldRun | null = null;
    try {
      run = await startManagedWorld(
        {
          worldId: OWNED_WORLD_ID,
          world: fixture.world,
          controlRoot: fixture.controlRoot,
          serverDirectory: fixture.serverDirectory,
          serverJar: fixture.serverJar,
          expectedServerJarSha256: fixture.expectedServerJarSha256,
          java: fixture.java,
          controllerEntry: path.resolve('dist/src/cli/behold.js'),
          controllerEntityId: ENTITY_ID,
          controllerLeasePath: path.join(fixture.entityRoot, ENTITY_ID, 'runtime.lock'),
          model,
          task: TASK,
          allowTools: ALLOW_TOOLS,
          startupTimeoutMs: 90_000,
          shutdownTimeoutMs: 90_000,
        },
        {
          stdout: (text) => {
            transcript.push(text);
            process.stdout.write(text);
          },
          stderr: (text) => {
            transcript.push(text);
            process.stderr.write(text);
          },
        },
      );
      const journalFile = await waitForJournal(journalDirectory, 30_000);
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
                  `${phase} model call failed: ${String(failure.data?.error || 'unknown error')}`,
                );
              }
              return phase === 'act'
                ? hasCollectionFollowedByYield(events)
                : hasFirstRestartTurn(events);
            },
            timeoutMs,
            `${phase} model inhabitant milestone`,
            wait.signal,
          ),
          run.finished.then(() => {
            throw new Error(`${phase} managed world ended before the model milestone`);
          }),
        ]);
      } finally {
        wait.abort();
      }

      const independentWitness =
        phase === 'act'
          ? await observeFromFreshMinecraftBody({
              run,
              entityRoot: fixture.entityRoot,
              controlRoot: fixture.controlRoot,
              port,
              model,
            })
          : null;
      await run.stop(`owned_world_model_${phase}_complete`);
      await run.finished;
      events = readRunJournal(journalFile);
      const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
      return {
        managedRunId: run.runId,
        journalFile,
        journalSha256: sha256File(journalFile),
        events,
        independentWitness,
        lifecycleFile: run.control.journalFile,
        lifecycleTipDigest: lifecycle.tipDigest,
        lifecycleEvents: lifecycle.events.length,
      };
    } catch (error) {
      if (run) await run.stop(`owned_world_model_${phase}_failed`).catch(() => {});
      throw error;
    } finally {
      restoreEnvironment('BEHOLD_RUN_DIR', priorEnvironment.runDirectory);
      restoreEnvironment('BEHOLD_RECORD_MODEL_IO', priorEnvironment.recordModelIo);
      restoreEnvironment('AGENT_TICK_MS', priorEnvironment.tick);
    }
  };

  process.stdout.write(`[owned-world-model] first life with ${model}\n`);
  const act = await runPhase('act');
  if (!act.independentWitness) throw new Error('act phase did not produce an independent witness');
  const afterActTree = digestTree(fixture.runtime);
  process.stdout.write('[owned-world-model] restarting the same model inhabitant\n');
  const resume = await runPhase('resume');
  const afterResumeTree = digestTree(fixture.runtime);

  const assessment = assessOwnedWorldModelEvidence(
    act.events,
    resume.events,
    act.independentWitness,
    {
      worldId: OWNED_WORLD_ID,
      entityId: ENTITY_ID,
      model,
      task: TASK,
      actRunId: act.managedRunId,
      resumeRunId: resume.managedRunId,
    },
  );
  const loomFiles = listFiles(path.join(fixture.entityRoot, ENTITY_ID, 'lync')).filter((file) =>
    file.endsWith('.lync'),
  );
  if (loomFiles.length !== 1) {
    throw new Error(
      `expected one authoritative model-resident Lync log, found ${loomFiles.length}`,
    );
  }
  const reportFile = path.join(fixture.evidenceRoot, 'model-report.json');
  durableWriteJson(reportFile, {
    protocol: PROTOCOL,
    status: assessment.failed.length === 0 ? 'passed' : 'failed',
    runId: fixture.runId,
    worldId: OWNED_WORLD_ID,
    entityId: ENTITY_ID,
    model,
    task: TASK,
    startedAt: fixture.startedAt,
    completedAt: new Date().toISOString(),
    repository: { path: fixture.repository, revision: gitRevision() },
    server: {
      version: String(fixture.toolLock.tools.minecraftServer.version),
      jar: fixture.serverJar,
      sha256: fixture.actualServerJarSha256,
      java: fixture.java,
      port,
      seed: OWNED_LEVEL_SEED,
      generation: fixture.generation,
    },
    evidence: {
      sourceTree: fixture.sourceTree,
      baselineTree: fixture.baselineTree,
      initialRuntimeTree: fixture.initialRuntimeTree,
      afterActTree,
      afterResumeTree,
      independentWitness: act.independentWitness,
      loomFile: loomFiles[0],
      loomSha256: sha256File(loomFiles[0]),
      act: {
        managedRunId: act.managedRunId,
        journalFile: act.journalFile,
        journalSha256: act.journalSha256,
        lifecycleFile: act.lifecycleFile,
        lifecycleTipDigest: act.lifecycleTipDigest,
        lifecycleEvents: act.lifecycleEvents,
      },
      resume: {
        managedRunId: resume.managedRunId,
        journalFile: resume.journalFile,
        journalSha256: resume.journalSha256,
        lifecycleFile: resume.lifecycleFile,
        lifecycleTipDigest: resume.lifecycleTipDigest,
        lifecycleEvents: resume.lifecycleEvents,
      },
    },
    assessment,
  });
  fs.writeFileSync(
    path.join(fixture.evidenceRoot, 'managed-model-transcript.log'),
    transcript.join(''),
    'utf8',
  );
  if (assessment.failed.length > 0) {
    throw new Error(
      `model inhabitant proof failed (${assessment.failed.join(', ')}); evidence: ${reportFile}`,
    );
  }
  process.stdout.write(`[owned-world-model] PASS ${reportFile}\n`);
}

function reassessExistingProof(inputFile: string) {
  const sourceFile = path.resolve(inputFile);
  const source = readJson(sourceFile);
  if (source?.protocol !== PROTOCOL) {
    throw new Error(`cannot reassess unsupported proof: ${source?.protocol || 'missing protocol'}`);
  }
  const actJournalFile = path.resolve(String(source?.evidence?.act?.journalFile || ''));
  const resumeJournalFile = path.resolve(String(source?.evidence?.resume?.journalFile || ''));
  const loomFile = path.resolve(String(source?.evidence?.loomFile || ''));
  const integrity = {
    actJournal: sha256File(actJournalFile) === String(source?.evidence?.act?.journalSha256 || ''),
    resumeJournal:
      sha256File(resumeJournalFile) === String(source?.evidence?.resume?.journalSha256 || ''),
    loom: sha256File(loomFile) === String(source?.evidence?.loomSha256 || ''),
  };
  const assessment = assessOwnedWorldModelEvidence(
    parseRunJournal(fs.readFileSync(actJournalFile, 'utf8')),
    parseRunJournal(fs.readFileSync(resumeJournalFile, 'utf8')),
    source.evidence.independentWitness,
    {
      worldId: String(source.worldId),
      entityId: String(source.entityId),
      model: String(source.model),
      task: String(source.task),
      actRunId: String(source.evidence.act.managedRunId),
      resumeRunId: String(source.evidence.resume.managedRunId),
    },
  );
  const failedIntegrity = Object.entries(integrity)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  const outputFile = path.join(path.dirname(sourceFile), 'model-report-reassessed.json');
  if (fs.existsSync(outputFile)) throw new Error(`reassessment already exists: ${outputFile}`);
  const passed = failedIntegrity.length === 0 && assessment.failed.length === 0;
  durableWriteJson(outputFile, {
    protocol: 'behold.owned-world-model-reassessment.v1',
    status: passed ? 'passed' : 'failed',
    reassessedAt: new Date().toISOString(),
    verifierRevision: gitRevision(),
    source: {
      file: sourceFile,
      sha256: sha256File(sourceFile),
      protocol: source.protocol,
      status: source.status,
    },
    integrity,
    failedIntegrity,
    assessment,
  });
  if (!passed) {
    throw new Error(
      `existing model proof did not pass reassessment (${[...failedIntegrity, ...assessment.failed].join(', ')}): ${outputFile}`,
    );
  }
  process.stdout.write(`[owned-world-model] REASSESSED PASS ${outputFile}\n`);
}

async function waitForJournal(directory: string, timeoutMs: number) {
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

function readRunJournal(file: string) {
  const text = fs.readFileSync(file, 'utf8');
  if (text && !text.endsWith('\n')) return [];
  return parseRunJournal(text);
}

async function observeFromFreshMinecraftBody(input: {
  run: ManagedWorldRun;
  entityRoot: string;
  controlRoot: string;
  port: number;
  model: string;
}): Promise<IndependentWorldWitness> {
  return withEnvironment(
    {
      SERVER_HOST: '127.0.0.1',
      SERVER_PORT: String(input.port),
      MINECRAFT_USERNAME: WITNESS_ID,
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
        auth: { username: WITNESS_ID, mode: 'offline' },
        agent: { tickMs: 1000 },
        viewer: { enabled: false, port: 3007, firstPerson: true, viewDistance: 4 },
        input: { mode: 'hold' },
        llm: { model: input.model },
      };
      const loom = await openEntityLoom(WITNESS_ID, input.entityRoot, OWNED_WORLD_ID);
      let bot: ReturnType<typeof createBot> | null = null;
      try {
        bot = createBot(config, loom.connectionCapability);
        await waitForLocalWorld(bot, 45_000);
        await delay(500);
        return {
          entityId: WITNESS_ID,
          worldId: OWNED_WORLD_ID,
          managedRunId: input.run.runId,
          source: 'fresh_minecraft_connection' as const,
          observedAt: Date.now(),
          droppedItems: observedDroppedItems(bot),
        };
      } finally {
        if (bot) await disconnect(bot).catch(() => {});
        await loom.close().catch(() => {});
      }
    },
  );
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
          () => reject(new Error('fresh Minecraft witness readiness timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function observedDroppedItems(bot: ReturnType<typeof createBot>) {
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

void main().catch((error) => {
  process.stderr.write(
    `[owned-world-model] ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
