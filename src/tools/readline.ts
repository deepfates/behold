import 'dotenv/config';
import { getConfig } from '../config';
import { createBot } from '../bot';
import * as readline from 'node:readline';
import { openEntityLoom } from '../entity/loom';

async function main() {
  const config = getConfig();
  console.log(
    `[readline] Connecting to ${config.server.host}:${config.server.port} as ${config.auth.username} (${config.auth.mode})`,
  );

  const loom = await openEntityLoom(config.auth.username, undefined, config.circle.id);
  let bot: ReturnType<typeof createBot>;
  try {
    bot = createBot(config, loom.connectionCapability);
  } catch (error) {
    await loom.close();
    throw error;
  }
  bot.once('end', () => void loom.close());

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  bot.once('spawn', () => {
    console.log(
      `[readline] Bot joined the game as ${bot.username}. Type to chat. (Ctrl+C to exit)`,
    );
    rl.setPrompt('> ');
    rl.prompt();
  });

  bot.on('message', (message: any) => {
    try {
      readline.moveCursor(process.stdout, -2, 0);
    } catch {}
    const text =
      typeof (message as any)?.toAnsi === 'function'
        ? (message as any).toAnsi()
        : ((message as any)?.toString?.() ?? String(message));
    console.log(text);
    rl.prompt();
  });

  rl.on('line', (line) => {
    try {
      readline.moveCursor(process.stdout, 0, -1);
      readline.clearScreenDown(process.stdout);
    } catch {}
    const msg = String(line || '').trim();
    if (msg) (bot as any).chat(msg);
    rl.prompt();
  });

  bot.on('kicked', (reason: any) => {
    console.warn('[bot] Kicked:', reason);
  });
  bot.on('error', (err: any) => {
    console.error('[bot] Error:', err);
  });
  bot.on('end', () => {
    console.warn('[bot] Disconnected from server.');
    rl.close();
  });

  process.on('SIGINT', () => {
    console.log('\n[readline] Exiting...');
    try {
      (bot as any).end();
    } catch {}
    rl.close();
    process.exit(0);
  });
}

void main().catch((error) => {
  console.error('[readline]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
