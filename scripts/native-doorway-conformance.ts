#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Vec3 } from 'vec3';
import { createBot } from '../src/bot';
import { getConfig } from '../src/config';
import { InhabitantExperience } from '../src/agent/experience';
import { buildInterpreter } from '../src/agent/interpreter';
import { openEntityLoom } from '../src/entity/loom';
import { createPlaceMemory } from '../src/entity/places';
import { createEngine, type EngineEvent } from '../src/loop/engine';
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
} from './owned-world-fixture';
import { observeFromFreshMinecraftBody } from './owned-world-model-harness';
import {
  assessNativeDoorwayConformance,
  NATIVE_DOORWAY_CONFORMANCE_PROTOCOL,
  NATIVE_DOORWAY_PHASE_PROTOCOL,
} from './native-doorway-conformance-evidence';
import { executeScriptedInhabitantTurn } from './scripted-inhabitant-turn';
import { startManagedWorld } from './world-runner';
import { parseManagedResidentArgs } from './managed-resident-cli';
import { statusWorld } from './world-lab';
import {
  disconnectMinecraftBot,
  requiredEnvironment,
  waitForLocalWorld,
  waitForManagerStop,
} from './native-conformance-harness';

const ENTITY_ID = 'DoorResident';
const WITNESS_ID = 'DoorWitness';
const MODEL = 'script/native-doorway-conformance-v1';
const LOWER = Object.freeze({ x: 0, y: -60, z: 1 });
const ORIGIN_SIDE = Object.freeze({ x: 0, y: -60, z: 0 });
const FIXTURE_ITEM = Object.freeze({ x: -3, y: -60, z: 0, item: 'apple', count: 1 });
const FIXTURE_BLOCKS = Object.freeze([
  {
    ...LOWER,
    block: 'oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]',
  },
  {
    x: LOWER.x,
    y: LOWER.y + 1,
    z: LOWER.z,
    block: 'oak_door[facing=north,half=upper,hinge=left,open=false,powered=false]',
  },
  ...[-1, 1].flatMap((dx) =>
    [0, 1].map((dy) => ({
      x: LOWER.x + dx,
      y: LOWER.y + dy,
      z: LOWER.z,
      block: 'stone',
    })),
  ),
]);

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
      'Usage: native-doorway-conformance [--run <safe-id>] [--port <unused-loopback-port>]\n',
    );
    return;
  }
  const runId = String(
    parsed.values.run || `door-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const fixture = await prepareOwnedWorld(
    runId,
    Number(parsed.values.port || 25580),
    'native-doorway',
    FIXTURE_ITEM,
    [],
    FIXTURE_BLOCKS,
  );
  const reportFile = path.join(fixture.evidenceRoot, 'native-doorway-conformance.json');
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
        controllerEntry: path.resolve('dist/scripts/native-doorway-conformance.js'),
        entityRoot: fixture.entityRoot,
        runRoot: path.join(fixture.evidenceRoot, 'runs'),
        residents: [
          {
            entityId: ENTITY_ID,
            model: MODEL,
            task: 'native-doorway-conformance',
            allowTools: ['cross_visible_door', 'cross_place_door'],
          },
        ],
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
      'native-doorway-conformance-phase.json',
    );
    await Promise.race([
      waitFor(() => fs.existsSync(phaseFile), 60_000, 'native doorway phase evidence'),
      run.finished.then(() => {
        throw new Error('managed world ended before native doorway phase evidence');
      }),
    ]);
    const phase = readJson(phaseFile);
    const independentWitness = await observeFromFreshMinecraftBody({
      run,
      worldId: fixture.worldId,
      entityRoot: fixture.entityRoot,
      controlRoot: fixture.controlRoot,
      port: fixture.port,
      model: MODEL,
      witnessId: WITNESS_ID,
      settleMs: 1000,
      observe: async (bot) => {
        let resident: any = null;
        let door: any = null;
        await waitFor(
          () => {
            resident = Object.values((bot as any).entities || {}).find(
              (entity: any) => entity?.username === ENTITY_ID && entity?.position,
            );
            door = (bot as any).blockAt?.(new Vec3(LOWER.x, LOWER.y, LOWER.z));
            return !!resident && String(door?.name || '') === 'oak_door';
          },
          15_000,
          'fresh doorway witness',
        );
        return {
          resident: {
            username: resident.username,
            position: positionRecord(resident.position),
          },
          door: {
            name: String(door.name),
            position: positionRecord(door.position),
            open: door.getProperties?.().open ?? null,
            half: door.getProperties?.().half ?? null,
            facing: door.getProperties?.().facing ?? null,
          },
        };
      },
    });
    await run.stop('native_doorway_conformance_complete');
    await run.finished;
    const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
    const runtime = await statusWorld(fixture.worldId, fixture.world);
    const control = inspectWorldControl(fixture.controlRoot, fixture.worldId);
    const leases = inspectEntityLeaseFence(fixture.entityRoot, [fixture.worldId]);
    const loomFiles = listFiles(path.join(fixture.entityRoot, ENTITY_ID, 'lync')).filter((file) =>
      file.endsWith('.lync'),
    );
    if (loomFiles.length !== 1) {
      throw new Error(`expected one door-resident Lync, found ${loomFiles.length}`);
    }
    const draft = {
      protocol: NATIVE_DOORWAY_CONFORMANCE_PROTOCOL,
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
    const assessment = assessNativeDoorwayConformance(draft);
    durableWriteJson(reportFile, { ...draft, assessment });
    if (!assessment.pass) {
      throw new Error(
        `native doorway conformance failed: ${Object.entries(assessment.assertions)
          .filter(([, value]) => !value)
          .map(([name]) => name)
          .join(', ')}`,
      );
    }
    process.stdout.write(
      `[native-doorway] PASS ${reportFile}\n[native-doorway] sha256 ${sha256File(reportFile)}\n`,
    );
  } catch (error) {
    if (run) await run.stop('native_doorway_conformance_failed').catch(() => {});
    throw error;
  }
}

async function runResident() {
  const args = parseManagedResidentArgs();
  const entityId = args.positionals[0];
  if (entityId !== ENTITY_ID) throw new Error(`native doorway proof expected ${ENTITY_ID}`);
  if (args.values.server) process.env.SERVER_HOST = String(args.values.server);
  if (args.values.port) process.env.SERVER_PORT = String(args.values.port);
  if (args.values.world) process.env.BEHOLD_WORLD_ID = String(args.values.world);
  process.env.MINECRAFT_USERNAME = entityId;
  process.env.MINECRAFT_AUTH = 'offline';
  process.env.VIEWER_ENABLED = '0';

  const phaseFile = path.join(
    path.resolve(requiredEnvironment('BEHOLD_RUN_DIR')),
    'native-doorway-conformance-phase.json',
  );
  const cfg = getConfig();
  const loom = await openEntityLoom(entityId, undefined, cfg.circle.id);
  const priorTurns = loom.turns().length;
  let memory = createPlaceMemory(entityId, loom.turns());
  let bot: ReturnType<typeof createBot> | null = null;
  let experience: InhabitantExperience | null = null;
  let engine: ReturnType<typeof createEngine> | null = null;
  try {
    bot = createBot(cfg, loom.connectionCapability);
    experience = new InhabitantExperience(bot as any, {
      circleId: cfg.circle.id,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      places: () => memory.snapshot(),
      eventHistory: 40,
    });
    const interpreter = buildInterpreter(bot as any, {
      observe: () => experience!.observe(),
      places: () => memory.snapshot(),
      changeConfirmationTimeoutMs: 10_000,
      changeStabilityWindowMs: 150,
    });
    const events: EngineEvent[] = [];
    engine = createEngine(
      {
        authorize: async (name, _input, intent) => ({
          ok: true,
          authority: 'native-doorway-conformance',
          evidence: { entityId, intentId: intent.id, tool: name },
        }),
        run: (name, input, _intent, execution) => interpreter.run(name, input, execution),
        list: () => interpreter.list('inhabitant'),
      },
      {
        allowTools: ['cross_visible_door', 'cross_place_door'],
        onEvent: (event) => {
          events.push(event);
          experience!.recordEngineEvent(event);
        },
      },
    );
    await waitForLocalWorld(bot, 45_000, 'native doorway local world');
    if (priorTurns !== 0)
      throw new Error(`doorway proof expected no prior turns, found ${priorTurns}`);
    (bot as any).pathfinder.stop();
    (bot as any).clearControlStates?.();
    await (bot as any).waitForTicks(60);
    await waitFor(
      () => sameFeetCell((bot as any).entity?.position, ORIGIN_SIDE),
      10_000,
      'resident natural spawn at doorway side',
    );
    await (bot as any).lookAt(new Vec3(LOWER.x + 0.5, LOWER.y + 0.8, LOWER.z + 0.5), false);
    await waitFor(
      () => {
        const focus = experience!.observe().scene.focus;
        return (
          focus?.name === 'oak_door' &&
          focus?.source === 'cursor' &&
          focus?.reachable === true &&
          focus?.position?.x === LOWER.x &&
          focus?.position?.z === LOWER.z
        );
      },
      10_000,
      'resident first-person door focus',
    );
    const initialObservation = experience.observe();
    const firstCrossing = await executeScriptedInhabitantTurn({
      entityId,
      loom,
      experience,
      engine,
      events,
      name: 'cross_visible_door',
      input: {
        focus: initialObservation.scene.focus!.id,
        closeAfter: true,
        rememberAs: { label: 'Proof doorway', purpose: 'A route I crossed' },
      },
      model: MODEL,
      onEntityTurn: (turn) => memory.record(turn),
    });
    const memoryAfterFirst = memory.snapshot();
    memory = createPlaceMemory(entityId, loom.turns());
    const memoryAfterRestart = memory.snapshot();
    const remembered = memoryAfterRestart[0];
    if (!remembered) throw new Error('first crossing produced no restart memory');
    const reusedCrossing = await executeScriptedInhabitantTurn({
      entityId,
      loom,
      experience,
      engine,
      events,
      name: 'cross_place_door',
      input: { id: remembered.id, closeAfter: true },
      model: MODEL,
      onEntityTurn: (turn) => memory.record(turn),
    });
    const finalObservation = experience.observe();
    durableWriteJson(phaseFile, {
      protocol: NATIVE_DOORWAY_PHASE_PROTOCOL,
      repositoryRevision: gitRevision(),
      entityId,
      model: MODEL,
      worldId: cfg.circle.id,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      priorTurns,
      resultingTurns: loom.turns().length,
      fixtureSetup: {
        kind: 'natural_spawn_and_first_person_look_before_recorded_action',
        origin: ORIGIN_SIDE,
        door: LOWER,
      },
      initialObservation,
      firstCrossing,
      memoryAfterFirst,
      memoryAfterRestart,
      reusedCrossing,
      finalObservation,
      completedAt: new Date().toISOString(),
    });
    process.stdout.write(`[native-doorway] phase complete: ${phaseFile}\n`);
    await waitForManagerStop(bot, 'native doorway');
    const drain = await engine.shutdown('managed_stdin_closed');
    if (!drain.drained) throw new Error('native doorway engine did not drain');
    experience.destroy();
    experience = null;
    await disconnectMinecraftBot(bot);
    bot = null;
    await loom.close();
  } catch (error) {
    try {
      if (engine) await engine.shutdown('native_doorway_proof_failed');
    } catch {}
    experience?.destroy();
    if (bot) await disconnectMinecraftBot(bot).catch(() => {});
    await loom.close().catch(() => {});
    throw error;
  }
}

function positionRecord(position: any) {
  return position ? { x: Number(position.x), y: Number(position.y), z: Number(position.z) } : null;
}

function sameFeetCell(position: any, expected: { x: number; y: number; z: number }) {
  return (
    Math.floor(Number(position?.x)) === expected.x &&
    Math.floor(Number(position?.y)) === expected.y &&
    Math.floor(Number(position?.z)) === expected.z
  );
}

if (process.argv.slice(2).includes('--server')) {
  void runResident().catch((error) => {
    process.stderr.write(
      `[native-doorway:resident] ${error instanceof Error ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
} else {
  void runProof().catch((error) => {
    process.stderr.write(`[native-doorway] ${error instanceof Error ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}
