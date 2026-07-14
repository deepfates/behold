#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { createBot } from '../src/bot';
import { getConfig } from '../src/config';
import { InhabitantExperience } from '../src/agent/experience';
import { buildInterpreter } from '../src/agent/interpreter';
import { openEntityLoom } from '../src/entity/loom';
import { createEngine, type EngineEvent } from '../src/loop/engine';
import {
  inspectEntityLeaseFence,
  inspectWorldControl,
  verifyWorldLifecycleJournal,
} from '../src/runtime/world-control';
import {
  assertCleanRepository,
  durableWriteJson,
  gitRevision,
  listFiles,
  prepareOwnedWorld,
  readJson,
  sha256File,
  waitFor,
} from './owned-world-fixture';
import { observeFromFreshMinecraftBody, observedBlocks } from './owned-world-model-harness';
import {
  assessNativeBodyConformance,
  NATIVE_BODY_CONFORMANCE_PROTOCOL,
  NATIVE_BODY_PHASE_PROTOCOL,
} from '../src/evaluation/native-body-conformance';
import { createMinecraftMaterialActionRecord } from '../src/evaluation/minecraft-material-action-record';
import { executeScriptedInhabitantTurn } from './scripted-inhabitant-turn';
import {
  disconnectMinecraftBot,
  positionDistance,
  requiredEnvironment,
  waitForLocalWorld,
  waitForManagerStop,
} from './native-conformance-harness';
import { startManagedWorld } from './world-runner';
import { statusWorld } from './world-lab';

