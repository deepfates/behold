# San Francisco world tooling

These commands reproduce, locate, package, and verify the San Francisco Minecraft world without mutating Behold's live runtime world. Large inputs and outputs stay below the ignored `.behold-artifacts/sf/` root; reviewable recipes and evidence stay in Git.

## Toolchain

`docs/sf-world/tool-lock.json` pins official release URLs and digests for Arnis, BlueMap, Mojang's Minecraft 1.21.4 client resources, and the Minecraft 1.21.4 server. The full-city build uses Arnis 3.0.0 plus the tracked `docs/sf-world/tooling/arnis-v3.0.0-tall-heightmap.patch` because upstream 3.0.0 encodes tall-world heightmaps at the wrong dimension width.

Download and checksum the source archive URL pinned in `tool-lock.json`. To rebuild the binary from that exact official `v3.0.0` source:

```bash
git apply docs/sf-world/tooling/arnis-v3.0.0-tall-heightmap.patch
cargo test world_editor::java::tests --release --no-default-features
cargo build --release --no-default-features
```

Place the result at the ignored path recorded in `tool-lock.json` and verify its checksum. A different compiler or dependency resolution may produce a different binary checksum; the pinned source tag, patch, tests, and build command remain the semantic recipe.

Verify every local tool artifact against the lock before generation or rendering:

```bash
node scripts/sf-world/verify-tools.mjs
```

## Deterministic OSM snapshot

The live Overpass query for the full rectangle is large and provider-dependent. The repeatable path uses BBBike's San Francisco PBF, whose published polygon contains the target rectangle.

```bash
python3 -m venv .behold-artifacts/sf/tools/pbf-converter-venv
.behold-artifacts/sf/tools/pbf-converter-venv/bin/pip install \
  --require-hashes \
  -r scripts/sf-world/requirements.txt
.behold-artifacts/sf/tools/pbf-converter-venv/bin/python \
  scripts/sf-world/pbf-to-overpass.py \
  SanFrancisco.osm.pbf \
  SanFrancisco-overpass.json
```

Record the source timestamp, provider digest, output size, output SHA-256, and conversion counts. The accepted July 11 snapshot is described in the execution report and its ignored `source-manifest.json`.

The accepted input package also carries the exact 1,332 USGS 3DEP tiles, 10 ESA WorldCover cache files, and custom stadium model used by the run. To avoid changing a user's normal Arnis cache, restore `inputs/arnis-cache/` beneath a fresh `HOME/Library/Caches/` tree and invoke `generate.mjs` with that isolated `HOME` environment.

Arnis 3.0.0 does not cache Overture HTTP range responses or accept a frozen Overture snapshot. The package records the immediately observed Overture catalog (`2026-06-17.0`) and its digest, but a future raw regeneration is therefore semantic rather than promised byte-identical. The canonical reproducible object is the checksummed immutable world archive; extracting or cloning that archive gives every server the exact accepted blocks.

## Generate

Preview the exact manifest and command without writing a run:

```bash
node scripts/sf-world/generate.mjs --run-id sf-check --dry-run
```

Generate from a saved snapshot:

```bash
node scripts/sf-world/generate.mjs \
  --osm-json .behold-artifacts/sf/inputs/bbbike-san-francisco-20260711/SanFrancisco-overpass.json
```

The generator verifies the patched Arnis checksum, creates a unique run root, APFS-clones a supplied OSM snapshot into that run and verifies the copied digest, records the full command and environment, runs at nice level 10 with four Rayon threads, and never reads or writes `.behold-runtime/server/world`.

After generation, record a timestamp-independent identity for the source tree:

```bash
node scripts/sf-world/tree-hash.mjs \
  '.behold-artifacts/sf/runs/full-city/RUN_ID/output/Arnis World 1' \
  .behold-artifacts/sf/runs/full-city/RUN_ID/evidence/world-checksums.json
```

The manifest stores every relative path, byte count, and SHA-256; its tree digest hashes those sorted records rather than filesystem metadata.

Verify the current tree against an existing manifest without rewriting it:

