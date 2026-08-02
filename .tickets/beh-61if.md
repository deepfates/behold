---
id: beh-61if
status: closed
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

# Stream canonical private life without retaining an unbounded decoded copy

Use Lync's selected-life cursor so a live controller need not retain a second decoded copy of an indefinitely growing canonical life. This storage constraint must not become a resident-memory policy: the model-facing session may replay the complete chronological transcript up to its verified inference context, and its bound is the explicit model context rather than an arbitrary recent-turn or selected-anchor limit.

## Design

Stream one selected thread through derived reducers and the versioned resident transcript projector. Make offline whole-life materialization explicit, while allowing one inference request to contain the complete transcript permitted by that model's declared context. Behold continues to own resident identity, lease, and selected tip; Lync owns canonical append and cursor truth. Close the Lync cursor before releasing the resident lease. Do not use process recycling, Behold-only array trimming, inaccessible folds, checkpoints, or Textile as substitute memory.

## Acceptance Criteria

Opening and continuing retained and generated large private lives does not retain a second payload-sized decoded copy merely because canonical Lync grows; the inference transcript remains chronological and complete up to its explicit verified context boundary without foreign resident content; no storage optimization introduces a fold, selected-anchor replacement, or inaccessible middle gap; exact ranges, migration, stop/resume, and unique-child crash recovery remain correct; close releases files, database handles, listeners, and leases; and an ordinary resumed world shows controller memory bounded by active inference/runtime needs rather than cumulative Lync bytes while decision latency and canonical Textile readability remain usable.

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

**2026-08-02T02:02:47Z**

Owner correction 2026-08-01: bounded controller storage is not authorization to curate the resident's subjective history. The retained V4 request explicitly omitted turns 39-41 while pointing at inaccessible canonical Lync. Ticket title/design/acceptance now separate streaming storage from the new full-transcript inference policy; prior implementation evidence remains valid only for storage and cursor mechanics.

**2026-08-02T06:34:29Z**

2026-08-02 large-life acceptance: current main 096881a reopened the exact retained Ash (148,587,175-byte canonical prefix; 2,910 turns) and Reed (55,527,965 bytes; 1,177 turns) lives without a world. Cursor-only open took 25-32 ms; with both open, forced-GC heap rose about 1.0 MiB before bounded reads rather than by 204 MiB. Exact turn 1 and newest suffix reads succeeded; close removed both leases; source hashes were unchanged. Deployment-shaped streaming hydration of project/place reducers took 7.62 s for Ash and 2.84 s for Reed; retained heap after GC was about 5.6 MiB in each process. Ordinary exploratory legacy-habitat episode 000005 then resumed the same stopped world and lives through the supported live front door. Despite the roughly 3x source-size difference, vmmap measured settled controller footprints of about 281/272 MiB and peaks of 524/593 MiB (the smaller Reed life peaked higher), contradicting a payload-sized retained copy. Each resident settled 9/9 model turns with zero model-call failures at 6.37-7.72 s, then world save, controller/viewer shutdown, leases, listeners, and the shared 19.03-GiB Qwen instance all closed cleanly. Current Textile main authenticated the exact 204,563,126-byte episode prefix as 4,105 readable turns plus 2 roots, zero unsupported/nonconforming/warnings, retaining no raw bytes or private payload objects. Episode 000005 remains explicitly exploratory because its Place entrance predates habitat qualification; that does not weaken this storage/controller acceptance. The separate parent still owns journal/checkpoint growth, qualified-context semantics, and multi-day pressure.
