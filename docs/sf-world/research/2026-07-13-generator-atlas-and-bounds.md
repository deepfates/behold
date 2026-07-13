# Research snapshot: generator, atlas, and bounds

Date: 2026-07-13

This snapshot records the evidence behind the July 13 refresh of `SAN_FRANCISCO_WORLD_PLAN.md`. It is a decision record, not proof that any candidate has passed local validation.

## Arnis

- Arnis 3.0.0 was the newest official release and was published July 11, 2026.
- The 3.0.0 CLI source defines bounding boxes as `min_lat,min_lng,max_lat,max_lng`.
- The old plan's `--land-cover` and `--roof` flags do not exist in 3.0.0. Land cover and roof behavior are part of the generation pipeline.
- Relevant 3.0.0 options include `--projection`, `--overture`, `--disable-height-limit`, `--bake-lighting`, `--map-preview`, `--map-item`, `--gamemode`, and `--world-time`.
- `--output-dir` is a parent; Java generation creates a unique `Arnis World N` child.
- `metadata.json` includes geographic bounds, Minecraft bounds, projection, and scale.
- Overture resolution is dynamic and uses a bundled fallback release if catalog discovery fails. Saving OSM JSON does not freeze Overture or the other enrichment sources.
- The source caps added non-OSM Overture buildings at 100,000, so logs must show whether the cap was reached.
- Arnis 3.0 automatically decides whether to stream regions to disk using an internal memory estimate. Any `ARNIS_STREAM_TO_DISK` override must be recorded.
- Extended height is experimental, requires Java 1.21.4 or newer, and makes the world ineligible for Realms upload.
- Although the CLI describes `web_mercator` as suitable for multi-generation worlds, the 3.0.0 implementation derives its origin from each bbox center. The upstream fixed-coordinate/persistent-generation request remains open. Independent runs must not be treated as aligned without an overlap test.

Primary references:

- https://github.com/louis-e/arnis/releases/tag/v3.0.0
- https://github.com/louis-e/arnis/blob/v3.0.0/src/args.rs
- https://github.com/louis-e/arnis/blob/v3.0.0/src/world_utils.rs
- https://github.com/louis-e/arnis/blob/v3.0.0/src/world_editor/mod.rs
- https://github.com/louis-e/arnis/blob/v3.0.0/src/projection/web_mercator.rs
- https://github.com/louis-e/arnis/blob/v3.0.0/src/coordinate_system/transformation.rs
- https://github.com/louis-e/arnis/issues/1036

## Geographic bounds

The older DataSF URL is a visualization. The current underlying `SF Shoreline and Islands` dataset is `txuc-3kzm` and contains one multipolygon with mainland and island components.

Research retrieval:

- Endpoint: `https://data.sfgov.org/resource/txuc-3kzm.geojson?$limit=5000`
- Retrieved: 2026-07-13
- Size: 1,510,544 bytes
- SHA-256: `660b70e1d0606e8981c7d79b64c786b0b89aac57fc4d84f1aeffbd4d0b570058`
- Geometry: one `MultiPolygon`, 37,702 coordinate vertices across its component rings

Relevant measured component bounds:

| Component                   |        West |        East |     South |     North |
| --------------------------- | ----------: | ----------: | --------: | --------: |
| Mainland                    | -122.514948 | -122.356967 | 37.708089 | 37.811574 |
| Treasure/Yerba Buena Island | -122.379125 | -122.358850 | 37.807000 | 37.833298 |
| Alcatraz                    | -122.425957 | -122.420609 | 37.824995 | 37.828307 |

The selected practical rectangle is:

```text
south: 37.707
west:  -122.516
north: 37.834
east:  -122.349
```

At scale 1.0 this is approximately 14.68 km by 14.12 km, or 207 square kilometers. It includes all three target components with margin while excluding the Farallons and unrelated county outliers.

Primary reference:

- https://data.sfgov.org/Geographic-Locations-and-Boundaries/SF-Shoreline-and-Islands/txuc-3kzm

## BlueMap

- BlueMap 5.22 was the latest release at research time.
- The 5.22 CLI targets Minecraft 1.13.2 through 26.2 and Java 25.
- The local Mac has Java 25 and the target world is Minecraft 1.21.4.
- Standalone CLI rendering avoids converting the current vanilla exploration server to a plugin server.
- BlueMap can define static POI and shape markers in map configuration.
- `ignore-missing-light-data=true` renders otherwise omitted chunks, but makes them fully lit and weakens cave detection and night mode. Prefer complete lighting and use the option only as an accepted fallback.

Primary references:

- https://github.com/BlueMap-Minecraft/BlueMap/releases/tag/v5.22
- https://bluemap.bluecolored.de/wiki/getting-started/Installation.html
- https://bluemap.bluecolored.de/wiki/configs/Maps.html
- https://bluemap.bluecolored.de/wiki/customization/Markers.html

## Local status observed

- The original `Arnis World 4` exists at about 168 MB and matches its recorded metadata.
- The played server world is about 201 MB.
- At inspection time, Java PID 41100 owned both `127.0.0.1:25565` and the played world's `session.lock`.
- World-lab status correctly refused readiness because the archive root and prepared baseline were missing and the runtime lock and port were owned.
- The repository build and lint passed, and all 45 tests passed.
- No current Arnis candidate, validation world, complete source city, BlueMap atlas, or coordinate bridge had been installed or produced.

## Post-research execution addendum

The local-status bullets above describe the state at research time. Later on July 13, the work advanced materially:

- Arnis 3.0.0 was frozen with a tracked patch for tall-world heightmap serialization after focused unit and server validation.
- A checksummed BBBike PBF and deterministic Overpass-JSON conversion replaced unreliable live full-rectangle Overpass requests.
- The complete 14,679 × 14,122 block source world generated successfully and passed an isolated vanilla 1.21.4 server smoke across eight distributed landmarks.
- BlueMap 5.22 configuration and coordinate conversion became tracked scripts; the full atlas render and archive packaging followed as low-priority artifact work.

The execution report, rather than this pre-execution research snapshot, is authoritative for final artifact status and measurements.
