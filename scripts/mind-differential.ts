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

type Args = { journal: string; out?: string };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  const records = readJsonl(args.journal);
  const baselineRecord = records.find((record) => record?.type === 'model_turn');
  if (!baselineRecord?.data?.call || !baselineRecord?.data?.observation) {
    throw new Error(`No model_turn with call evidence in ${args.journal}`);
  }
  const entityId = String(baselineRecord.agent || baselineRecord.data.observation?.self?.identity || '');
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
    const observation = baselineRecord.data.observation;
    const projects = createProjectMemory(entityId, history);
    const places = createPlaceMemory(entityId, history);
    // Tool construction is side-effect free; no CommandSpec.run function is
    // exposed to either model or invoked by this differential.
    const interpreter = buildInterpreter({} as Bot, {
      projects,
      places: () => places.snapshot(),
      observe: () => observation,
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
    const candidateMind = createAxResidentMind({
      apiKey,
      model,
      apiURL: openAICompatibleBaseURL(process.env.OPENROUTER_BASE_URL),
    });
    let candidate: any = null;
    let candidateError: any = null;
    const attempted: any[] = [];
    policy = startLLMPolicy(
      {
        entityId,
        observe: () => observation,
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
        mind: candidateMind,
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
        entityId,
        priorTurnCount,
        observationSha256: sha256(stableJson(observation)),
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
            adapter: candidateMind.id,
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
            observation: true,
            actionSet:
              baseline.call.request.toolsSha256 === candidateCall.request.toolsSha256,
            contextProjection: {
              messageCount:
                baseline.call.request.messageCount === candidateCall.request.messageCount,
              messagesSha256:
                baseline.call.request.messagesSha256 === candidateCall.request.messagesSha256,
              note:
                'Context may differ when the disposable loom fold advanced after the captured baseline; source turns remain the same.',
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
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--journal') journal = String(argv[++index] || '');
    else if (argv[index] === '--out') out = String(argv[++index] || '');
    else throw new Error(`Unknown argument ${argv[index]}`);
  }
  if (!journal) throw new Error('Usage: mind-differential --journal <run.jsonl> [--out result.json]');
  return { journal, ...(out ? { out } : {}) };
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

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
