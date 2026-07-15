#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  minecraftHistoryWorldDefinition,
  prepareMinecraftHistoryServer,
  verifyMinecraftHistoryServer,
  verifyMinecraftWorldHistoryFork,
  type MinecraftHistoryRecord,
  type MinecraftHistoryServer,
  type MinecraftWorldHistoryFork,
} from '../src/runtime/world-history';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import {
  assertCleanRepository,
  durableWriteJson,
  gitRevision,
  readJson,
  sha256File,
  waitFor,
} from './owned-world-fixture';
import { parseRunJournal } from './owned-world-model-evidence';
import { waitForRunJournal } from './owned-world-model-harness';
import { digestTree, loadWorldLabConfig } from './world-lab';
import { bundledJava, startManagedWorld, type ManagedWorldRun } from './world-runner';

const PROTOCOL = 'behold.world-history-inhabitation-proof.v1' as const;

type BranchRequest = Readonly<{
  historyId: string;
  lifeId: string;
  mind: 'direct' | 'ax';
  port: number;
}>;

async function main(argv = process.argv.slice(2)) {
  const args = parseCli(argv);
  if (args.verify) {
    const verification = await verifyProof(path.resolve(args.verify));
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    if (verification.status !== 'passed') process.exitCode = 1;
    return;
  }
  assertCleanRepository();
  const receiptFile = path.resolve(args.receipt);
  const receipt = readJson(receiptFile) as MinecraftWorldHistoryFork;
  const config = loadWorldLabConfig(path.resolve(args.config));
  const parent = config.worlds[args.worldId];
  if (!parent) throw new Error(`unknown parent world ${args.worldId}`);
  if (receipt.worldId !== args.worldId) throw new Error('fork receipt belongs to another world');
  const initialForkVerification = await verifyMinecraftWorldHistoryFork(receipt);
  if (
    !initialForkVerification.checkpointIntegrityOk ||
    !initialForkVerification.lineageIntegrityOk ||
    !initialForkVerification.lifecycleIntegrityOk
  ) {
    throw new Error('world-history fork failed pre-run verification');
  }

  const outputFile = path.resolve(args.output);
  if (fs.existsSync(outputFile)) throw new Error(`proof output already exists: ${outputFile}`);
  const evidenceRoot = path.dirname(outputFile);
  fs.mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  const toolLock = readJson(path.resolve('docs/sf-world/tool-lock.json'));
  const serverJar = path.resolve(String(toolLock.tools.minecraftServer.path));
  const expectedServerJarSha256 = String(toolLock.tools.minecraftServer.sha256);
  if (sha256File(serverJar) !== expectedServerJarSha256) {
    throw new Error('pinned Minecraft server JAR differs from the tool lock');
  }
  const templateServerDirectory = path.dirname(parent.runtime.worldPath);
  const branches = [];
  for (const request of args.branches) {
    const history = requiredHistory(receipt, request.historyId);
    branches.push(
      await runBranch({
        request,
        history,
        receipt,
        parent,
        bodyUsername: args.bodyUsername,
        templateServerDirectory,
        serverJar,
        expectedServerJarSha256,
        evidenceRoot,
      }),
    );
  }
  const generatedAt = new Date().toISOString();
  durableWriteJson(outputFile, {
    protocol: PROTOCOL,
    status: 'pending_verification',
    generatedAt,
    repository: { revision: gitRevision() },
    source: {
      receiptFile,
      receiptSha256: sha256File(receiptFile),
      operationId: receipt.operationId,
      parentWorldId: receipt.worldId,
      checkpointArtifactId: receipt.checkpoint.artifactId,
      checkpointDigest: receipt.checkpoint.digest,
      checkpointPath: receipt.checkpoint.artifactPath,
    },
    server: {
      version: String(toolLock.tools.minecraftServer.version),
      jar: serverJar,
      sha256: expectedServerJarSha256,
    },
    comparison: {
      bodyUsername: args.bodyUsername,
      semantics:
        'Two branch-local evaluation lives inhabit the same saved Minecraft body in isolated sibling world histories. No private resident Lync was copied.',
    },
    branches,
  });
  const firstVerification = await verifyProof(outputFile);
  const finalized = { ...readJson(outputFile), status: firstVerification.status };
  fs.unlinkSync(outputFile);
  durableWriteJson(outputFile, finalized);
  const verification = await verifyProof(outputFile);
  process.stdout.write(`${JSON.stringify({ report: outputFile, verification }, null, 2)}\n`);
  if (verification.status !== 'passed') {
    throw new Error(`world-history inhabitation proof failed: ${verification.failed.join(', ')}`);
  }
}

