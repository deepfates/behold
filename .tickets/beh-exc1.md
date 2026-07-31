---
id: beh-exc1
status: closed
deps: []
links: []
created: 2026-07-31T02:31:41Z
type: bug
priority: 0
assignee: deepfates
parent: beh-cqjs
tags: [behavior, policy, live]
---

# Keep legible residents from substituting talk and camera motion for conduct

Episode 000014 exposed that production-shaped legible-resident-v1 bypasses every loop breaker because those invariants are gated to legacy resident-v1. Luna produced one real movement/pressure-plate/witness chain, then 120+ successful turns dominated by chat/whisper/look with no durable consequence.

## Design

Separate profile personality from generic progress invariants. Count progress by observable world/body consequence, not merely by changing tool names, so chat/whisper alternation with look_direction cannot reset the circuit breaker.

## Acceptance Criteria

The legible resident policy rejects recurring communication/camera-only churn after bounded non-progress, while preserving neutral benchmark behavior and without selecting or rehearsing a specific embodied action; a bounded ordinary live episode must show materially more embodied/world-directed conduct rather than the same social/look loop.

## Notes

**2026-07-31T02:40:27Z**

Episode 000015 exercised the repair through ordinary behold live: 79 decisions, $0.0625925 reported cost, 38 move_controls choices plus varied orientation/use attempts versus only one move in 000014. The social/camera guard rejected 19 churn proposals, product residents adapted into bodily motion, neutral remained unchanged, the world stopped cleanly, and full check passed (588 pass, one environment skip). This satisfies this narrow repair ticket, not parent acceptance: no persistent mutation occurred.
