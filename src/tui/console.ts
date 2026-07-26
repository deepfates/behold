import { config as loadDotenv } from 'dotenv';
import readline from 'node:readline';
import { getConfig } from '../config';
import { closeBotViewer, createBot } from '../bot';
import { buildInterpreter } from '../agent/interpreter';
import { minecraftInhabitantActionsFor } from '../agent/affordances';
import {
  minecraftActionProfile,
  minecraftActionsForProfile,
  minecraftSafetyProfile,
  type MinecraftActionProfile,
  type MinecraftSafetyProfile,
} from '../agent/action-profiles';
import { buildFrame, renderFrame } from './render';
import { parseLine } from './parse';
import { createEngine } from '../loop/engine';
import {
  boundedUrgentDecisionTimeoutMs,
  isBodilyUrgencyEvent,
  isImmediateAttentionEvent,
  startLLMPolicy,
} from '../policy/llm';
import {
  residentPolicyProfile,
  usesHumanSemanticPolicySurface,
  type ResidentPolicyProfile,
} from '../policy/profile';
import { createAxResidentMind } from '../mind/ax';
import {
  minecraftBodyProfile,
  usesHumanSemanticBody,
  type MinecraftBodyProfile,
} from '../mind/minecraft-body';
import { isCognitionTransportEnabled } from '../mind/cognition';
import { openRouterRoutePolicyFromEnvironment } from '../mind/openrouter-route';
import { ollamaLocalPolicyFromEnvironment } from '../mind/ollama-local';
import { createOllamaLocalResidentMind } from '../mind/ollama';
import { createLmStudioLocalResidentMind } from '../mind/lmstudio';
import {
  lmStudioLocalPolicyFromEnvironment,
  lmStudioResidentInstanceId,
} from '../mind/lmstudio-local';
import {
  assertOllamaLocalJsonActionTreatment,
  usesOllamaResidentSessionTransport,
} from '../mind/ollama-json-action';
import { createRunJournal } from '../observability/journal';
import { openEntityLoom } from '../entity/loom';
import { createProjectMemory } from '../entity/projects';
import { createPlaceMemory } from '../entity/places';
import { InhabitantExperience, type TaskBrief } from '../agent/experience';
import {
  createComeSeeDoReportRuntime,
  createComeSeeDoReportTask,
} from '../tasks/come-see-do-report';
import {
  experimentReleaseGateFromEnvironment,
  readExperimentRelease,
  type ExperimentReleaseReference,
} from '../runtime/experiment-release';
import {
  fixedDecisionPilotSchedule,
  runFixedDecisionPilotSchedule,
  type FixedDecisionPilotSchedule,
  type FixedDecisionPilotSlot,
} from '../policy/fixed-decision-pilot';

const INITIAL_WORLD_SYNC_SETTLE_MS = 4_000;

if (process.env.BEHOLD_LOAD_DOTENV !== '0') loadDotenv();

export type ConsoleOptions = {
  /** Continuing private-life identity. */
  agentName?: string;
  /** Minecraft connection identity. Defaults to agentName. */
  bodyUsername?: string;
  model?: string;
  urgentModel?: string;
  urgentDecisionTimeoutMs?: number;
  tickMs?: number;
  /** Maximum entity turns in one uninterrupted cognition burst. */
  maxTurnSteps?: number;
  /** Whether a resident starts another burst after reaching maxTurnSteps. */
  resumeAfterBudget?: boolean;
  /** Explicit four-slot experimental schedule; absent preserves ordinary event-driven cognition. */
  decisionSchedule?: FixedDecisionPilotSchedule;
  paused?: boolean;
  policyProfile?: ResidentPolicyProfile;
  bodyProfile?: MinecraftBodyProfile;
  actionProfile?: MinecraftActionProfile;
  safetyProfile?: MinecraftSafetyProfile;
  allowTools?: string[] | null;
  task?: string;
  target?: string;
  /**
   * Programmatic world/evaluation setup after the native body has synchronized
   * but before the resident is declared ready or cognition can begin. This is
   * deliberately absent from the CLI and from the resident action surface.
   */
  beforeResidentReady?: (context: {
    bot: ReturnType<typeof createBot>;
    observe: () => ReturnType<InhabitantExperience['observe']>;
  }) => Promise<void>;
};

