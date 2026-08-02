---
id: beh-1h3a
status: open
deps: []
links: [beh-uumj, beh-wssv, beh-kgyy]
created: 2026-08-01T23:24:51Z
type: bug
priority: 0
assignee: deepfates
parent: beh-06av
tags: [harness, action-contract, perception, living-world]
---

# Make the resident action/perception contract literally true

Retained ordinary habitat histories exposed model-facing affordances and settlements that did not exactly match Minecraft execution: a focused dig could secretly navigate, consume could advertise logs, exact inventory choices could fuzzily select another item, chat dispatch could be recorded as completed delivery, inventory types could disappear silently, and fractional counts could be silently floored. Repair the concrete seams without adding behavior policy or a parallel evidence system.

## Design

At the boundary, preserve three distinctions: offered intent, dispatched input, and independently observed consequence. Cursor actions remain cursor-local and non-composite. Exact enums resolve exactly. Bounded projections disclose any omission. Runtime rejects schema-invalid direct calls before world intent.

## Acceptance Criteria

Focused adversarial tests prove: focused dig performs no navigation; only consumables are offered; exact inventory selections cannot alias overlapping names; chat/whisper report input dispatch rather than receipt; all ordinary distinct inventory types are visible/selectable or omissions are explicit; fractional item counts fail before world intent. Full Behold check passes. A same-life ordinary resume uses the repaired contract and yields canonical independent Lync histories readable through Textile.

## Notes

**2026-08-01T23:28:41Z**

Read-only audit of exact retained requests and code confirmed: focused dig could pathfind 1.8-5.7 blocks before digging; consume advertised oak/spruce logs; 45 chats and three whispers were settled as completed despite proving only local input dispatch; exact enum item names used fuzzy substring execution; inventory summary silently omitted distinct types after 16; fractional item counts were schema-valid then floored. These are interface defects, not resident conduct. Lower-priority crowded-entity omission remains unproven and is not expanded here.

**2026-08-01T23:53:58Z**

Same-life ordinary resume episode 000003 exercised the literal contract. Lark and Sedge each independently completed a focused oak-leaf dig with a Minecraft blockUpdate and navigation=null; later movement was explicit move_controls. Exact chat/whisper dispatch and recipient receipt remained distinct. Across 50 model turns there were zero missing/omitted event windows. Separate canonical Lync prefixes advanced to 5,264,387 and 4,869,543 bytes. Textile projected the exact 10,133,930-byte ordered set as 210 readable turns plus two roots with zero unsupported_* diagnostics after repairing one focused-use failure presenter gap. Focused adversarial coverage owns the unexercised inventory/count variants; full Behold check is 689 pass/1 intentional skip.

**2026-08-01T23:59:20Z**

Post-acceptance systematic cursor audit found a second literalness defect. In retained episode 000003, focused dig changed Lark yaw 1.5708→1.2017 and pitch 0→-0.1388, and changed Sedge pitch 0→-0.1492, because Mineflayer dig automatically looks at block center. The public cursor action did not disclose or request that orientation input. Mineflayer placement and activateBlock/openContainer/sleep paths contain the same automatic look. Reopened to make current-observation cursor actions preserve view orientation, with exact conformance tests; generic non-cursor actions retain their disclosed behavior.

**2026-08-02T00:18:00Z**

The owning repair now suppresses only Mineflayer's preparatory look for actions already bound to the exact admitted cursor block: dig, place, use/toggle, container access, and bed use. Explicit look actions and non-cursor coordinate actions retain their existing orientation semantics. The suppression is restored in `finally`, including after a rejected interaction. Focused conformance covers exact target/face use, unchanged yaw/pitch, zero hidden pathfinding, persistent toggle/placement consequences, and failure restoration. Full `npm run check`: 694 pass, 1 intentional skip. Keep open until an ordinary live cursor action proves no unexplained orientation change in the deployment-shaped path.

**2026-08-02T00:29:00Z**

