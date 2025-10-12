const { getReasoner } = require('./reasoner');
const { buildTools } = require('../tools');

function startAgentLoop(bot, config) {
  const tools = buildTools(bot);
  const reasoner = getReasoner(bot, config, tools);
  console.log(`[agent] Using reasoner: ${reasoner.name}`);

  let lastChat = null;
  bot.on('chat', (username, message) => {
    lastChat = { username, message, at: Date.now() };
  });

  const tickMs = Math.max(500, Number(config.agent?.tickMs || 4000));

  async function tick() {
    try {
      const observation = collectObservation(bot, lastChat);
      const action = await reasoner.plan(observation);
      if (action && action.tool) {
        const fn = tools[action.tool];
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

function collectObservation(bot, lastChat) {
  const pos = bot.entity?.position;
  const position = pos ? { x: pos.x, y: pos.y, z: pos.z } : null;
  return {
    time: Date.now(),
    username: bot.username,
    position,
    health: bot.health,
    food: bot.food,
    lastChat
  };
}

module.exports = { startAgentLoop };

