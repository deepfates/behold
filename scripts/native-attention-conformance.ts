#!/usr/bin/env node
import 'dotenv/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Vec3 } from 'vec3';
import { createBot } from '../src/bot';
import { getConfig } from '../src/config';
import { minecraftInhabitantActionsFor } from '../src/agent/affordances';
import { InhabitantExperience } from '../src/agent/experience';
import { buildInterpreter } from '../src/agent/interpreter';
import { openEntityLoom, type EntityTurn } from '../src/entity/loom';
import { createEngine, type EngineEvent } from '../src/loop/engine';
import type { ResidentMind, ResidentMindRequest } from '../src/mind/interface';
import { isBodilyUrgencyEvent, isImmediateAttentionEvent, startLLMPolicy } from '../src/policy/llm';
import {
  inspectEntityLeaseFence,
  inspectWorldControl,
  verifyWorldLifecycleJournal,
} from '../src/runtime/world-control';
import {
  durableWriteJson,
  gitRevision,
  listFiles,
  prepareOwnedWorld,
  readJson,
  sha256File,
  waitFor,
  type OwnedWorldBlock,
} from './owned-world-fixture';
import { observeFromFreshMinecraftBody, observedBlocks } from './owned-world-model-harness';
import {
  assessNativeAttentionConformance,
  NATIVE_ATTENTION_CONFORMANCE_PROTOCOL,
  NATIVE_ATTENTION_PHASE_PROTOCOL,
} from './native-attention-conformance-evidence';
import {
  disconnectMinecraftBot,
  requiredEnvironment,
  waitForLocalWorld,
  waitForManagerStop,
} from './native-conformance-harness';
import { startManagedWorld } from './world-runner';
import { statusWorld } from './world-lab';

