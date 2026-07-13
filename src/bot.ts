import mineflayer, { type Bot } from 'mineflayer';
import { pathfinder, Movements } from 'mineflayer-pathfinder';
import mcDataLoader, { type IndexedData } from 'minecraft-data';
import type { Config } from './config';
import { assertEntityConnectionCapability, type EntityConnectionCapability } from './entity/loom';

let mineflayerViewer:
  | ((
      bot: any,
      opts: { viewDistance?: number; firstPerson?: boolean; port?: number; prefix?: string },
    ) => void)
  | null = null;
let viewerLoadError: Error | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ mineflayer: mineflayerViewer } = require('prismarine-viewer'));
} catch (e: any) {
  viewerLoadError = e;
  mineflayerViewer = null;
}

export function createBot(config: Config, connectionCapability: EntityConnectionCapability): Bot {
  const { server, auth } = config;
  assertEntityConnectionCapability(connectionCapability, auth.username, config.circle.id);

  const bot = mineflayer.createBot({
    host: server.host,
    port: server.port,
    username: auth.username,
    password: auth.mode !== 'offline' && auth.password ? auth.password : undefined,
    auth: auth.mode,
  });

  bot.loadPlugin(pathfinder as any);

  Object.defineProperty(bot, '__beholdConfig', { value: config, enumerable: false });

  bindCoreEvents(bot, config);
  return bot;
}

function bindCoreEvents(bot: Bot, config: Config) {
  bot.once('login', () => {
    console.log(`[bot] Logged in as ${bot.username}`);
  });

  bot.once('spawn', () => {
    console.log('[bot] Spawned in the world.');
    try {
      const mcData: IndexedData = (mcDataLoader as any)(bot.version);
      if ((bot as any).pathfinder && mcData) {
        const movements = new Movements(bot, mcData);
        // Navigation is locomotion, not permission to modify the world. Explicit
        // dig/place actions pass through the task safety guard and are traced.
        (movements as any).canDig = false;
        (movements as any).allow1by1towers = false;
        (bot as any).pathfinder.setMovements(movements);
      }
    } catch (e: any) {
      console.warn('[bot] Could not initialize default movements:', e?.message || e);
    }

    try {
      const enabled = config?.viewer?.enabled !== false;
      if (enabled && mineflayerViewer) {
        const port = Number(config?.viewer?.port || 3007);
        const firstPerson = !!config?.viewer?.firstPerson;
        const viewDistance = Number(config?.viewer?.viewDistance || 8);
        mineflayerViewer(bot, { port, firstPerson, viewDistance });
        console.log(
          `[viewer] Running at http://localhost:${port} (${firstPerson ? 'first-person' : 'third-person'}, ${viewDistance}-chunk radius)`,
        );

        // Keyboard-only viewer: no click-to-act bindings (intentional)
      } else if (enabled && !mineflayerViewer) {
        if (
          viewerLoadError &&
          /Cannot find module 'canvas'/.test(String(viewerLoadError?.message))
        ) {
          console.warn('[viewer] prismarine-viewer requires the optional dependency "canvas".');
          console.warn(
            '[viewer] Install prerequisites (may require native libs) then run: npm i canvas',
          );
          console.warn(
            '[viewer] macOS example: brew install pkg-config cairo pango libpng jpeg giflib librsvg',
          );
        } else {
          console.warn('[viewer] prismarine-viewer not available. Ensure dependencies installed.');
        }
      }
    } catch (e: any) {
      console.warn('[viewer] Failed to start viewer:', e?.message || e);
    }

    // Controls server (companion)
    // No web controls overlay (CLI controls only)
  });

  bot.on('kicked', (reason: any) => {
    console.warn('[bot] Kicked:', reason);
  });

  bot.on('end', () => {
    console.warn('[bot] Disconnected from server.');
  });

  bot.on('error', (err: any) => {
    console.error('[bot] Error:', err);
  });

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    console.log(`[chat] <${username}> ${message}`);
  });
}
