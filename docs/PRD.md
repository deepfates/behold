# Behold — Plug‑and‑Play Agents for a Local Minecraft Server

Version: 0.2 (2025-10-14)

## 1) Background
Behold provides a Mineflayer bot, a small spec‑first command registry over the Mineflayer API, and a machine‑friendly stdio harness. We’re evolving toward a unified, idiomatic CLI: `behold <AgentName> [--model ...]` which starts an autonomous agent immediately, logs observations/actions in human‑readable lines, and exposes inline controls to pause/step/override — using one shared action stream for both human and LLM.

## 2) Problem Statement
Operators want a simple terminal interface to observe and act; agents need to call the same functions programmatically. We need one command surface and one loop, where the human and the LLM are both producers of intents, and an arbiter executes one action at a time with safe, predictable rules.

## 3) Goals
- Single command registry (spec‑first) backing both human and LLM use.
- One action stream: human and LLM both propose intents; an arbiter enforces priority, exclusivity, preemption, and rate limits.
- Terminal experience: concise rolling frame (status/nearby/cursor/chat), short action summaries, ergonomic tokens, and tab‑completion.
- Unified CLI: `behold <AgentName> [--model ...]` starts autonomous mode by default, with inline controls (pause/step/manual) in the same terminal.
- Output discipline (clig.dev‑like): human‑readable lines by default; optional JSONL.

## 4) Non‑Goals
- Full GUI or web viewer (out of scope for MVP).
- Complex navigation/automation (macro planners, multi-step goals).
- Persistent memory beyond the rolling frame cache.

## 5) Personas & Primary Stories
- Human Operator: observe → decide → act once → observe again.
- Agent Runtime: do the same via tool-calls; no special agent-only commands.

Core stories:
- See status (pos, vitals, time, dimension), focus target (cursor), nearby top-K, chat tail, and last result.
- Say a short chat line; look at cursor or coordinates; pathfind to a point; stop; dig/place at cursor; equip/eat; inspect nearby/cursor; wait.
- Discover commands with `help`, `list`, `describe <cmd>`; tab-complete names and params.

## 6) Architecture Overview
- Command Registry (spec‑first): name → description → JSON Schema → run(bot,args) → result.
- Frame Builder: compact “frame” per turn (see §7).
- Intent Arbiter: merges proposed intents from sources (human, llm, system) and schedules execution:
  - Priorities: human > system > llm.
  - Exclusivity/lease: exclusives (move_to/dig/place) hold a lease until done or preempted; `stop` always preempts.
  - Parallel actions allowed within limits (e.g., `chat`, `status`).
- Loop Engine: observe → select next intent → execute → observe. Tick controls when the LLM proposes new intents; humans can inject at any time.
- Drivers:
  - Human: REPL parser + token resolver + completion; enqueues intents (with `preempt` via `!`).
  - LLM: function‑calling adapter (system+frame+specs → tool_call/text/wait); enqueues intents.

## 7) Frame (Observation) Spec
Produce a compact object for each turn:
- `position`: `{ x,y,z }` (rounded), `dimension`, `time` fields: `{ isDay: boolean, tick?: number }` if available.
- `status`: `{ health, food, heldItem?: string }`.
- `cursor`: `{ block?: { name, pos }, entity?: { id, name|username, type, dist } }` (either/none).
- `nearby`: array of up to 5 `{ idx, kind, name|username, dist }` sorted by distance.
- `chatTail`: last 3 lines `{ user, text }`.
- `lastResult`: `{ ok, summary, error? }` (one-line human summary; full JSON printed only in json-mode).

Notes:
- Limit fields for readability; resolve distances (meters = blocks).
- Keep a small cache to support tokens like `#idx` and `@nearest`.

## 8) Command Registry (MVP set)
Command names are stable verbs; each includes `description`, `parameters` (JSON Schema), and `run`:
- Chat: `chat` (say), `whisper`.
- View/Look: `look_at`, `look` (yaw/pitch radians).
- Movement: `move_to` (pathfind to `{x,y,z}` with optional `near`), `stop`, `set_control`, `clear_controls`.
- World: `dig_block` (by coords), `stop_digging`, `place_against` (with face).
- Inventory: `equip_item`, `consume` (eat/drink/use held).
- Sense/Status: `status`, `get_nearby`, `block_at_cursor`, `entity_at_cursor`, `nearest_entity`.
- Meta tools for agents/humans: `list_commands`, `describe_command`, `run_command`.

