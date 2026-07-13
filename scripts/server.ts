#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const serverDir = path.resolve(process.cwd(), '.behold-runtime/server');
const jar = path.join(serverDir, 'server.jar');
const bundledJava = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'minecraft',
  'runtime',
  'java-runtime-delta',
  'mac-os-arm64',
  'java-runtime-delta',
  'jre.bundle',
  'Contents',
  'Home',
  'bin',
  'java',
);
const java = process.env.SERVER_JAVA || (fs.existsSync(bundledJava) ? bundledJava : 'java');

if (!fs.existsSync(jar)) {
  console.error(`[server] missing ${jar}`);
  console.error('[server] Run the local world setup before starting the server.');
  process.exit(1);
}

const child = spawn(java, ['-Xms1G', '-Xmx2G', '-jar', 'server.jar', 'nogui'], {
  cwd: serverDir,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
