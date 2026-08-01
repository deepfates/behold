---
id: beh-61if
status: open
deps: []
links: []
created: 2026-08-01T13:55:23Z
type: task
priority: 0
assignee: deepfates
external-ref: lyn-hh9v
parent: beh-9b2h
tags: [memory, lync, long-running, resident-life]
---

# Keep each live resident on a bounded selected-life working set

After Lync provides bounded selected-Loom access, replace Behold live hydration of the complete decoded resident thread with a selected-life wrapper that keeps only the explicit tip, bounded recent turns, and streaming derived state. Preserve the exact private life, migration, range, recovery, and isolation contract. This ticket owns the resident-facing result rather than Lync storage internals.

## Design

Stream one selected thread through fold, project, place, trajectory, statistics, and bounded-tail reducers. Make whole-thread materialization explicit and non-live. Behold continues to own resident identity, lease, and selected tip; Lync owns canonical append and cursor truth. Close the Lync cursor before releasing the resident lease. Do not use process recycling, Behold-only array trimming, checkpoints, or Textile as substitute memory.

## Acceptance Criteria

Opening and continuing retained and generated large private lives does not retain payload-sized whole-history copies in a live controller; resident requests preserve the same bounded truthful information and provenance; recent lived events arrive contiguously without foreign resident context; exact ranges migration stop/resume and unique-child crash recovery remain correct; close releases files database handles listeners and leases; and an ordinary resumed multi-hour world shows controller memory bounded against growing Lync bytes while decision latency and canonical Textile readability remain usable.

## Notes

**2026-08-01T13:55:40Z**

Grounded 2026-08-01 audit: current live path retains whole history in Lync file store, Lync fold, Behold EntityLoom, and downstream policy/project views. The owning upstream ticket is lyn-hh9v. Unknowns to falsify before schema commitment: Node 22.12 SQLite support, restart verification cost at multi-day size, and a shared union-storage adapter that preserves current semantics.

**2026-08-01T14:09:20Z**

Closed-handle prerequisite landed with explicit ownership ordering: the current eager EntityLoom now closes its Lync handle before releasing the resident lease and refuses all post-close reads/appends. This removes a real stale-writer/leak edge but does not claim bounded memory; lyn-hh9v and this ticket remain open.
