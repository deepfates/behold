# Roadmap

## Status (Updated 2024-12-30)

**Working:**

- ✅ Tool-calling LLM via OpenRouter (functional but observation minimal)
- ✅ Multi-bot deployment (swarm mode tested)
- ✅ Arbiter + Engine (priority queueing, preemption working)
- ✅ Multiple control modes (console, stdio harness, agent loop)

**Blocking Issues:**

- ❌ Observation layer too minimal (position, health, cursor only)
  - Missing: inventory, nearby blocks (beyond cursor), action feedback
  - See PRD §7 for full frame spec - not yet implemented
- ❌ Multiple entry points instead of unified CLI per PRD §9
- ❌ No test suite (unit tests needed)

**Next Priorities:**

1. Implement unified CLI (`behold <AgentName>`) per PRD §9
2. Enhance observation to match PRD §7 frame spec (add inventory, nearby blocks)
3. Add proper test suite (jest/mocha with mocked Mineflayer APIs)

---

## Short term

- Tool-calling LLM: enable structured tool calls via OpenRouter function specs and execute tools with rate limits and step caps.
- Safety rails: reply throttling, chat mention filters, env-guarded tool allowlist.
- Tests: unit tests for tools registry and agent loop (mock Mineflayer APIs).

Medium term

- Inventory/interaction helpers: auto-equip before `dig_block`, simple item pickup logic.
- Observability: structured logs and per-bot prefixes; optional file logging.
- Better examples: scripted scenarios demonstrating `move_to`, `look_at`, and `get_status`.

Long term

- Memory: short-term action/chat memory with summarization.
- Tasking: accept `/task <goal>` in chat for multi-step behaviors.
- Pluggable reasoning: experiment with different prompting/tool policies.

Out of scope (for now)

- Web click-to-act and integrated web controls (consider reintroducing as an optional, gated feature later).
