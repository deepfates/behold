#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  assessMinecraftInventoryGain,
  inventoryCount,
  minecraftInventoryGainSpecification,
  minecraftInventoryGainSpecificationSha256,
  parseMinecraftInventoryGainSpecification,
} from '../src/evaluation/minecraft-inventory-gain';
import { createEvaluationEpisode, openEvaluationEpisode } from '../src/evaluation/episode';
import { readEntityLifeRange, resolveEntityLifeRange } from '../src/entity/loom';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import {
  minecraftHistoryWorldDefinition,
  prepareMinecraftHistoryServer,
  verifyMinecraftHistoryServer,
  verifyMinecraftWorldHistoryFork,
  type MinecraftWorldHistoryFork,
} from '../src/runtime/world-history';
import {
  assertCleanRepository,
  durableWriteJson,
  gitRevision,
  readJson,
  restoreEnvironment,
  sha256File,
  waitFor,
} from './owned-world-fixture';
import { parseRunJournal } from './owned-world-model-evidence';
import { waitForRunJournal } from './owned-world-model-harness';
import { digestTree, loadWorldLabConfig } from './world-lab';
import { bundledJava, startManagedWorld, type ManagedWorldRun } from './world-runner';

const PROTOCOL = 'behold.minecraft-inventory-gain-proof.v1' as const;

