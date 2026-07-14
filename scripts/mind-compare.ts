import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { compareResidentMinds } from '../src/evaluation/mind-comparison';
import { createAxResidentMind, parseAxResidentProgramArtifact } from '../src/mind/ax';
import { createDirectResidentMind } from '../src/mind/direct';
import { parseResidentMindRequestArtifact } from '../src/mind/request-artifact';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  const artifact = parseResidentMindRequestArtifact(
    JSON.parse(fs.readFileSync(path.resolve(args.request), 'utf8')),
  );
  const endpoint = chatCompletionEndpoint(process.env.OPENROUTER_BASE_URL);
  const axProgram = args.axProgram
    ? parseAxResidentProgramArtifact(
        JSON.parse(fs.readFileSync(path.resolve(args.axProgram), 'utf8')),
      )
    : undefined;
  const comparison = await compareResidentMinds(
    artifact,
    [
      {
        label: 'direct',
        mind: createDirectResidentMind({
          apiKey,
          model: artifact.request.model,
          endpoint,
        }),
      },
      {
        label: 'ax',
        mind: createAxResidentMind({
          apiKey,
          model: artifact.request.model,
          apiURL: openAICompatibleBaseURL(process.env.OPENROUTER_BASE_URL),
          ...(axProgram ? { programArtifact: axProgram } : {}),
        }),
      },
    ],
    { timeoutMs: args.timeoutMs },
  );
  const output = `${JSON.stringify(comparison, null, 2)}\n`;
  if (args.out) {
    const outputFile = path.resolve(args.out);
    await fsPromises.mkdir(path.dirname(outputFile), { recursive: true });
    await fsPromises.writeFile(outputFile, output, 'utf8');
  }
  process.stdout.write(output);
  if (
    !comparison.verdict.inputMatched ||
    !comparison.verdict.allCompleted ||
    !comparison.verdict.allValid
  ) {
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]) {
  let request = '';
  let out: string | undefined;
  let axProgram: string | undefined;
  let timeoutMs = 30_000;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--request') request = String(argv[++index] || '');
    else if (argv[index] === '--out') out = String(argv[++index] || '');
    else if (argv[index] === '--ax-program') axProgram = String(argv[++index] || '');
    else if (argv[index] === '--timeoutMs') {
      timeoutMs = Number(argv[++index]);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
        throw new Error('--timeoutMs must be an integer from 1000 through 120000');
      }
    } else throw new Error(`Unknown argument ${argv[index]}`);
  }
  if (!request) {
    throw new Error(
      'Usage: mind-compare --request artifact.json [--ax-program artifact.json] [--timeoutMs ms] [--out comparison.json]',
    );
  }
  return {
    request,
    timeoutMs,
    ...(out ? { out } : {}),
    ...(axProgram ? { axProgram } : {}),
  };
}

function chatCompletionEndpoint(value: string | undefined) {
  const normalized = String(value || 'https://openrouter.ai/api/v1/chat/completions').replace(
    /\/+$/,
    '',
  );
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function openAICompatibleBaseURL(value: string | undefined) {
  return chatCompletionEndpoint(value).replace(/\/chat\/completions$/, '');
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
