import readline from 'node:readline';
import type { ConfigEnvironment } from '../config';
import {
  captureBotViewerFrame,
  closeBotViewer,
  createBot,
  retainBotViewerAdmittedFrame,
} from '../bot';
import { buildInterpreter } from '../agent/interpreter';
import { minecraftInhabitantActionsFor } from '../agent/affordances';
import { minecraftActionsForProfile } from '../agent/action-profiles';
import { buildFrame, renderFrame } from './render';
import { parseLine } from './parse';
import { createEngine } from '../loop/engine';
import { isBodilyUrgencyEvent, isImmediateAttentionEvent, startLLMPolicy } from '../policy/llm';
import { createAxResidentMind } from '../mind/ax';
import { createOllamaLocalResidentMind } from '../mind/ollama';
import {
  createLmStudioLocalLoomSummarizer,
  createLmStudioLocalResidentMind,
} from '../mind/lmstudio';
import {
  LMSTUDIO_LOCAL_LOOM_FOLD_TRANSPORT_PROTOCOL,
  lmStudioResidentInstanceId,
} from '../mind/lmstudio-local';
import { usesOllamaResidentSessionTransport } from '../mind/ollama-json-action';
import { usesContinuousResidentTranscript, usesResidentSessionPolicy } from '../policy/profile';
import { createRunJournal } from '../observability/journal';
import {
  createResidentLifeCommit,
  projectOperationalBodyObservation,
  projectOperationalModelTurn,
  RESIDENT_LIFE_COMMIT_EVENT,
} from '../observability/resident-life-commit';
import { openEntityLoom } from '../entity/loom';
import { readLoomFoldCache, type BoundedLoomContextState } from '../entity/folding';
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
  runFixedDecisionPilotSchedule,
  type FixedDecisionPilotSlot,
} from '../policy/fixed-decision-pilot';
import {
  resolveResidentRuntimeConfig,
  type ResidentRuntimeOptions,
} from '../runtime/resident-config';

const INITIAL_WORLD_SYNC_SETTLE_MS = 4_000;
const LIVE_FOLD_RECENT_TURNS = 6;

