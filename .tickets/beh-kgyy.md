---
id: beh-kgyy
status: open
deps: []
links: [beh-uumj, beh-wssv, beh-1h3a]
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

## Notes

**2026-08-01T23:13:36Z**

Episode oxford-qualified-habitat-a-qwen36-camera-v1/000001 falsified the closed pressure fix as sufficient. During ordinary zombie/skeleton combat, repeated same-entity visibility edges overflowed the 40-event raw history while the model was in flight and the 12-visible-event prefix prevented tail delivery. OxfordLark model turn 46 omitted two importdf chat messages; missingBeforeOldest reached 50 and omittedNewEvents 28. This is a Behold information defect, not resident conduct. Repair must bound/coalesce ambient visibility oscillation and preserve chat, hurt/death, body/material changes, current scene truth, and exact represented cursor ranges; do not merely raise constants.

**2026-08-01T23:53:58Z**

Qualified same-life resume episode 000003 exercised the repaired projection through 50 model turns (23 Lark, 27 Sedge). Every model-facing eventWindow was complete with missingBeforeOldest=0 and omittedNewEvents=0, despite sustained pressure-plate and glass/wood sound traffic. Raw setup/action-time observations may correctly show bounded-history gaps before projection; no such gap entered a model request. Closing this bounded event-pressure defect; multi-day pressure remains under the telos epic.

**2026-08-02T00:29:00Z**

Episode 000004 falsified the episode-000003 closure under combat pressure. Sedge model-facing sequence 189 had missingBeforeOldest=12 and omittedNewEvents=28; sequence 297 had missingBeforeOldest=33 and omittedNewEvents=26 while urgent decisions were slow. This is renewed interface uncertainty: determine whether decision-relevant combat facts were lost or whether the cursor accounting honestly compacted only redundant visibility churn. Do not classify model conduct until exact model-facing windows are audited.

**2026-08-02T00:58:35Z**

Episode 000005 exact-capture audit classified the renewed gap as an interface defect. At model boundaries, unread intervals reached 66 raw events; repeated sound, self-hurt/condition, and visibility pressure coexisted with death/spawn and human chat. Sedge model request sequence 165 explicitly lost 12 earlier events and deferred 25 later ones. A current-tree replay over recoverable raw intervals shows that typed contiguous pressure compaction can preserve all anchors in at most 10 visible items, with zero omission; the owning repair is in progress and raises the finite raw horizon from 40 to 200 so one ordinary 8-15s combat decision interval does not evict facts before projection.
