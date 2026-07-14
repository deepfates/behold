import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  createResidentMindRequestArtifact,
  parseResidentMindRequestArtifact,
} from '../src/mind/request-artifact';
import { parseRunJournal } from './owned-world-model-evidence';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const events = parseRunJournal(fs.readFileSync(path.resolve(args.journal), 'utf8'));
  const modelTurn = events.find(
    (event) =>
      event.type === 'model_turn' && (args.sequence == null || event.sequence === args.sequence),
  );
  if (!modelTurn) throw new Error('run journal contains no selected model_turn');
  const call = modelTurn.data?.call;
  if (call?.protocol !== 'behold.model-call.v1') {
    throw new Error('selected model turn contains no model-call evidence');
  }
  if (call.request?.mindRequest == null) {
    throw new Error(
      'selected model turn did not opt in to exact mind input recording; rerun with BEHOLD_RECORD_MODEL_IO=1',
    );
  }
  const artifact = createResidentMindRequestArtifact(call.request.mindRequest);
  if (call.request.mindRequestSha256 !== artifact.requestSha256) {
    throw new Error('selected model call identity differs from its recorded mind request');
  }
  if (call.request.model !== artifact.request.model) {
    throw new Error('selected model call model differs from its recorded mind request');
  }
  // Reparse the serialized form before writing so the file itself is admitted.
  const output = `${JSON.stringify(
    parseResidentMindRequestArtifact(JSON.parse(JSON.stringify(artifact))),
    null,
    2,
  )}\n`;
  const outputFile = path.resolve(args.out);
  await fsPromises.mkdir(path.dirname(outputFile), { recursive: true });
  await fsPromises.writeFile(outputFile, output, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(
    `${JSON.stringify({
      protocol: artifact.protocol,
      requestSha256: artifact.requestSha256,
      sourceJournal: path.resolve(args.journal),
      modelTurnSequence: modelTurn.sequence,
      output: outputFile,
    })}\n`,
  );
}

function parseArgs(argv: string[]) {
  let journal = '';
  let out = '';
  let sequence: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--journal') journal = String(argv[++index] || '');
    else if (argv[index] === '--out') out = String(argv[++index] || '');
    else if (argv[index] === '--model-turn') {
      sequence = Number(argv[++index]);
      if (!Number.isSafeInteger(sequence) || sequence < 1) {
        throw new Error('--model-turn must be a positive journal sequence');
      }
    } else throw new Error(`Unknown argument ${argv[index]}`);
  }
  if (!journal || !out) {
    throw new Error(
      'Usage: extract-mind-request --journal run.jsonl [--model-turn sequence] --out request.json',
    );
  }
  return { journal, out, ...(sequence == null ? {} : { sequence }) };
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
