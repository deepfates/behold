// A pluggable reasoner that prefers ax-llm if LLM_PROVIDER=ax
// Otherwise will use direct OpenAI tool-calling when LLM_PROVIDER=openai
// and fall back to a tiny rule-based behavior.

function getReasoner(bot, config, tools) {
  const provider = (config.llm?.provider || '').toLowerCase();
  const hasKey = !!config.llm?.apiKey;

  if (provider === 'ax' && hasKey) {
    const maybeAx = tryAxReasoner(bot, config, tools);
    if (maybeAx) return maybeAx;
    console.warn('[agent] ax-llm not available or not recognized, falling back.');
  }

  if (provider === 'openai' && hasKey) {
    return openaiReasoner(bot, config, tools);
  }

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

function tryAxReasoner(bot, config, tools) {
  try {
    // Dynamically require so the project runs without it installed.
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const ax = require('ax-llm');
    // Because ax-llm’s API may vary, we provide a minimal shim.
    // If your version exposes a different entry (e.g., createToolAgent), adjust here.
    if (typeof ax.createToolAgent === 'function') {
      const agent = ax.createToolAgent({
        model: config.llm.model || 'gpt-4o-mini',
        apiKey: config.llm.apiKey,
        tools: [
          {
            name: 'say',
            description: 'Send a chat message to the server',
            parameters: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text']
            }
          }
        ],
        system: 'You are a helpful Minecraft agent. Use tools to act.'
      });

      return {
        name: 'ax-llm',
        async plan(observation) {
          const context = renderContext(observation);
          const res = await agent.plan({ input: context });
          if (res && res.tool) return res; // Expecting { tool, input }
          return null;
        }
      };
    }

    // Fallback: if ax exposes a generic planner function
    if (typeof ax.toolPlanner === 'function') {
      return {
        name: 'ax-llm',
        async plan(observation) {
          const context = renderContext(observation);
          const res = await ax.toolPlanner({
            apiKey: config.llm.apiKey,
            model: config.llm.model || 'gpt-4o-mini',
            tools: [
              {
                name: 'say',
                description: 'Send a chat message to the server',
                parameters: {
                  type: 'object',
                  properties: { text: { type: 'string' } },
                  required: ['text']
                }
              }
            ],
            input: context
          });
          if (res && res.tool) return res;
          return null;
        }
      };
    }

    console.warn('[agent] ax-llm loaded but no known planner API found.');
    return null;
  } catch (_) {
    return null;
  }
}

function openaiReasoner(_bot, config, _tools) {
  const model = config.llm.model || 'gpt-4o-mini';
  const apiKey = config.llm.apiKey;
  const endpoint = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';

  return {
    name: 'openai-tools',
    async plan(observation) {
      const system = 'You are a helpful Minecraft agent. When appropriate, choose exactly one tool to act.';
      const user = renderContext(observation);
      const toolsSpec = [
        {
          type: 'function',
          function: {
            name: 'say',
            description: 'Send a chat message to the server',
            parameters: {
              type: 'object',
              properties: { text: { type: 'string', description: 'What to say in chat' } },
              required: ['text']
            }
          }
        }
      ];

      const body = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        tools: toolsSpec,
        tool_choice: 'auto',
        temperature: 0.2
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const t = await safeText(res);
        console.warn('[agent] OpenAI call failed:', res.status, t);
        return null;
      }
      const data = await res.json();
      const choice = data.choices?.[0]?.message;
      if (!choice) return null;

      // Newer API: tool_calls; older: function_call
      const tc = choice.tool_calls?.[0];
      if (tc?.function?.name) {
        return { tool: tc.function.name, input: parseArgs(tc.function.arguments) };
      }
      const fc = choice.function_call;
      if (fc?.name) {
        return { tool: fc.name, input: parseArgs(fc.arguments) };
      }
      return null;
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

function parseArgs(s) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return { text: String(s || '') };
  }
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

module.exports = { getReasoner };
