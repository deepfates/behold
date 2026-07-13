#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptRoot, '../..');

function usage() {
  console.error(
    'Usage: package-release.mjs --run-root PATH [--atlas PATH] [--output PATH] [--include-inputs] [--dry-run]',
  );
}

function parseArguments(argv) {
  const options = { runRoot: null, atlas: null, output: null, includeInputs: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--run-root') options.runRoot = path.resolve(argv[++index]);
    else if (argument === '--atlas') options.atlas = path.resolve(argv[++index]);
    else if (argument === '--output') options.output = path.resolve(argv[++index]);
    else if (argument === '--include-inputs') options.includeInputs = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else {
      usage();
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (!options.runRoot) {
    usage();
    throw new Error('--run-root is required');
  }
  return options;
}

function run(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      stdio: 'inherit',
    });
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

function archivePlan(options) {
  const runId = path.basename(options.runRoot);
  const output = options.output ?? path.resolve(options.runRoot, '../../../releases', runId);
  const worldParent = path.join(options.runRoot, 'output');
  const worldNames = readdirSync(worldParent).filter((name) => name.startsWith('Arnis World '));
  if (worldNames.length !== 1) {
    throw new Error(
      `Expected exactly one generated Arnis world under ${worldParent}; found ${worldNames.length}`,
    );
  }
  const [worldName] = worldNames;
  const worldPath = path.join(worldParent, worldName);
  if (existsSync(path.join(worldPath, 'session.lock'))) {
    throw new Error(`Refusing to package a world with session.lock: ${worldPath}`);
  }

  const archives = [
    {
      role: 'immutable-world',
      path: path.join(output, `sf-world-${runId}.tar.gz`),
      cwd: worldParent,
      entries: [worldName],
    },
    {
      role: 'generation-evidence',
      path: path.join(output, `sf-evidence-${runId}.tar.gz`),
      cwd: options.runRoot,
      entries: ['generation-manifest.json', 'evidence'],
    },
    {
      role: 'reproduction-kit',
      path: path.join(output, `sf-reproduction-${runId}.tar.gz`),
      cwd: repositoryRoot,
      entries: [
        'docs/sf-world/README.md',
        'docs/sf-world/tool-lock.json',
        'docs/sf-world/landmarks.json',
        'docs/sf-world/research',
        'docs/sf-world/reports/validation-report.template.md',
        'docs/sf-world/tooling',
        'docs/sf-world/manifests/generation-manifest.template.json',
        'scripts/sf-world',
      ],
    },
  ];
  if (options.includeInputs) {
    archives.push({
      role: 'generation-inputs',
      path: path.join(output, `sf-inputs-${runId}.tar.gz`),
      cwd: options.runRoot,
      entries: ['inputs'],
    });
  }
  if (options.atlas) {
    const atlasRoot = path.dirname(options.atlas);
    const renderEvidenceEntries = readdirSync(atlasRoot, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith('render') &&
          existsSync(path.join(atlasRoot, entry.name, 'evidence/process.json')),
      )
      .map((entry) => `${entry.name}/evidence`)
      .sort();
    if (renderEvidenceEntries.length === 0) {
      throw new Error(`No recorded BlueMap render evidence found under ${atlasRoot}`);
    }
    archives.push({
      role: 'bluemap-atlas',
      path: path.join(output, `sf-atlas-${runId}.tar.gz`),
      cwd: atlasRoot,
      entries: [path.basename(options.atlas)],
    });
    archives.push({
      role: 'bluemap-evidence',
      path: path.join(output, `sf-atlas-evidence-${runId}.tar.gz`),
      cwd: atlasRoot,
      entries: ['config', 'logs', 'evidence', ...renderEvidenceEntries],
    });
  }
  for (const archive of archives) {
    for (const entry of archive.entries) {
      if (!existsSync(path.join(archive.cwd, entry))) {
        throw new Error(`Missing ${archive.role} input: ${path.join(archive.cwd, entry)}`);
      }
    }
  }
  return { runId, output, worldPath, archives };
}

const options = parseArguments(process.argv.slice(2));
if (!existsSync(options.runRoot)) throw new Error(`Missing run root: ${options.runRoot}`);
if (options.atlas && !existsSync(options.atlas)) throw new Error(`Missing atlas: ${options.atlas}`);
const plan = archivePlan(options);
if (options.dryRun) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exit(0);
}

mkdirSync(plan.output, { recursive: true });
for (const archive of plan.archives) {
  if (existsSync(archive.path)) throw new Error(`Refusing to overwrite archive: ${archive.path}`);
  if (archive.role === 'immutable-world' && existsSync(path.join(plan.worldPath, 'session.lock'))) {
    throw new Error(`Source world became locked before packaging: ${plan.worldPath}`);
  }
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
    archive.path,
    '-C',
    archive.cwd,
    ...archive.entries,
  ]);
  archive.sizeBytes = statSync(archive.path).size;
  archive.sha256 = await sha256(archive.path);
}

const releaseManifest = {
  schemaVersion: 1,
  runId: plan.runId,
  createdAt: new Date().toISOString(),
  sourceRunRoot: options.runRoot,
  sourceWorld: plan.worldPath,
  packaging: {
    format: 'ustar+gzip',
    compressionLevel: 1,
    nice: 10,
    gzipTimestamp: false,
    extendedAttributes: false,
    uid: 0,
    gid: 0,
    uname: 'root',
    gname: 'root',
  },
  archives: plan.archives.map(({ role, path: archivePath, sizeBytes, sha256: digest }) => ({
    role,
    file: path.basename(archivePath),
    sizeBytes,
    sha256: digest,
  })),
};
const manifestPath = path.join(plan.output, 'release-manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`, { flag: 'wx' });
const manifestSha256 = await sha256(manifestPath);
const checksumLines = [
  ...releaseManifest.archives.map((archive) => `${archive.sha256}  ${archive.file}`),
  `${manifestSha256}  ${path.basename(manifestPath)}`,
];
writeFileSync(path.join(plan.output, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`, {
  flag: 'wx',
});
process.stdout.write(`${JSON.stringify(releaseManifest, null, 2)}\n`);
