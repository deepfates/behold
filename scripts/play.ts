import 'dotenv/config';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { sanitizeName } from '../src/observability/journal';
import { DEFAULT_LLM_MODEL } from '../src/config';
import { loadWorldLabConfig, resolveWorldLabConfigPath } from './world-lab';

const selection = resolvePlaySelection(process.argv.slice(2));
const dryRun = selection.dryRun;
const companionName = process.env.BEHOLD_COMPANION_NAME || 'SFCheckpoint';
const companionModel =
  process.env.BEHOLD_COMPANION_MODEL || process.env.LLM_MODEL || DEFAULT_LLM_MODEL;
const companionPaused = process.env.BEHOLD_COMPANION_PAUSED
  ? ['1', 'true', 'yes', 'on'].includes(process.env.BEHOLD_COMPANION_PAUSED.toLowerCase())
  : !process.env.OPENROUTER_API_KEY;
const configPath = selection.configPath;
const worldId = selection.worldId;
const endpoint = resolvePlayEndpoint(configPath, worldId);
const { host, port } = endpoint;

async function main() {
  const running = await canConnect(host, port);
  let manager: ChildProcess | null = null;
  if (running) {
    console.log(`[play] An existing server is already running at ${host}:${port}.`);
    reportExistingCompanion();
  } else if (dryRun) {
    console.log(
      `[play] A real launch would ask the managed world owner to start server + ${companionName}${companionPaused ? ' (paused; no model key)' : ''}.`,
    );
  } else {
    manager = await startManagedWorld();
  }

  try {
    const nativeArgs = ['run', 'native'];
    if (dryRun) nativeArgs.push('--', '--dry-run');
    const client = spawnSync('npm', nativeArgs, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: { ...process.env, NATIVE_MC_SERVER: endpoint.server },
    });
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
  const args = [
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
  ];
  if (companionPaused) args.push('--paused');
  const child = spawn('npm', args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

export function resolvePlayEndpoint(
  selectedConfigPath: string,
  selectedWorldId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const explicitServer = optionalText(env.NATIVE_MC_SERVER);
  const configured = (() => {
    try {
      return loadWorldLabConfig(path.resolve(selectedConfigPath)).worlds[selectedWorldId]?.server;
    } catch {
      return undefined;
    }
  })();
  const parsedExplicit = explicitServer ? parseServer(explicitServer) : null;
  const host =
    optionalText(env.NATIVE_MC_HOST) || parsedExplicit?.host || configured?.host || '127.0.0.1';
  const port = Number(
    optionalText(env.NATIVE_MC_PORT) || parsedExplicit?.port || configured?.port || 25565,
  );
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid native Minecraft port: ${String(env.NATIVE_MC_PORT || port)}`);
  }
  return Object.freeze({ host, port, server: `${host}:${port}` });
}

export function resolvePlaySelection(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  let explicitConfig: string | undefined;
  let explicitWorld: string | undefined;
  let dryRunSelected = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') {
      explicitConfig = requiredArgValue(argv, ++index, '--config');
    } else if (arg === '--world') {
      explicitWorld = requiredArgValue(argv, ++index, '--world');
    } else if (arg === '--dry-run') {
      dryRunSelected = true;
    } else {
      throw new Error(`Unknown play option: ${arg}`);
    }
  }
  return Object.freeze({
    configPath: resolveWorldLabConfigPath({ explicit: explicitConfig, env, cwd }),
    worldId: explicitWorld || optionalText(env.BEHOLD_MANAGED_WORLD) || 'sf-csdr',
    dryRun: dryRunSelected,
  });
}

function requiredArgValue(argv: string[], index: number, flag: string) {
  const value = optionalText(argv[index]);
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseServer(value: string) {
  const separator = value.lastIndexOf(':');
  if (separator <= 0) return { host: value, port: 25565 };
  return { host: value.slice(0, separator), port: Number(value.slice(separator + 1)) };
}

function optionalText(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

if (require.main === module) {
  void main().catch((error) => {
    console.error('[play]', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
