#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function requirements(role) {
  if (role === 'immutable-world') return ['level.dat', 'metadata.json', '/region/', '.mca'];
  if (role === 'generation-evidence')
    return [
      'generation-manifest.json',
      'evidence/process.json',
      'evidence/place-validation.json',
      'evidence/world-checksums.json',
    ];
  if (role === 'reproduction-kit')
    return [
      'docs/place-compiler/runtime-profiles.json',
      'docs/place-compiler/places/',
      'scripts/place-compiler/generate.mjs',
      'scripts/place-compiler/validate-run.mjs',
      'scripts/place-compiler/package-release.mjs',
      'docs/sf-world/tool-lock.json',
    ];
  if (role === 'generation-inputs') return ['inputs/', 'generator-home/'];
  if (role === 'atlas')
    return ['atlas/atlas-manifest.json', 'atlas/web/index.html', 'atlas/evidence/'];
  throw new Error(`unknown archive role: ${role}`);
}

function verifyTar(file, role) {
  return new Promise((resolve, reject) => {
    const needed = new Map(requirements(role).map((item) => [item, false]));
    const child = spawn('tar', ['-tzf', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let count = 0;
    createInterface({ input: child.stdout }).on('line', (entry) => {
      count += 1;
      const parts = entry.split('/');
      if (entry.startsWith('/') || parts.includes('..')) {
        child.kill('SIGTERM');
        reject(new Error(`unsafe archive path: ${entry}`));
      }
      if (role === 'immutable-world' && parts.at(-1) === 'session.lock') {
        child.kill('SIGTERM');
        reject(new Error('immutable world contains session.lock'));
      }
      for (const needle of needed.keys()) if (entry.includes(needle)) needed.set(needle, true);
    });
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`tar exited ${code}: ${stderr.trim()}`));
      const missing = [...needed].filter(([, found]) => !found).map(([item]) => item);
      if (missing.length) return reject(new Error(`${role} archive missing: ${missing.join(', ')}`));
      resolve(count);
    });
  });
}

const root = path.resolve(process.argv[2] ?? '.');
const manifestPath = path.join(root, 'release-manifest.json');
const sumsPath = path.join(root, 'SHA256SUMS');
if (!existsSync(manifestPath) || !existsSync(sumsPath)) throw new Error('release manifest or checksums missing');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 2 || manifest.compiler !== 'behold-place-compiler') {
  throw new Error('unsupported release manifest');
}
const sums = new Map(
  readFileSync(sumsPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})  ([^/]+)$/);
      if (!match) throw new Error(`malformed checksum: ${line}`);
      return [match[2], match[1]];
    }),
);
const roles = new Set();
for (const archive of manifest.archives) {
  if (roles.has(archive.role)) throw new Error(`duplicate role: ${archive.role}`);
  roles.add(archive.role);
  if (path.basename(archive.file) !== archive.file) throw new Error(`unsafe filename: ${archive.file}`);
  if (sums.get(archive.file) !== archive.sha256) throw new Error(`checksum manifest disagreement: ${archive.file}`);
  const file = path.join(root, archive.file);
  if (!existsSync(file) || statSync(file).size !== archive.sizeBytes) throw new Error(`missing or wrong-size archive: ${archive.file}`);
  if ((await sha256(file)) !== archive.sha256) throw new Error(`digest mismatch: ${archive.file}`);
  const count = await verifyTar(file, archive.role);
  process.stdout.write(`${archive.file}: VERIFIED (${count} entries)\n`);
}
for (const role of ['immutable-world', 'generation-evidence', 'reproduction-kit']) {
  if (!roles.has(role)) throw new Error(`missing required role: ${role}`);
}
if (sums.get('release-manifest.json') !== (await sha256(manifestPath))) {
  throw new Error('release manifest digest mismatch');
}
if (sums.size !== manifest.archives.length + 1) throw new Error('unexpected checksum entries');
process.stdout.write(`release ${manifest.runId} (${manifest.placeId}): VERIFIED\n`);
