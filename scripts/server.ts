#!/usr/bin/env node
import { spawn } from 'node:child_process';

const config = process.env.BEHOLD_WORLD_CONFIG || 'behold-worlds.json';
const world = process.env.BEHOLD_MANAGED_WORLD || 'sf-csdr';

console.error(
  '[server] Direct JVM launch has been retired; delegating to the managed world owner.',
);
const child = spawn(
  'npm',
  ['run', 'world', '--', 'start', '--config', config, '--world', world, ...process.argv.slice(2)],
  { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
);

child.on('error', (error) => {
  console.error(`[server] Could not start managed world: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
