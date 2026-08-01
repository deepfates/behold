---
id: beh-hmt6
status: open
deps: [beh-61if]
links: []
created: 2026-08-01T14:16:44Z
type: task
priority: 1
assignee: deepfates
parent: beh-9b2h
tags: [lync, observability, storage, long-running]
---

# Stop live journals from copying canonical private resident turns

Ordinary resident journals currently append each complete private entity_turn after the same turn is committed to canonical Lync. In the active Oxford epoch at 2026-08-01T14:16Z, those journal lines occupied 95,447,832 bytes while the two canonical Lync files occupied 106,799,372 bytes. This parallel private copy exists largely for the lens and historical evaluation readers, conflicts with Lync authority, and compounds multi-day storage.

## Design

After the selected-life cursor exists, journal only the operational settlement plus an authenticated Lync turn locator and the smallest public operator projection needed for live following. Resolve private history from canonical Lync when explicitly authorized; do not turn the journal, checkpoint, Textile, or a summary into another life authority. Preserve backward reading of old full-turn journals. Migrate or retire evaluators that silently treat journal copies as canonical.

## Acceptance Criteria

In an ordinary multi-resident run, each committed private turn exists once in canonical Lync; the run journal carries no private observation payload, camera frame, model request, or reconstructed entity turn; the live lens still shows timely experience choice attempt consequence and Lync progress from authenticated sources; old journals remain inspectable; exact transport capture remains separately bounded and named; and measured journal growth is operational-event sized rather than proportional to private turn payload bytes.

## Notes

**2026-08-01T14:16:57Z**

Measured during ordinary episode 000002 at 2026-08-01T14:16:14Z: Ash journal entity_turn lines 71,601,208 bytes for 1,367 turns; Reed 23,846,624 bytes for 483 turns; canonical resident Lync files 77,935,366 and 28,864,006 bytes. Full run journals were larger still. No retention changed during the epoch.

**2026-08-01T14:28:01Z**

Read-only consumer audit (2026-08-01): ordinary product has one full private writer (console commits canonical Lync, then copies EntityTurn into journal) and one current product reader (resident lens). The lens uses only versioned public observationPresentation, choice, public consequence, identity/sequence/parent/timing, and Lync progress; no current product consumer needs raw private frames. Exact migration seam: lyn-hh9v should return an authenticated canonical append receipt (turn/loom identity, exact locator/hash/body digest, immutable-prefix binding); beh-61if returns that after canonical append and durable selected-tip publication; beh-hmt6 journals a new versioned bounded public commit plus the receipt; lens dual-reads legacy entity_turn and the new event. Private-semantic evaluators must explicitly resolve the canonical Lync turn/range. Preserve legacy fixtures/readers. Also strip optional private mindRequest/request.body/response.raw from operational model_turn journal projection; exact model transport already has its separately named capture. Do not invent a Behold locator schema before the Lync receipt stabilizes.

**2026-08-01T15:39:46Z**

Candidate integration/beh-hmt6-bounded-journal now appends behold.resident-life-commit.v1 only after canonical Lync append, carrying safe semantic before/after experience, public choice/consequence, and the authenticated EntityTurnCommitReceipt; operational model_turn omits optional mindRequest, request.body, response.raw, and assistant-private fields. The lens dual-reads this event and legacy entity_turn. Focused tests prove raw causal frames, injected camera/private-frame content, private assistant reasoning, model request/body/raw response, and a reconstructable EntityTurn are absent; full check passes 670 with 1 skip. Current ordinary product has no remaining private-turn reader. Residual legacy proof/evaluation consumers are scripts/mind-differential.ts, minecraft-inventory-gain-proof.ts, neutral-causal-turn-proof.ts, reassess-neutral-turn.ts, resident-recovery-evidence.ts, owned-world-portfolio-evidence.ts, src/evaluation/minecraft-inventory-gain.ts, and src/evaluation/causal-turn.ts. scripts/extract-mind-request.ts and owned-world-portfolio-evidence.ts additionally require exact model content removed from new operational journals. Retained legacy artifacts remain readable; new private-semantic evaluation should resolve explicit Lync life ranges and named cognition transport rather than restore journal authority. Ticket remains open pending principal integration and ordinary-run growth/lens measurement.
