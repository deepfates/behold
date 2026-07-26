import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  bundledJava,
  loadManagedResidentSet,
  managedSessionDurationMs,
  resolveManagedDataRoot,
  startManagedWorld,
  type ManagedWorldRun,
} from '../../scripts/world-runner';
import { RESIDENT_VIEWER_PROTOCOL } from '../observability/resident-viewer';
import { sanitizeName } from '../observability/journal';
import {
  assertPlaceServedAuthority,
  assertPlaceServedResumeContinuity,
  establishPlaceServedWorldBasis,
  recordPlaceServedWorldHead,
  verifyPlaceServedWorldBasis,
} from '../runtime/place-served-world';
import {
  startFrozenPlaceServeAuthority,
  verifyPlaceServeTranscript,
  type FrozenPlaceServeAuthority,
} from '../runtime/place-serve';

const PLACE_SERVE_REVISION = '103deac629d8f784ea22d956c890de77334d730a' as const;
const LIVE_SESSION_PROTOCOL = 'behold.live-session.v1' as const;
const LIVE_AFTERMATH_PROTOCOL = 'behold.live-aftermath.v1' as const;

export async function runLiveCli(argv: string[]) {
  const parsed = parseArgs({
    args: argv,
    options: {
      residents: { type: 'string' },
      'accept-eula': { type: 'boolean', default: false },
      session: { type: 'string' },
      state: { type: 'string' },
      duration: { type: 'string' },
      port: { type: 'string' },
      'viewer-base-port': { type: 'string' },
      'viewer-distance': { type: 'string' },
      'place-compiler': { type: 'string' },
      'server-jar': { type: 'string' },
      'max-model-concurrency': { type: 'string' },
      'lmstudio-models-root': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  if (parsed.values.help) {
    process.stdout.write(`${liveUsage()}\n`);
    return 0;
  }
  if (parsed.positionals.length !== 1 || !parsed.values.residents) {
    throw new Error('live requires one RELEASE and --residents FILE');
  }
  if (parsed.values['accept-eula'] !== true) {
    throw new Error('live requires explicit --accept-eula');
  }
  const repositoryRoot = findRepositoryRoot();
  assertCleanCheckout(repositoryRoot, 'Behold');
  const releaseRoot = plainDirectory(parsed.positionals[0], 'Place release');
  const residentFile = plainFile(String(parsed.values.residents), 'resident set');
  const residents = loadManagedResidentSet(residentFile);
  if (residents.some((resident) => resident.providerQuotas == null || resident.paused === true)) {
    throw new Error('live requires an armed per-resident provider-attempt ceiling for every life');
  }
  const releaseManifestFile = path.join(releaseRoot, 'release-manifest.json');
  const releaseManifest = readJson(releaseManifestFile);
  const placeId = safeSegment(releaseManifest?.placeId, 'Place id');
  const releaseManifestSha256 = sha256File(releaseManifestFile);
  const sessionId = safeSegment(
    parsed.values.session ?? `${placeId}-${releaseManifestSha256.slice(0, 12)}-living`,
    'session id',
  );
  const stateRoot = path.resolve(
    String(parsed.values.state ?? path.join(repositoryRoot, 'data', 'live')),
  );
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const sessionRoot = path.join(resolveManagedDataRoot(stateRoot, 'live state root'), sessionId);
  fs.mkdirSync(sessionRoot, { recursive: true, mode: 0o700 });
  const paths = liveSessionPaths(sessionRoot);
  for (const directory of [paths.episodes, paths.control, paths.entities, paths.runs]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const residentSetSha256 = sha256(stableJson(residents));
  const existingPlan = fs.existsSync(paths.plan) ? readLivePlan(paths.plan) : null;
  if (existingPlan) {
    if (
      existingPlan.sessionId !== sessionId ||
      existingPlan.releaseManifestSha256 !== releaseManifestSha256 ||
      existingPlan.residentSetSha256 !== residentSetSha256 ||
      stableJson(existingPlan.residents) !== stableJson(residents)
    ) {
      throw new Error('live session identity differs from its persistent population or release');
    }
    assertPlaceServedResumeContinuity(paths.descriptor, paths.head);
  } else if (fs.existsSync(paths.descriptor)) {
    throw new Error('served-world genesis exists without its live session plan');
  }

  const episodeId = nextEpisodeId(paths.episodes);
  const episodeRoot = path.join(paths.episodes, episodeId);
  fs.mkdirSync(episodeRoot, { mode: 0o700 });
  const placeCompilerRoot = plainDirectory(
    String(
      parsed.values['place-compiler'] ??
        process.env.BEHOLD_PLACE_COMPILER_ROOT ??
        path.join(repositoryRoot, '..', 'place-compiler'),
    ),
    'Place Compiler root',
  );
  const durationMs = managedSessionDurationMs(parsed.values.duration ?? '300')!;
  const requestedPort = optionalInteger(parsed.values.port, '--port', 1024, 65535);
  const viewerBasePort = optionalInteger(
    parsed.values['viewer-base-port'] ?? '3007',
    '--viewer-base-port',
    1024,
    65535,
  )!;
  const viewerDistance = optionalInteger(
    parsed.values['viewer-distance'] ?? '6',
    '--viewer-distance',
    2,
    16,
  )!;
  const maxConcurrentModelCalls = optionalInteger(
    parsed.values['max-model-concurrency'] ?? String(Math.min(2, residents.length)),
    '--max-model-concurrency',
    1,
    Math.max(1, residents.length),
  )!;
  let authority: FrozenPlaceServeAuthority | null = null;
  let run: ManagedWorldRun | null = null;
  let cleanStop = false;
  const startedAt = new Date().toISOString();
  try {
    const admittedPort = existingPlan?.endpoint.port ?? requestedPort ?? 25565;
    if (requestedPort != null && requestedPort !== admittedPort) {
      throw new Error(`live session uses port ${admittedPort}; requested ${requestedPort}`);
    }
    authority = await startFrozenPlaceServeAuthority({
      placeCompilerRoot,
      releaseRoot,
      runtimeRoot: paths.placeRuntime,
      profileId: 'living',
      transcriptFile: path.join(episodeRoot, 'place-control.jsonl'),
      acceptEula: true,
      port: admittedPort,
      expectedPlaceCompilerRevision: existingPlan?.placeCompilerRevision ?? PLACE_SERVE_REVISION,
      ...(parsed.values['server-jar']
        ? { serverJar: plainFile(String(parsed.values['server-jar']), 'Minecraft server JAR') }
        : {}),
    });

    let established;
    let plan = existingPlan;
    if (!plan) {
      const adoptionSave = await authority.save('behold_live_adoption_basis');
      established = establishPlaceServedWorldBasis({
        sessionRoot,
        authority,
        saveEvidence: adoptionSave,
      });
      plan = writeLivePlan(paths.plan, {
        sessionId,
        worldId: established.descriptor.worldId,
        placeCompilerRevision: authority.placeCompilerRevision,
        releaseManifestSha256,
        residentSetSha256,
        residents,
        accountingScopeId: `${sessionId}:living`,
        endpoint: authority.placeIdentity.endpoint,
        createdAt: new Date().toISOString(),
      });
    } else {
      established = verifyPlaceServedWorldBasis(paths.descriptor);
      if (established.descriptor.worldId !== plan.worldId) {
        throw new Error('live session world differs from its served-world genesis');
      }
      assertPlaceServedAuthority(established.descriptor, authority);
    }

    run = await startManagedWorld(
      {
        worldId: established.descriptor.worldId,
        world: established.world,
        controlRoot: paths.control,
        serverDirectory: authority.placeIdentity.runtimePath,
        serverJar: authority.minecraftServerJar,
        expectedServerJarSha256: authority.minecraftServerSha256,
        java: bundledJava(),
        controllerEntry: path.join(repositoryRoot, 'dist', 'src', 'cli', 'behold.js'),
        entityRoot: paths.entities,
        runRoot: paths.runs,
        residents,
        residentViewers: {
          protocol: RESIDENT_VIEWER_PROTOCOL,
          basePort: viewerBasePort,
          viewDistance: viewerDistance,
        },
        maxResidents: residents.length,
        maxConcurrentModelCalls,
        accountingScopeId: plan.accountingScopeId,
        ...(residents.some((resident) => resident.ollamaLocal != null)
          ? {
              ollamaServerConfigFile:
                process.env.BEHOLD_OLLAMA_SERVER_CONFIG ??
                path.join(os.homedir(), '.ollama', 'server.json'),
            }
          : {}),
        ...(residents.some((resident) => resident.lmStudioLocal != null)
          ? {
              lmStudioModelsRoot: path.resolve(
                String(
                  parsed.values['lmstudio-models-root'] ??
                    path.join(os.homedir(), '.cache', 'lm-studio', 'models'),
                ),
              ),
            }
          : {}),
      },
      { externalServerAuthority: authority },
    );
    printLiveReady(sessionId, authority, run, durationMs, episodeRoot);
    run.control.append('live_session_duration_armed', {
      durationMs,
      beginsAt: 'run_ready',
      terminalReason: 'duration_elapsed',
    });
    const reason = await awaitLiveBoundary(run, durationMs);
    await run.stop(reason);
    await run.finished;
    cleanStop = true;

    const head = recordPlaceServedWorldHead({
      descriptorFile: paths.descriptor,
      lifecycleFile: run.control.journalFile,
      headFile: paths.head,
    });
    const transcript = verifyPlaceServeTranscript(authority.transcriptFile);
    const aftermath = writeAftermath({
      file: path.join(episodeRoot, 'aftermath.json'),
      sessionId,
      episodeId,
      startedAt,
      completedAt: new Date().toISOString(),
      run,
      authority,
      head,
      transcriptTipDigest: transcript.tipDigest,
      entityRoot: paths.entities,
    });
    process.stdout.write(`\n[behold live] stopped cleanly\n`);
    process.stdout.write(`[behold live] aftermath: ${aftermath.file}\n`);
    for (const life of aftermath.record.lives) {
      process.stdout.write(`[behold live] ${life.entityId} life: ${life.lyncDirectory}\n`);
    }
    process.stdout.write(
      `[behold live] resume: behold live ${releaseRoot} --residents ${residentFile} --accept-eula --session ${sessionId}\n`,
    );
    return 0;
  } catch (error) {
    if (run && !cleanStop) {
      await run.stop('live_failure').catch(() => {});
      await run.finished.catch(() => {});
    }
    throw error;
  } finally {
    if (authority)
      await authority.stop(cleanStop ? 'live_final_settlement' : 'live_failure').catch(() => {});
  }
}

function printLiveReady(
  sessionId: string,
  authority: FrozenPlaceServeAuthority,
  run: ManagedWorldRun,
  durationMs: number,
  episodeRoot: string,
) {
  process.stdout.write(`\n[behold live] ${sessionId} is alive for ${durationMs / 1000}s\n`);
  process.stdout.write(
    `[behold live] native Minecraft: ${authority.host}:${authority.port} (${authority.placeIdentity.minecraftVersion})\n`,
  );
  for (const resident of run.residents) {
    process.stdout.write(
      `[behold live] ${resident.entityId} POV: ${resident.viewer?.endpoint ?? 'unavailable'}\n`,
    );
  }
  process.stdout.write(`[behold live] episode evidence: ${episodeRoot}\n`);
  process.stdout.write('[behold live] Ctrl-C saves the world and ends this episode.\n\n');
}

async function awaitLiveBoundary(run: ManagedWorldRun, durationMs: number) {
  let requestStop!: (reason: string) => void;
  const requested = new Promise<string>((resolve) => {
    requestStop = resolve;
  });
  const onSigint = () => requestStop('SIGINT');
  const onSigterm = () => requestStop('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  const timer = setTimeout(() => requestStop('duration_elapsed'), durationMs);
  try {
    return await Promise.race([
      requested,
      run.finished.then(() => {
        throw new Error('a managed resident or server exited before the live boundary');
      }),
    ]);
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

function liveSessionPaths(sessionRoot: string) {
  return Object.freeze({
    plan: path.join(sessionRoot, 'session.json'),
    head: path.join(sessionRoot, 'head.json'),
    descriptor: path.join(sessionRoot, 'genesis', 'place-served-world.json'),
    placeRuntime: path.join(sessionRoot, 'place-runtime'),
    episodes: path.join(sessionRoot, 'episodes'),
    control: path.join(sessionRoot, 'control'),
    entities: path.join(sessionRoot, 'entities'),
    runs: path.join(sessionRoot, 'runs'),
  });
}

function writeLivePlan(
  file: string,
  value: Omit<ReturnType<typeof readLivePlan>, 'protocol' | 'digest'>,
) {
  const base = { protocol: LIVE_SESSION_PROTOCOL, ...value };
  const record = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  writeJsonExclusive(file, record);
  return record;
}

function readLivePlan(file: string) {
  const value = readJson(file);
  const { digest, ...base } = value;
  if (
    value.protocol !== LIVE_SESSION_PROTOCOL ||
    typeof value.sessionId !== 'string' ||
    typeof value.worldId !== 'string' ||
    typeof value.placeCompilerRevision !== 'string' ||
    typeof value.releaseManifestSha256 !== 'string' ||
    typeof value.residentSetSha256 !== 'string' ||
    !Array.isArray(value.residents) ||
    typeof value.accountingScopeId !== 'string' ||
    !value.endpoint ||
    digest !== sha256(stableJson(base))
  ) {
    throw new Error('live session plan is malformed or unauthenticated');
  }
  return deepFreeze(value) as Readonly<{
    protocol: typeof LIVE_SESSION_PROTOCOL;
    sessionId: string;
    worldId: string;
    placeCompilerRevision: string;
    releaseManifestSha256: string;
    residentSetSha256: string;
    residents: ReturnType<typeof loadManagedResidentSet>;
    accountingScopeId: string;
    endpoint: Readonly<{ host: '127.0.0.1' | '::1'; port: number }>;
    createdAt: string;
    digest: string;
  }>;
}

function writeAftermath(input: {
  file: string;
  sessionId: string;
  episodeId: string;
  startedAt: string;
  completedAt: string;
  run: ManagedWorldRun;
  authority: FrozenPlaceServeAuthority;
  head: any;
  transcriptTipDigest: string | null;
  entityRoot: string;
}) {
  const lives = input.run.residents.map((resident) => {
    const directory = path.join(input.entityRoot, sanitizeName(resident.entityId), 'lync');
    return {
      entityId: resident.entityId,
      bodyUsername: resident.bodyUsername,
      profile: 'org.behold.inhabitant.v1',
      lyncDirectory: directory,
      manifestFile: path.join(directory, 'manifest.json'),
      sourceFiles: listLyncFiles(directory),
      runJournalDirectory: resident.journalDirectory,
    };
  });
  const base = {
    protocol: LIVE_AFTERMATH_PROTOCOL,
    sessionId: input.sessionId,
    episodeId: input.episodeId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    worldId: input.head.worldId,
    terminalWorldDigest: input.head.runtimeDigest,
    experimentRelease: input.run.experimentRelease,
    lifecycle: {
      file: input.run.control.journalFile,
      tipDigest: input.head.lifecycle.tipDigest,
    },
    place: {
      transcriptFile: input.authority.transcriptFile,
      transcriptTipDigest: input.transcriptTipDigest,
      identity: input.authority.identity,
    },
    cognition: input.run.cognition
      ? {
          journalFile: input.run.cognition.journalFile,
          transportCaptureDirectory: input.run.cognition.transportCaptureDirectory,
          accounting: input.run.cognition.accountingSnapshot(),
        }
      : null,
    viewers: input.run.residents.map((resident) => ({
      entityId: resident.entityId,
      endpoint: resident.viewer?.endpoint ?? null,
      state: 'closed',
      authority: 'operator_only',
    })),
    lives,
    textile: {
      presenterProfile: 'org.behold.inhabitant.v1',
      import: 'original Lync source files; no Behold-side rendering or rewriting',
    },
  };
  const record = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  writeJsonExclusive(input.file, record);
  return Object.freeze({ file: input.file, record });
}

function listLyncFiles(directory: string) {
  if (!fs.existsSync(directory)) return Object.freeze([]);
  return Object.freeze(
    fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.lync'))
      .map((entry) => {
        const file = path.join(directory, entry.name);
        return Object.freeze({ file, sha256: sha256File(file), sizeBytes: fs.statSync(file).size });
      })
      .sort((left, right) => left.file.localeCompare(right.file)),
  );
}

function nextEpisodeId(episodesRoot: string) {
  const ordinal =
    Math.max(
      0,
      ...fs
        .readdirSync(episodesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^[0-9]{6}$/.test(entry.name))
        .map((entry) => Number(entry.name)),
    ) + 1;
  return String(ordinal).padStart(6, '0');
}

function findRepositoryRoot() {
  const candidates = [process.cwd(), path.resolve(__dirname, '..', '..', '..')];
  for (const candidate of candidates) {
    try {
      const manifest = readJson(path.join(candidate, 'package.json'));
      if (manifest.name === 'behold') return fs.realpathSync.native(candidate);
    } catch {}
  }
  throw new Error('behold live must run from a built Behold checkout');
}

function assertCleanCheckout(root: string, label: string) {
  const revision = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const status = spawnSync(
    'git',
    ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all'],
    { encoding: 'utf8' },
  );
  if (revision.status !== 0 || status.status !== 0 || status.stdout.length > 0) {
    throw new Error(`${label} live entry requires a clean recorded checkout`);
  }
  return revision.stdout.trim();
}

function optionalInteger(value: unknown, option: string, minimum: number, maximum: number) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${option} must be an integer from ${minimum} through ${maximum}`);
  }
  return number;
}

function safeSegment(value: unknown, label: string) {
  const segment = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(segment)) {
    throw new Error(`${label} must be a safe bounded identifier`);
  }
  return segment;
}

function plainDirectory(value: string, label: string) {
  const resolved = path.resolve(value);
  const stats = fs.lstatSync(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error(`${label} must be a plain directory`);
  return fs.realpathSync.native(resolved);
}

function plainFile(value: string, label: string) {
  const resolved = path.resolve(value);
  const stats = fs.lstatSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a plain file`);
  return fs.realpathSync.native(resolved);
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(plainFile(file, 'JSON file'), 'utf8'));
}

function writeJsonExclusive(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function sha256File(file: string) {
  return createHash('sha256')
    .update(fs.readFileSync(plainFile(file, 'digest input')))
    .digest('hex');
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function liveUsage() {
  return [
    'Usage:',
    '  behold live RELEASE --residents FILE --accept-eula [options]',
    '',
    'Runs or resumes one persistent Place world with independently configured residents.',
    '',
    'Options:',
    '  --duration SECONDS              Live time after all residents are ready (default 300)',
    '  --session ID                   Stable session name; the exact repeat resumes it',
    '  --state DIRECTORY              Parent for persistent world/lives/history',
    '  --port PORT                    Loopback Minecraft port (default 25565)',
    '  --viewer-base-port PORT        First resident POV (default 3007)',
    '  --viewer-distance CHUNKS       POV view distance, 2-16 (default 6)',
    '  --place-compiler DIRECTORY     Exact Place Compiler checkout',
    '  --server-jar FILE              Pinned Minecraft server JAR for Place serve',
    '  --max-model-concurrency N      Concurrent local cognition (default min(2, residents))',
    '  --lmstudio-models-root DIR     Exact local LM Studio artifact root',
    '',
    'Residents keep their declared human-semantic body, charter, model transport, and durable',
    'attempt ceilings. The ceiling is safety/resource governance, not a fairness claim.',
  ].join('\n');
}
