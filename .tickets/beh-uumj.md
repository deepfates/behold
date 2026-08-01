---
id: beh-uumj
status: in_progress
deps: []
links: []
created: 2026-08-01T08:44:12Z
type: bug
priority: 1
assignee: deepfates
tags: [perception, camera, timing]
---

# Resample exact camera perception after body motion

An ordinary semantic-plus-camera resident can complete a movement while Mineflayer still settles a fraction of a block. The next decision currently reuses a semantic observation whose pose no longer equals the live body and records a model_call_failed before any model call. Refresh perception rather than weakening pose binding or treating apparatus motion as model failure.

## Design

Keep exact body/UUID/observation/frame admission. Name pose drift as a transient capture condition; make no model call and consume no decision step while it is true; after a short bounded settling interval, reobserve and rebuild the semantic/action request before capturing again. Do not retry a model, choose an action, or downgrade to semantic-only.

## Acceptance Criteria

A focused policy test proves transient body-pose drift causes a fresh observation and second camera attempt without mind admission or a model error; malformed identity/body/camera data still fails closed. A real ordinary camera resident that moves can receive a later exact camera decision opportunity without resident_camera observation mismatch. Full check passes and canonical docs/evidence state the exercised boundary plainly.

## Notes

**2026-08-01T08:45:05Z**

R3 qwen-camera exercised the defect through ordinary live: move_controls forward 1000ms completed and moved the saved body from z=1408.5 to z=1413, but the immediate next camera preparation used a z=1412.8 semantic snapshot after the live body settled to z=1413.0. No second upstream call occurred; the controller logged model_call_failed with a null call. Implemented a typed transient pose-change boundary: retain exact pose/UUID/frame admission, decrement the unspent model step, reobserve after 50ms, rebuild the world update/affordances, and recapture without mind admission or semantic downgrade. Focused 85/85 passed; full check 644 tests, 643 pass, one intentional skip. Real post-fix resume remains before closure.
