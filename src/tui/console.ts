import 'dotenv/config';
import readline from 'node:readline';
import { getConfig } from '../config';
import { createBot } from '../bot';
import { buildInterpreter } from '../agent/interpreter';
import { buildFrame, renderFrame } from './render';
import { parseLine } from './parse';
import { createEngine } from '../loop/engine';
import { isImmediateAttentionEvent, startLLMPolicy } from '../policy/llm';
import { createAxResidentMind } from '../mind/ax';
import { createRunJournal } from '../observability/journal';
import { openEntityLoom } from '../entity/loom';
import { createProjectMemory } from '../entity/projects';
import { createPlaceMemory } from '../entity/places';
import { InhabitantExperience, type TaskBrief } from '../agent/experience';
import {
  createComeSeeDoReportRuntime,
  createComeSeeDoReportTask,
} from '../tasks/come-see-do-report';

const INITIAL_WORLD_SYNC_SETTLE_MS = 4_000;

export type ConsoleOptions = {
  agentName?: string;
  model?: string;
  tickMs?: number;
  paused?: boolean;
  allowTools?: string[] | null;
  task?: string;
  target?: string;
};

export async function runConsole(opts: ConsoleOptions = {}) {
  if (opts.agentName) process.env.MINECRAFT_USERNAME = opts.agentName;
  if (opts.model) process.env.LLM_MODEL = opts.model;
  if (opts.tickMs) process.env.AGENT_TICK_MS = String(opts.tickMs);

  const cfg = getConfig();
  const name = cfg.auth.username || 'Agent';
  const mindAdapter = residentMindAdapter(process.env.BEHOLD_MIND);
  const entityLoom = await openEntityLoom(name, undefined, cfg.circle.id);
  const projects = createProjectMemory(name, entityLoom.turns());
  const places = createPlaceMemory(name, entityLoom.turns());
  const journal = createRunJournal(name);
  let shutdownStarted = false;
  let shutdownPromise: Promise<void> | null = null;
  let requestShutdown: ((reason: string, terminalError?: Error | null) => Promise<void>) | null =
    null;
  const appendJournal: typeof journal.append = (type, data, source) => {
    try {
      journal.append(type, data, source);
    } catch (error: any) {
      const failure = error instanceof Error ? error : new Error(String(error));
      console.error(`[journal] fatal write failure: ${failure.message}`);
      if (!shutdownStarted) void requestShutdown?.('journal_write_failed', failure);
      throw failure;
    }
  };
  const taskTarget =
    opts.task === 'come-see-do-report' ? opts.target || 'importdf' : (opts.target ?? null);
  appendJournal('run_started', {
    runId: process.env.BEHOLD_RUN_ID || journal.id,
    journalId: journal.id,
    server: cfg.server,
    circle: cfg.circle,
    authMode: cfg.auth.mode,
    model: cfg.llm.model,
    controller: {
      kind: cfg.llm.apiKey && !opts.paused ? 'llm' : 'operator',
      mindAdapter,
      tickMs: Number(process.env.AGENT_TICK_MS || 3000),
      paused: Boolean(opts.paused),
      allowTools: opts.allowTools ?? null,
    },
    task: opts.task ?? null,
    target: taskTarget,
    entityLoom: entityLoom.file,
    entityLoomBackend: entityLoom.backend,
    priorEntityTurns: entityLoom.turns().length,
    activeProjects: projects.snapshot(),
    knownPlaces: places.snapshot(),
  });
  console.error(`[journal] ${journal.file}`);
  console.error(
    `[entity] ${entityLoom.file} (${entityLoom.turns().length} prior turns, ${entityLoom.backend})`,
  );
  console.error(`[circle] ${cfg.circle.id} (${cfg.circle.source})`);
  for (const warning of entityLoom.warnings) console.error(`[entity] ${warning}`);
  console.error(`[console] connecting to ${cfg.server.host}:${cfg.server.port} as ${name}`);
  const bot = createBot(cfg, entityLoom.connectionCapability);
  const taskRuntime =
    opts.task === 'come-see-do-report'
      ? createComeSeeDoReportRuntime(bot as any, taskTarget!)
      : null;
  const task = taskRuntime?.task ?? resolveTask(opts.task, opts.target);
  let policy: ReturnType<typeof startLLMPolicy> | null = null;
  let engine: ReturnType<typeof createEngine> | null = null;
  let localWorldReady = false;
  const experience = new InhabitantExperience(bot as any, {
    circleId: cfg.circle.id,
    managedRunId: process.env.BEHOLD_RUN_ID || null,
    task,
    projects: () => projects.snapshot(),
    places: () => places.snapshot(),
    onEvent: (event) => {
      if (localWorldReady && isImmediateAttentionEvent(event)) policy?.wake();
    },
    onEventError: (error, event) =>
      console.error(
        `[console] attention observer failed for ${event.type}: ${error instanceof Error ? error.message : String(error)}`,
      ),
  });
  const startPolicyIfReady = () => {
    if (!localWorldReady || !policy) return;
    policy.start();
    policy.wake();
  };

  const recordTaskProgress = () => {
    if (!taskRuntime) return null;
    const progress = taskRuntime.verifier.snapshot(experience.observe());
    appendJournal('task_progress', progress);
    return progress;
  };

  const cache: any = { chatTail: [], nearby: [], cursor: null, last: null };
  bot.on('chat', (user: string, text: string) => {
    if (user === (bot as any).username) return;
    cache.chatTail.push({ user, text });
    cache.chatTail = cache.chatTail.slice(-3);
    appendJournal('chat_received', { user, text });
    taskRuntime?.permissions.recordIncomingChat(user, text);
    taskRuntime?.verifier.recordIncomingChat(user, text);
    if (taskRuntime) appendJournal('task_permissions', taskRuntime.permissions.snapshot());
    recordTaskProgress();
    if (!taskRuntime || user.toLowerCase() === taskRuntime.task.target?.toLowerCase()) {
      engine?.muteLLM(false);
      policy?.resume();
    } else {
      if (localWorldReady) policy?.wake();
    }
  });

  const updateSense = () => {
    try {
      const bc: any = (bot as any).blockAtCursor?.(6);
      const ec: any = (bot as any).entityAtCursor?.(3.5);
      if (bc)
        cache.cursor = {
          kind: 'block',
          name: bc?.name,
          x: bc?.position?.x,
          y: bc?.position?.y,
          z: bc?.position?.z,
        };
      else if (ec) {
        const me = (bot as any).entity?.position;
        const pos = ec?.position;
        const dist = me && pos ? me.distanceTo(pos) : null;
        cache.cursor = {
          kind: 'entity',
          name: ec?.name,
          username: ec?.username,
          dist: dist ?? undefined,
        };
      } else cache.cursor = null;
    } catch {}
    const me: any = (bot as any).entity?.position;
    const ents = Object.values((bot as any).entities || {})
      .filter((e: any) => e?.type && e?.position && me)
      .map((e: any) => ({
        kind: e.type,
        name: e.name,
        username: e.username,
        dist: me.distanceTo(e.position),
      }))
      .sort((a: any, b: any) => (a.dist ?? 0) - (b.dist ?? 0))
      .slice(0, 5)
      .map((e: any, i: number) => ({ idx: i + 1, ...e }));
    cache.nearby = ents;
  };

  const interp = buildInterpreter(bot as any, {
    worldChangeExecutor: taskRuntime?.worldChangeExecutor,
    projects,
    places: () => places.snapshot(),
    observe: () => experience.observe(),
  });
  const registry = {
    authorize: (tool: string, args: any, intent: any) => {
      if (taskRuntime && intent?.source === 'llm') {
        return {
          ...taskRuntime.permissions.authorizeAction(tool, args, interp.describe(tool)?.effects),
          authority: 'come-see-do-report-task',
          evidence: { task: taskRuntime.task.id, target: taskRuntime.task.target },
        };
      }
      return {
        ok: true as const,
        authority: intent?.source === 'human' ? 'operator-console' : 'behold-default',
      };
    },
    run: (tool: string, args?: any, _intent?: any, execution?: { signal: AbortSignal }) => {
      return interp.run(tool, args, execution);
    },
    list: () => interp.list(),
  };

  engine = createEngine(registry, {
    tickMs: Number(process.env.AGENT_TICK_MS || 3000),
    allowTools: opts.allowTools,
    log: (s) => console.error(s),
    onEvent: (event) => {
      const deliver = (consumer: string, fn: () => void) => {
        try {
          fn();
        } catch (error: any) {
          console.error(
            `[console] ${consumer} failed for ${event.type}: ${error?.message || String(error)}`,
          );
        }
      };
      deliver('experience event consumer', () => experience.recordEngineEvent(event));
      deliver('run journal', () => appendJournal(event.type, event.data, { engineAt: event.at }));
      if (event.type === 'preemption_deferred') {
        const requested = String(event.data?.intent?.tool || 'human action');
        const active = String(event.data?.activeIntent?.tool || 'active action');
        cache.last = `${requested} queued; waiting for ${active}`;
        console.error(`[human] ${requested} queued until ${active} reaches a terminal result`);
      }
      if (taskRuntime) {
        deliver('task verifier', () =>
          taskRuntime.verifier.recordEngineEvent(event, experience.observe()),
        );
        if (event.type === 'action_completed' || event.type === 'action_failed') {
          deliver('task progress journal', recordTaskProgress);
        }
      }
      void policy
        ?.onEngineEvent(event)
        .catch((error: any) =>
          console.error(
            `[console] policy event consumer failed for ${event.type}: ${error?.message || String(error)}`,
          ),
        );
      const tool = String(event.data?.intent?.tool || '');
      const source = String(event.data?.intent?.source || '');
      if (
        (event.type === 'action_completed' || event.type === 'action_failed') &&
        source !== 'llm' &&
        tool !== 'chat' &&
        tool !== 'whisper'
      ) {
        if (localWorldReady) policy?.wake();
      }
    },
  });
  taskRuntime?.verifier.bindEngineEventSource(engine.acceptsEvent);
  engine.start();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let displayTimer: NodeJS.Timeout | null = null;
  let botEnded = false;
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const prompt = () => rl.setPrompt('» ');
  const show = () => {
    try {
      updateSense();
      const text = renderFrame(name, buildFrame(bot as any, cache));
      process.stdout.write(`\x1b[2K\r${text.split('\n').join('\n')}\n`);
      prompt();
      rl.prompt();
    } catch {}
  };

  bot.once('spawn', () => {
    appendJournal('spawned', experience.observe());
    recordTaskProgress();
    show();
    void (bot as any)
      .waitForChunksToLoad()
      .then(() => waitForInitialWorldSync(bot as any, INITIAL_WORLD_SYNC_SETTLE_MS))
      .then(() => {
        if (shutdownStarted) return;
        localWorldReady = true;
        experience.markLocalWorldReady(INITIAL_WORLD_SYNC_SETTLE_MS);
        appendJournal('local_world_ready', experience.observe());
        startPolicyIfReady();
        show();
      })
      .catch((error: any) => {
        if (!shutdownStarted) {
          appendJournal('local_world_readiness_failed', {
            error: error?.message || String(error),
          });
        }
      });
    let lastObservationAt = 0;
    displayTimer = setInterval(() => {
      if (!rl.line) show();
      if (Date.now() - lastObservationAt >= 10_000) {
        lastObservationAt = Date.now();
        let observation: unknown;
        try {
          observation = experience.observe();
        } catch (error: any) {
          appendJournal('observation_error', { error: error?.message || String(error) });
          return;
        }
        appendJournal('observation', observation);
      }
    }, 1500);
  });

  // Optional LLM policy
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = cfg.llm.model;
  if (apiKey && !opts.paused) {
    const toolSpecs = interp.list('inhabitant').map((s: any) => ({
      type: 'function',
      function: {
        name: s.name,
        description: s.description || '',
        parameters: s.parameters || { type: 'object', properties: {} },
      },
    }));
    policy = startLLMPolicy(
      {
        entityId: name,
        observe: (sinceSequence) => experience.observe(sinceSequence),
        actions: toolSpecs as any,
        attempt: (intent) => engine!.enqueueIntent(intent),
      },
      {
        apiKey,
        model,
        endpoint: process.env.OPENROUTER_BASE_URL || undefined,
        mind:
          mindAdapter === 'ax'
            ? createAxResidentMind({
                apiKey,
                model,
                apiURL: openAICompatibleBaseURL(process.env.OPENROUTER_BASE_URL),
                recordModelIO: process.env.BEHOLD_RECORD_MODEL_IO === '1',
              })
            : undefined,
        recordModelIO: process.env.BEHOLD_RECORD_MODEL_IO === '1',
        tickMs: Number(process.env.AGENT_TICK_MS || 3000),
        maxTurnSteps: task ? 8 : 16,
        resumeAfterBudget: task == null,
        allowTools: opts.allowTools ?? null,
        // The complete loom stays authoritative. The adjacent fold is only a
        // validated, disposable prompt view over older turns.
        history: entityLoom.turns(),
        foldCacheFile: entityLoom.foldFile,
        log: (s) => console.error(s),
        acceptEngineEvent: engine.acceptsEvent,
        onModelTurn: (turn) => {
          taskRuntime?.verifier.recordControllerDecision(turn.intent, turn.observation);
          appendJournal('model_turn', turn);
        },
        onModelError: (failure) => appendJournal('model_call_failed', failure),
        onAuxiliaryModelCall: (turn) => appendJournal('model_auxiliary_call', turn),
        onAuxiliaryModelError: (failure) => appendJournal('model_auxiliary_call_failed', failure),
        onEntityTurn: async (turn) => {
          projects.validate(turn);
          places.validate(turn);
          await entityLoom.append(turn);
          projects.record(turn);
          places.record(turn);
          appendJournal('entity_turn', turn);
        },
      },
    );
    startPolicyIfReady();
    console.error(`[console] LLM policy enabled (model ${model}, mind ${mindAdapter})`);
  } else if (!apiKey) {
    console.error('[console] No OPENROUTER_API_KEY; LLM autopilot disabled.');
  } else {
    console.error('[console] Starting paused (no LLM).');
  }

  rl.on('line', async (line) => {
    const p = parseLine(line);
    if ((p as any).meta === 'help') {
      console.error(
        'Commands: say, status, nearby, survey [radius=16 step=4], cursor, look <x y z|@cursor>, move to <x y z|@cursor> [near=n], stop, dig <x y z|@cursor>, place @cursor, place at <x y z> [name=block], equip <name>, eat [name]',
      );
      prompt();
      rl.prompt();
      return;
    }
    if ((p as any).meta === 'json') {
      cache.last = `json ${(p as any).args?.on ? 'on' : 'off'} (not yet)`;
      show();
      return;
    }
    if (!(p as any).tool) {
      cache.last = 'unknown command';
      show();
      return;
    }
    const intent = {
      tool: (p as any).tool,
      input: (p as any).args,
      preempt: (p as any).preempt,
    } as any;
    // Resolve @cursor
    if (intent.input) {
      const cur = cache.cursor;
      if (cur && cur.kind === 'block') {
        for (const k of Object.keys(intent.input)) {
          if (intent.input[k] === '@cursor_x') intent.input[k] = cur.x;
          if (intent.input[k] === '@cursor_y') intent.input[k] = cur.y;
          if (intent.input[k] === '@cursor_z') intent.input[k] = cur.z;
        }
        if (intent.input.on) {
          if (intent.input.on.x === '@cursor_x') intent.input.on.x = cur.x;
          if (intent.input.on.y === '@cursor_y') intent.input.on.y = cur.y;
          if (intent.input.on.z === '@cursor_z') intent.input.on.z = cur.z;
        }
      }
    }
    try {
      const shown = (() => {
        try {
          const s = JSON.stringify(intent.input);
          return s && s.length > 120 ? s.slice(0, 117) + '...' : s;
        } catch {
          return '';
        }
      })();
      console.error(`[human] propose: ${intent.tool} ${shown || ''}`);
    } catch {}
    if (intent.tool === 'stop') policy?.suspend('human_stop');
    engine.enqueueHumanIntent({
      tool: intent.tool,
      input: intent.input,
      preempt: intent.preempt,
    });
    cache.last = `${intent.tool}`;
    show();
  });

  requestShutdown = (reason: string, terminalError: Error | null = null) => {
    if (shutdownStarted) return shutdownPromise ?? Promise.resolve();
    shutdownStarted = true;
    shutdownPromise = Promise.resolve().then(async () => {
      try {
        appendJournal('run_stopping', { reason });
        if (displayTimer) clearInterval(displayTimer);
        displayTimer = null;
        await policy?.stop();
        const drain = await engine!.shutdown(reason);
        if (!drain.drained) throw new Error('engine did not drain its active action');
        if (taskRuntime) {
          appendJournal('task_verification', taskRuntime.verifier.snapshot(experience.observe()));
        }
        experience.destroy();
        if (!botEnded) {
          await new Promise<void>((resolve) => {
            (bot as any).once('end', () => resolve());
            (bot as any).end();
          });
        }
        await entityLoom.close();
        appendJournal('run_stopped', {
          reason,
          drained: true,
          terminalError: terminalError?.message ?? null,
        });
        if (terminalError) rejectDone(terminalError);
        else resolveDone();
      } catch (error: any) {
        const failure = error instanceof Error ? error : new Error(String(error));
        try {
          journal.append('run_stop_failed', { reason, error: failure.message });
        } catch {}
        rejectDone(failure);
      }
    });
    return shutdownPromise;
  };

  rl.on('close', () => void requestShutdown?.('controller_stdin_closed'));
  (bot as any).once('end', (reason: string) => {
    botEnded = true;
    if (!shutdownPromise) {
      void requestShutdown?.(
        'minecraft_connection_ended',
        new Error(`Minecraft connection ended${reason ? `: ${reason}` : ''}`),
      );
    }
  });
  (bot as any).once('kicked', (reason: unknown) => {
    void requestShutdown?.('minecraft_kicked', new Error(`Minecraft kicked: ${String(reason)}`));
  });
  (bot as any).once('error', (error: Error) => {
    void requestShutdown?.('minecraft_error', error);
  });

  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const handler = () => {
      void requestShutdown?.(signal);
      rl.close();
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  try {
    await done;
  } finally {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  }
}

function residentMindAdapter(value: string | undefined): 'direct' | 'ax' {
  const normalized = String(value || 'direct')
    .trim()
    .toLowerCase();
  if (normalized === 'direct' || normalized === 'ax') return normalized;
  throw new Error(`Unsupported BEHOLD_MIND ${JSON.stringify(value)}; expected direct or ax`);
}

function waitForInitialWorldSync(bot: any, milliseconds: number) {
  return new Promise<void>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      bot.removeListener?.('end', finish);
      resolve();
    };
    timer = setTimeout(finish, Math.max(0, milliseconds));
    bot.once?.('end', finish);
  });
}

function openAICompatibleBaseURL(value: string | undefined) {
  const normalized = String(value || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  return normalized.replace(/\/chat\/completions$/, '');
}

function resolveTask(taskName?: string, targetName?: string): TaskBrief | null {
  if (!taskName) return null;
  if (taskName !== 'come-see-do-report') {
    return {
      id: taskName,
      goal: taskName,
      successConditions: [],
      constraints: [],
      target: targetName || null,
    };
  }
  return createComeSeeDoReportTask(targetName || 'importdf');
}
