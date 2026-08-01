---
id: beh-5vwp
status: open
deps: []
links: [beh-uumj]
created: 2026-08-01T09:00:57Z
type: task
priority: 2
assignee: deepfates
tags: [behold, architecture, candidate]
---

# Unify one resident decision frame before cognition

Candidate simplification after the live perception repair. Construct one private typed decision-frame value from one raw inhabitant observation: exact raw body/world frame, resident-visible projection, attention, currently admitted actions, and optional exact camera. Setup and ordinary decision paths should consume that value instead of recomputing related pieces independently. This is local Behold cleanup, not a public causal-algebra package or a new resident layer.

## Design

Keep InhabitantInterface, ResidentMind, engine/interpreter authority, and Lync turn semantics unchanged. Extract only after the current post-motion boundary is exercised live. If the value merely renames existing variables or broadens across substrates, close this candidate without implementation.

## Acceptance Criteria

A focused test proves semantic observation, admitted actions, optional camera, request hash, and action admission all derive from the same raw observation identity. Existing ordinary live behavior and mind transport contracts remain unchanged. The extraction removes duplicated request preparation or stale-frame opportunities from policy/llm.ts and reduces, rather than increases, independently mutable lifecycle state. Full check passes.
