#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './core.mjs';
import { archive, copyNormalized, indexTree, json, safeRelative } from './foundry-release-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const contractPath = path.resolve(
  option('--contract', path.join(root, 'docs/place-compiler/releases/living-city-foundry-v2.json')),
);
const output = path.resolve(
  option('--output', path.join(root, '.behold-artifacts/place-releases/living-city-foundry-v2')),
);
if (
  args.some((value, index) => value.startsWith('--') && !['--contract', '--output'].includes(value))
)
  throw new Error('usage: package-foundry-release.mjs [--contract file] [--output directory]');
if (existsSync(output)) throw new Error(`release exists: ${output}`);
const contract = json(contractPath);
if (contract.schemaVersion !== 1 || contract.kind !== 'living-city-foundry-release-contract')
  throw new Error('unsupported foundry release contract');

const stage = path.join(output, '.stage');
mkdirSync(stage, { recursive: true });
const copied = new Set();
const add = (source, relative = path.relative(root, source)) => {
  const safe = safeRelative(relative);
  if (copied.has(safe)) return;
  copyNormalized(source, stage, safe);
  copied.add(safe);
};
const verifyAdd = async (relative, expected) => {
  const source = path.join(root, safeRelative(relative));
  if ((await sha256(source)) !== expected) throw new Error(`contract digest mismatch: ${relative}`);
  add(source, relative);
};

try {
  add(contractPath, 'contract/living-city-foundry-v2.json');
  await verifyAdd(contract.evidenceSet.path, contract.evidenceSet.sha256);
  const evidenceSet = json(path.join(root, contract.evidenceSet.path));
  if (
    evidenceSet.benchmark.id !== contract.benchmarkId ||
    evidenceSet.plan.expectedCaseCount !== 24
  )
    throw new Error('evidence set identity/cardinality mismatch');
  await verifyAdd(evidenceSet.benchmark.path, evidenceSet.benchmark.sha256);
  for (const lane of Object.values(evidenceSet.lanes)) {
    const manifest = path.join(lane.root, lane.manifestPath);
    if ((await sha256(path.join(root, manifest))) !== lane.manifestSha256)
      throw new Error(`lane digest mismatch: ${manifest}`);
    for (const file of lane.referencedFiles) add(path.join(root, file), `evidence/${file}`);
  }
  for (const visit of contract.humanVisits) {
    await verifyAdd(visit.path, visit.sha256);
    const report = json(path.join(root, visit.path));
    if (report.status !== 'completed' || report.placeId !== visit.placeId)
      throw new Error(`invalid visit: ${visit.placeId}`);
    const visitRoot = path.dirname(visit.path);
    for (const item of report.evidence) {
      const relative = typeof item === 'string' ? item : item.path;
      if (relative)
        add(path.join(root, visitRoot, relative), `visits/${visit.placeId}/${relative}`);
    }
  }
  for (const capacity of contract.capacity) {
    await verifyAdd(capacity.path, capacity.sha256);
    const capacityRoot = path.dirname(capacity.path);
    for (const name of readdirSync(path.join(root, capacityRoot)).sort()) {
      const source = path.join(root, capacityRoot, name);
      if (statSync(source).isFile()) add(source, `capacity/${path.basename(capacityRoot)}/${name}`);
    }
  }
  for (const place of contract.placePackages) {
    await verifyAdd(`${place.root}/release-manifest.json`, place.manifestSha256);
    await verifyAdd(`${place.root}/SHA256SUMS`, place.checksumsSha256);
  }
  await verifyAdd(contract.beholdEpochProof.path, contract.beholdEpochProof.sha256);
  const proof = json(path.join(root, contract.beholdEpochProof.path));
  for (const entry of proof.entries)
    add(
      path.join(root, path.dirname(contract.beholdEpochProof.path), entry.path),
      `behold-epoch/${entry.path}`,
    );

  const tracked = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  if (tracked.status !== 0) throw new Error('cannot enumerate reproduction sources');
  for (const relative of tracked.stdout
    .trim()
    .split('\n')
    .filter(
      (file) =>
        file === 'package.json' ||
        file === 'package-lock.json' ||
        file === 'tsconfig.json' ||
        file === 'scripts/native-client.ts' ||
        file.startsWith('scripts/place-compiler/') ||
        file.startsWith('docs/place-compiler/') ||
        file.startsWith('tests/place-') ||
        file.startsWith('tests/living-places'),
    ))
    add(path.join(root, relative), `reproduction/${relative}`);

  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (commit.status !== 0) throw new Error('cannot resolve commit');
  const index = {
    schemaVersion: 1,
    kind: 'living-city-foundry-release',
    releaseId: contract.id,
    benchmarkId: contract.benchmarkId,
    gitCommit: commit.stdout.trim(),
    places: contract.placePackages.map((item) => item.placeId),
    stories: {
      inspection: 3,
      ecologyDays: 3,
      performanceCases: 18,
      humanVisits: 3,
      capturedVisits: contract.humanVisits.filter((item) => item.captureRequired).length,
      beholdEpochProofs: 1,
    },
    frontiers: contract.frontiers,
    entries: await indexTree(stage),
  };
  writeFileSync(path.join(stage, 'FOUNDry-MANIFEST.json'), `${JSON.stringify(index, null, 2)}\n`, {
    flag: 'wx',
  });
  mkdirSync(output, { recursive: true });
  const archiveName = `${contract.id}.tar.gz`;
  const archived = await archive(stage, path.join(output, archiveName));
  const release = {
    ...index,
    entries: undefined,
    archive: { file: archiveName, ...archived },
    contentEntries: index.entries.length,
    contentTreeSha256: await sha256(path.join(stage, 'FOUNDry-MANIFEST.json')),
  };
  writeFileSync(
    path.join(output, 'release-manifest.json'),
    `${JSON.stringify(release, null, 2)}\n`,
    { flag: 'wx' },
  );
  writeFileSync(
    path.join(output, 'SHA256SUMS'),
    `${archived.sha256}  ${archiveName}\n${await sha256(path.join(output, 'release-manifest.json'))}  release-manifest.json\n`,
    { flag: 'wx' },
  );
  process.stdout.write(`${JSON.stringify({ output, release }, null, 2)}\n`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
