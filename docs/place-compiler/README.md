# Behold Place Compiler

The Place Compiler turns a small, reviewable geographic recipe into a recorded Minecraft world run. San Francisco is the regression recipe; Lower Manhattan is the first independent generation proof. The compiler owns geographic inputs, generation, validation, packaging, and presentation artifacts. It does not depend on Behold's body, controller, loom, or world-epoch implementation.

## Generate

Preview either command without writing an artifact:

```bash
node scripts/place-compiler/generate.mjs --place docs/place-compiler/places/san-francisco.json --dry-run
node scripts/place-compiler/generate.mjs --place docs/place-compiler/places/lower-manhattan.json --dry-run
```

Accepted builds should use a frozen OSM JSON input:

```bash
node scripts/place-compiler/generate.mjs \
  --place docs/place-compiler/places/lower-manhattan.json \
  --osm-json /path/to/lower-manhattan-overpass.json
```

Each run is isolated below `.behold-artifacts/places/PLACE/runs/RUN_ID`. Its manifest records the recipe, recipe digest, tool lock, tool digest, generator digest, exact command, resource policy, runtime profiles, input digest, and isolated generator home.

## Validate

Create a timestamp-independent world-tree identity, then verify the complete provenance and geographic chain:

```bash
node scripts/sf-world/tree-hash.mjs \
  '.behold-artifacts/places/PLACE/runs/RUN_ID/output/Arnis World 1' \
  .behold-artifacts/places/PLACE/runs/RUN_ID/evidence/world-checksums.json
node scripts/place-compiler/validate-run.mjs \
  .behold-artifacts/places/PLACE/runs/RUN_ID
```

Validation fails closed if the recipe, tool lock, generator, captured OSM, world tree, structure, bounds, projection, or landmark mapping no longer agrees with the generation record.

## Runtime boundary

Recipes select named `cinematic`, `playable`, and `living` profiles. The living profile deliberately leaves daylight, weather, spawning, and ecology authoritative in Minecraft. A packaged world artifact has no Behold dependency. When a launcher later instantiates it, Behold assigns its own world and epoch identity and admits bodies through its independently owned contract.

Materialize an isolated, launchable server clone from a named profile:

```bash
node scripts/place-compiler/materialize-runtime.mjs \
  --run-root .behold-artifacts/places/PLACE/runs/RUN_ID \
  --profile living \
  --destination .behold-artifacts/places/PLACE/runtime/RUN_ID-living \
  --port 25685
```

The materializer APFS-clones the immutable source, writes the selected server properties, and installs a tiny datapack that applies the profile's daylight, weather, spawning, and difficulty settings through ordinary Minecraft gamerules.

## Living Places Benchmark

The versioned benchmark contract binds accepted San Francisco and Lower Manhattan world-tree identities to six independent dimensions: correspondence, legibility, habitability, ecology, experience, and capacity. It never collapses them into one synthetic score.

Validate the immutable fixtures, runtime profiles, geographic checkpoints, refusal rules, and execution budgets, then print the hardware-specific ready plan:

```bash
node scripts/place-compiler/benchmark.mjs
```

The benchmark refuses recipe, source-input, world-tree, file-count, byte-size, projection, scale, checkpoint, profile, or lock disagreement before starting a disposable runtime. Its contract and machine-readable schema are tracked at:

- `docs/place-compiler/benchmarks/living-places-v1.json`
- `docs/place-compiler/benchmark-v1.schema.json`

Run the real inspection, native-ecology, and performance lanes under new immutable run IDs, then assemble and independently verify a small checksummed evidence release:

```bash
node scripts/place-compiler/inspect-places.mjs --run-id NEW_INSPECTION_ID
node scripts/place-compiler/soak-ecology.mjs --run-id NEW_ECOLOGY_ID
node scripts/place-compiler/sweep-performance.mjs --run-id NEW_PERFORMANCE_ID
node scripts/place-compiler/package-benchmark.mjs --release-id NEW_RELEASE_ID
node scripts/place-compiler/verify-benchmark-release.mjs \
  .behold-artifacts/place-benchmarks/living-places-v1/releases/NEW_RELEASE_ID
```

