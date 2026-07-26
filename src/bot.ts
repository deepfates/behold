import mineflayer, { type Bot } from 'mineflayer';
import { pathfinder, Movements } from 'mineflayer-pathfinder';
import mcDataLoader, { type IndexedData } from 'minecraft-data';
import type { Config } from './config';
import { assertEntityConnectionCapability, type EntityConnectionCapability } from './entity/loom';
import { startResidentViewer, type ResidentViewerHandle } from './observability/resident-viewer';

const viewerClosers = new WeakMap<Bot, () => Promise<void>>();

export function createBot(
  config: Config,
  connectionCapability: EntityConnectionCapability,
  entityId = config.auth.username,
): Bot {
  const { server, auth } = config;
  // The capability belongs to the continuing private life. The auth username
  // names the Minecraft body that life is currently authorized to drive.
  assertEntityConnectionCapability(connectionCapability, entityId, config.circle.id);

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
  let viewer: ResidentViewerHandle | null = null;
  let viewerStart: Promise<ResidentViewerHandle | null> | null = null;
  let viewerClose: Promise<void> | null = null;

  const closeViewer = () => {
    if (viewerClose) return viewerClose;
    viewerClose = (async () => {
      const active = viewer ?? (await viewerStart?.catch(() => null)) ?? null;
      if (!active) return;
      await active.close();
      console.error(`[viewer] Closed ${active.endpoint}`);
    })();
    return viewerClose;
  };
  viewerClosers.set(bot, closeViewer);

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
        restrictNavigationToLocomotion(movements as any);
        (bot as any).pathfinder.setMovements(movements);
      }
    } catch (e: any) {
      console.warn('[bot] Could not initialize default movements:', e?.message || e);
    }

    const enabled = config?.viewer?.enabled !== false;
    viewerStart = enabled
      ? startResidentViewer(bot, {
          host: config.viewer.host,
          port: Number(config.viewer.port || 3007),
          firstPerson: !!config.viewer.firstPerson,
          viewDistance: Number(config.viewer.viewDistance || 8),
        })
          .then((handle) => {
            viewer = handle;
            console.error(
              `[viewer] Ready ${handle.endpoint} (${handle.firstPerson ? 'first-person' : 'third-person'}, read-only, ${handle.viewDistance}-chunk radius)`,
            );
            return handle;
          })
          .catch((error: any) => {
            const failure = error instanceof Error ? error : new Error(String(error));
            console.warn('[viewer] Failed to start viewer:', failure.message);
            if (config.viewer.required) throw failure;
            return null;
          })
      : Promise.resolve(null);

    void Promise.all([bot.waitForChunksToLoad(), viewerStart])
      // Keep the lifecycle marker on its own stderr line. The interactive
      // readline prompt shares stdout and can otherwise prefix the exact
      // marker, leaving the managed launcher unable to prove readiness.
      .then(() => process.stderr.write('[bot] Local world loaded.\n'))
      .catch((error: any) =>
        bot.emit(
          'error',
          new Error(
            `Could not establish local-world readiness: ${error?.message || String(error)}`,
          ),
        ),
      );

    // Controls server (companion)
    // No web controls overlay (CLI controls only)
  });

  bot.on('kicked', (reason: any) => {
    console.warn('[bot] Kicked:', reason);
  });

  bot.on('end', () => {
    console.warn('[bot] Disconnected from server.');
    void closeViewer().catch((error: any) =>
      console.error('[viewer] Failed to close viewer:', error?.message || error),
    );
  });

  bot.on('error', (err: any) => {
    console.error('[bot] Error:', err);
  });

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    console.log(`[chat] <${username}> ${message}`);
  });
}

export async function closeBotViewer(bot: Bot) {
  await viewerClosers.get(bot)?.();
}

export function restrictNavigationToLocomotion(movements: any) {
  movements.canDig = false;
  movements.allow1by1towers = false;
  // mineflayer-pathfinder intentionally spells this public field with one f.
  // An empty list prevents gap bridging and every other scaffold placement.
  movements.scafoldingBlocks = [];
  return movements;
}
