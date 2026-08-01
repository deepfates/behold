---
id: beh-58qg
status: closed
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
- Implemented the opt-in `semantic-plus-camera-v1` treatment through ordinary resident configuration, release identity, lazy viewer capture, exact request parsing/hashing, private transport, and strict LM Studio multimodal serialization. The unchanged final semantic text becomes the first content part and exactly one bound frame becomes the second; the stable resident prefix and action schema do not change. Semantic-only remains the default and starts no browser. Capture failure, abort, stale/mismatched binding, absent first-person viewer, non-vision inventory, Ollama, Ax, and current OpenRouter routes fail before mind admission with no downgrade. The authenticated broker binds the declared treatment and refuses an image on a semantic-only client or text-only input on a camera client. Frame freshness is rechecked after any prefix warmup immediately before the resident request. Journals receive content-free frame identities; pixels do not enter Lync, Textile, or resident continuity.
- The full check passes: 638 tests, 637 passed and one intentionally skipped. A real host Chrome test rendered a 512x512 frame; focused tests cover abort, no-downgrade, exact multimodal reconstruction, resident identity, stable prefix, treatment-bound broker admission, post-readiness freshness, and vision admission.
- Matched no-world LM Studio probes exercised the currently installed Gemma 4 12B Q4_K_M and Qwen 3.6 35B-A3B 4-bit. Both returned valid strict-schema public content with image input under their admitted `reasoning_effort: none` setting. Omitting that setting put generation in private `reasoning_content`; Behold correctly rejects it rather than scraping private reasoning.
- Exercised the ordinary persistent-world path with two Qwen 3.6 35B-A3B residents for 90 seconds and a clean 30-second resume. Both resident sessions used one physical LM Studio instance while retaining distinct resident keys, accounts, bodies, request histories, and Lync lives. Exact 512x512 first-person frames reached every settled decision; warm capture took 6–11 ms, request bodies were roughly 94–121 KiB, and successful resident calls took about 3.0–4.8 seconds. Resume reopened each resident with ten prior turns and continued the same separate lives.
- Both residents independently returned `wait_for_event` throughout. No camera code, scheduler, or controller selected or repaired that conduct. The two episodes saved and stopped cleanly, unloaded the owned model, and left no listeners. Textile projected episode 000002's 766,901-byte, 34-event Lync union as 32 readable resident events plus two structural roots with zero unsupported, nonconforming, or warning diagnostics.
- This closes the camera seam, not the question of whether pixels change conduct. The semantic-versus-camera comparison remains the optional diagnostic in beh-gidu. A frame and semantic observation share an exact body pose and honest capture interval, not an atomic Minecraft world-revision claim.
