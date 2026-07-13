import 'dotenv/config';
import { createBot } from '../src/bot';
import { getConfig } from '../src/config';
import { attachKeyboard } from '../src/input/keyboard';
import { attachWebCockpit } from '../src/input/web-cockpit';

const config = getConfig();
config.server.host = process.env.PILOT_SERVER || '127.0.0.1';
config.server.port = Number(process.env.PILOT_SERVER_PORT || 25565);
config.auth.mode = 'offline';
config.auth.username = process.env.PILOT_USERNAME || 'Deepfates';
config.viewer.enabled = true;
config.viewer.port = Number(process.env.PILOT_VIEWER_PORT || 3007);
config.viewer.firstPerson = true;
config.viewer.viewDistance = Number(process.env.PILOT_VIEW_DISTANCE || 8);

console.log(
  `[pilot] Connecting ${config.auth.username} to ${config.server.host}:${config.server.port}`,
);
const bot = createBot(config);

bot.once('spawn', () => {
  attachWebCockpit(bot, {
    port: Number(process.env.PILOT_COCKPIT_PORT || 3008),
    viewerUrl: `http://127.0.0.1:${config.viewer.port}`,
  });
  if (process.stdin.isTTY && process.env.PILOT_KEYBOARD !== '0') {
    attachKeyboard(bot);
  }
});
