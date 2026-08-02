---
id: beh-2j11
status: open
deps: []
links: []
created: 2026-08-02T01:26:47Z
type: feature
priority: 0
assignee: deepfates
parent: beh-06av
tags: [cognition, openrouter, timing, living-world]
---

# Admit reasoning-disabled OpenRouter resident sessions

DeepSeek V4 Flash no-world probes against one retained high-pressure resident request returned valid strict JSON in 1.476s with reasoning disabled, versus 10.205s with reasoning minimal and a second minimal call exhausting 512 tokens after 9.095s without content. Current Behold v2 forces minimal reasoning; the route cannot express the fast condition or bind per-request privacy controls.

## Acceptance Criteria

A new versioned resident-v2 OpenRouter route binds strict-JSON resident decisions, reasoning disabled, exact endpoint/no fallback, max output, ZDR=true, and data_collection=deny in the authenticated request; broker and response identity remain strict; existing v1-v3 bytes and semantics remain unchanged; focused/full provider-free tests pass; a sealed no-world V4 Flash call is schema-valid within the body horizon; only then may one bounded ordinary habitat episode run under the declared provider cap.

## 2026-08-01 no-world gate

The sealed probe used one exact retained high-pressure Sedge request from Oxford episode 000005, minus camera bytes because `deepseek/deepseek-v4-flash` is text-only. The exact `deepinfra/fp4` route returned provider `DeepInfra`, with fallbacks disabled, ZDR required, and data collection denied.

- Minimal reasoning: one valid action in 10.205s; one 9.095s call exhausted the 512-token output cap without content.
- Reasoning disabled: one direct valid action in 1.476s. The ordinary Behold adapter then produced valid actions in 6.839s cold and 1.335s, 0.901s, 0.881s, and 5.069s across repeated calls. Reported reasoning tokens were zero.
- Total probe spend was about $0.0019. Known workshop aggregate remains about $31.01.
- The full provider-free repository check passes: 699 passed, 1 skipped, 0 failed.

This admits a bounded semantic-only live probe. It does not establish stable warm latency, better conduct, or a camera-capable replacement for the local Qwen treatment.
