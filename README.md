Behold — Mineflayer + LLM Agent Template

A starter template for running a Minecraft bot that logs into a server with Mineflayer and executes an agent loop powered by LLM reasoning and tool use. The goal is to provide a clean, minimal structure you can extend with ax-llm (or your preferred LLM framework) to build autonomous behaviors.

Features
- Mineflayer login + basic lifecycle hooks (spawn, chat, errors)
- Simple agent loop scaffold with pluggable "reasoner" (LLM or fallback)
- Minimal tool system (e.g., `say`) for the agent to call
- Environment-based configuration and sensible defaults

Project Layout
- `src/index.js` — Entry point; loads config and starts the bot + agent loop
- `src/config.js` — Reads env vars and validates runtime config
- `src/bot.js` — Creates the Mineflayer bot and binds core events
- `src/agent/loop.js` — Agent loop runner (tick-based)
- `src/agent/reasoner.js` — Reasoner provider; uses `ax-llm` if present, otherwise a simple fallback
- `src/tools/index.js` — Registry of callable tools the reasoner can invoke
- `.env.example` — Example environment variables to copy into `.env`

Prerequisites
- Node.js 18+ recommended
- A reachable Minecraft server (local or remote)
- For online mode: a valid account and correct `MINECRAFT_AUTH`
- LLM provider credentials if you plan to use ax-llm (e.g. OpenAI key)

Setup
1. Copy the env template and edit values as needed:
   ```bash
   cp .env.example .env
   # then edit .env with your server + credentials
   ```
2. Install dependencies:
   ```bash
   npm install
   # Optional: install ax-llm once you’re ready to wire the LLM
   # npm install ax-llm
   ```
3. Start the bot:
   ```bash
   npm start
   ```

If you don’t have `ax-llm` installed yet, the agent uses a tiny rule-based fallback so the bot is still runnable.

Environment Variables
- `SERVER_HOST` — Server hostname or IP (default `localhost`)
- `SERVER_PORT` — Server port (default `25565`)
- `MINECRAFT_USERNAME` — Bot username (or email for online mode)
- `MINECRAFT_PASSWORD` — Password (leave empty for offline)
- `MINECRAFT_AUTH` — `offline` or `microsoft` (default `offline`)
- `AGENT_TICK_MS` — Agent loop tick interval (default `4000`)
- `LLM_PROVIDER` — e.g., `openai` (optional)
- `OPENAI_API_KEY` — Your API key if using OpenAI (optional)
- `LLM_MODEL` — Model name (optional; example `gpt-4o-mini`)

Wiring ax-llm
This template is ready to host an ax-llm reasoner but doesn’t force it. In `src/agent/reasoner.js`, we `require('ax-llm')` dynamically if installed. You can:
- Define your prompt, memory, and tools
- Map tool names (e.g., `say`) to functions in `src/tools/index.js`
- Return actions from the reasoner of the shape `{ tool: string, input: any }`

Until ax-llm is installed and configured, the fallback reasoner:
- Responds to chat messages that include the bot’s name
- Otherwise idles on each tick

Running Tips
- Offline/LAN servers: set `MINECRAFT_AUTH=offline` and provide a `MINECRAFT_USERNAME`
- Online servers (Microsoft): set `MINECRAFT_AUTH=microsoft` and provide username/email + password as required by your setup
- You can tune `AGENT_TICK_MS` to slow down or speed up the agent loop

Roadmap
- Add richer tools (navigation, block inspection, inventory)
- Integrate memory and task planning with ax-llm
- Add examples and tests

Safety
Autonomous bots can spam or grief if misconfigured. Start on a private test server, audit tool capabilities, and add guardrails or rate limits before deploying anywhere public.

---
Happy hacking! PRs and ideas welcome.
