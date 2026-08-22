# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Reframed the product around persistent Minecraft habitats, truthful resident
  embodiment, private continuing Lync lives, and clean stop/resume.
- Added `behold live` composition with exact Place Compiler package pinning,
  qualified living-entry admission, resident lens controls, and retained episode
  evidence.
- Added a read-only First Life clean-checkout preflight and one tracked
  semantic-only resident example. The installed-package start/stop/resume path
  is exercised with a private local model; the tracked outsider route and a
  public qualified starter release remain pending.
- Accepted both legacy Git and exact installed-package Place Compiler identities
  in persistent world verification, so installed sessions resume fail-closed.
- Reconciled package metadata with the tracked Apache-2.0 license and Node.js
  22.13 engine floor.

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
