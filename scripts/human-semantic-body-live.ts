#!/usr/bin/env node
import 'dotenv/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { createBot } from '../src/bot';
import { getConfig } from '../src/config';
import { InhabitantExperience } from '../src/agent/experience';
import { minecraftInhabitantActionsFor } from '../src/agent/affordances';
import { buildInterpreter } from '../src/agent/interpreter';
import { minecraftActionsForProfile } from '../src/agent/action-profiles';
import {
  openEntityLoom,
  readEntityLifeRange,
  resolveEntityLifeRange,
  type EntityTurn,
} from '../src/entity/loom';
import { createEngine, type EngineEvent } from '../src/loop/engine';
import type { ResidentMind, ResidentMindRequest } from '../src/mind/interface';
import {
  createResidentMindRequestArtifact,
  type ResidentMindRequestArtifact,
} from '../src/mind/request-artifact';
import { createRunJournal } from '../src/observability/journal';
import { startLLMPolicy } from '../src/policy/llm';
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
  type OwnedWorldBlock,
} from './owned-world-fixture';
import {
  disconnectMinecraftBot,
  positionDistance,
  requiredEnvironment,
  waitForLocalWorld,
  waitForManagerStop,
} from './native-conformance-harness';
import { startManagedWorld } from './world-runner';

const PROTOCOL = 'behold.human-semantic-body-live.v1';
const PHASE_PROTOCOL = 'behold.human-semantic-body-live-phase.v1';
const TARGET_PROTOCOL = 'behold.human-semantic-body-live-target.v1';
const ENTITY_ID = 'SemanticBody';
const TARGET_ID = 'SemanticTarget';
const MODEL = 'script/human-semantic-body-live-v1';
const PROFILE = 'minecraft-human-semantic-v1' as const;
const POLICY_PROFILE = 'neutral-benchmark-v1' as const;
const SAFETY_PROFILE = 'vanilla-player-v1' as const;
const START = Object.freeze({ x: 0, y: -60, z: 0 });
const TARGET_FEET = Object.freeze({ x: 0, y: -60, z: 3 });
const USE_TARGET = Object.freeze({ x: 2, y: -60, z: 0 });
const CHAT_TEXT = 'semantic body live check';
const REQUEST_FORBIDDEN_KEYS = new Set([
  'worldId',
  'circleId',
  'managedRunId',
  'position',
  'coordinates',
  'x',
  'y',
  'z',
  'yaw',
  'pitch',
  'velocity',
  'distance',
  'maxDistance',
  'remainingDistance',
  'requestedDestination',
  'targetFeet',
  'suggestedFeetPositions',
  'pickupGround',
  'support',
  'navigation',
  'path',
  'registry',
  'recipe',
  'projects',
  'places',
  'placeConflicts',
  'controller',
  'controllerState',
  'evaluator',
  'evaluation',
]);
const FORBIDDEN_ACTIONS = new Set([
  'manage_project',
  'move_to',
  'move_direction',
  'approach_entity',
  'attack_entity',
  'collect_nearby_item',
  'find_blocks',
  'inspect_volume',
  'survey_area',
  'status',
]);

type ScriptedChoice = Readonly<{
  name: string;
  input: Readonly<Record<string, unknown>>;
  utterance: string;
  beforeReturn?: () => Promise<void>;
}>;

