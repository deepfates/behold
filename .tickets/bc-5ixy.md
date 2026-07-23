---
id: bc-5ixy
status: closed
deps: []
links: []
created: 2026-07-15T01:32:44Z
type: feature
priority: 1
assignee: deepfates
tags: [behold, minecraft, inhabitation, e2e]
---
# Prove a neutral Minecraft resident gains and keeps one item

Close the current inhabited-world proof with one ordinary Minecraft outcome chosen by a neutral model from the full player action surface. Preserve the exact Lync life, stop the world, restart the same saved body paused, and independently recompute the result.

## Acceptance Criteria

A clean-revision runner uses a bounded good model and no coached action; the body observes at least one-item inventory gain before stop; a fresh paused process observes the same gain; the exact life, cognition budget, world-history lineage, journals, and report all verify from disk; the full repository gate passes.


## Notes

**2026-07-15T01:32:51Z**

First real direct run at commit 5aa0ff3 failed honestly: GPT-5.4 mini chose the exact visible oak-log pickup, but the fresh interpreter observation lost the falling item before execution. Evidence: .behold-runtime/world-histories/evidence/first-life-inventory-direct-v1-proof/evidence/inventory-gain-result.json. Commit 6d9fc89 binds execution to the exact admitted observation, rejects changed target identity, and passes the full 454/454 gate. Next: rerun from a pristine sibling, then verify the paused restart report in a separate process.

**2026-07-15T01:38:53Z**

Accepted at commits 6d9fc89 and 767dbd3. Passing report: .behold-runtime/world-histories/evidence/first-life-inventory-bound-v2-proof/evidence/inventory-gain-result.json. Standalone npm run proof:minecraft-inventory-gain -- --verify <report> passed all 13 integrity assertions and all 11 outcome assertions. Neutral GPT-5.4 mini direct run used 3/6 calls: face visible oak log, exact confirmed dig, exact confirmed pickup; inventory changed 0 -> 1 and fresh paused epoch 2 observed the same saved body with oak_log x1. Lync life lync:019f636a-2f05-7485-b110-586b01085376 turns 1..3. Full repository gate: TypeScript, ESLint, 454/454 tests. Narrative: docs/reports/2026-07-14-neutral-inventory-gain.md.
