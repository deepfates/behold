# Changelog

All notable changes to this project will be documented in this file.

## 0.1.0-alpha.0 — 2025-10-14

Initial alpha of the plug‑and‑play agent library.

Highlights
- Interpreter: spec‑first command registry over Mineflayer (chat/look/move/dig/place/inventory/sense).
- Tools: `list_commands`, `describe_command`, `run_command` to discover and execute commands.
- JSONL stdio harness: machine‑friendly observe → call → result loop.
- Engine + Arbiter (preview): single action stream with human+LLM intents, exclusive lease, preempt, and rate limits.
- Console REPL (preview): terminal UI with concise frame (status/nearby/cursor/chat) and basic commands.
- LLM Policy (preview): OpenRouter function‑calling autopilot that proposes one action per tick using the same registry.
- Docs: README/PRD updated to unified design; user stories refreshed.

Known limitations
- Console: no tab completion or `@nearest/#idx` tokens yet; confirmations and watch mode pending.
- Policy: simple anti‑repeat; limited context; minimal safety heuristics.
- LLM errors are logged, but backoff is basic. Viewer is optional and not required.

