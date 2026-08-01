---
id: beh-zl9o
status: closed
deps: []
links: []
created: 2026-08-01T07:50:55Z
type: feature
priority: 1
assignee: deepfates
parent: beh-gidu
tags: [live, world-history, place, branching]
---

# Seed a fresh live session from a verified stopped world-history child

Ordinary behold live can adopt an immutable Place release and Behold can verify isolated Minecraft history children, but live cannot name one verified child as a fresh session basis. Add one new-session-only seed that verifies the existing fork receipt and stopped Place source, stages the selected child into a fresh session-local restartable Place runtime, then hands the unchanged runtime to Place serve and the ordinary live adoption path. Do not copy resident lives or add experiment scheduling.

## Acceptance Criteria

Given an authenticated stopped Place-served source head and a verified behold.minecraft-world-history.v1 receipt, a fresh ordinary live session can select exactly one child history, fail closed on source/head/checkpoint/history/runtime/release/server/profile drift, atomically stage no partial runtime on failure, and then run through unchanged Place control and ordinary live adoption. The new session has isolated control, bodies, residents, Lync, and episodes; the source, checkpoint, sibling worlds, and source lives remain unchanged. Existing release-only new sessions and resume/recover behavior are unchanged, and focused tests protect the state and atomicity boundary.

## Notes

**2026-08-01T08:01:08Z**

Implemented the narrow fresh-session adapter and live flags. Full check passes: 643 tests, 642 pass, 1 intentional skip. Real stopped Oxford head b5875c3a... was forked through the actual live control root into four unused sibling histories; receipt data/model-perception-live-20260801/world-history-receipt.json SHA-256 e92d7260..., checkpoint/lineage/lifecycle all independently verify and every child remains at the common digest. No branch has been started yet, so ordinary Place/live exercise remains pending before closure.

**2026-08-01T08:06:44Z**

First real gemma-semantic crossing reached ordinary Place restart and cleanly failed before resident admission. LM Studio loaded the exact custom instance but forced Gemma MLX context_length=262144 despite the sealed 32768 request; Behold rejected the mismatch, saved/stopped the new live world, wrote head c7dc8317..., unloaded the model, and left no listener. This falsifies the no-world manifest's claimed Gemma runtime context. The branch remains a clean stopped session with zero resident decisions and will resume only via explicit mind-config revision to the actual 262144 context. Also found that copied history seeds needed a one-child/one-continuation claim; added exclusive authenticated claim publication and retroactively claimed this exact branch.

**2026-08-01T08:08:43Z**

Ordinary exercise completed after the explicit 262144-context mind revision: session mp-gemma-semantic-20260801 episode 000002 ran the claimed world-history continuation through unchanged Place/live, admitted fresh isolated life BranchGemmaSemantic, and Gemma independently chose look_direction same/level. Minecraft confirmed the orientation action; the next opportunity truthfully terminated quota_exhausted. Clean head b165792c..., episode digest 418cfe83..., Lync SHA 78218054...; Textile projected 2 events as 1 readable + 1 structural with zero unsupported/nonconforming/warnings. Receipt verification still reports source and all pristine fork children at checkpoint b5875c3a... because the exclusive claim makes the live runtime the one continuation rather than mutating the seed. No model or port listener remains.
