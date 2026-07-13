---
id: beh-10lb
status: in_progress
deps: []
links: []
created: 2026-07-13T23:49:26Z
type: feature
priority: 0
assignee: place-compiler
parent: beh-wzs5
tags: [contract, evidence]
---

# Define dynamic Foundry v2 contract and evidence set

Version the benchmark/release contract beyond frozen two-city v1. Derive fixtures, profiles, repetitions, archive contents, and evidence references from manifests rather than hard-coded SF/Manhattan counts and run paths.

## Acceptance Criteria

V1 remains independently verifiable; v2 accepts 3+ fixtures; canonical run selection is explicit; findings/release/evidence references are schema-validated and resolvable; deterministic packaging derives cardinality from the contract.

## Notes

**2026-07-13T23:50:57Z**

Audit evidence: v1 package/verify and tests hard-code 2 fixtures, 12 cases, exact SF/LM paths and dated runs. Preserve frozen v1 verifier; v2 must derive cardinality/content from explicit evidence-set manifest. Place tree digest and Behold topology digest are intentionally distinct.
