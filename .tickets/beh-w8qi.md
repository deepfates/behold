---
id: beh-w8qi
status: in_progress
deps: [beh-uij3, beh-10lb]
links: []
created: 2026-07-13T23:49:26Z
type: feature
priority: 1
assignee: place-compiler
parent: beh-wzs5
tags: [experience, geography]
---

# Generalize geographic route, sightline, atlas, and presentation inspection

Turn the strongest SF route/camera/BlueMap/Distant Horizons experiments into cross-place production capabilities: topology-aware routes, collision-valid ground movement, landmark sightlines, safe arrivals, atlas metadata, and cinematic reveals.

## Acceptance Criteria

Tracked reusable code replaces fixed SF/run/user/frame assumptions; at least one real ground route and one measured sightline/reveal run on every accepted place; evidence distinguishes visual LOD from simulated regions; historical prototypes remain verifiable but are quarantined from active policy.

## Notes

**2026-07-13T23:50:57Z**

Audit evidence: BlueMap/capture/DH/route prototypes are strong SF proof-of-method but contain fixed landmarks, Civic Center, SF labels/bounds, accepted run IDs, usernames, coordinates/frames, and manual stages. Inspector transects are not routes. Generalize metadata and tracked route/sightline code; distinguish LOD reach from active simulation.

**2026-07-14T00:23:36Z**

Started from the strongest ignored SF proof rather than treating diagnostic transects as routes. Added tracked place-independent route specs/fetcher, frozen BRouter geometries, direct prismarine-nbt dependency, reusable Anvil reader, route policy, pure projection/reconciliation core, and non-mutating ground-route auditor. Real baseline results: SF Windmill-Ferry 568 samples/93.7% point resolution/97.6% swept traversability; Manhattan Battery-Bridge 133/99.2%/95.3%. Bridge diagnostics: Golden Gate 67.8% swept traversability despite sparse-point resolution; Manhattan checkpoint is isolated from routable approach and underwater, crossing diagnostic 71.4%. Next: tighten evidence semantics, add sightline/reveal, and rerun route reports.

**2026-07-14T00:28:54Z**

Added generic immutable-world sightline/reveal inspection with versioned cross-place view specs, bounded local-peak endpoint selection, voxel transparency/occlusion evidence, and vertical lift series explicitly separated from render LOD and simulation. Real results: Sutro has a clear 7,572-block physical line to Golden Gate from base peak; Ferry/downtown are occluded by generated skyline even at +256, while Salesforce->Sutro clears at +128. One World Trade->Battery clears from base; OWT->City Hall clears at +256. These are director-useful physical facts, not client rendering claims.
