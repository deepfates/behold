---
id: beh-ehd7
status: open
deps: [beh-10lb]
links: []
created: 2026-07-13T23:49:26Z
type: feature
priority: 0
assignee: place-compiler
parent: beh-wzs5
tags: [behold, boundary, integration]
---

# Coordinate packaged-place to Behold-owned epoch junction

Specify and coordinate the Behold-side adapter that verifies a Place release, safely materializes a selected profile into Behold-owned baseline/runtime storage, derives Behold topology identity, and launches through unchanged world ownership.

## Acceptance Criteria

Place Compiler imports no Behold identity/lifecycle code; Behold binds release/archive/place-tree/profile/server/baseline digests into its epoch descriptor; real two-epoch packaged-place proof preserves world and inhabitant consequence; lifecycle and portable evidence verify independently.

## Notes

**2026-07-13T23:50:57Z**

Boundary audit: Behold canonical input is WorldLabDefinition source+preparedBaseline with behold-tree-v2; launch is startManagedWorld and world-control epoch ownership. Place package currently exposes archive/place digest and profile names only; Behold reads neither release nor runtime manifest. Minimum adapter belongs entirely in Behold: verify/extract Place release, verify per-file tree, materialize profile, derive Behold baseline digest, launch unchanged owner, bind both digest domains in epoch evidence.
