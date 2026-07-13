# Complete San Francisco Minecraft World

Status: complete and verified 2026-07-13; live Behold deployment intentionally remains separate

Audience: an agent or developer starting with no prior conversation context

## The goal

Create a new Minecraft Java world containing the complete recognizable city of San Francisco at approximately one block per real-world meter.

"Complete San Francisco" means the city people live in and recognize: every mainland neighborhood from the Presidio to Visitacion Valley and from Ocean Beach to the Embarcadero, plus nearby pieces such as Treasure Island, Yerba Buena Island, and Alcatraz when they fit naturally. The Farallon Islands are not part of this project's practical scope.

The finished world must be pleasant to explore, not merely technically generated. A player should be able to fly over the whole city, search for places, teleport to landmarks, inspect it in a browser map, and share the same coordinate system with software agents.

This is a new world. Do not try to enlarge or overwrite the existing Golden Gate Park save.

## Why this is worth doing

There is already a real San Francisco-derived Minecraft world on this Mac. It proves that the basic idea works, but it covers only a thin strip around Golden Gate Park and was generated with an older version of Arnis.

A complete current-generation city would provide three things at once:

1. A large, recognizable world that is immediately fun to visit.
2. A real geographic environment for testing Behold's human and agent interfaces.
3. A reproducible foundation for later work on maps, landmarks, municipal data, multiplayer activity, and agent tasks.

The city itself is the product. Small test generations are validation steps, not a reduction in scope.

## What already exists locally

Preserve all of these. They are evidence, references, or source material.

### Untouched source world

Path:

```text
/Users/deepfates/Library/Application Support/minecraft/saves/Arnis World 4
```

Known properties:

- World name: `Arnis World 4: San Francisco`
- Generated October 12, 2025
- Minecraft version: 1.21.4
- Original mode: creative, commands enabled
- Approximate scale: one block per meter
- Size: about 168 MB
- Generated dimensions: 7,091 by 1,297 blocks
- Geographic bounds:
  - south: `37.763658`
  - west: `-122.514381`
  - north: `37.775328`
  - east: `-122.433701`

Those bounds cover an east-west strip centered on Golden Gate Park. They do not cover the entire city.

The file `metadata.json` inside the save records the exact bounds and Minecraft extents.

### Played server copy

Path:

```text
/Users/deepfates/Hacking/projects/behold/.behold-runtime/server/world
```

This is a disposable working copy created in July 2026. It has player and agent activity and differs from the source world. It is useful as a record of the first Behold multiplayer experiment, but it must not be used as the input for the new city.

### Existing Arnis installation

Paths:

```text
/Users/deepfates/Downloads/arnis-mac-universal.jar
/Users/deepfates/Downloads/arnis-2.3.0
```

Despite its `.jar` suffix, `arnis-mac-universal.jar` is a native universal macOS executable, not a Java archive. It contains Apple Silicon and Intel binaries. The local source tree identifies it as Arnis 2.3.0.

Do not use 2.3.0 for the new city. As of July 13, 2026, the newest official release is Arnis 3.0.0, released July 11. Obtain binaries and source only from the official project:

- https://github.com/louis-e/arnis
- https://github.com/louis-e/arnis/releases

Arnis 3.0 includes the 2.7 terrain and extended-height work, the 2.8 landmark and bridge improvements, the 2.9 multicore and stream-to-disk work, and a new terrain, climate, tree, interior, and prop pipeline. At the research gate it was only two days old and was treated as a candidate with 2.9 as fallback. Subsequent validation froze 3.0.0 plus the tracked tall-heightmap patch; the fallback was not needed.

Pinned implementation references:

