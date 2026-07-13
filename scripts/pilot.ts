import 'dotenv/config';
import { createBot } from '../src/bot';
import { getConfig } from '../src/config';
import { attachKeyboard } from '../src/input/keyboard';
import { attachWebCockpit } from '../src/input/web-cockpit';
import { openEntityLoom } from '../src/entity/loom';

async function main() {
  process.env.SERVER_HOST = process.env.PILOT_SERVER || '127.0.0.1';
  process.env.SERVER_PORT = String(process.env.PILOT_SERVER_PORT || 25565);
  process.env.MINECRAFT_USERNAME = process.env.PILOT_USERNAME || 'Deepfates';
  const config = getConfig();
  config.auth.mode = 'offline';
  config.viewer.enabled = true;
  config.viewer.port = Number(process.env.PILOT_VIEWER_PORT || 3007);
  config.viewer.firstPerson = true;
  config.viewer.viewDistance = Number(process.env.PILOT_VIEW_DISTANCE || 8);

  console.log(
    `[pilot] Connecting ${config.auth.username} to ${config.server.host}:${config.server.port}`,
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
    attachWebCockpit(bot, {
      port: Number(process.env.PILOT_COCKPIT_PORT || 3008),
      viewerUrl: `http://127.0.0.1:${config.viewer.port}`,
    });
    if (process.stdin.isTTY && process.env.PILOT_KEYBOARD !== '0') {
      attachKeyboard(bot);
    }
  });
}

void main().catch((error) => {
  console.error('[pilot]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
