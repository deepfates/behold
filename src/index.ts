import 'dotenv/config';
import { getConfig } from './config';
import { createBot } from './bot';
import { startAgentLoop } from './agent/loop';
import { attachKeyboard } from './input/keyboard';
import { openEntityLoom } from './entity/loom';

async function main() {
  const config = getConfig();
  console.log(
    `[init] Connecting to ${config.server.host}:${config.server.port} as ${config.auth.username} (${config.auth.mode})`,
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
  bot.once('spawn', () => {
    startAgentLoop(bot as any, config as any);
    const wantKb = String(process.env.KEYBOARD || '1').toLowerCase();
    const enableKb = !(wantKb === '0' || wantKb === 'false' || wantKb === 'off');
    if (enableKb && process.stdin.isTTY) {
      attachKeyboard(bot as any);
    }
  });
}

main().catch((err) => {
  console.error('[fatal] Unhandled error:', err);
  process.exit(1);
});
