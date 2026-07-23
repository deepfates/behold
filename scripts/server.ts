#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolveWorldLabConfigPath } from './world-lab';

const forwarded = process.argv.slice(2);
const configFlag = forwarded.indexOf('--config');
const explicitConfig = configFlag >= 0 ? forwarded[configFlag + 1] : undefined;
if (configFlag >= 0) {
  if (!explicitConfig || explicitConfig.startsWith('--')) {
    throw new Error('--config requires a value');
  }
  forwarded.splice(configFlag, 2);
}
const config = resolveWorldLabConfigPath({ explicit: explicitConfig });
const world = process.env.BEHOLD_MANAGED_WORLD || 'sf-csdr';

console.error(
  '[server] Direct JVM launch has been retired; delegating to the managed world owner.',
);
const child = spawn(
  'npm',
  ['run', 'world', '--', 'start', '--config', config, '--world', world, ...forwarded],
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
