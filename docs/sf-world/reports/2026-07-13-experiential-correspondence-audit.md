# San Francisco experiential correspondence audit

Date: 2026-07-13  
Accepted source run: `sf-full-v3-snapshot-20260713T095831Z`  
Immutable source-world tree SHA-256: `4fd327ebe85e90931e3fee4cd01c50490fd3ae4638f98ac53d1e6045d29554d1`

## Decision

Treat the Arnis world as a geographically grounded compilation, not as a finished authored city. Preserve it as the canonical block source. Put navigation reconciliation, presentation repairs, ecology, and cinematography into separately versioned overlays.

The generated cross-city road network is substantially usable. The main failure is not missing geography; it is local disagreement between the intended route and the generated surface, vegetation, props, or building geometry. Golden Gate Park contains the largest concentration of point obstructions. The urban route contains fewer point failures but more continuous camera-volume conflicts because a straight interpolation can cut corners through detailed geometry.

The production rule is:

1. Follow the geographically correct generated road when it is clear.
2. Move laterally within the generated road width when the centerline is obstructed.
3. Bend the continuous spline around isolated swept-volume collisions.
4. Use an intentional cinematic transition when the generated topology is the more truthful image.
5. Apply a small, reversible stage overlay only when no authentic generated path exists.
6. Never modify the immutable source world for presentation.

## Three truth layers

| Layer                 | Authority                                       | What it answers                                                             |
| --------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| Geographic truth      | Frozen OSM route, world metadata, source inputs | Where should a real street, path, or landmark be?                           |
| Generated-world truth | The accepted Minecraft block tree               | What did Arnis actually build, and what can a Minecraft body occupy?        |
| Experiential truth    | Directed routes and reversible overlays         | What reads cleanly to a person, camera, or agent moving through the result? |

None of these layers should silently overwrite another. A disagreement is evidence to record and reconcile.

## Route and method

The audited route runs 15,979 meters from the Dutch Windmill through JFK Drive, the Panhandle, the Wiggle, Market Street, and the Ferry Building. BRouter 1.7.9 generated 833 source points with the `trekking` profile. The preserved route artifact SHA-256 is `8b6182129ad0710e1674438afdfb7032a3e11ba2db1286e8aceeb9ad3ccf582a`.

The offline audit reads the disposable stage's Anvil region files directly. It maps route coordinates into the accepted world's local projection, recognizes Arnis road and path palettes, records the highest generated geometry above each route column, searches six blocks laterally for a clear generated surface, and then samples the continuous path every 0.75 block. The continuous test distinguishes two-block actor collision from rider-eye camera collision using Minecraft 1.21.4 block collision metadata.

This is a route audit, not a citywide quality percentage. It is deliberately biased toward the requested west-to-east demonstration corridor.

## Point correspondence

All 770 unique route columns contained a generated road or path block somewhere in the column.

| Result                                       | Samples | Share |
| -------------------------------------------- | ------: | ----: |
| Exact clear generated surface                |     495 | 64.3% |
| Clear generated surface within six blocks    |     228 | 29.6% |
| No clear generated surface within six blocks |      47 |  6.1% |

The 47 unresolved samples are presentation-patch or transition candidates, not evidence that 6.1% of the city is missing. Forty are in Golden Gate Park, four in the Panhandle, none in the Wiggle, and three from Market to the Ferry Building. One Golden Gate Park cluster contains 26 consecutive samples; most other unresolved points are isolated or very small clusters.

## Continuous occupancy

The swept pass tested 20,547 sub-block positions on segments whose endpoints had already resolved to generated surfaces.

| Continuous condition                               | Points | Share |
| -------------------------------------------------- | -----: | ----: |
| Two-block actor collision                          |    817 | 3.98% |
| Rider-eye camera collision                         |    276 | 1.34% |
| No recognized supporting path near expected height |     23 | 0.11% |

These conditions overlap. Actor collision is intentionally stricter than camera collision and is provisional where Arnis uses generic stone-like blocks for both paths and structures. The camera result is the operative film-safety measure. Full inhabitant navigation will require collision-shape-aware graph construction rather than treating the geographic polyline as a walkable path.

