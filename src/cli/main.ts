#!/usr/bin/env node
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { getConfig } from '../config';
import { createBot } from '../bot';
import { buildTools } from '../tools';
import { runStdioHarness } from '../agent/harness_stdio';
import { openEntityLoom, type EntityLoom } from '../entity/loom';

type Sub = 'agent' | 'tools' | 'help';

async function main() {
  const argv = process.argv.slice(2);
  const sub = (argv[0] as Sub) || 'help';
  const args = parseArgs({
    args: argv.slice(1),
    options: {
      stdio: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      tickMs: { type: 'string' },
      maxSteps: { type: 'string' },
      thinkTimeoutMs: { type: 'string' },
      rateMax: { type: 'string' },
      rateWindowMs: { type: 'string' },
      allowTools: { type: 'string' },
      help: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  switch (sub) {
    case 'agent':
      if (!args.values.stdio) return usage('agent');
      return runAgentStdio(args.values);
    case 'tools':
      return printTools(Boolean(args.values.json));
    case 'help':
    default:
      return usage();
  }
}

async function runAgentStdio(values: Record<string, any>) {
  const cfg = getConfig();
  console.error(
    `[cli] Connecting to ${cfg.server.host}:${cfg.server.port} as ${cfg.auth.username}`,
  );
  const { bot, loom } = await openLeasedBot(cfg);
  bot.once('spawn', async () => {
    const { fns, specs } = buildTools(bot as any);
    const allow = values.allowTools
      ? String(values.allowTools)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null;
    await runStdioHarness(bot as any, cfg as any, fns, specs, {
      tickMs: toNum(values.tickMs, 3000),
      maxSteps: toNum(values.maxSteps, 128),
      thinkTimeoutMs: toNum(values.thinkTimeoutMs, 8000),
      rateMax: toNum(values.rateMax, 20),
      rateWindowMs: toNum(values.rateWindowMs, 60000),
      allowTools: allow,
    });
    await stopLeasedBot(bot, loom);
    process.exitCode = 0;
  });
}

async function printTools(asJson: boolean) {
  const cfg = getConfig();
  const { bot, loom } = await openLeasedBot(cfg);
  bot.once('spawn', async () => {
    const { specs } = buildTools(bot as any);
    if (asJson) {
      process.stdout.write(JSON.stringify(specs, null, 2) + '\n');
    } else {
      process.stdout.write('# Tools\n');
      for (const s of specs) {
        const name = s?.function?.name || 'unknown';
        const desc = s?.function?.description || '';
        process.stdout.write(`- ${name}: ${desc}\n`);
      }
    }
    await stopLeasedBot(bot, loom);
    process.exitCode = 0;
  });
}

async function openLeasedBot(cfg: ReturnType<typeof getConfig>) {
  const loom = await openEntityLoom(cfg.auth.username, undefined, cfg.circle.id);
  try {
    return { bot: createBot(cfg, loom.connectionCapability), loom };
  } catch (error) {
    await loom.close();
    throw error;
  }
}

async function stopLeasedBot(bot: ReturnType<typeof createBot>, loom: EntityLoom) {
  await new Promise<void>((resolve) => {
    bot.once('end', () => resolve());
    try {
      (bot as any).end();
    } catch {
      resolve();
    }
  });
  await loom.close();
}

function toNum(v: any, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function usage(sub?: string) {
  const lines: string[] = [];
  if (!sub || sub === 'help') {
    lines.push(
      'Usage: behold <command> [options]',
      '',
      'Commands:',
      '  agent --stdio            Run JSONL stdio harness',
      '  tools [--json]           Print available tools',
      '  help                     Show this help',
      '',
      'Examples:',
      '  ts-node src/cli/main.ts agent --stdio --maxSteps 50 --allowTools say,move_to',
      '  ts-node src/cli/main.ts tools --json',
    );
  } else if (sub === 'agent') {
    lines.push(
      'Agent (stdio) options:',
      '  --tickMs <ms>            Tick interval for loop (default 3000)',
      '  --thinkTimeoutMs <ms>    Wait time for action after observation (8000)',
      '  --maxSteps <n>           Stop after this many steps (128)',
      '  --rateMax <n>            Max actions per window (20)',
      '  --rateWindowMs <ms>      Window size in ms (60000)',
      '  --allowTools <csv>       Restrict tool names (comma-separated)',
    );
  }
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}

main().catch((err) => {
  console.error('[cli] fatal:', err);
  process.exit(1);
});
