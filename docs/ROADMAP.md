# Roadmap

Short term
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

