#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runConsole } from '../tui/console';
import { completeSuccessfulCliExit } from './process-lifecycle';

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs({
    args: argv,
    options: {
      model: { type: 'string' },
      urgentModel: { type: 'string' },
      urgentDecisionTimeoutMs: { type: 'string' },
      policyProfile: { type: 'string' },
      actionProfile: { type: 'string' },
      safetyProfile: { type: 'string' },
      tickMs: { type: 'string' },
      maxTurnSteps: { type: 'string' },
      resumeAfterBudget: { type: 'string' },
      allowTools: { type: 'string' },
      paused: { type: 'boolean', default: false },
      task: { type: 'string' },
      target: { type: 'string' },
      body: { type: 'string' },
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
    bodyUsername: args.values.body ? String(args.values.body) : undefined,
    model: args.values.model ? String(args.values.model) : undefined,
    urgentModel: args.values.urgentModel ? String(args.values.urgentModel) : undefined,
    urgentDecisionTimeoutMs: args.values.urgentDecisionTimeoutMs
      ? Number(args.values.urgentDecisionTimeoutMs)
      : undefined,
    policyProfile: args.values.policyProfile as any,
    actionProfile: args.values.actionProfile as any,
    safetyProfile: args.values.safetyProfile as any,
    tickMs: args.values.tickMs ? Number(args.values.tickMs) : undefined,
    maxTurnSteps: args.values.maxTurnSteps ? Number(args.values.maxTurnSteps) : undefined,
    resumeAfterBudget: args.values.resumeAfterBudget
      ? parseBoolean(args.values.resumeAfterBudget, '--resumeAfterBudget')
      : undefined,
    paused: Boolean(args.values.paused),
    allowTools: allow,
    task: args.values.task ? String(args.values.task) : undefined,
    target: args.values.target ? String(args.values.target) : undefined,
  });
}

function usage() {
  const lines = [
    'Usage: behold <LifeId> [--body <MinecraftUsername>] [--model <slug>] [--urgentModel <slug>] [--urgentDecisionTimeoutMs <ms>] [--policyProfile resident-v1|neutral-benchmark-v1] [--actionProfile resident-v1|minecraft-player-v1] [--safetyProfile resident-safe-v1|vanilla-player-v1] [--tickMs <ms>] [--maxTurnSteps <1-32>] [--resumeAfterBudget true|false] [--paused] [--task come-see-do-report] [--target <player>] [--allowTools a,b,c] [--server host] [--port n] [--world <circle-id>]',
    '',
    'Starts a bot + console UI. If OPENROUTER_API_KEY is set, enables LLM autopilot using the command registry.',
  ];
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}

function parseBoolean(value: unknown, option: string) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${option} must be true or false`);
}

main()
  .then(() => completeSuccessfulCliExit())
  .catch((e) => {
    console.error('[behold] fatal:', e);
    process.exit(1);
  });
