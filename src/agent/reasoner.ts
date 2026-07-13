// Minimal reasoner: OpenRouter text-chat replies when addressed; otherwise idle.
import type { Bot } from 'mineflayer';
import type { Config } from '../config';

export function getReasoner(bot: Bot, config: Config, _tools: any, _toolSpecs: any) {
  const hasKey = !!config.llm?.apiKey;
  if (hasKey) return openRouterTextResponder(bot, config);
  return fallbackReasoner(bot);
}

function fallbackReasoner(bot: Bot) {
  const botName = () => bot.username || 'bot';
  return {
    name: 'fallback',
    async plan(observation: any) {
      const lastChat = observation.lastChat;
      if (lastChat && typeof lastChat.message === 'string') {
        const mention = botName().toLowerCase();
        if (lastChat.message.toLowerCase().includes(mention)) {
          return { tool: 'say', input: `Hi ${lastChat.username}!` };
        }
      }
      return null; // idle
    },
  };
}

function openRouterTextResponder(_bot: Bot, config: Config) {
  const model = config.llm.model;
  const apiKey = config.llm.apiKey as string;
  const endpoint =
    process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions';
  const extraHeaders: Record<string, string> = {};
  if (process.env.OPENROUTER_REFERER) {
    extraHeaders['HTTP-Referer'] = process.env.OPENROUTER_REFERER;
    extraHeaders['Referer'] = process.env.OPENROUTER_REFERER;
  }
  if (process.env.OPENROUTER_TITLE) extraHeaders['X-Title'] = process.env.OPENROUTER_TITLE;

  return {
    name: 'openrouter-chat',
    async plan(observation: any) {
      const mention = mentionsBot(observation);
      if (!mention) return null;

      const system = 'You are a friendly Minecraft bot. Reply briefly and helpfully in plain chat.';
      const user = lastChatLine(observation);
      const body = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
      };
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      } as any;

      try {
        const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!res.ok) {
          const t = await res.text();
          console.warn('[agent] openrouter chat failed:', res.status, t);
          return null;
        }
        const data: any = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text) return null;
        return { tool: 'say', input: { text: text.length > 200 ? text.slice(0, 200) : text } };
      } catch (e: any) {
        console.warn('[agent] openrouter chat error:', e?.message || e);
        return null;
      }
    },
  };
}

function mentionsBot(obs: any) {
  const last = obs.lastChat;
  if (!last || typeof last.message !== 'string') return false;
  const me = String(obs.username || '').toLowerCase();
  const msg = last.message.toLowerCase();
  return me && (msg.includes(me) || msg.startsWith('bot ') || msg.startsWith('@' + me));
}

function lastChatLine(obs: any) {
  const last = obs.lastChat;
  if (!last) return 'Someone might be talking to you.';
  return `<${last.username}> ${last.message}`;
}
