require('dotenv').config();
const { getConfig } = require('./config');
const { createBot } = require('./bot');
const { startAgentLoop } = require('./agent/loop');
const { attachKeyboard } = require('./input/keyboard');

async function main() {
  const config = getConfig();
  console.log(`[init] Connecting to ${config.server.host}:${config.server.port} as ${config.auth.username} (${config.auth.mode})`);

  const bot = createBot(config);
  bot.once('spawn', () => {
    startAgentLoop(bot, config);
    const wantKb = String(process.env.KEYBOARD || '1').toLowerCase();
    const enableKb = !(wantKb === '0' || wantKb === 'false' || wantKb === 'off');
    if (enableKb && process.stdin.isTTY) {
      attachKeyboard(bot);
    }
  });
}

main().catch((err) => {
  console.error('[fatal] Unhandled error:', err);
  process.exit(1);
});
