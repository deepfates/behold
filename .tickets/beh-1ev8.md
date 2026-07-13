---
id: beh-1ev8
status: closed
deps: [beh-nfec]
links: []
created: 2026-07-13T22:02:30Z
type: task
priority: 1
assignee: place-compiler
parent: beh-wx6g
---

# Package and verify Living Places Benchmark v1

Assemble schemas, commands, results, visuals, defects, and provenance into a checksummed benchmark release. Run the complete repository gate and document reproduction.

## Acceptance

The release verifies from packaged evidence, both places are represented, commands are documented, commits are clean, the full test gate passes, and the Behold boundary note confirms artifact-to-world-epoch only.

## Notes

**2026-07-13T23:00:55Z**

Starting checksummed evidence release, independent verification, full repository gate, clean-commit audit, and artifact-to-world-epoch boundary handoff.

**2026-07-13T23:29:02Z**

Canonical corrected release: .behold-artifacts/place-benchmarks/living-places-v1/releases/living-places-v1-20260713-r2, bound to git b82097b. Independent verifier passed 4 roles/86 entries, both fixture identities, both inspection/ecology reports, 12 performance cases, visuals, commands, safe paths, no runtime/session.lock leakage, and checksum closure. A second release ID produced byte-identical hashes for all four archives after directory-time normalization. npm run check passed lint/typecheck/build and 203/203 tests. Behold thread 019f5921-8563-7551-88a5-4551622a7937 received the no-action boundary update: artifact + profile -> Behold-owned world epoch; identities/minds/looms/lifecycles remain optional consumers.