export type ConsoleOptions = ResidentRuntimeOptions & {
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

export function incomingChatPolicySignal(
  username: string,
  managedBodyUsernames: ReadonlySet<string>,
): 'wake' | 'resume' {
  return managedBodyUsernames.has(
    String(username || '')
      .trim()
      .toLowerCase(),
  )
    ? 'wake'
    : 'resume';
}

export async function runConsole(
  opts: ConsoleOptions = {},
  environment: ConfigEnvironment = process.env,
) {
  const runtime = resolveResidentRuntimeConfig(opts, environment);
  const cfg = runtime.minecraft;
  const name = runtime.entityId;
  const bodyUsername = runtime.bodyUsername;
  const urgentModel = runtime.urgentModel;
  const urgentDecisionTimeoutMs = runtime.urgentDecisionTimeoutMs;
  const policyProfile = runtime.profiles.policy;
  const bodyProfile = runtime.profiles.body;
  const actionProfile = runtime.profiles.actions;
  const safetyProfile = runtime.profiles.safety;
  const perceptionProfile = runtime.profiles.perception;
  const mindAdapter = runtime.cognition.mind;
  const cognitionTransport = runtime.cognition.authenticatedTransport;
  const providerRoute = runtime.cognition.providerRoute;
  const ollamaLocal = runtime.cognition.ollamaLocal;
  const lmStudioLocal = runtime.cognition.lmStudioLocal;
  const maxTurnSteps = runtime.maxTurnSteps;
  const resumeAfterBudget = runtime.resumeAfterBudget;
  const decisionSchedule = runtime.decisionSchedule;
  const releaseGate = experimentReleaseGateFromEnvironment(
    {
      entityId: name,
      bodyUsername,
      model: cfg.llm.model,
      urgentModel: urgentModel ?? null,
      urgentDecisionTimeoutMs,
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
        perception: perceptionProfile,
      },
      quotaAccountId: runtime.managed.quotaAccountId,
    },
    environment as NodeJS.ProcessEnv,
  );
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
  const projects = createProjectMemory(name);
  const places = createPlaceMemory(name);
  for await (const priorTurn of entityLoom.scan()) {
    projects.record(priorTurn);
    places.record(priorTurn);
  }
  const priorEntityTurns = entityLoom.length();
  const boundedTail = await entityLoom.tailBound(LIVE_FOLD_RECENT_TURNS + 1);
  const recentBound = boundedTail.slice(-LIVE_FOLD_RECENT_TURNS);
  const boundaryBound =
    priorEntityTurns > recentBound.length
      ? (boundedTail.at(-recentBound.length - 1) ?? null)
      : null;
  const residentLoomContext: BoundedLoomContextState = {
    protocol: 'behold.bounded-loom-context.v1',
    entityId: name,
    totalTurns: priorEntityTurns,
    recentTurns: recentBound.map((entry) => entry.turn),
    recentSources: recentBound.map((entry) => entry.source),
    fold: readLoomFoldCache(entityLoom.foldFile),
    foldSource: boundaryBound
      ? { tipTurn: boundaryBound.turn, source: boundaryBound.source }
      : null,
    rebuild: () => entityLoom.scanBound(),
  };
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
    runtime.task === 'come-see-do-report' ? runtime.target || 'importdf' : (runtime.target ?? null);
  appendJournal('run_started', {
    runId: runtime.managed.runId || journal.id,
    journalId: journal.id,
    server: cfg.server,
    circle: cfg.circle,
    authMode: cfg.auth.mode,
    body: { substrate: 'minecraft', username: bodyUsername },
    model: cfg.llm.model,
    urgentModel: urgentModel ?? null,
    controller: {
      kind: runtime.cognition.apiKey && !runtime.paused ? 'llm' : 'operator',
      mindAdapter,
      providerRoute,
      ollamaLocal,
      lmStudioLocal,
      policyProfile,
      bodyProfile,
      actionProfile,
      safetyProfile,
      perceptionProfile,
      urgentModel: urgentModel ?? null,
      urgentDecisionTimeoutMs,
      tickMs: runtime.tickMs,
      maxTurnSteps,
      resumeAfterBudget,
      decisionSchedule,
      paused: runtime.paused,
      allowTools: runtime.allowTools,
      experimentRelease: releaseGate
        ? {
            state: 'setup_waiting',
            releaseId: releaseGate.prepared.plan.releaseId,
            planFile: releaseGate.prepared.planFile,
            planSha256: releaseGate.prepared.planSha256,
          }
        : null,
    },
    task: runtime.task ?? null,
    target: taskTarget,
    entityLoom: entityLoom.file,
    entityLoomBackend: entityLoom.backend,
    priorEntityTurns,
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
    `[entity] ${entityLoom.file} (${priorEntityTurns} prior turns, ${entityLoom.backend})`,
  );
  console.error(`[circle] ${cfg.circle.id} (${cfg.circle.source})`);
  for (const warning of entityLoom.warnings) console.error(`[entity] ${warning}`);
  console.error(
    `[console] connecting life ${name} to ${cfg.server.host}:${cfg.server.port} as Minecraft body ${bodyUsername}`,
  );
  const bot = createBot(cfg, entityLoom.connectionCapability, name);
  const taskRuntime =
    runtime.task === 'come-see-do-report'
      ? createComeSeeDoReportRuntime(bot as any, taskTarget!)
      : null;
  const task = taskRuntime?.task ?? resolveTask(runtime.task, runtime.target);
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
    managedRunId: runtime.managed.runId,
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
      if (isImmediateAttentionEvent(event)) {
        policy?.wake({
          kind: 'world_event',
          type: event.type,
          sequence: event.sequence,
          salience: event.salience,
        });
      }
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
    else policy.wake({ kind: 'initial' });
  };

  const recordTaskProgress = () => {
    if (!taskRuntime) return null;
    const progress = taskRuntime.verifier.snapshot(experience.observe());
    appendJournal(experimentActive ? 'task_progress' : 'setup_task_progress', progress);
    return progress;
  };

  const cache: any = { chatTail: [], nearby: [], cursor: null, last: null };
  const recordExternalPlayerIntervention = (
    kind: 'joined' | 'left' | 'chat' | 'whisper',
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
  const receiveSpeech = (channel: 'public' | 'private') => (user: string, text: string) => {
    if (user === (bot as any).username) return;
    const policySignal = incomingChatPolicySignal(user, managedBodyUsernames);
    recordExternalPlayerIntervention(channel === 'private' ? 'whisper' : 'chat', user, {
      text,
      channel,
    });
    cache.chatTail.push({ user, text, channel });
    cache.chatTail = cache.chatTail.slice(-3);
    appendJournal(experimentActive ? 'chat_received' : 'setup_chat_received', {
      user,
      text,
      channel,
      senderPopulation:
        policySignal === 'wake' ? 'managed_resident_peer' : 'native_human_or_unmanaged_player',
    });
    if (experimentActive) {
      taskRuntime?.permissions.recordIncomingChat(user, text);
      taskRuntime?.verifier.recordIncomingChat(user, text);
      if (taskRuntime) appendJournal('task_permissions', taskRuntime.permissions.snapshot());
      recordTaskProgress();
    }
    if (!taskRuntime || user.toLowerCase() === taskRuntime.task.target?.toLowerCase()) {
      if (experimentActive) {
        engine?.muteLLM(false);
        if (policySignal === 'resume') policy?.resume();
        else {
          policy?.wake({
            kind: 'world_event',
            type: 'chat_received',
            sequence: null,
            salience: 'high',
          });
        }
      }
    } else {
      if (localWorldReady && experimentActive) {
        policy?.wake({
          kind: 'world_event',
          type: 'chat_received',
          sequence: null,
          salience: 'high',
        });
      }
    }
  };
  bot.on('chat', receiveSpeech('public'));
  bot.on('whisper', receiveSpeech('private'));

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
    tickMs: runtime.tickMs,
    allowTools: runtime.allowTools as string[] | null,
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
        if (localWorldReady && experimentActive) {
          policy?.wake({ kind: 'external' });
        }
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
      cache.decisionCycle = policy?.state().decisionCycle ?? null;
      const text = renderFrame(name, buildFrame(bot as any, cache));
      process.stdout.write(`\x1b[2K\r${text.split('\n').join('\n')}\n`);
      prompt();
      rl.prompt();
    } catch {}
  };

  bot.once('spawn', () => {
    appendJournal(
      releaseGate ? 'setup_spawned' : 'spawned',
      projectOperationalBodyObservation(experience.observe()),
    );
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
            appendJournal(
              'setup_operator_hook_completed',
              projectOperationalBodyObservation(experience.observe()),
            );
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
        const mindPreparation = policy ? await policy.prepareMind() : null;
        if (mindPreparation != null) {
          appendJournal(releaseGate ? 'setup_model_prefix_readiness' : 'model_prefix_readiness', {
            protocol: 'behold.model-prefix-readiness-event.v1',
            phase: releaseGate ? 'setup_before_experiment_release' : 'before_policy_start',
            worldReleased: releaseGate == null,
            actionAuthority: 'none',
            evidence: mindPreparation,
          });
        }
        if (releaseGate) {
          appendJournal(
            'setup_local_world_ready',
            projectOperationalBodyObservation(readyObservation),
          );
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
          appendJournal('local_world_ready', projectOperationalBodyObservation(readyObservation));
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
        appendJournal(
          experimentActive ? 'observation' : 'setup_observation',
          projectOperationalBodyObservation(observation),
        );
      }
    }, 1500);
  });

  // Optional LLM policy
  const apiKey = runtime.cognition.apiKey;
  const cognitionEndpoint = runtime.cognition.endpoint;
  const lmStudioModelInstance = lmStudioLocal
    ? admittedLmStudioModelInstance(runtime.cognition.lmStudioModelInstanceId, lmStudioLocal)
    : null;
  const model = runtime.model;
  if (apiKey && !runtime.paused) {
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
        perceptionProfile,
        ...(perceptionProfile === 'semantic-plus-camera-v1'
          ? {
              capturePerception: (observation: unknown, options: { signal: AbortSignal }) =>
                captureBotViewerFrame(bot, observation, options),
              onPerceptionAdmitted: (frame) => retainBotViewerAdmittedFrame(bot, frame),
            }
          : {}),
        workingContinuity: usesContinuousResidentTranscript(policyProfile)
          ? 'continuous-transcript-v1'
          : (ollamaLocal && usesOllamaResidentSessionTransport(ollamaLocal)) ||
              lmStudioLocal ||
              (usesResidentSessionPolicy(policyProfile) &&
                (providerRoute?.protocol === 'behold.openrouter-route-policy.v2' ||
                  providerRoute?.protocol === 'behold.openrouter-route-policy.v3' ||
                  providerRoute?.protocol === 'behold.openrouter-route-policy.v4' ||
                  providerRoute?.protocol === 'behold.openrouter-route-policy.v5'))
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
                apiURL: openAICompatibleBaseURL(environment.OPENROUTER_BASE_URL),
                recordModelIO: runtime.cognition.recordModelIO,
                cognitionTransport,
              })
            : ollamaLocal
              ? createOllamaLocalResidentMind({
                  bearer: apiKey!,
                  endpoint: cognitionEndpoint!,
                  policy: ollamaLocal,
                  cognitionTransport: true,
                  recordModelIO: runtime.cognition.recordModelIO,
                })
              : lmStudioLocal
                ? createLmStudioLocalResidentMind({
                    bearer: apiKey!,
                    endpoint: cognitionEndpoint!,
                    policy: lmStudioLocal,
                    modelInstanceId: lmStudioModelInstance!,
                    cognitionTransport: true,
                    recordModelIO: runtime.cognition.recordModelIO,
                  })
                : undefined,
        ...(lmStudioLocal
          ? {
              summarizeLoom: createLmStudioLocalLoomSummarizer({
                bearer: apiKey!,
                endpoint: cognitionEndpoint!,
                policy: lmStudioLocal,
                modelInstanceId: lmStudioModelInstance!,
                cognitionTransport: true,
                recordModelIO: runtime.cognition.recordModelIO,
                onCall: (turn) => appendJournal('model_auxiliary_call', turn),
                onError: (failure) => appendJournal('model_auxiliary_call_failed', failure),
              }),
              foldSummarizerProtocol: LMSTUDIO_LOCAL_LOOM_FOLD_TRANSPORT_PROTOCOL,
            }
          : {}),
        recordModelIO: runtime.cognition.recordModelIO,
        cognitionTransport,
        ...(providerRoute ? { routePolicy: providerRoute } : {}),
        tickMs: runtime.tickMs,
        maxTurnSteps,
        resumeAfterBudget,
        decisionScheduling: decisionSchedule ? 'fixed-pilot-slots' : 'world-events',
        allowTools: runtime.allowTools as string[] | null,
        // The complete loom stays authoritative. The adjacent fold is only a
        // validated, disposable prompt view over older turns.
        loomContext: residentLoomContext,
        readPrivateLife: (startSequence, endSequence, maxBytes) =>
          entityLoom.recallRange(startSequence, endSequence, maxBytes),
        foldCacheFile: entityLoom.foldFile,
        log: (s) => console.error(s),
        acceptEngineEvent: engine.acceptsEvent,
        onModelTurn: (turn) => {
          taskRuntime?.verifier.recordControllerDecision(turn.intent, turn.observation);
          appendJournal('model_turn', projectOperationalModelTurn(turn));
        },
        onModelError: (failure) => {
          appendJournal('model_call_failed', failure);
          if (failure.call?.response?.terminal === 'quota_exhausted') {
            policy?.suspend('resident_purpose_quota_exhausted');
          }
        },
        onModelInterrupted: (interruption) => appendJournal('model_call_interrupted', interruption),
        onPerceptionSettlement: (event) => appendJournal('perception_settlement', event),
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
          const committed = await entityLoom.append(turn);
          projects.record(turn);
          places.record(turn);
          appendJournal(RESIDENT_LIFE_COMMIT_EVENT, createResidentLifeCommit(turn, committed));
          return { protocol: 'lync.file-loom-chain.v1' as const, digest: committed.chainDigest };
        },
      },
    );
    startPolicyIfReady();
    console.error(
      `[console] LLM policy enabled (model ${model}${urgentModel ? `, bodily urgency ${urgentModel}` : ''}, mind ${mindAdapter}, policy ${policyProfile}, body ${bodyProfile}, actions ${actionProfile}, safety ${safetyProfile}, perception ${perceptionProfile})`,
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
        'Commands: cognition pause|resume, say, status, nearby, survey [radius=16 step=4], cursor, look <x y z|@cursor>, move to <x y z|@cursor> [near=n], stop, dig <x y z|@cursor>, place @cursor, place at <x y z> [name=block], equip <name>, eat [name]',
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
    if ((p as any).meta === 'cognition') {
      const state = (p as any).args?.state;
      if (!experimentActive || !policy || !['paused', 'running'].includes(state)) {
        appendJournal('operator_cognition_control', {
          protocol: 'behold.operator-cognition-control.v1',
          phase: 'rejected',
          state,
          reason: !experimentActive ? 'experiment_not_released' : 'cognition_unavailable',
        });
        console.error(`[console] cognition control rejected: ${state || 'invalid'}`);
        show();
        return;
      }
      if (state === 'paused') policy.suspend('operator_control');
      else policy.resume('operator_control');
      appendJournal('operator_cognition_control', {
        protocol: 'behold.operator-cognition-control.v1',
        phase: 'acknowledged',
        state,
      });
      console.error(`[console] cognition control acknowledged: ${state}`);
      cache.last = `cognition ${state}`;
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
