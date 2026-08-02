---
id: beh-s37t
status: open
deps: []
links: []
created: 2026-08-02T09:05:56Z
type: bug
priority: 0
assignee: deepfates
parent: beh-06av
tags: [harness, attention, living-world]
---

# Remove waiting from the resident action vocabulary

Ordinary episode 000015 exposed `wait_for_event` as a harness attractor: Behold appends it to every action catalog, asks the model to choose exactly one control, records waiting as a completed life turn, and then feeds those turns back into later context. The fixed four-second timer and generic `time_passed` experience made the attractor obvious, but making this pseudo-action suspend more precisely would preserve the deeper mistake. Inactivity is possible resident conduct; choosing a controller scheduler operation is not a Minecraft action or a meaningful life event.

## Design

Let one cognitive opportunity return zero or one admitted bodily intention. Remove `wait_for_event` from the model-facing action catalog, response reminder, and action-result history. Behold owns when cognition is reconsidered, using a small explicit policy over meaningful experience change and elapsed time; that policy and each actual cognition admission remain operator-visible. A no-intention response must not manufacture a Minecraft consequence or a synthetic action turn. Preserve silence and inactivity without prescribing productive conduct, inferring goals, or adding hidden reflexes.

## Acceptance Criteria

In an ordinary no-task resident session, the exact model request offers only real current bodily controls (plus separately identified private-life recall where applicable), and the response contract permits no bodily intention. No-intention responses do not enter Minecraft's action stream or canonical Lync as synthetic `wait_for_event` actions. Behold does not re-call the model every four seconds solely because the previous response had no intention or generic time passed; a material lived change and a bounded low-frequency reconsideration can each create a visible new cognitive opportunity with all intervening experience intact. Pause, stop, and resume remain clean. Focused tests cover the literal request, no-intention handling, material change, reconsideration, lifecycle, and stop/resume paths.

## Progress

Implemented locally on 2026-08-02 for the minimal resident-v2/v3/v4 treatments. Their strict schema now admits `{"action":null,"arguments":{}}`, omits `wait_for_event`, performs no Minecraft attempt or synthetic Lync action turn for null intention, ignores generic `time_passed` as a wakeup after null intention, and admits meaningful experience or a 60-second reconsideration. The focused policy test and full repository check pass. This is implemented and mechanically exercised, not yet exercised through ordinary `behold live`; keep the ticket open until a captured short live episode proves the literal request and clean lifecycle.

## Notes

**2026-08-02T09:47:50Z**

2026-08-02 no-world audit found and repaired the immediate continuous-wire consequence of null intention: resident-v3/v4 layout validation had still required every assistant response to be followed by a Minecraft/private-life outcome, so the second cognition after null intention would have failed before provider admission. The layout now admits an exact null response directly between two lived-experience messages and rejects nonempty null arguments; focused LM Studio wire tests pass. Durable stop/resume retention of the null cognition is a distinct canonical-life defect tracked in beh-wo5b, which now blocks beh-xzc6.

**2026-08-02T09:54:00Z**

Morning acceptance coordinate (do not run as a long epoch while beh-wo5b is open): from clean Behold, resume the stopped qualified Oxford session with exact provider capture for about three minutes: BEHOLD_RECORD_MODEL_IO=1 npm run live -- /Users/deepfates/Hacking/data/artifacts/place-compiler/qualification-candidates/oxford-v3-habitat-v1 --accept-eula --session oxford-qualified-habitat-a-qwen36-camera-v1 --state /Users/deepfates/Hacking/github/deepfates/behold/data/live --duration 180 --place-compiler /Users/deepfates/Hacking/github/deepfates/place-compiler. Place Compiler is currently clean at required b872237; the session head is completed_run with digest 7e98dbfa..., latest resident revision 000003 is resident-v4, and the managed front door owns LM Studio load/unload. Accept only literal schema/request truth, any naturally occurring null-to-later-request continuity, exact inspector readability, and clean stop. Do not require or induce null conduct. Keep beh-wo5b open for restart persistence even if the short episode passes.
