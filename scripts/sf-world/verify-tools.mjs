#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptRoot, '../..');
const lock = JSON.parse(
  readFileSync(path.join(repositoryRoot, 'docs/sf-world/tool-lock.json'), 'utf8'),
);

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

const checks = [
  {
    role: 'arnis-source-archive',
    path: '.behold-artifacts/sf/tools/arnis-v3.0.0-source.tar.gz',
    sha256: lock.tools.arnisOfficial.sourceArchiveSha256,
    sizeBytes: lock.tools.arnisOfficial.sourceArchiveSizeBytes,
  },
  {
    role: 'arnis-official-archive',
    path: '.behold-artifacts/sf/tools/arnis-v3.0.0/arnis-mac-universal.tar.gz',
    sha256: lock.tools.arnisOfficial.archiveSha256,
  },
  {
    role: 'arnis-official-binary',
    path: '.behold-artifacts/sf/tools/arnis-v3.0.0/arnis-mac-universal',
    sha256: lock.tools.arnisOfficial.binarySha256,
  },
  {
    role: 'arnis-patched-binary',
    path: lock.tools.arnisPatched.path,
    sha256: lock.tools.arnisPatched.sha256,
  },
  {
    role: 'bluemap-cli',
    path: lock.tools.blueMap.path,
    sha256: lock.tools.blueMap.sha256,
  },
  {
    role: 'bluemap-resource-extensions',
    path: lock.tools.blueMap.resourceExtensionsPath,
    sha256: lock.tools.blueMap.resourceExtensionsSha256,
    sizeBytes: lock.tools.blueMap.resourceExtensionsSizeBytes,
  },
  {
    role: 'minecraft-client',
    path: lock.tools.minecraftClient.path,
    sha256: lock.tools.minecraftClient.sha256,
    sizeBytes: lock.tools.minecraftClient.sizeBytes,
  },
  {
    role: 'minecraft-server',
    path: lock.tools.minecraftServer.path,
    sha256: lock.tools.minecraftServer.sha256,
    sizeBytes: lock.tools.minecraftServer.sizeBytes,
  },
];

let failed = false;
for (const check of checks) {
  const filePath = path.join(repositoryRoot, check.path);
  if (!existsSync(filePath)) {
    process.stdout.write(`${check.role}: MISSING (${check.path})\n`);
    failed = true;
    continue;
  }
  const sizeBytes = statSync(filePath).size;
  const actual = await sha256(filePath);
  const sizeMatches = check.sizeBytes === undefined || sizeBytes === check.sizeBytes;
  const digestMatches = actual === check.sha256;
  const status = sizeMatches && digestMatches ? 'OK' : 'FAILED';
  process.stdout.write(`${check.role}: ${status} (${sizeBytes} bytes, ${actual})\n`);
  failed ||= status === 'FAILED';
}
process.exit(failed ? 1 : 0);
