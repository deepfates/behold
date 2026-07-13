#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function parse(argv) {
  const out = { runRoot: null, output: null, includeInputs: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--run-root') out.runRoot = path.resolve(argv[++i]);
    else if (argv[i] === '--output') out.output = path.resolve(argv[++i]);
    else if (argv[i] === '--include-inputs') out.includeInputs = true;
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  if (!out.runRoot) throw new Error('--run-root is required');
  return out;
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const options = parse(process.argv.slice(2));
const generationPath = path.join(options.runRoot, 'generation-manifest.json');
const validationPath = path.join(options.runRoot, 'evidence', 'place-validation.json');
if (!existsSync(generationPath) || !existsSync(validationPath))
  throw new Error('run lacks generation or validation evidence');
const generation = JSON.parse(readFileSync(generationPath, 'utf8'));
const validation = JSON.parse(readFileSync(validationPath, 'utf8'));
if (generation.status !== 'generated' || validation.status !== 'accepted')
  throw new Error('run is not accepted');
const worldParent = path.join(options.runRoot, 'output');
const worlds = readdirSync(worldParent).filter((name) => name.startsWith('Arnis World '));
if (worlds.length !== 1 || existsSync(path.join(worldParent, worlds[0], 'session.lock')))
  throw new Error('source world missing, ambiguous, or locked');
const placeId = generation.place.id;
const runId = generation.runId;
const output = options.output ?? path.join(options.runRoot, '..', '..', 'releases', runId);
const archives = [
  {
    role: 'immutable-world',
    file: `${placeId}-world-${runId}.tar.gz`,
    cwd: worldParent,
    entries: worlds,
  },
  {
    role: 'generation-evidence',
    file: `${placeId}-evidence-${runId}.tar.gz`,
    cwd: options.runRoot,
    entries: ['generation-manifest.json', 'evidence'],
  },
  {
    role: 'reproduction-kit',
    file: `${placeId}-reproduction-${runId}.tar.gz`,
    cwd: repositoryRoot,
    entries: [
      'docs/place-compiler',
      'scripts/place-compiler',
      'docs/sf-world/tool-lock.json',
      'docs/sf-world/tooling/arnis-v3.0.0-tall-heightmap.patch',
      'scripts/sf-world/run-recorded.mjs',
      'scripts/sf-world/tree-hash.mjs',
    ],
  },
];
if (options.includeInputs)
  archives.push({
    role: 'generation-inputs',
    file: `${placeId}-inputs-${runId}.tar.gz`,
    cwd: options.runRoot,
    entries: ['inputs', 'generator-home'],
  });
for (const archive of archives)
  for (const entry of archive.entries)
    if (!existsSync(path.join(archive.cwd, entry)))
      throw new Error(`missing ${archive.role} input: ${entry}`);
const plan = { placeId, runId, output, archives };
if (options.dryRun) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exit(0);
}
mkdirSync(output, { recursive: true });
for (const archive of archives) {
  const destination = path.join(output, archive.file);
  if (existsSync(destination)) throw new Error(`refusing to overwrite ${destination}`);
  await run('nice', [
    '-n',
    '10',
    'tar',
    '--format',
    'ustar',
    '--options',
    'gzip:compression-level=1,gzip:!timestamp',
    '--no-xattrs',
    '--uid',
    '0',
    '--gid',
    '0',
    '--uname',
    'root',
    '--gname',
    'root',
    '-czf',
    destination,
    '-C',
    archive.cwd,
    ...archive.entries,
  ]);
  archive.sizeBytes = statSync(destination).size;
  archive.sha256 = await sha256(destination);
}
const release = {
  schemaVersion: 2,
  compiler: 'behold-place-compiler',
  createdAt: new Date().toISOString(),
  placeId,
  placeName: generation.place.name,
  runId,
  source: {
    recipePath: generation.place.recipePath,
    recipeSha256: generation.place.recipeSha256,
    toolLockPath: generation.generator.toolLockPath,
    toolLockSha256: generation.generator.toolLockSha256,
    osmSha256: generation.inputs.sha256,
    worldTreeSha256: validation.evidence.worldTreeSha256,
  },
  runtimeProfiles: Object.keys(generation.place.runtimeProfiles),
  archives: archives.map(({ role, file, sizeBytes, sha256: digest }) => ({
    role,
    file,
    sizeBytes,
    sha256: digest,
  })),
};
const releasePath = path.join(output, 'release-manifest.json');
writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`, { flag: 'wx' });
writeFileSync(
  path.join(output, 'SHA256SUMS'),
  `${[...release.archives.map((item) => `${item.sha256}  ${item.file}`), `${await sha256(releasePath)}  release-manifest.json`].join('\n')}\n`,
  { flag: 'wx' },
);
process.stdout.write(`${JSON.stringify(release, null, 2)}\n`);
