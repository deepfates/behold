#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

const releaseRoot = path.resolve(process.argv[2] ?? '.');
const checksumPath = path.join(releaseRoot, 'SHA256SUMS');
const manifestPath = path.join(releaseRoot, 'release-manifest.json');
if (!existsSync(checksumPath) || !existsSync(manifestPath)) {
  throw new Error(`Release is missing SHA256SUMS or release-manifest.json: ${releaseRoot}`);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entries = readFileSync(checksumPath, 'utf8')
  .trim()
  .split('\n')
  .map((line) => {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) throw new Error(`Malformed checksum line: ${line}`);
    return { expected: match[1], file: match[2] };
  });

const checksumByFile = new Map();
for (const entry of entries) {
  if (checksumByFile.has(entry.file)) throw new Error(`Duplicate checksum entry: ${entry.file}`);
  if (entry.file.includes('/') || entry.file === '.' || entry.file === '..') {
    throw new Error(`Unsafe checksum filename: ${entry.file}`);
  }
  checksumByFile.set(entry.file, entry.expected);
}

if (manifest.schemaVersion !== 1 || !manifest.runId || !Array.isArray(manifest.archives)) {
  throw new Error('Malformed release-manifest.json');
}
const allowedRoles = new Set([
  'immutable-world',
  'generation-evidence',
  'reproduction-kit',
  'generation-inputs',
  'bluemap-atlas',
  'bluemap-evidence',
]);
const seenRoles = new Set();
const manifestFiles = new Set();
for (const archive of manifest.archives) {
  if (!allowedRoles.has(archive.role) || seenRoles.has(archive.role)) {
    throw new Error(`Unexpected or duplicate archive role: ${archive.role}`);
  }
  seenRoles.add(archive.role);
  if (path.basename(archive.file) !== archive.file)
    throw new Error(`Unsafe archive filename: ${archive.file}`);
  if (manifestFiles.has(archive.file))
    throw new Error(`Duplicate archive filename: ${archive.file}`);
  manifestFiles.add(archive.file);
  if (!Number.isSafeInteger(archive.sizeBytes) || archive.sizeBytes <= 0) {
    throw new Error(`Invalid archive size for ${archive.file}`);
  }
  if (!/^[a-f0-9]{64}$/.test(archive.sha256))
    throw new Error(`Invalid SHA-256 for ${archive.file}`);
  if (checksumByFile.get(archive.file) !== archive.sha256) {
    throw new Error(`Manifest/checksum disagreement for ${archive.file}`);
  }
}
const missingRequiredRoles = ['immutable-world', 'generation-evidence', 'reproduction-kit'].filter(
  (role) => !seenRoles.has(role),
);
if (missingRequiredRoles.length > 0)
  throw new Error(`Missing archive roles: ${missingRequiredRoles.join(', ')}`);
if (!checksumByFile.has('release-manifest.json')) {
  throw new Error('SHA256SUMS does not cover release-manifest.json');
}
const expectedChecksumFiles = new Set([...manifestFiles, 'release-manifest.json']);
for (const file of checksumByFile.keys()) {
  if (!expectedChecksumFiles.delete(file)) throw new Error(`Unexpected checksum entry: ${file}`);
}
if (expectedChecksumFiles.size > 0) {
  throw new Error(`Missing checksum entries: ${[...expectedChecksumFiles].join(', ')}`);
}

function archiveRequirements(role) {
  if (role === 'immutable-world') return ['level.dat', 'metadata.json', '.mca'];
  if (role === 'generation-evidence')
    return ['generation-manifest.json', 'evidence/process.json', 'evidence/world-checksums.json'];
  if (role === 'reproduction-kit') {
    return [
      'docs/sf-world/README.md',
      'docs/sf-world/tool-lock.json',
      'docs/sf-world/landmarks.json',
      'docs/sf-world/research/2026-07-13-generator-atlas-and-bounds.md',
      'docs/sf-world/reports/validation-report.template.md',
      'docs/sf-world/tooling/arnis-v3.0.0-tall-heightmap.patch',
      'scripts/sf-world/generate.mjs',
      'scripts/sf-world/configure-bluemap.mjs',
      'scripts/sf-world/package-release.mjs',
      'scripts/sf-world/requirements.txt',
    ];
  }
  if (role === 'generation-inputs')
    return [
      'inputs/source-manifest.json',
      'inputs/enrichment-manifest.json',
      'inputs/SanFrancisco.osm.pbf',
      'inputs/SanFrancisco-overpass.json',
      'inputs/arnis-cache/arnis-tile-cache/usgs_3dep',
      'inputs/arnis-cache/arnis-landcover-cache',
      'inputs/arnis-cache/arnis/custom_models/stadium.glb',
      'inputs/overture/catalog.json',
    ];
  if (role === 'bluemap-atlas')
    return ['web/index.html', 'web/settings.json', 'web/maps/overworld'];
  if (role === 'bluemap-evidence') {
    return [
      'config/core.conf',
      'config/maps/overworld.conf',
      'logs/',
      'evidence/web-checksums.json',
      'render-run/evidence/process.json',
    ];
  }
  throw new Error(`Unknown archive role: ${role}`);
}

function verifyTar(archivePath, role) {
  return new Promise((resolve, reject) => {
    const requirements = new Map(archiveRequirements(role).map((needle) => [needle, false]));
    let count = 0;
    let stderr = '';
    let settled = false;
    const child = spawn('nice', ['-n', '10', 'tar', '-tzf', archivePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (entryPath) => {
      count += 1;
      const parts = entryPath.split('/');
      if (entryPath.startsWith('/') || parts.includes('..')) {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`Unsafe path in ${path.basename(archivePath)}: ${entryPath}`));
        return;
      }
      if (role === 'immutable-world' && parts.at(-1) === 'session.lock') {
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`Immutable world archive contains session.lock: ${entryPath}`));
        return;
      }
      for (const needle of requirements.keys()) {
        if (entryPath.includes(needle)) requirements.set(needle, true);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        reject(
          new Error(
            `tar verification failed with code ${code ?? 'null'} signal ${signal ?? 'none'}: ${stderr.trim()}`,
          ),
        );
        return;
      }
      const missing = [...requirements].filter(([, found]) => !found).map(([needle]) => needle);
      if (missing.length > 0) {
        reject(
          new Error(
            `${path.basename(archivePath)} is missing expected content: ${missing.join(', ')}`,
          ),
        );
        return;
      }
      resolve(count);
    });
  });
}

let failed = false;
for (const entry of entries) {
  const filePath = path.join(releaseRoot, entry.file);
  if (!existsSync(filePath)) throw new Error(`Missing release file: ${entry.file}`);
  const actual = await sha256(filePath);
  const status = actual === entry.expected ? 'OK' : 'FAILED';
  process.stdout.write(`${entry.file}: ${status}\n`);
  failed ||= status === 'FAILED';
}
if (failed) process.exit(1);

for (const archive of manifest.archives) {
  const archivePath = path.join(releaseRoot, archive.file);
  const actualSize = statSync(archivePath).size;
  if (actualSize !== archive.sizeBytes) {
    throw new Error(
      `${archive.file} size mismatch: expected ${archive.sizeBytes}, got ${actualSize}`,
    );
  }
  const entryCount = await verifyTar(archivePath, archive.role);
  process.stdout.write(`${archive.file}: CONTENTS OK (${entryCount} entries)\n`);
}
process.stdout.write(`release ${manifest.runId}: VERIFIED\n`);
process.exit(failed ? 1 : 0);