async function runBranch(input: {
  request: BranchRequest;
  history: MinecraftHistoryRecord;
  receipt: MinecraftWorldHistoryFork;
  parent: ReturnType<typeof loadWorldLabConfig>['worlds'][string];
  bodyUsername: string;
  templateServerDirectory: string;
  serverJar: string;
  expectedServerJarSha256: string;
  evidenceRoot: string;
}) {
  const server = prepareMinecraftHistoryServer({
    history: input.history,
    templateServerDirectory: input.templateServerDirectory,
    port: input.request.port,
  });
  const worldId = input.history.historyId;
  const world = minecraftHistoryWorldDefinition(
    input.parent,
    input.receipt.checkpoint,
    input.history,
    input.request.port,
  );
  const branchRoot = path.join(input.evidenceRoot, input.history.historyId);
  const entityRoot = path.join(input.evidenceRoot, 'entities');
  const runRoot = path.join(branchRoot, 'runs');
  fs.mkdirSync(branchRoot, { recursive: true, mode: 0o700 });
  const beforeWorld = digestTree(input.history.worldPath);
  if (beforeWorld.digest !== input.history.initialDigest) {
    throw new Error(`${worldId} diverged before its first inhabitation`);
  }
  let run: ManagedWorldRun | null = null;
  try {
    run = await startManagedWorld({
      worldId,
      world,
      controlRoot: path.resolve('.behold-runtime/world-control'),
      serverDirectory: server.serverDirectory,
      serverJar: input.serverJar,
      expectedServerJarSha256: input.expectedServerJarSha256,
      java: bundledJava(),
      controllerEntry: path.resolve('dist/src/cli/behold.js'),
      entityRoot,
      runRoot,
      residents: [
        {
          entityId: input.request.lifeId,
          bodyUsername: input.bodyUsername,
          model: 'none/paused-world-history-proof-v1',
          mind: input.request.mind,
          paused: true,
          tickMs: 1_000,
        },
      ],
      maxResidents: 1,
      startupTimeoutMs: 90_000,
      shutdownTimeoutMs: 90_000,
    });
    if (run.cognition) throw new Error('a paused inhabitation unexpectedly started cognition');
    const journalFile = await waitForRunJournal(run.residents[0].journalDirectory, 30_000);
    await waitFor(
      () =>
        parseRunJournal(fs.readFileSync(journalFile, 'utf8')).some(
          (event) => event.type === 'local_world_ready',
        ),
      45_000,
      `${worldId} local-world observation`,
    );
    await run.stop('world_history_inhabitation_observed');
    await run.finished;
    const events = parseRunJournal(fs.readFileSync(journalFile, 'utf8'));
    const runStarted = requiredEvent(events, 'run_started');
    const ready = requiredEvent(events, 'local_world_ready');
    requiredEvent(events, 'run_stopped');
    const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
    const afterWorld = digestTree(input.history.worldPath);
    const loomFile = path.resolve(String(runStarted.data?.entityLoom || ''));
    if (!fs.existsSync(loomFile)) throw new Error(`${input.request.lifeId} has no Lync file`);
    const serverVerification = verifyMinecraftHistoryServer(server);
    return {
      historyId: input.history.historyId,
      worldId,
      lifeId: input.request.lifeId,
      mindLabel: input.request.mind,
      bodyUsername: input.bodyUsername,
      initialWorldDigest: beforeWorld.digest,
      observedWorldDigest: afterWorld.digest,
      worldDivergedDuringAdmission: afterWorld.digest !== beforeWorld.digest,
      runId: run.runId,
      observation: {
        protocol: ready.data?.protocol,
        circleId: ready.data?.circle?.id,
        lifeId: ready.data?.self?.identity,
        body: ready.data?.self?.body,
        position: ready.data?.self?.pose?.position,
        condition: ready.data?.self?.condition,
        inventory: ready.data?.self?.inventory,
      },
      continuity: {
        priorEntityTurns: runStarted.data?.priorEntityTurns,
        loomFile,
        loomSha256AtAdmission: sha256File(loomFile),
      },
      serverProfile: {
        manifestFile: server.manifestFile,
        manifestSha256: sha256File(server.manifestFile),
        verification: serverVerification,
      },
      journal: { file: journalFile, sha256: sha256File(journalFile) },
      lifecycle: {
        file: run.control.journalFile,
        sha256: sha256File(run.control.journalFile),
        epoch: lifecycle.epoch,
        tipDigest: lifecycle.tipDigest,
      },
    };
  } catch (error) {
    if (run) await run.stop('world_history_inhabitation_failed').catch(() => {});
    throw error;
  }
}

