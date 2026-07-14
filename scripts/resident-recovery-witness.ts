#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createBot } from '../src/bot';
import { getConfig } from '../src/config';
import { InhabitantExperience } from '../src/agent/experience';
import { buildInterpreter } from '../src/agent/interpreter';
import { openEntityLoom } from '../src/entity/loom';
import {
  inspectEntityLeaseFence,
  inspectWorldControl,
  verifyWorldLifecycleJournal,
} from '../src/runtime/world-control';
import {
  assertCleanRepository,
  durableWriteJson,
  gitRevision,
  sha256File,
  waitFor,
} from './owned-world-fixture';
import { readRunJournal } from './owned-world-model-harness';
import {
  disconnectMinecraftBot,
  requiredEnvironment,
  waitForLocalWorld,
  waitForManagerStop,
} from './native-conformance-harness';
import { loadWorldLabConfig, statusWorld } from './world-lab';
import { startManagedWorld } from './world-runner';
import {
  assessResidentRecoveryWitness,
  RESIDENT_RECOVERY_WITNESS_PROTOCOL,
} from './resident-recovery-evidence';

const WITNESS_MODEL = 'evaluator/resident-recovery-witness-v1';
const PHASE_FILE = 'resident-recovery-witness-phase.json';

async function runProof() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: 'string' },
      world: { type: 'string' },
      entity: { type: 'string' },
      sourceJournal: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help) {
    process.stdout.write(
      'Usage: resident-recovery-witness --config <worlds.json> --world <id> --entity <id> --sourceJournal <journal.jsonl>\n',
    );
    return;
  }
  assertCleanRepository();
  const configPath = path.resolve(requiredOption(parsed.values.config, '--config'));
  const worldId = requiredOption(parsed.values.world, '--world');
  const entityId = requiredOption(parsed.values.entity, '--entity');
  const sourceJournal = path.resolve(
    requiredOption(parsed.values.sourceJournal, '--sourceJournal'),
  );
  const config = loadWorldLabConfig(configPath);
  const world = config.worlds[worldId];
  if (!world) throw new Error(`unknown world ${worldId}`);
  const events = readRunJournal(sourceJournal);
  const source = summarizeSource(events, entityId, worldId);
  const loomFile = String(source.loomFile || '');
  if (!fs.existsSync(loomFile)) throw new Error(`source Lync does not exist: ${loomFile}`);
  const journalSha256Before = sha256File(sourceJournal);
  const loomSha256Before = sha256File(loomFile);
  const toolLock = JSON.parse(
    fs.readFileSync(path.resolve('docs/sf-world/tool-lock.json'), 'utf8'),
  );
  const entityRoot = path.resolve('.behold-entities');
  const controlRoot = path.resolve('.behold-runtime/world-control');
  const runRoot = path.resolve('.behold-runs');
  let run: Awaited<ReturnType<typeof startManagedWorld>> | null = null;
  try {
    run = await startManagedWorld(
      {
        worldId,
        world,
        controlRoot,
        serverDirectory: path.dirname(world.runtime.worldPath),
        serverJar: path.resolve(String(toolLock.tools.minecraftServer.path)),
        expectedServerJarSha256: String(toolLock.tools.minecraftServer.sha256),
        java: bundledJava(),
        controllerEntry: path.resolve('dist/scripts/resident-recovery-witness.js'),
        entityRoot,
        runRoot,
        residents: [
          {
            entityId,
            model: WITNESS_MODEL,
            task: 'resident-recovery-witness',
            tickMs: 1_000,
          },
        ],
        maxResidents: 1,
        maxConcurrentModelCalls: 1,
        startupTimeoutMs: 90_000,
        shutdownTimeoutMs: 90_000,
      },
      {
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
      },
    );
    const phaseFile = path.join(run.residents[0].journalDirectory, PHASE_FILE);
    await Promise.race([
      waitFor(() => fs.existsSync(phaseFile), 60_000, 'resident recovery witness evidence'),
      run.finished.then(() => {
        throw new Error('managed world ended before recovery witness evidence');
      }),
    ]);
    const witness = JSON.parse(fs.readFileSync(phaseFile, 'utf8'));
    await run.stop('resident_recovery_witness_complete');
    await run.finished;
    const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
    const runtime = await statusWorld(worldId, world);
    const control = inspectWorldControl(controlRoot, worldId);
    const leases = inspectEntityLeaseFence(entityRoot, [worldId]);
    const report: any = {
      protocol: RESIDENT_RECOVERY_WITNESS_PROTOCOL,
      repositoryRevision: gitRevision(),
      source: {
        ...source,
        journalFile: sourceJournal,
        journalSha256Before,
        journalSha256After: sha256File(sourceJournal),
        loomSha256Before,
        loomSha256After: sha256File(loomFile),
      },
      witness,
      phaseFile,
      phaseSha256: sha256File(phaseFile),
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
    report.assessment = assessResidentRecoveryWitness(report);
    const reportFile = path.join(runRoot, run.runId, '_evidence', 'resident-recovery-witness.json');
    durableWriteJson(reportFile, report);
    if (!report.assessment.pass) {
      throw new Error(
        `resident recovery remains unproved: ${Object.entries(report.assessment.assertions)
          .filter(([, value]) => !value)
          .map(([name]) => name)
          .join(', ')}`,
      );
    }
    process.stdout.write(
      `[resident-recovery] PASS ${reportFile}\n[resident-recovery] sha256 ${sha256File(reportFile)}\n`,
    );
  } catch (error) {
    if (run) await run.stop('resident_recovery_witness_failed').catch(() => {});
    throw error;
  }
}