Risk metadata (optional): `risk: none|low|med|high`, `latency: instant|short|long` to inform confirmations and UX hints.

## 9) Terminal UX
Render on each turn:
- Line 1 (status): `pos X,Y,Z | hp H/20 | food F/20 | dim | day|night | held <item?>`
- Line 2 (focus): `cursor: block <name> @ X,Y,Z` or `cursor: entity <name|player> @ Xm` or `cursor: none`.
- Line 3 (nearby): `[1] cow 4.2m  [2] sheep 7.8m  [3] Steve 12.1m` (truncate to 5).
- Line 4 (chat tail): last 1–3 lines.
- Line 5 (last result): `ok <cmd> …` or `err <cmd>: reason` (≤80 chars).

Human syntax (mapped to registry):
- Speak: `say "hi"` → `chat { text }`; `whisper <user> "msg"`.
- Inspect: `status`, `nearby [radius=12] [limit=5]`, `cursor [max=6]`.
- Look: `look @cursor | N|E|S|W | X Y Z`.
- Move: `move to X Y Z [near=2] | to @nearest cow | to #1`; `stop`.
- Act: `dig @cursor | X Y Z`; `place @cursor [face=top]`.
- Inventory: `equip pickaxe [dest=hand]`; `eat [bread]`.
- Meta: `help [cmd]`; `json on|off`; `watch <cmd> <interval>`; `watch off`.

Tokens & shortcuts:
- `@cursor` → block/entity position (resolve via cursor probes).
- `#<idx>` → entity from last nearby list (persist indices until next list).
- `@nearest <name>` → nearest entity by lowercase substring (resolve to its pos).
- `@here` → current bot position.

Completions:
- Command names, then param keys (from JSON Schema), then enum values.
- Token stubs: `@cursor`, `#1..#5`, `@here`, common mob names.

Safety:
- Confirmations on `med|high` risk by default. `confirm on|off` runtime toggle.
- Chat rate limit (default 1 msg/sec). Step caps for long-running actions.

Output discipline:
- Results to stdout; diagnostics (parse errors, confirmations, rate-limits) to stderr.
- `json on` prints full JSON results (and keeps the one-line summary).

## 10) Loop Engine, Drivers, Arbiter
Engine (shared):
- Build frame; select next intent from arbiter; run one command; record result; re-render.
- Enforce global rate limits and per‑tool cooldowns.

Driver interface (enqueue intents):
```ts
type Intent = { id: string; source: 'human'|'llm'|'system'; tool: string; input?: any; kind: 'exclusive'|'parallel'; preempt?: boolean; deadlineMs?: number };
interface Driver { propose(frame: any): Promise<Intent | null>; }
```

Arbiter:
- `enqueue(intent)` from any source; `selectNext(now)` considering priority and lease; `preempt()` when a human `!` or `stop` arrives.

## 11) Config & Flags
- `.env` defaults; CLI flags override.
- REPL options: `--json`, `--verbose`, `--no-confirm`, `--watch-max`, `--tick-ms`, `--nearby-limit`, `--chat-tail`.

## 12) Logging & Telemetry
- Human mode: concise logs; timestamps optional.
- Debug/verbose prints to stderr; never pollute stdout in `--json` mode.
 - Optional JSONL mirror of observation/propose/selected/lease/tool_result events.

## 13) Acceptance Criteria
- Start REPL (`npm run tui`) connects and renders a frame within 3s of spawn.
- `status`, `nearby`, `cursor` render succinctly; errors are prescriptive.
- `say "hi"` sends chat and shows in chat tail.
- `look N`, `look @cursor`, `move to #1 near=2`, `stop` behave as described.
- `dig @cursor` works when a block is targeted; error otherwise with guidance.
- Tab-completion suggests commands, param names, enum values, tokens.
- `help dig` prints spec; `json on` prints JSON results alongside summaries.
- `watch status 1s` refreshes until next command or `watch off`.

## 14) Test Plan (MVP)
- Unit: parser (strings → {cmd,args}); token resolver; formatter for frame lines.
- Integration: run against a local server in offline mode; scripted sequence to verify I/O and state transitions.
- Manual checklist mirrors acceptance criteria.

