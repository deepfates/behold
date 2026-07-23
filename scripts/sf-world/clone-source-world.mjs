#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptRoot, '../..');
const forbiddenRuntimeRoot = path.join(repositoryRoot, '.behold-runtime');

function usage() {
  console.error(
    'Usage: clone-source-world.mjs --source-world PATH --destination PATH [--copy-mode clone|full]',
  );
}

function parseArguments(argv) {
  const options = { sourceWorld: null, destination: null, copyMode: 'clone' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--source-world') options.sourceWorld = path.resolve(argv[++index]);
    else if (argument === '--destination') options.destination = path.resolve(argv[++index]);
    else if (argument === '--copy-mode') options.copyMode = argv[++index];
    else {
      usage();
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (
    !options.sourceWorld ||
    !options.destination ||
    !['clone', 'full'].includes(options.copyMode)
  ) {
    usage();
    throw new Error('Source, destination, and a valid copy mode are required');
  }
  return options;
}

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function run(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`${command} failed with code ${code ?? 'null'} signal ${signal ?? 'none'}`),
        );
    });
  });
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

const options = parseArguments(process.argv.slice(2));
if (!existsSync(options.sourceWorld))
  throw new Error(`Missing source world: ${options.sourceWorld}`);
if (existsSync(options.destination))
  throw new Error(`Refusing to overwrite destination: ${options.destination}`);
if (
  isWithin(options.destination, options.sourceWorld) ||
  isWithin(options.sourceWorld, options.destination)
) {
  throw new Error('Source and destination must not contain each other');
}
if (isWithin(options.destination, forbiddenRuntimeRoot)) {
  throw new Error(`Refusing to write inside Behold's live runtime tree: ${options.destination}`);
}
for (const required of ['level.dat', 'metadata.json', 'region']) {
  if (!existsSync(path.join(options.sourceWorld, required))) {
    throw new Error(`Source world is missing ${required}: ${options.sourceWorld}`);
  }
}
if (existsSync(path.join(options.sourceWorld, 'session.lock'))) {
  throw new Error(`Refusing to clone a source world with session.lock: ${options.sourceWorld}`);
}
if (!readdirSync(path.join(options.sourceWorld, 'region')).some((name) => name.endsWith('.mca'))) {
  throw new Error(`Source world has no region files: ${options.sourceWorld}`);
}

const destinationParent = path.dirname(options.destination);
mkdirSync(destinationParent, { recursive: true });
const manifestPath = path.join(
  destinationParent,
  `${path.basename(options.destination)}-copy-manifest.json`,
);
if (existsSync(manifestPath))
  throw new Error(`Refusing to overwrite copy manifest: ${manifestPath}`);

const copyArguments = options.copyMode === 'clone' ? ['-cR'] : ['-R'];
await run('cp', [...copyArguments, options.sourceWorld, options.destination]);

if (existsSync(path.join(options.destination, 'session.lock'))) {
  throw new Error(`Unexpected session.lock in copied world: ${options.destination}`);
}
const sourceMetadataSha256 = await sha256(path.join(options.sourceWorld, 'metadata.json'));
const destinationMetadataSha256 = await sha256(path.join(options.destination, 'metadata.json'));
if (sourceMetadataSha256 !== destinationMetadataSha256)
  throw new Error('Copied metadata checksum mismatch');

const sourceRunRoot = path.resolve(options.sourceWorld, '../..');
const generationManifestPath = path.join(sourceRunRoot, 'generation-manifest.json');
const generationManifest = existsSync(generationManifestPath)
  ? JSON.parse(readFileSync(generationManifestPath, 'utf8'))
  : null;
const manifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  copyMode: options.copyMode === 'clone' ? 'APFS clone' : 'full recursive copy',
  sourceWorld: options.sourceWorld,
  destination: options.destination,
  sourceRunId: generationManifest?.runId ?? null,
  sourceTreeSha256: generationManifest?.sourceWorld?.treeSha256 ?? null,
  metadataSha256: sourceMetadataSha256,
  sessionLockPresent: false,
  liveBeholdRuntimeTouched: false,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({ ...manifest, manifestPath }, null, 2)}\n`);
