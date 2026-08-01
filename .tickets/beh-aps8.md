---
id: beh-aps8
status: open
deps: []
links: []
created: 2026-08-01T09:35:31Z
type: task
priority: 0
assignee: deepfates
parent: beh-06av
tags: [lifecycle, recovery, long-running]
---

# Keep ordinary habitat operation recoverable under lifecycle pressure

Make ordinary live operation remain truthful through the failures that appear in sustained habitation: death, obstruction, silence, disconnects, model or transport failure, quota exhaustion, operator stop, and recoverable process failure.

## Design

Classify and preserve failures rather than steering around resident choices. Exercise operational faults when useful, but do not prescribe resident conduct to manufacture acceptance. One owner must remain responsible for every process, lease, model session, world head, and admitted action terminal.

## Acceptance Criteria

In representative ordinary runs, every admitted action and model attempt settles exactly once or remains explicitly unsettled; resident death or obstruction cannot corrupt identity; quota or transport failure becomes visible rather than idle looping; stop drains cognition and saves Minecraft; resume reopens the exact stopped world and private lives; and a killed owner either recovers through the documented boundary or leaves an exact non-resumable diagnosis without leaked listeners, leases, sessions, or false success.

## Notes

**2026-08-01T11:06:19Z**

Lifecycle pressure result: episode 000006 visibly terminated at its declared 48-attempt resident quota and still drained/saved cleanly; that ceiling was incoherent with a requested 35-minute epoch. The supported --change-minds revision raised only both resident attempt quotas to 256. Episode 000007 then completed the full 35 minutes with 225 admitted attempts and exactly 225 terminals, two stop cancellations, zero provider failures, zero correction attempts, and zero unsettled charges; both controllers exited 0, one shared model unloaded once, Minecraft saved, and all listeners closed. This is positive duration/quota/ordinary-stop evidence, but the ticket remains open for death, transport/process failure, and documented recovery pressure.

**2026-08-01T11:10:31Z**

Reconciled later retained recovery evidence already described by the canonical README. Episode 000042 reached a resident-quota lifecycle mismatch only after Minecraft's save acknowledgement and left owner epoch 36 recovery-required rather than claiming a clean episode. Ordinary `behold live --recover` produced authenticated prepared/completed evidence classifying `abandoned_after_save_ack`, released the exact dead local owner with no leaked controller lease, and did not start a world or model. Episode 000043 then reopened Iris and Moss in the same saved locations and inventories with separate 1,282/1,315-turn lives, settled 76 provider decisions with zero unsettled charges, saved, and stopped cleanly. Episodes 000044-000045 subsequently exercised obstruction/failure continuity without hidden correction: Iris retained 36 failures, Moss resumed at its changed depth, all admitted calls settled, and the world returned to a clean completed head. This crosses the documented process-owner recovery boundary and ordinary obstruction continuity. Keep the ticket open for representative death and transport/disconnect pressure and for recurrence under genuinely long habitation; do not rerun recovery merely because the earlier note was stale.

**2026-08-01T11:50:41Z**

Episode 000001 (2026-08-01T11:16:45Z–11:47:14Z) exposed a duration/quota composition defect under ordinary conduct. Ash and Reed initially yielded in a quiet interior, then independently entered a public conversation and began moving toward an exit. Event-driven cognition rose to about 9 calls/minute per resident, projecting the fixed 2,048-call local quota to expire roughly two hours before the declared six-hour boundary despite healthy parallel inference. The operator stopped through Ctrl-C rather than preserve a mechanically doomed epoch. Both controllers drained with one visible stop cancellation each, all started actions reached terminals, both quota ledgers had zero unsettled calls, Minecraft acknowledged Saved the game, the head is completed_run, listeners and the one shared Qwen instance closed, and Textile read the 8.6 MB union as 194 readable turns plus two structural roots with zero unsupported/nonconforming/warning results. The local-only resident quotas were then revised to 16,384 each; no charter, cadence, body, identity, model, prompt, or conduct changed.

**2026-08-01T14:09:20Z**

2026-08-01 owning lifecycle defect fixed on current main: EntityLoom.close previously released the durable runtime lease without closing its underlying Lync Loom, so a stale closed object could still append after another incarnation acquired the same identity. Close is now exact-idempotent, closes Lync before releasing the lease, makes turns/tail/append fail after close, and also closes an opened Lync handle on failed admission/open. Focused 18/18 and full check 654 pass with one existing skip.

**2026-08-01T14:12:04Z**

Manifest durability follow-up: the selected resident tip manifest now writes an exclusive temp file, fsyncs it, renames atomically, and fsyncs the containing directory. An injected post-rename directory-fsync failure leaves the canonical empty life and renamed manifest recoverable, removes the runtime lease, leaks no temp, and reopens exactly. Focused 19/19 and full check 655 pass with one existing skip.
