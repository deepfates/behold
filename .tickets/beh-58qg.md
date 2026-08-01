---
id: beh-58qg
status: in_progress
deps: []
links: []
created: 2026-08-01T03:55:38Z
type: feature
priority: 1
assignee: deepfates
parent: beh-kpqx
tags: [resident-interface, perception, multimodal]
---

# Prototype causally bound resident-camera perception

Add the smallest disposable path by which a resident mind can receive an exact current frame from its own Minecraft camera alongside bounded body events. Do not use an operator camera privileged geometry or a controller-selected interpretation.

## Acceptance Criteria

One content-addressed frame is bound to the same resident body observation and decision opportunity; stale or mismatched frames fail closed; supported model routes receive it without merging resident sessions; measured capture encoding prompt cost and latency are recorded; semantic-only operation remains an explicit comparable condition; no model or world action is selected by the camera path.

## Implementation checkpoint

- Implemented an isolated, read-only `behold.resident-camera-frame.v1` artifact. It binds exact PNG/JPEG bytes, viewport and renderer/FOV identity, the full raw observation digest, resident/body identity and pose, and capture interval. Parsing and admission reject content, observation, body, pose, freshness, or renderer drift.
- Deterministic focused tests cover content addressing, immutability, mismatch rejection, age/future/duration bounds, and perspective FOV derivation. The pure boundary receives no bot, controller, world, or action authority.
- Still unimplemented: a synchronized resident-owned frame capture. The current browser viewer has no pose/frame-ready acknowledgement, and the headless Prismarine renderer needs an absent native WebGL canvas dependency. Static fixture bytes are not resident perception.
- Still unexercised: multimodal provider/local wire delivery, capture/encoding/token/latency measurement, session isolation under image input, and the semantic-versus-camera comparison. Keep this ticket in progress.
