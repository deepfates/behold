#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Vec3 } from 'vec3';
import { runConsole } from '../src/tui/console';
import {
  durableWriteJson,
  gitRevision,
  prepareOwnedWorld,
  readJson,
  sha256File,
  waitFor,
  type OwnedWorldBlock,
} from './owned-world-fixture';
import { readRunJournal, waitForRunJournal } from './owned-world-model-harness';
import { summarizeResidentRecoverySource } from './resident-recovery-evidence';
import { runResidentRecoveryWitness } from './resident-recovery-witness';
import { startManagedWorld } from './world-runner';

const ENTITY_ID = 'RecoveryBody';
const DEFAULT_MODEL = 'openai/gpt-5.4-mini';
const SETUP_FILE = 'resident-recovery-live-setup.json';
const LIVE_PROTOCOL = 'behold.resident-recovery-live.v1';
const DUMMY_ITEM = Object.freeze({ x: 30, y: -60, z: 0, item: 'dirt', count: 1 });
const START_FEET = Object.freeze({ x: 1, y: -60, z: 0 });
const START_HEAD = Object.freeze({ x: 1, y: -59, z: 0 });
const WATER_GATE_FEET = Object.freeze({ x: 4, y: -60, z: 0 });
const WATER_GATE_HEAD = Object.freeze({ x: 4, y: -59, z: 0 });
const AIR_FEET = Object.freeze({ x: 5, y: -60, z: 0 });
const AIR_HEAD = Object.freeze({ x: 5, y: -59, z: 0 });

