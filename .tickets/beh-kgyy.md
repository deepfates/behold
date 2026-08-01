---
id: beh-kgyy
status: closed
deps: []
links: []
created: 2026-08-01T02:02:25Z
type: bug
priority: 0
assignee: deepfates
parent: beh-n4fe
tags: [perception, timeliness, living-world]
---

# Prevent unread lived events from aging out under ecology pressure

Ordinary episode 000039 produced model-facing incomplete event windows on 22/340 turns and missingBeforeOldest up to 14. Current observation-context delivery caps unread events at 12 while the bounded body history continues to advance, so some unread pressure-plate/world/lifecycle events aged out before any resident decision received them. The gap is labeled honestly but violates dependable timely perception.

## Acceptance Criteria

Under a representative sustained event rate, every unread decision-relevant lived change is either delivered in causal order before eviction or replaced by an explicitly typed truthful bounded compaction that preserves its decision-relevant content and exact omitted range/count; resident cursors never silently skip; model context stays bounded; no action/task/behavior preference is introduced; focused adversarial tests, full Behold check, and one deployment-shaped dense ordinary-path exercise pass with zero missingBeforeOldest loss.

## Resolution

The model-facing limit now counts visible lived events rather than raw engine
bookkeeping. Suppressed successful controller lifecycle events still advance the
cursor through the represented causal prefix. Consecutive non-urgent sounds are
projected as `behold.sound-sequence.v1`, retaining their exact source sequence
and time ranges, count, salience, and each change in acoustic content; urgent
and high-salience sounds remain individual events. The raw body history and
canonical journals are unchanged. No task, preferred action, conduct judgment,
or recovery behavior was added.

A focused ordinary-policy test sustained six cycles of 18 pressure-plate sounds,
six controller events, and a visible block change while exposing only the last
40 raw events. Every decision received the sound sequence and world change,
advanced through the exact newest sequence, and observed zero
`missingBeforeOldest`. Replaying the complete episode 000039 resident streams at
their recorded model-turn boundaries recovered all 1,393 Iris and 1,350 Moss
events with no holes. The repaired projection produced zero missing and zero
omitted windows (old run: 22 incomplete windows, maximum missing 14), compacting
sound on 16 Iris and 20 Moss turns. Peak unread batches were 26 and 21 events.
`npm run check` passed 609 tests with one environment skip and no failures.

Post-resolution live validation: episodes 000044-000045 ran the committed repair
through ordinary `behold live`, clean stop, and resume. Across 164 model turns,
both residents had zero incomplete, missing, or omitted event windows. The
original pressure source was not active at their new positions, so no live sound
sequence was needed; this complements rather than replaces the exact episode
000039 pressure replay. Episode 000045 reopened Moss at its saved y=-60 body
position with its own confirmed excavation history in the first request.
