import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readEntityLifeRange, resolveEntityLifeRange } from '../src/entity/loom';
import { verifyCognitionBrokerJournal } from '../src/mind/cognition-broker';
import { verifyCognitionTransportCapture } from '../src/mind/transport-capture';
import { readAndVerifyLiveEpisodeLyncCheckpoint } from '../src/runtime/live-lync-checkpoint';
import { parseRunJournal } from './owned-world-model-evidence';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const episodeFile = plainFile(args.episode, 'episode record');
  const episode = JSON.parse(fs.readFileSync(episodeFile, 'utf8'));
  const lync = await readAndVerifyLiveEpisodeLyncCheckpoint(episodeFile);
  if (episode?.cognition?.bodyRetention !== 'full') {
    throw new Error(
      `episode exact model IO is unavailable (bodyRetention=${String(episode?.cognition?.bodyRetention ?? 'absent')})`,
    );
  }
  const captureDirectory = plainDirectory(
    episode?.cognition?.transportCaptureDirectory,
    'episode transport capture',
  );
  const broker = verifyCognitionBrokerJournal(
    plainFile(episode?.cognition?.journalFile, 'episode cognition journal'),
  );
  const capture = verifyCognitionTransportCapture(captureDirectory, broker.events);
  const life = (Array.isArray(episode?.lives) ? episode.lives : []).find(
    (candidate: any) => candidate?.entityId === args.entity,
  );
  if (!life) throw new Error(`episode contains no resident ${args.entity}`);

  const journalFiles = Array.isArray(life.runJournalFiles) ? life.runJournalFiles : [];
  const journalEvents = journalFiles.flatMap((reference: any) => {
    const file = plainFile(reference?.file, `${args.entity} run journal`);
    const bytes = fs.readFileSync(file);
    if (bytes.byteLength !== Number(reference?.sizeBytes) || sha256(bytes) !== reference?.sha256) {
      throw new Error(`${args.entity} run journal differs from its episode reference`);
    }
    return parseRunJournal(bytes.toString('utf8')).map((event) => ({ ...event, sourceFile: file }));
  });
  const selected = journalEvents.filter(
    (event: any) => event.type === 'model_turn' && event.sequence === args.modelTurn,
  );
  if (selected.length !== 1) {
    throw new Error(
      `${args.entity} has ${selected.length} model_turn events at journal sequence ${args.modelTurn}`,
    );
  }
  const modelTurn: any = selected[0];
  const call = modelTurn.data?.call;
  if (call?.protocol !== 'behold.model-call.v1') {
    throw new Error('selected model turn has no authenticated model-call evidence');
  }
  const admissions = (Array.isArray(call.admissions) ? call.admissions : []).filter(
    (admission: any) => admission?.purpose === 'resident_decision',
  );
  if (admissions.length !== 1) {
    throw new Error('selected model turn does not bind exactly one resident-decision admission');
  }
  const admission = admissions[0];
  const start = capture.starts.find(
    (candidate) => candidate.brokerRequestId === admission.brokerRequestId,
  );
  const attempt = capture.records.find(
    (candidate) => candidate.brokerRequestId === admission.brokerRequestId,
  );
  if (!start || !attempt || !attempt.response) {
    throw new Error('selected model turn has no complete captured provider attempt');
  }
  if (
    start.purpose !== 'resident_decision' ||
    start.request.sha256 !== admission.bodySha256 ||
    start.request.sha256 !== call.request?.bodySha256 ||
    start.request.bytes !== call.request?.bodyBytes
  ) {
    throw new Error('selected model turn, broker admission, and exact request bytes disagree');
  }

  const requestBytes = fs.readFileSync(start.request.file);
  const responseBytes = fs.readFileSync(attempt.response.content.file);
  const request = parseJson(requestBytes, 'captured provider request');
  parseJson(responseBytes, 'captured provider response');
  const commit = journalEvents.find(
    (event: any) =>
      event.type === 'resident_life_commit' &&
      event.data?.experience?.requestSha256 === call.request?.mindRequestSha256,
  ) as any;
  let causalTurn: any = null;
  let causalReference: any = null;
  if (commit) {
    const sequence = Number(commit.data?.entity?.sequence);
    const entityRoot = path.dirname(
      path.dirname(plainDirectory(life.lyncDirectory, 'resident Lync')),
    );
    causalReference = await resolveEntityLifeRange(args.entity, sequence, sequence, entityRoot);
    const read = await readEntityLifeRange(causalReference, entityRoot);
    if (read.turns.length !== 1) throw new Error('selected canonical life range is not one turn');
    causalTurn = read.turns[0];
    if (causalTurn.observationPresentation?.requestSha256 !== call.request?.mindRequestSha256) {
      throw new Error('canonical causal turn refers to a different resident mind request');
    }
  }

  const outputDirectory = createPrivateOutput(args.out);
  const requestFile = writeExact(outputDirectory, 'provider-request.json', requestBytes);
  const responseFile = writeExact(outputDirectory, 'provider-response.json', responseBytes);
  const modelTurnFile = writeJson(outputDirectory, 'model-turn.json', modelTurn);
  const causalTurnFile = causalTurn
    ? writeJson(outputDirectory, 'canonical-causal-turn.json', causalTurn)
    : null;
  const images = extractImages(request, outputDirectory);
  const manifestBase = {
    protocol: 'behold.resident-turn-inspection.v1',
    episode: {
      file: episodeFile,
      protocol: episode.protocol,
      sessionId: episode.sessionId,
      episodeId: episode.episodeId,
      digest: episode.digest,
      lyncSources: lync.orderedSources.length,
    },
    resident: args.entity,
    selection: {
      runJournal: modelTurn.sourceFile,
      modelTurnSequence: args.modelTurn,
      mindRequestSha256: call.request?.mindRequestSha256 ?? null,
      brokerRequestId: admission.brokerRequestId,
      admissionOrdinal: admission.admissionOrdinal,
    },
    exactProviderRequest: {
      ...requestFile,
      admittedSha256: admission.bodySha256,
      digestMatchesAdmission: requestFile.sha256 === admission.bodySha256,
      messages: Array.isArray(request?.messages) ? request.messages.length : null,
      tools: Array.isArray(request?.tools) ? request.tools.length : 0,
      hasResponseSchema: request?.response_format != null || request?.format != null,
      images,
    },
    exactProviderResponse: responseFile,
    parsedModelTurn: modelTurnFile,
    canonicalCausalTurn: causalTurnFile
      ? {
          status: 'committed' as const,
          reference: causalReference,
          file: causalTurnFile,
        }
      : {
          status: 'not_committed_in_selected_resident_journal' as const,
          reason: 'The model turn formed no admitted action or failed before a causal life commit.',
        },
  };
  const manifest = { ...manifestBase, digest: sha256(stableJson(manifestBase)) };
  const manifestFile = writeJson(outputDirectory, 'inspection.json', manifest);
  process.stdout.write(
    `${JSON.stringify({
      protocol: manifest.protocol,
      outputDirectory,
      manifest: manifestFile,
      requestSha256: requestFile.sha256,
      responseSha256: responseFile.sha256,
      causalTurn: manifest.canonicalCausalTurn.status,
    })}\n`,
  );
}

