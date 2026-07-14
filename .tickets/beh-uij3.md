---
id: beh-uij3
status: closed
deps: []
links: []
created: 2026-07-13T23:49:25Z
type: feature
priority: 0
assignee: place-compiler
parent: beh-wzs5
tags: [architecture, autophagy, e2e]
---

# Canonicalize disposable Minecraft harness and progress evidence

Extract the earned Place-owned runtime materialization, server lifecycle, protocol observer, deterministic site placement, tick sprint, process sampling, clean shutdown, and structured progress-event primitives shared by inspection, ecology, and performance. Preserve the Behold ownership boundary.

## Acceptance Criteria

All three production lanes use one shared harness; JVM/profile policy is authoritative and consistent; stage progress is machine-readable and human-readable; focused and real-server regression proofs pass; duplicate implementations are deleted; no Behold lifecycle import.

## Notes

**2026-07-13T23:50:57Z**

Audit evidence: inspect-places.mjs, soak-ecology.mjs, and sweep-performance.mjs duplicate wait/materialize/JAR verification/JVM readiness/log capture/Mineflayer connect/save-stop; soak+performance also duplicate standable-surface, median site, tick sprint. Heaps disagree with runtime-manifest. Extract Place-owned harness only; do not call Behold world-runner.

**2026-07-14T00:05:54Z**

Implemented one Place-owned disposable Minecraft harness across inspection, ecology, and performance; extracted deterministic observation-site selection and dynamic evidence expectations; removed 500+ lines of duplicated lifecycle code; made runtime-manifest launch authoritative; added concise stderr progress plus checksummed JSONL; added focused repetition selection without changing the canonical contract. Verified with 206/206 repository tests and real Lower Manhattan inspection, full 24,000-tick ecology soak, and focused performance proof (399 TPS, 19.95x realtime headroom, clean shutdown). No Behold lifecycle imports or colleague-worktree edits.
