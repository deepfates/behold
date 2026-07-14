---
id: beh-ehd7
status: closed
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

**2026-07-14T03:48:00Z**

Implemented the Behold-side `place-epoch` admission adapter and exercised it against the real Venice v1 release. It independently closed the release checksums, recomputed the declared Place tree `5f8805…b56b`, materialized `living`, and derived Behold source `f2d996…95cb`, baseline `10ce53…4bee`, server, profile, and world-definition digests under world `venice-core-9a802c78123ffd46`. Focused tamper/drift refusal and lifecycle gates are green. The real two-epoch inhabitant continuity run remains before closure.

**2026-07-14T05:50:00Z**

Closed with real packaged Venice proof `venice-place-epoch-proof-v1`. Epoch one collected an apple through the production action/safety path and a fresh Minecraft witness confirmed the consequence; epoch two restored the inventory, prior loom turn, and changed position without repeating collection. Both chained owner journals save/stop/release cleanly. The eight-file portable closure independently verifies at package digest `fcb01a…ae1`, and the full boundary/result is recorded in `2026-07-14-place-to-behold-epoch.md`.