async function main(argv = process.argv.slice(2)) {
  const args = parseCli(argv);
  if (args.verify) {
    const verification = await verifyProof(args.verify);
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    if (verification.status !== 'passed') process.exitCode = 1;
    return;
  }
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required');
  assertCleanRepository();
  const specification = minecraftInventoryGainSpecification({
    item: args.item,
    minimumGain: args.minimumGain,
    turns: args.turns,
    providerCalls: args.providerCalls,
  });
  const receiptFile = path.resolve(args.receipt);
  const receipt = readJson(receiptFile) as MinecraftWorldHistoryFork;
  const fork = await verifyMinecraftWorldHistoryFork(receipt);
  if (!fork.checkpointIntegrityOk || !fork.lineageIntegrityOk || !fork.lifecycleIntegrityOk) {
    throw new Error('world-history receipt failed checkpoint or lineage verification');
  }
  const history = receipt.histories.find((candidate) => candidate.historyId === args.history);
  if (!history) throw new Error(`world-history receipt has no child ${args.history}`);
  const initialWorld = digestTree(history.worldPath);
  if (initialWorld.digest !== history.initialDigest) {
    throw new Error('inventory-gain episode requires a pristine sibling history');
  }
  const root = path.resolve('.behold-runtime', 'world-histories', 'evidence', args.runId);
  if (fs.existsSync(root)) throw new Error(`inventory-gain proof already exists: ${root}`);
  const evidenceRoot = path.join(root, 'evidence');
  const entityRoot = path.join(root, 'entities');
  const controlRoot = path.join(root, 'control');
  const runRoot = path.join(evidenceRoot, 'runs');
  for (const directory of [evidenceRoot, entityRoot, controlRoot, runRoot]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }
  const config = loadWorldLabConfig(path.resolve(args.config));
  const parent = config.worlds[args.world];
  if (!parent) throw new Error(`unknown parent world ${args.world}`);
  if (receipt.worldId !== args.world) throw new Error('receipt and parent world differ');
  const server = prepareMinecraftHistoryServer({
    history,
    templateServerDirectory: path.dirname(parent.runtime.worldPath),
    port: args.port,
  });
  const serverVerification = verifyMinecraftHistoryServer(server);
  if (!serverVerification.profileIntegrityOk) throw new Error('history server profile is invalid');
  const world = minecraftHistoryWorldDefinition(parent, receipt.checkpoint, history, args.port);
  const toolLock = readJson(path.resolve('docs/sf-world/tool-lock.json'));
  const serverJar = path.resolve(String(toolLock.tools.minecraftServer.path));
  const expectedServerJarSha256 = String(toolLock.tools.minecraftServer.sha256);
  if (sha256File(serverJar) !== expectedServerJarSha256) {
    throw new Error('pinned Minecraft server JAR differs from the tool lock');
  }
  const environment = {
    recordModelIo: process.env.BEHOLD_RECORD_MODEL_IO,
  };
  process.env.BEHOLD_RECORD_MODEL_IO = '1';
  let actRun: ManagedWorldRun | null = null;
  let restartRun: ManagedWorldRun | null = null;
  let episode: Awaited<ReturnType<typeof createEvaluationEpisode>> | null = null;
  try {
    actRun = await startManagedWorld(
      {
        worldId: history.historyId,
        world,
        controlRoot,
        serverDirectory: server.serverDirectory,
        serverJar,
        expectedServerJarSha256,
        java: bundledJava(),
        controllerEntry: path.resolve('dist/src/cli/behold.js'),
        entityRoot,
        runRoot,
        residents: [
          {
            entityId: args.entity,
            bodyUsername: args.body,
            model: args.model,
            mind: args.mind,
            policyProfile: specification.profiles.policy,
            actionProfile: specification.profiles.actions,
            safetyProfile: specification.profiles.safety,
            tickMs: 1_000,
            maxTurnSteps: specification.budgets.turns,
            resumeAfterBudget: false,
            task: specification.task,
          },
        ],
        maxResidents: 1,
        maxConcurrentModelCalls: 1,
        maxTotalModelCalls: specification.budgets.providerCalls,
        startupTimeoutMs: 90_000,
        shutdownTimeoutMs: 90_000,
      },
      processOutput(),
    );
    const actJournalFile = await waitForRunJournal(actRun.residents[0].journalDirectory, 30_000);
    let terminal = episodeProgress(
      [],
      specification.item,
      specification.minimumGain,
      specification.budgets.turns,
    );
    try {
      await Promise.race([
        waitFor(
          () => {
            const events = readJournal(actJournalFile);
            terminal = episodeProgress(
              events,
              specification.item,
              specification.minimumGain,
              specification.budgets.turns,
            );
            return terminal.terminal;
          },
          args.timeoutMs,
          'bounded Minecraft inventory-gain episode',
        ),
        actRun.finished.then(() => {
          throw new Error('managed world stopped before the inventory-gain episode settled');
        }),
      ]);
    } catch (error: any) {
      if (!/timed out|timeout/i.test(String(error?.message || error))) throw error;
      terminal = { ...terminal, terminal: true, reason: 'wall_time_budget' };
    }
    await actRun.quiesceResidents(`inventory_gain_${terminal.reason}`);
    await actRun.stop('inventory_gain_act_complete');
    await actRun.finished;
    const actEvents = readJournal(actJournalFile);
    const actLifecycleFile = actRun.control.journalFile;
    const actLifecycle = verifyWorldLifecycleJournal(actLifecycleFile);
    const afterActWorld = digestTree(history.worldPath);

    restartRun = await startManagedWorld(
      {
        worldId: history.historyId,
        world,
        controlRoot,
        serverDirectory: server.serverDirectory,
        serverJar,
        expectedServerJarSha256,
        java: bundledJava(),
        controllerEntry: path.resolve('dist/src/cli/behold.js'),
        entityRoot,
        runRoot,
        residents: [
          {
            entityId: args.entity,
            bodyUsername: args.body,
            model: args.model,
            mind: args.mind,
            policyProfile: specification.profiles.policy,
            actionProfile: specification.profiles.actions,
            safetyProfile: specification.profiles.safety,
            paused: true,
          },
        ],
        maxResidents: 1,
        startupTimeoutMs: 90_000,
        shutdownTimeoutMs: 90_000,
      },
      processOutput(),
    );
    const restartJournalFile = await waitForRunJournal(
      restartRun.residents[0].journalDirectory,
      30_000,
    );
    await Promise.race([
      waitFor(
        () => readJournal(restartJournalFile).some((event) => event.type === 'local_world_ready'),
        45_000,
        'fresh paused resident observation',
      ),
      restartRun.finished.then(() => {
        throw new Error('restart ended before the fresh body observation');
      }),
    ]);
    await restartRun.stop('inventory_gain_restart_observed');
    await restartRun.finished;
    const restartEvents = readJournal(restartJournalFile);
    const restartLifecycleFile = restartRun.control.journalFile;
    const restartLifecycle = verifyWorldLifecycleJournal(restartLifecycleFile);
    const afterRestartWorld = digestTree(history.worldPath);

    const entityTurns = actEvents.filter((event) => event.type === 'entity_turn');
    if (entityTurns.length === 0) throw new Error('inventory-gain episode recorded no life turn');
    const lastSequence = Number(entityTurns.at(-1)?.data?.sequence);
    const life = await resolveEntityLifeRange(args.entity, 1, lastSequence, entityRoot);
    const specificationSha256 = minecraftInventoryGainSpecificationSha256(specification);
    episode = await createEvaluationEpisode(
      path.join(evidenceRoot, 'evaluation-episodes'),
      entityRoot,
      {
        protocol: 'behold.evaluation-episode.v1',
        suite: {
          id: 'minecraft-inventory-gain',
          version: '1',
          caseId: 'persisted-inventory-gain',
          specificationSha256,
        },
        life,
      },
      'behold-minecraft-inventory-gain-evaluator',
    );
    const lifeRead = await readEntityLifeRange(life, entityRoot);
    const assessment = assessMinecraftInventoryGain({
      specification,
      expected: {
        worldId: history.historyId,
        entityId: args.entity,
        bodyUsername: args.body,
        model: args.model,
        mind: args.mind,
        actRunId: actRun.runId,
        restartRunId: restartRun.runId,
      },
      actEvents,
      restartEvents,
      life,
      lifeTurns: lifeRead.turns,
      episodeDefinition: episode.definition,
    });
    const reportFile = path.join(evidenceRoot, 'inventory-gain-result.json');
    durableWriteJson(reportFile, {
      protocol: PROTOCOL,
      status: assessment.status,
      generatedAt: new Date().toISOString(),
      repository: { revision: gitRevision() },
      specification,
      expected: {
        worldId: history.historyId,
        entityId: args.entity,
        bodyUsername: args.body,
        model: args.model,
        mind: args.mind,
        actRunId: actRun.runId,
        restartRunId: restartRun.runId,
      },
      source: {
        receiptFile,
        receiptSha256: sha256File(receiptFile),
        operationId: receipt.operationId,
        checkpointArtifactId: receipt.checkpoint.artifactId,
        checkpointDigest: receipt.checkpoint.digest,
        historyId: history.historyId,
        initialWorld,
        afterActWorld,
        afterRestartWorld,
        serverProfile: {
          manifestFile: server.manifestFile,
          manifestSha256: sha256File(server.manifestFile),
        },
      },
      terminal,
      life,
      episode: {
        loom: episode.loomReference,
        definition: episode.definitionReference,
        file: episode.file,
        sha256: sha256File(episode.file),
      },
      evidence: {
        entityRoot,
        act: {
          journalFile: actJournalFile,
          journalSha256: sha256File(actJournalFile),
          lifecycleFile: actLifecycleFile,
          lifecycleSha256: sha256File(actLifecycleFile),
          lifecycleEpoch: actLifecycle.epoch,
          lifecycleTipDigest: actLifecycle.tipDigest,
          cognitionJournalFile: actRun.cognition?.journalFile ?? null,
          cognitionJournalSha256: actRun.cognition
            ? sha256File(actRun.cognition.journalFile)
            : null,
        },
        restart: {
          journalFile: restartJournalFile,
          journalSha256: sha256File(restartJournalFile),
          lifecycleFile: restartLifecycleFile,
          lifecycleSha256: sha256File(restartLifecycleFile),
          lifecycleEpoch: restartLifecycle.epoch,
          lifecycleTipDigest: restartLifecycle.tipDigest,
        },
      },
      assessment,
    });
    episode.close();
    episode = null;
    const verification = await verifyProof(reportFile);
    process.stdout.write(`${JSON.stringify({ report: reportFile, verification }, null, 2)}\n`);
    if (verification.status !== 'passed') {
      throw new Error(`inventory-gain proof failed: ${verification.failed.join(', ')}`);
    }
  } finally {
    episode?.close();
    if (actRun) await actRun.stop('inventory_gain_cleanup').catch(() => {});
    if (restartRun) await restartRun.stop('inventory_gain_restart_cleanup').catch(() => {});
    restoreEnvironment('BEHOLD_RECORD_MODEL_IO', environment.recordModelIo);
  }
}

