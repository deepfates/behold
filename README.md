Behold — Mineflayer + OpenRouter Chat Bot

A minimal Minecraft bot that logs into a server with Mineflayer and replies in chat via OpenRouter. The bot stands in place and only responds when addressed.

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
- `src/agent/reasoner.js` — Minimal reasoner; uses OpenRouter chat (no tools) or a tiny fallback
- `src/input/keyboard.js` — Terminal keyboard controls (WASD, jump, crouch, sprint, look, chat)
- `src/tools/index.js` — Registry of callable tools the reasoner can invoke
- `scripts/swarm.js` — Multi-bot launcher for local/offline testing
- `.env.example` — Example environment variables to copy into `.env`

Prerequisites
- Node.js 18+ recommended
- A reachable Minecraft server (local or remote)
- For online mode: a valid account and correct `MINECRAFT_AUTH`
- OpenRouter API key if you want LLM chat replies

Setup
1. Copy the env template and edit values as needed:
   ```bash
   cp .env.example .env
   # then edit .env with your server + credentials
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the bot:
   ```bash
   npm start
   ```

If you don’t provide an OpenRouter key, the agent uses a tiny rule-based fallback so the bot is still runnable.

Environment Variables
- `SERVER_HOST` — Server hostname or IP (default `localhost`)
- `SERVER_PORT` — Server port (default `25565`)
- `MINECRAFT_USERNAME` — Bot username (or email for online mode)
- `MINECRAFT_PASSWORD` — Password (leave empty for offline)
- `MINECRAFT_AUTH` — `offline` or `microsoft` (default `offline`)
- `AGENT_TICK_MS` — Agent loop tick interval (default `4000`)
- `OPENROUTER_API_KEY` — API key for OpenRouter (optional)
- `OPENROUTER_BASE_URL` — Override OpenRouter base (default `https://openrouter.ai/api/v1/chat/completions`)
- `OPENROUTER_REFERER` — Optional Referer header for OpenRouter
- `OPENROUTER_TITLE` — Optional X-Title header for OpenRouter
- `LLM_MODEL` — OpenRouter model slug (e.g., `openai/gpt-4o-mini`)

LLM Integration (OpenRouter only)
- Set `OPENROUTER_API_KEY` and choose a model via `LLM_MODEL` (defaults to `openai/gpt-4o-mini`).
- The agent sends a simple chat prompt and replies with the returned text.

Tool mapping
- Tools are defined in `src/tools/index.js` and registered in `src/agent/loop.js`.
- The reasoner emits actions of the form `{ tool: string, input: any }` that the loop executes by name (currently used for `say`).

Fallback behavior
- If no LLM is configured, the bot uses a small rule: if someone mentions the bot’s username in chat, it replies with a greeting via `say`.

Running Tips
- Offline/LAN servers: set `MINECRAFT_AUTH=offline` and provide a `MINECRAFT_USERNAME`
- Online servers (Microsoft): set `MINECRAFT_AUTH=microsoft` and provide username/email + password as required by your setup
- You can tune `AGENT_TICK_MS` to slow down or speed up the agent loop

Swarm (multi-bot)
- Copy `bots.example.json` to `bots.json` and edit usernames (use offline mode).
- Run `npm run swarm` to launch all bots as child processes.
- Each child disables terminal keyboard by default (`KEYBOARD=0`).

Keyboard controls (terminal)
- `w/a/s/d` — toggle movement
- `space` — toggle jump
- `z` — toggle sneak (crouch)
- `f` — toggle sprint
- Arrow keys — look around
- `t` — prompt for a chat line to send
- `x` — stop all movement
- `h` — help
- `Ctrl+C` — exit


Roadmap
- Add richer tools (navigation, block inspection, inventory)
- Progressive agent design inspired by Anthropic’s “Building Effective Agents” (function signatures, controlled tool use)
- Add examples and tests

Safety
Autonomous bots can spam or grief if misconfigured. Start on a private test server, audit tool capabilities, and add guardrails or rate limits before deploying anywhere public.

---
Happy hacking! PRs and ideas welcome.

Development
- Lint: `npm run lint` (ESLint)
- Format: `npm run format` (Prettier)
- Check: `npm run check` (ESLint + Prettier check)
- Conventional commits enforced via commitlint (Husky `commit-msg` hook)
- Pre-commit runs lint-staged to format and fix changed files

Setup hooks
Hooks are configured but require dependencies installed. Run:
```bash
npm install
npm run prepare  # sets up Husky
```
