import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readEntityLifeRange, resolveEntityLifeRange } from '../src/entity/loom';
import { assessCausalTurn } from '../src/evaluation/causal-turn';
import { createEvaluationEpisode } from '../src/evaluation/episode';
import { createResidentMindRequestArtifact } from '../src/mind/request-artifact';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';
import { parseRunJournal } from './owned-world-model-evidence';
import { prepareOwnedWorld, restoreEnvironment, sha256File, waitFor } from './owned-world-fixture';
import { waitForRunJournal } from './owned-world-model-harness';
import { startManagedWorld, type ManagedWorldRun } from './world-runner';

const SUITE_SPECIFICATION = [
  'neutral-causal-turn-v1',
  'Start one disposable authoritative Minecraft epoch from a verified baseline.',
  'Admit one untasked resident with neutral-benchmark-v1, minecraft-player-v1, and vanilla-player-v1.',
  'Let its configured mind freely select one non-yield admitted action.',
  'Require one terminal world lifecycle result and the exact matching event in a fresh inhabitant observation.',
  'Close the life, authenticate the exact Lync turn, and create a separate evaluator episode reference.',
].join('\n');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required');
  const fixture = await prepareOwnedWorld(args.runId, args.port, 'neutral-causal-turn');
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
            model: args.model,
            mind: args.mind,
            policyProfile: 'neutral-benchmark-v1',
            actionProfile: 'minecraft-player-v1',
            safetyProfile: 'vanilla-player-v1',
            tickMs: 1_000,
          },
        ],
        maxResidents: 1,
        maxConcurrentModelCalls: 1,
        maxTotalModelCalls: 4,
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
    let selected: ReturnType<typeof selectCausalTurn> = null;
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
            selected = selectCausalTurn(events);
            return selected != null;
          },
          args.timeoutMs,
          'one neutral causal entity turn',
          wait.signal,
        ),
        run.finished.then(() => {
          throw new Error('managed world stopped before a causal turn was recorded');
        }),
      ]);
    } finally {
      wait.abort();
    }
    await run.quiesceResidents('neutral_causal_turn_recorded');
    await run.stop('neutral_causal_turn_complete');
    await run.finished;
    events = parseRunJournal(fs.readFileSync(journalFile, 'utf8'));
    selected = selectCausalTurn(events);
    if (!selected) throw new Error('selected causal turn disappeared after managed shutdown');

    const life = await resolveEntityLifeRange(
      args.entityId,
      selected.entityTurn.data.sequence,
      selected.entityTurn.data.sequence,
      fixture.entityRoot,
    );
    const specificationSha256 = sha256(SUITE_SPECIFICATION);
    episode = await createEvaluationEpisode(
      path.join(fixture.evidenceRoot, 'evaluation-episodes'),
      fixture.entityRoot,
      {
        protocol: 'behold.evaluation-episode.v1',
        suite: {
          id: 'neutral-causal-turn',
          version: '1',
          caseId: 'first-free-non-yield-action',
          specificationSha256,
        },
        life,
      },
      'behold-neutral-causal-evaluator',
    );
    const lifeRead = await readEntityLifeRange(life, fixture.entityRoot);
    if (lifeRead.turns.length !== 1) throw new Error('causal proof expected one exact life turn');
    const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile);
    const runStarted = events.find((event) => event.type === 'run_started');
    if (!runStarted) throw new Error('resident journal has no run_started event');
    const assessment = assessCausalTurn({
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
    });
    const requestArtifact = createResidentMindRequestArtifact(
      selected.modelTurn.data.call.request.mindRequest,
    );
    const requestFile = path.join(fixture.evidenceRoot, 'mind-request.json');
    fs.writeFileSync(requestFile, `${JSON.stringify(requestArtifact, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    const resultFile = path.join(fixture.evidenceRoot, 'causal-turn-result.json');
    fs.writeFileSync(
      resultFile,
      `${JSON.stringify(
        {
          protocol: 'behold.neutral-causal-turn-proof.v1',
          generatedAt: new Date().toISOString(),
          suite: { specificationSha256 },
          assessment,
          evidence: {
            root: fixture.root,
            journalFile,
            lifecycleFile: run.control.journalFile,
            episodeFile: episode.file,
            requestFile,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          proof: assessment.failed.length === 0 ? 'passed' : 'failed',
          failed: assessment.failed,
          binding: assessment.binding,
          evidence: resultFile,
        },
        null,
        2,
      )}\n`,
    );
    if (assessment.failed.length > 0) {
      throw new Error(`neutral causal turn failed: ${assessment.failed.join(', ')}`);
    }
  } catch (error) {
    if (run) await run.stop('neutral_causal_turn_failed').catch(() => {});
    throw error;
  } finally {
    episode?.close();
    restoreEnvironment('BEHOLD_RECORD_MODEL_IO', priorRecordModelIo);
  }
}

function selectCausalTurn(events: readonly any[]) {
  for (const entityTurn of events.filter((event) => event.type === 'entity_turn')) {
    if (entityTurn.data?.action?.name === 'wait_for_event') continue;
    const modelTurn = events.find(
      (event) =>
        event.type === 'model_turn' &&
        event.data?.intent?.id === entityTurn.data?.action?.id &&
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
  let model = 'openai/gpt-5.4-mini';
  let mind: 'direct' | 'ax' = 'ax';
  let timeoutMs = 120_000;
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
    else throw new Error(`Unknown argument ${argv[index]}`);
  }
  if (!runId) throw new Error('--runId is required');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('--port must be an integer from 1024 through 65535');
  }
  if (!/^[A-Za-z0-9_]{1,16}$/.test(entityId)) {
    throw new Error('--entity must be 1-16 Minecraft-safe characters');
  }
  if (!model.trim()) throw new Error('--model is required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 600_000) {
    throw new Error('--timeoutMs must be an integer from 30000 through 600000');
  }
  return { runId, port, entityId, model, mind, timeoutMs };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
