function buildTools(bot) {
  return {
    // Minimal communication tool
    say: async (input) => {
      const text = typeof input === 'string' ? input : String(input);
      bot.chat(text);
      return { ok: true };
    },
  };
}

module.exports = { buildTools };

