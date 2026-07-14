---
id: beh-yxrh
status: closed
deps: [beh-uij3, beh-10lb, beh-w8qi, beh-xqf5, beh-905z, beh-a9bn, beh-szzg, beh-ehd7]
links: []
created: 2026-07-13T23:49:26Z
type: task
priority: 0
assignee: place-compiler
parent: beh-wzs5
tags: [release, autophagy, verification]
---

# Adversarially simplify and release Living City Foundry v2

Continuously audit active paths, retire/version superseded SF v1 and research machinery after feature migration, remove duplicate swarm/manual launch/shim paths when replaced, adversarially test claims, and package the complete v2 result.

## Acceptance Criteria

Canonical ownership per responsibility; exceptions for surviving compatibility/fakes are explicit and tested; stale personal paths and silent fallbacks are absent from production; all stories package evidence; byte-reproducible independently verified release; full gates; clean worktrees; all v2 tickets closed.

## Notes

**2026-07-13T23:50:57Z**

Autophagy rule from audit: preserve legitimate ownership/recovery fixtures and immutable-log compatibility tests; do not purge mocks theatrically. Version/freeze v1 reproduction assets before retiring fixed SF scripts. Migrate atlas roles/strong verifier behavior first. Replace legacy swarm/manual paths only after production successors pass.

**2026-07-14T12:12:00Z**

Closed with a manifest-derived normalized packager and independent streaming verifier. The canonical three-place release binds commit `81895e251548ac572c6959cc8567cd7a54c28cae`, has 198 hashed entries, and rebuilt byte-identically at 77,157,688 bytes (SHA-256 `b90b9aadaa43a9edf9adb3afb32a82a301138c2f3b2097da6ed5d0ac0d7c5ff1`). All 228 tests pass. Active Place paths are generic; fixed SF scripts remain quarantined historical reproducers.
