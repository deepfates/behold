# User Stories (Updated for Plug‑and‑Play Agents)

This doc captures the current direction: a unified CLI `behold <AgentName> [--model ...]` that starts an autonomous agent immediately, logs human‑readable observations/actions in the same terminal, and lets a human insert actions into the same stream. It also covers the JSONL stdio harness for automation.

Primary personas

- Operator: launches agents locally, watches logs, and intervenes via terminal.
- Agent Author: integrates models/tool‑calling against the command registry.
- Server Admin: configures and supervises a private (offline) server.
- Player: interacts in‑game (chat mentions, proximity).

Assumptions

- Local/offline server environment.
- One action stream; human and LLM both propose intents; an arbiter executes exactly one at a time. Human work has queue priority. There is not yet an honest in-flight cancellation acknowledgement.

Launch & Observe

- As an Operator, I can run `behold Leelu --model anthropic/claude-4.5-sonnet` and see Leelu connect within 3 seconds and begin acting autonomously.
  - Acceptance:
    - Terminal shows concise status lines (pos|hp/food|dim|day/night|held), focus (cursor), nearby top‑K, and last action result.
    - First autonomous decision appears within the configured tick (default 3000ms).

Inline Controls (Human Insertions)

- As an Operator, I can pause/resume autonomous decisions without stopping the bot.
  - **RED:** stop and incoming-world-event suspension/resumption exist internally, but there is no direct operator pause/resume command.
- As an Operator, I can insert a manual command at any time without overlapping the active action.
  - Acceptance:
    - `say "hi"` sends chat; summary line shows ok.
    - `! dig @cursor` takes priority after the active action reaches a terminal result; `preemption_deferred` makes the wait visible.
    - `stop` immediately suspends new model decisions and cancels queued model intents.
    - **RED:** cancel an already-running path, dig, place, container, or sleep action and receive an adapter acknowledgement that proves it can no longer produce a side effect.
- As an Operator, I can step exactly one LLM decision on demand and see its chosen action before it executes.
  - **RED:** no production step control exists yet; the removed `requestStep` hook had no execution semantics.

Human Commands (Mapped to Registry)

- As an Operator, I can run common verbs with ergonomic tokens.
  - Acceptance examples:
    - `status`, `nearby [radius=12]`, `cursor [max=6]` re‑render status without spamming.
    - `move to #1 near=2` pathfinds to the first nearby target. **RED:** `stop` does not yet acknowledge cancellation of an active path.
    - `look @cursor`, `dig @cursor`, `place @cursor face=top` succeed when applicable; errors are short and prescriptive.
    - `equip pickaxe`, `eat [bread]` operate inventory; clear errors if not found.
    - Tab‑completion suggests command names, param keys, enums, and tokens (`@cursor`, `#1..#5`, `@nearest <name>`, `@here`).

LLM Autonomy

- As an Operator, I can tune the LLM decision cadence and safety.
  - Acceptance: `tick 1500ms` lowers latency; allowlist and global rate‑limits are enforced; long chat is truncated.
- As an Operator, I can mute LLM proposals temporarily.
  - **RED:** internal suspension exists, but the parser exposes no `llm off`/`llm on` operator controls yet.

Tooling & Introspection

- As an Agent Author, I can list/describe the command registry and run a command programmatically.
  - Acceptance:
    - `behold tools --json` returns a stable list of `{ name, description, parameters }`.
    - `run_command { name, args }` executes and returns `{ ok, ... }` over the tool surface.

JSONL Stdio Automation

- As a Developer, I can drive the agent via JSONL without the interactive console.
  - Acceptance:
    - `npm run agent:stdio` prints `hello` with tool specs, then periodic `observation` events.
    - Writing one line `{"action":"call","tool":"say","input":{"text":"hi"}}` yields a `tool_result`.
    - `{"action":"final"}` exits cleanly.

Safety & Limits

- As an Operator, I can constrain actions safely.
  - Acceptance: `--allow-tools say,move_to` blocks others; chat is rate‑limited (e.g., 1/s); all actions serialize; deferred human priority is visible.

Config & Auth

- As a Server Admin, I can set host/port/auth via `.env` or flags and run in offline mode easily.
  - Acceptance: `SERVER_HOST`, `SERVER_PORT`, `MINECRAFT_AUTH=offline`, `MINECRAFT_USERNAME` connect reliably; helpful warnings if missing.

Optional (Scale & Logs)

- As an Operator, I can run multiple agents with prefixed logs.
  - Acceptance: each line is prefixed `[AgentName]`; non‑TTY runs avoid prompts; optional `--log-file` writes JSONL.

Non‑Goals (for now)

- Viewer‑driven click‑to‑act.
- Long‑horizon planning or tasks; we focus on single‑step, safe actions.