export async function verifyProof(fileValue: string) {
  const file = path.resolve(fileValue);
  const report = readJson(file);
  if (report?.protocol !== PROTOCOL) throw new Error('unsupported inventory-gain proof');
  const specification = parseMinecraftInventoryGainSpecification(report.specification);
  const receiptFile = path.resolve(String(report.source?.receiptFile || ''));
  const receipt = readJson(receiptFile) as MinecraftWorldHistoryFork;
  const fork = await verifyMinecraftWorldHistoryFork(receipt);
  const history = receipt.histories.find(
    (candidate) => candidate.historyId === report.source?.historyId,
  );
  const entityRoot = path.resolve(String(report.evidence?.entityRoot || ''));
  const actJournalFile = path.resolve(String(report.evidence?.act?.journalFile || ''));
  const restartJournalFile = path.resolve(String(report.evidence?.restart?.journalFile || ''));
  const actLifecycleFile = path.resolve(String(report.evidence?.act?.lifecycleFile || ''));
  const restartLifecycleFile = path.resolve(String(report.evidence?.restart?.lifecycleFile || ''));
  const actLifecycle = verifyWorldLifecycleJournal(actLifecycleFile);
  const restartLifecycle = verifyWorldLifecycleJournal(restartLifecycleFile);
  const actEvents = readJournal(actJournalFile);
  const restartEvents = readJournal(restartJournalFile);
  const lifeRead = await readEntityLifeRange(report.life, entityRoot);
  const openedEpisode = await openEvaluationEpisode(
    path.dirname(path.resolve(String(report.episode?.file || ''))),
    entityRoot,
    report.episode?.loom,
    'behold-minecraft-inventory-gain-reassessment',
  );
  try {
    const assessment = assessMinecraftInventoryGain({
      specification,
      expected: report.expected,
      actEvents,
      restartEvents,
      life: report.life,
      lifeTurns: lifeRead.turns,
      episodeDefinition: openedEpisode.definition,
    });
    const actConfigured: any = actLifecycle.events.find((event) => event.type === 'run_configured');
    const restartConfigured: any = restartLifecycle.events.find(
      (event) => event.type === 'run_configured',
    );
    const cognitionJournalFile = path.resolve(
      String(report.evidence?.act?.cognitionJournalFile || ''),
    );
    const serverManifest = readJson(
      path.resolve(String(report.source?.serverProfile?.manifestFile || '')),
    );
    const serverProfile = verifyMinecraftHistoryServer(serverManifest as any);
    const assertions = {
      reportStatus: report.status === 'passed',
      receiptIntegrity: sha256File(receiptFile) === report.source?.receiptSha256,
      checkpointIntegrity: fork.checkpointIntegrityOk,
      lineageIntegrity: fork.lineageIntegrityOk && fork.lifecycleIntegrityOk,
      historyBinding:
        history != null &&
        history.initialDigest === report.source?.initialWorld?.digest &&
        receipt.operationId === report.source?.operationId &&
        receipt.checkpoint.artifactId === report.source?.checkpointArtifactId &&
        receipt.checkpoint.digest === report.source?.checkpointDigest,
      serverProfile:
        serverProfile.profileIntegrityOk &&
        serverManifest.historyId === report.source?.historyId &&
        sha256File(serverManifest.manifestFile) === report.source?.serverProfile?.manifestSha256,
      journalIntegrity:
        sha256File(actJournalFile) === report.evidence?.act?.journalSha256 &&
        sha256File(restartJournalFile) === report.evidence?.restart?.journalSha256,
      lifecycleIntegrity:
        sha256File(actLifecycleFile) === report.evidence?.act?.lifecycleSha256 &&
        sha256File(restartLifecycleFile) === report.evidence?.restart?.lifecycleSha256 &&
        actLifecycle.epoch === report.evidence?.act?.lifecycleEpoch &&
        restartLifecycle.epoch === report.evidence?.restart?.lifecycleEpoch &&
        restartLifecycle.epoch === actLifecycle.epoch + 1 &&
        actLifecycle.tipDigest === report.evidence?.act?.lifecycleTipDigest &&
        restartLifecycle.tipDigest === report.evidence?.restart?.lifecycleTipDigest,
      cognitionBudget:
        actConfigured?.data?.population?.maxTotalModelCalls ===
          specification.budgets.providerCalls &&
        report.evidence?.act?.cognitionJournalFile != null &&
        sha256File(cognitionJournalFile) === report.evidence?.act?.cognitionJournalSha256,
      actLifecycleClosed:
        actLifecycle.events.at(-1)?.type === 'control_released' &&
        actConfigured?.data?.population?.residents?.[0]?.paused === false,
      restartLifecycleClosed:
        restartLifecycle.events.at(-1)?.type === 'control_released' &&
        restartConfigured?.data?.population?.residents?.[0]?.paused === true &&
        !restartLifecycle.events.some((event) => event.type === 'cognition_broker_ready'),
      episodeIntegrity:
        sha256File(path.resolve(String(report.episode?.file || ''))) === report.episode?.sha256 &&
        JSON.stringify(openedEpisode.definitionReference) ===
          JSON.stringify(report.episode?.definition),
      assessmentRecomputed:
        JSON.stringify(assessment) === JSON.stringify(report.assessment) &&
        assessment.status === 'passed',
    };
    const failed = Object.entries(assertions)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    return {
      protocol: 'behold.minecraft-inventory-gain-verification.v1' as const,
      status: failed.length === 0 ? ('passed' as const) : ('failed' as const),
      report: file,
      assertions,
      failed,
      assessment,
    };
  } finally {
    openedEpisode.close();
  }
}