| Phase            | Point samples | Exact | Lateral | Patch/transition | Swept camera collisions |
| ---------------- | ------------: | ----: | ------: | ---------------: | ----------------------: |
| Golden Gate Park |           315 |   170 |     105 |               40 |                      36 |
| Panhandle        |            92 |    67 |      21 |                4 |                      18 |
| Wiggle           |           123 |    96 |      27 |                0 |                      97 |
| Market to Ferry  |           240 |   162 |      75 |                3 |                     125 |

The urban camera counts are a warning about straight-line interpolation through corners and facade detail, not a recommendation to clear 240 blocks. The correct response is topology-aware routing and shot design.

## Directed prototype result

A 41.55-second, 133-sample JFK Drive prototype was rehearsed in the Distant Horizons stage at rider height. The first point-only version contained three hidden log collisions. The swept pass identified all three. A regenerated spline added three one-block lateral detour controls and passed both collision clusters cleanly in the live client without modifying blocks.

Prototype manifest SHA-256: `0813145d8fc4e6d934ea1efae0aa3bc6f914b01656c1f74f7365dfdd5d9c2f06`  
Full audit artifact SHA-256: `427bb048313a86203f0798d96d22da00a1f1f77bfe374df2d2326eb131ae000e`

The prototype is accepted as proof of method, not as the final cross-city film.

## First hero-view scout

The first live client scout established a provisional visual hierarchy:

1. Sutro-to-downtown is the best whole-city establishing view because neighborhoods, canopy, skyline, and bay read together.
2. The high downtown/Salesforce-area view is the strongest density and scale reveal.
3. The audited JFK route is the human-scale inhabitation anchor.
4. The Golden Gate crossing is a useful geographic signature but should remain secondary because its procedural geometry does not reproduce the iconic suspension bridge.

Exact scout coordinates and shot roles are recorded in `presentation/hero-scouts.json`. The sequence remains provisional until movement rehearsals prove transitions and rendering stability.

## No-edit canopy transition

The largest unresolved Golden Gate Park cluster, route indices 142 through 167, was tested first as a presentation problem rather than a block-edit request. A deterministic 10.1-second shot rises from the verified clear route-index-140 column, remains at least 42 blocks above the highest audited cluster geometry, crosses the canopy, and descends onto the verified clear route-index-169 column.

The live rehearsal and a clean 2560 x 1440, 60 fps recording passed. No source or stage block changed. The accepted local recording, transition manifest, clearance facts, and checksums are recorded in `presentation/golden-gate-park-canopy-transition.json`.

The first display recorder captured Codex, legacy window capture produced a black GPU surface, and a display-independent ScreenCaptureKit filter captured Minecraft correctly while it remained on another macOS Space. The reusable recorder is tracked at `scripts/sf-world/capture-window.swift`. Failed and raw takes remain ignored local artifacts and are not acceptance evidence.

## World-direction standard

The world should ultimately be judged on five independent axes:

- **Correspondence:** important geography is recognizable and coordinate-correct.
- **Occupancy:** people and agents can stand, walk, enter, cross, and recover without privileged camera behavior.
- **Legibility:** streets, districts, landmarks, entrances, and transitions read at human speed and at city scale.
- **Ecological affordance:** terrain can host deterministic populations and resources without cinematic overlays becoming simulation state.
- **Presentation:** chosen views communicate the scale and character of the world without hiding material defects.

The implementation should expose one reconciliation record per route edge or world cell: source identity, generated coordinates, support height, confidence, collision result, defect class, applied overlay, and verification evidence. Cinematic splines, human navigation, agent navigation, and ecology may consume that record with different tolerances while sharing the same coordinate authority.

## Next production pass

1. Complete the swept audit for the full cross-city camera spline and cluster defects by topology rather than raw sample count.
2. Scout hero views and intentional transitions independently of the bike route.
3. Replace long straight interpolation with a surface-following directed graph in dense urban sections.
4. Use the large Golden Gate Park obstruction cluster as a designed vertical reveal unless a better authentic surface corridor is found.
5. Record every block-changing presentation operation as an idempotent, reversible overlay manifest against a disposable clone.
6. Build a separate collision-valid navigation graph before using the route for embodied agents or deterministic ecology.
