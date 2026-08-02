---
id: beh-7oem
status: closed
deps: [beh-qti2]
links: []
created: 2026-08-02T02:02:47Z
type: feature
priority: 0
assignee: deepfates
parent: beh-c5gr
tags: [cognition, lync, runtime, isolation]
---

# Project canonical resident life as an append-only conversation

Implement the versioned provider-neutral Lync-to-conversation projector and encode it through resident inference adapters while preserving old protocols and canonical authority.

## Acceptance Criteria

Successive requests share a stable append-only private prefix; prior assistant outputs and exact Minecraft outcomes remain explicit; all perceivable intervening events and a fresh current view appear in order; full history is used until the verified context budget; deterministic replay, restart, isolation, and context accounting tests pass; historical resident routes are unchanged.

## Notes

**2026-08-02T02:23:32Z**

Implementation checkpoint: resident-v3 projector and transcript docs exist; cursor-backed prefix readiness reconstructs all 8 canonical turns when only 2 are retained in the live suffix; eager restart preserves chronological roles; future v3 Lync commits retain exact admitted strict-JSON response content; build and focused tests pass. Transport/context admission and full regression remain open.

**2026-08-02T02:34:47Z**

Exact no-world Rowan gate on 2026-08-02: canonical 52-turn stopped Lync reconstructed into 158 mind messages / 159 provider messages / 192,914 wire bytes with 52 assistant-history positions. DeepSeek V4 Flash via exact DeepInfra fp4, route v5, reasoning disabled/ZDR/data-deny: 44,042 prompt + 51 completion tokens, 6.112s wall latency, valid strict JSON, /bin/zsh.003968. Choice was a 154-character chat sentence; no world action executed. Compared with old ~25-29KB requests and ~1.1-1.4s latency, full continuity is materially slower but inside the 1,048,576-token bound. Known workshop aggregate ~31.054 USD.

**2026-08-02T02:41:18Z**

Final-serializer repeat supersedes the earlier wire specimen: body d0241c4db8bfd43051b3486a795fb9b13f134d3105d7171816d8410e9049046a, 192,641 bytes / 159 messages / 52 assistant-history messages, no mutable response reminder, layout v2 + continuous transcript v1. DeepInfra returned valid move_controls strict JSON in 5.839s using 44,002 prompt + 19 completion tokens, cost /bin/zsh.003958992. Two paid no-world probes together cost /bin/zsh.007927344; known workshop aggregate ~31.058 USD. Literal successive provider-message prefix is now covered by test.
