const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const mcDataLoader = require('minecraft-data');
let mineflayerViewer;
let viewerLoadError = null;
try {
  // Optional dependency: prismarine-viewer
  ({ mineflayer: mineflayerViewer } = require('prismarine-viewer'));
} catch (e) {
  viewerLoadError = e;
  mineflayerViewer = null;
}

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

  // Preserve config for later access
  Object.defineProperty(bot, '__beholdConfig', { value: config, enumerable: false });

  bindCoreEvents(bot, config);
  return bot;
}

function bindCoreEvents(bot, config) {
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

    // Start web viewer if enabled
    try {
      const enabled = config?.viewer?.enabled !== false;
      if (enabled && mineflayerViewer) {
        const port = Number(config?.viewer?.port || 3007);
        const firstPerson = !!config?.viewer?.firstPerson;
        mineflayerViewer(bot, { port, firstPerson });
        console.log(`[viewer] Running at http://localhost:${port} (${firstPerson ? 'first-person' : 'third-person'})`);
      } else if (enabled && !mineflayerViewer) {
        if (viewerLoadError?.message?.includes("Cannot find module 'canvas'")) {
          console.warn('[viewer] prismarine-viewer requires the optional dependency "canvas".');
          console.warn('[viewer] Install prerequisites (may require native libs) then run: npm i canvas');
          console.warn('[viewer] macOS example: brew install pkg-config cairo pango libpng jpeg giflib librsvg');
        } else {
          console.warn('[viewer] prismarine-viewer not available. Ensure dependencies installed.');
        }
      }
    } catch (e) {
      console.warn('[viewer] Failed to start viewer:', e?.message || e);
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
