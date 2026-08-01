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

- Implemented an isolated, read-only `behold.resident-camera-frame.v1` artifact. It binds exact PNG/JPEG bytes, viewport and renderer/FOV identity, the full raw observation digest, resident/body pose, exact rendered eye camera, and capture interval. Parsing and admission reject content, observation, body, pose, freshness, or renderer drift.
- Implemented a lazy `behold.prismarine-resident-camera-capture.v1` path over the existing Behold-owned viewer. A capture-only authenticated headless browser applies the exact current bot camera without the viewer's 50ms tween, waits for Prismarine's chunks, renders once, returns no control input, and rechecks the live body before the frame is admitted. Its Chrome/WebGL dependency is explicit and no browser starts during semantic-only operation.
- Exercised on this host with installed Chrome and a disposable fake Mineflayer world: one 512x512 JPEG was captured and bound to the exact body/eye pose; mismatched observation pose failed before capture. Focused tests also cover content addressing, immutability, mismatch rejection, age/future/duration bounds, and perspective FOV derivation.
- The official native Prismarine headless dependency was tried without repository mutation but its `gl` backend does not build against this host's modern Node/Clang combination. The browser path avoids carrying that incompatible native dependency.
- Still unexercised: capture against the persistent world, multimodal provider/local wire delivery, measured real-world encoding/prompt/latency, session isolation under image input, and the semantic-versus-camera comparison. A frame and semantic observation share an exact body pose and honest capture interval, not an atomic Minecraft world-revision claim. Keep this ticket in progress.