function parseArgs(argv: string[]) {
  let episode = '';
  let entity = '';
  let out = '';
  let modelTurn = 0;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--episode') episode = String(argv[++index] || '');
    else if (argv[index] === '--entity') entity = String(argv[++index] || '');
    else if (argv[index] === '--out') out = String(argv[++index] || '');
    else if (argv[index] === '--model-turn') modelTurn = Number(argv[++index]);
    else throw new Error(`Unknown argument ${argv[index]}`);
  }
  if (!episode || !entity || !out || !Number.isSafeInteger(modelTurn) || modelTurn < 1) {
    throw new Error(
      'Usage: inspect-resident-turn --episode episode-record.json --entity Resident --model-turn JOURNAL_SEQUENCE --out PRIVATE_DIRECTORY',
    );
  }
  return { episode, entity, modelTurn, out };
}

function extractImages(value: unknown, directory: string) {
  const urls: string[] = [];
  const visit = (item: any) => {
    if (typeof item === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(item)) {
      urls.push(item);
      return;
    }
    if (Array.isArray(item)) for (const nested of item) visit(nested);
    else if (item && typeof item === 'object')
      for (const nested of Object.values(item)) visit(nested);
  };
  visit(value);
  return urls.map((url, index) => {
    const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) throw new Error('captured request contains a malformed image data URL');
    const bytes = Buffer.from(match[2], 'base64');
    const extension = imageExtension(match[1]);
    return {
      ...writeExact(directory, `camera-${String(index + 1).padStart(2, '0')}.${extension}`, bytes),
      contentType: match[1].toLowerCase(),
    };
  });
}

function imageExtension(contentType: string) {
  if (contentType.toLowerCase() === 'image/jpeg') return 'jpg';
  if (contentType.toLowerCase() === 'image/png') return 'png';
  if (contentType.toLowerCase() === 'image/webp') return 'webp';
  return 'bin';
}

function createPrivateOutput(value: string) {
  const directory = path.resolve(value);
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  return directory;
}

function writeJson(directory: string, name: string, value: unknown) {
  return writeExact(directory, name, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

function writeExact(directory: string, name: string, bytes: Buffer) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  return { file, sha256: sha256(bytes), bytes: bytes.byteLength };
}

function parseJson(bytes: Buffer, label: string): any {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is not JSON`);
  }
}

function plainFile(value: unknown, label: string) {
  const file = path.resolve(String(value || ''));
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} is not a plain file`);
  return file;
}

function plainDirectory(value: unknown, label: string) {
  const directory = path.resolve(String(value || ''));
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a plain directory`);
  }
  return directory;
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