const ENTITY_ID = 'BodyResident';
const WITNESS_ID = 'BodyWitness';
const MODEL = 'script/native-body-conformance-v1';
const TARGET_ITEM = Object.freeze({ x: 0, y: -60, z: 0, item: 'dirt', count: 1 });
const PREPARED_BODY_POSITION = Object.freeze({ x: 24, y: -60, z: 0 });

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
      'Usage: native-body-conformance [--run <safe-id>] [--port <unused-loopback-port>]\n',
    );
    return;
  }
  const runId = String(
    parsed.values.run || `body-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  assertCleanRepository();
  const priorUmask = process.umask(0o077);
  let fixture: Awaited<ReturnType<typeof prepareOwnedWorld>>;
  try {
    fixture = await prepareOwnedWorld(
      runId,
      Number(parsed.values.port || 25579),
      'native-body',
      TARGET_ITEM,
    );
  } catch (error) {
    process.umask(priorUmask);
    throw error;
  }
  const reportFile = path.join(fixture.evidenceRoot, 'native-body-conformance.json');
  const witnessFile = path.join(fixture.evidenceRoot, 'independent-witness.json');
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
        controllerEntry: path.resolve('dist/scripts/native-body-conformance.js'),
        entityRoot: fixture.entityRoot,
        runRoot: path.join(fixture.evidenceRoot, 'runs'),
        residents: [
          {
            entityId: ENTITY_ID,
            model: MODEL,
            task: 'native-body-conformance',
            allowTools: ['place_block'],
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
      'native-body-conformance-phase.json',
    );
    await Promise.race([
      waitFor(() => fs.existsSync(phaseFile), 60_000, 'native body phase evidence'),
      run.finished.then(() => {
        throw new Error('managed world ended before native body phase evidence');
      }),
    ]);
    const phase = readJson(phaseFile);
    await run.quiesceResidents('native_body_before_independent_witness');
    const independentWitness = await observeFromFreshMinecraftBody({
      run,
      worldId: fixture.worldId,
      entityRoot: fixture.entityRoot,
      controlRoot: fixture.controlRoot,
      port: fixture.port,
      model: MODEL,
      witnessId: WITNESS_ID,
      observe: (bot) => ({
        dimension: String((bot as any).game?.dimension || ''),
        blocks: observedBlocks(bot, [phase.target]),
      }),
    });
    durableWriteJson(witnessFile, independentWitness);
    await run.stop('native_body_conformance_complete');
    await run.finished;
    const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
    const quiescenceEvents = lifecycle.events.filter(
      (candidate) =>
        candidate.type === 'residents_quiesced' &&
        (candidate.data as any)?.reason === 'native_body_before_independent_witness',
    );
    if (quiescenceEvents.length !== 1) {
      throw new Error(
        `world lifecycle has ${quiescenceEvents.length} bound pre-witness quiescence receipts`,
      );
    }
    const quiescence = quiescenceEvents[0];
    const runtime = await statusWorld(fixture.worldId, fixture.world);
    const control = inspectWorldControl(fixture.controlRoot, fixture.worldId);
    const leases = inspectEntityLeaseFence(fixture.entityRoot, [fixture.worldId]);
    const loomFiles = listFiles(path.join(fixture.entityRoot, ENTITY_ID, 'lync')).filter((file) =>
      file.endsWith('.lync'),
    );
    if (loomFiles.length !== 1) {
      throw new Error(`expected one body-resident Lync, found ${loomFiles.length}`);
    }
    const completedAt = new Date().toISOString();
    const draft = {
      protocol: NATIVE_BODY_CONFORMANCE_PROTOCOL,
      repositoryRevision: gitRevision(),
      runId: fixture.runId,
      worldId: fixture.worldId,
      managedRunId: run.runId,
      phase,
      phaseFile,
      phaseSha256: sha256File(phaseFile),
      independentWitness,
      independentWitnessFile: witnessFile,
      independentWitnessSha256: sha256File(witnessFile),
      loomFile: loomFiles[0],
      loomSha256: sha256File(loomFiles[0]),
      lifecycle: {
        file: run.control.journalFile,
        sha256: sha256File(run.control.journalFile),
        verified: true,
        eventCount: lifecycle.events.length,
        tipDigest: lifecycle.tipDigest,
        quiescence: {
          sequence: quiescence.sequence,
          at: quiescence.at,
          digest: quiescence.digest,
          reason: (quiescence.data as any).reason,
        },
      },
      finalOwnership: {
        control: control.state,
        port: runtime.serverPort.state,
        leases: leases.state,
      },
      completedAt,
    };
    const assessment = assessNativeBodyConformance(draft);
    if (!assessment.pass) {
      throw new Error(
        `native body conformance failed: ${Object.entries(assessment.assertions)
          .filter(([, value]) => !value)
          .map(([name]) => name)
          .join(', ')}`,
      );
    }
    const actionRecordAssessment = createMinecraftMaterialActionRecord(draft, {
      assessedAt: completedAt,
      checkerRevision: draft.repositoryRevision,
      refs: {
        phase: { file: phaseFile, sha256: draft.phaseSha256 },
        witness: { file: witnessFile, sha256: draft.independentWitnessSha256 },
        life: { file: draft.loomFile, sha256: draft.loomSha256 },
        lifecycle: { file: draft.lifecycle.file, sha256: draft.lifecycle.sha256 },
      },
    });
    durableWriteJson(reportFile, { ...draft, assessment, actionRecordAssessment });
    if (actionRecordAssessment.status !== 'passed') {
      throw new Error(
        `native body material action record failed: ${actionRecordAssessment.failed.join(', ')}`,
      );
    }
    process.stdout.write(
      `[native-body] PASS ${reportFile}\n[native-body] sha256 ${sha256File(reportFile)}\n`,
    );
  } catch (error) {
    if (run) await run.stop('native_body_conformance_failed').catch(() => {});
    throw error;
  } finally {
    process.umask(priorUmask);
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
  const entityId = args.positionals[0];
  if (entityId !== ENTITY_ID) throw new Error(`native body proof expected ${ENTITY_ID}`);
  if (args.values.server) process.env.SERVER_HOST = String(args.values.server);
  if (args.values.port) process.env.SERVER_PORT = String(args.values.port);
  if (args.values.world) process.env.BEHOLD_WORLD_ID = String(args.values.world);
  process.env.MINECRAFT_USERNAME = entityId;
  process.env.MINECRAFT_AUTH = 'offline';
  process.env.VIEWER_ENABLED = '0';

  const phaseFile = path.join(
    path.resolve(requiredEnvironment('BEHOLD_RUN_DIR')),
    'native-body-conformance-phase.json',
  );
  const cfg = getConfig();
  const loom = await openEntityLoom(entityId, undefined, cfg.circle.id);
  const priorTurns = loom.turns().length;
  let bot: ReturnType<typeof createBot> | null = null;
  let experience: InhabitantExperience | null = null;
  let engine: ReturnType<typeof createEngine> | null = null;
  try {
    bot = createBot(cfg, loom.connectionCapability);
    experience = new InhabitantExperience(bot as any, {
      circleId: cfg.circle.id,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      eventHistory: 40,
    });
    const interpreter = buildInterpreter(bot as any, {
      observe: () => experience!.observe(),
      changeConfirmationTimeoutMs: 10_000,
      changeStabilityWindowMs: 150,
      worldCommandTimeoutMs: 30_000,
    });
    const events: EngineEvent[] = [];
    engine = createEngine(
      {
        authorize: async (name, _input, intent) => ({
          ok: true,
          authority: 'native-body-conformance',
          evidence: { entityId, intentId: intent.id, tool: name },
        }),
        run: (name, input, _intent, execution) => interpreter.run(name, input, execution),
        list: () => interpreter.list('inhabitant'),
      },
      {
        allowTools: ['place_block'],
        onEvent: (event) => {
          events.push(event);
          experience!.recordEngineEvent(event);
        },
      },
    );
    await waitForLocalWorld(bot, 45_000);
    await waitFor(
      () => inventoryCount(experience!.observe(), 'dirt') >= 1,
      10_000,
      'body resident dirt inventory',
    );
    await (bot as any).pathfinder.goto(
      new (goals as any).GoalBlock(
        PREPARED_BODY_POSITION.x,
        PREPARED_BODY_POSITION.y,
        PREPARED_BODY_POSITION.z,
      ),
    );
    await waitFor(
      () => positionDistance((bot as any).entity?.position, PREPARED_BODY_POSITION) <= 1.25,
      10_000,
      'body resident prepared position',
    );
    if (priorTurns !== 0)
      throw new Error(`body proof expected no prior turns, found ${priorTurns}`);
    const initialObservation = experience.observe();
    const position = (bot as any).entity?.position;
    if (!position) throw new Error('body resident has no position');
    const bodyBefore = { x: Number(position.x), y: Number(position.y), z: Number(position.z) };
    const target = {
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z),
    };
    const before = (bot as any).blockAt?.(new Vec3(target.x, target.y, target.z));
    if (String(before?.name || '') !== 'air') {
      throw new Error(
        `body target must begin as air, observed ${String(before?.name || 'unknown')}`,
      );
    }
    const turn = await executeScriptedInhabitantTurn({
      entityId,
      loom,
      experience,
      engine,
      events,
      name: 'place_block',
      input: { ...target, name: 'dirt' },
      model: MODEL,
    });
    const finalObservation = experience.observe();
    durableWriteJson(phaseFile, {
      protocol: NATIVE_BODY_PHASE_PROTOCOL,
      repositoryRevision: gitRevision(),
      entityId,
      model: MODEL,
      worldId: cfg.circle.id,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      priorTurns,
      resultingTurns: loom.turns().length,
      fixtureSetup: {
        kind: 'pathfinder_preposition_before_recorded_action',
        destination: PREPARED_BODY_POSITION,
      },
      bodyBefore,
      target,
      initialObservation,
      turn,
      finalObservation,
      completedAt: new Date().toISOString(),
    });
    process.stdout.write(`[native-body] phase complete: ${phaseFile}\n`);
    await waitForManagerStop(bot);
    const drain = await engine.shutdown('managed_stdin_closed');
    if (!drain.drained) throw new Error('native body proof engine did not drain');
    experience.destroy();
    experience = null;
    await disconnectMinecraftBot(bot);
    bot = null;
    await loom.close();
  } catch (error) {
    try {
      if (engine) await engine.shutdown('native_body_proof_failed');
    } catch {}
    experience?.destroy();
    if (bot) await disconnectMinecraftBot(bot).catch(() => {});
    await loom.close().catch(() => {});
    throw error;
  }
}

function inventoryCount(observation: any, name: string) {
  return (Array.isArray(observation?.self?.inventory) ? observation.self.inventory : [])
    .filter((item: any) => String(item?.name) === name)
    .reduce((sum: number, item: any) => sum + Math.max(0, Number(item?.count) || 0), 0);
}

if (process.argv.slice(2).includes('--server')) {
  void runResident().catch((error) => {
    process.stderr.write(
      `[native-body:resident] ${error instanceof Error ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
} else {
  void runProof().catch((error) => {
    process.stderr.write(`[native-body] ${error instanceof Error ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}