- [Arnis 3.0.0 release](https://github.com/louis-e/arnis/releases/tag/v3.0.0)
- [Arnis 3.0.0 CLI arguments](https://github.com/louis-e/arnis/blob/v3.0.0/src/args.rs)
- [Arnis 3.0.0 projection implementation](https://github.com/louis-e/arnis/tree/v3.0.0/src/projection)
- [Open fixed-coordinate generation request](https://github.com/louis-e/arnis/issues/1036)

## What Arnis does

Arnis is a geographic-data-to-Minecraft compiler. It does not reconstruct a city from photographs.

Its basic pipeline is:

1. Receive a latitude/longitude rectangle and a scale.
2. Fetch roads, buildings, parks, water, and other features from OpenStreetMap.
3. Enrich terrain and buildings with other supported data sources.
4. Convert real coordinates into Minecraft X/Z coordinates.
5. Interpret geographic tags through procedural generation rules.
6. Write ordinary Minecraft region and NBT files.

The resulting world is geographically structured but still procedural. A building footprint may be correct while its facade or interior is invented. This distinction should remain visible in documentation and validation reports.

## Target coverage

The accepted full-generation rectangle covers:

```text
south: 37.707
west:  -122.516
north: 37.834
east:  -122.349
```

This rectangle is deliberately practical rather than legally exhaustive. It covers the inhabited peninsula, the recognizable waterfront, the Golden Gate Bridge span, Alcatraz, and all of Treasure/Yerba Buena Island. It excludes the Farallon Islands and other county outliers that are not part of the practical city product.

The July 13 research refresh checked the rectangle against the current underlying DataSF multipolygon. Relevant source-component bounds are:

- Mainland: south `37.708089`, west `-122.514948`, north `37.811574`, east `-122.356967`
- Treasure/Yerba Buena Island: south `37.807000`, west `-122.379125`, north `37.833298`, east `-122.358850`
- Alcatraz: south `37.824995`, west `-122.425957`, north `37.828307`, east `-122.420609`

The earlier north bound of `37.833` clipped the northernmost roughly 33 meters of Treasure Island, while the earlier south bound left only about 10 meters below the mainland shoreline. The revised bounds add useful validation margin without materially expanding the run.

Official geographic reference:

- https://data.sfgov.org/Geographic-Locations-and-Boundaries/SF-Shoreline-and-Islands/txuc-3kzm

At one block per meter, expect a rectangle around 14.68 km wide and 14.12 km tall, or about 207 square kilometers. The exact Minecraft dimensions will depend on the frozen Arnis projection and its rounding behavior.

Expected first-order resource envelope:

- About 22 to 23 times the surface area of the existing world
- Approximately 3 to 10 GB for the pristine world until validation runs provide a measured bytes-per-square-kilometer estimate
- Additional space for archives, server activity, and browser-map rendering
- Roughly one to six hours for a full generation until validation runs provide a measured extrapolation, subject to network, CPU, memory, source density, lighting, interiors, and Arnis behavior

These are planning estimates, not acceptance criteria. The Mac currently has several terabytes of free disk space, so disk capacity is not a blocker.

## Fixed decisions

Use these defaults unless a test produces evidence that they are wrong:

- Edition: Minecraft Java
- Minecraft version: 1.21.4 initially, matching the working Behold native client and source save
- Arnis version: 3.0.0 plus the tracked tall-heightmap serialization patch, frozen after validation
- Scale: `1.0` block per meter
- Projection: explicitly recorded; start with `local` for the validation baseline and test `web_mercator` only as a measured alternative
- Terrain: enabled
- Land cover: enabled automatically by the Arnis 3.0 terrain pipeline; there is no `--land-cover` CLI flag
- Building interiors: enabled
- Roof generation: enabled by the building pipeline; there is no `--roof` CLI flag
- Overture building enrichment: enabled, with the resolved Overture release and any 100,000-building cap warning recorded
- External 3D models and bundled props: enabled
- Fill ground: enabled; validation proved that it creates a mineable bedrock-and-stone underground and avoids an empty subgrade world
- Top-down Arnis map preview: enabled
- Starting map item: enabled
- Chunk lighting bake: enabled and retained after the validation worlds and isolated server smoke test
- Extended height: enabled and required for high terrain; use the tracked Arnis patch so tall-world heightmaps match the 4,064-block dimension
- Orientation: geographic default, with no rotation unless a visual test demonstrates a clear benefit
- Runtime mode: creative
- Flight: enabled
- Commands: enabled
- Source world: immutable after generation
- Played worlds: disposable copies of the source

## Current execution status

The accepted run is `sf-full-v3-snapshot-20260713T095831Z`. As of July 13, 2026:

- Official Arnis 3.0.0 and BlueMap 5.22 artifacts are pinned by URL and SHA-256 in `docs/sf-world/tool-lock.json`.
- An Arnis 3.0.0 tall-world heightmap defect was reproduced, fixed narrowly, tested, and preserved as `docs/sf-world/tooling/arnis-v3.0.0-tall-heightmap.patch`.
- The OSM input is a dated BBBike PBF converted deterministically to Overpass JSON. Both source and converted digests are recorded.
- The complete world covers the fixed rectangle in 14,679 by 14,122 blocks, contains 812 region files, occupies 6,138,031,022 file bytes, and has deterministic tree digest `4fd327ebe85e90931e3fee4cd01c50490fd3ae4638f98ac53d1e6045d29554d1`.
- Generation completed in 718.452 seconds at 12,704,120,832 bytes peak RSS, using four nice-10 Rayon threads and stream-to-disk mode.
- A disposable APFS clone opened, loaded eight distributed landmark chunks, saved, and stopped under an isolated Minecraft 1.21.4 server on port 25575. It produced no heightmap warnings, chunk errors, or exceptions.
- The source world has never been opened by a server and contains no `session.lock`. The live Behold server world and port 25565 remain untouched.
- BlueMap completed a 204,211-file full-city atlas with all 26 markers and a deterministic tree checksum. HTTP and browser QA passed on a loopback-only server.
- The six-role release verified successfully, its packaged world reproduced the source tree after extraction, and a second full package produced byte-identical content archives.

The exact artifacts, measurements, limitations, and acceptance evidence are recorded in `docs/sf-world/reports/2026-07-13-execution-report.md`.

## Important constraint: do not expand the old save

Arnis derives Minecraft coordinates from the selected geographic rectangle. Expanding the rectangle south or east changes the coordinate origin and can also change projection factors. The old Golden Gate Park chunks therefore cannot be treated as already completed city chunks.

Generate the city from scratch with one recorded coordinate transform. If there are player-made structures worth preserving, export and reinsert them later as schematics after calculating the correct new coordinates.

## Deliverables

The project is complete when it produces all of the following:

1. **Immutable generated source world**
   - Never used directly by players or agents.
   - Stored with a checksum and generation manifest.

2. **Playable server copy**
   - Creative mode, flight, commands, and a useful spawn.
   - Launches through the existing Behold native play flow or a documented replacement.

3. **Generation manifest**
   - Arnis version and binary checksum
   - Minecraft version
   - Exact bounding box
   - Scale, rotation, terrain, land-cover, interior, roof, spawn, and height settings
   - Generation command
   - Start and finish timestamps
   - Input-data references and saved files
   - World checksum or per-region checksum list

4. **Full-city browser atlas**
   - Prefer BlueMap because it reads Minecraft worlds and provides a navigable 3D web map.
   - Show the entire generated city, not merely the area around a bot.
   - Include named landmark and neighborhood markers.

5. **Coordinate bridge**
   - Convert latitude/longitude to Minecraft X/Z and back.
   - Use the same transform for players, map markers, validation, and agents.
   - Record uncertainty and rounding behavior.

6. **Validation report**
   - What was generated successfully
   - Known missing or inaccurate areas
   - Landmark checks with coordinates and screenshots where useful
   - Performance and disk measurements
   - Any deviations from the manifest defaults

7. **Repeatable reset and launch commands**
   - Archive a played run.
   - Create a fresh runtime copy from the immutable source.
   - Start the server, native client, Behold agents, and browser map.
   - Refuse to reset while the server owns the world's `session.lock`.

## Work plan

### Milestone 0: protect existing evidence

Goal: make experimentation safe before downloading or generating anything.

Tasks:

- Confirm the original `Arnis World 4` still exists and is not in use.
- Record its directory size and a recursive checksum manifest.
- Record the current played server copy separately.
- Do not move, rename, edit, or launch the source world.
- Use `.behold-artifacts/sf/` as the ignored project-owned root for generator binaries, input snapshots, validation outputs, complete source worlds, generation logs, atlases, and archives.
- Use `docs/sf-world/manifests/` and `docs/sf-world/reports/` for the small tracked manifests, checksums, decisions, landmark data, and validation reports that describe those artifacts.
- Ensure generated worlds, raw inputs, binaries, large map renders, and runtime copies are ignored by Git while manifests and reports remain tracked.

Exit condition:

- Existing source and played worlds can be distinguished unambiguously.
- There is a documented recovery path if a later step fails.

### Milestone 1: select and establish the current generator

Goal: select the generator version through evidence, then make it available through a recorded, repeatable command.

Tasks:

- Download the official Arnis 3.0.0 macOS universal release without replacing 2.3.0.
- If 3.0 fails a validation gate, obtain 2.9.0 as a comparison candidate rather than silently downgrading.
- Verify the selected binary's reported version and architecture.
- Record its SHA-256 checksum and source URL.
- Keep the old 2.3 binary for comparison; do not overwrite it.
- Test that the GUI launches, but use arguments on the standalone binary for recorded generations.
- Capture `--help` output because flags can change between releases. The 3.0.0 source is authoritative when prose documentation disagrees.
- Confirm experimentally that `--output-dir` is a parent directory: Arnis creates a uniquely numbered `Arnis World N` child inside it.
- Record whether `ARNIS_STREAM_TO_DISK` is unset, `0`, or `1`; do not depend on undocumented overrides without recording them.

Exit condition:

- A developer can invoke the exact checksummed generator binary from a documented path, reproduce its version and `--help` output, and explain why it was chosen over the fallback candidate.

### Milestone 2: validate difficult parts of the city

Goal: discover bad settings cheaply before committing to the full run.

Generate at least two small disposable worlds with the exact candidate binary:

1. A dense downtown area containing tall buildings and steep streets.
2. A terrain-heavy area such as Twin Peaks or the Presidio.

Add a small Golden Gate Bridge slice if the two rectangles above do not include the bridge. A historical upstream issue reported a Golden Gate Bridge crash in Bedrock 2.5; this project uses Java 3.0, so it is not evidence of a current defect, but the bridge remains a high-value location-specific gate.

Test:

- Building height and clipping
- Extended-height compatibility
- Terrain seams and elevation quality
- Roof and interior generation
- Road slopes and intersections
- Water and shoreline behavior
- External 3D landmark and bundled prop behavior
- Overture fetch results, resolved release, and whether the addition cap is reached
- `local` versus `web_mercator` coordinate output on one identical bbox
- Arnis `--map-preview` output
- Generation with and without `--bake-lighting` if its cost is material
- Server load compatibility
- BlueMap rendering, including missing-light behavior
- Native-client rendering and flight

Measure for each run:

- Geographic area and Minecraft dimensions
- Download time and generation time separately where possible
- Peak memory and whether stream-to-disk activated
- World size, region count, and bytes per square kilometer
- BlueMap render time and atlas size
- Warnings, retries, skipped providers, and failed enrichments

Do not polish or publish these worlds. They are gates for the whole-city settings.

Exit condition:

- The selected version and settings produce usable terrain and buildings in both dense and steep environments.
- Minecraft 1.21.4, the server, the native client, and the map renderer can all open the result.
- The manifest can convert at least five known latitude/longitude points to Minecraft X/Z and back within the documented rounding tolerance.

### Milestone 3: freeze inputs and run the full generation

Goal: produce the complete source city.

Before the run:

- Confirm the final rectangle against the official shoreline map.
- Choose a spawn inside the rectangle. Downtown Civic Center is a reasonable default because it is recognizable and central to transit, but any safe, validated point is acceptable.
- Create the generation manifest before launching the command.
- Use Arnis's `--save-json-file` support to preserve the fetched OSM data.
- Note that saving OSM JSON alone may not freeze every external source used by modern Arnis. Record provider names, version information, cache paths, and timestamps for elevation, land cover, and building enrichment when available.
- Ensure ample temporary and output space.

Arnis 3.0.0 CLI facts that affect the command:

- Bounding-box order is `min_lat,min_lng,max_lat,max_lng`.
- `--land-cover` and `--roof` are not valid 3.0.0 flags; those pipelines are automatic.
- `--overture`, `--map-item`, and 3D models/props are enabled by default, but the manifest should still record their effective values.
- `--disable-height-limit` installs an experimental Java datapack requiring Minecraft 1.21.4 or newer and prevents Realms upload.
- `--output-dir` is the parent in which Arnis creates `Arnis World N`, not the final world path.
- `metadata.json` now records geographic bounds, Minecraft bounds, projection, and scale.

Prototype command for a run-specific, initially empty output parent:

```bash
"$ARNIS_BIN" \
  --output-dir "$RUN_ROOT/output" \
  --bbox "37.707,-122.516,37.834,-122.349" \
  --scale 1 \
  --projection local \
  --terrain \
  --interior=true \
  --overture=true \
  --disable-height-limit \
  --bake-lighting \
  --map-preview \
  --map-item=true \
  --gamemode creative \
  --world-time 6000 \
  --spawn-lat 37.7793 \
  --spawn-lng -122.4193 \
  --rotation 0 \
  --save-json-file "$RUN_ROOT/inputs/san-francisco-osm.json"
```

Treat this as a template. Confirm the installed release's `--help` output before running it.

Create `$RUN_ROOT/output` as an empty parent and `$RUN_ROOT/inputs` before execution, then record the exact child directory Arnis creates. Capture stdout and stderr outside that child so failed logs cannot be mistaken for immutable world contents. Start from `docs/sf-world/manifests/generation-manifest.template.json` and populate it as evidence becomes available rather than reconstructing the run afterward.

During the run:

- Capture stdout and stderr to a dated log.
- Record CPU time, wall time, peak memory if practical, downloads, retries, and output growth.
- Record the resolved elevation-provider chain, cache locations, ESA WorldCover inputs, Overture release and partition URLs, and whether any provider fell back.
- Record whether automatic stream-to-disk activated. Arnis 3.0 estimates dense generation at about 26 MB of resident memory per region before deciding whether to stream; treat this as an implementation heuristic, not a capacity promise.
- Do not run Minecraft or another writer against the destination world.
- If the run fails, preserve the log and partial output until the failure is understood.

After the run:

- Confirm `level.dat`, region files, `metadata.json`, the map preview, and any bundled datapacks exist.
- Confirm `metadata.json` contains the frozen projection and scale in addition to both coordinate bounds.
- Record sizes and checksums.
- Open only a disposable copy for initial testing.

Exit condition:

- One immutable generated world contains the complete target rectangle and loads without corruption.

### Milestone 4: validate the whole city

Goal: distinguish "the process finished" from "San Francisco is actually there."

Build a landmark checklist distributed across the city. At minimum, inspect:

- Ocean Beach
- Golden Gate Park
- Presidio
- Golden Gate Bridge approach
- Marina
- Fisherman's Wharf
- Chinatown
- Financial District
- Civic Center
- SoMa
- Mission
- Castro
- Twin Peaks
- Haight-Ashbury
- Sunset
- Richmond
- Bernal Heights
- Bayview and Hunters Point
- Excelsior or Visitacion Valley
- Embarcadero waterfront
- Treasure Island and Yerba Buena Island
- Alcatraz, if included in the selected rectangle and source data

For each check, record:

- Real latitude/longitude
- Expected Minecraft coordinate
- Actual Minecraft coordinate
- Whether terrain, roads, water, and major structures are recognizable
- Any severe generation defect

Also inspect citywide properties:

- No missing neighborhood-sized swaths
- No repeated or shifted regions
- No obvious tile or elevation seams
- Downtown is not truncated vertically
- Shoreline and water are navigable and visually coherent
- The world remains stable after a server save and restart

Exit condition:

- All normal San Francisco neighborhoods are represented.
- Critical defects are either fixed or documented with an explicit decision to accept them.

### Milestone 5: make it enjoyable to explore

Goal: a person unfamiliar with Minecraft can immediately see and tour the city.

Tasks:

- Create a clean server copy from the immutable source.
- Set creative mode, commands, and flight.
- Make the human player an operator.
- Verify a safe spawn above ground.
- Add named teleport destinations for major neighborhoods and landmarks.
- Install a checksummed BlueMap CLI release and render the full generated world from a stopped disposable copy or read-only source snapshot. Prefer standalone BlueMap over changing the vanilla exploration server into a plugin server.
- Start with BlueMap 5.22 as the researched candidate. Its CLI targets Minecraft 1.13.2 through 26.2, requires Java 25, and therefore covers the 1.21.4 world on the Java 25 runtime already present on this Mac.
- Keep BlueMap configuration, marker definitions, and version/checksum evidence in Git; keep rendered map tiles outside Git.
- Add neighborhood boundaries and landmark markers to BlueMap.
- Generate static POI markers and neighborhood shape markers from the same coordinate bridge used by validation and agents.
- Prefer complete chunk lighting. If Arnis `--bake-lighting` is insufficient, test BlueMap's `ignore-missing-light-data=true` only as a documented fallback because it renders missing-light chunks fully lit and weakens cave detection and night mode.
- Document basic controls: flight, spectator mode, coordinates, teleport, and returning to spawn.
- Keep Prismarine Viewer as an agent-following view if useful, but do not mistake it for the full-city atlas.

Exit condition:

- A player can launch, fly, teleport to several landmarks, and survey the entire world in a browser without using developer tools.

BlueMap references:

- https://github.com/BlueMap-Minecraft/BlueMap/releases/tag/v5.22
- https://bluemap.bluecolored.de/wiki/getting-started/Installation.html
- https://bluemap.bluecolored.de/wiki/configs/Maps.html
- https://bluemap.bluecolored.de/wiki/customization/Markers.html

### Milestone 6: connect the city to Behold agents

Goal: make geography part of the observation and action space.

Tasks:

- Implement and test the geographic coordinate bridge.
- Add stable place IDs and names for landmarks and neighborhoods.
- Allow tasks to name either a Minecraft coordinate, latitude/longitude, or place ID.
- Expose map bounds, current geographic position, heading, nearby named features, and route progress in observations.
- Add safe actions for teleporting during tests, normal navigation, looking, inspecting, placing, and modifying blocks.
- Record world changes and agent trajectories without mutating the immutable source.
- Create initial tasks such as:
  - Navigate from Civic Center to the Ferry Building.
  - Find a route through Golden Gate Park.
  - Inspect whether a named landmark exists and describe its generated form.
  - Compare two routes between neighborhoods.

Exit condition:

- A human and an agent can refer to the same real place and resolve it to the same location in the Minecraft world.

## Failure strategy for a generation that is too large

Try the complete generation in one pass after the validation worlds. Arnis 3.0 includes multicore processing and automatic stream-to-disk behavior inherited from 2.9, the target is about 207 square kilometers, and Arnis 3.0 emits its own large-area warning only above 250 square kilometers. This makes a one-pass attempt plausible, not guaranteed.

If the full run fails because of API, memory, or processing limits, do not generate independent rectangles and naively paste them together. Independent Arnis runs normally use independent coordinate origins, which creates misalignment and seams.

Do not assume `--projection web_mercator` solves independent tiling. In 3.0.0, the projection origin is computed from the center of each requested bounding box, and the upstream fixed-coordinate/persistent-generation request remains open. Two different rectangles can therefore still assign different Minecraft coordinates to the same real point. Prove alignment with an overlap test before using any multi-run design.

Instead, add a city-tiling mode with:

- One master latitude/longitude-to-Minecraft transform
- A fixed global block offset for every generation tile
- Overlap margins for buildings, roads, water, and terrain
- A deterministic ownership rule for overlapping chunks
- Cached or saved input data
- Resumable tile state
- Seam validation
- Optional masking against the DataSF shoreline so adjacent Marin or unnecessary ocean is not treated as city

This is a fallback engineering project, not the default first move.

## Risks and responses

### Overpass or source-data request is too large

Response:

- Preserve the error and query.
- Fetch and save data in bounded requests.
- Reuse a shared citywide input snapshot.
- Move to the globally aligned tiling design if necessary.

### Generator runs out of memory

Response:

- Measure where it fails before changing settings.
- Confirm the current optimized release is in use.
- Reduce working-set size through aligned tiles, not by lowering the final city scope.

### Newly released generator regresses a critical area

Response:

- Preserve the exact 3.0.0 command, log, input snapshot, and output.
- Reproduce the defect on the smallest useful bbox.
- Compare the identical bbox and settings with 2.9.0.
- Freeze 2.9.0 only if it passes the complete validation matrix and the 3.0.0 defect is both reproducible and blocking.
- Never switch versions between tiles or between validation and the full run without restarting the manifest and coordinate analysis.

### Tall buildings are clipped

Response:

- Validate extended height during Milestone 2.
- Confirm server, client, and BlueMap compatibility with the bundled datapack.
- If extended height is unusable, document the exact clipping policy rather than silently distorting buildings.

### BlueMap shows black or missing areas

Response:

- Confirm that generated chunks contain usable lighting data.
- Load or relight chunks if required.
- Test BlueMap's documented missing-light option on a disposable render.

### Geographic data is incomplete

Response:

- Do not edit OpenStreetMap merely to make Minecraft look better.
- Record missing features in the validation report.
- Add corrections through a local, source-attributed enrichment layer.
- Later evaluate DataSF building footprints, parcels, street centerlines, transit, trees, public art, parks, and landmarks.

### Enrichment is silently partial

Response:

- Treat Overture as best-effort enrichment, not the authoritative city footprint source.
- Record the dynamically resolved Overture release and watch for its 100,000 non-OSM-building safety cap.
- Record every provider warning and fallback. Saving OSM JSON does not freeze Overture, elevation, land cover, 3D models, trees, or props.
- Fail validation when a source silently disappears across a neighborhood-sized area, even if the generator exits successfully.

### Output directory is mistaken for the world directory

Response:

- Give Arnis a unique, empty run-specific parent directory.
- Discover and record the `Arnis World N` child it creates.
- Do not checksum or publish the parent as though it were the world.

### Existing worlds are accidentally damaged

Response:

- Never generate into or serve the original save.
- Require a new destination path.
- Archive before reset.
- Refuse world replacement while `session.lock` indicates an active writer.

### The project becomes an infrastructure exercise instead of a fun world

Response:

- Keep the complete playable city as the milestone outcome.
- Treat reproducibility, maps, and agent interfaces as support for visiting and using the city.
- Demonstrate progress through recognizable places, not only logs or abstractions.

## Acceptance criteria

The project may be called complete when:

- A new source world generated by the explicitly frozen and checksummed Arnis release covers the full intended San Francisco rectangle at scale 1.0.
- No ordinary mainland neighborhood is absent.
- Treasure/Yerba Buena Island and Alcatraz are included or have a documented technical reason for deferral.
- The world loads in Minecraft Java 1.21.4 without corruption.
- A server can save, stop, and restart the world successfully.
- The player begins above ground in creative mode with flight and commands.
- At least 20 distributed landmark or neighborhood checks pass.
- A full-city BlueMap CLI render is available with useful markers, and its version, checksum, config, render time, and output size are recorded.
- Latitude/longitude and Minecraft coordinates can be converted in both directions.
- The generator version, binary checksum, exact command, bounds, projection, settings, environment overrides, logs, source-provider evidence, input references, and checksums are recorded.
- The immutable source, played copies, and archives are clearly separated.
- A fresh playable copy can be created through one documented reset command.
- A human can tour the city without understanding the implementation.

## Actual execution sequence

The July 13 run followed this sequence:

1. Preserved the original save, the played world, and the live server in place; no stop or runtime swap was required.
2. Created the ignored SF artifact tree and tracked evidence structure.
3. Pinned official Arnis 3.0.0 source/binaries and BlueMap 5.22 by SHA-256.
4. Generated downtown, steep-terrain, Golden Gate, filled-ground, and extended-height validation worlds.
5. Reproduced and patched the tall-heightmap serializer defect, then passed focused Rust and vanilla-server checks.
6. Replaced unreliable live full-city Overpass requests with a dated, checksummed BBBike snapshot and deterministic conversion.
7. Generated and exhaustively checksummed the complete city in one aligned pass.
8. Opened only a disposable APFS clone under an isolated 1.21.4 server and force-loaded eight distributed landmark chunks.
9. Frozen the elevation, land-cover, and model caches; recorded the observed Overture release boundary honestly.
10. Added a shared coordinate/marker dataset, a safe disposable-copy command, a reproducible BlueMap configuration, and qualified six-role packaging/verification.
11. Rendered the full atlas, packaged and verified the release, and committed only the scoped SF recipes and evidence.

The later Behold geographic observation/action layer remains a separate product integration. The world, coordinate bridge, shared place IDs, and immutable-copy workflow are ready for it without modifying current agent code.
