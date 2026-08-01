---
id: beh-s4hx
status: in_progress
deps: []
links: []
created: 2026-08-01T03:55:38Z
type: feature
priority: 1
assignee: deepfates
parent: beh-kpqx
tags: [observability, operator, lync]
---

# Project one live resident causal lens

Let an operator see each resident's current `experience → choice → attempt → consequence → next experience` from the already authoritative run journal. A post-append entity-turn event marks durable Lync commitment; the lens does not subscribe to or rewrite Lync. Scheduler phase, latency, source gaps, and body status are controller telemetry around the loop, not additional stages of resident agency. This is a projection, not a new recorder, evaluator, or proof framework.

## Acceptance Criteria

During an ordinary multi-resident run the operator can distinguish the admitted experience, returned choice, active attempted control, transient and Lync-committed consequence, and next experience for each resident. Optional narration is metadata on the choice, not its substance. Separate controller telemetry shows decision latency, lifecycle phase, body condition, and unavailable source state. The view derives from existing authenticated events, accepts no control request, writes no competing canonical history, closes with the run, and leaves Textile as the historical Lync reader; focused projection tests pass.

## Implementation checkpoint

- Implemented a pure disposable reducer over existing per-resident run-journal events. It admits only the exact human-semantic `model_turn` observation and `entity_turn.observationPresentation` pair; raw entity-turn controller frames are never projected.
- Implemented one loopback-only GET/SSE surface that tails the existing journals, keeps no durable state, embeds the already read-only resident POV, rejects non-GET requests, and closes with `behold live`.
- Focused reducer, privacy, unavailable-state, SSE, read-only route, missing-journal, and listener-cleanup tests pass. `npm run lint` passes; the full suite passes 623 with 1 skipped and 0 failed.
- Still unexercised: the ticket's ordinary multi-resident live acceptance. Keep this ticket in progress until that run shows the complete lens and clean shutdown in the actual front door.
