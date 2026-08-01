---
id: beh-5vwp
status: closed
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

## Notes

**2026-08-01T09:12:19Z**

The candidate proved substantive rather than nominal. A private CurrentExperienceFrame replaces separately mutable raw/projected observation fields; one ResidentDecisionFrame derives attention, model, admitted actions, and required action; one request constructor serves authority-free preparation and real cognition; camera capture binds to the same raw frame. A focused test holds object identity through actionsFor, camera capture, and attempt admission while independently matching the semantic projection, camera observation hash, request hash, and durable turn. No public protocol or world/Lync authority changed. Focused tests pass; full check remains.

**2026-08-01T09:14:51Z**

Ordinary post-refactor exercise passed at commit 40c2399 in mp-r3-qwen-camera episode 000004. The same life resumed with two prior turns; its exact camera request was admitted; Qwen naturally chose move_controls forward 1000 ms; Minecraft truthfully returned bodyMoved=false at the obstruction, so no post-motion settlement was invented; the turn appended as turn 3; and the next request reached only the predeclared quota terminal. Episode f1ae8417..., world 43c1c975..., journal f2d965a2..., Lync 7695fe4f... saved cleanly; model/listeners unloaded. Textile projected 4 source events as 3 readable + 1 structural with zero unsupported, nonconforming, or warnings. Full check: 647 tests, 646 pass, one intentional skip.
