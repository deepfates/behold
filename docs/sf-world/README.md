# San Francisco world evidence

This directory contains small, reviewable evidence for the complete San Francisco world. Large inputs and outputs belong under the ignored `.behold-artifacts/sf/` tree and must not be committed.

## Tracked here

- `manifests/`: generator, source-world, played-world, and atlas manifests plus checksums
- `reports/`: validation results, performance measurements, deviations, and acceptance decisions
- `research/`: dated research snapshots supporting version, bounds, projection, and tool decisions
- `tooling/`: the narrowly scoped patch needed to reproduce the accepted Arnis binary
- `landmarks.json`: the shared latitude/longitude, Minecraft, chunk, and BlueMap marker coordinates used by validation and future Behold agents

The accepted full-city build is summarized in `manifests/sf-full-v3-snapshot-20260713T095831Z.json` and the corresponding execution report. The ignored run root contains the exhaustive per-file checksums and logs.

## Not tracked here

- Arnis or BlueMap binaries
- Raw OSM, elevation, land-cover, Overture, or 3D-model inputs
- Generated Minecraft worlds or server copies
- BlueMap render tiles
- Runtime logs and archives

Every tracked manifest should identify the corresponding ignored artifact by canonical path, size, and SHA-256 or a deterministic per-file checksum manifest. Paths are local locators, not proof; checksums and recorded provenance are the evidence.