async function runProof() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: 'string' },
      port: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help) {
    process.stdout.write(
      'Usage: human-semantic-body-live [--run <safe-id>] [--port <unused-loopback-port>]\n',
    );
    return;
  }
  assertCleanRepository();
  const runId = String(
    parsed.values.run || `human-semantic-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const fixtureBlocks: OwnedWorldBlock[] = [
    {
      ...USE_TARGET,
      block: 'oak_trapdoor[facing=north,half=bottom,open=false,powered=false,waterlogged=false]',
    },
  ];
  const fixture = await prepareOwnedWorld(
    runId,
    Number(parsed.values.port || 25584),
    'human-semantic-body-live',
    { ...START, item: 'apple', count: 1 },
    [],
    fixtureBlocks,
  );
  const sharedRoot = path.join(fixture.evidenceRoot, 'live');
  fs.mkdirSync(sharedRoot, { recursive: true, mode: 0o700 });
  const releaseFile = path.join(sharedRoot, 'all-ready-release.json');
  const phaseFile = path.join(sharedRoot, 'source-phase.json');
  const targetFile = path.join(sharedRoot, 'target-state.json');
  const serverProperties = path.join(fixture.serverDirectory, 'server.properties');
  const priorProperties = fs.readFileSync(serverProperties, 'utf8');
  if (!priorProperties.includes('pvp=false')) throw new Error('owned fixture pvp setting changed');
  fs.writeFileSync(serverProperties, priorProperties.replace('pvp=false', 'pvp=true'), 'utf8');

  const priorApiKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
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
        controllerEntry: path.resolve('dist/scripts/human-semantic-body-live.js'),
        entityRoot: fixture.entityRoot,
        runRoot: path.join(fixture.evidenceRoot, 'runs'),
        residents: [ENTITY_ID, TARGET_ID].map((entityId) => ({
          entityId,
          model: MODEL,
          policyProfile: POLICY_PROFILE,
          bodyProfile: PROFILE,
          actionProfile: PROFILE,
          safetyProfile: SAFETY_PROFILE,
          tickMs: 60_000,
          maxTurnSteps: 1,
          resumeAfterBudget: false,
          environment: {
            BEHOLD_HUMAN_SEMANTIC_ROLE: entityId === ENTITY_ID ? 'source' : 'target',
            BEHOLD_HUMAN_SEMANTIC_RELEASE: releaseFile,
            BEHOLD_HUMAN_SEMANTIC_PHASE: phaseFile,
            BEHOLD_HUMAN_SEMANTIC_TARGET: targetFile,
          },
        })),
        maxResidents: 2,
        maxConcurrentModelCalls: 2,
        startupTimeoutMs: 90_000,
        shutdownTimeoutMs: 90_000,
      },
      {
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
      },
    );
    if (run.cognition !== null)
      throw new Error('provider-free proof unexpectedly started cognition');
    const release = {
      protocol: 'behold.operator-intervention.v1',
      kind: 'disposable_fixture_release',
      runId: run.runId,
      residents: run.residents.map((resident) => resident.entityId),
      pvpEnabledForAttackObservation: true,
      at: new Date().toISOString(),
    };
    run.control.append('operator_intervention', release);
    durableWriteJson(releaseFile, release);
    await Promise.race([
      waitFor(() => fs.existsSync(phaseFile), 90_000, 'human-semantic live phase evidence'),
      run.finished.then(() => {
        throw new Error('managed world ended before human-semantic live phase evidence');
      }),
    ]);
    const phase = readJson(phaseFile);
    assessPhase(phase);
    await run.quiesceResidents('human_semantic_body_live_evidence_complete');

    const range = await resolveEntityLifeRange(
      ENTITY_ID,
      1,
      Number(phase.turns.length),
      fixture.entityRoot,
    );
    const life = await readEntityLifeRange(range, fixture.entityRoot);
    const journals = listFiles(run.residents[0].journalDirectory).filter((file) =>
      file.endsWith('.jsonl'),
    );
    if (journals.length !== 1) {
      throw new Error(`expected one source run journal, found ${journals.length}`);
    }
    const journalEvents = readJsonLines(journals[0]);
    assessPersistedEvidence(phase, life.turns, journalEvents);

    await run.stop('human_semantic_body_live_complete');
    await run.finished;
    const reportFile = path.join(fixture.evidenceRoot, 'human-semantic-body-live.json');
    const report = {
      protocol: PROTOCOL,
      repositoryRevision: gitRevision(),
      runId: fixture.runId,
      worldId: fixture.worldId,
      managedRunId: run.runId,
      providerSpend: false,
      bodyProfile: PROFILE,
      policyTreatment: {
        profile: POLICY_PROFILE,
        claim:
          'selected only for its three-line proposal prompt and disabled behavioral loop rules; not evidence of scientific neutrality',
      },
      fixtureInterventions: [
        'deterministic flat-world generation',
        'PVP enabled for an observable single-swing consequence',
        'all-ready file release after both managed controllers reported readiness',
        'operator-only pathfinder prepositioning and exact lookAt setup, never included in the mind action surface',
        'one deliberate view rotation between admission and execution for stale-target rejection',
        'one controller cancellation after movement controls became active',
      ],
      phaseFile,
      phaseSha256: sha256File(phaseFile),
      targetFile,
      targetSha256: sha256File(targetFile),
      sourceJournal: journals[0],
      sourceJournalSha256: sha256File(journals[0]),
      lifeRange: range,
      lifeTurnCount: life.turns.length,
      requests: phase.requests.map((artifact: any) => ({
        requestSha256: artifact.requestSha256,
        bodyProfile: artifact.request.bodyProfile,
        actions: artifact.request.actions.map((action: any) => action.name),
      })),
      checks: phase.checks,
      useSemantics: {
        staleAttempt: phase.checks.staleUse,
        verifiedAttempt: phase.checks.use,
      },
      attackSemantics: phase.checks.attack,
      completedAt: new Date().toISOString(),
    };
    durableWriteJson(reportFile, report);
    process.stdout.write(
      `[human-semantic-body-live] PASS ${reportFile}\n[human-semantic-body-live] sha256 ${sha256File(reportFile)}\n`,
    );
  } catch (error) {
    if (run) await run.stop('human_semantic_body_live_failed').catch(() => {});
    throw error;
  } finally {
    restoreEnvironment('OPENROUTER_API_KEY', priorApiKey);
  }
}

async function runResident() {
  const args = parseManagedResidentArgs();
  const entityId = String(args.positionals[0] || '');
  const role = requiredEnvironment('BEHOLD_HUMAN_SEMANTIC_ROLE');
  if (entityId !== (role === 'source' ? ENTITY_ID : TARGET_ID)) {
    throw new Error(`human-semantic role ${role} does not match ${entityId}`);
  }
  if (args.values.server) process.env.SERVER_HOST = String(args.values.server);
  if (args.values.port) process.env.SERVER_PORT = String(args.values.port);
  if (args.values.world) process.env.BEHOLD_WORLD_ID = String(args.values.world);
  process.env.MINECRAFT_USERNAME = String(args.values.body || entityId);
  process.env.MINECRAFT_AUTH = 'offline';
  process.env.VIEWER_ENABLED = '0';
  if (role === 'target') await runTarget(entityId);
  else await runSource(entityId);
}

async function runTarget(entityId: string) {
  const cfg = getConfig();
  const loom = await openEntityLoom(entityId, undefined, cfg.circle.id);
  const journal = createRunJournal(entityId);
  let bot: ReturnType<typeof createBot> | null = null;
  const targetFile = requiredEnvironment('BEHOLD_HUMAN_SEMANTIC_TARGET');
  const state: any = {
    protocol: TARGET_PROTOCOL,
    entityId,
    bodyProfile: PROFILE,
    chat: [],
    healthEvents: [],
  };
  const writeState = () => {
    state.position = currentPosition(bot);
    state.health = Number((bot as any)?.health);
    state.controls = currentControls(bot);
    state.updatedAt = new Date().toISOString();
    durableWriteJson(targetFile, state);
  };
  try {
    bot = createBot(cfg, loom.connectionCapability);
    (bot as any).on('chat', (username: string, message: string) => {
      state.chat.push({ username, message, at: Date.now() });
      writeState();
    });
    (bot as any).on('health', () => {
      state.healthEvents.push({ health: Number((bot as any).health), at: Date.now() });
      writeState();
    });
    await waitForLocalWorld(bot, 45_000, 'human-semantic target local world');
    await (bot as any).pathfinder.goto(
      new (goals as any).GoalBlock(TARGET_FEET.x, TARGET_FEET.y, TARGET_FEET.z),
    );
    await waitFor(
      () => positionDistance((bot as any).entity?.position, TARGET_FEET) <= 1.1,
      15_000,
      'human-semantic target fixture position',
    );
    state.fixtureIntervention = {
      kind: 'operator_pathfinder_preposition',
      destination: TARGET_FEET,
    };
    journal.append('run_started', runIdentity(entityId, cfg.circle.id, journal.file));
    journal.append('operator_intervention', state.fixtureIntervention);
    writeState();
    process.stdout.write('[bot] Local world loaded.\n');
    await waitFor(
      () => fs.existsSync(requiredEnvironment('BEHOLD_HUMAN_SEMANTIC_RELEASE')),
      30_000,
      'human-semantic all-ready release',
    );
    journal.append(
      'operator_intervention',
      readJson(requiredEnvironment('BEHOLD_HUMAN_SEMANTIC_RELEASE')),
    );
    await waitForManagerStop(bot, 'human-semantic target');
    writeState();
    await disconnectMinecraftBot(bot);
    bot = null;
    await loom.close();
  } catch (error) {
    if (bot) await disconnectMinecraftBot(bot).catch(() => {});
    await loom.close().catch(() => {});
    throw error;
  }
}

async function runSource(entityId: string) {
  const cfg = getConfig();
  const loom = await openEntityLoom(entityId, undefined, cfg.circle.id);
  const journal = createRunJournal(entityId);
  let bot: ReturnType<typeof createBot> | null = null;
  let experience: InhabitantExperience | null = null;
  let engine: ReturnType<typeof createEngine> | null = null;
  let policy: ReturnType<typeof startLLMPolicy> | null = null;
  const phaseFile = requiredEnvironment('BEHOLD_HUMAN_SEMANTIC_PHASE');
  const targetFile = requiredEnvironment('BEHOLD_HUMAN_SEMANTIC_TARGET');
  const requests: ResidentMindRequestArtifact[] = [];
  const turns: EntityTurn[] = [];
  const engineEvents: EngineEvent[] = [];
  const interventions: any[] = [];
  const actionAdmissions = new Map<string, any>();
  let nextChoice: ScriptedChoice | null = null;
  let cancellationPhase = false;
  try {
    bot = createBot(cfg, loom.connectionCapability);
    experience = new InhabitantExperience(bot as any, {
      entityId,
      circleId: cfg.circle.id,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      eventHistory: 200,
    });
    const interpreter = buildInterpreter(bot as any, {
      observe: () => experience!.observe(),
      safetyProfile: SAFETY_PROFILE,
      changeConfirmationTimeoutMs: 5_000,
      changeStabilityWindowMs: 150,
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
    const mind: ResidentMind = {
      id: 'human-semantic-live-script-mind',
      decide: async (request) => {
        const choice = nextChoice;
        nextChoice = null;
        if (!choice) throw new Error('script mind received an unplanned request');
        const artifact = createResidentMindRequestArtifact(request);
        assertHumanMindRequest(artifact);
        requests.push(artifact);
        journal.append('mind_request', artifact);
        await choice.beforeReturn?.();
        return {
          protocol: 'behold.mind-decision.v1',
          disposition: 'act',
          utterance: choice.utterance,
          action: { name: choice.name, input: choice.input },
          call: scriptedCallEvidence(request, artifact.requestSha256),
        };
      },
    };
    engine = createEngine(
      {
        authorize: async (name, _input, intent) => ({
          ok: true,
          authority: 'human-semantic-live-script',
          evidence: { entityId, intentId: intent.id, tool: name },
        }),
        run: (name, input, intent, execution) => {
          const observation = actionAdmissions.get(String(intent?.id || ''));
          actionAdmissions.delete(String(intent?.id || ''));
          return interpreter.run(name, input, { ...execution, observation });
        },
        list: () => interpreter.list('inhabitant'),
      },
      {
        tickMs: 20,
        onEvent: (event) => {
          engineEvents.push(event);
          experience!.recordEngineEvent(event);
          journal.append(event.type, event.data, { engineAt: event.at });
          if (event.type === 'action_started' && cancellationPhase) {
            cancellationPhase = false;
            setTimeout(
              () =>
                engine?.requestModelActionCancellation('live_validation_cancellation', {
                  protocol: 'behold.operator-intervention.v1',
                  kind: 'cancellation_validation',
                }),
              150,
            );
          }
          return policy?.onEngineEvent(event);
        },
      },
    );
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
        apiKey: 'unused',
        model: MODEL,
        mind,
        tickMs: 60_000,
        maxTurnSteps: 1,
        resumeAfterBudget: false,
        policyProfile: POLICY_PROFILE,
        bodyProfile: PROFILE,
        actionProfile: PROFILE,
        safetyProfile: SAFETY_PROFILE,
        history: await loom.readAll(),
        acceptEngineEvent: engine.acceptsEvent,
        onEntityTurn: async (turn) => {
          await loom.append(turn);
          turns.push(turn);
          journal.append('entity_turn', {
            id: turn.id,
            sequence: turn.sequence,
            profiles: turn.profiles,
            action: turn.action,
            outcome: turn.outcome,
          });
        },
      },
    );
    engine.start();
    await waitForLocalWorld(bot, 45_000, 'human-semantic source local world');
    journal.append('run_started', runIdentity(entityId, cfg.circle.id, journal.file));
    process.stdout.write('[bot] Local world loaded.\n');
    await waitFor(
      () => fs.existsSync(requiredEnvironment('BEHOLD_HUMAN_SEMANTIC_RELEASE')),
      30_000,
      'human-semantic all-ready release',
    );
    const release = readJson(requiredEnvironment('BEHOLD_HUMAN_SEMANTIC_RELEASE'));
    journal.append('operator_intervention', release);
    await waitFor(
      () => fs.existsSync(targetFile) && readJson(targetFile).entityId === TARGET_ID,
      20_000,
      'human-semantic target body readiness',
    );
    await waitFor(
      () => inventoryCount(experience!.observe(), 'apple') >= 1,
      15_000,
      'human-semantic source apple pickup',
    );

    const runChoice = async (choice: ScriptedChoice) => {
      const prior = turns.length;
      nextChoice = choice;
      await policy!.tick();
      await waitFor(
        () => turns.length === prior + 1 && policy!.state().pendingIntentId == null,
        20_000,
        `human-semantic ${choice.name} terminal turn`,
      );
      return turns.at(-1)!;
    };
    const recordIntervention = (value: any) => {
      const intervention = {
        protocol: 'behold.operator-intervention.v1',
        at: new Date().toISOString(),
        ...value,
      };
      interventions.push(intervention);
      journal.append('operator_intervention', intervention);
      return intervention;
    };

    const movementBefore = currentPosition(bot);
    const movement = await runChoice({
      name: 'move_controls',
      input: { direction: 'forward', durationMs: 350 },
      utterance: 'I hold forward briefly.',
    });
    const movementAfter = currentPosition(bot);

    const yawBefore = Number((bot as any).entity?.yaw);
    const look = await runChoice({
      name: 'look_direction',
      input: { horizontal: 'left', vertical: 'level' },
      utterance: 'I glance left and level.',
    });
    const yawAfter = Number((bot as any).entity?.yaw);

    const chat = await runChoice({
      name: 'chat',
      input: { text: CHAT_TEXT },
      utterance: 'I send one public message.',
    });
    await waitFor(
      () =>
        readJson(targetFile).chat.some(
          (entry: any) => entry.username === ENTITY_ID && entry.message === CHAT_TEXT,
        ),
      10_000,
      'target chat reception',
    );

    const equip = await runChoice({
      name: 'equip_item',
      input: { name: 'apple', destination: 'hand' },
      utterance: 'I hold the apple visible in inventory.',
    });
    const heldAfterEquip = String((bot as any).heldItem?.name || '');

    await fixturePosition(bot, START, recordIntervention, 'use_setup_position');
    await fixtureLookAt(
      bot,
      new Vec3(USE_TARGET.x + 0.5, USE_TARGET.y + 0.35, USE_TARGET.z + 0.5),
      recordIntervention,
      'use_setup_focus',
    );
    await waitForFocus(experience, 'block', 'oak_trapdoor');
    const staleBefore = blockState(bot, USE_TARGET);
    const staleUse = await runChoice({
      name: 'use_focused_block',
      input: {},
      utterance: 'I use the block under my crosshair.',
      beforeReturn: async () => {
        recordIntervention({ kind: 'stale_target_validation_view_change' });
        await (bot as any).look(
          Number((bot as any).entity.yaw) + Math.PI,
          Number((bot as any).entity.pitch),
          true,
        );
      },
    });
    const staleAfter = blockState(bot, USE_TARGET);

    await fixtureLookAt(
      bot,
      new Vec3(USE_TARGET.x + 0.5, USE_TARGET.y + 0.35, USE_TARGET.z + 0.5),
      recordIntervention,
      'verified_use_focus',
    );
    await waitForFocus(experience, 'block', 'oak_trapdoor');
    const useBefore = blockState(bot, USE_TARGET);
    const use = await runChoice({
      name: 'use_focused_block',
      input: {},
      utterance: 'I use the focused trapdoor once.',
    });
    const useAfter = blockState(bot, USE_TARGET);

    await fixturePosition(bot, START, recordIntervention, 'attack_setup_position');
    await fixtureLookAt(
      bot,
      new Vec3(TARGET_FEET.x + 0.5, TARGET_FEET.y + 1.6, TARGET_FEET.z + 0.5),
      recordIntervention,
      'attack_setup_focus',
    );
    await waitForFocus(experience, 'entity', TARGET_ID);
    const targetHealthBefore = Number(readJson(targetFile).health);
    const attack = await runChoice({
      name: 'attack_focused_entity',
      input: {},
      utterance: 'I swing once at the player under my crosshair.',
    });
    await waitFor(
      () =>
        readJson(targetFile).healthEvents.some(
          (event: any) => Number(event.health) < targetHealthBefore,
        ),
      10_000,
      'target health consequence from single attack',
    );
    const targetAfterAttack = readJson(targetFile);

    cancellationPhase = true;
    const cancelStart = currentPosition(bot);
    const cancelledMove = await runChoice({
      name: 'move_controls',
      input: { direction: 'left', sprint: true, durationMs: 2000 },
      utterance: 'I hold left until the controller interruption.',
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const cancelSettled = currentPosition(bot);
    const controlsAfterCancellation = currentControls(bot);

    const phase = {
      protocol: PHASE_PROTOCOL,
      repositoryRevision: gitRevision(),
      entityId,
      model: MODEL,
      profiles: {
        policy: POLICY_PROFILE,
        body: PROFILE,
        actions: PROFILE,
        safety: SAFETY_PROFILE,
      },
      providerSpend: false,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      requests,
      turns,
      engineEvents,
      interventions,
      checks: {
        movement: {
          outcome: movement.outcome,
          before: movementBefore,
          after: movementAfter,
          displacement: positionDistance(movementBefore, movementAfter),
        },
        look: {
          outcome: look.outcome,
          yawBefore,
          yawAfter,
          delta: angleDelta(yawBefore, yawAfter),
        },
        chat: { outcome: chat.outcome, observedByTarget: true },
        inventory: { outcome: equip.outcome, heldAfterEquip },
        staleUse: {
          outcome: staleUse.outcome,
          before: staleBefore,
          after: staleAfter,
          mutated: staleBefore.stateId !== staleAfter.stateId,
        },
        use: {
          outcome: use.outcome,
          before: useBefore,
          after: useAfter,
          mutated: useBefore.stateId !== useAfter.stateId,
        },
        attack: {
          outcome: attack.outcome,
          targetHealthBefore,
          targetHealthAfter: Number(targetAfterAttack.health),
          healthEvents: targetAfterAttack.healthEvents,
          caveat:
            'The action contract claims one dispatched swing, not guaranteed damage; this PVP-enabled fixture separately observed a target health event.',
        },
        cancellation: {
          outcome: cancelledMove.outcome,
          startedAt: cancelStart,
          settledAt: cancelSettled,
          controlsAfterCancellation,
        },
      },
      completedAt: new Date().toISOString(),
    };
    assessPhase(phase);
    durableWriteJson(phaseFile, phase);
    process.stdout.write(`[human-semantic-body-live] phase complete: ${phaseFile}\n`);
    await waitForManagerStop(bot, 'human-semantic source');
    await policy.stop();
    const drain = await engine.shutdown('managed_stdin_closed');
    if (!drain.drained) throw new Error('human-semantic live engine did not drain');
    experience.destroy();
    experience = null;
    await disconnectMinecraftBot(bot);
    bot = null;
    await loom.close();
  } catch (error) {
    try {
      await policy?.stop();
      if (engine) await engine.shutdown('human_semantic_body_live_failed');
    } catch {}
    experience?.destroy();
    if (bot) await disconnectMinecraftBot(bot).catch(() => {});
    await loom.close().catch(() => {});
    throw error;
  }
}

function runIdentity(entityId: string, circleId: string, journalFile: string) {
  return {
    runId: process.env.BEHOLD_RUN_ID || null,
    entityId,
    circleId,
    journalFile,
    body: { substrate: 'minecraft', username: entityId },
    model: MODEL,
    controller: {
      kind: 'scripted-live-validation',
      policyProfile: POLICY_PROFILE,
      bodyProfile: PROFILE,
      actionProfile: PROFILE,
      safetyProfile: SAFETY_PROFILE,
    },
  };
}

function scriptedCallEvidence(request: ResidentMindRequest, requestSha256: string) {
  const startedAt = Date.now();
  const body = JSON.stringify(request);
  const completedAt = Date.now();
  return {
    protocol: 'behold.model-call.v1' as const,
    requestId: `human-semantic-live-${startedAt}-${requestSha256.slice(0, 8)}`,
    endpoint: 'script://human-semantic-body-live',
    startedAt,
    completedAt,
    latencyMs: completedAt - startedAt,
    adapter: { name: 'human-semantic-live-script-mind', version: '1' },
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
      provider: 'deterministic-live-validation',
      finishReason: 'act',
      nativeFinishReason: null,
      usage: null,
    },
  };
}

function assertHumanMindRequest(artifact: ResidentMindRequestArtifact) {
  const request = artifact.request;
  const observation = request.observation as any;
  if (
    request.bodyProfile !== PROFILE ||
    request.actionProfile !== PROFILE ||
    observation?.protocol !== 'behold.minecraft-human-semantic-observation.v1' ||
    observation?.bodyContract?.profile !== PROFILE
  ) {
    throw new Error('mind request did not carry the human-semantic body identity');
  }
  if (request.requiredAction !== null) {
    throw new Error(`live body request unexpectedly required ${request.requiredAction}`);
  }
  const actionNames = request.actions.map((action) => action.name);
  for (const name of actionNames) {
    if (FORBIDDEN_ACTIONS.has(name))
      throw new Error(`mind request leaked forbidden action ${name}`);
  }
  inspectForbiddenKeys(request.observation, '$.observation');
  inspectForbiddenKeys(request.conversation, '$.conversation');
  const serialized = JSON.stringify({
    observation: request.observation,
    conversation: request.conversation,
  });
  for (const token of [
    'behold-owned-flat-v1',
    'pickupGround',
    'suggestedFeetPositions',
    'inspect_reachable_space',
    'manage_project',
  ]) {
    if (serialized.includes(token)) throw new Error(`mind request leaked ${token}`);
  }
  if (/block:(?:overworld|the_nether|the_end):-?\d+:/i.test(serialized)) {
    throw new Error('mind request leaked a stable coordinate-bearing block id');
  }
}

function inspectForbiddenKeys(value: any, location: string) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectForbiddenKeys(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (REQUEST_FORBIDDEN_KEYS.has(key)) {
      throw new Error(`mind request leaked ${key} at ${location}`);
    }
    inspectForbiddenKeys(item, `${location}.${key}`);
  }
}

function assessPhase(phase: any) {
  if (phase?.protocol !== PHASE_PROTOCOL) throw new Error('wrong live phase protocol');
  if (!Array.isArray(phase.requests) || phase.requests.length !== 8) {
    throw new Error(`expected 8 exact mind requests, found ${phase?.requests?.length ?? 0}`);
  }
  phase.requests.forEach((artifact: any) => assertHumanMindRequest(artifact));
  if (!Array.isArray(phase.turns) || phase.turns.length !== 8) {
    throw new Error(`expected 8 Lync turns, found ${phase?.turns?.length ?? 0}`);
  }
  for (const turn of phase.turns) {
    if (
      turn.profiles?.body !== PROFILE ||
      turn.profiles?.actions !== PROFILE ||
      turn.profiles?.policy !== POLICY_PROFILE ||
      turn.profiles?.safety !== SAFETY_PROFILE
    ) {
      throw new Error(`turn ${turn.id} lost body/profile identity`);
    }
  }
  const checks = phase.checks;
  if (checks.movement.outcome.ok !== true || Number(checks.movement.displacement) <= 0.05) {
    throw new Error('bounded movement did not move the real body');
  }
  if (checks.look.outcome.ok !== true || Number(checks.look.delta) < 1) {
    throw new Error('semantic look did not rotate the real view');
  }
  if (checks.chat.outcome.ok !== true || checks.chat.observedByTarget !== true) {
    throw new Error('chat was not observed by the target body');
  }
  if (checks.inventory.outcome.ok !== true || checks.inventory.heldAfterEquip !== 'apple') {
    throw new Error('inventory equip was not reflected by Mineflayer state');
  }
  if (
    checks.staleUse.outcome.ok !== false ||
    checks.staleUse.outcome.error !== 'focused_block_changed_before_action' ||
    checks.staleUse.mutated !== false
  ) {
    throw new Error('stale focused use did not fail closed without mutation');
  }
  if (
    checks.use.outcome.ok !== true ||
    checks.use.outcome.result?.verified !== true ||
    checks.use.mutated !== true
  ) {
    throw new Error('focused use did not produce a verified real block transition');
  }
  if (
    checks.attack.outcome.ok !== true ||
    checks.attack.outcome.result?.status !== 'attack_input_dispatched' ||
    !checks.attack.healthEvents.some(
      (event: any) => Number(event.health) < Number(checks.attack.targetHealthBefore),
    )
  ) {
    throw new Error('single focused attack had no observed target health consequence');
  }
  if (
    checks.cancellation.outcome.ok !== false ||
    checks.cancellation.outcome.error !== 'interrupted_by_human' ||
    checks.cancellation.outcome.cancellation?.acknowledged !== true ||
    Object.values(checks.cancellation.controlsAfterCancellation).some(Boolean)
  ) {
    throw new Error('cancelled bounded movement did not acknowledge and clear every control');
  }
}

function assessPersistedEvidence(phase: any, turns: readonly EntityTurn[], journalEvents: any[]) {
  if (JSON.stringify(turns) !== JSON.stringify(phase.turns)) {
    throw new Error('persisted Lync turns differ from live phase turns');
  }
  const runStarted = journalEvents.find((event) => event.type === 'run_started');
  if (
    runStarted?.data?.controller?.bodyProfile !== PROFILE ||
    runStarted?.data?.controller?.actionProfile !== PROFILE
  ) {
    throw new Error('run journal lost human-semantic body identity');
  }
  const journalRequests = journalEvents.filter((event) => event.type === 'mind_request');
  if (journalRequests.length !== phase.requests.length) {
    throw new Error('run journal did not retain every exact mind request');
  }
  journalRequests.forEach((event) => assertHumanMindRequest(event.data));
}

async function fixturePosition(
  bot: ReturnType<typeof createBot>,
  destination: Readonly<{ x: number; y: number; z: number }>,
  record: (value: any) => unknown,
  purpose: string,
) {
  record({ kind: 'operator_pathfinder_preposition', purpose, destination });
  await (bot as any).pathfinder.goto(
    new (goals as any).GoalBlock(destination.x, destination.y, destination.z),
  );
  await waitFor(
    () => positionDistance((bot as any).entity?.position, destination) <= 1.1,
    15_000,
    purpose,
  );
}

async function fixtureLookAt(
  bot: ReturnType<typeof createBot>,
  target: Vec3,
  record: (value: any) => unknown,
  purpose: string,
) {
  record({ kind: 'operator_exact_view_setup', purpose, target });
  await (bot as any).lookAt(target, true);
}

async function waitForFocus(
  experience: InhabitantExperience,
  kind: 'block' | 'entity',
  name: string,
) {
  await waitFor(
    () => {
      const focus = experience.observe()?.scene?.focus;
      return (
        focus?.kind === kind && String(focus?.name || '') === name && focus?.reachable === true
      );
    },
    10_000,
    `reachable ${kind} focus ${name}`,
  );
}

function blockState(
  bot: ReturnType<typeof createBot>,
  position: Readonly<{ x: number; y: number; z: number }>,
) {
  const block: any = (bot as any).blockAt(new Vec3(position.x, position.y, position.z));
  return {
    name: String(block?.name || ''),
    stateId: Number(block?.stateId),
    properties: block?.getProperties?.() || {},
  };
}

function currentPosition(bot: ReturnType<typeof createBot> | null) {
  const position = (bot as any)?.entity?.position;
  return position ? { x: Number(position.x), y: Number(position.y), z: Number(position.z) } : null;
}

function currentControls(bot: ReturnType<typeof createBot> | null) {
  const state = ((bot as any)?.controlState || {}) as Record<string, unknown>;
  return Object.fromEntries(
    ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map((name) => [
      name,
      state[name] === true,
    ]),
  );
}

function inventoryCount(observation: any, name: string) {
  return (Array.isArray(observation?.self?.inventory) ? observation.self.inventory : [])
    .filter((item: any) => String(item?.name) === name)
    .reduce((sum: number, item: any) => sum + Math.max(0, Number(item?.count) || 0), 0);
}

function angleDelta(before: number, after: number) {
  const raw = Math.abs(after - before) % (Math.PI * 2);
  return Math.min(raw, Math.PI * 2 - raw);
}

function readJsonLines(file: string) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function sha256Text(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

if (process.argv.slice(2).includes('--server')) {
  void runResident().catch((error) => {
    process.stderr.write(
      `[human-semantic-body-live:resident] ${error instanceof Error ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
} else {
  void runProof().catch((error) => {
    process.stderr.write(
      `[human-semantic-body-live] ${error instanceof Error ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
}
