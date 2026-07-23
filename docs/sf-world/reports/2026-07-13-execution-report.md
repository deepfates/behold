# San Francisco full-world execution report

Date: 2026-07-13

Run: `sf-full-v3-snapshot-20260713T095831Z`

Status: complete; immutable source world, full atlas, and six-role release accepted and verified

## Outcome

This run produced a real, ordinary Minecraft Java 1.21.4 world covering the complete practical San Francisco rectangle. An isolated vanilla server opened a disposable clone, loaded eight distributed landmark chunks, verified the filled underground, saved, and stopped cleanly. The generated source itself remains unopened, contains no `session.lock`, and is suitable for cloning into a future server runtime.

The world is geographically derived and procedurally interpreted. Streets, footprints, terrain, land cover, water, and supported landmarks come from the recorded geographic pipeline; facades, roofs, interiors, vegetation, and props are not a photographic reconstruction.

## Artifact identity

| Field              | Value                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Run root           | `.behold-artifacts/sf/runs/full-city/sf-full-v3-snapshot-20260713T095831Z` |
| Immutable world    | `output/Arnis World 1`                                                     |
| Minecraft version  | 1.21.4                                                                     |
| Dimensions         | 14,679 × 14,122 blocks                                                     |
| Region files       | 812                                                                        |
| Total files        | 824                                                                        |
| File bytes         | 6,138,031,022                                                              |
| Tree SHA-256       | `4fd327ebe85e90931e3fee4cd01c50490fd3ae4638f98ac53d1e6045d29554d1`         |
| Per-file checksums | `evidence/world-checksums.json` in the ignored run                         |
| Source lock        | Absent                                                                     |

The deterministic tree digest covers each relative path, file size, and file SHA-256. It is independent of filesystem timestamps and archive metadata.

## Frozen geography and settings

| Setting                 | Accepted value                    |
| ----------------------- | --------------------------------- |
| Bounds                  | `37.707,-122.516,37.834,-122.349` |
| Minecraft bounds        | X `0..14678`, Z `0..14121`        |
| Projection              | `local`                           |
| Scale                   | 1 block per meter                 |
| Rotation                | 0°                                |
| Spawn                   | Civic Center, X 8499, Z 6082      |
| Terrain and land cover  | Enabled                           |
| Interiors               | Enabled                           |
| Overture enrichment     | Enabled; 1,343 buildings added    |
| External stadium models | 5 models, 617,192 blocks          |
| Filled ground           | Enabled                           |
| Extended height         | Enabled                           |
| Baked lighting          | Enabled                           |
| Game mode and time      | Creative, 6000 ticks              |

Generation finished successfully in 718.452 seconds. It ran with `ARNIS_STREAM_TO_DISK=1`, four Rayon threads, nice level 10, and a measured peak resident set of 12,704,120,832 bytes. Arnis processed 812 tiles. Its log contains no fatal error and did not report the Overture building cap.

## Reproducible source snapshot

Repeated live Overpass requests for the full rectangle timed out across providers. The accepted fallback is a saved BBBike San Francisco extract whose published coverage polygon fully contains the target rectangle.

| Input                      | Identity                                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| Source URL                 | `https://download.bbbike.org/osm/bbbike/SanFrancisco/SanFrancisco.osm.pbf` |
| Last modified              | `2026-07-11T17:05:27Z`                                                     |
| PBF size                   | 32,587,807 bytes                                                           |
| Published and verified MD5 | `61b7340e323859ea402e798c43d75231`                                         |
| PBF SHA-256                | `d22d87fbfb8496d14f8a67535f2f0c9acfb53840377758db40855abf114e01b7`         |
| Overpass JSON size         | 381,749,723 bytes                                                          |
| Overpass JSON SHA-256      | `0afff75444a2235c55fab52cac73d85bedada6b31caa3ea246cf8cb59bebe2c7`         |
| Element counts             | 3,696,034 nodes; 442,800 ways; 10,212 relations                            |

The converter is `scripts/sf-world/pbf-to-overpass.py`; its Python dependencies and wheel hashes are pinned in `scripts/sf-world/requirements.txt`. Conversion took 52.83 seconds and a separate downtown generation from the converted JSON passed before the full run.

Arnis's accepted enrichment caches were frozen after the run: 1,332 USGS 3DEP elevation tiles, 10 ESA WorldCover cache files, and the custom stadium model. The 1,343 files total 1,401,800,814 bytes and have deterministic tree SHA-256 `1e73aeae550c8db0001aae08181598e9a4a04a9eb4abfa2ed593e8c3ff55859b`. They are included in the input archive with their original cache-relative paths so a raw regeneration can use an isolated HOME rather than changing a user's cache.

