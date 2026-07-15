import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readEntityLifeRange, resolveEntityLifeRange } from '../src/entity/loom';
import {
  assessDecisionTurn,
  assessUncoachedDecisionTurn,
  assessWorldActionTurn,
} from '../src/evaluation/causal-turn';
import { createWorldActionRecord } from '../src/evaluation/behold-action-record';
import { createEvaluationEpisode } from '../src/evaluation/episode';
import { createResidentMindRequestArtifact } from '../src/mind/request-artifact';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import {
  minecraftHistoryWorldDefinition,
  prepareMinecraftHistoryServer,
  verifyMinecraftWorldHistoryFork,
  type MinecraftWorldHistoryFork,
} from '../src/runtime/world-history';
import { decisionMatchesEntityTurn, parseRunJournal } from './owned-world-model-evidence';
import {
  assertCleanRepository,
  durableWriteJson,
  gitRevision,
  prepareOwnedWorld,
  readJson,
  restoreEnvironment,
  sha256File,
  waitFor,
} from './owned-world-fixture';
import { waitForRunJournal } from './owned-world-model-harness';
import { digestTree, loadWorldLabConfig } from './world-lab';
import { bundledJava, startManagedWorld, type ManagedWorldRun } from './world-runner';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required');
  assertCleanRepository();
  const priorUmask = process.umask(0o077);
  let fixture: Awaited<ReturnType<typeof prepareOwnedWorld>> | HistoryTurnFixture;
  try {
    fixture = args.historyReceipt
      ? await prepareHistoryTurnFixture(args)
      : await prepareOwnedWorld(args.runId, args.port, 'neutral-turn');
  } catch (error) {
    process.umask(priorUmask);
    throw error;
  }
  const historyContext = 'historyContext' in fixture ? fixture.historyContext : null;
  const runRoot = path.join(fixture.evidenceRoot, 'runs');
  const priorRecordModelIo = process.env.BEHOLD_RECORD_MODEL_IO;
  process.env.BEHOLD_RECORD_MODEL_IO = '1';
  let run: ManagedWorldRun | null = null;
  let episode: Awaited<ReturnType<typeof createEvaluationEpisode>> | null = null;
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
        controllerEntry: path.resolve('dist/src/cli/behold.js'),
        entityRoot: fixture.entityRoot,
        runRoot,
        residents: [
          {
            entityId: args.entityId,
            ...(args.bodyUsername ? { bodyUsername: args.bodyUsername } : {}),
            model: args.model,
            mind: args.mind,
            policyProfile: 'neutral-benchmark-v1',
            actionProfile: 'minecraft-player-v1',
            safetyProfile: 'vanilla-player-v1',
            tickMs: 1_000,
            maxTurnSteps: 1,
            resumeAfterBudget: false,
          },
        ],
        maxResidents: 1,
        maxConcurrentModelCalls: 1,
        maxTotalModelCalls: args.maxModelCalls,
        startupTimeoutMs: 90_000,
        shutdownTimeoutMs: 90_000,
      },
      {
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
      },
    );
    const journalFile = await waitForRunJournal(run.residents[0].journalDirectory, 30_000);
    let events = parseRunJournal(fs.readFileSync(journalFile, 'utf8'));
    let selected: ReturnType<typeof selectTurn> = null;
    const wait = new AbortController();
    try {
      await Promise.race([
        waitFor(
          () => {
            events = parseRunJournal(fs.readFileSync(journalFile, 'utf8'));
            const failure = events.find((event) => event.type === 'model_call_failed');
            if (failure) {
              throw new Error(`resident model call failed: ${failure.data?.error || 'unknown'}`);
            }
            selected = selectTurn(events, args.claim);
            return selected != null;
          },
          args.timeoutMs,
          args.claim === 'decision'
            ? 'one neutral recorded decision turn'
            : 'one neutral world-action turn',
          wait.signal,
        ),
        run.finished.then(() => {
          throw new Error(`managed world stopped before a ${args.claim} turn was recorded`);
        }),
      ]);
    } finally {
      wait.abort();
    }
    await run.quiesceResidents(`neutral_${args.claim}_turn_recorded`);
    await run.stop(`neutral_${args.claim}_turn_complete`);
    await run.finished;
    events = parseRunJournal(fs.readFileSync(journalFile, 'utf8'));
    selected = selectTurn(events, args.claim);
    if (!selected) throw new Error('selected turn disappeared after managed shutdown');

    const life = await resolveEntityLifeRange(
      args.entityId,
      selected.entityTurn.data.sequence,
      selected.entityTurn.data.sequence,
      fixture.entityRoot,
    );
    const specificationSha256 = sha256(
      suiteSpecification(args.claim, args.maxModelCalls, historyContext),
    );
    episode = await createEvaluationEpisode(
      path.join(fixture.evidenceRoot, 'evaluation-episodes'),
      fixture.entityRoot,
      {
        protocol: 'behold.evaluation-episode.v1',
        suite: {
          id: args.claim === 'decision' ? 'neutral-decision-turn' : 'neutral-world-action-turn',
          version: '4',
          caseId: args.claim === 'decision' ? 'first-free-decision' : 'first-free-world-action',
          specificationSha256,
        },
        life,
      },
      'behold-neutral-turn-evaluator',
    );
    const lifeRead = await readEntityLifeRange(life, fixture.entityRoot);
    if (lifeRead.turns.length !== 1) throw new Error('turn proof expected one exact life turn');
    const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
    const runStarted = events.find((event) => event.type === 'run_started');
    if (!runStarted) throw new Error('resident journal has no run_started event');
    const assessmentInput = {
      expected: {
        worldId: fixture.worldId,
        managedRunId: run.runId,
        entityId: args.entityId,
        policyProfile: 'neutral-benchmark-v1',
        actionProfile: 'minecraft-player-v1',
        safetyProfile: 'vanilla-player-v1',
      },
      runStarted,
      modelTurn: selected.modelTurn,
      entityTurn: selected.entityTurn,
      life,
      lifeTurn: lifeRead.turns[0],
      episode,
      lifecycle,
      runJournalSha256: sha256File(journalFile),
      worldLifecycleSha256: sha256File(run.control.journalFile),
    } as const;
    const decisionAssessment = assessDecisionTurn(assessmentInput);
    const uncoachedDecisionAssessment = assessUncoachedDecisionTurn(assessmentInput);
    const worldActionAssessment = assessWorldActionTurn(assessmentInput);
    const selectedAssessment =
      args.claim === 'decision' ? uncoachedDecisionAssessment : worldActionAssessment;
    const requestArtifact = createResidentMindRequestArtifact(
      selected.modelTurn.data.call.request.mindRequest,
    );
    const requestFile = path.join(fixture.evidenceRoot, 'mind-request.json');
    const generatedAt = new Date().toISOString();
    const repositoryRevision = gitRevision();
    const actionRecordAssessment = createWorldActionRecord(assessmentInput, {
      assessedAt: generatedAt,
      checkerRevision: repositoryRevision,
      refs: {
        runJournal: journalFile,
        worldLifecycle: run.control.journalFile,
        mindRequest: requestFile,
        lifeTurn: `lync://${life.life.loomId}/turn/${life.end.turnId}`,
      },
    });
    durableWriteJson(requestFile, requestArtifact);
    const resultFile = path.join(fixture.evidenceRoot, 'turn-result.json');
    durableWriteJson(resultFile, {
      protocol: 'behold.neutral-turn-proof.v4',
      generatedAt,
      repository: { revision: repositoryRevision },
      claim: args.claim,
      cognition: {
        providerCallAdmissionLimit: args.maxModelCalls,
        decisionAdmissions: selected.modelTurn.data.call.admissions?.length ?? 0,
      },
      history: historyContext
        ? {
            ...historyContext,
            afterTurnWorld: digestTree(fixture.runtime),
          }
        : null,
      suite: { specificationSha256 },
      decisionAssessment,
      uncoachedDecisionAssessment,
      worldActionAssessment,
      actionRecordAssessment,
      evidence: {
        root: fixture.root,
        journalFile,
        lifecycleFile: run.control.journalFile,
        episodeFile: episode.file,
        requestFile,
      },
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          claim: args.claim,
          providerCallAdmissionLimit: args.maxModelCalls,
          decisionAdmissions: selected.modelTurn.data.call.admissions?.length ?? 0,
          proof: selectedAssessment.status,
          failed: selectedAssessment.failed,
          decisionBinding: uncoachedDecisionAssessment.binding,
          worldActionBinding: worldActionAssessment.binding,
          actionRecordBinding: actionRecordAssessment.binding,
          evidence: resultFile,
        },
        null,
        2,
      )}\n`,
    );
    if (selectedAssessment.status !== 'passed') {
      throw new Error(
        `neutral ${args.claim} turn ${selectedAssessment.status}: ${[
          ...selectedAssessment.failed,
          ...('notExercised' in selectedAssessment ? selectedAssessment.notExercised : []),
        ].join(', ')}`,
      );
    }
    if (args.claim === 'world-action' && actionRecordAssessment.status !== 'passed') {
      throw new Error(
        `neutral world-action record ${actionRecordAssessment.status}: ${[
          ...actionRecordAssessment.failed,
          ...actionRecordAssessment.notExercised,
        ].join(', ')}`,
      );
    }
  } catch (error) {
    if (run) await run.stop(`neutral_${args.claim}_turn_failed`).catch(() => {});
    throw error;
  } finally {
    episode?.close();
    restoreEnvironment('BEHOLD_RECORD_MODEL_IO', priorRecordModelIo);
    process.umask(priorUmask);
  }
}

function selectTurn(events: readonly any[], claim: 'decision' | 'world-action') {
  for (const entityTurn of events.filter((event) => event.type === 'entity_turn')) {
    if (claim === 'world-action' && entityTurn.data?.action?.kind === 'yield') continue;
    const modelTurn = events.find(
      (event) =>
        event.type === 'model_turn' &&
        decisionMatchesEntityTurn(event.data, entityTurn.data) &&
        event.data?.call?.request?.mindRequest != null,
    );
    if (modelTurn) return { modelTurn, entityTurn };
  }
  return null;
}

function parseArgs(argv: string[]) {
  let runId = '';
  let port = 25_641;
  let entityId = 'CausalWren';
  let model = 'google/gemini-3.5-flash';
  let mind: 'direct' | 'ax' = 'ax';
  let claim: 'decision' | 'world-action' = 'world-action';
  let timeoutMs = 120_000;
  let requestedMaxModelCalls: number | null = null;
  let historyReceipt = '';
  let historyId = '';
  let parentConfig = '';
  let parentWorld = '';
  let bodyUsername = '';
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--runId') runId = String(argv[++index] || '');
    else if (argv[index] === '--port') port = Number(argv[++index]);
    else if (argv[index] === '--entity') entityId = String(argv[++index] || '');
    else if (argv[index] === '--model') model = String(argv[++index] || '');
    else if (argv[index] === '--mind') {
      const value = String(argv[++index] || '');
      if (value !== 'direct' && value !== 'ax') throw new Error('--mind must be direct or ax');
      mind = value;
    } else if (argv[index] === '--timeoutMs') timeoutMs = Number(argv[++index]);
    else if (argv[index] === '--maxModelCalls') {
      requestedMaxModelCalls = Number(argv[++index]);
    } else if (argv[index] === '--historyReceipt') historyReceipt = String(argv[++index] || '');
    else if (argv[index] === '--history') historyId = String(argv[++index] || '');
    else if (argv[index] === '--parentConfig') parentConfig = String(argv[++index] || '');
    else if (argv[index] === '--parentWorld') parentWorld = String(argv[++index] || '');
    else if (argv[index] === '--body') bodyUsername = String(argv[++index] || '');
    else if (argv[index] === '--claim') {
      const value = String(argv[++index] || '');
      if (value !== 'decision' && value !== 'world-action') {
        throw new Error('--claim must be decision or world-action');
      }
      claim = value;
    } else throw new Error(`Unknown argument ${argv[index]}`);
  }
  if (!runId) throw new Error('--runId is required');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('--port must be an integer from 1024 through 65535');
  }
  if (!/^[A-Za-z0-9_]{1,16}$/.test(entityId)) {
    throw new Error('--entity must be 1-16 Minecraft-safe characters');
  }
  if (!model.trim()) throw new Error('--model is required');
  const historyValues = [historyReceipt, historyId, parentConfig, parentWorld, bodyUsername];
  if (historyValues.some(Boolean) && !historyValues.every(Boolean)) {
    throw new Error(
      'history mode requires --historyReceipt, --history, --parentConfig, --parentWorld, and --body together',
    );
  }
  if (bodyUsername && !/^[A-Za-z0-9_]{1,16}$/.test(bodyUsername)) {
    throw new Error('--body must be 1-16 Minecraft-safe characters');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 600_000) {
    throw new Error('--timeoutMs must be an integer from 30000 through 600000');
  }
  const maxModelCalls =
    requestedMaxModelCalls ?? (claim === 'decision' ? (mind === 'ax' ? 3 : 1) : 4);
  if (!Number.isSafeInteger(maxModelCalls) || maxModelCalls < 1 || maxModelCalls > 32) {
    throw new Error('--maxModelCalls must be an integer from 1 through 32');
  }
  return {
    runId,
    port,
    entityId,
    model,
    mind,
    claim,
    timeoutMs,
    maxModelCalls,
    historyReceipt: historyReceipt || null,
    historyId: historyId || null,
    parentConfig: parentConfig || null,
    parentWorld: parentWorld || null,
    bodyUsername: bodyUsername || null,
  };
}

function suiteSpecification(
  claim: 'decision' | 'world-action',
  maxModelCalls: number,
  history: HistoryTurnFixture['historyContext'] | null,
) {
  return [
    'neutral-turn-v4',
    `Claim: ${claim}`,
    `Provider-call admission limit: ${maxModelCalls}`,
    ...(history
      ? [
          `World history: ${history.historyId}`,
          `Checkpoint: ${history.checkpointArtifactId}`,
          `Initial world digest: ${history.initialWorld.digest}`,
        ]
      : []),
    'Start one disposable authoritative Minecraft epoch from a verified baseline.',
    'Admit one untasked resident with neutral-benchmark-v1, minecraft-player-v1, and vanilla-player-v1.',
    claim === 'decision'
      ? 'Record the first freely selected admitted decision, including an explicit yield.'
      : 'Wait for the first freely selected world action without turning action into a prompt requirement.',
    'Close the life, authenticate the exact Lync turn, and create a separate evaluator episode reference.',
    'Report decision-boundary and world-action verdicts separately.',
    'Project a passed world action into distinct observation, proposal, authentic permission, execution, and structural-check records without fabricating a world fact.',
  ].join('\n');
}

type HistoryTurnFixture = Awaited<ReturnType<typeof prepareHistoryTurnFixture>>;

async function prepareHistoryTurnFixture(args: ReturnType<typeof parseArgs>) {
  const receiptFile = path.resolve(String(args.historyReceipt));
  const receipt = readJson(receiptFile) as MinecraftWorldHistoryFork;
  const verification = await verifyMinecraftWorldHistoryFork(receipt);
  if (
    !verification.checkpointIntegrityOk ||
    !verification.lineageIntegrityOk ||
    !verification.lifecycleIntegrityOk
  ) {
    throw new Error('history receipt failed checkpoint or lineage verification');
  }
  const history = receipt.histories.find((candidate) => candidate.historyId === args.historyId);
  if (!history) throw new Error(`history receipt has no child ${args.historyId}`);
  const initialWorld = digestTree(history.worldPath);
  if (initialWorld.digest !== history.initialDigest) {
    throw new Error('history child already diverged before its neutral turn');
  }
  const parentConfig = loadWorldLabConfig(path.resolve(String(args.parentConfig)));
  const parent = parentConfig.worlds[String(args.parentWorld)];
  if (!parent) throw new Error(`unknown parent world ${args.parentWorld}`);
  if (receipt.worldId !== args.parentWorld) {
    throw new Error('history receipt and parent world differ');
  }
  const templateServerDirectory = path.dirname(parent.runtime.worldPath);
  const serverProfile = prepareMinecraftHistoryServer({
    history,
    templateServerDirectory,
    port: args.port,
  });
  const world = minecraftHistoryWorldDefinition(parent, receipt.checkpoint, history, args.port);
  const root = path.resolve('.behold-runtime', 'world-histories', 'evidence', args.runId);
  if (fs.existsSync(root)) throw new Error(`history turn proof already exists: ${root}`);
  const evidenceRoot = path.join(root, 'evidence');
  const entityRoot = path.join(root, 'entities');
  const controlRoot = path.join(root, 'control');
  for (const directory of [evidenceRoot, entityRoot, controlRoot]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }
  const toolLock = readJson(path.resolve('docs/sf-world/tool-lock.json'));
  const serverJar = path.resolve(String(toolLock.tools.minecraftServer.path));
  const expectedServerJarSha256 = String(toolLock.tools.minecraftServer.sha256);
  if (sha256File(serverJar) !== expectedServerJarSha256) {
    throw new Error('pinned Minecraft server JAR differs from the tool lock');
  }
  return {
    worldId: history.historyId,
    runId: args.runId,
    port: args.port,
    repository: process.cwd(),
    root,
    serverDirectory: serverProfile.serverDirectory,
    runtime: history.worldPath,
    entityRoot,
    controlRoot,
    evidenceRoot,
    serverJar,
    expectedServerJarSha256,
    java: bundledJava(),
    world,
    historyContext: {
      receiptFile,
      receiptSha256: sha256File(receiptFile),
      operationId: receipt.operationId,
      historyId: history.historyId,
      checkpointArtifactId: receipt.checkpoint.artifactId,
      checkpointDigest: receipt.checkpoint.digest,
      initialWorld,
      serverProfile: {
        manifestFile: serverProfile.manifestFile,
        manifestSha256: sha256File(serverProfile.manifestFile),
      },
      bodyUsername: args.bodyUsername!,
      copySemantics: 'branch-local evaluation life with no inherited private Lync' as const,
    },
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
