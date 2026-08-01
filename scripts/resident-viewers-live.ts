#!/usr/bin/env node
import 'dotenv/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { io as connectViewer } from 'socket.io-client';
import { closeBotViewer, createBot } from '../src/bot';
import { InhabitantExperience } from '../src/agent/experience';
import { minecraftInhabitantActionsFor } from '../src/agent/affordances';
import { buildInterpreter } from '../src/agent/interpreter';
import { minecraftActionsForProfile } from '../src/agent/action-profiles';
import { getConfig } from '../src/config';
import { openEntityLoom } from '../src/entity/loom';
import { createEngine, type EngineEvent } from '../src/loop/engine';
import type { ResidentMind, ResidentMindRequest } from '../src/mind/interface';
import {
  createResidentMindRequestArtifact,
  type ResidentMindRequestArtifact,
} from '../src/mind/request-artifact';
import { createRunJournal } from '../src/observability/journal';
import { RESIDENT_VIEWER_PROTOCOL } from '../src/observability/resident-viewer';
import { startLLMPolicy } from '../src/policy/llm';
import { experimentReleaseGateFromEnvironment } from '../src/runtime/experiment-release';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import { parseManagedResidentArgs } from './managed-resident-cli';
import {
  assertCleanRepository,
  durableWriteJson,
  gitRevision,
  listFiles,
  prepareOwnedWorld,
  readJson,
  restoreEnvironment,
  sha256File,
  waitFor,
} from './owned-world-fixture';
import {
  disconnectMinecraftBot,
  waitForLocalWorld,
  waitForManagerStop,
} from './native-conformance-harness';
import { startManagedWorld } from './world-runner';

const PROTOCOL = 'behold.resident-viewers-live.v1';
const MODEL = 'script/watchability-proof-v1';
const PROFILE = 'minecraft-human-semantic-v1' as const;
const POLICY_PROFILE = 'neutral-benchmark-v1' as const;
const SAFETY_PROFILE = 'vanilla-player-v1' as const;
const RESIDENTS = Object.freeze([
  {
    entityId: 'WatchAster',
    action: 'look_direction',
    input: { horizontal: 'left', vertical: 'level' },
  },
  {
    entityId: 'WatchBirch',
    action: 'move_controls',
    input: { direction: 'forward', durationMs: 300 },
  },
]);

