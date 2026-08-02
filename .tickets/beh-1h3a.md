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
