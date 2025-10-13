const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const mcDataLoader = require('minecraft-data');

function createBot(config) {
  const { server, auth } = config;

  const bot = mineflayer.createBot({
    host: server.host,
    port: server.port,
    username: auth.username,
    // For microsoft auth, allow device-code flow if password is empty
    password: auth.mode !== 'offline' && auth.password ? auth.password : undefined,
    auth: auth.mode // 'offline' | 'microsoft'
  });

  // Load pathfinding plugin
  bot.loadPlugin(pathfinder);

  bindCoreEvents(bot);
  return bot;
}

function bindCoreEvents(bot) {
  bot.once('login', () => {
    console.log(`[bot] Logged in as ${bot.username}`);
  });

  bot.once('spawn', () => {
    console.log('[bot] Spawned in the world.');
    try {
      // Use documented minecraft-data for pathfinder movements
      const mcData = mcDataLoader(bot.version);
      if (bot.pathfinder && mcData) {
        const movements = new Movements(bot, mcData);
        bot.pathfinder.setMovements(movements);
      }
    } catch (e) {
      console.warn('[bot] Could not initialize default movements:', e?.message || e);
    }
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
