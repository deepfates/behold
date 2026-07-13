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
