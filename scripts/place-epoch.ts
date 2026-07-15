#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  digestTree,
  TREE_DIGEST_PROFILE,
  worldLabDefinitionDigest,
  type WorldLabDefinition,
} from './world-lab';

export const PLACE_EPOCH_PROTOCOL = 'behold.place-epoch-admission.v1' as const;

type JsonRecord = Record<string, any>;

export type PlaceEpochAdmissionOptions = Readonly<{
  releaseRoot: string;
  profileId: string;
  destinationRoot: string;
  serverJar: string;
  expectedServerJarSha256: string;
  port: number;
  progress?: (event: PlaceEpochProgressEvent) => void;
}>;

export type PlaceEpochProgressEvent = Readonly<{
  protocol: 'behold.place-epoch-progress.v1';
  at: string;
  stage: string;
  status: 'started' | 'completed' | 'failed';
  detail?: unknown;
}>;

export type PlaceEpochDescriptor = Readonly<{
  protocol: typeof PLACE_EPOCH_PROTOCOL;
  worldId: string;
  place: Readonly<{
    id: string;
    runId: string;
    releaseManifestSha256: string;
    releaseChecksumsSha256: string;
    worldArchiveSha256: string;
    evidenceArchiveSha256: string;
    declaredWorldTreeSha256: string;
    verifiedWorldTreeSha256: string;
  }>;
  profile: Readonly<{ id: string; sha256: string; definition: JsonRecord }>;
  behold: Readonly<{
    sourceTree: ReturnType<typeof digestTree>;
    baselineTree: ReturnType<typeof digestTree>;
    serverJarSha256: string;
    worldDefinitionSha256: string;
  }>;
  paths: Readonly<{
    source: string;
    baseline: string;
    runtime: string;
    archiveRoot: string;
    serverDirectory: string;
    worldDefinition: string;
  }>;
}>;