const ENTITY_ID = 'AttentionBody';
const WITNESS_ID = 'AttentionSeen';
const MODEL = 'script/native-attention-conformance-v1';
const START_FEET = Object.freeze({ x: 1, y: -60, z: 0 });
const START_HEAD = Object.freeze({ x: 1, y: -59, z: 0 });
const DESTINATION_FEET = Object.freeze({ x: 12, y: -60, z: 0 });
const DESTINATION_HEAD = Object.freeze({ x: 12, y: -59, z: 0 });
const DUMMY_ITEM = Object.freeze({ x: 30, y: -60, z: 0, item: 'dirt', count: 1 });
const ALLOW_TOOLS = Object.freeze(['move_to']);

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
      'Usage: native-attention-conformance [--run <safe-id>] [--port <unused-loopback-port>]\n',
    );
    return;
  }
  const runId = String(
    parsed.values.run || `attention-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const fixture = await prepareOwnedWorld(
    runId,
    Number(parsed.values.port || 25577),
    'native-attention',
    DUMMY_ITEM,
    [],
    underwaterCorridorBlocks(),
  );
  const reportFile = path.join(fixture.evidenceRoot, 'native-attention-conformance.json');
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
        controllerEntry: path.resolve('dist/scripts/native-attention-conformance.js'),
        entityRoot: fixture.entityRoot,
        runRoot: path.join(fixture.evidenceRoot, 'runs'),
        residents: [{ entityId: ENTITY_ID, model: MODEL, task: 'native-attention-conformance' }],
        startupTimeoutMs: 90_000,
        shutdownTimeoutMs: 90_000,
      },
      {
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
      },
    );
    const phaseFile = path.join(
      run.residents[0].journalDirectory,
      'native-attention-conformance-phase.json',
    );
    await Promise.race([
      waitFor(() => fs.existsSync(phaseFile), 60_000, 'native attention phase evidence'),
      run.finished.then(() => {
        throw new Error('managed world ended before native attention phase evidence');
      }),
    ]);
    const phase = readJson(phaseFile);
    await run.quiesceResidents('native_attention_before_independent_witness');
    const independentWitness = await observeFromFreshMinecraftBody({
      run,
      worldId: fixture.worldId,
      entityRoot: fixture.entityRoot,
      controlRoot: fixture.controlRoot,
      port: fixture.port,
      model: MODEL,
      witnessId: WITNESS_ID,
      settleMs: 0,
      observe: (bot) => ({
        blocks: observedBlocks(bot, [START_FEET, START_HEAD, DESTINATION_FEET, DESTINATION_HEAD]),
      }),
    });
    await run.stop('native_attention_conformance_complete');
    await run.finished;
    const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
    const runtime = await statusWorld(fixture.worldId, fixture.world);
    const control = inspectWorldControl(fixture.controlRoot, fixture.worldId);
    const leases = inspectEntityLeaseFence(fixture.entityRoot, [fixture.worldId]);
    const loomFiles = listFiles(path.join(fixture.entityRoot, ENTITY_ID, 'lync')).filter((file) =>
      file.endsWith('.lync'),
    );
    if (loomFiles.length !== 1) {
      throw new Error(`expected one attention-resident Lync, found ${loomFiles.length}`);
    }
    const draft = {
      protocol: NATIVE_ATTENTION_CONFORMANCE_PROTOCOL,
      repositoryRevision: gitRevision(),
      runId: fixture.runId,
      worldId: fixture.worldId,
      managedRunId: run.runId,
      phase,
      phaseFile,
      phaseSha256: sha256File(phaseFile),
      independentWitness,
      loomFile: loomFiles[0],
      loomSha256: sha256File(loomFiles[0]),
      serverPropertiesFile: path.join(fixture.serverDirectory, 'server.properties'),
      serverPropertiesSha256: sha256File(path.join(fixture.serverDirectory, 'server.properties')),
      lifecycle: {
        file: run.control.journalFile,
        verified: true,
        eventCount: lifecycle.events.length,
        tipDigest: lifecycle.tipDigest,
      },
      finalOwnership: {
        control: control.state,
        port: runtime.serverPort.state,
        leases: leases.state,
      },
      completedAt: new Date().toISOString(),
    };
    const assessment = assessNativeAttentionConformance(draft);
    durableWriteJson(reportFile, { ...draft, assessment });
    if (!assessment.pass) {
      throw new Error(
        `native attention conformance failed: ${Object.entries(assessment.assertions)
          .filter(([, value]) => !value)
          .map(([name]) => name)
          .join(', ')}`,
      );
    }
    process.stdout.write(
      `[native-attention] PASS ${reportFile}\n[native-attention] sha256 ${sha256File(reportFile)}\n`,
    );
  } catch (error) {
    if (run) await run.stop('native_attention_conformance_failed').catch(() => {});
    throw error;
  }
}

async function runResident() {
  const args = parseArgs({
    args: process.argv.slice(2),
    options: {
      server: { type: 'string' },
      port: { type: 'string' },
      world: { type: 'string' },
      model: { type: 'string' },
      tickMs: { type: 'string' },
      task: { type: 'string' },
      target: { type: 'string' },
      allowTools: { type: 'string' },
    },
    allowPositionals: true,
  });
  const entityId = String(args.positionals[0] || '');
  if (entityId !== ENTITY_ID) throw new Error(`native attention proof expected ${ENTITY_ID}`);
  if (args.values.server) process.env.SERVER_HOST = String(args.values.server);
  if (args.values.port) process.env.SERVER_PORT = String(args.values.port);
  if (args.values.world) process.env.BEHOLD_WORLD_ID = String(args.values.world);
  process.env.MINECRAFT_USERNAME = entityId;
  process.env.MINECRAFT_AUTH = 'offline';
  process.env.VIEWER_ENABLED = '0';

  const phaseFile = path.join(
    path.resolve(requiredEnvironment('BEHOLD_RUN_DIR')),
    'native-attention-conformance-phase.json',
  );
  const cfg = getConfig();
  const loom = await openEntityLoom(entityId, undefined, cfg.circle.id);
  const priorTurns = loom.turns().length;
  let bot: ReturnType<typeof createBot> | null = null;
  let experience: InhabitantExperience | null = null;
  let engine: ReturnType<typeof createEngine> | null = null;
  let policy: ReturnType<typeof startLLMPolicy> | null = null;
  let localWorldReady = false;
  let bodilyUrgency: any = null;
  const engineEvents: EngineEvent[] = [];
  const turns: EntityTurn[] = [];
  let mindRequest: any = null;
  try {
    bot = createBot(cfg, loom.connectionCapability);
    experience = new InhabitantExperience(bot as any, {
      circleId: cfg.circle.id,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      eventHistory: 100,
      onEvent: (event) => {
        if (!localWorldReady) return;
        if (isBodilyUrgencyEvent(event)) {
          if (!bodilyUrgency) {
            bodilyUrgency = {
              event: JSON.parse(JSON.stringify(event)),
              bodyPosition: currentPosition(bot),
              engineStateBeforeRequest: engine?.state(),
            };
          }
          engine?.requestModelActionCancellation('bodily_urgent_attention', {
            eventSequence: event.sequence,
            eventType: event.type,
            eventSource: event.source,
          });
        }
        if (isImmediateAttentionEvent(event)) policy?.wake();
      },
    });
    const interpreter = buildInterpreter(bot as any, {
      observe: () => experience!.observe(),
      moveLegDistance: 16,
      moveTimeoutMs: 45_000,
    });
    const toolSpecs = interpreter
      .list('inhabitant')
      .filter((spec: any) => ALLOW_TOOLS.includes(spec.name))
      .map((spec: any) => ({
        type: 'function' as const,
        function: {
          name: spec.name,
          description: spec.description || '',
          parameters: spec.parameters || { type: 'object', properties: {} },
        },
      }));
    engine = createEngine(
      {
        authorize: async (name, _input, intent) => ({
          ok: true,
          authority: 'native-attention-conformance',
          evidence: { entityId, intentId: intent.id, tool: name },
        }),
        run: (name, input, _intent, execution) => interpreter.run(name, input, execution),
        list: () => interpreter.list('inhabitant'),
      },
      {
        allowTools: [...ALLOW_TOOLS],
        tickMs: 10,
        onEvent: (event) => {
          engineEvents.push(event);
          experience!.recordEngineEvent(event);
          return policy?.onEngineEvent(event);
        },
      },
    );
    const mind = scriptedAttentionMind((request) => {
      mindRequest = projectMindRequest(request);
    });
    policy = startLLMPolicy(
      {
        entityId,
        observe: (sinceSequence) => experience!.observe(sinceSequence),
        actions: toolSpecs,
        actionsFor: (observation) => minecraftInhabitantActionsFor(toolSpecs, observation),
        attempt: (intent) => engine!.enqueueIntent(intent),
      },
      {
        apiKey: 'unused',
        model: MODEL,
        urgentModel: MODEL,
        mind,
        tickMs: 60_000,
        maxTurnSteps: 1,
        allowTools: [...ALLOW_TOOLS],
        acceptEngineEvent: engine.acceptsEvent,
        history: loom.turns(),
        onEntityTurn: async (turn) => {
          await loom.append(turn);
          turns.push(turn);
          policy?.suspend('native_attention_single_turn_complete');
        },
      },
    );
    engine.start();
    await waitForLocalWorld(bot, 45_000, 'native attention underwater local world');
    const preposition = await enterUnderwaterCorridor(bot);
    await waitFor(
      () => {
        const oxygen = Number(experience!.observe()?.self?.condition?.oxygen);
        return oxygen > 5 && oxygen <= 9;
      },
      20_000,
      'native attention pre-critical oxygen window',
    );
    const setupObservation = experience.observe();
    const setup = corridorSetup(bot, setupObservation, preposition);
    assertUnderwaterSetup(setup);
    experience.markLocalWorldReady();
    localWorldReady = true;
    await policy.tick();
    await waitFor(
      () =>
        turns.length === 1 &&
        bodilyUrgency != null &&
        policy!.state().pendingIntentId == null &&
        engine!.state().inFlightIntent == null,
      30_000,
      'native attention acknowledged terminal',
    );
    await delay(250);
    durableWriteJson(phaseFile, {
      protocol: NATIVE_ATTENTION_PHASE_PROTOCOL,
      repositoryRevision: gitRevision(),
      entityId,
      model: MODEL,
      worldId: cfg.circle.id,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      priorTurns,
      resultingTurns: loom.turns().length,
      destination: DESTINATION_FEET,
      fixtureSetup: setup,
      mindRequest,
      bodilyUrgency,
      engineEvents,
      turns,
      settledBodyPosition: currentPosition(bot),
      policyState: policy.state(),
      engineState: engine.state(),
      finalObservation: experience.observe(),
      completedAt: new Date().toISOString(),
    });
    process.stdout.write(`[native-attention] phase complete: ${phaseFile}\n`);
    await waitForManagerStop(bot, 'native attention');
    await policy.stop();
    const drain = await engine.shutdown('managed_stdin_closed');
    if (!drain.drained) throw new Error('native attention engine did not drain');
    experience.destroy();
    experience = null;
    await disconnectMinecraftBot(bot);
    bot = null;
    await loom.close();
  } catch (error) {
    try {
      await policy?.stop();
      if (engine) await engine.shutdown('native_attention_proof_failed');
    } catch {}
    experience?.destroy();
    if (bot) await disconnectMinecraftBot(bot).catch(() => {});
    await loom.close().catch(() => {});
    throw error;
  }
}

function scriptedAttentionMind(onRequest: (request: ResidentMindRequest) => void): ResidentMind {
  let called = false;
  return {
    id: 'native-attention-script-mind',
    decide: async (request) => {
      if (called) throw new Error('native attention proof mind received a second choice');
      called = true;
      onRequest(request);
      if (!request.actions.some((action) => action.name === 'move_to')) {
        throw new Error('native attention mind was not offered move_to');
      }
      const action = { name: 'move_to', input: DESTINATION_FEET };
      return {
        protocol: 'behold.mind-decision.v1',
        disposition: 'act',
        utterance: 'I swim toward the far end of the visible corridor.',
        action,
        call: mindCallEvidence(request),
      };
    },
  };
}

function mindCallEvidence(request: ResidentMindRequest) {
  const startedAt = Date.now();
  const body = JSON.stringify(request);
  const completedAt = Date.now();
  return {
    protocol: 'behold.model-call.v1' as const,
    requestId: `native-attention-${startedAt}-${sha256Text(body).slice(0, 8)}`,
    endpoint: 'script://native-attention-conformance',
    startedAt,
    completedAt,
    latencyMs: completedAt - startedAt,
    adapter: { name: 'native-attention-script-mind', version: '1' },
    request: {
      model: request.model,
      messageCount: request.conversation.length,
      toolCount: request.actions.length,
      toolChoice: 'required',
      bodySha256: sha256Text(body),
      messagesSha256: sha256Text(JSON.stringify(request.conversation)),
      toolsSha256: sha256Text(JSON.stringify(request.actions)),
      bodyBytes: Buffer.byteLength(body),
      kind: 'mind_input' as const,
    },
    response: {
      id: null,
      model: request.model,
      provider: 'deterministic-conformance',
      finishReason: 'act',
      nativeFinishReason: null,
      usage: null,
    },
  };
}

function projectMindRequest(request: ResidentMindRequest) {
  return JSON.parse(
    JSON.stringify({
      protocol: request.protocol,
      entityId: request.entityId,
      model: request.model,
      observation: request.observation,
      attention: request.attention,
      requiredAction: request.requiredAction,
      actions: request.actions.map((action) => action.name),
    }),
  );
}

function underwaterCorridorBlocks(): OwnedWorldBlock[] {
  const blocks: OwnedWorldBlock[] = [];
  for (let x = -1; x <= 14; x += 1) {
    blocks.push({ x, y: -58, z: 0, block: x === 0 ? 'water' : 'glass' });
    if (x === 0) {
      blocks.push({ x, y: -58, z: -1, block: 'glass' });
      blocks.push({ x, y: -58, z: 1, block: 'glass' });
    }
    for (const y of [-60, -59]) {
      blocks.push({ x, y, z: -1, block: 'glass' });
      blocks.push({ x, y, z: 1, block: 'glass' });
      if (x === -1 || x === 14) blocks.push({ x, y, z: 0, block: 'glass' });
      else blocks.push({ x, y, z: 0, block: 'water' });
    }
  }
  return blocks;
}

async function enterUnderwaterCorridor(bot: ReturnType<typeof createBot>) {
  const before = currentPosition(bot);
  await (bot as any).lookAt(new Vec3(2.5, -59.5, 0.5), true);
  (bot as any).setControlState('sneak', true);
  try {
    await waitFor(
      () => Number((bot as any).entity?.position?.y) <= -59.8,
      10_000,
      'native attention body descent through water entrance',
    );
    (bot as any).setControlState('forward', true);
    await waitFor(
      () => Number((bot as any).entity?.position?.x) >= 1.15,
      10_000,
      'native attention body entry beneath corridor roof',
    );
  } finally {
    (bot as any).setControlState('forward', false);
    (bot as any).setControlState('sneak', false);
  }
  await delay(150);
  return {
    kind: 'evaluator_owned_native_controls_before_recorded_action',
    controls: ['look_at', 'sneak', 'forward'],
    before,
    after: currentPosition(bot),
  };
}

function corridorSetup(
  bot: ReturnType<typeof createBot>,
  observation: any,
  preposition: Record<string, unknown>,
) {
  const blockName = (position: { x: number; y: number; z: number }) =>
    String((bot as any).blockAt?.(new Vec3(position.x, position.y, position.z))?.name || 'unknown');
  return {
    kind: 'underwater_corridor_before_recorded_action',
    preposition,
    startBody: currentPosition(bot),
    startFeet: START_FEET,
    startHead: START_HEAD,
    destination: DESTINATION_FEET,
    destinationFeet: DESTINATION_FEET,
    destinationHead: DESTINATION_HEAD,
    startFeetBlock: blockName(START_FEET),
    startHeadBlock: blockName(START_HEAD),
    destinationFeetBlock: blockName(DESTINATION_FEET),
    destinationHeadBlock: blockName(DESTINATION_HEAD),
    oxygenBeforeAction: observation?.self?.condition?.oxygen ?? null,
  };
}

function assertUnderwaterSetup(setup: any) {
  if (
    ![
      setup.startFeetBlock,
      setup.startHeadBlock,
      setup.destinationFeetBlock,
      setup.destinationHeadBlock,
    ].every((name) => name === 'water') ||
    !(Number(setup.oxygenBeforeAction) > 5 && Number(setup.oxygenBeforeAction) <= 9)
  ) {
    throw new Error(`invalid underwater attention setup: ${JSON.stringify(setup)}`);
  }
}

function currentPosition(bot: ReturnType<typeof createBot> | null) {
  const position = (bot as any)?.entity?.position;
  return position ? { x: Number(position.x), y: Number(position.y), z: Number(position.z) } : null;
}

function sha256Text(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

if (process.argv.slice(2).includes('--server')) {
  void runResident().catch((error) => {
    process.stderr.write(
      `[native-attention:resident] ${error instanceof Error ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
} else {
  void runProof().catch((error) => {
    process.stderr.write(`[native-attention] ${error instanceof Error ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}