export async function verifyProof(fileValue: string) {
  const file = path.resolve(fileValue);
  const report = readJson(file);
  if (report?.protocol !== PROTOCOL || !Array.isArray(report.branches)) {
    throw new Error('unsupported world-history inhabitation proof');
  }
  const receiptFile = path.resolve(String(report.source?.receiptFile || ''));
  const receipt = readJson(receiptFile) as MinecraftWorldHistoryFork;
  const assertions: Record<string, boolean> = {};
  assertions.receiptIntegrity = sha256File(receiptFile) === report.source?.receiptSha256;
  const fork = await verifyMinecraftWorldHistoryFork(receipt);
  assertions.checkpointIntegrity = fork.checkpointIntegrityOk;
  assertions.worldLineageIntegrity = fork.lineageIntegrityOk && fork.lifecycleIntegrityOk;
  assertions.sameCheckpoint = report.branches.every(
    (branch: any) => branch.initialWorldDigest === receipt.checkpoint.digest,
  );
  const lives = new Set<string>();
  const worlds = new Set<string>();
  const looms = new Set<string>();
  const bodyUuids = new Set<string>();
  for (const branch of report.branches) {
    const key = String(branch.historyId);
    const history = requiredHistory(receipt, key);
    lives.add(String(branch.lifeId));
    worlds.add(String(branch.worldId));
    looms.add(path.resolve(String(branch.continuity?.loomFile || '')));
    const bodyUuid = String(branch.observation?.body?.uuid || '');
    if (bodyUuid) bodyUuids.add(bodyUuid);
    const journalFile = path.resolve(String(branch.journal?.file || ''));
    const events = parseRunJournal(fs.readFileSync(journalFile, 'utf8'));
    const runStarted = events.find((event) => event.type === 'run_started');
    const ready = events.find((event) => event.type === 'local_world_ready');
    const stopped = events.find((event) => event.type === 'run_stopped');
    const lifecycleFile = path.resolve(String(branch.lifecycle?.file || ''));
    const lifecycle = verifyWorldLifecycleJournal(lifecycleFile);
    const configured: any = lifecycle.events.find((event) => event.type === 'run_configured');
    const configuredResident = configured?.data?.population?.residents?.[0];
    const serverManifest = readJson(path.resolve(String(branch.serverProfile?.manifestFile || '')));
    const serverVerification = verifyMinecraftHistoryServer(
      serverManifest as MinecraftHistoryServer,
    );
    assertions[`${key}.historyBinding`] =
      history.historyId === branch.historyId &&
      history.initialDigest === branch.initialWorldDigest &&
      branch.worldId === history.historyId;
    assertions[`${key}.artifactIntegrity`] =
      sha256File(journalFile) === branch.journal?.sha256 &&
      sha256File(lifecycleFile) === branch.lifecycle?.sha256 &&
      sha256File(serverManifest.manifestFile) === branch.serverProfile?.manifestSha256;
    assertions[`${key}.lifeAdmission`] =
      runStarted?.agent === branch.lifeId &&
      runStarted?.data?.priorEntityTurns === 0 &&
      ready?.data?.self?.identity === branch.lifeId &&
      ready?.data?.circle?.id === branch.worldId &&
      stopped != null;
    assertions[`${key}.bodyAdmission`] =
      ready?.data?.self?.body?.username === report.comparison?.bodyUsername &&
      typeof ready?.data?.self?.body?.uuid === 'string' &&
      ready.data.self.body.uuid.length > 0;
    assertions[`${key}.controllerBinding`] =
      configured?.data?.runId === branch.runId &&
      configured?.data?.world?.id === branch.worldId &&
      configuredResident?.entityId === branch.lifeId &&
      configuredResident?.bodyUsername === report.comparison?.bodyUsername &&
      configuredResident?.paused === true &&
      !lifecycle.events.some((event) => event.type === 'cognition_broker_ready') &&
      !events.some((event) => event.type === 'model_turn');
    assertions[`${key}.lifecycleClosed`] =
      lifecycle.world === branch.worldId &&
      lifecycle.epoch === branch.lifecycle?.epoch &&
      lifecycle.tipDigest === branch.lifecycle?.tipDigest &&
      lifecycle.events.some((event) => event.type === 'run_ready') &&
      lifecycle.events.some((event) => event.type === 'run_stopped') &&
      lifecycle.events.at(-1)?.type === 'control_released';
    assertions[`${key}.serverProfile`] =
      serverVerification.profileIntegrityOk && serverManifest.historyId === branch.historyId;
  }
  assertions.distinctLives = lives.size === report.branches.length;
  assertions.distinctWorlds = worlds.size === report.branches.length;
  assertions.distinctPrivateLooms = looms.size === report.branches.length;
  assertions.sameNativeBody = bodyUuids.size === 1 && bodyUuids.size > 0;
  const bodyUuid = [...bodyUuids][0];
  assertions.savedBodyPresentAtCheckpoint =
    Boolean(bodyUuid) &&
    fs.existsSync(path.join(receipt.checkpoint.artifactPath, 'playerdata', `${bodyUuid}.dat`));
  assertions.pinnedServer =
    sha256File(path.resolve(String(report.server?.jar || ''))) === report.server?.sha256;
  const failed = Object.entries(assertions)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return {
    protocol: PROTOCOL,
    status: failed.length === 0 ? ('passed' as const) : ('failed' as const),
    report: file,
    assertions,
    failed,
    currentBranches: fork.histories,
  };
}

