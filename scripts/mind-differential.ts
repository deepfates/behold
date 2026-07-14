import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Bot } from 'mineflayer';
import { buildInterpreter } from '../src/agent/interpreter';
import { openEntityLoom } from '../src/entity/loom';
import { createPlaceMemory } from '../src/entity/places';
import { createProjectMemory } from '../src/entity/projects';
import { createAxResidentMind } from '../src/mind/ax';
import { startLLMPolicy } from '../src/policy/llm';

type CandidateAdapter = 'ax' | 'direct';
type Args = {
  journal: string;
  out?: string;
  modelTurn?: number;
  candidate: CandidateAdapter;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  const records = readJsonl(args.journal);
  const baselineRecord = records.find(
    (record) =>
      record?.type === 'model_turn' &&
      (args.modelTurn == null || Number(record.sequence) === args.modelTurn),
  );
  if (!baselineRecord?.data?.call || !baselineRecord?.data?.observation) {
    const selection = args.modelTurn == null ? '' : ` at journal sequence ${args.modelTurn}`;
    throw new Error(`No model_turn with call evidence${selection} in ${args.journal}`);
  }
  const entityId = String(
    baselineRecord.agent || baselineRecord.data.observation?.self?.identity || '',
  );
  if (!entityId) throw new Error('Could not identify the resident from the journal');
  const matchingTurn = records.find(
    (record) =>
      record?.type === 'entity_turn' &&
      record?.data?.action?.id === baselineRecord.data?.intent?.id,
  );
  if (!matchingTurn?.data?.sequence) {
    throw new Error('The journal does not contain the completed entity turn for its model choice');
  }

  const loom = await openEntityLoom(entityId);
  let policy: ReturnType<typeof startLLMPolicy> | null = null;
  try {
    const priorTurnCount = Number(matchingTurn.data.sequence) - 1;
    const history = loom.turns().slice(0, priorTurnCount);
    if (history.length !== priorTurnCount) {
      throw new Error(`Expected ${priorTurnCount} prior turns, found ${history.length}`);
    }
    const capturedObservation = baselineRecord.data.observation;
    const replay = observationForCurrentContract(capturedObservation);
    const observation = replay.observation;
    const projects = createProjectMemory(entityId, history);
    const places = createPlaceMemory(entityId, history);
    // Tool construction is side-effect free; no CommandSpec.run function is
    // exposed to either model or invoked by this differential.
    const interpreter = buildInterpreter({} as Bot, {
      projects,
      places: () => places.snapshot(),
      observe: () => replayObservationAtCursor(observation),
    });
    const actions = interpreter.list('inhabitant').map((spec) => ({
      type: 'function' as const,
      function: {
        name: spec.name,
        description: spec.description || '',
        parameters: spec.parameters || { type: 'object', properties: {} },
      },
    }));
    const model = String(baselineRecord.data.model);
    const candidateMind =
      args.candidate === 'ax'
        ? createAxResidentMind({
            apiKey,
            model,
            apiURL: openAICompatibleBaseURL(process.env.OPENROUTER_BASE_URL),
          })
        : null;
    let candidate: any = null;
    let candidateError: any = null;
    const attempted: any[] = [];
    policy = startLLMPolicy(
      {
        entityId,
        observe: (sinceSequence) => replayObservationAtCursor(observation, sinceSequence),
        actions,
        // This proof ends at proposal admission. It cannot mutate Minecraft.
        attempt: (intent) => {
          attempted.push(intent);
          return false;
        },
      },
      {
        apiKey,
        model,
        ...(candidateMind ? { mind: candidateMind } : {}),
        history,
        foldCacheFile: loom.foldFile,
        maxTurnSteps: 1,
        acceptEngineEvent: () => true,
        onModelTurn: (turn) => {
          candidate = turn;
        },
        onModelError: (error) => {
          candidateError = error;
        },
      },
    );
    await policy.tick();
    await policy.stop();

    const baseline = baselineRecord.data;
    const candidateCall = candidate?.call || candidateError?.call || null;
    const comparison = {
      protocol: 'behold.mind-differential.v1',
      generatedAt: new Date().toISOString(),
      source: {
        journal: path.resolve(args.journal),
        modelTurnJournalSequence: Number(baselineRecord.sequence),
        entityId,
        priorTurnCount,
        observationSha256: sha256(stableJson(observation)),
        capturedObservationSha256: sha256(stableJson(capturedObservation)),
        observationMigrations: replay.migrations,
      },
      safety: {
        worldMutationEnabled: false,
        proposalAttempts: attempted.length,
        proposalAttemptAccepted: false,
      },
      baseline: {
        adapter: baseline.call.adapter?.name || 'direct-openrouter',
        model,
        intent: baseline.intent,
        utterance: baseline.assistant?.content ?? null,
        call: baseline.call,
      },
      candidate: candidate
        ? {
            adapter: candidateMind?.id || candidate.call?.adapter?.name || 'direct-openrouter',
            model,
            intent: candidate.intent,
            utterance: candidate.assistant?.content ?? null,
            call: candidate.call,
          }
        : null,
      candidateError,
      matchedEpisode: candidateCall
        ? {
            model: model === candidateCall.request.model,
            observation: replay.migrations.length === 0,
            actionSet: baseline.call.request.toolsSha256 === candidateCall.request.toolsSha256,
            contextProjection: {
              messageCount:
                baseline.call.request.messageCount === candidateCall.request.messageCount,
              messagesSha256:
                baseline.call.request.messagesSha256 === candidateCall.request.messagesSha256,
              note: 'Context may differ when the disposable loom fold advanced after the captured baseline; source turns remain the same.',
            },
          }
        : null,
      sameProposedAction:
        candidate?.intent?.tool === baseline.intent?.tool &&
        stableJson(candidate?.intent?.input ?? null) === stableJson(baseline.intent?.input ?? null),
    };
    const output = `${JSON.stringify(comparison, null, 2)}\n`;
    if (args.out) {
      await fsPromises.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
      await fsPromises.writeFile(path.resolve(args.out), output, 'utf8');
    }
    process.stdout.write(output);
    if (!candidate || candidateError) process.exitCode = 1;
  } finally {
    await policy?.stop();
    await loom.close();
  }
}