function episodeProgress(
  events: readonly any[],
  item: string,
  minimumGain: number,
  maxTurns: number,
) {
  const modelTurns = events.filter((event) => event.type === 'model_turn');
  const entityTurns = events.filter((event) => event.type === 'entity_turn');
  const initialCount = inventoryCount(modelTurns[0]?.data?.observation?.self?.inventory, item);
  const observedCount = Math.max(
    initialCount,
    ...modelTurns.map((event) => inventoryCount(event.data?.observation?.self?.inventory, item)),
    ...entityTurns.map((event) =>
      inventoryCount(event.data?.nextObservation?.self?.inventory, item),
    ),
  );
  const lastTurn = entityTurns.at(-1)?.data;
  if (modelTurns.length > 0 && observedCount >= initialCount + minimumGain) {
    return { terminal: true, reason: 'outcome_observed', initialCount, observedCount };
  }
  if (events.some((event) => event.type === 'model_call_failed')) {
    return { terminal: true, reason: 'model_failure', initialCount, observedCount };
  }
  if (entityTurns.length >= maxTurns) {
    return { terminal: true, reason: 'turn_budget', initialCount, observedCount };
  }
  if (lastTurn && (lastTurn.action == null || lastTurn.action?.name === 'wait_for_event')) {
    return { terminal: true, reason: 'resident_yield', initialCount, observedCount };
  }
  return { terminal: false, reason: 'running', initialCount, observedCount };
}

