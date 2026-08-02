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

# Make resident waiting an actual suspension rather than a polling loop

Ordinary episode 000015 exposed wait_for_event as a harness attractor: a resident yields for a new event, but the fixed four-second decision timer and generic time_passed experience wake it into nearly the same choice again. Recent waits then re-enter working continuity and reinforce the loop. This is a treatment defect, not evidence that waiting conduct is invalid.

## Design

Preserve voluntary inactivity without repeatedly asking the model to choose it. A yielded resident remains suspended until an actual declared or attention-worthy world change, operator lifecycle event, or a separately named low-frequency reconsideration boundary. The wake cause must be resident-visible and operator-visible. Do not prescribe a productive action, infer goals, or add hidden reflexes.

## Acceptance Criteria

In an ordinary no-task resident session, one wait_for_event choice does not trigger another model call merely because AGENT_TICK_MS elapsed or a generic time_passed event was emitted. A later material world event wakes the same resident with the exact cause and all intervening experience intact. Pause, stop, and resume remain clean; canonical Lync records the yield and the later wake without synthetic repeated wait turns. Focused tests cover timer, material event, lifecycle, and stop/resume paths.