function parseArgs(argv: string[]): Args {
  let journal = '';
  let out: string | undefined;
  let modelTurn: number | undefined;
  let candidate: CandidateAdapter = 'ax';
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--journal') journal = String(argv[++index] || '');
    else if (argv[index] === '--out') out = String(argv[++index] || '');
    else if (argv[index] === '--model-turn') {
      modelTurn = Number(argv[++index]);
      if (!Number.isSafeInteger(modelTurn) || modelTurn < 1) {
        throw new Error('--model-turn must be a positive journal sequence');
      }
    } else if (argv[index] === '--candidate') {
      const value = String(argv[++index] || '');
      if (value !== 'ax' && value !== 'direct') {
        throw new Error('--candidate must be ax or direct');
      }
      candidate = value;
    } else throw new Error(`Unknown argument ${argv[index]}`);
  }
  if (!journal) {
    throw new Error(
      'Usage: mind-differential --journal <run.jsonl> [--model-turn <journal-sequence>] [--candidate ax|direct] [--out result.json]',
    );
  }
  return {
    journal,
    candidate,
    ...(modelTurn == null ? {} : { modelTurn }),
    ...(out ? { out } : {}),
  };
}

function readJsonl(file: string) {
  return fs
    .readFileSync(path.resolve(file), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSON at ${file}:${index + 1}`);
      }
    });
}

function openAICompatibleBaseURL(value: string | undefined) {
  const normalized = String(value || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  return normalized.replace(/\/chat\/completions$/, '');
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function observationForCurrentContract(captured: any) {
  const observation = structuredClone(captured);
  const migrations: string[] = [];
  for (const entity of observation?.scene?.entities || []) {
    if (!entity?.pickupSafety || entity.pickupGround) continue;
    const legacy = entity.pickupSafety;
    entity.pickupGround = {
      status: legacy.ok
        ? 'supported'
        : legacy.reason === 'hazardous_support'
          ? 'hazardous'
          : legacy.reason === 'unsupported_destination'
            ? 'unsupported'
            : 'unknown',
      ...(legacy.feet ? { feet: legacy.feet } : {}),
      ...(legacy.support ? { support: legacy.support } : {}),
    };
    delete entity.pickupSafety;
    if (!migrations.includes('scene.entities.pickupSafety->pickupGround')) {
      migrations.push('scene.entities.pickupSafety->pickupGround');
    }
  }
  return { observation, migrations };
}

function replayObservationAtCursor(observation: any, sinceSequence = 0) {
  const observedThrough = Number(observation?.sequence) || 0;
  if (Number(sinceSequence) < observedThrough) return structuredClone(observation);
  return {
    ...structuredClone(observation),
    eventWindow: {
      requestedAfterSequence: Number(sinceSequence),
      oldestAvailableSequence: Number(observation?.eventWindow?.oldestAvailableSequence) || 1,
      newestAvailableSequence: observedThrough,
      missingBeforeOldest: 0,
      complete: true,
    },
    events: [],
  };
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