export async function runConsole(opts: ConsoleOptions = {}) {
  if (opts.agentName) process.env.MINECRAFT_USERNAME = opts.bodyUsername || opts.agentName;
  else if (opts.bodyUsername) process.env.MINECRAFT_USERNAME = opts.bodyUsername;
  if (opts.model) process.env.LLM_MODEL = opts.model;
  if (opts.tickMs) process.env.AGENT_TICK_MS = String(opts.tickMs);

  const cfg = getConfig();
  const name = opts.agentName?.trim() || cfg.auth.username || 'Agent';
  const bodyUsername = cfg.auth.username || 'BeholdBot';
  const urgentModel = opts.urgentModel?.trim() || undefined;
  const urgentDecisionTimeoutMs = boundedUrgentDecisionTimeoutMs(
    opts.urgentDecisionTimeoutMs ?? process.env.BEHOLD_URGENT_DECISION_TIMEOUT_MS,
  );
  const policyProfile = residentPolicyProfile(
    opts.policyProfile ?? process.env.BEHOLD_POLICY_PROFILE,
  );
  const bodyProfile = minecraftBodyProfile(
    opts.bodyProfile ??
      process.env.BEHOLD_BODY_PROFILE ??
      (usesHumanSemanticPolicySurface(policyProfile)
        ? 'minecraft-human-semantic-v1'
        : 'minecraft-resident-v1'),
  );
  const actionProfile = minecraftActionProfile(
    opts.actionProfile ??
      process.env.BEHOLD_ACTION_PROFILE ??
      (usesHumanSemanticPolicySurface(policyProfile)
        ? 'minecraft-human-semantic-v1'
        : 'resident-v1'),
  );
  if (usesHumanSemanticBody(bodyProfile) !== (actionProfile === 'minecraft-human-semantic-v1')) {
    throw new Error(
      `body profile ${bodyProfile} must be paired with its matching action profile; received ${actionProfile}`,
    );
  }
  const safetyProfile = minecraftSafetyProfile(
    opts.safetyProfile ??
      process.env.BEHOLD_SAFETY_PROFILE ??
      (usesHumanSemanticPolicySurface(policyProfile) ? 'vanilla-player-v1' : 'resident-safe-v1'),
  );
  const mindAdapter = residentMindAdapter(process.env.BEHOLD_MIND);
  const cognitionTransport = isCognitionTransportEnabled(process.env.BEHOLD_COGNITION_TRANSPORT);
  const providerRoute = openRouterRoutePolicyFromEnvironment(
    process.env.BEHOLD_OPENROUTER_ROUTE_POLICY,
  );
  const ollamaLocal = ollamaLocalPolicyFromEnvironment(process.env.BEHOLD_OLLAMA_LOCAL_POLICY);
  const lmStudioLocal = lmStudioLocalPolicyFromEnvironment(
    process.env.BEHOLD_LMSTUDIO_LOCAL_POLICY,
  );
  if (policyProfile === 'legible-resident-v1' && !ollamaLocal && !lmStudioLocal) {
    throw new Error('legible-resident-v1 requires the strict local JSON v2 transport');
  }
  if (ollamaLocal) assertOllamaLocalJsonActionTreatment({ policyProfile }, ollamaLocal);
  if (providerRoute && mindAdapter !== 'direct') {
    throw new Error('OpenRouter route policy requires the direct resident mind adapter');
  }
  if (ollamaLocal && mindAdapter !== 'direct') {
    throw new Error('Ollama local policy requires the direct resident mind adapter');
  }
  if (ollamaLocal && providerRoute) {
    throw new Error('A resident cannot combine OpenRouter and Ollama transport policies');
  }
  if (lmStudioLocal && mindAdapter !== 'direct') {
    throw new Error('LM Studio local policy requires the direct resident mind adapter');
  }
  if (lmStudioLocal && (providerRoute || ollamaLocal)) {
    throw new Error('A resident cannot combine OpenRouter, Ollama, and LM Studio policies');
  }
  if (ollamaLocal && !cognitionTransport) {
    throw new Error('Ollama local policy requires the authenticated cognition transport');
  }
  if (lmStudioLocal && !cognitionTransport) {
    throw new Error('LM Studio local policy requires the authenticated cognition transport');
  }
  if (ollamaLocal && ollamaLocal.modelTag !== cfg.llm.model) {
    throw new Error('Ollama local model tag differs from LLM_MODEL');
  }
  if (lmStudioLocal && lmStudioLocal.modelKey !== cfg.llm.model) {
    throw new Error('LM Studio local model key differs from LLM_MODEL');
  }
  const maxTurnSteps = opts.maxTurnSteps ?? (opts.task ? 8 : 16);
  const resumeAfterBudget = opts.resumeAfterBudget ?? opts.task == null;
  const decisionSchedule = opts.decisionSchedule
    ? fixedDecisionPilotSchedule(opts.decisionSchedule)
    : null;
  if (decisionSchedule && (maxTurnSteps !== 1 || resumeAfterBudget !== false)) {
    throw new Error(
      'fixed decision pilot schedule requires maxTurnSteps 1 and resumeAfterBudget false',
    );
  }
  const releaseGate = experimentReleaseGateFromEnvironment({
    entityId: name,
    bodyUsername,
    model: cfg.llm.model,
    urgentModel: urgentModel ?? null,
    mind: mindAdapter,
    ...(providerRoute ? { providerRoute } : {}),
    ...(ollamaLocal ? { ollamaLocal } : {}),
    ...(lmStudioLocal ? { lmStudioLocal } : {}),
    ...(decisionSchedule ? { decisionSchedule } : {}),
    profiles: {
      policy: policyProfile,
      body: bodyProfile,
      actions: actionProfile,
      safety: safetyProfile,
    },
    quotaAccountId: process.env.BEHOLD_COGNITION_ACCOUNT_ID,
  });
  if (decisionSchedule && !releaseGate) {
    throw new Error('fixed decision pilot schedule requires an admitted experiment release');
  }
  let experimentRelease: ExperimentReleaseReference | null = null;
  let experimentActive = releaseGate == null;
  const managedBodyUsernames = new Set(
    (releaseGate?.prepared.plan.residents ?? []).map((resident) =>
      resident.bodyUsername.toLowerCase(),
    ),
  );
  const entityLoom = await openEntityLoom(name, undefined, cfg.circle.id);
  const projects = createProjectMemory(name, entityLoom.turns());
  const places = createPlaceMemory(name, entityLoom.turns());
  const journal = createRunJournal(name);
  let shutdownStarted = false;
  let shutdownPromise: Promise<void> | null = null;
  const releaseWaitAbort = new AbortController();
  const fixedScheduleAbort = new AbortController();
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
    body: { substrate: 'minecraft', username: bodyUsername },
    model: cfg.llm.model,
    urgentModel: urgentModel ?? null,
    controller: {
      kind:
        (process.env.OPENROUTER_API_KEY || process.env.BEHOLD_COGNITION_BEARER) && !opts.paused
          ? 'llm'
          : 'operator',
      mindAdapter,
      providerRoute,
      ollamaLocal,
      lmStudioLocal,
      policyProfile,
      bodyProfile,
      actionProfile,
      safetyProfile,
      urgentModel: urgentModel ?? null,
      urgentDecisionTimeoutMs,
      tickMs: Number(process.env.AGENT_TICK_MS || 3000),
      maxTurnSteps,
      resumeAfterBudget,
      decisionSchedule,
      paused: Boolean(opts.paused),
      allowTools: opts.allowTools ?? null,
      experimentRelease: releaseGate
        ? {
            state: 'setup_waiting',
            releaseId: releaseGate.prepared.plan.releaseId,
            planFile: releaseGate.prepared.planFile,
            planSha256: releaseGate.prepared.planSha256,
          }
        : null,
    },
    task: opts.task ?? null,
    target: taskTarget,
    entityLoom: entityLoom.file,
    entityLoomBackend: entityLoom.backend,
    priorEntityTurns: entityLoom.turns().length,
    activeProjects: projects.snapshot(),
    knownPlaces: places.snapshot(),
  });
  if (decisionSchedule && releaseGate) {
    appendJournal('setup_fixed_decision_pilot_schedule', {
      protocol: 'behold.fixed-decision-pilot-population.v1',
      releaseId: releaseGate.prepared.plan.releaseId,
      populationDigest: releaseGate.prepared.plan.populationDigest,
      residents: releaseGate.prepared.plan.residents.map((resident) => ({
        entityId: resident.entityId,
        bodyUsername: resident.bodyUsername,
        decisionSchedule: resident.decisionSchedule ?? null,
      })),
    });
  }
  console.error(`[journal] ${journal.file}`);
  console.error(
    `[entity] ${entityLoom.file} (${entityLoom.turns().length} prior turns, ${entityLoom.backend})`,
  );
  console.error(`[circle] ${cfg.circle.id} (${cfg.circle.source})`);
  for (const warning of entityLoom.warnings) console.error(`[entity] ${warning}`);
  console.error(
    `[console] connecting life ${name} to ${cfg.server.host}:${cfg.server.port} as Minecraft body ${bodyUsername}`,
  );
  const bot = createBot(cfg, entityLoom.connectionCapability, name);
  const taskRuntime =
    opts.task === 'come-see-do-report'
      ? createComeSeeDoReportRuntime(bot as any, taskTarget!)
      : null;
  const task = taskRuntime?.task ?? resolveTask(opts.task, opts.target);
  let policy: ReturnType<typeof startLLMPolicy> | null = null;
  let fixedScheduleStarted = false;
  let fixedSchedulePromise: Promise<unknown> | null = null;
  let activeFixedSlot: {
    slot: FixedDecisionPilotSlot;
    opportunityId: string | null;
    resolve: (terminal: unknown) => void;
    reject: (error: Error) => void;
    detachAbort: () => void;
  } | null = null;
  let engine: ReturnType<typeof createEngine> | null = null;
  let localWorldReady = false;
  const experience = new InhabitantExperience(bot as any, {
    entityId: name,
    circleId: cfg.circle.id,
    managedRunId: process.env.BEHOLD_RUN_ID || null,
    task,
    projects: () => projects.snapshot(),
    places: () => places.snapshot(),
    onEvent: (event) => {
      if (!localWorldReady || !experimentActive) return;
      if (isBodilyUrgencyEvent(event) && (policy?.shouldReclaimModelAction(event) ?? true)) {
        engine?.requestModelActionCancellation('bodily_urgent_attention', {
          eventSequence: event.sequence,
          eventType: event.type,
          eventSource: event.source,
        });
      }
      if (isImmediateAttentionEvent(event)) policy?.wake();
    },
    onEventError: (error, event) =>
      console.error(
        `[console] attention observer failed for ${event.type}: ${error instanceof Error ? error.message : String(error)}`,
      ),
  });
  const settleFixedSlot = (terminal: unknown, error: Error | null = null) => {
    const active = activeFixedSlot;
    if (!active) return;
    activeFixedSlot = null;
    active.detachAbort();
    if (error) active.reject(error);
    else active.resolve(terminal);
  };
  const startFixedDecisionSchedule = () => {
    if (!decisionSchedule || !releaseGate || !policy || fixedScheduleStarted) return;
    fixedScheduleStarted = true;
    const release = readExperimentRelease(releaseGate.prepared);
    const execution = runFixedDecisionPilotSchedule({
      schedule: decisionSchedule,
      releasedAt: release.releasedAt,
      signal: fixedScheduleAbort.signal,
      onEvent: (event) => appendJournal('fixed_decision_pilot_schedule', event),
      openOpportunity: (slot, signal) => {
        if (!policy) throw new Error('fixed decision pilot policy is unavailable');
        if (activeFixedSlot) {
          throw new Error(`fixed decision pilot slot overlap at ${slot.slotId}`);
        }
        const state = policy.state();
        if (
          state.stopped ||
          state.suspended ||
          state.modelRequestActive ||
          state.turnActive ||
          state.pendingIntentId != null ||
          state.loomMaintenanceActive ||
          state.loomMaintenanceScheduled
        ) {
          throw new Error(
            `fixed decision pilot slot ${slot.slotId} opened while policy was not idle`,
          );
        }
        return new Promise<unknown>((resolve, reject) => {
          const onAbort = () =>
            settleFixedSlot(
              null,
              signal?.reason instanceof Error
                ? signal.reason
                : new Error(`fixed decision pilot slot ${slot.slotId} cancelled`),
            );
          signal?.addEventListener('abort', onAbort, { once: true });
          activeFixedSlot = {
            slot,
            opportunityId: null,
            resolve,
            reject,
            detachAbort: () => signal?.removeEventListener('abort', onAbort),
          };
          void policy!.tick().then(
            () => {
              if (activeFixedSlot?.slot.slotId === slot.slotId && !activeFixedSlot.opportunityId) {
                settleFixedSlot(
                  null,
                  new Error(
                    `fixed decision pilot slot ${slot.slotId} ended without a decision opportunity`,
                  ),
                );
              }
            },
            (error: unknown) =>
              settleFixedSlot(null, error instanceof Error ? error : new Error(String(error))),
          );
        });
      },
    });
    fixedSchedulePromise = execution;
    void execution
      .then((result) => {
        process.stderr.write(
          `[bot] Fixed decision schedule ${String((result as any).status)}: ${name}\n`,
        );
      })
      .catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error));
        appendJournal('fixed_decision_pilot_schedule_failed', { error: failure.message });
        void requestShutdown?.('fixed_decision_pilot_schedule_failed', failure);
      });
  };
  const startPolicyIfReady = () => {
    if (!localWorldReady || !experimentActive || !policy) return;
    policy.start();
    if (decisionSchedule) startFixedDecisionSchedule();
    else policy.wake();
  };

  const recordTaskProgress = () => {
    if (!taskRuntime) return null;
    const progress = taskRuntime.verifier.snapshot(experience.observe());
    appendJournal(experimentActive ? 'task_progress' : 'setup_task_progress', progress);
    return progress;
  };

  const cache: any = { chatTail: [], nearby: [], cursor: null, last: null };
  const recordExternalPlayerIntervention = (
    kind: 'joined' | 'left' | 'chat',
    usernameValue: unknown,
    detail: Record<string, unknown> = {},
  ) => {
    const username = String(usernameValue || '').trim();
    if (!username || username.toLowerCase() === bodyUsername.toLowerCase()) return;
    if (managedBodyUsernames.has(username.toLowerCase())) return;
    appendJournal(
      experimentActive ? 'external_player_intervention' : 'setup_external_player_intervention',
      {
        protocol: 'behold.external-player-intervention.v1',
        kind,
        at: Date.now(),
        username,
        classification:
          releaseGate == null
            ? 'native_human_or_unmanaged_player_population_unknown'
            : 'native_human_or_unmanaged_player',
        ...detail,
      },
    );
  };
  bot.on('playerJoined', (player: any) =>
    recordExternalPlayerIntervention('joined', player?.username),
  );
  bot.on('playerLeft', (player: any) => recordExternalPlayerIntervention('left', player?.username));
  bot.on('chat', (user: string, text: string) => {
    if (user === (bot as any).username) return;
    recordExternalPlayerIntervention('chat', user, { text });
    cache.chatTail.push({ user, text });
    cache.chatTail = cache.chatTail.slice(-3);
    appendJournal(experimentActive ? 'chat_received' : 'setup_chat_received', { user, text });
    if (experimentActive) {
      taskRuntime?.permissions.recordIncomingChat(user, text);
      taskRuntime?.verifier.recordIncomingChat(user, text);
      if (taskRuntime) appendJournal('task_permissions', taskRuntime.permissions.snapshot());
      recordTaskProgress();
    }
    if (!taskRuntime || user.toLowerCase() === taskRuntime.task.target?.toLowerCase()) {
      if (experimentActive) {
        engine?.muteLLM(false);
        policy?.resume();
      }
    } else {
      if (localWorldReady && experimentActive) policy?.wake();
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
    safetyProfile,
    projects,
    places: () => places.snapshot(),
    observe: () => experience.observe(),
  });
  const actionAdmissions = new Map<string, any>();
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
    run: (tool: string, args?: any, intent?: any, execution?: { signal: AbortSignal }) => {
      const observation = actionAdmissions.get(String(intent?.id || ''));
      actionAdmissions.delete(String(intent?.id || ''));
      return interp.run(tool, args, { ...execution, observation });
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
      deliver('run journal', () =>
        appendJournal(experimentActive ? event.type : `setup_${event.type}`, event.data, {
          engineAt: event.at,
        }),
      );
      if (['intent_blocked', 'action_completed', 'action_failed'].includes(event.type)) {
        actionAdmissions.delete(String(event.data?.intent?.id || ''));
      }
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
      const policyDelivery = experimentActive ? policy?.onEngineEvent(event) : undefined;
      const tool = String(event.data?.intent?.tool || '');
      const source = String(event.data?.intent?.source || '');
      if (
        (event.type === 'action_completed' || event.type === 'action_failed') &&
        source !== 'llm' &&
        tool !== 'chat' &&
        tool !== 'whisper'
      ) {
        if (localWorldReady && experimentActive) policy?.wake();
      }
      return policyDelivery?.catch((error: any) =>
        console.error(
          `[console] policy event consumer failed for ${event.type}: ${error?.message || String(error)}`,
        ),
      );
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
    appendJournal(releaseGate ? 'setup_spawned' : 'spawned', experience.observe());
    recordTaskProgress();
    show();
    void (bot as any)
      .waitForChunksToLoad()
      .then(() => waitForInitialWorldSync(bot as any, INITIAL_WORLD_SYNC_SETTLE_MS))
      .then(async () => {
        if (shutdownStarted) return;
        if (opts.beforeResidentReady) {
          if (releaseGate)
            appendJournal('setup_operator_intervention', {
              protocol: 'behold.operator-intervention.v1',
              kind: 'programmatic_setup_hook',
              phase: 'started',
              at: Date.now(),
            });
          if (releaseGate) appendJournal('setup_operator_hook_started');
          await opts.beforeResidentReady({
            bot,
            observe: () => experience.observe(),
          });
          if (releaseGate) {
            appendJournal('setup_operator_hook_completed', experience.observe());
            appendJournal('setup_operator_intervention', {
              protocol: 'behold.operator-intervention.v1',
              kind: 'programmatic_setup_hook',
              phase: 'completed',
              at: Date.now(),
              resultingObservation: experience.observe(),
            });
          }
        }
        if (shutdownStarted) return;
        localWorldReady = true;
        experience.markLocalWorldReady(INITIAL_WORLD_SYNC_SETTLE_MS);
        const readyObservation = experience.observe();
        if (releaseGate) {
          appendJournal('setup_local_world_ready', readyObservation);
          const arm = releaseGate.arm({
            journalFile: journal.file,
            setupObservation: readyObservation,
          });
          appendJournal('setup_experiment_release_armed', arm);
          process.stderr.write(
            `[bot] Experiment release armed: ${releaseGate.prepared.plan.releaseId} ${name}\n`,
          );
          const observed = await releaseGate.waitAndClaim({ signal: releaseWaitAbort.signal });
          if (shutdownStarted) return;
          experience.resetForExperimentRelease();
          experimentRelease = observed;
          experimentActive = true;
          appendJournal('experiment_release_observed', observed);
        } else {
          appendJournal('local_world_ready', readyObservation);
        }
        startPolicyIfReady();
        show();
      })
      .catch((error: any) => {
        if (!shutdownStarted) {
          appendJournal('local_world_readiness_failed', {
            error: error?.message || String(error),
          });
          void requestShutdown?.(
            'local_world_readiness_failed',
            error instanceof Error ? error : new Error(String(error)),
          );
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
        appendJournal(experimentActive ? 'observation' : 'setup_observation', observation);
      }
    }, 1500);
  });

  // Optional LLM policy
  const localResidentSession = ollamaLocal != null || lmStudioLocal != null;
  const apiKey = localResidentSession
    ? process.env.BEHOLD_COGNITION_BEARER
    : process.env.OPENROUTER_API_KEY;
  const cognitionEndpoint = localResidentSession
    ? process.env.BEHOLD_COGNITION_ENDPOINT
    : process.env.OPENROUTER_BASE_URL;
  if (localResidentSession && (!apiKey || !cognitionEndpoint)) {
    throw new Error(
      'Local resident policy is missing its runner-owned broker credential or endpoint',
    );
  }
  const model = cfg.llm.model;
  if (apiKey && !opts.paused) {
    const completeToolSpecs = interp.list('inhabitant').map((s: any) => ({
      type: 'function',
      function: {
        name: s.name,
        description: s.description || '',
        parameters: s.parameters || { type: 'object', properties: {} },
      },
    }));
    const toolSpecs = minecraftActionsForProfile(completeToolSpecs as any, actionProfile);
    policy = startLLMPolicy(
      {
        entityId: name,
        observe: (sinceSequence) => experience.observe(sinceSequence),
        actions: toolSpecs as any,
        actionsFor: (observation) =>
          minecraftInhabitantActionsFor(toolSpecs as any, observation, {
            bodyProfile,
            safetyProfile,
          }),
        attempt: (intent, admission) => {
          if (admission?.observation) {
            actionAdmissions.set(intent.id, structuredClone(admission.observation));
          }
          const accepted = engine!.enqueueIntent(intent);
          if (!accepted) actionAdmissions.delete(intent.id);
          return accepted;
        },
      },
      {
        apiKey,
        model,
        urgentModel,
        urgentDecisionTimeoutMs,
        policyProfile,
        bodyProfile,
        actionProfile,
        safetyProfile,
        workingContinuity:
          (ollamaLocal && usesOllamaResidentSessionTransport(ollamaLocal)) || lmStudioLocal
            ? 'resident-session-v1'
            : 'recent-action-v1',
        ...(releaseGate ? { experimentRelease: () => experimentRelease } : {}),
        endpoint: cognitionEndpoint || undefined,
        mind:
          mindAdapter === 'ax'
            ? createAxResidentMind({
                apiKey,
                model,
                allowedModels: urgentModel ? [urgentModel] : [],
                apiURL: openAICompatibleBaseURL(process.env.OPENROUTER_BASE_URL),
                recordModelIO: process.env.BEHOLD_RECORD_MODEL_IO === '1',
                cognitionTransport,
              })
            : ollamaLocal
              ? createOllamaLocalResidentMind({
                  bearer: apiKey!,
                  endpoint: cognitionEndpoint!,
                  policy: ollamaLocal,
                  cognitionTransport: true,
                  recordModelIO: process.env.BEHOLD_RECORD_MODEL_IO === '1',
                })
              : lmStudioLocal
                ? createLmStudioLocalResidentMind({
                    bearer: apiKey!,
                    endpoint: cognitionEndpoint!,
                    policy: lmStudioLocal,
                    modelInstanceId: admittedLmStudioModelInstance(
                      process.env.BEHOLD_LMSTUDIO_MODEL_INSTANCE_ID,
                      lmStudioLocal,
                    ),
                    cognitionTransport: true,
                    recordModelIO: process.env.BEHOLD_RECORD_MODEL_IO === '1',
                  })
                : undefined,
        recordModelIO: process.env.BEHOLD_RECORD_MODEL_IO === '1',
        cognitionTransport,
        ...(providerRoute ? { routePolicy: providerRoute } : {}),
        tickMs: Number(process.env.AGENT_TICK_MS || 3000),
        maxTurnSteps,
        resumeAfterBudget,
        decisionScheduling: decisionSchedule ? 'fixed-pilot-slots' : 'world-events',
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
        onModelInterrupted: (interruption) => appendJournal('model_call_interrupted', interruption),
        authorizeDecisionOpportunity: decisionSchedule
          ? (opportunity) => {
              if (!activeFixedSlot || activeFixedSlot.opportunityId) {
                throw new Error(
                  `decision opportunity ${opportunity.opportunityId} was not opened by a fixed pilot slot`,
                );
              }
              activeFixedSlot.opportunityId = opportunity.opportunityId;
            }
          : undefined,
        onDecisionOpportunity: (event) => {
          appendJournal('resident_decision_opportunity', event);
          if (!decisionSchedule || shutdownStarted) return;
          const active = activeFixedSlot;
          if (!active || active.opportunityId !== event.opportunityId) {
            const failure = new Error(
              `fixed decision pilot opportunity ${event.opportunityId} does not match its active slot`,
            );
            appendJournal('fixed_decision_pilot_schedule_violation', {
              error: failure.message,
              activeSlot: active?.slot ?? null,
              event,
            });
            void requestShutdown?.('fixed_decision_pilot_schedule_violation', failure);
            return;
          }
          if (event.phase === 'scheduled') {
            appendJournal('fixed_decision_pilot_slot_bound', {
              protocol: 'behold.fixed-decision-pilot-slot-binding.v1',
              slot: active.slot,
              opportunityId: event.opportunityId,
              requestSha256: event.requestSha256,
              observationSequence: event.observationSequence,
            });
          } else {
            settleFixedSlot(event);
          }
        },
        onAuxiliaryModelCall: (turn) => appendJournal('model_auxiliary_call', turn),
        onAuxiliaryModelError: (failure) => appendJournal('model_auxiliary_call_failed', failure),
        onContextIntervention: (intervention) =>
          appendJournal('context_intervention', intervention),
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
    console.error(
      `[console] LLM policy enabled (model ${model}${urgentModel ? `, bodily urgency ${urgentModel}` : ''}, mind ${mindAdapter}, policy ${policyProfile}, body ${bodyProfile}, actions ${actionProfile}, safety ${safetyProfile})`,
    );
  } else if (!apiKey) {
    console.error('[console] No admitted cognition credential; LLM autopilot disabled.');
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
    if (!experimentActive) {
      appendJournal('setup_operator_intervention', {
        protocol: 'behold.operator-intervention.v1',
        kind: 'console_action',
        phase: 'rejected',
        at: Date.now(),
        reason: 'experiment_not_released',
        action: { tool: (p as any).tool, input: (p as any).args },
      });
      cache.last = 'experiment setup is armed; action rejected until release';
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
    appendJournal('operator_intervention', {
      protocol: 'behold.operator-intervention.v1',
      kind: 'console_action',
      phase: 'proposed',
      at: Date.now(),
      action: { tool: intent.tool, input: structuredClone(intent.input ?? {}) },
    });
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
    releaseWaitAbort.abort(new Error(`controller shutdown before release settled: ${reason}`));
    fixedScheduleAbort.abort(new Error(`controller shutdown during fixed schedule: ${reason}`));
    shutdownPromise = Promise.resolve().then(async () => {
      try {
        appendJournal('run_stopping', { reason });
        if (displayTimer) clearInterval(displayTimer);
        displayTimer = null;
        await policy?.stop();
        await fixedSchedulePromise?.catch(() => undefined);
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
        await closeBotViewer(bot);
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

function admittedLmStudioModelInstance(
  value: unknown,
  policy: Parameters<typeof lmStudioResidentInstanceId>[0],
) {
  const configured = String(value || '').trim();
  const admitted = lmStudioResidentInstanceId(policy);
  if (!configured || configured !== admitted) {
    throw new Error('LM Studio model instance differs from the runner-admitted resident session');
  }
  return configured;
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
