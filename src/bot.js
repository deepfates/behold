const mineflayer = require('mineflayer');

function createBot(config) {
  const { server, auth } = config;

  const bot = mineflayer.createBot({
    host: server.host,
    port: server.port,
    username: auth.username,
    password: auth.mode !== 'offline' ? auth.password : undefined,
    auth: auth.mode // 'offline' | 'microsoft'
  });

  bindCoreEvents(bot);
  return bot;
}

function bindCoreEvents(bot) {
  bot.once('login', () => {
    console.log(`[bot] Logged in as ${bot.username}`);
  });

  bot.once('spawn', () => {
    console.log('[bot] Spawned in the world.');
  });

  bot.on('kicked', (reason) => {
    console.warn('[bot] Kicked:', reason);
  });

  bot.on('end', () => {
    console.warn('[bot] Disconnected from server.');
  });

  bot.on('error', (err) => {
    console.error('[bot] Error:', err);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    // Basic visibility during early dev
    console.log(`[chat] <${username}> ${message}`);
  });
}

module.exports = { createBot };

