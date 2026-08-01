---
id: beh-1h3a
status: in_progress
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
