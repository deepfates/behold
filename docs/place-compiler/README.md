# Behold Place Compiler

The Place Compiler turns a small, reviewable geographic recipe into a recorded Minecraft world run. San Francisco is the regression recipe, Lower Manhattan is the first independent generation proof, and Venice is the first global-elevation canal-city proof. The compiler owns geographic inputs, generation, validation, packaging, and presentation artifacts. It does not depend on Behold's body, controller, loom, or world-epoch implementation.

The interface is place-data driven: add recipe and experience contracts, then run the same generator, inspection, visit, ecology, and performance tools. San Francisco is an example and regression fixture, not a code path.

## Earth-to-living-world bootstrap

The autonomous front door begins from world intent rather than a hand-authored place recipe:

```bash
npm run place:resolve -- \
  --intent docs/place-compiler/intents/berkeley-living-city-v1.json \
  --output .behold-artifacts/place-foundry/berkeley-living-city-v1-resolution-v1
npm run place:bootstrap -- \
  --root .behold-artifacts/place-foundry/berkeley-living-city-v1-resolution-v1 \
  --attempt bootstrap-v1
```

Resolution freezes the provider response, derives budgeted physical bounds, records attribution and
cost, and creates a content-addressed `PlaceSeed`. Bootstrap freezes one exact OSM slice, profiles
its coverage, derives landmark and open-arrival candidates, and proposes a valid place recipe. It
may reuse that frozen source for later policy revisions without another network request.

Every compilation owns a Lync loom. Lync is authoritative for the append-only history of intent,
observations, semantic proposals, judgments, and revisions; a small manifest selects the active
tip without deleting alternative branches. Minecraft saves and Behold inhabitant looms remain
separate authority domains.

Semantic interpretation is optional and proposal-only:

```bash
node --env-file=.env scripts/place-compiler/semantic-place.mjs \
  --root .behold-artifacts/place-foundry/berkeley-living-city-v1-resolution-v1 \
  --attempt bootstrap-v2
npm run place:review-interpretation -- \
  --root .behold-artifacts/place-foundry/berkeley-living-city-v1-resolution-v1 \
  --attempt bootstrap-v2
```

Ax receives only bounded, frozen candidates and must return exact supplied IDs. Its model, typed
signature, input, output, usage, and cost are recorded. A separate deterministic representation
gate may reject a fluent but narrow proposal; even an accepted semantic representation remains
physically unverified until generation and embodied Minecraft inspection.

## Generate

Preview either command without writing an artifact:

```bash
node scripts/place-compiler/generate.mjs --place docs/place-compiler/places/san-francisco.json --dry-run
node scripts/place-compiler/generate.mjs --place docs/place-compiler/places/lower-manhattan.json --dry-run
```

Accepted builds should use a frozen OSM JSON input:

```bash
node scripts/place-compiler/fetch-osm-snapshot.mjs \
  --place docs/place-compiler/places/lower-manhattan.json \
  --output /path/to/lower-manhattan-overpass.json
node scripts/place-compiler/generate.mjs \
  --place docs/place-compiler/places/lower-manhattan.json \
  --osm-json /path/to/lower-manhattan-overpass.json
```

The fetcher derives one recursive Overpass query from the recipe bounds and writes a sidecar containing the endpoint, exact query, OSM timestamp, recipe digest, element count, size, and payload digest. Generation copies that acquisition record beside the frozen input when it is present.

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

### Behold-owned admission

The repository's Behold side can admit an accepted release without adding lifecycle or identity concepts to the Place Compiler. Admission independently verifies checksum closure, archive paths and entry types, the embedded generation record, and the portable Place world-tree digest. It then materializes the selected profile into a separate Behold baseline and derives a world identity that binds the release, archive, Place tree, profile, server JAR, and Behold baseline digests:

```bash
npm run build
node dist/scripts/place-epoch.js admit \
  --release .behold-artifacts/places/PLACE/releases/RUN_ID \
  --profile living \
  --destination .behold-runtime/place-epochs/RUN_ID-living \
  --server-jar .behold-runtime/server/server.jar \
  --server-sha256 PINNED_SHA256 \
  --port 25585
node dist/scripts/place-epoch.js verify \
  --root .behold-runtime/place-epochs/RUN_ID-living
```

Structured progress is written to stderr; the final descriptor is written to stdout. The admitted directory contains `place-epoch.json` plus an ordinary schema-v2 `world-definition.json` consumed by the unchanged Behold world owner. Source, baseline, and runtime are separate trees. Place identities remain provenance inputs rather than Behold inhabitant or epoch identities.

The real continuity proof can consume that admitted definition directly. It runs the same embodied resident through two separately owned Minecraft epochs, requires an independently witnessed consequence in the first, and verifies the resident's Minecraft inventory plus authoritative loom on restart. Its evidence can be reduced to a portable, checksummed package and reverified without the runtime tree:

