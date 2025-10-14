Behold — Plug‑and‑Play Minecraft Agents (local/offline)

Status: 0.1.0‑alpha.0

Behold is a minimal framework to plug interactive agents into your (local/offline) Minecraft server. It runs a Mineflayer bot, exposes a small, spec‑first command registry over the Mineflayer API, and lets either a human or an LLM “drive” the same commands.

Features
- Mineflayer login + basic lifecycle hooks (spawn, chat, errors)
- Simple agent loop scaffold with pluggable "reasoner" (LLM or fallback)
- Minimal tool system (e.g., `say`) for the agent to call
- Environment-based configuration and sensible defaults

Project Layout
- `src/index.ts` — Entry point; loads config and starts the bot + agent loop
- `src/config.ts` — Reads env vars and validates runtime config
- `src/bot.ts` — Creates the Mineflayer bot and binds core events
- Viewer: when enabled, starts a local web viewer (prismarine-viewer) on spawn
- `src/agent/loop.ts` — Agent loop runner (tick-based)
- `src/agent/reasoner.ts` — Minimal reasoner; uses OpenRouter chat (no tools) or a tiny fallback
- `src/agent/observation.ts` — Shared observation builder for bot state
- `src/agent/harness_stdio.ts` — JSONL stdio harness for external LLM control
- `src/cli/main.ts` — Minimal CLI with `agent --stdio` and `tools`
- `src/input/keyboard.ts` — Terminal keyboard controls (WASD, jump, crouch, sprint, look, chat)
- `src/tools/index.ts` — Registry of callable tools the reasoner can invoke
- `scripts/swarm.ts` — Multi-bot launcher for local/offline testing
- `.env.example` — Example environment variables to copy into `.env`

Prerequisites
- Node.js 18+ recommended
- A reachable Minecraft server (local or remote)
- For online mode: a valid account and correct `MINECRAFT_AUTH`
- OpenRouter API key if you want LLM chat replies
- Optional: local browser for the viewer
 - For the viewer on Node: `canvas` native module. You may need system packages.
   - macOS (Homebrew): `brew install pkg-config cairo pango libpng jpeg giflib librsvg`
   - Ubuntu/Debian: `sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`
   - Alpine: `apk add --no-cache build-base cairo-dev pango-dev jpeg-dev giflib-dev`

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
3. Start the bot (builds TypeScript into `dist/` first):
   ```bash
   npm start
   ```
   If the viewer is enabled (default), open http://localhost:3007 to watch.
   If you see an error about missing `canvas`, install it after the system packages:
   ```bash
   npm i canvas
   ```

If you don’t provide an OpenRouter key, the agent uses a tiny rule-based fallback so the bot is still runnable.

Environment Variables
- `SERVER_HOST` — Server hostname or IP (default `localhost`)
- `SERVER_PORT` — Server port (default `25565`)
- `MINECRAFT_USERNAME` — Bot username (or email for online mode)
- `MINECRAFT_PASSWORD` — Password (leave empty for offline)
- `MINECRAFT_AUTH` — `offline` or `microsoft` (default `offline`)
- `AGENT_TICK_MS` — Agent loop tick interval (default `4000`)
- `KEY_MODE` — `hold` (default) for MC-like holding keys, or `toggle`
- `VIEWER_ENABLED` — `1` to enable the web viewer (default `1`)
- `VIEWER_PORT` — viewer port (default `3007`)
- `VIEWER_FIRST_PERSON` — `1` for first-person camera, `0` for third-person (default `1`)
- `OPENROUTER_API_KEY` — API key for OpenRouter (optional)
- `OPENROUTER_BASE_URL` — Override OpenRouter base (default `https://openrouter.ai/api/v1/chat/completions`)
- `OPENROUTER_REFERER` — Optional Referer header for OpenRouter
- `OPENROUTER_TITLE` — Optional X-Title header for OpenRouter
- `LLM_MODEL` — OpenRouter model slug (e.g., `openai/gpt-4o-mini`)

LLM Integration (today)
- Set `OPENROUTER_API_KEY` and choose a model via `LLM_MODEL` (defaults to `openai/gpt-4o-mini`).
- The included minimal reasoner replies to chat mentions (text only). For structured tool‑calling, use the JSONL stdio harness described below.

