#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadWorldLabConfig } from './world-lab';
import {
  forkStoppedMinecraftWorld,
  verifyMinecraftWorldHistoryFork,
  type MinecraftWorldHistoryFork,
} from '../src/runtime/world-history';

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: 'string' },
      world: { type: 'string' },
      root: { type: 'string' },
      operation: { type: 'string' },
      history: { type: 'string', multiple: true },
      actor: { type: 'string', default: 'local-operator' },
      receipt: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help) return process.stdout.write(`${usage()}\n`);
  const command = parsed.positionals[0];
  if (parsed.positionals.length !== 1 || !['fork', 'verify'].includes(String(command))) {
    throw new Error(usage());
  }
  if (command === 'verify') {
    const receiptFile = required(parsed.values.receipt, '--receipt');
    const receipt = JSON.parse(fs.readFileSync(path.resolve(receiptFile), 'utf8'));
    const verification = await verifyMinecraftWorldHistoryFork(
      receipt as MinecraftWorldHistoryFork,
    );
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    return;
  }

  const configFile = required(parsed.values.config, '--config');
  const worldId = required(parsed.values.world, '--world');
  const historyRoot = path.resolve(required(parsed.values.root, '--root'));
  const operationId = required(parsed.values.operation, '--operation');
  const receiptFile = path.resolve(required(parsed.values.receipt, '--receipt'));
  const requested = parsed.values.history ?? [];
  if (requested.length < 1) throw new Error('fork requires at least one --history <id>');
  const config = loadWorldLabConfig(configFile);
  const world = config.worlds[worldId];
  if (!world) throw new Error(`unknown world ${worldId}`);
  const result = await forkStoppedMinecraftWorld({
    operationId,
    worldId,
    world,
    controlRoot: path.resolve('.behold-runtime/world-control'),
    historyRoot,
    actor: String(parsed.values.actor),
    histories: requested.map((id) => ({
      id,
      label: id,
      purpose: `Evaluate one causal continuation from checkpoint ${operationId}.`,
    })),
  });
  writeReceipt(receiptFile, result);
  process.stdout.write(`${JSON.stringify({ ...result, receiptFile }, null, 2)}\n`);
}

function writeReceipt(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function required(value: unknown, flag: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${flag} is required`);
  return value.trim();
}

function usage() {
  return [
    'Usage:',
    '  world-history fork --config <worlds.json> --world <id> --root <history-root> --operation <id> --history <id> [--history <id> ...] --receipt <file>',
    '  world-history verify --receipt <file>',
    '',
    'Fork requires an actually stopped managed Minecraft runtime. It seals one immutable checkpoint, creates isolated writable histories, records their Lync lineage, and leaves the source unchanged.',
  ].join('\n');
}

void main().catch((error: any) => {
  process.stderr.write(`[world-history] ${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