The Overture catalog observed immediately after generation named release `2026-06-17.0`; the 7,817-byte catalog snapshot has SHA-256 `2c96d71be607018c3f3c9f5967672161ba930825dc1b83f52be812ba4513fbba`. This release identity is an evidence-backed inference because the accepted run was not launched with Arnis debug URL logging. Arnis 3.0.0 neither caches the Overture HTTP range responses nor accepts an Overture snapshot, so future raw regeneration is not promised to be block-for-block identical. The exact reproducible deliverable is the immutable checksummed world and its verified archive; cloning or extracting it produces the accepted blocks exactly.

The first resumed PBF attempt combined incompatible byte ranges and failed the published MD5. It was quarantined under the aborted live-Overpass run and is neither an accepted input nor a release artifact.

## Generator defect and fix

Official Arnis 3.0.0 creates a 4,064-block-tall datapack dimension but serialized heightmaps as if chunks were only 384 blocks tall. Minecraft reported 37 heightmap longs where 52 were required. The tracked patch carries the extended-height setting to the chunk writer and encodes heightmaps against Y `-2032..2031`.

The patch is `docs/sf-world/tooling/arnis-v3.0.0-tall-heightmap.patch`. It applies cleanly to the pinned 8,706,241-byte official v3.0.0 source archive (SHA-256 `260deb29ba75fbce68e39190a7d35bce56f77433963f148b64592b873447cab0`). Four focused Rust tests pass, and a force-loaded Sutro/Twin Peaks validation produced no heightmap warnings. Tool identities are pinned in `docs/sf-world/tool-lock.json`.

## Vanilla server compatibility

The server smoke test used an APFS clone at `server-smoke/world` and a separate vanilla 1.21.4 server bound to `127.0.0.1:25575`. The 56,880,250-byte server jar matches Mojang's published SHA-1 `4707d00eb834b446575d89a61a11b5d548d8c001` and has SHA-256 `1066970b09e9c671844572291c4a871cc1ac2b85838bf7004fa0e778e10f1358`. It force-loaded chunks containing:

- Civic Center
- Sutro Tower and Twin Peaks
- Golden Gate Bridge
- Treasure and Yerba Buena Islands
- Ferry Building
- Ocean Beach
- Alcatraz
- Oracle Park

The log contains zero heightmap-width warnings, chunk errors, or exceptions. Commands confirmed bedrock at Y=-64 and stone at Y=-63, then the server saved all dimensions and stopped cleanly. The offline-mode warnings in this disposable local smoke server are expected and are not a world defect.

The shared `docs/sf-world/landmarks.json` records geographic, block, display-height, and chunk coordinates for eight server-tested landmarks and 18 additional neighborhoods. Automated verification against the accepted `metadata.json` passed all 26 block and chunk round trips with zero difference from the stored block-center coordinates.

## What “underground” means

The accepted world has a real mineable underground volume: bedrock, stone, and generated ores exist below the surface. It does not contain an authentic model of BART, Muni tunnels, sewers, utility corridors, caves, or San Francisco geology. Those data were not part of the source pipeline. Such infrastructure would be a later authored/data-integration layer, not something this generation can honestly claim.

## Atlas

BlueMap 5.22 rendered directly from the immutable source in three resumable, recorded legs using 2, 4, and 8 renderer threads. The legs consumed 11,211.413 seconds of wall time in total; peak resident memory was 4,641,013,760 bytes. The first two legs ended with deliberate `SIGINT` checkpoints and exit code 130, and the final leg exited 0 after reporting every map up to date. The first checkpoint exposed a Java `FileHandler` null-writer exception after shutdown started; this was a logging-close race rather than a render error, and the next leg resumed its saved state. The second checkpoint and final stop were clean.

The renderer, its 139,557-byte resource-extension bundle, and Mojang's 28,335,587-byte Minecraft 1.21.4 client resource are pinned in the tool lock; the client resource is excluded from release archives under Mojang's terms. The configuration uses the exact X/Z mask, all three browser views, high-resolution geometry, baked light data without the missing-light fallback, eight server-verified landmark markers, 18 coordinate-verified neighborhood markers, and a loopback-only webserver on `127.0.0.1:8106`. `scripts/sf-world/configure-bluemap.mjs` reproduces the configuration from the world metadata.

The completed web tree contains 204,211 files and 17,663,332,886 bytes. Its timestamp-independent tree SHA-256 is `a967f6b85087e187826df2e681b57b5206f7c96513a81c6b64a4f113ce0d00e8`; an immediate verification after HTTP and browser QA reproduced the same digest. HTTP probes covered the root document, global and map settings, marker JSON, and a PNG tile. Browser activity produced 397 HTTP 200 responses and 143 expected 204 responses for out-of-mask tiles, with zero 4xx/5xx responses. The in-app browser loaded the complete city, all 26 markers, and perspective, flat, and free-flight views with zero console warnings or errors.

