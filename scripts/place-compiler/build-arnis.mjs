#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lockPath = path.join(repositoryRoot, 'docs/sf-world/tool-lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const official = lock.tools.arnisOfficial;
const patched = lock.tools.arnisPatched;

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const outputDirectory = path.join(repositoryRoot, path.dirname(patched.path));
const outputBinary = path.join(repositoryRoot, patched.path);
if (existsSync(outputDirectory))
  throw new Error(`Refusing to replace existing build artifact: ${outputDirectory}`);

const sourceArchive = path.join(
  repositoryRoot,
  '.behold-artifacts/sf/tools/arnis-v3.0.0-source.tar.gz',
);
if ((await sha256(sourceArchive)) !== official.sourceArchiveSha256)
  throw new Error('Arnis source archive digest does not match the tool lock');

const patches = patched.patchPaths ?? [patched.patchPath];
const temporaryRoot = path.join(
  repositoryRoot,
  '.behold-artifacts/sf/build/arnis-v3.0.0-minecraft-legible-v1',
);
if (existsSync(temporaryRoot))
  throw new Error(`Refusing to replace existing build workspace: ${temporaryRoot}`);
mkdirSync(temporaryRoot, { recursive: true });
try {
  run('tar', ['-xzf', sourceArchive, '-C', temporaryRoot], repositoryRoot);
  const source = path.join(temporaryRoot, `arnis-${patched.baseVersion}`);
  for (const relativePatch of patches) {
    const patchFile = path.join(repositoryRoot, relativePatch);
    const result = spawnSync('patch', ['-p1', '-i', patchFile], {
      cwd: source,
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error(`Failed to apply ${relativePatch}`);
  }
  const buildEnvironment = {
    ...process.env,
    CARGO_INCREMENTAL: '0',
    SOURCE_DATE_EPOCH: '1752221452',
    RUSTFLAGS: `--remap-path-prefix=${source}=/build/arnis-3.0.0`,
  };
  run('cargo', ['test', '--release', '--no-default-features'], source, buildEnvironment);
  run('cargo', ['build', '--release', '--no-default-features'], source, buildEnvironment);

  mkdirSync(outputDirectory, { recursive: false });
  copyFileSync(path.join(source, 'target/release/arnis'), outputBinary);
  const binarySha256 = await sha256(outputBinary);
  const manifest = {
    schemaVersion: 1,
    base: { project: 'louis-e/arnis', version: patched.baseVersion },
    sourceArchive: {
      path: path.relative(repositoryRoot, sourceArchive),
      sizeBytes: statSync(sourceArchive).size,
      sha256: official.sourceArchiveSha256,
    },
    patches: await Promise.all(
      patches.map(async (relativePatch) => ({
        path: relativePatch,
        sha256: await sha256(path.join(repositoryRoot, relativePatch)),
      })),
    ),
    build: {
      command: patched.buildCommand,
      testCommand: 'cargo test --release --no-default-features',
      environment: {
        CARGO_INCREMENTAL: buildEnvironment.CARGO_INCREMENTAL,
        SOURCE_DATE_EPOCH: buildEnvironment.SOURCE_DATE_EPOCH,
        RUSTFLAGS: buildEnvironment.RUSTFLAGS.replace(source, '/stable/source'),
      },
      binary: path.basename(outputBinary),
      sizeBytes: statSync(outputBinary).size,
      sha256: binarySha256,
    },
  };
  writeFileSync(
    path.join(outputDirectory, 'build-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (binarySha256 !== patched.sha256)
    throw new Error(`Built binary digest ${binarySha256} does not match locked ${patched.sha256}`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
