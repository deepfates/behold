// Minimal reasoner: OpenRouter text-chat replies when addressed; otherwise idle.

function getReasoner(bot, config, tools, _toolSpecs) {
  const hasKey = !!config.llm?.apiKey;
  if (hasKey) return openRouterTextResponder(bot, config, tools);
  return fallbackReasoner(bot);
}

function fallbackReasoner(bot) {
  const botName = () => (bot.username || 'bot');
  return {
    name: 'fallback',
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

// Removed Ax integration for now.

function openRouterTextResponder(_bot, config, _tools) {
  const model = config.llm.model || 'openai/gpt-4o-mini';
  const apiKey = config.llm.apiKey;
  const endpoint = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions';
  const extraHeaders = {};
  if (process.env.OPENROUTER_REFERER) {
    extraHeaders['HTTP-Referer'] = process.env.OPENROUTER_REFERER;
    extraHeaders['Referer'] = process.env.OPENROUTER_REFERER;
  }
  if (process.env.OPENROUTER_TITLE) extraHeaders['X-Title'] = process.env.OPENROUTER_TITLE;

  return {
    name: 'openrouter-chat',
    async plan(observation) {
      const mention = mentionsBot(observation);
      if (!mention) return null;

      const system = 'You are a friendly Minecraft bot. Reply briefly and helpfully in plain chat.';
      const user = lastChatLine(observation);
      const body = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.3
      };
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders
      };

      try {
        const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!res.ok) {
          const t = await safeText(res);
          console.warn('[agent] openrouter chat failed:', res.status, t);
          return null;
        }
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text) return null;
        return { tool: 'say', input: { text: truncate(text, 200) } };
      } catch (e) {
        console.warn('[agent] openrouter chat error:', e?.message || e);
        return null;
      }
    }
  };
}

function renderContext(obs) {
  const loc = obs.position ? `(${obs.position.x.toFixed?.(1) ?? obs.position.x}, ${obs.position.y.toFixed?.(1) ?? obs.position.y}, ${obs.position.z.toFixed?.(1) ?? obs.position.z})` : 'unknown';
  const chat = obs.lastChat ? `<${obs.lastChat.username}> ${obs.lastChat.message}` : 'none';
  return [
    `You are ${obs.username}.`,
    `Pos: ${loc}. Health: ${obs.health}. Food: ${obs.food}.`,
    `Last chat: ${chat}.`,
    'If someone addresses you or asks for help, call the say tool to respond succinctly.'
  ].join('\n');
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

function mentionsBot(obs) {
  const last = obs.lastChat;
  if (!last || typeof last.message !== 'string') return false;
  const me = String(obs.username || '').toLowerCase();
  const msg = last.message.toLowerCase();
  return me && (msg.includes(me) || msg.startsWith('bot ') || msg.startsWith('@' + me));
}

function lastChatLine(obs) {
  const last = obs.lastChat;
  if (!last) return 'Someone might be talking to you.';
  return `<${last.username}> ${last.message}`;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) : s;
}

module.exports = { getReasoner };
