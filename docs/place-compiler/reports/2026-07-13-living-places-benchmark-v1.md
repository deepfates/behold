# Living Places Benchmark v1

Status: **qualified checkpoint**. San Francisco and Lower Manhattan are real, reproducible Minecraft 1.21.4 worlds with functioning native ecology and very large single-observer performance headroom. Neither is yet accepted as a uniformly legible, safe, street-traversable city.

## What v1 establishes

- Both accepted source artifacts remained immutable. Every benchmark worked in a disposable runtime clone and recorded the accepted world-tree digest.
- Eight geographic checkpoints and six direct diagnostic transects were observed through a real Minecraft protocol client with complete requested column coverage.
- Both living profiles advanced more than one full Minecraft day with daylight, weather, random ticks, and spawning native and enabled.
- All 12 performance cases completed cleanly: two cities, three named profiles, and two repetitions. The slowest case still achieved 390 accelerated TPS, 19.5 times the real-time floor.
- The benchmark found actionable defects instead of flattening the result into a vanity score: both bridge checkpoints resolve to water, Manhattan's default arrival produced a 17-death witch loop, both observed arrivals were hostile-mob dominated, and San Francisco's sparse checkpoint biomes look coarse.

The machine-readable decision record is `docs/place-compiler/benchmarks/living-places-v1-findings.json`.

## Evidence ledger

| Lane        | Canonical run              | Manifest SHA-256                                                   | Scope                                                                                       |
| ----------- | -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Inspection  | `inspection-two-place-v7`  | `6a1b8394ad3c2da66583c3298b115aa3a5264891dcdf1b957c36b95d6d103a3a` | Ground columns, aerial fields, direct transects, biome/habitat observations, annotated maps |
| Ecology     | `ecology-two-place-v2`     | `4e3be02e4286b9a1b9972bc84b69c5f2185ae8577b734cd54904c57fb00a1859` | One deterministic native day per place, entity turnover, observer lifecycle, clean shutdown |
| Performance | `performance-two-place-v1` | `c0edfa275ede60e184bbec998814d9b083b484c042cda6a11452f1e90a537c33` | 12 real-server cases, tick throughput, startup, process RSS/CPU samples, stability          |

Hardware: Apple M4 Max, 16 logical CPUs, 128 GiB memory, macOS 25.5.0, Node v25.8.0. The hardware fingerprint is evidence, not a portability promise.

## Telos vector

| Place           | Correspondence                                              | Legibility                                                             | Habitability                                         | Native ecology                                                               | Experience                                                                           | Capacity                                    |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- |
| San Francisco   | Qualified: three strong anchors; bridge checkpoint mismatch | Qualified: full map reads clearly; direct transects are not routes     | Defect: hostile-dominated arrival and no route proof | Qualified: real turnover, animals and hostiles; biome diversity needs census | Qualified: cinematic substrate works, but v1 lacks systematic in-client shot scoring | Accepted for named single-observer profiles |
| Lower Manhattan | Qualified: three strong anchors; bridge checkpoint mismatch | Qualified: recognizable generated map; direct transects are not routes | Defect: repeatable witch death loop at arrival       | Qualified: real turnover and survival consequences                           | Qualified: coherent map, but no systematic in-client shot score                      | Accepted for named single-observer profiles |

This vector is intentionally categorical. The evidence is not commensurate enough to justify a single scalar score.

## Performance frontier

| Place           | Profile   | Median accelerated TPS | Minimum TPS | Minimum real-time headroom | Maximum RSS |
| --------------- | --------- | ---------------------: | ----------: | -------------------------: | ----------: |
| San Francisco   | Cinematic |                  2,156 |       2,101 |                    105.05× |     5.60 GB |
| San Francisco   | Playable  |                  466.5 |         465 |                     23.25× |     3.77 GB |
| San Francisco   | Living    |                  463.5 |         449 |                     22.45× |     3.31 GB |
| Lower Manhattan | Cinematic |                1,940.5 |       1,890 |                      94.5× |     5.40 GB |
| Lower Manhattan | Playable  |                  394.5 |         390 |                      19.5× |     3.82 GB |
| Lower Manhattan | Living    |                    418 |         411 |                     20.55× |     3.27 GB |

No unstable named operating point was found. This makes v1 a strong lower bound, not the ultimate capacity boundary. A future concurrency benchmark must vary players or agents, active regions, pathfinding, entity counts, and any inference workload independently.

## Smart defaults

1. Keep three purpose-specific profiles. Cinematic settings should not silently become ecology settings, and living simulation should not require a renderer or a mind.
2. Keep Minecraft authoritative in the living profile: survival, normal difficulty, view and simulation distance 12, native daylight/weather/random ticks/spawning, and no custom ecology requirement.
3. Add a small acceptance preflight: complete local landmark columns plus one deterministic standable arrival and a bounded native-day soak.
4. Repair places locally before generalizing. Bridge observations require geometry-versus-coordinate diagnosis; Manhattan's arrival needs a bounded safety repair. Neither justifies a city-specific compiler fork.
5. Treat the current runtime numbers as one-observer evidence. Do not translate 20× tick headroom into an agent-count promise.

Each default, expected benefit, evidence reference, and validation method is recorded in the findings JSON.

## Reproduction

```sh
node scripts/place-compiler/benchmark.mjs
node scripts/place-compiler/inspect-places.mjs --run-id inspection-two-place-v7
node scripts/place-compiler/soak-ecology.mjs --run-id ecology-two-place-v2
node scripts/place-compiler/sweep-performance.mjs --run-id performance-two-place-v1
```

Run IDs are immutable; choose new IDs when reproducing rather than overwriting evidence. These commands materialize disposable copies and refuse locked or digest-mismatched accepted fixtures.

## Boundary with Behold

The reusable interface remains intentionally narrow: a place artifact plus runtime profile can become a world epoch. This benchmark does not import Behold characters, entity looms, minds, or lifecycle machinery, and Behold does not need to understand place-generation internals. Optional inhabitants can attach later through the same world contract.
