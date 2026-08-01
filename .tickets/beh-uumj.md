---
id: beh-uumj
status: closed
deps: []
links: [beh-5vwp]
created: 2026-08-01T08:44:12Z
type: bug
priority: 1
assignee: deepfates
tags: [perception, camera, timing]
---

# Establish one truthful post-motion perception boundary

An ordinary resident can complete a bounded movement while Mineflayer still
settles a fraction of a block. The next decision must not combine a stale
semantic observation, current affordances, or a camera frame from different
body poses. This is one shared terminal-to-next-observation boundary, not a
camera retry policy.

## Design

Keep exact body/UUID/observation/frame admission. After an authenticated action
terminal reports body motion, sample the exact raw body pose on a short bounded
cadence until two consecutive samples agree. Discard intermediate samples;
they spend no model call or decision quota and enter no conversation. Semantic
and camera profiles then derive their next request from the same settled body
frame. Exhaustion remains visible and stops that continuation; stop cancels the
wait. Do not retry a model, choose an action, or downgrade perception.

## Acceptance Criteria

Focused tests prove exact raw pose preservation; identical bounded settlement
for semantic and camera profiles; no hidden model call or discarded message;
bounded persistent motion; prompt stop cancellation; and fail-closed malformed
identity/body/camera data. A real ordinary camera resident that moves can
receive a later exact camera decision opportunity without a resident-camera
observation mismatch. Full check passes and canonical docs/evidence state the
exercised boundary plainly.

## Notes

**2026-08-01T08:45:05Z**

R3 qwen-camera exercised the defect through ordinary live: move_controls forward 1000ms completed and moved the saved body from z=1408.5 to z=1413, but the immediate next camera preparation used a z=1412.8 semantic snapshot after the live body settled to z=1413.0. No second upstream call occurred; the controller logged model_call_failed with a null call. Implemented a typed transient pose-change boundary: retain exact pose/UUID/frame admission, decrement the unspent model step, reobserve after 50ms, rebuild the world update/affordances, and recapture without mind admission or semantic downgrade. Focused 85/85 passed; full check 644 tests, 643 pass, one intentional skip. Real post-fix resume remains before closure.

**2026-08-01T09:02:56Z**

The first camera-only retry was falsified by its real resume: it retried for the
entire 25-second episode. Raw Mineflayer z=1413.029286... had been rounded to
1413.0 in the observation, so strict camera binding could never succeed; the
retry also changed timing only for the camera treatment and had no bound.
Replaced that design with exact private body pose plus one shared, bounded
post-motion settlement gate before either semantic or camera continuation.
Intermediate frames never enter cognition. Focused tests now cover settled,
exhausted, and stopped outcomes. Full check and ordinary live exercise remain
before closure.

**2026-08-01T09:06:09Z**

Ordinary post-fix resume passed in mp-r3-qwen-camera episode 000003 at commit c1d20a6. Qwen independently chose move_controls forward for 1000 ms. Minecraft reported bodyMoved=true; the shared exact-pose gate settled after 8 samples / 411 ms; the turn appended as R3QwenCamera turn 2; and the following camera-bound mind request reached the broker without resident-camera observation mismatch. Its predeclared resident_decision quota then returned a visible 429. Episode fe113b85..., world e8319cf5..., journal 1b693998..., Lync 3d763912... all saved; model/listeners unloaded. Textile projected 3 source events as 2 readable + 1 structural, with zero unsupported, nonconforming, or warnings.