```bash
node dist/scripts/owned-world-proof.js \
  --place-epoch .behold-runtime/place-epochs/RUN_ID-living \
  --arrival X,Y,Z --affordance X,Y,Z --run PROOF_ID
node dist/scripts/verify-owned-world-proof.js package \
  --report .behold-runtime/place-epoch-proofs/PROOF_ID/evidence/report.json \
  --release .behold-artifacts/places/PLACE/releases/RUN_ID \
  --output .behold-artifacts/place-benchmarks/BENCHMARK/PROOF_ID
node dist/scripts/verify-owned-world-proof.js verify-package \
  .behold-artifacts/place-benchmarks/BENCHMARK/PROOF_ID
```

## Living Places Benchmark

The versioned benchmark contract binds accepted San Francisco, Lower Manhattan, and Venice world-tree identities to six independent dimensions: correspondence, legibility, habitability, ecology, experience, and capacity. It never collapses them into one synthetic score.

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

Living Places v2 adds independently hashed experience policy without mutating accepted generation artifacts. Run both real lanes and verify their user-story acceptance with:

```bash
node scripts/place-compiler/soak-ecology.mjs \
  --benchmark docs/place-compiler/benchmarks/living-places-v2.json \
  --run-id NEW_V2_ECOLOGY_ID
node scripts/place-compiler/inspect-places.mjs \
  --benchmark docs/place-compiler/benchmarks/living-places-v2.json \
  --run-id NEW_V2_INSPECTION_ID
node scripts/place-compiler/verify-quality-loop.mjs \
  docs/place-compiler/benchmarks/living-places-v2.json \
  .behold-artifacts/place-benchmarks/living-places-v2/NEW_V2_ECOLOGY_ID \
  .behold-artifacts/place-benchmarks/living-places-v2/NEW_V2_INSPECTION_ID
```

Focused diagnostic runs may append `--place PLACE_ID`; the verifier then requires both lane manifests to contain exactly that selected place and refuses a mixed or incomplete selection.

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

### Human visit

The production visit flow derives safe arrival, a bounded collision-audited ground leg, and a measured reveal from accepted evidence rather than fixed coordinates. It materializes the selected profile, installs ordinary `/trigger place_visit` controls for a human, runs the same stages with a deterministic proof observer, records structured progress, and saves and stops cleanly. A native client and ScreenCaptureKit movie are optional; no agent or personal username is required:

```bash
npm run place:visit -- --verify
npm run place:visit -- \
  --place san-francisco --profile cinematic \
  --run-id NEW_VISIT_ID --port 25574
npm run place:visit -- \
  --place san-francisco --profile cinematic \
  --run-id NEW_CAPTURE_ID --port 25574 \
  --launch-client --visitor-name Visitor --capture-seconds 18
```

Independently verify one report or an exact three-place set. `--require-capture` requires at least one checksummed native-client movie in a complete set:

```bash
npm run proof:verify-visit -- --require-capture \
  --report path/to/san-francisco/visit-report.json \
  --report path/to/lower-manhattan/visit-report.json \
  --report path/to/venice/visit-report.json
```

The managed native client defaults to 32 render / 10 simulation chunks for the cinematic profile. That is vanilla render reach, not proof of Distant Horizons coverage or active simulation at city scale.

Generate a loopback-only BlueMap configuration for any accepted place from its recipe, exact world bounds, and generated landmark surfaces:

```bash
node scripts/place-compiler/configure-atlas.mjs \
  --run-root .behold-artifacts/places/PLACE/runs/RUN_ID \
  --place docs/place-compiler/places/PLACE.json \
  --experience docs/place-compiler/experiences/PLACE.json \
  --atlas-root .behold-artifacts/place-atlases/PLACE/CONFIG_ID
```

The resulting `atlas-manifest.json` binds the recipe, optional experience policy, source run, projection bounds, derived cave cutoff, loopback server, and coordinate-bearing markers. When experience policy is present, its measured arrival becomes the atlas start and its checkpoint corrections become the displayed markers. Rendering remains a view over the immutable world, never world authority.

The package contains the contract and reproduction code plus visual, structural, ecological, and performance evidence. It deliberately excludes disposable runtime clones and does not repackage either multi-gigabyte world.

## Capacity frontier

The controlled capacity runner keeps separated regions, protocol bodies, native entities, active vanilla brains, and external inhabitants as independent axes. It saves, restarts, reloads, recounts, and cleans every case instead of treating a successful connection burst as capacity proof:

```bash
node scripts/place-compiler/sweep-capacity.mjs \
  --plan docs/place-compiler/capacity-tiered-activation-v1.json \
  --run-id NEW_CAPACITY_ID
node scripts/place-compiler/verify-capacity.mjs \
  .behold-artifacts/place-capacity/san-francisco/NEW_CAPACITY_ID/capacity-manifest.json
```

Synthetic arenas are disposable experimental controls, never generation repair. Capacity summaries explicitly remain Minecraft substrate lower bounds and never claim Behold inhabitants or concurrent inference.

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

Package and independently verify the complete three-place Foundry v2 closure:

```bash
npm run place:release-foundry -- --output /path/to/new-release
npm run proof:verify-foundry-release -- /path/to/new-release
```

The tracked release contract selects evidence by digest. Packaging follows those manifests,
normalizes archive metadata, embeds every content hash, and records multi-gigabyte city worlds as
external content-addressed payloads through their release manifests and checksum indexes. Repeating
the package command from the same commit and inputs must produce byte-identical output.
