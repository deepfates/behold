#!/usr/bin/env node
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { runConsole } from '../tui/console';
import { completeSuccessfulCliExit } from './process-lifecycle';

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs({
    args: argv,
    options: {
      model: { type: 'string' },
      tickMs: { type: 'string' },
      allowTools: { type: 'string' },
      paused: { type: 'boolean', default: false },
      task: { type: 'string' },
      target: { type: 'string' },
      server: { type: 'string' },
      port: { type: 'string' },
      world: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const agentName = args.positionals[0];
  if (!agentName || args.values.help) return usage();

  if (args.values.server) process.env.SERVER_HOST = String(args.values.server);
  if (args.values.port) process.env.SERVER_PORT = String(args.values.port);
  if (args.values.world) process.env.BEHOLD_WORLD_ID = String(args.values.world);
  const allow = args.values.allowTools
    ? String(args.values.allowTools)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  await runConsole({
    agentName,
    model: args.values.model ? String(args.values.model) : undefined,
    tickMs: args.values.tickMs ? Number(args.values.tickMs) : undefined,
    paused: Boolean(args.values.paused),
    allowTools: allow,
    task: args.values.task ? String(args.values.task) : undefined,
    target: args.values.target ? String(args.values.target) : undefined,
  });
}

function usage() {
  const lines = [
    'Usage: behold <AgentName> [--model <slug>] [--tickMs <ms>] [--paused] [--task come-see-do-report] [--target <player>] [--allowTools a,b,c] [--server host] [--port n] [--world <circle-id>]',
    '',
    'Starts a bot + console UI. If OPENROUTER_API_KEY is set, enables LLM autopilot using the command registry.',
  ];
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}

main()
  .then(() => completeSuccessfulCliExit())
  .catch((e) => {
    console.error('[behold] fatal:', e);
    process.exit(1);
  });