## 15) Risks & Mitigations
- Movement confusion without viewer → use path-based `move to` + `stop`; show position deltas.
- LLM arg mistakes → schema validation + prescriptive errors; provide probe commands.
- Rate-limits/chat spam → engine-level throttling.

## 16) Open Questions
- Should `move to` auto-`look_at` first for long paths? (Default: no.)
- How strict should confirmations be near other players? (Default: confirm on.)
- Persist REPL history to `~/.behold_history`? (Nice-to-have.)

## 17) Phased Milestones
1) TUI MVP (Human REPL)
   - [x] Frame renderer (preview)
   - [x] Minimal parser (say/status/nearby/cursor/look/move/stop/dig/equip/eat)
   - [ ] Tokens (#idx, @nearest), completions, confirmations, watch, json mode
2) Unified Engine + Arbiter
   - [x] Arbiter skeleton with lease/preempt and rate limits
   - [x] Engine tick wiring (preview)
   - [ ] Integrate arbiter logs with console (propose/selected/lease)
3) LLM Driver (function‑calling)
   - Tool schema mapping; prompt; arg validation; text→`chat`.
4) Unified CLI
   - `behold <AgentName> [--model ...]` default autonomous with inline controls.
5) Polish
   - Aliases, help examples, history file, log file output.

## 18) Detailed TODOs

### A) REPL (HumanDriver)
- [ ] Create `src/tui/repl.ts` entry and script `npm run tui`.
- [ ] Add readline loop with prompt `» `, history, SIGINT handling.
- [ ] Implement `watch` manager (start/stop, interval, display banner).
- [ ] Wire confirmations (`confirm on|off`), default on for med/high risk.
- [ ] Implement `json on|off` mode; route diagnostics to stderr.

### B) Rendering
- [ ] Create `src/tui/render.ts` to print the 5-line frame.
- [ ] Cache last `nearby` list, `cursor` probe, `lastResult`, and chat tail.
- [ ] Format distances (1 decimal), clamp lines to 80 chars.

### C) Parsing & Tokens
- [ ] Create `src/tui/parse.ts` (quoted strings, key=value, simple verbs).
- [ ] Create `src/tui/tokens.ts` with resolvers for `@cursor`, `#idx`, `@nearest`, `@here`.
- [ ] Resolve tokens before dispatch; provide clear errors when unresolved.

### D) Completion
- [ ] Create `src/tui/complete.ts` using registry specs (names, params, enum values).
- [ ] Add token completions: `@cursor`, `@here`, `#1..#5`, common mob names.

### E) Registry Enhancements (as needed)
- [ ] Ensure `get_nearby` exists and returns `{ entities: [...] }` (already present).
- [ ] Ensure `block_at_cursor` and `entity_at_cursor` return concise summaries.
- [ ] Add optional `risk` and `latency` metadata to command specs for confirmations (optional).

### F) Loop Engine Abstraction
- [ ] Create `src/loop/engine.ts` with `runLoop({ bot, registry, driver, tickMs, maxSteps, rate })`.
- [ ] Implement shared limits: `maxSteps`, `rateMax/windowMs`, per-decision timeout.
- [ ] Use the same frame builder used by the REPL renderer.

### G) LLM Driver (stub)
- [ ] Create `src/loop/drivers/llm.ts` with `decide(frame, registry)`.
- [ ] Map registry specs → tool schemas; compose system + frame + tools prompt.
- [ ] Parse model output into `Decision` (tool_call/text/wait), validate args with schema.
- [ ] No vendor SDK in MVP; export an interface `LLMClient` for later.

### H) Scripts & Docs
- [ ] Add `npm run tui` entry.
- [ ] README: “Plug‑and‑Play Agents” + “JSONL Stdio Harness” + TUI quickstart.
- [ ] Link to this PRD from README.

### I) Tests & Acceptance
- [ ] Unit tests: parser, tokens, frame formatting.
- [ ] Manual acceptance checklist (see §13) documented in `docs/ACCEPTANCE.md`.

---

This MVP centers the Mineflayer API as the single source of truth through a stable, spec-first command registry and a tiny, reusable loop. The TUI provides a human-friendly surface today; the LLM driver reuses it tomorrow without new abstractions.
