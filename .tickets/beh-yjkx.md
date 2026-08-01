---
id: beh-yjkx
status: closed
deps: []
links: []
created: 2026-08-01T09:35:30Z
type: task
priority: 0
assignee: deepfates
parent: beh-06av
tags: [architecture, authority, simplicity]
---

# Make habitat authority and mutable state legible

State and enforce the smallest authority algebra for one resident cycle and one habitat lifecycle. Find duplicated writable representations or orchestration state that can disagree, then remove or bind only defects that matter to ordinary use.

## Design

Start from World to View to Choice to Attempt to Consequence to Lync to next View. Minecraft owns world truth and consequences; the body owns raw experience and controls; the controller owns one current decision; Lync owns canonical life history; episode records bind lifecycle facts; Textile and operator views project rather than rewrite. This is not a general architecture rewrite.

## Acceptance Criteria

Canonical documentation and the supported code path agree on the owner of every causal transition and durable record. An adversarial trace of ordinary live, stop, and resume finds no independently mutable duplicate capable of changing admitted perception, action, consequence, identity, or lifecycle truth. Any duplicate found is removed, derived, or explicitly bounded by one owner, and the resulting path is exercised live.

## Notes

**2026-08-01T11:10:31Z**

Traced the supported current path from `behold live` through Place authority, managed world control, resident body/controller composition, decision admission, authenticated engine terminal, Lync append, stopped-world head, episode record, lens, and Textile. The compact algebra is now canonical in the README. Adversarial tests already fail closed on replaced world owners, edited or reordered lifecycle journals, out-of-band runtime mutation, changed immutable genesis, discontinuous resident-mind revisions, malformed or replayed lens envelopes, and tampered Lync turn bindings. Current-profile episodes 000044-000045 exercised the repaired perception-to-Lync path; episodes 000007-000008 exercised the new operator projection and controls live.

No independently mutable duplicate was found in the admitted causal path. Session genesis plus chained mind revisions bind configuration; the stopped-world head binds lifecycle and Minecraft digest; exact body and engine terminals feed the private Lync append. Project/place state and bounded indexes rebuild from that life. Run journals and the habitat lens are disposable projections; episode records and frozen Lync/Textile files are authenticated bindings or byte-identical copies. A run-journal write after a canonical Lync append can make observability incomplete, but it requests fatal controller shutdown before another decision and cannot alter resumed life; this is explicit failure rather than a competing truth. Acceptance met without an architecture rewrite.