async function runWitness() {
  const parsed = parseArgs({
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
      urgentModel: { type: 'string' },
    },
    allowPositionals: true,
  });
  const entityId = String(parsed.positionals[0] || '');
  if (!entityId) throw new Error('recovery witness entity id is required');
  if (parsed.values.server) process.env.SERVER_HOST = String(parsed.values.server);
  if (parsed.values.port) process.env.SERVER_PORT = String(parsed.values.port);
  if (parsed.values.world) process.env.BEHOLD_WORLD_ID = String(parsed.values.world);
  process.env.MINECRAFT_USERNAME = entityId;
  process.env.MINECRAFT_AUTH = 'offline';
  process.env.VIEWER_ENABLED = '0';

  const cfg = getConfig();
  const loom = await openEntityLoom(entityId, undefined, cfg.circle.id);
  const priorTurns = loom.turns().length;
  let bot: ReturnType<typeof createBot> | null = null;
  let experience: InhabitantExperience | null = null;
  try {
    bot = createBot(cfg, loom.connectionCapability);
    experience = new InhabitantExperience(bot as any, {
      circleId: cfg.circle.id,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      eventHistory: 40,
    });
    await waitForLocalWorld(bot, 45_000, 'resident recovery witness local world');
    experience.markLocalWorldReady();
    await waitFor(
      () => experience!.observe().self.condition.health != null,
      10_000,
      'resident recovery witness body condition',
    );
    const before = experience.observe();
    const position = (bot as any).entity?.position;
    const feet = position?.floored?.();
    if (!position || !feet) throw new Error('recovery witness body position unavailable');
    const interpreter = buildInterpreter(bot as any, {
      observe: () => experience!.observe(),
    });
    const inspection = await interpreter.run('inspect_reachable_space', {
      feet: { x: feet.x, y: feet.y, z: feet.z },
      radius: 6,
      verticalRadius: 3,
    });
    const after = experience.observe();
    const phaseFile = path.join(path.resolve(requiredEnvironment('BEHOLD_RUN_DIR')), PHASE_FILE);
    durableWriteJson(phaseFile, {
      protocol: 'behold.resident-recovery-witness-phase.v1',
      repositoryRevision: gitRevision(),
      entityId,
      worldId: cfg.circle.id,
      managedRunId: process.env.BEHOLD_RUN_ID || null,
      source: 'fresh_minecraft_connection',
      authority: 'external_evaluator',
      worldStateCertified: true,
      position: {
        x: Number(position.x),
        y: Number(position.y),
        z: Number(position.z),
      },
      condition: after.self.condition,
      inventory: after.self.inventory,
      visualField: after.scene.terrain.visualField,
      inspection,
      priorTurns,
      resultingTurns: loom.turns().length,
      observationSequenceBefore: before.sequence,
      observationSequenceAfter: after.sequence,
      observedAt: Date.now(),
    });
    process.stdout.write(`[resident-recovery:witness] phase complete: ${phaseFile}\n`);
    await waitForManagerStop(bot, 'resident recovery witness');
    experience.destroy();
    experience = null;
    await disconnectMinecraftBot(bot);
    bot = null;
    await loom.close();
  } catch (error) {
    experience?.destroy();
    if (bot) await disconnectMinecraftBot(bot).catch(() => {});
    await loom.close().catch(() => {});
    throw error;
  }
}

function summarizeSource(events: any[], entityId: string, worldId: string) {
  const started = events.find((event) => event?.type === 'run_started');
  if (!started) throw new Error('source journal has no run_started event');
  if (started.agent !== entityId || started.data?.circle?.id !== worldId) {
    throw new Error('source journal entity or world does not match requested witness');
  }
  const finalTurn = [...events]
    .reverse()
    .find((event) => event?.type === 'entity_turn' && event.data?.nextObservation?.self);
  if (!finalTurn) throw new Error('source journal has no completed entity turn');
  const finalSelf = finalTurn.data.nextObservation.self;
  const results = events
    .filter((event) => event?.type === 'action_completed' || event?.type === 'action_failed')
    .map((event) => event?.data?.result)
    .filter(Boolean);
  return {
    entityId,
    worldId,
    managedRunId: String(started.data?.runId || ''),
    loomFile: String(started.data?.entityLoom || ''),
    finalPosition: finalSelf.pose?.position ?? null,
    finalCondition: finalSelf.condition ?? null,
    bodyMoved: results.some((result) => result?.bodyMoved === true),
    verifiedWorldChange: results.some(
      (result) => result?.verified === true && result?.observed === true,
    ),
  };
}

function requiredOption(value: unknown, name: string) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function bundledJava() {
  const candidate = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'minecraft',
    'runtime',
    'java-runtime-delta',
    'mac-os-arm64',
    'java-runtime-delta',
    'jre.bundle',
    'Contents',
    'Home',
    'bin',
    'java',
  );
  return process.env.SERVER_JAVA || (fs.existsSync(candidate) ? candidate : 'java');
}

if (process.argv.slice(2).includes('--server')) {
  void runWitness().catch((error) => {
    process.stderr.write(
      `[resident-recovery:witness] ${error instanceof Error ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
} else {
  void runProof().catch((error) => {
    process.stderr.write(`[resident-recovery] ${error instanceof Error ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}
