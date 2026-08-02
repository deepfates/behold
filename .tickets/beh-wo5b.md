---
id: beh-wo5b
status: open
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
