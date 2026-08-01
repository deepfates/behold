---
id: beh-4hqs
status: open
deps: []
links: []
created: 2026-08-01T07:28:05Z
type: bug
priority: 1
assignee: deepfates
parent: beh-n4fe
tags: [live, lifecycle, recovery]
---

# Make failed first live start recoverable before a persistent head

An ordinary new session can write its authenticated session plan and genesis, then fail local-model preflight before the managed lifecycle creates head.json. A retry is treated as resume and fails because the persistent head does not exist. Preserve the failed attempt, but do not strand the session between new and resumable states.

## Acceptance Criteria

When a first-start failure occurs after Place genesis but before a persistent head, Place stops cleanly and an ordinary retry has one explicit recoverable path. The failed attempt remains inspectable, no world/model/listener or lease leaks, and a focused deterministic test reproduces the observed boundary without inventing another recovery framework.

## Notes

**2026-08-01T07:29:22Z**

Observed on 2026-08-01 in session oxford-living-resident-v2-qwen-camera-v1. The wrong explicit LM Studio model root caused local preflight to fail after Place genesis and session-plan creation but before head.json. Place saved and stopped cleanly and no model call occurred; the preserved session directory has session.json, genesis/runtime, and episode 000001 transcript but no head.json. A normal retry therefore cannot classify it as either new or resumable. This ticket owns that exact lifecycle boundary; it is not a blocker for the completed camera-perception seam.
