import { getReasoner } from './reasoner';
import { buildTools } from '../tools';
import type { Bot } from 'mineflayer';
import type { Config } from '../config';
import { collectObservation, type ChatLine } from './observation';

export function startAgentLoop(bot: Bot, config: Config) {
  const { fns: tools, specs: toolSpecs } = buildTools(bot);
  const reasoner = getReasoner(bot, config, tools, toolSpecs);
  console.log(`[agent] Using reasoner: ${reasoner.name}`);

  let lastChat: ChatLine = null;
  bot.on('chat', (username: string, message: string) => {
    lastChat = { username, message, at: Date.now() };
  });

  const tickMs = Math.max(500, Number(config.agent?.tickMs || 4000));

  async function tick() {
    try {
      const observation = collectObservation(bot, lastChat);
      const action = await reasoner.plan(observation);
      if (action && action.tool) {
        const fn = (tools as any)[action.tool];
        if (typeof fn === 'function') {
          await fn(action.input);
        } else {
          console.warn(`[agent] Unknown tool: ${action.tool}`);
        }
      }
    } catch (err) {
      console.error('[agent] Error during tick:', err);
    }
  }

  const interval = setInterval(tick, tickMs);
  bot.once('end', () => clearInterval(interval));
}

// observation moved to src/agent/observation.ts