export function admitPlaceRelease(options: PlaceEpochAdmissionOptions): PlaceEpochDescriptor {
  const progress = createProgress(options.progress);
  const releaseRoot = path.resolve(options.releaseRoot);
  const destinationRoot = path.resolve(options.destinationRoot);
  const serverJar = path.resolve(options.serverJar);
  assertSafePort(options.port);
  assertSha256(options.expectedServerJarSha256, 'expected server JAR digest');
  if (fs.existsSync(destinationRoot)) {
    throw new Error(`Place epoch destination already exists: ${destinationRoot}`);
  }
  if (sha256File(serverJar) !== options.expectedServerJarSha256.toLowerCase()) {
    throw new Error('Pinned Minecraft server JAR digest mismatch');
  }

  progress('release-verification', 'started', { releaseRoot });
  const verified = verifyPlaceRelease(releaseRoot);
  progress('release-verification', 'completed', {
    placeId: verified.manifest.placeId,
    runId: verified.manifest.runId,
    releaseManifestSha256: verified.releaseManifestSha256,
  });
  const manifest = verified.manifest;
  if (!manifest.runtimeProfiles.includes(options.profileId)) {
    throw new Error(`Place release does not publish profile ${options.profileId}`);
  }
  const worldArchive = archiveForRole(manifest, 'immutable-world');
  const evidenceArchive = archiveForRole(manifest, 'generation-evidence');

  const parent = path.dirname(destinationRoot);
  fs.mkdirSync(parent, { recursive: true });
  const stage = fs.mkdtempSync(path.join(parent, `.${path.basename(destinationRoot)}.stage-`));
  try {
    const extractedWorld = path.join(stage, 'extracted-world');
    const extractedEvidence = path.join(stage, 'extracted-evidence');
    progress('archive-extraction', 'started', {
      worldArchive: worldArchive.file,
      evidenceArchive: evidenceArchive.file,
    });
    extractVerifiedArchive(path.join(releaseRoot, worldArchive.file), extractedWorld);
    extractVerifiedArchive(path.join(releaseRoot, evidenceArchive.file), extractedEvidence);
    progress('archive-extraction', 'completed');
    const worldDirectory = findSingleWorldDirectory(extractedWorld);
    const generation = readJson(path.join(extractedEvidence, 'generation-manifest.json'));
    assertGenerationMatchesRelease(generation, manifest);
    const profile = generation.place.runtimeProfiles?.[options.profileId];
    if (!isRecord(profile))
      throw new Error(`Generation evidence lacks profile ${options.profileId}`);
    const verifiedWorldTreeSha256 = portablePlaceTreeDigest(worldDirectory);
    if (verifiedWorldTreeSha256 !== manifest.source.worldTreeSha256) {
      throw new Error(
        `Place world tree mismatch: expected ${manifest.source.worldTreeSha256}, got ${verifiedWorldTreeSha256}`,
      );
    }
    progress('place-tree-verification', 'completed', { verifiedWorldTreeSha256 });

    const source = path.join(stage, 'source');
    const baseline = path.join(stage, 'baseline');
    const serverDirectory = path.join(stage, 'server');
    const runtime = path.join(serverDirectory, 'world');
    const archiveRoot = path.join(stage, 'archive');
    fs.cpSync(worldDirectory, source, { recursive: true, errorOnExist: true, force: false });
    fs.cpSync(source, baseline, { recursive: true, errorOnExist: true, force: false });
    installProfileDatapack(baseline, options.profileId, profile);
    fs.mkdirSync(serverDirectory, { recursive: true });
    fs.cpSync(baseline, runtime, { recursive: true, errorOnExist: true, force: false });
    fs.mkdirSync(archiveRoot, { recursive: true });
    writeServerFiles(serverDirectory, manifest.placeName, options.profileId, profile, options.port);
    progress('profile-materialization', 'completed', { profileId: options.profileId });

    const sourceTree = digestTree(source);
    const baselineTree = digestTree(baseline);
    const profileSha256 = sha256Text(stableJson(profile));
    const topologySha256 = sha256Text(
      stableJson({
        protocol: PLACE_EPOCH_PROTOCOL,
        placeId: manifest.placeId,
        runId: manifest.runId,
        releaseManifestSha256: verified.releaseManifestSha256,
        worldArchiveSha256: worldArchive.sha256,
        placeWorldTreeSha256: verifiedWorldTreeSha256,
        profileId: options.profileId,
        profileSha256,
        serverJarSha256: options.expectedServerJarSha256.toLowerCase(),
        baselineTreeSha256: baselineTree.digest,
      }),
    );
    const worldId = safeWorldId(`${manifest.placeId}-${topologySha256.slice(0, 16)}`);
    const finalPaths = {
      source: path.join(destinationRoot, 'source'),
      baseline: path.join(destinationRoot, 'baseline'),
      runtime: path.join(destinationRoot, 'server', 'world'),
      archiveRoot: path.join(destinationRoot, 'archive'),
      serverDirectory: path.join(destinationRoot, 'server'),
      worldDefinition: path.join(destinationRoot, 'world-definition.json'),
    };
    const world: WorldLabDefinition = {
      label: `${manifest.placeName} · ${options.profileId} · admitted Place release`,
      source: {
        path: finalPaths.source,
        digestProfile: TREE_DIGEST_PROFILE,
        expectedDigest: sourceTree.digest,
      },
      preparedBaseline: {
        path: finalPaths.baseline,
        digestProfile: TREE_DIGEST_PROFILE,
        expectedDigest: baselineTree.digest,
      },
      runtime: { worldPath: finalPaths.runtime, archiveRoot: finalPaths.archiveRoot },
      server: { host: '127.0.0.1', port: options.port },
      notes: [
        `Place release ${manifest.runId}; manifest ${verified.releaseManifestSha256}.`,
        `Place tree ${verifiedWorldTreeSha256}; Behold baseline ${baselineTree.digest}.`,
        `Runtime profile ${options.profileId} (${profileSha256}).`,
      ],
    };
    const worldDefinitionSha256 = worldLabDefinitionDigest(world);
    const descriptor: PlaceEpochDescriptor = {
      protocol: PLACE_EPOCH_PROTOCOL,
      worldId,
      place: {
        id: manifest.placeId,
        runId: manifest.runId,
        releaseManifestSha256: verified.releaseManifestSha256,
        releaseChecksumsSha256: verified.releaseChecksumsSha256,
        worldArchiveSha256: worldArchive.sha256,
        evidenceArchiveSha256: evidenceArchive.sha256,
        declaredWorldTreeSha256: manifest.source.worldTreeSha256,
        verifiedWorldTreeSha256,
      },
      profile: { id: options.profileId, sha256: profileSha256, definition: profile },
      behold: {
        sourceTree,
        baselineTree,
        serverJarSha256: options.expectedServerJarSha256.toLowerCase(),
        worldDefinitionSha256,
      },
      paths: finalPaths,
    };
    writeJson(path.join(stage, 'world-definition.json'), {
      schemaVersion: 2,
      worlds: { [worldId]: world },
    });
    writeJson(path.join(stage, 'place-epoch.json'), descriptor);
    fs.renameSync(stage, destinationRoot);
    progress('admission', 'completed', { worldId, destinationRoot });
    return descriptor;
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    progress('admission', 'failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function createProgress(sink: PlaceEpochAdmissionOptions['progress']) {
  return (stage: string, status: PlaceEpochProgressEvent['status'], detail?: unknown) => {
    sink?.({
      protocol: 'behold.place-epoch-progress.v1',
      at: new Date().toISOString(),
      stage,
      status,
      ...(detail === undefined ? {} : { detail }),
    });
  };
}

export function verifyAdmittedPlaceEpoch(rootPath: string): PlaceEpochDescriptor {
  const root = path.resolve(rootPath);
  const descriptor = readJson(path.join(root, 'place-epoch.json')) as PlaceEpochDescriptor;
  if (descriptor.protocol !== PLACE_EPOCH_PROTOCOL) throw new Error('Unsupported Place epoch');
  const config = readJson(path.join(root, 'world-definition.json'));
  const world = config.worlds?.[descriptor.worldId] as WorldLabDefinition | undefined;
  if (!world) throw new Error('Admitted world definition is missing');
  for (const [name, expected] of [
    ['source', descriptor.behold.sourceTree],
    ['baseline', descriptor.behold.baselineTree],
  ] as const) {
    const actual = digestTree(path.join(root, name));
    if (actual.digest !== expected.digest) throw new Error(`${name} tree digest mismatch`);
  }
  if (worldLabDefinitionDigest(world) !== descriptor.behold.worldDefinitionSha256) {
    throw new Error('World definition digest mismatch');
  }
  if (sha256Text(stableJson(descriptor.profile.definition)) !== descriptor.profile.sha256) {
    throw new Error('Runtime profile digest mismatch');
  }
  const serverProperties = fs.readFileSync(path.join(root, 'server', 'server.properties'), 'utf8');
  if (!serverProperties.includes(`server-port=${world.server.port}\n`)) {
    throw new Error('Server profile port does not match world definition');
  }
  return descriptor;
}

function verifyPlaceRelease(root: string) {
  const manifestPath = path.join(root, 'release-manifest.json');
  const sumsPath = path.join(root, 'SHA256SUMS');
  const manifest = readJson(manifestPath);
  if (
    ![2, 3].includes(manifest.schemaVersion) ||
    manifest.compiler !== 'behold-place-compiler' ||
    !safeSegment(manifest.placeId) ||
    !safeSegment(manifest.runId) ||
    !Array.isArray(manifest.archives) ||
    !Array.isArray(manifest.runtimeProfiles) ||
    !isRecord(manifest.source)
  ) {
    throw new Error('Unsupported or malformed Place release manifest');
  }
  const sums = new Map<string, string>();
  for (const line of fs.readFileSync(sumsPath, 'utf8').trim().split('\n')) {
    const match = line.match(/^([a-f0-9]{64})  ([^/]+)$/);
    if (!match || sums.has(match[2])) throw new Error(`Malformed release checksum: ${line}`);
    sums.set(match[2], match[1]);
  }
  const roles = new Set<string>();
  for (const archive of manifest.archives) {
    if (
      !isRecord(archive) ||
      typeof archive.role !== 'string' ||
      roles.has(archive.role) ||
      path.basename(archive.file) !== archive.file ||
      !Number.isSafeInteger(archive.sizeBytes) ||
      archive.sizeBytes < 1
    ) {
      throw new Error('Malformed Place release archive record');
    }
    roles.add(archive.role);
    assertSha256(archive.sha256, `${archive.role} archive digest`);
    const file = path.join(root, archive.file);
    if (
      fs.statSync(file).size !== archive.sizeBytes ||
      sha256File(file) !== archive.sha256 ||
      sums.get(archive.file) !== archive.sha256
    ) {
      throw new Error(`Place release archive integrity failure: ${archive.file}`);
    }
    inspectArchive(file);
  }
  for (const role of ['immutable-world', 'generation-evidence', 'reproduction-kit']) {
    if (!roles.has(role)) throw new Error(`Place release is missing ${role}`);
  }
  const releaseManifestSha256 = sha256File(manifestPath);
  if (
    sums.get('release-manifest.json') !== releaseManifestSha256 ||
    sums.size !== manifest.archives.length + 1
  ) {
    throw new Error('Place release checksum closure failure');
  }
  return {
    manifest,
    releaseManifestSha256,
    releaseChecksumsSha256: sha256File(sumsPath),
  };
}

function inspectArchive(file: string) {
  const listing = spawnSync('/usr/bin/tar', ['-tzf', file], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (listing.status !== 0) throw new Error(`Cannot list Place archive: ${file}`);
  for (const entry of listing.stdout.split('\n').filter(Boolean)) {
    const normalized = entry.replace(/^\.\//, '');
    if (
      path.posix.isAbsolute(normalized) ||
      normalized.split('/').includes('..') ||
      normalized.includes('\0')
    ) {
      throw new Error(`Unsafe Place archive path: ${entry}`);
    }
  }
  const verbose = spawnSync('/usr/bin/tar', ['-tvzf', file], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (verbose.status !== 0) throw new Error(`Cannot inspect Place archive types: ${file}`);
  for (const line of verbose.stdout.split('\n').filter(Boolean)) {
    if (!['-', 'd'].includes(line[0])) throw new Error(`Unsafe Place archive entry type: ${line}`);
  }
}

function extractVerifiedArchive(file: string, destination: string) {
  inspectArchive(file);
  fs.mkdirSync(destination, { recursive: true });
  const result = spawnSync('/usr/bin/tar', ['-xzf', file, '-C', destination], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Cannot extract Place archive: ${result.stderr}`);
  assertPlainTree(destination);
}

function assertPlainTree(root: string) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw new Error(`Unsupported extracted entry: ${child}`);
    }
    if (entry.isDirectory()) assertPlainTree(child);
  }
}

function findSingleWorldDirectory(root: string) {
  const candidates: string[] = [];
  const visit = (directory: string) => {
    if (fs.existsSync(path.join(directory, 'level.dat'))) {
      candidates.push(directory);
      return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(path.join(directory, entry.name));
    }
  };
  visit(root);
  if (candidates.length !== 1)
    throw new Error(`Expected one packaged world, found ${candidates.length}`);
  if (fs.existsSync(path.join(candidates[0], 'session.lock'))) {
    throw new Error('Packaged Place world contains a session lock');
  }
  return candidates[0];
}

function portablePlaceTreeDigest(root: string) {
  const files: string[] = [];
  const visit = (directory: string, relative: string) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const portable = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full, portable);
      else if (entry.isFile()) files.push(portable);
      else throw new Error(`Unsupported Place tree entry: ${full}`);
    }
  };
  visit(root, '');
  const hash = createHash('sha256');
  for (const relative of files) {
    const file = path.join(root, ...relative.split('/'));
    hash.update(`${sha256File(file)}  ${fs.statSync(file).size}  ${relative}\n`);
  }
  return hash.digest('hex');
}

function installProfileDatapack(world: string, profileId: string, profile: JsonRecord) {
  const ecology = profile.ecology;
  const minecraft = profile.minecraft;
  if (!isRecord(ecology) || !isRecord(minecraft)) throw new Error('Malformed runtime profile');
  for (const key of ['daylightCycle', 'weatherCycle', 'mobSpawning']) {
    if (typeof ecology[key] !== 'boolean') throw new Error(`Runtime profile lacks ecology.${key}`);
  }
  if (!['peaceful', 'easy', 'normal', 'hard'].includes(minecraft.difficulty)) {
    throw new Error('Runtime profile has invalid difficulty');
  }
  const datapack = path.join(world, 'datapacks', 'behold-place-profile');
  const functions = path.join(datapack, 'data', 'behold_place_profile', 'function');
  const tags = path.join(datapack, 'data', 'minecraft', 'tags', 'function');
  fs.mkdirSync(functions, { recursive: true });
  fs.mkdirSync(tags, { recursive: true });
  writeJson(path.join(datapack, 'pack.mcmeta'), {
    pack: { pack_format: 61, description: `Behold admitted Place profile: ${profileId}` },
  });
  writeJson(path.join(tags, 'load.json'), { values: ['behold_place_profile:load'] });
  fs.writeFileSync(
    path.join(functions, 'load.mcfunction'),
    [
      `gamerule doDaylightCycle ${ecology.daylightCycle}`,
      `gamerule doWeatherCycle ${ecology.weatherCycle}`,
      `gamerule doMobSpawning ${ecology.mobSpawning}`,
      `difficulty ${minecraft.difficulty}`,
      '',
    ].join('\n'),
  );
}

function writeServerFiles(
  server: string,
  placeName: string,
  profileId: string,
  profile: JsonRecord,
  port: number,
) {
  const minecraft = profile.minecraft;
  const ecology = profile.ecology;
  const properties: Record<string, string | number | boolean> = {
    'allow-flight': true,
    difficulty: minecraft.difficulty,
    'enable-command-block': false,
    'enable-rcon': false,
    gamemode: minecraft.gameMode,
    'generate-structures': true,
    'level-name': 'world',
    'max-players': 20,
    motd: `${placeName} · ${profileId} · Behold epoch`,
    'online-mode': false,
    'server-port': port,
    'simulation-distance': minecraft.simulationDistance,
    'spectators-generate-chunks': true,
    'spawn-animals': ecology.mobSpawning,
    'spawn-monsters': ecology.mobSpawning,
    'spawn-npcs': ecology.mobSpawning,
    'spawn-protection': 0,
    'view-distance': minecraft.viewDistance,
  };
  fs.writeFileSync(
    path.join(server, 'server.properties'),
    `${Object.entries(properties)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  );
  fs.writeFileSync(path.join(server, 'eula.txt'), 'eula=true\n');
}

function assertGenerationMatchesRelease(generation: JsonRecord, release: JsonRecord) {
  if (
    generation.status !== 'generated' ||
    generation.runId !== release.runId ||
    generation.place?.id !== release.placeId ||
    generation.place?.recipeSha256 !== release.source.recipeSha256 ||
    generation.inputs?.sha256 !== release.source.osmSha256
  ) {
    throw new Error('Generation evidence does not match the Place release');
  }
}

function archiveForRole(manifest: JsonRecord, role: string) {
  const matches = manifest.archives.filter((archive: JsonRecord) => archive.role === role);
  if (matches.length !== 1) throw new Error(`Place release requires exactly one ${role} archive`);
  return matches[0];
}

function readJson(file: string): JsonRecord {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function sha256File(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256Text(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeSegment(value: unknown) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function safeWorldId(value: string) {
  if (!safeSegment(value)) throw new Error(`Unsafe Behold world id: ${value}`);
  return value;
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertSafePort(port: number) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid loopback port: ${port}`);
  }
}

function usage() {
  return [
    'Usage:',
    '  place-epoch admit --release <release-dir> --profile <id> --destination <dir> --server-jar <jar> --server-sha256 <digest> [--port <port>]',
    '  place-epoch verify --root <admitted-dir>',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const parsed = parseArgs({
    args: argv.slice(1),
    options: {
      release: { type: 'string' },
      profile: { type: 'string' },
      destination: { type: 'string' },
      'server-jar': { type: 'string' },
      'server-sha256': { type: 'string' },
      port: { type: 'string', default: '25585' },
      root: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help || !command) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === 'verify') {
    if (!parsed.values.root) throw new Error('--root is required');
    const descriptor = verifyAdmittedPlaceEpoch(String(parsed.values.root));
    process.stdout.write(`${JSON.stringify({ status: 'verified', descriptor }, null, 2)}\n`);
    return;
  }
  if (command !== 'admit') throw new Error(`Unknown command: ${command}`);
  for (const name of [
    'release',
    'profile',
    'destination',
    'server-jar',
    'server-sha256',
  ] as const) {
    if (!parsed.values[name]) throw new Error(`--${name} is required`);
  }
  const descriptor = admitPlaceRelease({
    releaseRoot: String(parsed.values.release),
    profileId: String(parsed.values.profile),
    destinationRoot: String(parsed.values.destination),
    serverJar: String(parsed.values['server-jar']),
    expectedServerJarSha256: String(parsed.values['server-sha256']),
    port: Number(parsed.values.port),
    progress: (event) => process.stderr.write(`${JSON.stringify(event)}\n`),
  });
  process.stdout.write(`${JSON.stringify({ status: 'admitted', descriptor }, null, 2)}\n`);
}

if (require.main === module) {
  void main().catch((error: any) => {
    process.stderr.write(`[place-epoch] ${error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
