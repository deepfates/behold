// A pluggable reasoner: tries to use ax-llm if installed,
// falls back to a tiny rule-based behavior.

function getReasoner(bot, config, tools) {
  let usingAx = false;
  try {
    // Dynamically require so the project runs without it installed.
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const ax = require('ax-llm');
    usingAx = !!ax;
    // Sketch: you would define your agent / prompt and tool bindings here.
    // Returning a shimmed planner that could call out to ax.
    return {
      name: 'ax-llm',
      async plan(observation) {
        // TODO: implement your ax-llm invocation using observation + tools
        // For now, just a placeholder so users know where to wire it.
        return null; // no-op until configured
      }
    };
  } catch (_) {
    // ax-llm not available; fall back.
  }

  const botName = () => (bot.username || 'bot');
  return {
    name: usingAx ? 'ax-llm' : 'fallback',
    async plan(observation) {
      const lastChat = observation.lastChat;
      if (lastChat && typeof lastChat.message === 'string') {
        const mention = botName().toLowerCase();
        if (lastChat.message.toLowerCase().includes(mention)) {
          return { tool: 'say', input: `Hi ${lastChat.username}!` };
        }
      }
      return null; // idle
    }
  };
}

module.exports = { getReasoner };

