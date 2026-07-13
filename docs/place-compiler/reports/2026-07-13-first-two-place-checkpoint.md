# First two-place Place Compiler checkpoint

Status: **accepted**

This checkpoint proves that the San Francisco generation path has been extracted behind a declarative recipe and that the same compiler can generate, validate, launch, compare, and package a recognizable second place without place-specific code in its core.

## Source checkpoint

- Recipe-driven generator commit: `6a2fe86`
- Validation, runtime, comparison, and packaging commit: `e45993d`
- Full Behold gate after implementation: **192/192 passing**
- Place Compiler focused gate: **2/2 passing**
- Accepted generation recorded clean repository revision: `e45993d16603cb859535b9096008690556cafb4e`

The accepted generator records SHA-256 for every compiler, recipe, and runtime-profile source it consumes. Non-dry generation refuses a dirty Place Compiler scope. Validation later refuses a changed source, recipe, tool lock, generator binary, captured OSM input, world tree, projection, bounds, or landmark mapping.

## Two-place proof

San Francisco remains the regression recipe. Its compiled Arnis geometry matches the accepted full-city command:

- Bounds: `37.707,-122.516,37.834,-122.349`
- Projection: Arnis `local`
- Scale: one block per meter
- Spawn: Civic Center (`37.7793,-122.4193`)

Lower Manhattan is the independent generation:

- Bounds: `40.697,-74.021,40.721,-73.989`
- Projection: Arnis `local`
- Scale: one block per meter
- Spawn: One World Trade Center (`40.7127,-74.0134`)
- Frozen OSM SHA-256: `08aa3e1acf855c49377b86e43fbe8af1ea441adef3ac953d2a4b0273d5878900`
- Recipe SHA-256: `94159bec1a30935f6826541aa330f430924d69c4c9a96c28bbbb3b10827e6620`
- Tool-lock SHA-256: `95601b04d78f23c9a6fb9b05a670e4270a7740c864a4456b3879bf9ac32df136`
- Patched Arnis SHA-256: `ce00bf95d025b12f0b7d466e3b79c7fd0df28c4a6df1f17c41eaace9ce93eb24`
- Recorded generation wall time: 47.84 seconds
- Recorded peak resident set: 1,247,936,512 bytes

The accepted world contains 36 nonempty region files and 311,166,010 bytes across 48 world-tree entries. Its timestamp-independent world-tree SHA-256 is `08425c0cda60155a129a8772b994f6d50041190aedd13e8e0f5ac0b11eea69a6`.

Automated geographic validation mapped all reference points inside the generated world:

| Landmark                           | Minecraft X | Minecraft Z |
| ---------------------------------- | ----------: | ----------: |
| One World Trade Center             |         640 |         922 |
| The Battery                        |         337 |        1967 |
| New York City Hall                 |        1264 |         911 |
| Brooklyn Bridge Manhattan approach |        2039 |        1567 |

## Living-world proof

The `living` profile was materialized into a disposable APFS-cloned server instance and launched with the pinned Minecraft 1.21.4 server on isolated port `25686`. The server independently reported:

- Place Compiler runtime datapack loaded automatically
- Default game mode: Survival
- Difficulty: Normal
- `doDaylightCycle = true`
- `doWeatherCycle = true`
- `doMobSpawning = true`
- A rain command was accepted
- The world saved and stopped cleanly

The checksummed smoke log and runtime manifest are included in the generation-evidence archive. Minecraft remains authoritative for weather, time, spawning, and ecology; no parallel ecology engine is required by the profile.

## Visual comparison

The local comparison is:

`.behold-artifacts/places/comparisons/first-two-place-proof-v3/place-compiler-two-place-proof.png`

- Dimensions: 2400 × 947
- Artifact SHA-256: `48610b9075c05ead1887474c45aeeb838a5d22512734ba820dd3dda497f8ffd0`
- San Francisco preview SHA-256: `090cbe91cb631bed7cdfd5da267176dc29895345c914cc5e6ae99c6f908b448a`
- Lower Manhattan preview SHA-256: `9616ac61182e608cedd4be39899e62ad2c185ca640781583020009e509c1a03b`

The comparison manifest records both run IDs, recipes, OSM inputs, preview digests, the ImageMagick version, and the final artifact digest.

## Verified release

Release root:

`.behold-artifacts/places/lower-manhattan/releases/lower-manhattan-v3`

| Role                                  |       Bytes | SHA-256                                                            |
| ------------------------------------- | ----------: | ------------------------------------------------------------------ |
| Immutable world                       | 201,417,823 | `93b02333690234b6001ba16c917823d687563454357120ca2a5f5f589b0b71fe` |
| Generation evidence                   |       9,792 | `0de16cb0c6042fa09931681db6e5e201145603430e49e6dd843a6818e14c3584` |
| Reproduction kit                      |      19,723 | `706de2ff119f47e742657876a119e6cdb9d63b9dd57e76ed66c28bb8858f3fb3` |
| Generation inputs and isolated caches |  41,321,886 | `b106da18337dd90b5c9cd1b94eee3bf70e56d0cc79cc52e8e1b69d23c59a1b6e` |

`verify-release.mjs` independently rehashed every archive, checked recorded sizes, rejected unsafe paths and `session.lock`, and required role-specific contents. All four archives verified.

## Honest boundary

- The accepted SF world predates the Place Compiler manifest schema. It is adopted as the visual regression artifact, while the SF recipe and focused test prove that the new compiler emits the accepted geometry and generator settings. A future SF regeneration can produce a native v2 manifest without changing the compiler.
- Lower Manhattan intentionally disables live Overture enrichment. The frozen OSM input plus captured elevation and land-cover caches provide a cleaner reference build; richer live enrichment remains a recipe-level Pareto choice.
- This checkpoint proves a top-down visual comparison, not yet a cinematic in-game Manhattan tour or BlueMap render.
- Runtime smoke used offline mode on loopback for a disposable local proof. That is not a production authentication policy.
- The Place Compiler publishes world artifacts and provenance only. Behold independently owns world epochs, body admission, observations, actions, and consequence witnesses.