```bash
node scripts/sf-world/tree-hash.mjs --verify \
  '.behold-artifacts/sf/runs/full-city/RUN_ID/output/Arnis World 1' \
  .behold-artifacts/sf/runs/full-city/RUN_ID/evidence/world-checksums.json
```

## Convert coordinates

```bash
node scripts/sf-world/coordinate-bridge.mjs \
  '/path/to/Arnis World 1/metadata.json' ll-to-xz 37.7793 -122.4193

node scripts/sf-world/coordinate-bridge.mjs \
  '/path/to/Arnis World 1/metadata.json' xz-to-ll 8495 6080

node scripts/sf-world/coordinate-bridge.mjs --verify-landmarks \
  '/path/to/Arnis World 1/metadata.json' \
  docs/sf-world/landmarks.json
```

The inverse returns the geographic center of a Minecraft block so a forward round trip stays in the same block. Landmark verification checks every stored geographic coordinate, block, and chunk against the accepted world metadata.

## Create a disposable server copy

Materialize an APFS clone without changing the source or Behold runtime:

```bash
node scripts/sf-world/clone-source-world.mjs \
  --source-world '.behold-artifacts/sf/runs/full-city/RUN_ID/output/Arnis World 1' \
  --destination '.behold-artifacts/sf/server-copies/RUN_ID/world'
```

The command refuses a locked source, an existing destination, overlapping paths, and every destination below `.behold-runtime/`. It verifies the copied metadata and writes a copy manifest beside the disposable world. Use `--copy-mode full` only on filesystems without APFS clone support.

## Configure and render the atlas

Generate a path-independent BlueMap 5.22 configuration directly from the accepted world's metadata:

```bash
node scripts/sf-world/configure-bluemap.mjs \
  --run-root .behold-artifacts/sf/runs/full-city/RUN_ID

nice -n 10 java -Xms2G -Xmx8G \
  -jar .behold-artifacts/sf/tools/bluemap-v5.22/bluemap-5.22-cli.jar \
  -c .behold-artifacts/sf/runs/full-city/RUN_ID/atlas/config \
  -r -g -s --markers -m overworld -v 1.21.4
```

The generated configuration uses two lowest-priority render threads by default, the exact world render mask, the baked light data, all three BlueMap views, high-resolution geometry, eight server-verified landmark markers, and 18 coordinate-verified neighborhood markers. BlueMap's Minecraft client resource is governed by Mojang's EULA and is not included in release archives.

After rendering, start the isolated atlas server with the same pinned CLI and config plus `-w`; the generated config binds its web server to `127.0.0.1:8106`. This does not start or modify the Minecraft server.

## Package and verify

```bash
node scripts/sf-world/package-release.mjs \
  --run-root .behold-artifacts/sf/runs/full-city/RUN_ID \
  --atlas .behold-artifacts/sf/runs/full-city/RUN_ID/atlas/web \
  --include-inputs

node scripts/sf-world/verify-release.mjs \
  .behold-artifacts/sf/releases/RUN_ID
```

Packaging refuses a source world that contains `session.lock`, writes separate world, generation-evidence, reproduction-kit, input, atlas, and atlas-evidence archives at nice level 10, uses portable USTAR plus low-overhead gzip level 1, strips extended attributes, normalizes archive ownership, and disables the gzip header timestamp. The atlas-evidence archive carries configs, logs, the web-tree checksum manifest, and every recorded render leg while excluding Mojang's client resource. USTAR also avoids platform-specific access, change, and creation-time PAX records. Given unchanged source trees and modification times, the content archives are byte-reproducible; `release-manifest.json` intentionally records a fresh creation time. The reproduction kit carries the frozen tool lock, landmark coordinates, Arnis patch, manifest template, research snapshot, validation template, evidence README, and every SF pipeline script without depending on unrelated repository files. Verification checks every digest and recorded size, streams every archive listing, rejects unsafe paths or a source `session.lock`, and requires the expected role-specific contents.

Do not swap a packaged world into Behold's live runtime while its server owns the world lock or port. Runtime deployment is intentionally a separate, explicit operation.
