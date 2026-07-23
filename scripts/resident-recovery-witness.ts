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
import { parseManagedResidentArgs } from './managed-resident-cli';
import {
  assessResidentRecoveryWitness,
  RESIDENT_RECOVERY_WITNESS_PHASE_PROTOCOL,
  RESIDENT_RECOVERY_WITNESS_PROTOCOL,
  summarizeResidentRecoverySource,
} from './resident-recovery-evidence';

const WITNESS_MODEL = 'evaluator/resident-recovery-witness-v2';
const PHASE_FILE = 'resident-recovery-witness-phase.json';

export type ResidentRecoveryWitnessOptions = Readonly<{
  configPath: string;
  worldId: string;
  entityId: string;
  sourceJournal: string;
  entityRoot?: string;
  controlRoot?: string;
  runRoot?: string;
}>;

async function runProof() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: 'string' },
      world: { type: 'string' },
      entity: { type: 'string' },
      sourceJournal: { type: 'string' },
      entityRoot: { type: 'string' },
      controlRoot: { type: 'string' },
      runRoot: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help) {
    process.stdout.write(
      'Usage: resident-recovery-witness --config <worlds.json> --world <id> --entity <id> --sourceJournal <journal.jsonl> [--entityRoot <dir>] [--controlRoot <dir>] [--runRoot <dir>]\n',
    );
    return;
  }
  await runResidentRecoveryWitness({
    configPath: requiredOption(parsed.values.config, '--config'),
    worldId: requiredOption(parsed.values.world, '--world'),
    entityId: requiredOption(parsed.values.entity, '--entity'),
    sourceJournal: requiredOption(parsed.values.sourceJournal, '--sourceJournal'),
    ...(parsed.values.entityRoot ? { entityRoot: String(parsed.values.entityRoot) } : {}),
    ...(parsed.values.controlRoot ? { controlRoot: String(parsed.values.controlRoot) } : {}),
    ...(parsed.values.runRoot ? { runRoot: String(parsed.values.runRoot) } : {}),
  });
}

export async function runResidentRecoveryWitness(options: ResidentRecoveryWitnessOptions) {
  assertCleanRepository();
  const configPath = path.resolve(options.configPath);
  const worldId = requiredOption(options.worldId, 'worldId');
  const entityId = requiredOption(options.entityId, 'entityId');
  const sourceJournal = path.resolve(options.sourceJournal);
  const config = loadWorldLabConfig(configPath);
  const world = config.worlds[worldId];
  if (!world) throw new Error(`unknown world ${worldId}`);
  const events = readRunJournal(sourceJournal);
  const source = summarizeResidentRecoverySource(events, entityId, worldId);
  const loomFile = String(source.loomFile || '');
  if (!fs.existsSync(loomFile)) throw new Error(`source Lync does not exist: ${loomFile}`);
  const journalSha256Before = sha256File(sourceJournal);
  const loomSha256Before = sha256File(loomFile);
  const toolLock = JSON.parse(
    fs.readFileSync(path.resolve('docs/sf-world/tool-lock.json'), 'utf8'),
  );
  const entityRoot = path.resolve(options.entityRoot ?? '.behold-entities');
  const controlRoot = path.resolve(options.controlRoot ?? '.behold-runtime/world-control');
  const runRoot = path.resolve(options.runRoot ?? '.behold-runs');
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
    return { reportFile, report };
  } catch (error) {
    if (run) await run.stop('resident_recovery_witness_failed').catch(() => {});
    throw error;
  }
}

async function runWitness() {
  const parsed = parseManagedResidentArgs();
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
      protocol: RESIDENT_RECOVERY_WITNESS_PHASE_PROTOCOL,
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

if (require.main === module) {
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
}
