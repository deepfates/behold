require('dotenv').config();
const { getConfig } = require('./config');
const { createBot } = require('./bot');
const { startAgentLoop } = require('./agent/loop');

async function main() {
  const config = getConfig();
  console.log(`[init] Connecting to ${config.server.host}:${config.server.port} as ${config.auth.username} (${config.auth.mode})`);

  const bot = createBot(config);
  bot.once('spawn', () => {
    startAgentLoop(bot, config);
  });
}

main().catch((err) => {
  console.error('[fatal] Unhandled error:', err);
  process.exit(1);
});