All three lanes use the same Place-owned disposable-server harness. It executes the exact JVM argument vector published by `runtime-manifest.json`, verifies the pinned server JAR, connects a loopback offline observer, and saves and stops cleanly. Concise progress appears on stderr while the complete structured event stream is retained as `progress.jsonl` and checksummed by the lane manifest. A focused performance regression can select one place, profile, and repetition without weakening the benchmark's canonical repetition count:

```bash
node scripts/place-compiler/sweep-performance.mjs \
  --place lower-manhattan --profile living --repetitions 1 \
  --run-id FOCUSED_REGRESSION_ID
```

Foundry v2 canonical runs are selected only through a verified evidence set. The assembler derives every expected place/profile/repetition case from the benchmark, verifies the report, visual, progress, and manifest digests, and records the exact repository-relative file closure. It refuses focused or incomplete runs:

```bash
node scripts/place-compiler/assemble-evidence-set.mjs \
  --benchmark docs/place-compiler/benchmarks/FOUNDRY_BENCHMARK.json \
  --inspection .behold-artifacts/place-benchmarks/BENCHMARK/INSPECTION_RUN \
  --ecology .behold-artifacts/place-benchmarks/BENCHMARK/ECOLOGY_RUN \
  --performance .behold-artifacts/place-benchmarks/BENCHMARK/PERFORMANCE_RUN \
  --set-id CANONICAL_SET_ID
node scripts/place-compiler/verify-evidence-set.mjs \
  .behold-artifacts/place-benchmarks/BENCHMARK/evidence-sets/CANONICAL_SET_ID/evidence-set.json
```

Ground routes are separately versioned evidence, not generation identity and not cinematic splines. A route spec names geographic waypoints and a routing profile; the fetcher freezes the returned geometry, and the read-only auditor reconciles it against the immutable Anvil world using generated route surfaces, two-block headroom, bounded lateral alternatives, and continuous support/collision sampling:

```bash
node scripts/place-compiler/fetch-route.mjs \
  --spec docs/place-compiler/routes/PLACE-ROUTE.spec.json
node scripts/place-compiler/inspect-route.mjs \
  --run-root .behold-artifacts/places/PLACE/runs/RUN_ID \
  --route docs/place-compiler/routes/PLACE-ROUTE.json \
  --run-id ROUTE_INSPECTION_ID
```

The report keeps point resolution, collision freedom, and true swept traversability separate. An unsupported bridge span therefore cannot look healthy merely because sparse endpoints or collision-only percentages pass.

Sightline specs are likewise independent evidence. The offline inspector selects the highest generated surface in a bounded field around each declared endpoint, raycasts opaque and translucent Minecraft voxels, and repeats the observation at increasing vertical lifts to measure cinematic reveal clearance:

```bash
node scripts/place-compiler/inspect-sightlines.mjs \
  --run-root .behold-artifacts/places/PLACE/runs/RUN_ID \
  --views docs/place-compiler/views/PLACE.json \
  --run-id SIGHTLINE_INSPECTION_ID
```

This proves physical block visibility only. Client render distance, Distant Horizons LOD reach, and actively simulated regions remain separate claims and require separate evidence.

The package contains the contract and reproduction code plus visual, structural, ecological, and performance evidence. It deliberately excludes disposable runtime clones and does not repackage either multi-gigabyte world.

## Compare and package

`compare-previews.mjs` creates a checksummed, labeled two-place proof from the map previews of any two recorded runs. Legacy runs require an explicit recipe so their older manifests can be interpreted without silently guessing a place.

Package an accepted run into separate immutable-world, evidence, reproduction, and optional input archives, then stream-verify their digests, sizes, paths, and required contents:

```bash
node scripts/place-compiler/package-release.mjs \
  --run-root .behold-artifacts/places/PLACE/runs/RUN_ID \
  --include-inputs
node scripts/place-compiler/verify-release.mjs \
  .behold-artifacts/places/PLACE/releases/RUN_ID
```