function parseCli(argv: string[]) {
  const parsed = parseArgs({
    args: argv,
    options: {
      verify: { type: 'string' },
      run: { type: 'string' },
      receipt: { type: 'string' },
      history: { type: 'string' },
      config: { type: 'string' },
      world: { type: 'string' },
      body: { type: 'string' },
      entity: { type: 'string' },
      port: { type: 'string' },
      model: { type: 'string' },
      mind: { type: 'string' },
      item: { type: 'string' },
      gain: { type: 'string' },
      turns: { type: 'string' },
      maxModelCalls: { type: 'string' },
      timeout: { type: 'string' },
    },
    strict: true,
  });
  if (parsed.values.verify) {
    return {
      verify: path.resolve(String(parsed.values.verify)),
      runId: '',
      receipt: '',
      history: '',
      config: '',
      world: '',
      body: '',
      entity: '',
      port: 0,
      model: '',
      mind: 'direct' as const,
      item: '',
      minimumGain: 1,
      turns: 1,
      providerCalls: 1,
      timeoutMs: 30_000,
    };
  }
  const required = (name: keyof typeof parsed.values) => {
    const value = String(parsed.values[name] || '').trim();
    if (!value) throw new Error(`--${String(name)} is required`);
    return value;
  };
  const mind = String(parsed.values.mind || 'direct');
  if (mind !== 'direct' && mind !== 'ax') throw new Error('--mind must be direct or ax');
  const port = Number(parsed.values.port || 25_641);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('--port must be an integer from 1024 through 65535');
  }
  const timeoutMs = Number(parsed.values.timeout || 240) * 1_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
    throw new Error('--timeout must be 30 through 900 seconds');
  }
  const entity = required('entity');
  const body = required('body');
  if (!/^[A-Za-z0-9_]{1,16}$/.test(entity) || !/^[A-Za-z0-9_]{1,16}$/.test(body)) {
    throw new Error('--entity and --body must be Minecraft-safe identities');
  }
  return {
    verify: null,
    runId: required('run'),
    receipt: required('receipt'),
    history: required('history'),
    config: required('config'),
    world: required('world'),
    body,
    entity,
    port,
    model: required('model'),
    mind: mind as 'direct' | 'ax',
    item: String(parsed.values.item || 'oak_log'),
    minimumGain: Number(parsed.values.gain || 1),
    turns: Number(parsed.values.turns || 6),
    providerCalls: Number(parsed.values.maxModelCalls || 18),
    timeoutMs,
  };
}

function readJournal(file: string) {
  return parseRunJournal(fs.readFileSync(file, 'utf8'));
}

function processOutput() {
  return {
    stdout: (text: string) => process.stdout.write(text),
    stderr: (text: string) => process.stderr.write(text),
  };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
