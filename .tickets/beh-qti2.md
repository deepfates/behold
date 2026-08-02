---
id: beh-qti2
status: closed
deps: []
links: []
created: 2026-08-02T02:02:47Z
type: task
priority: 0
assignee: deepfates
parent: beh-c5gr
tags: [design, cognition, ground-truth]
---

# Define Rowan's exact continuous resident transcript specimen

Use Rowan's retained Oxford episode 000001 request/life as the concrete design specimen. Map canonical Lync turns and current body events into the exact provider-neutral message sequence the resident should experience, distinguishing perceivable world facts from controller bookkeeping.

## Acceptance Criteria

The specimen covers Rowan's retained history through the known turn-39-41 gap and sequence-311-341 burst; every included/excluded field has a resident-facing reason; the expected message order is exact; and no summary, recommendation, or inaccessible history reference substitutes for lived content.

## Notes

**2026-08-02T02:23:32Z**

Ground-truthed against stopped Rowan Lync on 2026-08-02: 52 canonical turns project to 156 chronological messages / 178,916 JSON bytes. Turns 39-41 are present; turn 44 covers admitted observation sequence 310 through authenticated next sequence 341, and turn 45 continues 341-347. docs/RESIDENT_TRANSCRIPT.md now records exact order and inclusion/exclusion authority. Focused deterministic projector tests pass.
