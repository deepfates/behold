import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import mineflayer from 'mineflayer';
import { sha256 } from './core.mjs';

export const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitUntil(probe, timeoutMs, label, pollMilliseconds = 50) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await probe();
    if (value) return value;
    await sleep(pollMilliseconds);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export function formatProgressEvent(event) {
  const subject = event.caseId ?? event.placeId ?? event.username ?? '';
  const metric = Number.isFinite(event.effectiveTps)
    ? ` · ${event.effectiveTps} TPS`
    : Number.isFinite(event.requestedTicks)
      ? ` · ${event.requestedTicks} ticks`
      : Number.isFinite(event.resultCount)
        ? ` · ${event.resultCount} results`
        : Number.isFinite(event.caseCount)
          ? ` · ${event.caseCount} cases`
          : '';
  return `[place:${event.lane}] ${event.stage} ${event.status}${subject ? ` · ${subject}` : ''}${metric}`;
}

export function createProgressReporter({ lane, runId, filePath = null, stream = process.stderr }) {
  let sequence = 0;
  let file = null;
  if (filePath) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    file = createWriteStream(filePath, { flags: 'wx' });
  }
  const emit = (stage, status, details = {}) => {
    const event = {
      schemaVersion: 1,
      kind: 'place-compiler-progress',
      lane,
      runId,
      sequence: ++sequence,
      at: new Date().toISOString(),
      stage,
      status,
      ...details,
    };
    const line = `${JSON.stringify(event)}\n`;
    stream?.write(`${formatProgressEvent(event)}\n`);
    file?.write(line);
    return event;
  };
  return {
    emit,
    close: () =>
      new Promise((resolve, reject) => {
        if (!file) return resolve();
        file.once('error', reject);
        file.end(resolve);
      }),
  };
}

export function materializeRuntime({ repositoryRoot, fixture, profileId, destination, port }) {
  const args = [
    path.join(repositoryRoot, 'scripts/place-compiler/materialize-runtime.mjs'),
    '--run-root',
    fixture.runRoot,
    '--profile',
    profileId,
    '--destination',
    destination,
    '--port',
    String(port),
  ];
  if (fixture.recipePath) args.push('--recipe', fixture.recipePath);
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`Runtime materialization failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

export function resolveRuntimeLaunch(runtime, repositoryRoot) {
  if (!Array.isArray(runtime.launch) || runtime.launch[0] !== 'java')
    throw new Error('runtime launch must be a Java argument vector');
  const jarIndex = runtime.launch.indexOf('-jar');
  if (jarIndex < 1 || !runtime.launch[jarIndex + 1])
    throw new Error('runtime launch has no server jar');
  const jar = path.resolve(repositoryRoot, runtime.launch[jarIndex + 1]);
  const args = runtime.launch.slice(1);
  args[jarIndex] = jar;
  return { command: runtime.launch[0], args, jar };
}

export async function startMinecraftServer({
  repositoryRoot,
  runtimeRoot,
  runtime,
  logPath,
  progress = null,
}) {
  const launch = resolveRuntimeLaunch(runtime, repositoryRoot);
  if ((await sha256(launch.jar)) !== runtime.minecraftServerSha256)
    throw new Error('Minecraft server digest mismatch');
  const log = createWriteStream(logPath, { flags: 'wx' });
  const started = process.hrtime.bigint();
  progress?.emit('server', 'starting', {
    placeId: runtime.placeId,
    profileId: runtime.profileId,
    launch: [launch.command, ...launch.args],
  });
  const child = spawn(launch.command, launch.args, {
    cwd: runtimeRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  const capture = (chunk) => {
    const value = chunk.toString();
    output += value;
    log.write(value);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('exit', () => log.end());
  await waitUntil(
    () => {
      if (child.exitCode != null)
        throw new Error(`Minecraft exited before readiness: ${child.exitCode}`);
      return output.includes('Done (');
    },
    120_000,
    'Minecraft readiness',
  );
  const startupMilliseconds = Number(process.hrtime.bigint() - started) / 1e6;
  progress?.emit('server', 'ready', {
    placeId: runtime.placeId,
    profileId: runtime.profileId,
    startupMilliseconds,
  });
  return {
    child,
    command: (value) => child.stdin.write(`${value}\n`),
    output: () => output,
    launch: [launch.command, ...launch.args],
    startupMilliseconds,
  };
}

export async function connectObserver({ port, username, label = 'observer', progress = null }) {
  const started = process.hrtime.bigint();
  progress?.emit('observer', 'connecting', { username, port });
  const bot = mineflayer.createBot({
    host: '127.0.0.1',
    port,
    username,
    auth: 'offline',
    version: '1.21.4',
    hideErrors: false,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} spawn timed out`)), 30_000);
    const fail = (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    bot.once('spawn', () => {
      clearTimeout(timer);
      resolve();
    });
    bot.once('error', fail);
    bot.once('kicked', (reason) => fail(new Error(`${label} kicked: ${String(reason)}`)));
  });
  const connectMilliseconds = Number(process.hrtime.bigint() - started) / 1e6;
  progress?.emit('observer', 'connected', { username, port, connectMilliseconds });
  return { bot, connectMilliseconds };
}

export async function queryServer(server, command, pattern, label) {
  const offset = server.output().length;
  server.command(command);
  return waitUntil(() => server.output().slice(offset).match(pattern), 10_000, label);
}

export async function sprintTicks(server, ticks, timeoutSeconds, parseCompletion, progress = null) {
  const offset = server.output().length;
  const started = process.hrtime.bigint();
  progress?.emit('tick-sprint', 'started', { requestedTicks: ticks });
  server.command(`tick sprint ${ticks}`);
  const completion = await waitUntil(
    () => parseCompletion(server.output().slice(offset), ticks),
    timeoutSeconds * 1000,
    `${ticks}-tick sprint`,
  );
  const result = {
    ...completion,
    observedWallMilliseconds: Number(process.hrtime.bigint() - started) / 1e6,
  };
  progress?.emit('tick-sprint', 'completed', result);
  return result;
}

export async function stopMinecraftServer({
  server,
  bot = null,
  reason = 'measurement complete',
  beforeStop = [],
  progress = null,
}) {
  try {
    bot?.end(reason);
  } catch {}
  if (server.child.exitCode == null) {
    progress?.emit('server', 'stopping');
    for (const command of beforeStop) server.command(command);
    server.command('save-all');
    server.command('stop');
    await waitUntil(() => server.child.exitCode != null, 30_000, 'clean server stop');
  }
  const shutdown = { clean: server.child.exitCode === 0, exitCode: server.child.exitCode };
  progress?.emit('server', shutdown.clean ? 'stopped' : 'failed', shutdown);
  return shutdown;
}

export function sampleProcess(pid) {
  const result = spawnSync('ps', ['-o', 'rss=,%cpu=', '-p', String(pid)], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  const [rssKiB, cpuPercent] = result.stdout.trim().split(/\s+/).map(Number);
  return { at: new Date().toISOString(), rssBytes: rssKiB * 1024, cpuPercent };
}
