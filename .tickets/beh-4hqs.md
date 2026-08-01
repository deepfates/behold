---
id: beh-4hqs
status: closed
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

**2026-08-01T07:36:17Z**

Fixed in 0149adf by distinguishing four explicit entry states: new, authenticated first-start retry before any managed lifecycle, normal resume with a head, and recovery-required lifecycle without a head. The full check passed 638/639 with one intentional environment skip. The preserved oxford-living-resident-v2-qwen-camera-v1 session then exercised the ordinary retry with no resident file or repair flag: it reused episode 000001's plan/genesis, started both residents, wrote lifecycle-1 and a completed_run head with runtime digest b5875c3a6f476eae05479f00fc2d62d7731869aabc3d9846ecd363a9aef522a5, emitted episode 000002, and stopped cleanly. Episode 000001's sole failed-attempt transcript remains intact at SHA-256 9de4535f1590b0aa714600e0fb976288dc9a179f130b1069c613b92a36783f33. The exact resume-continuity assertion passes; Textile reads the new 118,873-byte union as five readable events plus two roots with zero diagnostics; LM Studio is unloaded and no world/viewer listener remains.
