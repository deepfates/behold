---
id: beh-wo5b
status: closed
deps: []
links: []
created: 2026-08-02T09:47:41Z
type: bug
priority: 0
assignee: deepfates
parent: beh-06av
tags: [continuity, lync, harness]
---

# Preserve null intention in the resident's canonical private chronology

The minimal resident-v3/v4 contract now permits a model to form no bodily intention without inventing a Minecraft action. The exact null response remains in the live provider conversation, but no EntityTurn is committed, so stop/resume reconstructs a chronology that silently omits that cognition. This contradicts the intended uninterrupted private conversation even though it correctly avoids a fake wait action.

## Design

Represent an admitted cognition with no bodily or private-life action as a first-class canonical private-life event, not an action, consequence, scheduler command, or operational-only journal record. Preserve the exact admitted experience binding and exact assistant response; keep Minecraft action and consequence fields absent rather than filling them with sentinel values. Extend Lync/Behold/Textile projection only as required to read the event honestly, while preserving existing action-turn histories unchanged.

## Acceptance Criteria

After a resident returns {"action":null,"arguments":{}}, the same live session can later receive new experience without wire rejection, and a clean stop/resume reconstructs the exact experience/null-response/later-experience chronology from that resident's canonical Lync life. No Minecraft intent, action terminal, synthetic consequence, wait action, or cross-resident content is created. Existing action turns remain byte-compatible and Textile reads both event kinds honestly. Focused tests cover consecutive null intentions, later material wakeup, stop/resume, context-epoch rollover, and isolation.

## 2026-08-02 implementation checkpoint

Implemented locally in Behold: action turns keep their existing wire shape;
`behold.entity-cognition-turn.v1` shares the canonical sequence/parent chain and
stores the admitted experience plus exact null response with action, outcome,
and terminal observation absent. The chronological policy commits consecutive
null choices, exact transcript projection emits no fabricated Minecraft return,
private-life paging accepts both kinds, and the ordinary console writes a
distinct bounded `resident_cognition_commit` operational projection. An actual
Lync close/reopen test preserves action → cognition → action, and safe semantic
observation binding restores its private frame without exposing it publicly.
Complete life ranges retain both kinds while action-specific evaluators select
action turns explicitly; context-epoch projection also preserves cognition
without an invented return. The full Behold check passes (735 passed, one
skipped).

Lync `860aa54` presents the event as perception plus “chose no bodily action”
and rejects invented consequence fields; its full verification passes. Textile
vendored that exact packed candidate and committed raw-reader coverage at
`173cdbc`; its full verification passes. Still unexercised: one ordinary short live
null/wake/stop/resume using the composed front door, its first resumed model
request, and visible Textile reading from the resulting real source. Keep this
ticket open until those facts are observed; do not replace them with a long
soak.

## Notes

**2026-08-02T10:37:34Z**

Ordinary qualified Oxford episode 000017 used the nullable resident-v4 schema, retained exact model bodies, and stopped cleanly, but neither resident chose null intention. Therefore no live cognition event or restart chronology was produced and this ticket remains open. The exercise found a more immediate false-affordance defect tracked by reopened beh-1h3a; repair that before another live attempt rather than trying to induce null conduct.

**2026-08-02T11:00:44Z**

2026-08-02 episode 000018 produced the first ordinary resident-v4 null cognition. Sedge’s exact {"action":null,"arguments":{}} committed as canonical cognition turn 400 with no action or consequence, and later Lark chat arrived. Every subsequent camera-bound wake then failed before provider admission with “Continuous resident no-intention response must be followed by later lived experience”; Sedge stalled while Lark continued. Root cause: the strict wire validator decoded the current multimodal text+image message for the top-level current-observation check but coerced the same message to [object Object],[object Object] when checking the preceding null. The current candidate uses the already-decoded text for that chronological edge. A camera-shaped live-policy regression reproduces the exact failure before the fix and passes after it; full npm run check passes. Still required: ordinary same-life resume from canonical turn 400, sustained later requests, clean stop, and visible Textile reading.

**2026-08-02T11:07:59Z**

2026-08-02 ordinary qualified Oxford episode 000019 resumed the same world and Sedge life from canonical cognition turn 400 on clean commit 77a6280. Sedge’s first exact request reconstructed active turns 395–400, with the null assistant response at message 18 and a fresh camera-bound “What you experience” at message 19; it reached LM Studio and succeeded. Sedge then committed turns 401–418 across look, movement, chat, and exact private-life reads, while Lark continued independently. No model_call_failed or controller_error events occurred. Both provider accounts settled completely (24/24 and 23/23, zero unsettled), the world saved with terminal digest 7e4a0afa..., listeners closed, and the shared model unloaded. Textile’s actual ordered-prefix importer opened episode 000019 read-only as 869 readable turns plus two roots and rendered cognition 400 as perception plus “OxfordSedge chose no bodily action.” It also surfaced two unrelated historical unsupported placement-input diagnostics at Sedge turns 382/384, now tracked honestly in Lync lyn-gisl. The null/wake/stop/resume acceptance is crossed.
