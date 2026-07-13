import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { sanitizeName } from '../src/observability/journal';
import { DEFAULT_LLM_MODEL } from '../src/config';

const host = process.env.NATIVE_MC_HOST || '127.0.0.1';
const port = Number(process.env.NATIVE_MC_PORT || 25565);
const dryRun = process.argv.includes('--dry-run');
const companionName = process.env.BEHOLD_COMPANION_NAME || 'ScoutLife';
const companionModel =
  process.env.BEHOLD_COMPANION_MODEL || process.env.LLM_MODEL || DEFAULT_LLM_MODEL;
const configPath = process.env.BEHOLD_WORLD_CONFIG || '.behold-worlds.example.json';
const worldId = process.env.BEHOLD_MANAGED_WORLD || 'sf-csdr';

async function main() {
  const running = await canConnect(host, port);
  let manager: ChildProcess | null = null;
  if (running) {
    console.log(`[play] An existing server is already running at ${host}:${port}.`);
    reportExistingCompanion();
  } else if (dryRun) {
    console.log(
      '[play] A real launch would ask the managed world owner to start server + companion.',
    );
  } else {
    manager = await startManagedWorld();
  }

  try {
    const nativeArgs = ['run', 'native'];
    if (dryRun) nativeArgs.push('--', '--dry-run');
    const client = spawnSync('npm', nativeArgs, { cwd: process.cwd(), stdio: 'inherit' });
    if (client.error) throw client.error;
    process.exitCode = client.status ?? 1;
  } finally {
    if (manager) await stopManagedWorld(manager);
  }
}

function reportExistingCompanion() {
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
  console.log(
    '[play] No companion was started: an existing server must be adopted by the managed owner before a new controller may be attached automatically.',
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

async function startManagedWorld() {
  const child = spawn(
    'npm',
    [
      'run',
      'world',
      '--',
      'start',
      '--config',
      configPath,
      '--world',
      worldId,
      '--controller',
      companionName,
      '--model',
      companionModel,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  await waitForManagedReady(child, 90_000);
  return child;
}

function waitForManagedReady(child: ChildProcess, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let output = '';
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.removeListener('data', onData);
      child.removeListener('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    const onData = (chunk: unknown) => {
      output = `${output}${String(chunk)}`.slice(-16_384);
      if (output.includes(`[world-runner] ready: ${worldId},`)) finish();
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(new Error(`managed world exited before readiness (${signal || code || 0})`));
    const timer = setTimeout(() => {
      child.kill('SIGINT');
      finish(new Error(`managed world did not become ready within ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on('data', onData);
    child.once('exit', onExit);
  });
}

async function stopManagedWorld(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('managed world did not stop within 90 seconds')),
      90_000,
    );
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGINT');
  });
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