## Release-pipeline qualification

Before handling the full artifact, the package and verification path completed against a disposable 21,965,584-byte world fixture with all six content archive roles. Verification rehashed every archive and the manifest, matched recorded byte counts, streamed every tar listing, found all role-specific files, rejected no paths as unsafe, and confirmed the immutable-world archive had no `session.lock`.

Two independent fixture packages from unchanged source trees produced byte-identical world, generation-evidence, reproduction-kit, input, atlas, and atlas-evidence archives. The recipe uses portable USTAR, gzip level 1 without a header timestamp, normalized ownership, and no extended attributes; USTAR avoids platform-specific access/change/creation-time PAX records. The release manifest intentionally has a new `createdAt` on each invocation; the content archives themselves are reproducible.

The production release passed the same verifier. Every digest and byte count matched; all archive listings streamed successfully; 225,015 atlas entries were safe; every role-specific file was present; and the immutable world archive contained no `session.lock`. Extracting the packaged world into a separate ignored directory reproduced all 824 files, 6,138,031,022 bytes, and source tree SHA-256 `4fd327ebe85e90931e3fee4cd01c50490fd3ae4638f98ac53d1e6045d29554d1`.

A second full production package was created independently after the release. All six content archives were byte-for-byte identical to the release, including the 12,800,761,189-byte atlas archive and 4,145,569,544-byte world archive. This proves the archive recipe at production scale rather than relying only on the fixture.

| Role                |  Archive bytes | SHA-256                                                            |
| ------------------- | -------------: | ------------------------------------------------------------------ |
| Immutable world     |  4,145,569,544 | `9b17fdf4b20671b2bf78852cd02791994476a9efa67227416113df0a41a1d2b9` |
| Generation evidence |        112,800 | `d7b103a2c48733e1f02d736ed46d221222798dd03e25b77fa1d65aa5caaed880` |
| Reproduction kit    |         32,564 | `f65f3dee141ff24e2efdf6fb85568ea928cb79757c4bd23932c4c4a4049b9996` |
| Generation inputs   |    997,494,200 | `b18ba358d0119951d92a47946c6de4503456da9aa3b65da41421cd3d012ebc43` |
| BlueMap atlas       | 12,800,761,189 | `67c7aee54c75ab270529d4dfd0ac93935e3e6537dadd1a74c5504818ce1b2acb` |
| BlueMap evidence    |     10,468,664 | `f5c3aba12f843e4cce9caf65cb6c6a31b78075eec07c64e8896455514a441b22` |

The release manifest SHA-256 is `be13cef600d5f3bb78bc826a30dd52598cea3aea17090d746c1abeccb2f4ffb0`.

## Preview and visual limitations

Arnis produced a 3,670 × 3,531 preview (`arnis_world_map.png`), 16,484,131 bytes, SHA-256 `090cbe91cb631bed7cdfd5da267176dc29895345c914cc5e6ae99c6f908b448a`. It visibly covers the peninsula, Golden Gate Bridge, Alcatraz, Treasure/Yerba Buena Islands, dense northeastern neighborhoods, western residential districts, and southern neighborhoods.

The finished atlas confirms visible water coloration patterns that follow source or render tiles. It also confirms that landmark geometry is geographic and procedural rather than photorealistic: the Golden Gate crossing is present, for example, but is not an iconic red suspension-bridge reconstruction. These are visual-fidelity limitations, not missing region files or server-load failures.

## Isolation and traceability

- All large tools, inputs, validation runs, worlds, atlas files, logs, and release archives live under ignored `.behold-artifacts/sf/` paths.
- Only small recipes, patch material, manifests, reports, and checksums belong in Git.
- Full generation and validation ran at nice level 10. Rendering used bounded 2-, 4-, and 8-thread legs at nice levels 10 and 15; packaging and verification were also low priority.
- The live Behold Java server remained PID 41100 on `127.0.0.1:25565` throughout this work.
- Nothing read from, wrote to, reset, or replaced `.behold-runtime/server/world`.
- Final Git staging is restricted to `.gitignore`, `docs/SAN_FRANCISCO_WORLD_PLAN.md`, `docs/sf-world/`, and `scripts/sf-world/` so unrelated dirty work is excluded.

The reusable clone command was tested in both directions: it created and metadata-verified a disposable APFS world clone, and its negative test refused a destination under `.behold-runtime/` before creating anything.

## Acceptance decision

The generated world, completed browser atlas, and six-role release are accepted. Acceptance is based on exact input/tool identity, a successful full generation, exhaustive file checksums, a clean isolated server smoke, distributed chunk loading, loopback HTTP and visual browser QA, archive verification, extracted-world tree verification, production-scale byte reproducibility, and explicit limitations. Operational deployment to the live Behold server is intentionally not part of this run and must remain a separate, lock-aware action.
