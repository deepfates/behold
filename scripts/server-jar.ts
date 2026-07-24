#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_TOOL_LOCK = 'docs/sf-world/tool-lock.json';

type ServerJarLock = Readonly<{
  version: string;
  downloadUrl: string;
  path: string;
  sizeBytes: number;
  sha1: string;
  sha256: string;
}>;

type FetchResponse = Readonly<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBufferLike>;
}>;

export type EnsureServerJarOptions = Readonly<{
  repository?: string;
  toolLock?: string;
  checkOnly?: boolean;
  fetch?: (url: string) => Promise<FetchResponse>;
}>;

export async function ensureServerJar(options: EnsureServerJarOptions = {}) {
  const repository = path.resolve(options.repository ?? process.cwd());
  const toolLockFile = path.resolve(repository, options.toolLock ?? DEFAULT_TOOL_LOCK);
  const lock = readServerJarLock(toolLockFile);
  const destination = path.resolve(repository, lock.path);

  if (fs.existsSync(destination)) {
    verifyServerJar(destination, lock);
    return { destination, downloaded: false, lock };
  }
  if (options.checkOnly) {
    throw new Error(`pinned Minecraft server jar is absent: ${destination}`);
  }

  const url = new URL(lock.downloadUrl);
  if (url.protocol !== 'https:') {
    throw new Error(`server jar download must use HTTPS: ${lock.downloadUrl}`);
  }

  const response = await (options.fetch ?? globalThis.fetch)(lock.downloadUrl);
  if (!response.ok) {
    throw new Error(`server jar download failed with HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());

  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    verifyServerJar(temporary, lock);
    // A hard link gives us an atomic, no-clobber install in the destination's
    // own filesystem. A concurrent or locally configured jar wins safely.
    fs.linkSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }

  return { destination, downloaded: true, lock };
}

function readServerJarLock(file: string): ServerJarLock {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const value = document?.tools?.minecraftServer;
  if (
    typeof value?.version !== 'string' ||
    typeof value?.downloadUrl !== 'string' ||
    typeof value?.path !== 'string' ||
    !Number.isSafeInteger(value?.sizeBytes) ||
    value.sizeBytes <= 0 ||
    !/^[a-f0-9]{40}$/.test(value?.sha1) ||
    !/^[a-f0-9]{64}$/.test(value?.sha256)
  ) {
    throw new Error(`invalid Minecraft server entry in tool lock: ${file}`);
  }
  return value;
}

function verifyServerJar(file: string, lock: ServerJarLock): void {
  const bytes = fs.readFileSync(file);
  const actual = {
    sizeBytes: bytes.length,
    sha1: createHash('sha1').update(bytes).digest('hex'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  if (
    actual.sizeBytes !== lock.sizeBytes ||
    actual.sha1 !== lock.sha1 ||
    actual.sha256 !== lock.sha256
  ) {
    throw new Error(
      `pinned Minecraft server jar does not match the tool lock: ${file} ` +
        `(size ${actual.sizeBytes}, sha1 ${actual.sha1}, sha256 ${actual.sha256})`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check')) {
    throw new Error('usage: server-jar [--check]');
  }
  const result = await ensureServerJar({ checkOnly: args.includes('--check') });
  process.stdout.write(
    `[server-jar] ${result.downloaded ? 'Installed' : 'Verified'} Minecraft ${result.lock.version} at ${result.destination}\n`,
  );
}

if (require.main === module) {
  main().catch((error: any) => {
    process.stderr.write(`[server-jar] ${error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
