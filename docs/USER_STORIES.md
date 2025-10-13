# User Stories

Primary personas:
- Developer: builds, runs, and extends the bot locally.
- Server Admin: runs the bot on a private server and observes behavior.
- Observer/Player: interacts with the bot in-game via chat mentions.

Stories
- As a Developer, I can run `npm start` and see the bot connect and a web viewer at `http://localhost:3007` so I can observe state without logging into Minecraft.
  - Acceptance: process logs show "Prismarine viewer web server running" and I can load the page successfully.

- As a Developer, I can control the bot with MC-like keyboard holds (WASD/Space/F) in my terminal so movement feels natural.
  - Acceptance: holding `w` moves forward; releasing stops; `z` toggles sneak; `x` stops all.

- As a Developer, I can run a multi-bot swarm with staggered spawns and backoff retries so I don’t trigger server throttles.
  - Acceptance: `npm run swarm` launches multiple bots; logs show staggered connects and retry messages on throttles.

- As a Server Admin, I can configure host/port/auth via `.env` and run in offline or Microsoft auth modes.
  - Acceptance: editing `.env` changes connection parameters; offline works without a password.

- As a Player, when I mention the bot username in chat, it replies succinctly.
  - Acceptance: chat shows a short response; if no API key is configured, a fallback greeting appears instead.

- As a Developer, I can enable/disable the viewer and first-person mode via env vars to suit my environment.
  - Acceptance: `VIEWER_ENABLED=0` disables viewer startup; `VIEWER_FIRST_PERSON=0` switches camera.

Non-goals (current release)
- Clicking in the viewer to trigger actions (dig/place) — disabled by design.
- Web-based control overlay — removed; CLI controls are canonical.