async function runProof() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: 'string' },
      port: { type: 'string' },
      model: { type: 'string' },
      maxModelCalls: { type: 'string' },
      timeoutMs: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help) {
    process.stdout.write(
      'Usage: resident-recovery-live [--run <safe-id>] [--port <unused-loopback-port>] [--model <slug>] [--maxModelCalls <n>] [--timeoutMs <ms>]\n',
    );
    return;
  }
  const runId = String(
    parsed.values.run || `resident-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  const model = String(parsed.values.model || DEFAULT_MODEL);
  const maxModelCalls = boundedInteger(parsed.values.maxModelCalls ?? 12, 1, 64, 'maxModelCalls');
  const timeoutMs = boundedInteger(
    parsed.values.timeoutMs ?? 120_000,
    10_000,
    600_000,
    'timeoutMs',
  );
  const fixture = await prepareOwnedWorld(
    runId,
    Number(parsed.values.port || 25580),
    'resident-recovery-live',
    DUMMY_ITEM,
    [],
    recoveryCorridorBlocks(),
  );
  const runRoot = path.join(fixture.evidenceRoot, 'runs');
  const configPath = path.join(fixture.root, 'world-definition.json');
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
        controllerEntry: path.resolve('dist/scripts/resident-recovery-live.js'),
        entityRoot: fixture.entityRoot,
        runRoot,
        residents: [
          {
            entityId: ENTITY_ID,
            model,
            urgentModel: model,
            mind: 'direct',
            tickMs: 1_000,
          },
        ],
        maxResidents: 1,
        maxConcurrentModelCalls: 1,
        maxTotalModelCalls: maxModelCalls,
        startupTimeoutMs: 90_000,
        shutdownTimeoutMs: 90_000,
      },
      {
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
      },
    );
    const setupFile = path.join(run.residents[0].journalDirectory, SETUP_FILE);
    const journalFile = await waitForRunJournal(run.residents[0].journalDirectory, 30_000);
    let source: ReturnType<typeof summarizeResidentRecoverySource> | null = null;
    await Promise.race([
      waitFor(
        () => {
          if (!fs.existsSync(setupFile)) return false;
          const events = readRunJournal(journalFile);
          const modelFailure = events.find((event) => event.type === 'model_call_failed');
          if (modelFailure) {
            throw new Error(
              `resident recovery model failed: ${String(modelFailure.data?.error || 'unknown')}`,
            );
          }
          try {
            source = summarizeResidentRecoverySource(events, ENTITY_ID, fixture.worldId);
          } catch {
            return false;
          }
          if (source.deathEvents.length > 0) {
            throw new Error('resident died before recovery completed');
          }
          return (
            source.urgency != null &&
            source.recoveryActions.some(
              (action) => action.kind === 'movement' && action.selectedFromCriticalBody,
            ) &&
            Number(source.final.condition.oxygen) >= 10
          );
        },
        timeoutMs,
        'untasked live resident recovery',
      ),
      run.finished.then(() => {
        throw new Error('managed world ended before live resident recovery');
      }),
    ]);
    await run.stop('resident_recovery_live_source_complete');
    await run.finished;
    const finalEvents = readRunJournal(journalFile);
    source = summarizeResidentRecoverySource(finalEvents, ENTITY_ID, fixture.worldId);
    const setup = readJson(setupFile);
    assertRecoverySetup(setup);
    const witness = await runResidentRecoveryWitness({
      configPath,
      worldId: fixture.worldId,
      entityId: ENTITY_ID,
      sourceJournal: journalFile,
      entityRoot: fixture.entityRoot,
      controlRoot: fixture.controlRoot,
      runRoot,
    });
    const reportFile = path.join(fixture.evidenceRoot, 'resident-recovery-live.json');
    const report = {
      protocol: LIVE_PROTOCOL,
      repositoryRevision: gitRevision(),
      runId: fixture.runId,
      worldId: fixture.worldId,
      model,
      fixture: {
        sourceTreeDigest: fixture.sourceTree.digest,
        baselineTreeDigest: fixture.baselineTree.digest,
        preparedBlocks: fixture.blocks,
        setupFile,
        setupSha256: sha256File(setupFile),
        setup,
      },
      source: {
        managedRunId: source.managedRunId,
        journalFile,
        journalSha256: sha256File(journalFile),
        summary: source,
      },
      restartWitness: {
        reportFile: witness.reportFile,
        reportSha256: sha256File(witness.reportFile),
        assessment: witness.report.assessment,
      },
      assessment: {
        pass: witness.report.assessment.pass === true,
        claims: {
          evaluatorSetupEndedBeforeResidentReadiness: true,
          sourceWasUntasked: source.task == null && source.target == null,
          sourceHadNoActionAllowlist: source.controller.allowTools == null,
          realModelDecisionWasBrokerAdmitted:
            witness.report.assessment.assertions.brokerAdmittedRealModelDecision === true,
          minecraftBodyRecoveredBeforeRestart:
            witness.report.assessment.assertions.recoveryCompletedBeforeRestart === true,
          recoveryPersistedAcrossFreshEpoch:
            witness.report.assessment.assertions.independentlyObservedPersistentRecovery === true,
        },
      },
      completedAt: new Date().toISOString(),
    };
    durableWriteJson(reportFile, report);
    if (!report.assessment.pass || !Object.values(report.assessment.claims).every(Boolean)) {
      throw new Error(`live recovery report failed: ${JSON.stringify(report.assessment)}`);
    }
    process.stdout.write(
      `[resident-recovery-live] PASS ${reportFile}\n[resident-recovery-live] sha256 ${sha256File(reportFile)}\n`,
    );
  } catch (error) {
    if (run) await run.stop('resident_recovery_live_failed').catch(() => {});
    throw error;
  }
}

async function runResident() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      server: { type: 'string' },
      port: { type: 'string' },
      world: { type: 'string' },
      model: { type: 'string' },
      urgentModel: { type: 'string' },
      tickMs: { type: 'string' },
      task: { type: 'string' },
      target: { type: 'string' },
      allowTools: { type: 'string' },
    },
    allowPositionals: true,
  });
  const entityId = String(parsed.positionals[0] || '');
  if (entityId !== ENTITY_ID) throw new Error(`live recovery expected ${ENTITY_ID}`);
  if (parsed.values.task || parsed.values.target || parsed.values.allowTools) {
    throw new Error('live recovery resident must be untasked and unrestricted');
  }
  if (parsed.values.server) process.env.SERVER_HOST = String(parsed.values.server);
  if (parsed.values.port) process.env.SERVER_PORT = String(parsed.values.port);
  if (parsed.values.world) process.env.BEHOLD_WORLD_ID = String(parsed.values.world);
  process.env.MINECRAFT_AUTH = 'offline';
  process.env.VIEWER_ENABLED = '0';

  await runConsole({
    agentName: entityId,
    model: String(parsed.values.model || DEFAULT_MODEL),
    urgentModel: String(parsed.values.urgentModel || parsed.values.model || DEFAULT_MODEL),
    tickMs: Number(parsed.values.tickMs || 1_000),
    beforeResidentReady: async ({ bot, observe }) => {
      const preposition = await enterRecoveryCorridor(bot);
      await waitFor(
        () => {
          const oxygen = Number(observe().self.condition.oxygen);
          return oxygen > 5 && oxygen <= 9;
        },
        20_000,
        'live recovery pre-critical oxygen window',
      );
      const observation = observe();
      const setup = recoverySetup(bot, observation, preposition);
      assertRecoverySetup(setup);
      const setupFile = path.join(requiredEnvironment('BEHOLD_RUN_DIR'), SETUP_FILE);
      durableWriteJson(setupFile, setup);
      process.stdout.write(`[resident-recovery-live] setup complete: ${setupFile}\n`);
    },
  });
}

function recoveryCorridorBlocks(): OwnedWorldBlock[] {
  const blocks: OwnedWorldBlock[] = [];
  for (let x = -1; x <= 7; x += 1) {
    blocks.push({ x, y: -58, z: 0, block: x === 0 ? 'water' : 'glass' });
    if (x === 0) {
      blocks.push({ x, y: -58, z: -1, block: 'glass' });
      blocks.push({ x, y: -58, z: 1, block: 'glass' });
    }
    for (const y of [-60, -59]) {
      blocks.push({ x, y, z: -1, block: 'glass' });
      blocks.push({ x, y, z: 1, block: 'glass' });
      if (x === -1 || x === 7) blocks.push({ x, y, z: 0, block: 'glass' });
      else if (x <= 3) blocks.push({ x, y, z: 0, block: 'water' });
      else if (x === 4) blocks.push({ x, y, z: 0, block: 'oak_sign[rotation=0]' });
    }
  }
  return blocks;
}

async function enterRecoveryCorridor(bot: any) {
  const before = currentPosition(bot);
  await bot.lookAt(new Vec3(2.5, -59.5, 0.5), true);
  bot.setControlState('sneak', true);
  try {
    await waitFor(
      () => Number(bot.entity?.position?.y) <= -59.8,
      10_000,
      'live recovery body descent through water entrance',
    );
    bot.setControlState('forward', true);
    await waitFor(
      () => Number(bot.entity?.position?.x) >= 1.15,
      10_000,
      'live recovery body entry beneath corridor roof',
    );
  } finally {
    bot.setControlState('forward', false);
    bot.setControlState('sneak', false);
  }
  await bot.lookAt(new Vec3(6.5, -59.5, 0.5), true);
  await delay(150);
  return {
    kind: 'evaluator_owned_native_controls_before_resident_readiness',
    controls: ['look_at', 'sneak', 'forward', 'look_at'],
    before,
    after: currentPosition(bot),
  };
}

function recoverySetup(bot: any, observation: any, preposition: Record<string, unknown>) {
  const blockName = (position: { x: number; y: number; z: number }) =>
    String(bot.blockAt?.(new Vec3(position.x, position.y, position.z))?.name || 'unknown');
  return {
    kind: 'native_underwater_escape_before_resident_readiness',
    authority: 'external_evaluator',
    preposition,
    body: currentPosition(bot),
    orientation: { yaw: Number(bot.entity?.yaw), pitch: Number(bot.entity?.pitch) },
    oxygenBeforeResidentReadiness: observation?.self?.condition?.oxygen ?? null,
    cells: {
      startFeet: { position: START_FEET, name: blockName(START_FEET) },
      startHead: { position: START_HEAD, name: blockName(START_HEAD) },
      gateFeet: { position: WATER_GATE_FEET, name: blockName(WATER_GATE_FEET) },
      gateHead: { position: WATER_GATE_HEAD, name: blockName(WATER_GATE_HEAD) },
      airFeet: { position: AIR_FEET, name: blockName(AIR_FEET) },
      airHead: { position: AIR_HEAD, name: blockName(AIR_HEAD) },
    },
    recordedAt: Date.now(),
  };
}

function assertRecoverySetup(setup: any) {
  const oxygen = Number(setup?.oxygenBeforeResidentReadiness);
  const names = setup?.cells ?? {};
  if (
    setup?.authority !== 'external_evaluator' ||
    !(oxygen > 5 && oxygen <= 9) ||
    names.startFeet?.name !== 'water' ||
    names.startHead?.name !== 'water' ||
    names.gateFeet?.name !== 'oak_sign' ||
    names.gateHead?.name !== 'oak_sign' ||
    names.airFeet?.name !== 'air' ||
    names.airHead?.name !== 'air'
  ) {
    throw new Error(`invalid live recovery setup: ${JSON.stringify(setup)}`);
  }
}

function currentPosition(bot: any) {
  const position = bot?.entity?.position;
  return position ? { x: Number(position.x), y: Number(position.y), z: Number(position.z) } : null;
}

function boundedInteger(value: unknown, min: number, max: number, label: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer from ${min} through ${max}`);
  }
  return number;
}

function requiredEnvironment(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return path.resolve(value);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

if (process.argv.slice(2).includes('--server')) {
  void runResident().catch((error) => {
    process.stderr.write(
      `[resident-recovery-live:resident] ${error instanceof Error ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
} else {
  void runProof().catch((error) => {
    process.stderr.write(
      `[resident-recovery-live] ${error instanceof Error ? error.stack : error}\n`,
    );
    process.exitCode = 1;
  });
}
