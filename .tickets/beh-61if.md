---
id: beh-61if
status: in_progress
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

**2026-08-01T14:12:04Z**

The current selected-tip manifest is now durably published (temp fsync, rename, directory fsync) and its post-rename failure boundary is exercised. This establishes the crash ordering the future cursor must preserve; it does not change the current whole-history working set.

**2026-08-01T14:57:01Z**

Bounded downstream reducer landed at 2303ea0. ProjectMemory no longer retains full EntityTurn history: it streams into compact per-active-project baselines and exact evidence witnesses, deleting state on complete/abandon. Focused 15/15 and candidate full check 657 pass with one opt-in skip. A generated 96 MiB irrelevant-private-history pressure case retained about 226 KiB versus about 101 MiB in the old reducer. This removes one downstream copy but does not close beh-61if: EntityLoom and policy/fold hydration still materialize or rescan the complete life until the Lync cursor integration lands.

**2026-08-01T15:26:09Z**

Cursor-backed Behold candidate is isolated at integration/beh-61if-cursor commits 621a9f8 and 2fab550. Existing selected lives now open through the vendored Lync file cursor without retaining decoded whole-history arrays; explicit readAll remains only for offline compatibility callers. The live console streams project/place reducers, seeds resident-v2 from an authenticated six-turn suffix plus v4 bounded canonical index, rebuilds a missing/stale fold once by streaming, and thereafter folds only the turn leaving the suffix. Canonical append returns the Lync chain digest before policy continuity advances. Focused entity/fold/isolation checks pass and full npm run check exits 0. This is not integrated or accepted: preserve the active pre-change six-hour epoch, then rebase and exercise the same world/lives through stop/resume, controller-memory growth, exact recent continuity, isolation, crash recovery, and Textile reading.

**2026-08-01T18:08:00Z**

The first ordinary post-integration resume failed safely before world release or any charged decision: resident prefix readiness tried to materialize the bounded conversation before authenticating its one-time canonical fold rebuild. Cleanup saved the stopped world and removed the server, controllers, lease holders, and LM Studio instance. The repair now prepares the bounded own-life context before constructing prefix readiness and includes the authenticated fold plus exact recent suffix in that setup conversation. A regression exercises an eight-turn retained life, proves one rebuild, contiguous coverage, and idempotent preparation; the full check passes 675/675 with one intentional skip. This remains implemented rather than live-accepted until the same world and lives resume through the ordinary front door.

**2026-08-01T19:42:00Z**

Ordinary episode 000004 exercised the repair on the same stopped world and exact selected lives. Ash resumed at turn 2,865 and committed contiguously through 2,910; Reed resumed at 1,130 and committed contiguously through 1,177. Their final authenticated folds covered 1–2,904 plus the six-turn suffix 2,905–2,910, and 1–1,171 plus 1,172–1,177 respectively; no visible bounded-memory gap was emitted. Prefix readiness and all 97 admitted model calls completed, both cursor-backed controllers closed, and exact source prefixes remained independently Textile-readable. This accepts migration and the 20-minute resume checkpoint, not the ticket's multi-hour memory-growth criterion.
