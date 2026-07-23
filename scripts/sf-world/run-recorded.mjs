#!/usr/bin/env node

import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const [runRootArgument, executableArgument, ...executableArguments] = process.argv.slice(2);

if (!runRootArgument || !executableArgument) {
  console.error('Usage: run-recorded.mjs <run-root> <executable> [arguments...]');
  process.exit(64);
}

const runRoot = path.resolve(runRootArgument);
const executable = path.resolve(executableArgument);
const evidenceRoot = path.join(runRoot, 'evidence');
mkdirSync(evidenceRoot, { recursive: true });

const startedAt = new Date();
const logPath = path.join(evidenceRoot, 'process.log');
const recordPath = path.join(evidenceRoot, 'process.json');
const log = createWriteStream(logPath, { flags: 'wx' });
const record = {
  schemaVersion: 1,
  startedAt: startedAt.toISOString(),
  finishedAt: null,
  durationSeconds: null,
  cwd: process.cwd(),
  executable,
  arguments: executableArguments,
  environment: {
    ARNIS_STREAM_TO_DISK: process.env.ARNIS_STREAM_TO_DISK ?? null,
    RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS ?? null,
  },
  logPath,
  exitCode: null,
  signal: null,
};

writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });

const child = spawn('/usr/bin/time', ['-l', executable, ...executableArguments], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let forwardedSignal = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    forwardedSignal = signal;
    child.kill(signal);
  });
}

for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    const destination = stream === child.stdout ? process.stdout : process.stderr;
    destination.write(chunk);
    log.write(chunk);
  });
}

child.on('error', (error) => {
  const message = `runner error: ${error.stack ?? error.message}\n`;
  process.stderr.write(message);
  log.write(message);
});

child.on('close', (exitCode, signal) => {
  const finishedAt = new Date();
  record.finishedAt = finishedAt.toISOString();
  record.durationSeconds = (finishedAt.getTime() - startedAt.getTime()) / 1000;
  record.exitCode = exitCode;
  record.signal = signal;
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  const signalExitCodes = { SIGINT: 130, SIGTERM: 143 };
  log.end(() => process.exit(exitCode ?? signalExitCodes[signal ?? forwardedSignal] ?? 1));
});