async function runProof() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: 'string' },
      port: { type: 'string' },
      viewerBasePort: { type: 'string' },
      hold: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help) {
    process.stdout.write(
      'Usage: resident-viewers-live [--run <safe-id>] [--port <server-port>] [--viewerBasePort <port>] [--hold]\n',
    );
    return;
  }
  assertCleanRepository();
  const runId = String(
    parsed.values.run || `resident-viewers-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const viewerBasePort = Number(parsed.values.viewerBasePort || 30_170);
  const fixture = await prepareOwnedWorld(
    runId,
    Number(parsed.values.port || 25_587),
    'resident-viewers-live',
  );
  const priorKey = process.env.OPENROUTER_API_KEY;
  const priorBase = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_API_KEY = 'provider-free-watchability-broker';
  // The broker validates its admitted protocol route even though this proof's
  // injected fetch rejects any attempt to use it.
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
  let upstreamCalls = 0;
  let run: Awaited<ReturnType<typeof startManagedWorld>> | null = null;
  try {
    run = await startManagedWorld(
      {
        worldId: fixture.worldId,
        world: fixture.world,
        controlRoot: fixture.controlRoot,
        serverDirectory: fixture.serverDirectory,
        serverJar: fixture.serverJar,
        expectedServerJarSha256: fixture.expectedServerJarSha256,
        java: fixture.java,
        controllerEntry: path.resolve('dist/scripts/resident-viewers-live.js'),
        entityRoot: fixture.entityRoot,
        runRoot: path.join(fixture.evidenceRoot, 'runs'),
        residents: RESIDENTS.map(({ entityId }) => ({
          entityId,
          model: MODEL,
          mind: 'direct' as const,
          policyProfile: POLICY_PROFILE,
          bodyProfile: PROFILE,
          actionProfile: PROFILE,
          safetyProfile: SAFETY_PROFILE,
          tickMs: 60_000,
          maxTurnSteps: 1,
          resumeAfterBudget: false,
          providerQuotas: { residentDecisionAttempts: 2, auxiliaryContextAttempts: 1 },
        })),
        residentViewers: {
          protocol: RESIDENT_VIEWER_PROTOCOL,
          basePort: viewerBasePort,
          viewDistance: 6,
        },
        accountingScopeId: 'resident-viewers-live-v1',
        maxResidents: 2,
        maxConcurrentModelCalls: 2,
        startupTimeoutMs: 90_000,
        shutdownTimeoutMs: 90_000,
      },
      {
        cognitionFetch: async () => {
          upstreamCalls += 1;
          throw new Error('watchability proof forbids provider transport');
        },
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
      },
    );
    if (!run.cognition || !run.experimentRelease) {
      throw new Error('watchability proof requires release and quota accounting');
    }
    if (run.residents.some((resident) => resident.viewer == null)) {
      throw new Error('managed runner did not expose every resident viewer');
    }
    const quotaBeforeViewing = run.cognition.accountingSnapshot();
    const witnesses = await Promise.all(
      run.residents.map((resident) => witnessViewer(resident.entityId, resident.viewer!.endpoint)),
    );
    const quotaAfterViewing = run.cognition.accountingSnapshot();
    if (JSON.stringify(quotaBeforeViewing) !== JSON.stringify(quotaAfterViewing)) {
      throw new Error('viewer connections changed provider quota accounting');
    }
    if (upstreamCalls !== 0) throw new Error(`viewer proof made ${upstreamCalls} upstream calls`);

    await waitFor(
      () =>
        run!.residents.every((resident) =>
          fs.existsSync(path.join(resident.journalDirectory, 'resident-viewers-phase.json')),
        ),
      30_000,
      'scripted resident viewer turns',
    );
    const phases = run.residents.map((resident) =>
      readJson(path.join(resident.journalDirectory, 'resident-viewers-phase.json')),
    );
    const forbiddenPresentationValues = [
      RESIDENT_VIEWER_PROTOCOL,
      ...run.residents.map((resident) => resident.viewer!.endpoint),
    ];
    for (const phase of phases) {
      assertNoPresentationLeak(phase.request, forbiddenPresentationValues, 'resident mind request');
      if (
        phase.request.request.bodyProfile !== PROFILE ||
        phase.request.request.actionProfile !== PROFILE ||
        phase.request.request.observation?.protocol !==
          'behold.minecraft-human-semantic-observation.v1'
      ) {
        throw new Error(`${phase.entityId} request does not use the human-semantic contract`);
      }
      const loomBytes = fs.readFileSync(phase.loomFile, 'utf8');
      assertNoPresentationLeak(loomBytes, forbiddenPresentationValues, 'resident Lync history');
      const journalBytes = fs.readFileSync(phase.journalFile, 'utf8');
      assertNoPresentationLeak(journalBytes, forbiddenPresentationValues, 'resident run history');
    }
    const releasePlanBytes = fs.readFileSync(run.experimentRelease.planFile, 'utf8');
    assertNoPresentationLeak(releasePlanBytes, forbiddenPresentationValues, 'experiment release');

    process.stdout.write(
      `[resident-viewers-live] READY ${run.residents
        .map((resident) => `${resident.entityId}=${resident.viewer!.endpoint}`)
        .join(' ')}\n`,
    );
    if (parsed.values.hold) {
      process.stdout.write('[resident-viewers-live] HOLD: press Return after viewing both tabs\n');
      try {
        await new Promise<void>((resolve) => process.stdin.once('data', () => resolve()));
      } finally {
        // Reading from a TTY starts its libuv handle. Pause it again so this
        // optional operator witness cannot keep a completed proof alive.
        process.stdin.pause();
      }
    }

    const endpoints = run.residents.map((resident) => resident.viewer!.endpoint);
    await run.stop('resident_viewers_live_complete');
    await run.finished;
    for (const endpoint of endpoints) {
      if (await endpointReachable(endpoint))
        throw new Error(`viewer survived managed stop: ${endpoint}`);
    }
    const quotaAfterStop = quotaProjection(run.cognition.accountingSnapshot());
    if (
      quotaAfterStop.some(
        (account) => account.used.resident_decision !== 0 || account.used.loom_fold !== 0,
      )
    ) {
      throw new Error('scripted watchability turns consumed provider attempt quota');
    }
    const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
    const configured = lifecycle.events.find((event) => event.type === 'run_configured');
    if (
      (configured?.data as any)?.population?.presentation?.protocol !== RESIDENT_VIEWER_PROTOCOL
    ) {
      throw new Error('operator lifecycle omitted the managed viewer presentation contract');
    }
    const reportFile = path.join(fixture.evidenceRoot, 'resident-viewers-live.json');
    durableWriteJson(reportFile, {
      protocol: PROTOCOL,
      repositoryRevision: gitRevision(),
      runId: fixture.runId,
      managedRunId: run.runId,
      worldId: fixture.worldId,
      providerCalls: upstreamCalls,
      modelInference: false,
      viewers: run.residents.map((resident, index) => ({
        entityId: resident.entityId,
        ...resident.viewer,
        witness: witnesses[index],
        reachableAfterStop: false,
      })),
      residentTurns: phases.map((phase) => ({
        entityId: phase.entityId,
        action: phase.turn.action,
        outcome: phase.turn.outcome,
        requestSha256: phase.request.requestSha256,
        loomFile: phase.loomFile,
        loomSha256: sha256File(phase.loomFile),
      })),
      nonInterference: {
        requestAndLyncPresentationLeak: false,
        releasePresentationLeak: false,
        quotaBeforeViewing: quotaProjection(quotaBeforeViewing),
        quotaAfterViewing: quotaProjection(quotaAfterViewing),
        quotaAfterStop,
      },
      lifecycle: {
        file: run.control.journalFile,
        eventCount: lifecycle.events.length,
        tipDigest: lifecycle.tipDigest,
      },
      completedAt: new Date().toISOString(),
    });
    process.stdout.write(
      `[resident-viewers-live] PASS ${reportFile}\n[resident-viewers-live] sha256 ${sha256File(reportFile)}\n`,
    );
  } catch (error) {
    if (run) await run.stop('resident_viewers_live_failed').catch(() => {});
    throw error;
  } finally {
    restoreEnvironment('OPENROUTER_API_KEY', priorKey);
    restoreEnvironment('OPENROUTER_BASE_URL', priorBase);
  }
}

async function runResident() {
  const args = parseManagedResidentArgs();
  const entityId = String(args.positionals[0] || '');
  const resident = RESIDENTS.find((candidate) => candidate.entityId === entityId);
  if (!resident) throw new Error(`unknown watchability resident ${entityId}`);
  if (args.values.server) process.env.SERVER_HOST = String(args.values.server);
  if (args.values.port) process.env.SERVER_PORT = String(args.values.port);
  if (args.values.world) process.env.BEHOLD_WORLD_ID = String(args.values.world);
  process.env.MINECRAFT_USERNAME = String(args.values.body || entityId);
  process.env.MINECRAFT_AUTH = 'offline';

  const cfg = getConfig();
  const loom = await openEntityLoom(entityId, undefined, cfg.circle.id);
  const journal = createRunJournal(entityId);
  let bot: ReturnType<typeof createBot> | null = null;
  let experience: InhabitantExperience | null = null;
  let engine: ReturnType<typeof createEngine> | null = null;
  let policy: ReturnType<typeof startLLMPolicy> | null = null;
  try {
    bot = createBot(cfg, loom.connectionCapability, entityId);
    experience = new InhabitantExperience(bot as any, {
      entityId,
      circleId: cfg.circle.id,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      eventHistory: 80,
    });
    const interpreter = buildInterpreter(bot as any, {
      observe: () => experience!.observe(),
      safetyProfile: SAFETY_PROFILE,
    });
    const completeSpecs = interpreter.list('inhabitant').map((spec: any) => ({
      type: 'function' as const,
      function: {
        name: spec.name,
        description: spec.description || '',
        parameters: spec.parameters || { type: 'object', properties: {} },
      },
    }));
    const toolSpecs = minecraftActionsForProfile(completeSpecs, PROFILE);
    const engineEvents: EngineEvent[] = [];
    engine = createEngine(
      {
        authorize: async (name, _input, intent) => ({
          ok: true,
          authority: 'resident-viewers-live-script',
          evidence: { entityId, intentId: intent.id, tool: name },
        }),
        run: (name, input, _intent, execution) => interpreter.run(name, input, execution),
        list: () => interpreter.list('inhabitant'),
      },
      {
        tickMs: 20,
        onEvent: (event) => {
          engineEvents.push(event);
          experience!.recordEngineEvent(event);
          return policy?.onEngineEvent(event);
        },
      },
    );
    engine.start();
    await waitForLocalWorld(bot, 45_000, `${entityId} local world`);
    const gate = experimentReleaseGateFromEnvironment({
      entityId,
      bodyUsername: cfg.auth.username,
      model: MODEL,
      urgentModel: null,
      mind: 'direct',
      profiles: {
        policy: POLICY_PROFILE,
        body: PROFILE,
        actions: PROFILE,
        safety: SAFETY_PROFILE,
      },
      quotaAccountId: process.env.BEHOLD_COGNITION_ACCOUNT_ID,
    });
    if (!gate) throw new Error('watchability resident has no release gate');
    const setupObservation = experience.observe();
    gate.arm({ journalFile: journal.file, setupObservation });
    process.stderr.write(
      `[bot] Experiment release armed: ${gate.prepared.plan.releaseId} ${entityId}\n`,
    );
    const release = await gate.waitAndClaim();
    experience.resetForExperimentRelease();
    let requestArtifact: ResidentMindRequestArtifact | null = null;
    const turns: any[] = [];
    const mind: ResidentMind = {
      id: 'resident-viewers-live-script-mind',
      decide: async (request) => {
        requestArtifact = createResidentMindRequestArtifact(request);
        journal.append('mind_request', requestArtifact);
        return {
          protocol: 'behold.mind-decision.v1',
          disposition: 'act',
          utterance: `I will ${resident.action.replaceAll('_', ' ')} once.`,
          action: { name: resident.action, input: resident.input },
          call: scriptedCallEvidence(request, requestArtifact.requestSha256),
        };
      },
    };
    policy = startLLMPolicy(
      {
        entityId,
        observe: (sinceSequence) => experience!.observe(sinceSequence),
        actions: toolSpecs,
        actionsFor: (observation) =>
          minecraftInhabitantActionsFor(toolSpecs, observation, {
            bodyProfile: PROFILE,
            safetyProfile: SAFETY_PROFILE,
          }),
        attempt: (intent) => engine!.enqueueIntent(intent),
      },
      {
        apiKey: 'unused-scripted-mind',
        model: MODEL,
        mind,
        tickMs: 60_000,
        maxTurnSteps: 1,
        resumeAfterBudget: false,
        policyProfile: POLICY_PROFILE,
        bodyProfile: PROFILE,
        actionProfile: PROFILE,
        safetyProfile: SAFETY_PROFILE,
        experimentRelease: () => release,
        history: await loom.readAll(),
        acceptEngineEvent: engine.acceptsEvent,
        onEntityTurn: async (turn) => {
          await loom.append(turn);
          turns.push(turn);
          journal.append('entity_turn', {
            id: turn.id,
            action: turn.action,
            outcome: turn.outcome,
          });
        },
      },
    );
    await policy.tick();
    await waitFor(
      () => turns.length === 1 && policy!.state().pendingIntentId == null,
      20_000,
      `${entityId} scripted terminal turn`,
    );
    if (!requestArtifact) throw new Error(`${entityId} did not receive a mind request`);
    const phaseFile = path.join(
      path.resolve(process.env.BEHOLD_RUN_DIR!),
      'resident-viewers-phase.json',
    );
    durableWriteJson(phaseFile, {
      protocol: 'behold.resident-viewers-live-phase.v1',
      entityId,
      request: requestArtifact,
      turn: turns[0],
      loomFile: loom.file,
      journalFile: journal.file,
      release,
      engineEvents: engineEvents.map((event) => event.type),
      completedAt: new Date().toISOString(),
    });
    await waitForManagerStop(bot, entityId);
    await policy.stop();
    const drain = await engine.shutdown('managed_stdin_closed');
    if (!drain.drained) throw new Error(`${entityId} engine did not drain`);
    experience.destroy();
    experience = null;
    await disconnectMinecraftBot(bot);
    await closeBotViewer(bot);
    bot = null;
    await loom.close();
  } catch (error) {
    await policy?.stop().catch(() => {});
    await engine?.shutdown('resident_viewers_live_failed').catch(() => {});
    experience?.destroy();
    if (bot) {
      await disconnectMinecraftBot(bot).catch(() => {});
      await closeBotViewer(bot).catch(() => {});
    }
    await loom.close().catch(() => {});
    throw error;
  }
}

async function witnessViewer(entityId: string, endpoint: string) {
  const response = await fetch(endpoint);
  const html = await response.text();
  if (!response.ok || (!html.includes('<canvas') && !html.includes('<script'))) {
    throw new Error(`${entityId} viewer did not return the Prismarine client`);
  }
  const socket = connectViewer(endpoint, {
    path: '/socket.io',
    transports: ['websocket'],
    forceNew: true,
  });
  try {
    const version = socketOnce(socket, 'version');
    const position = socketOnce(socket, 'position');
    await socketOnce(socket, 'connect');
    const [minecraftVersion, firstPosition] = await Promise.all([version, position]);
    return {
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      htmlBytes: Buffer.byteLength(html),
      socketConnected: true,
      minecraftVersion,
      firstPositionReceived: Boolean(firstPosition?.pos),
    };
  } finally {
    socket.disconnect();
  }
}

function socketOnce(socket: ReturnType<typeof connectViewer>, event: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`viewer socket ${event} timed out`)), 5_000);
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

async function endpointReachable(endpoint: string) {
  try {
    await fetch(endpoint, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

function assertNoPresentationLeak(value: unknown, forbidden: readonly string[], label: string) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const leaked = forbidden.find((candidate) => text.includes(candidate));
  if (leaked) throw new Error(`${label} leaked managed presentation value ${leaked}`);
}

function quotaProjection(
  snapshot: ReturnType<
    NonNullable<Awaited<ReturnType<typeof startManagedWorld>>['cognition']>['accountingSnapshot']
  >,
) {
  return snapshot.accounts.map((account) => ({
    accountId: account.accountId,
    limits: account.limits,
    used: account.used,
    remaining: account.remaining,
  }));
}

function scriptedCallEvidence(request: ResidentMindRequest, requestSha256: string) {
  const startedAt = Date.now();
  const body = JSON.stringify(request);
  const completedAt = Date.now();
  return {
    protocol: 'behold.model-call.v1' as const,
    requestId: `watchability-${startedAt}-${requestSha256.slice(0, 8)}`,
    endpoint: 'script://watchability-proof',
    startedAt,
    completedAt,
    latencyMs: completedAt - startedAt,
    adapter: { name: 'resident-viewers-live-script-mind', version: '1' },
    request: {
      model: request.model,
      messageCount: request.conversation.length,
      toolCount: request.actions.length,
      toolChoice: 'required',
      mindRequestSha256: requestSha256,
      bodySha256: sha256Text(body),
      messagesSha256: sha256Text(JSON.stringify(request.conversation)),
      toolsSha256: sha256Text(JSON.stringify(request.actions)),
      bodyBytes: Buffer.byteLength(body),
      kind: 'mind_input' as const,
    },
    response: {
      id: null,
      model: request.model,
      provider: 'deterministic-script',
      finishReason: 'act',
      nativeFinishReason: null,
      usage: null,
    },
  };
}

function sha256Text(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

if (process.argv.slice(2).includes('--server')) {
  void runResident().catch((error) => {
    process.stderr.write(
      `[resident-viewers-live:resident] ${error instanceof Error ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
} else {
  void runProof().catch((error) => {
    process.stderr.write(
      `[resident-viewers-live] ${error instanceof Error ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
}