Command registry and tools
- Interpreter commands live in `src/agent/interpreter.ts` (chat/look/move/dig/place/inventory/sense) and call the Mineflayer API.
- The same commands are exposed as tools via `src/tools/index.ts`:
  - `list_commands`, `describe_command`, `run_command` — discovery and execution
  - Backwards‑compatible simple tools (e.g., `say`, `move_to`, `get_status`) remain available

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
- Optional: set `spawnDelayMs` in `bots.json` (default 5000ms), or pass `--delay 5000` to CLI.
 - Auto-retry: if a bot exits quickly or is throttled, the launcher retries with backoff (defaults: `maxRetries=5`, `retryBaseMs=3000`). You may add these to `bots.json`.

If you see "Connection throttled! Please wait before reconnecting."
- Many Paper/Spigot servers throttle rapid connects from the same IP (commonly ~4000ms window).
- Fix by staggering launches (use `spawnDelayMs`/`--delay` set to ≥ 4500–5000ms), or raise/disable the server’s connection throttle (in `bukkit.yml`, set `settings.connection-throttle: -1`).

Keyboard controls (terminal)
- `w/a/s/d` — move (hold)
- `space` — jump (hold)
- `z` — toggle sneak (crouch)
- `f` — sprint (hold)
- Arrow keys — look around
- `t` — prompt for a chat line to send
- `q` — drop held item stack
- `x` — stop all movement
- `h` — help
- `Ctrl+C` — exit


Viewer
- Powered by `prismarine-viewer`. By default it launches on spawn at `http://localhost:3007`.
- Toggle via `VIEWER_ENABLED=0` or change port with `VIEWER_PORT`.
- First-person view can be switched with `VIEWER_FIRST_PERSON=0`.


JSONL Stdio Harness
- Purpose: let an external LLM (or controller) run the observe–think–act loop via JSONL over stdio.
- Start:
  ```bash
  npm run agent:stdio -- --maxSteps 50 --allowTools say,move_to
  ```
- Protocol (stdout):
  - `{ "event": "hello", "username": "...", "specs": [...] }`
  - `{ "event": "observation", "data": { ... } }`
  - `{ "event": "status", "phase": "observing|thinking|acting|waiting", "step": 1 }`
  - `{ "event": "tool_result", "id": "call-123", "ok": true, "result": { ... } }`
- Actions (stdin, one JSON per line):
  - `{"action":"call","id":"call-123","tool":"say","input":{"text":"hi"}}`
  - `{"action":"wait"}`
  - `{"action":"final","text":"see ya"}`
- Options (`npm run behold -- agent --stdio`): `--tickMs`, `--thinkTimeoutMs`, `--maxSteps`, `--rateMax`, `--rateWindowMs`, `--allowTools <csv>`.

What you can do today
- Drive the bot by piping JSON actions (see above examples).
- Use `npm run behold -- tools --json` to list the command registry for tool‑calling.
- Use `npm run cli` for a basic chat REPL (human chat only).
- Try the preview console REPL (human + engine): `npm run console`.
  - If `OPENROUTER_API_KEY` is set, the console starts a simple LLM autopilot (single agent) that proposes one tool call per tick (default 3000ms) using the same command registry. You can still type commands any time to override.

What’s next (readme‑driven plan)
- `behold <AgentName> [--model ...]` boots an autonomous agent that logs observations/actions in human‑readable lines in the same terminal, with inline interactive controls (pause/step/manual commands) sharing one action stream with the LLM. See `docs/PRD.md`.

Roadmap
- Add richer tools (navigation, block inspection, inventory)
- Unified CLI (`behold <AgentName>`) with shared human+LLM action stream
- Add examples and tests

Safety
Autonomous bots can spam or grief if misconfigured. Start on a private test server, audit tool capabilities, and add guardrails or rate limits before deploying anywhere public.

---
Happy hacking! PRs and ideas welcome.

Development
- Language: TypeScript (compiled to `dist/`)
- Build: `npm run build` (tsc)
- Run: `npm start` (builds then runs `node dist/src/index.js`)
- Dev (ts-node): `npm run dev` (runs `src/index.ts` directly)
- CLI chat: `npm run cli` (ts-node)
- Swarm: `npm run swarm` (builds then runs `dist/scripts/swarm.js`)
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
