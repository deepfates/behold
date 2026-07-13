import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { sanitizeName } from '../src/observability/journal';

const host = process.env.NATIVE_MC_HOST || '127.0.0.1';
const port = Number(process.env.NATIVE_MC_PORT || 25565);
const dryRun = process.argv.includes('--dry-run');
const runtimeDir = path.resolve(process.cwd(), '.behold-runtime');
const companionName = process.env.BEHOLD_COMPANION_NAME || 'ScoutLife';
const companionModel = process.env.BEHOLD_COMPANION_MODEL || 'openai/gpt-5.4';

async function main() {
  const running = await canConnect(host, port);
  if (running) {
    console.log(`[play] SF server is already running at ${host}:${port}.`);
  } else if (dryRun) {
    console.log(`[play] SF server is not running; a real launch would start it.`);
  } else {
    await startServer();
  }
  await ensureCompanion();

  const nativeArgs = ['run', 'native'];
  if (dryRun) nativeArgs.push('--', '--dry-run');
  const client = spawnSync('npm', nativeArgs, { cwd: process.cwd(), stdio: 'inherit' });
  if (client.error) throw client.error;
  process.exitCode = client.status ?? 1;
}

async function ensureCompanion() {
  const leasePath = path.join(
    process.cwd(),
    '.behold-entities',
    sanitizeName(companionName),
    'runtime.lock',
  );
  const owner = readLeaseOwner(leasePath);
  if (owner && leaseOwnerIsLive(owner)) {
    console.log(`[play] Companion ${companionName} is already alive (PID ${owner.pid}).`);
    return;
  }
  if (dryRun) {
    console.log(`[play] A real launch would start companion ${companionName} (${companionModel}).`);
    return;
  }

  fs.mkdirSync(runtimeDir, { recursive: true });
  const logPath = path.join(runtimeDir, 'companion.log');
  const logStart = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
  const log = fs.openSync(logPath, 'a');
  const companion = spawn(
    'npm',
    [
      'run',
      'behold',
      '--',
      companionName,
      '--model',
      companionModel,
      '--server',
      host,
      '--port',
      String(port),
    ],
    {
      cwd: process.cwd(),
      detached: true,
      env: { ...process.env, VIEWER_ENABLED: '0' },
      stdio: ['ignore', log, log],
    },
  );
  companion.unref();
  fs.closeSync(log);
  console.log(`[play] Starting companion ${companionName} (log: ${logPath})…`);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const currentOwner = readLeaseOwner(leasePath);
    const newLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(logStart) : '';
    if (
      currentOwner &&
      leaseOwnerIsLive(currentOwner) &&
      newLog.includes('[bot] Spawned in the world.')
    ) {
      console.log(`[play] Companion ${companionName} is in the world.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Companion ${companionName} did not enter the world within 60 seconds. Check ${logPath}`,
  );
}

function readLeaseOwner(file: string): { pid: number; hostname?: string } | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const pid = Number(value?.pid);
    return Number.isSafeInteger(pid) && pid > 0
      ? { pid, hostname: typeof value?.hostname === 'string' ? value.hostname : undefined }
      : null;
  } catch {
    return null;
  }
}

function leaseOwnerIsLive(owner: { pid: number; hostname?: string }) {
  if (owner.hostname && owner.hostname !== os.hostname()) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

async function startServer() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const logPath = path.join(runtimeDir, 'play-server.log');
  const log = fs.openSync(logPath, 'a');
  const server = spawn('npm', ['run', 'server'], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', log, log],
  });
  server.unref();
  console.log(`[play] Starting the SF server (log: ${logPath})…`);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await canConnect(host, port)) {
      console.log(`[play] SF server is ready at ${host}:${port}.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`SF server did not become ready within 60 seconds. Check ${logPath}`);
}

function canConnect(address: string, targetPort: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: address, port: targetPort });
    const finish = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

void main().catch((error) => {
  console.error('[play]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