function requiredHistory(receipt: MinecraftWorldHistoryFork, historyId: string) {
  const history = receipt.histories.find((candidate) => candidate.historyId === historyId);
  if (!history) throw new Error(`fork receipt has no history ${historyId}`);
  return history;
}

function requiredEvent(events: readonly any[], type: string) {
  const event = events.find((candidate) => candidate.type === type);
  if (!event) throw new Error(`resident journal has no ${type} event`);
  return event;
}

function parseCli(argv: string[]) {
  const parsed = parseArgs({
    args: argv,
    options: {
      verify: { type: 'string' },
      receipt: { type: 'string' },
      config: { type: 'string' },
      world: { type: 'string' },
      history: { type: 'string', multiple: true },
      life: { type: 'string', multiple: true },
      mind: { type: 'string', multiple: true },
      port: { type: 'string', multiple: true },
      body: { type: 'string' },
      output: { type: 'string' },
    },
  });
  if (parsed.values.verify) return { verify: String(parsed.values.verify) } as const;
  const required = (name: keyof typeof parsed.values) => {
    const value = parsed.values[name];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`--${name} is required`);
    return value.trim();
  };
  const histories = parsed.values.history ?? [];
  const lives = parsed.values.life ?? [];
  const minds = parsed.values.mind ?? [];
  const ports = parsed.values.port ?? [];
  if (histories.length !== 2 || lives.length !== 2 || minds.length !== 2 || ports.length !== 2) {
    throw new Error('repeat --history, --life, --mind, and --port exactly twice');
  }
  const bodyUsername = required('body');
  if (!/^[A-Za-z0-9_]{1,16}$/.test(bodyUsername)) {
    throw new Error('--body must be a valid offline Minecraft username');
  }
  const branches = histories.map((historyId, index) => {
    const mind = minds[index];
    if (mind !== 'direct' && mind !== 'ax') throw new Error('--mind must be direct or ax');
    const port = Number(ports[index]);
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
      throw new Error('--port must be an integer from 1024 through 65535');
    }
    return { historyId, lifeId: lives[index], mind, port } satisfies BranchRequest;
  });
  return {
    verify: null,
    receipt: required('receipt'),
    config: required('config'),
    worldId: required('world'),
    bodyUsername,
    output: required('output'),
    branches,
  } as const;
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(
      `[world-history-inhabitation] ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