Episode 000004 loaded commit 2b6751a but did not independently choose a cursor-local block interaction, so the hidden-camera repair remains mechanically proven and live-unexercised. The same run found separate private-whisper and illegal-projectile-attack defects now tracked in beh-tm0q and beh-bf41.

**2026-08-02T01:14:32Z**

Qualified episode 000006 exercised legal cursor-entity attack admission/revalidation but no resident independently chose a cursor-local block action, so the hidden-camera-preservation repair remains mechanically proven and deployment-shaped unexercised. Keep open without steering a resident to manufacture the action.

**2026-08-02T04:01:54Z**

2026-08-02 episode 000007 exercised the current ordinary camera/action path but neither resident independently selected a cursor-local block interaction. Movement, look, wait, and complete chat dispatch were observed; console proposal previews abbreviated long chat while Minecraft received the full sentence. Keep open specifically for an independently chosen cursor action proving no hidden orientation change; do not steer one into existence.

**2026-08-02T08:01:48Z**

Exact episode-000006 and current-code audit found a distinct literal bodily-feedback defect. `move_controls` reduced the whole bounded interval to endpoint distance >=0.1, so clean requested-axis progress, lateral displacement/knockback, sub-threshold motion, and moved-then-returned all collapsed into one `bodyMoved` bit. The current candidate records a coordinate-free `behold.body-transition.v1` from Mineflayer move samples: requested-axis/lateral/vertical displacement in the control-start egocentric frame, net/path/maximum-excursion distance, orientation deltas, and sample count, with cause explicitly unknown. The compatibility bit remains derived from net distance; factual continuity, facts-only folds, and post-motion settlement preserve the richer receipt without coordinates, collision inference, route help, or behavior policy. Focused tests include a 0.8-block traveled out-and-back interval whose endpoint remains unchanged; the full check passes. Keep open for an ordinary same-life exercise and the pre-existing independently chosen cursor-orientation edge.

**2026-08-02T08:18:52Z**

Same-life ordinary episode 000014 exercised all 13 independently selected
`move_controls` intervals with the coordinate-free body-transition receipt.
Lark's nine attempts reported eight moving intervals and one exact zero-motion
interval (29.525 blocks total sampled path); Sedge's four attempts all reported
zero motion while facing an interaction-distance wall. Every receipt satisfied
`bodyMoved === (netDistance >= 0.1)`, and the newly vendored canonical Lync
presenter rendered all 13 without inferring collision or route success. This
accepts the bodily-feedback sub-edge. The ticket stays open only for the
pre-existing independently chosen cursor-block orientation exercise; do not
manufacture that resident choice.

**2026-08-02T09:06:32Z**

2026-08-02 principal correction: the added requirement that a resident naturally choose a cursor-block action was not in this ticket acceptance and improperly made model conduct a product gate. The production interpreter path has exact adversarial coverage for no navigation, exact enum/count semantics, dispatch-vs-delivery, omissions, and orientation preservation; episode 000003 exercised same-life ordinary repaired cursor digging and independent Lync/Textile; episode 000014 exercised the current bodily-feedback contract and ordinary resume. This closes literal contract truth without prescribing or awaiting a resident choice. Future contrary live evidence may reopen the bug.

**2026-08-02T10:37:34Z**

Episode 000017 retained exact provider bodies and exercised the repaired no-wait schema through the ordinary qualified Oxford front door, but no resident returned null intention, so this ticket remains open. The run instead falsified the closure of literal action-contract truth. Exact Lark model turns at journal sequences 240 and 273 were offered and chose stop while observation reported pose.motion=still, no focus, empty inventory, and no owned resident action; the interpreter then treats stop as an unconditional successful control clear. Exact Sedge model turns at sequences 145 and 168 were offered and chose place_held_against_focus while heldItem=null and inventory empty; sequence 145 also reported focus proximity=nearby. These are not evidence of bad resident judgment alone: the supplied current-action catalog advertised bodily attempts whose observable prerequisites were absent. Current tests deliberately encode this for human-semantic focus controls. Reopened. Do not begin another long habitat epoch until the smallest truthful offer boundary is decided and exercised; preserve execution-time revalidation and do not add steering.
